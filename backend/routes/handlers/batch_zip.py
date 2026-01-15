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
from backend.shared import Result, get_logger
from backend.routes.core.paths import _is_within_root, _safe_rel_path
from backend.routes.core.response import _json_response
from backend.routes.core.security import _check_rate_limit, _csrf_error

try:
    import folder_paths  # type: ignore
except Exception:
    folder_paths = None  # type: ignore

logger = get_logger(__name__)

_BATCH_DIR = OUTPUT_ROOT_PATH / "_mjr_batch_zips"
_BATCH_LOCK = threading.Lock()
_BATCH_CACHE: Dict[str, Dict[str, Any]] = {}

_BATCH_TTL_SECONDS = int(os.environ.get("MAJOOR_BATCH_ZIP_TTL_SECONDS", "300"))  # 5 minutes
_BATCH_MAX = int(os.environ.get("MAJOOR_BATCH_ZIP_MAX", "50"))
_MAX_ITEMS = int(os.environ.get("MAJOOR_MAX_BATCH_SIZE", "1000"))


def _sanitize_token(token: Any) -> str:
    raw = str(token or "").strip()
    if not raw:
        return ""
    if len(raw) > 200:
        return ""
    allowed = []
    for ch in raw:
        if ch.isalnum() or ch in ("_", "-"):
            allowed.append(ch)
    out = "".join(allowed)
    if not out:
        return ""
    # Prevent trivially-guessable tokens (very short / enumerable).
    if len(out) < 16:
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
            if isinstance(path, Path):
                try:
                    if path.exists():
                        path.unlink()
                except Exception:
                    pass

        # Cap cache size in case of unexpected usage.
        if len(_BATCH_CACHE) > _BATCH_MAX:
            items = sorted(_BATCH_CACHE.items(), key=lambda kv: float(kv[1].get("created_at") or 0))
            to_drop = items[: max(0, len(items) - _BATCH_MAX)]
            for token, entry in to_drop:
                _BATCH_CACHE.pop(token, None)
                path = entry.get("path") if isinstance(entry, dict) else None
                if isinstance(path, Path):
                    try:
                        if path.exists():
                            path.unlink()
                    except Exception:
                        pass


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
    @routes.post("/mjr/am/batch-zip")
    async def create_batch_zip(request: web.Request) -> web.Response:
        csrf = _csrf_error(request)
        if csrf:
            return _json_response(Result.Err("CSRF", csrf))

        allowed, retry_after = _check_rate_limit(request, "batch_zip_create", max_requests=30, window_seconds=60)
        if not allowed:
            return _json_response(Result.Err("RATE_LIMITED", "Rate limit exceeded. Please wait before retrying.", retry_after=retry_after))

        # Simple payload guard (dragstart should be tiny).
        try:
            if request.content_length and int(request.content_length) > 5 * 1024 * 1024:
                return _json_response(Result.Err("PAYLOAD_TOO_LARGE", "Payload too large"))
        except Exception:
            pass

        try:
            payload = await request.json()
        except Exception as exc:
            return _json_response(Result.Err("INVALID_JSON", f"Invalid JSON body: {exc}"))

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
            return _json_response(Result.Err("IO_ERROR", f"Cannot create batch directory: {exc}"))

        _cleanup_batch_zips()

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
                    candidate = arc_base[:255]
                    if candidate in used_names:
                        n = 2
                        while True:
                            attempt = f"{stem} ({n}){suffix}" if suffix else f"{stem} ({n})"
                            attempt = attempt[:255]
                            if attempt not in used_names:
                                candidate = attempt
                                break
                            n += 1
                    used_names.add(candidate)

                    arc = candidate
                    try:
                        zf.write(str(target), arc)
                        count += 1
                    except Exception:
                        continue
            return count

        ok = False
        error = None
        count = 0
        try:
            count = await asyncio.to_thread(_build_zip)
            ok = count > 0
            if not ok:
                error = "No valid files to archive"
        except Exception as exc:
            error = str(exc)

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
        safe_name = str(name).replace('"', "").replace("\r", "").replace("\n", "")[:255]
        headers = {"Content-Disposition": f'attachment; filename="{safe_name}"'}
        try:
            return web.FileResponse(path, headers=headers)
        except Exception as exc:
            logger.debug("FileResponse failed: %s", exc)
            return _json_response(Result.Err("IO_ERROR", "Failed to serve zip"), status=500)
