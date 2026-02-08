"""
Batch ZIP builder for drag-out (AssetsManager -> OS).

Used by the frontend to support multi-selection drag-out via "DownloadURL".
"""

from __future__ import annotations

import asyncio
import os
import threading
import time
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional

from aiohttp import web

from backend.config import OUTPUT_ROOT_PATH
from backend.custom_roots import resolve_custom_root
from backend.shared import Result, get_logger, sanitize_error_message
from backend.routes.core.paths import _is_within_root, _safe_rel_path
from backend.routes.core.response import _json_response
from backend.routes.core.request_json import _read_json
from backend.routes.core.security import _check_rate_limit, _csrf_error

try:
    import folder_paths  # type: ignore
except Exception:
    folder_paths = None  # type: ignore

logger = get_logger(__name__)

_BATCH_DIR = OUTPUT_ROOT_PATH / "_mjr_batch_zips"
_BATCH_LOCK = threading.Lock()
_BATCH_CACHE: Dict[str, Dict[str, Any]] = {}
_TOKEN_LOCKS: Dict[str, threading.Lock] = {}
_TOKEN_LOCKS_LOCK = threading.Lock()


def _get_token_lock(token: str) -> threading.Lock:
    with _TOKEN_LOCKS_LOCK:
        lock = _TOKEN_LOCKS.get(token)
        if lock is None:
            lock = threading.Lock()
            _TOKEN_LOCKS[token] = lock
        return lock


def _release_token_lock(token: str) -> None:
    with _TOKEN_LOCKS_LOCK:
        if token in _TOKEN_LOCKS:
            _TOKEN_LOCKS.pop(token, None)

_DEFAULT_BATCH_TTL_SECONDS = 300  # 5 minutes
_DEFAULT_BATCH_MAX = 50
_DEFAULT_MAX_ITEMS = 1000
_DEFAULT_BUILD_TIMEOUT_S = 120.0
_DEFAULT_ZIP_COPY_CHUNK_BYTES = 1024 * 1024  # 1MB

_TOKEN_MAX_LEN = 200
_TOKEN_MIN_LEN = 16
_ZIP_NAME_MAX_LEN = 255
_MAX_REQUEST_BYTES = 5 * 1024 * 1024

_RATE_LIMIT_MAX_REQUESTS = 30
_RATE_LIMIT_WINDOW_SECONDS = 60

_BATCH_TTL_SECONDS = int(os.environ.get("MAJOOR_BATCH_ZIP_TTL_SECONDS", str(_DEFAULT_BATCH_TTL_SECONDS)))
_BATCH_MAX = int(os.environ.get("MAJOOR_BATCH_ZIP_MAX", str(_DEFAULT_BATCH_MAX)))
_MAX_ITEMS = int(os.environ.get("MAJOOR_MAX_BATCH_SIZE", str(_DEFAULT_MAX_ITEMS)))
_BUILD_TIMEOUT_S = float(os.environ.get("MAJOOR_BATCH_ZIP_BUILD_TIMEOUT_S", str(_DEFAULT_BUILD_TIMEOUT_S)))
_ZIP_COPY_CHUNK_BYTES = int(os.environ.get("MAJOOR_BATCH_ZIP_CHUNK_BYTES", str(_DEFAULT_ZIP_COPY_CHUNK_BYTES)))


def _sanitize_token(token: Any) -> str:
    raw = str(token or "").strip()
    if not raw:
        return ""
    if len(raw) > _TOKEN_MAX_LEN:
        return ""
    allowed = []
    for ch in raw:
        if ch.isalnum() or ch in ("_", "-"):
            allowed.append(ch)
    out = "".join(allowed)
    if not out:
        return ""
    # Prevent trivially-guessable tokens (very short / enumerable).
    if len(out) < _TOKEN_MIN_LEN:
        return ""
    return out


def _cleanup_batch_zips() -> None:
    now = time.time()
    stale: List[str] = []
    with _BATCH_LOCK:
        for token, entry in list(_BATCH_CACHE.items()):
            created_at = float(entry.get("created_at") or 0)
            if created_at and now - created_at > _BATCH_TTL_SECONDS:
                stale.append(token)
        for token in stale:
            entry = _BATCH_CACHE.pop(token, None)
            path = entry.get("path") if isinstance(entry, dict) else None
            _release_token_lock(token)
            if isinstance(path, Path):
                try:
                    if path.exists():
                        path.unlink()
                        logger.debug("Cleaned up stale batch zip: %s", path.name)
                except Exception as exc:
                    logger.warning("Failed to cleanup batch zip %s: %s", path.name if path else token, exc)

        # Cap cache size in case of unexpected usage.
        if len(_BATCH_CACHE) > _BATCH_MAX:
            items = sorted(_BATCH_CACHE.items(), key=lambda kv: float(kv[1].get("created_at") or 0))
            to_drop = items[: max(0, len(items) - _BATCH_MAX)]
            for token, entry in to_drop:
                _BATCH_CACHE.pop(token, None)
                _release_token_lock(token)
            path = entry.get("path") if isinstance(entry, dict) else None
            if isinstance(path, Path):
                try:
                    if path.exists():
                        path.unlink()
                        logger.debug("Cleaned up batch zip (cache cap): %s", path.name)
                except Exception as exc:
                    logger.warning("Failed to cleanup batch zip %s: %s", path.name if path else token, exc)


def _resolve_item_path(item: Dict[str, Any]) -> Optional[Path]:
    filename_raw = (item or {}).get("filename")
    subfolder_raw = (item or {}).get("subfolder", "") or ""
    typ = str((item or {}).get("type") or "output").lower()

    filename_rel = _safe_rel_path(str(filename_raw or ""))
    if not filename_rel or len(filename_rel.parts) != 1:
        return None

    subfolder_rel = _safe_rel_path(str(subfolder_raw))
    if subfolder_rel is None:
        return None

    base_dir: Optional[Path] = None
    if typ == "input":
        try:
            if folder_paths is not None:
                base_dir = Path(str(folder_paths.get_input_directory())).resolve(strict=True)
        except Exception:
            base_dir = None
        if base_dir is None:
            return None
    elif typ == "custom":
        root_id = (item or {}).get("root_id") or (item or {}).get("rootId") or (item or {}).get("custom_root_id") or ""
        root_res = resolve_custom_root(str(root_id))
        if not root_res.ok or not isinstance(root_res.data, Path):
            return None
        try:
            base_dir = root_res.data.resolve(strict=True)
        except Exception:
            return None
    else:
        try:
            base_dir = OUTPUT_ROOT_PATH.resolve(strict=True)
        except Exception:
            return None

    try:
        candidate = (base_dir / subfolder_rel / filename_rel).resolve(strict=True)
    except Exception:
        return None
    if not _is_within_root(candidate, base_dir):
        return None
    if not candidate.exists() or not candidate.is_file():
        return None
    return candidate


def register_batch_zip_routes(routes: web.RouteTableDef) -> None:
    """Register batch-zip creation and download routes."""
    @routes.post("/mjr/am/batch-zip")
    async def create_batch_zip(request: web.Request) -> web.Response:
        csrf = _csrf_error(request)
        if csrf:
            return _json_response(Result.Err("CSRF", csrf))

        allowed, retry_after = _check_rate_limit(
            request,
            "batch_zip_create",
            max_requests=_RATE_LIMIT_MAX_REQUESTS,
            window_seconds=_RATE_LIMIT_WINDOW_SECONDS,
        )
        if not allowed:
            return _json_response(Result.Err("RATE_LIMITED", "Rate limit exceeded. Please wait before retrying.", retry_after=retry_after))

        # Simple payload guard (dragstart should be tiny).
        try:
            if request.content_length and int(request.content_length) > _MAX_REQUEST_BYTES:
                return _json_response(Result.Err("PAYLOAD_TOO_LARGE", "Payload too large"))
        except Exception:
            pass

        payload_res = await _read_json(request, max_bytes=_MAX_REQUEST_BYTES)
        if not payload_res.ok:
            return _json_response(payload_res)
        payload = payload_res.data or {}

        token = _sanitize_token((payload or {}).get("token"))
        items = (payload or {}).get("items") or []
        if not token:
            return _json_response(Result.Err("INVALID_INPUT", "Invalid token"))
        if not isinstance(items, list) or not items:
            return _json_response(Result.Err("INVALID_INPUT", "No items provided"))
        if len(items) > _MAX_ITEMS:
            return _json_response(Result.Err("INVALID_INPUT", f"Batch size exceeds limit ({_MAX_ITEMS})"))

        try:
            _BATCH_DIR.mkdir(parents=True, exist_ok=True)
        except Exception as exc:
            return _json_response(
                Result.Err("IO_ERROR", sanitize_error_message(exc, "Cannot create batch directory"))
            )

        _cleanup_batch_zips()

        token_lock = _get_token_lock(token)
        zip_path = (_BATCH_DIR / f".mjr_batch_{token}.zip").resolve()
        try:
            zip_path.relative_to(_BATCH_DIR.resolve(strict=True))
        except Exception:
            return _json_response(Result.Err("INVALID_INPUT", "Invalid zip path"))

        event = asyncio.Event()
        filename = f"Majoor_Batch_{len(items)}.zip"
        with _BATCH_LOCK:
            _BATCH_CACHE[token] = {
                "path": zip_path,
                "event": event,
                "ready": False,
                "created_at": time.time(),
                "filename": filename,
            }

        def _build_zip() -> int:
            with token_lock:
                try:
                    if zip_path.exists():
                        zip_path.unlink()
                except Exception:
                    pass

                count = 0
                used_names = set()
                with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
                    for raw in items:
                        if not isinstance(raw, dict):
                            continue
                        target = _resolve_item_path(raw)
                        if not target:
                            continue

                        # Flatten: never include subfolders in the ZIP. This matches drag-out UX
                        # expectations (a simple bundle of files).
                        arc_name_rel = _safe_rel_path(str(raw.get("filename") or ""))
                        if not arc_name_rel or len(arc_name_rel.parts) != 1:
                            arc_name_rel = Path(target.name)

                        arc_base = arc_name_rel.name or target.name
                        arc_base = arc_base.replace("\x00", "").replace("\r", "").replace("\n", "")
                        arc_base = arc_base.replace("/", "_").replace("\\", "_")
                        if not arc_base:
                            arc_base = target.name

                        # Avoid collisions when multiple folders contain the same filename.
                        stem = Path(arc_base).stem
                        suffix = Path(arc_base).suffix
                        if not stem and suffix:
                            stem = arc_base[: -len(suffix)] or arc_base
                        candidate = arc_base[:_ZIP_NAME_MAX_LEN]
                        if candidate in used_names:
                            n = 2
                            while True:
                                attempt = f"{stem} ({n}){suffix}" if suffix else f"{stem} ({n})"
                                attempt = attempt[:_ZIP_NAME_MAX_LEN]
                                if attempt not in used_names:
                                    candidate = attempt
                                    break
                                n += 1
                        used_names.add(candidate)

                        arc = candidate
                        try:
                            ok = _zip_add_file_open_handle(zf, target, arc)
                            if ok:
                                count += 1
                        except Exception:
                            continue
                return count

        def _zip_add_file_open_handle(zf: zipfile.ZipFile, path: Path, arcname: str) -> bool:
            """
            Avoid TOCTOU by opening the file once and streaming bytes into the zip entry.

            Using `ZipFile.write(path)` re-opens the file by name, which can race with
            rename/replace between checks and reads.
            """
            try:
                arc = str(arcname or "").replace("\x00", "")[:_ZIP_NAME_MAX_LEN]
                if not arc:
                    arc = path.name[:_ZIP_NAME_MAX_LEN]
            except Exception:
                arc = path.name[:_ZIP_NAME_MAX_LEN]

            try:
                with open(path, "rb") as f:
                    try:
                        st = os.fstat(f.fileno())
                    except Exception:
                        st = path.stat()

                    try:
                        dt = time.localtime(float(getattr(st, "st_mtime", time.time())))
                        date_time = tuple(int(x) for x in dt[:6])
                    except Exception:
                        date_time = time.localtime(time.time())[:6]

                    zi = zipfile.ZipInfo(filename=arc, date_time=date_time)
                    zi.compress_type = zipfile.ZIP_DEFLATED
                    try:
                        zi.file_size = int(getattr(st, "st_size", 0) or 0)
                    except Exception:
                        pass

                    with zf.open(zi, "w") as out:
                        while True:
                            chunk = f.read(_ZIP_COPY_CHUNK_BYTES)
                            if not chunk:
                                break
                            out.write(chunk)
                return True
            except Exception:
                return False

        ok = False
        error = None
        count = 0
        try:
            try:
                count = await asyncio.wait_for(asyncio.to_thread(_build_zip), timeout=_BUILD_TIMEOUT_S)
            except asyncio.TimeoutError:
                count = 0
                error = "Batch zip build timed out"
            ok = count > 0
            if not ok:
                error = "No valid files to archive"
        except Exception as exc:
            error = sanitize_error_message(exc, "Batch zip creation failed")

        with _BATCH_LOCK:
            entry = _BATCH_CACHE.get(token)
            if entry:
                entry["ready"] = ok
                entry["error"] = error
                entry["count"] = count
                try:
                    entry["event"].set()
                except Exception:
                    pass

        if not ok:
            try:
                if zip_path.exists():
                    zip_path.unlink()
            except Exception:
                pass

        if ok:
            return _json_response(Result.Ok({"token": token, "count": count, "filename": filename}))
        return _json_response(Result.Err("NO_VALID_FILES", error or "No valid files to archive", token=token, count=count, filename=filename))

    @routes.get("/mjr/am/batch-zip/{token}")
    async def get_batch_zip(request: web.Request) -> web.StreamResponse:
        token = _sanitize_token(request.match_info.get("token"))
        if not token:
            return _json_response(Result.Err("INVALID_INPUT", "Invalid token"), status=404)

        _cleanup_batch_zips()

        with _BATCH_LOCK:
            entry = _BATCH_CACHE.get(token)

        if not entry:
            return _json_response(Result.Err("NOT_FOUND", "Not found"), status=404)

        event = entry.get("event")
        if isinstance(event, asyncio.Event) and not entry.get("ready"):
            try:
                await asyncio.wait_for(event.wait(), timeout=15.0)
            except asyncio.TimeoutError:
                return _json_response(Result.Err("NOT_READY", "Zip not ready"), status=404)
            except Exception:
                return _json_response(Result.Err("NOT_READY", "Zip not ready"), status=404)

        with _BATCH_LOCK:
            entry = _BATCH_CACHE.get(token)
        if not entry or not entry.get("ready"):
            err = str((entry or {}).get("error") or "Not ready")
            return _json_response(Result.Err("NOT_READY", err), status=404)

        path = entry.get("path")
        if not isinstance(path, Path) or not path.exists():
            return _json_response(Result.Err("NOT_FOUND", "File missing"), status=404)

        name = entry.get("filename") or f"{token}.zip"
        safe_name = str(name).replace('"', "").replace("\r", "").replace("\n", "")[:_ZIP_NAME_MAX_LEN]
        headers = {"Content-Disposition": f'attachment; filename="{safe_name}"'}
        try:
            return web.FileResponse(path, headers=headers)
        except Exception as exc:
            logger.debug("FileResponse failed: %s", exc)
            return _json_response(Result.Err("IO_ERROR", "Failed to serve zip"), status=500)
