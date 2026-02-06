"""
Application settings persisted in the local metadata store.
"""
from __future__ import annotations

import threading
import os
import asyncio
import time
from typing import Any, Mapping, Optional

from .shared import Result, get_logger
from .config import MEDIA_PROBE_BACKEND
from .utils import env_bool, parse_bool

logger = get_logger(__name__)

_PROBE_BACKEND_KEY = "media_probe_backend"
_SETTINGS_VERSION_KEY = "__settings_version"
_VALID_PROBE_MODES = {"auto", "exiftool", "ffprobe", "both"}
_SECURITY_PREFS_INFO: Mapping[str, dict[str, bool | str]] = {
    "safe_mode": {"env": "MAJOOR_SAFE_MODE", "default": False},
    "allow_write": {"env": "MAJOOR_ALLOW_WRITE", "default": False},
    "allow_remote_write": {"env": "MAJOOR_ALLOW_REMOTE_WRITE", "default": True},
    "allow_delete": {"env": "MAJOOR_ALLOW_DELETE", "default": True},
    "allow_rename": {"env": "MAJOOR_ALLOW_RENAME", "default": True},
    "allow_open_in_folder": {"env": "MAJOOR_ALLOW_OPEN_IN_FOLDER", "default": True},
    "allow_reset_index": {"env": "MAJOOR_ALLOW_RESET_INDEX", "default": True},
}

_SETTINGS_CACHE_TTL_S = 10.0
_VERSION_CACHE_TTL_S = 1.0
_MS_PER_S = 1000.0



class AppSettings:
    """
    Simple settings manager backed by the metadata table.
    """

    def __init__(self, db):
        self._db = db
        self._lock = asyncio.Lock()
        self._cache: dict[str, str] = {}
        self._cache_at: dict[str, float] = {}
        self._cache_version: dict[str, int] = {}
        self._cache_ttl_s = _SETTINGS_CACHE_TTL_S
        self._version_cache_ttl_s = _VERSION_CACHE_TTL_S
        self._version_cached: int = 0
        self._version_cached_at: float = 0.0
        self._default_probe_mode = MEDIA_PROBE_BACKEND

    async def _read_setting(self, key: str) -> Optional[str]:
        result = await self._db.aquery("SELECT value FROM metadata WHERE key = ?", (key,))
        if not result.ok or not result.data:
            return None
        raw = result.data[0].get("value")
        if isinstance(raw, str):
            return raw.strip().lower()
        return None

    async def _write_setting(self, key: str, value: str) -> Result[str]:
        return await self._db.aexecute(
            "INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)",
            (key, value),
        )

    async def _get_security_prefs_locked(self) -> dict[str, bool]:
        output: dict[str, bool] = {}
        for key, info in _SECURITY_PREFS_INFO.items():
            raw = await self._read_setting(key)
            if raw is not None:
                output[key] = parse_bool(raw, bool(info.get("default", False)))
            else:
                default = bool(info.get("default", False))
                env_var = str(info.get("env") or "")
                output[key] = env_bool(env_var, default)
        return output

    async def get_security_prefs(self) -> dict[str, bool]:
        async with self._lock:
            return await self._get_security_prefs_locked()

    async def set_security_prefs(self, prefs: Mapping[str, Any]) -> Result[dict[str, bool]]:
        to_write: dict[str, bool] = {}
        for key in _SECURITY_PREFS_INFO:
            if key in prefs:
                to_write[key] = parse_bool(prefs[key], False)
        if not to_write:
            return Result.Err("INVALID_INPUT", "No security settings provided")
        async with self._lock:
            for key, value in to_write.items():
                res = await self._write_setting(key, "1" if value else "0")
                if not res.ok:
                    return Result.Err("DB_ERROR", res.error or f"Failed to persist {key}")
                try:
                    info = _SECURITY_PREFS_INFO.get(key) or {}
                    env_var = str(info.get("env") or "").strip()
                    if env_var:
                        os.environ[env_var] = "1" if value else "0"
                except Exception:
                    pass
            bump = await self._bump_settings_version_locked()
            if not bump.ok:
                try:
                    logger.warning("Failed to bump settings version: %s", bump.error)
                except Exception:
                    pass
            return Result.Ok(await self._get_security_prefs_locked())

    async def _read_settings_version(self) -> int:
        try:
            raw = await self._read_setting(_SETTINGS_VERSION_KEY)
            n = int(str(raw or "0").strip() or "0")
            return max(0, n)
        except Exception:
            return 0

    async def _get_settings_version(self) -> int:
        now = time.monotonic()
        try:
            ts = float(self._version_cached_at or 0.0)
        except Exception:
            ts = 0.0
        if ts and (now - ts) < float(self._version_cache_ttl_s):
            return int(self._version_cached or 0)
        v = await self._read_settings_version()
        self._version_cached = int(v or 0)
        self._version_cached_at = now
        return self._version_cached

    async def _bump_settings_version_locked(self) -> Result[int]:
        """
        Bump a monotonically increasing settings version in the DB.

        Used to reduce stale caches in multi-instance deployments.
        """
        try:
            # Unix ms timestamp is monotonic enough for our purposes and works across processes.
            v = int(time.time() * _MS_PER_S)
        except Exception:
            v = int(time.time())
        res = await self._write_setting(_SETTINGS_VERSION_KEY, str(v))
        if not res.ok:
            return Result.Err("DB_ERROR", res.error or "Failed to bump settings version")
        self._version_cached = v
        self._version_cached_at = time.monotonic()
        return Result.Ok(v)

    async def get_probe_backend(self) -> str:
        """Return the configured media probe backend mode."""
        async with self._lock:
            current_version = await self._get_settings_version()
            cached = self._cache.get(_PROBE_BACKEND_KEY)
            if cached:
                try:
                    ts = float(self._cache_at.get(_PROBE_BACKEND_KEY) or 0.0)
                except Exception:
                    ts = 0.0
                cached_ver = int(self._cache_version.get(_PROBE_BACKEND_KEY) or 0)
                if cached_ver == int(current_version or 0) and ts and (time.monotonic() - ts) < self._cache_ttl_s:
                    return cached
            mode = await self._read_setting(_PROBE_BACKEND_KEY)
            if mode not in _VALID_PROBE_MODES:
                mode = self._default_probe_mode
            self._cache[_PROBE_BACKEND_KEY] = mode
            self._cache_at[_PROBE_BACKEND_KEY] = time.monotonic()
            self._cache_version[_PROBE_BACKEND_KEY] = int(current_version or 0)
            return mode

    async def set_probe_backend(self, mode: str) -> Result[str]:
        """Persist the media probe backend mode and bump the settings version."""
        normalized = (mode or "").strip().lower()
        if not normalized:
            normalized = self._default_probe_mode
        if normalized not in _VALID_PROBE_MODES:
            return Result.Err("INVALID_INPUT", f"Invalid probe mode: {mode}")
        async with self._lock:
            result = await self._write_setting(_PROBE_BACKEND_KEY, normalized)
            if result.ok:
                bump = await self._bump_settings_version_locked()
                if not bump.ok:
                    try:
                        logger.warning("Failed to bump settings version: %s", bump.error)
                    except Exception:
                        pass
                self._cache[_PROBE_BACKEND_KEY] = normalized
                self._cache_at[_PROBE_BACKEND_KEY] = time.monotonic()
                self._cache_version[_PROBE_BACKEND_KEY] = int(bump.data or await self._get_settings_version() or 0)
                logger.info("Media probe backend set to %s", normalized)
                return Result.Ok(normalized)
            return Result.Err("DB_ERROR", result.error or "Failed to persist probe backend")

