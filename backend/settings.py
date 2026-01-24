"""
Application settings persisted in the local metadata store.
"""
from __future__ import annotations

import threading
import time
from typing import Optional

from .shared import Result, get_logger
from .config import MEDIA_PROBE_BACKEND

logger = get_logger(__name__)

_PROBE_BACKEND_KEY = "media_probe_backend"
_SETTINGS_VERSION_KEY = "__settings_version"
_VALID_PROBE_MODES = {"auto", "exiftool", "ffprobe", "both"}

_SETTINGS_CACHE_TTL_S = 10.0
_VERSION_CACHE_TTL_S = 1.0
_MS_PER_S = 1000.0


class AppSettings:
    """
    Simple settings manager backed by the metadata table.
    """

    def __init__(self, db):
        self._db = db
        self._lock = threading.Lock()
        self._cache: dict[str, str] = {}
        self._cache_at: dict[str, float] = {}
        self._cache_version: dict[str, int] = {}
        self._cache_ttl_s = _SETTINGS_CACHE_TTL_S
        self._version_cache_ttl_s = _VERSION_CACHE_TTL_S
        self._version_cached: int = 0
        self._version_cached_at: float = 0.0
        self._default_probe_mode = MEDIA_PROBE_BACKEND

    def _read_setting(self, key: str) -> Optional[str]:
        result = self._db.query("SELECT value FROM metadata WHERE key = ?", (key,))
        if not result.ok or not result.data:
            return None
        raw = result.data[0].get("value")
        if isinstance(raw, str):
            return raw.strip().lower()
        return None

    def _write_setting(self, key: str, value: str) -> Result[str]:
        return self._db.execute(
            "INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)",
            (key, value),
        )

    def _read_settings_version(self) -> int:
        try:
            raw = self._read_setting(_SETTINGS_VERSION_KEY)
            n = int(str(raw or "0").strip() or "0")
            return max(0, n)
        except Exception:
            return 0

    def _get_settings_version(self) -> int:
        now = time.monotonic()
        try:
            ts = float(self._version_cached_at or 0.0)
        except Exception:
            ts = 0.0
        if ts and (now - ts) < float(self._version_cache_ttl_s):
            return int(self._version_cached or 0)
        v = self._read_settings_version()
        self._version_cached = int(v or 0)
        self._version_cached_at = now
        return self._version_cached

    def _bump_settings_version_locked(self) -> Result[int]:
        """
        Bump a monotonically increasing settings version in the DB.

        Used to reduce stale caches in multi-instance deployments.
        """
        try:
            # Unix ms timestamp is monotonic enough for our purposes and works across processes.
            v = int(time.time() * _MS_PER_S)
        except Exception:
            v = int(time.time())
        res = self._write_setting(_SETTINGS_VERSION_KEY, str(v))
        if not res.ok:
            return Result.Err("DB_ERROR", res.error or "Failed to bump settings version")
        self._version_cached = v
        self._version_cached_at = time.monotonic()
        return Result.Ok(v)

    def get_probe_backend(self) -> str:
        with self._lock:
            current_version = self._get_settings_version()
            cached = self._cache.get(_PROBE_BACKEND_KEY)
            if cached:
                try:
                    ts = float(self._cache_at.get(_PROBE_BACKEND_KEY) or 0.0)
                except Exception:
                    ts = 0.0
                cached_ver = int(self._cache_version.get(_PROBE_BACKEND_KEY) or 0)
                if cached_ver == int(current_version or 0) and ts and (time.monotonic() - ts) < self._cache_ttl_s:
                    return cached
            mode = self._read_setting(_PROBE_BACKEND_KEY)
            if mode not in _VALID_PROBE_MODES:
                mode = self._default_probe_mode
            self._cache[_PROBE_BACKEND_KEY] = mode
            self._cache_at[_PROBE_BACKEND_KEY] = time.monotonic()
            self._cache_version[_PROBE_BACKEND_KEY] = int(current_version or 0)
            return mode

    def set_probe_backend(self, mode: str) -> Result[str]:
        normalized = (mode or "").strip().lower()
        if not normalized:
            normalized = self._default_probe_mode
        if normalized not in _VALID_PROBE_MODES:
            return Result.Err("INVALID_INPUT", f"Invalid probe mode: {mode}")
        with self._lock:
            result = self._write_setting(_PROBE_BACKEND_KEY, normalized)
            if result.ok:
                bump = self._bump_settings_version_locked()
                if not bump.ok:
                    try:
                        logger.warning("Failed to bump settings version: %s", bump.error)
                    except Exception:
                        pass
                self._cache[_PROBE_BACKEND_KEY] = normalized
                self._cache_at[_PROBE_BACKEND_KEY] = time.monotonic()
                self._cache_version[_PROBE_BACKEND_KEY] = int(bump.data or self._get_settings_version() or 0)
                logger.info("Media probe backend set to %s", normalized)
                return Result.Ok(normalized)
            return Result.Err("DB_ERROR", result.error or "Failed to persist probe backend")
