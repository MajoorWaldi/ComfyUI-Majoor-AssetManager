import os
import sys
import subprocess
import asyncio
import time
import threading
import shutil
import platform
import concurrent.futures
import json
import re
import zipfile
import math
from pathlib import Path
from typing import Any, Dict, List, Optional
from functools import wraps

try:
    from send2trash import send2trash  # type: ignore
except Exception:
    send2trash = None

from aiohttp import web

import folder_paths
from server import PromptServer
from .logger import get_logger
from .utils import (
    IMAGE_EXTS,
    VIDEO_EXTS,
    AUDIO_EXTS,
    MODEL3D_EXTS,
    classify_ext,
    get_system_metadata,
    load_metadata,
    save_metadata,
    metadata_path,
    _get_exiftool_path,
)
from .metadata import update_metadata_with_windows, deep_merge_metadata
from .metadata_generation import extract_generation_params_from_png, has_generation_workflow
from .config import OUTPUT_ROOT, ENABLE_JSON_SIDECAR, METADATA_EXT
from .collections_store import (
    get_collections,
    load_collection,
    add_to_collection,
    remove_from_collection,
)

log = get_logger(__name__)


def handle_connection_reset(func):
    """
    Decorator to handle ConnectionResetError consistently across endpoints.
    Returns HTTP 499 (Client Closed Request) when connection is reset.
    """
    @wraps(func)
    async def wrapper(*args, **kwargs):
        try:
            return await func(*args, **kwargs)
        except ConnectionResetError:
            return web.Response(status=499)
    return wrapper


def _json_sanitize(obj: Any) -> Any:
    """
    Ensure objects are JSON-safe and strict-JSON compliant.
    Python's json.dumps allows NaN/Infinity by default, but browsers reject them.
    """
    if obj is None:
        return None
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, (bytes, bytearray)):
        try:
            return bytes(obj).decode("utf-8", errors="replace")
        except (UnicodeDecodeError, AttributeError) as e:
            log.debug("[Majoor] Failed to decode bytes: %s", e)
            return repr(obj)
    if isinstance(obj, Path):
        return str(obj)
    if isinstance(obj, dict):
        out: Dict[str, Any] = {}
        for k, v in obj.items():
            try:
                key = str(k)
            except (TypeError, ValueError) as e:
                log.debug("[Majoor] Failed to convert key to string: %s", e)
                key = repr(k)
            out[key] = _json_sanitize(v)
        return out
    if isinstance(obj, (list, tuple, set)):
        return [_json_sanitize(v) for v in obj]
    return obj


def _json_response(data: Any, status: int = 200) -> web.Response:
    cleaned = _json_sanitize(data)
    return web.json_response(
        cleaned,
        status=status,
        dumps=lambda x: json.dumps(x, ensure_ascii=False, allow_nan=False),
    )


async def _validate_payload_size(request: web.Request, max_size_mb: float = 10.0) -> Optional[web.Response]:
    """
    Validate request payload size to prevent DoS attacks.
    Returns error response if payload exceeds limit, None otherwise.
    """
    content_length = request.content_length
    if content_length is not None:
        max_bytes = int(max_size_mb * 1024 * 1024)
        if content_length > max_bytes:
            return _json_response(
                {"ok": False, "error": f"Payload too large (max {max_size_mb}MB)"},
                status=413
            )
    return None


# ---------------------------------------------------------------------------
# File Request Validation Helpers (reduces code duplication)
# ---------------------------------------------------------------------------

async def _parse_json_payload(request: web.Request) -> tuple[Optional[dict], Optional[web.Response]]:
    """
    Parse JSON payload with proper error handling.
    Returns (payload_dict, error_response). If error_response is not None, return it immediately.
    """
    try:
        payload = await request.json()
        return (payload, None)
    except json.JSONDecodeError as e:
        return (None, _json_response(
            {"ok": False, "error": f"Invalid JSON: {str(e)}"},
            status=400
        ))
    except Exception as e:
        return (None, _json_response(
            {"ok": False, "error": f"Failed to parse request: {str(e)}"},
            status=400
        ))


def _validate_file_path(root: Path, filename: str, subfolder: str = "") -> tuple[Optional[Path], Optional[dict]]:
    """
    Validate and construct safe file path.
    Returns (path, error_dict). If error_dict is not None, return error response.

    Common validation pattern used across multiple endpoints.
    """
    if not filename:
        return (None, {"ok": False, "error": "Missing filename"})

    try:
        target = _safe_target(root, subfolder, filename)
    except ValueError as e:
        return (None, {"ok": False, "error": f"Invalid path: {str(e)}"})

    if not target.exists():
        return (None, {"ok": False, "error": "File not found"})

    return (target, None)


# ---------------------------------------------------------------------------
# In-memory cache for output listing
# Avoids redoing a full os.scandir on every auto-refresh.
# ---------------------------------------------------------------------------

_FILE_CACHE: List[Dict[str, Any]] = []
_LAST_SCAN_TS: float = 0.0
_LAST_FOLDER_MTIME: float = 0.0
_LAST_FOLDER_SIGNATURE: Optional[tuple] = None
_LAST_FOLDER_CHECK_TS: float = 0.0  # Cache folder signature checks
_BATCH_ZIP_CACHE: Dict[str, Dict[str, Any]] = {}
_BATCH_ZIP_LOCK = threading.Lock()
_BATCH_ZIP_MAX_AGE_S = 3600.0

try:
    _SCAN_MIN_INTERVAL = float(os.environ.get("MJR_SCAN_MIN_INTERVAL", "5.0"))
except (ValueError, TypeError) as e:
    log.warning("[Majoor] Invalid MJR_SCAN_MIN_INTERVAL, using default: %s", e)
    _SCAN_MIN_INTERVAL = 5.0

try:
    _FOLDER_CHECK_INTERVAL = float(os.environ.get("MJR_FOLDER_CHECK_INTERVAL", "2.0"))
except (ValueError, TypeError) as e:
    log.warning("[Majoor] Invalid MJR_FOLDER_CHECK_INTERVAL, using default: %s", e)
    _FOLDER_CHECK_INTERVAL = 2.0

try:
    _META_PREFETCH_COUNT = int(os.environ.get("MJR_META_PREFETCH_COUNT", "80"))
    if _META_PREFETCH_COUNT < 0:
        _META_PREFETCH_COUNT = 0
except (ValueError, TypeError) as e:
    log.warning("[Majoor] Invalid MJR_META_PREFETCH_COUNT, using default: %s", e)
    _META_PREFETCH_COUNT = 80

_CACHE_LOCK = threading.Lock()

_ASYNCIO_SILENCER_INSTALLED = False
_ASYNCIO_SILENCER_LOCK = threading.Lock()

# Windows reserved filenames (security constant)
_WINDOWS_RESERVED_NAMES = frozenset({
    "CON", "PRN", "AUX", "NUL",
    "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"
})


def _install_windows_asyncio_connection_reset_silencer() -> None:
    """
    On Windows, aborted HTTP requests can produce noisy asyncio logs like:
    "Exception in callback _ProactorBasePipeTransport._call_connection_lost()"
    with ConnectionResetError([WinError 10054]).

    This does not affect correctness, but it can confuse users and pollute logs.

    FIX: Use lock to prevent race condition during handler installation.
    """
    global _ASYNCIO_SILENCER_INSTALLED

    # Fast path: already installed
    if _ASYNCIO_SILENCER_INSTALLED:
        return

    # Non-Windows fast path
    if sys.platform != "win32":
        with _ASYNCIO_SILENCER_LOCK:
            _ASYNCIO_SILENCER_INSTALLED = True
        return

    # Lock to prevent concurrent installation
    with _ASYNCIO_SILENCER_LOCK:
        # Double-check after acquiring lock
        if _ASYNCIO_SILENCER_INSTALLED:
            return

        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return

        previous = loop.get_exception_handler()

        def _handler(loop: asyncio.AbstractEventLoop, context: Dict[str, Any]) -> None:
            exc = context.get("exception")
            msg = context.get("message") or ""
            if (
                isinstance(exc, ConnectionResetError)
                and getattr(exc, "winerror", None) == 10054
                and "_call_connection_lost" in str(msg)
            ):
                return

            if previous:
                previous(loop, context)
            else:
                loop.default_exception_handler(context)

        loop.set_exception_handler(_handler)
        _ASYNCIO_SILENCER_INSTALLED = True


def _sanitize_batch_token(token: Optional[str]) -> Optional[str]:
    if token is None:
        return None
    token = str(token).strip()
    if not token:
        return None
    if not re.match(r"^[A-Za-z0-9_-]{6,80}$", token):
        return None
    return token


def _cleanup_batch_zips(root: Path) -> None:
    now = time.time()
    with _BATCH_ZIP_LOCK:
        for token, info in list(_BATCH_ZIP_CACHE.items()):
            created_at = float(info.get("created_at") or 0)
            if now - created_at <= _BATCH_ZIP_MAX_AGE_S:
                continue
            path = info.get("path")
            try:
                if isinstance(path, Path) and path.exists():
                    path.unlink()
            except (OSError, PermissionError) as e:
                log.debug("[Majoor] Failed to delete batch zip cache file: %s", e)
            _BATCH_ZIP_CACHE.pop(token, None)


def _folder_changed(root_path: Path) -> bool:
    """
    Quick check if folder changed (file added/modified).
    Uses a two-tier caching strategy:
    1. Check root mtime (fast)
    2. If unchanged, cache signature check for _FOLDER_CHECK_INTERVAL seconds
    """
    global _LAST_FOLDER_MTIME, _LAST_FOLDER_SIGNATURE, _LAST_FOLDER_CHECK_TS
    try:
        current_mtime = root_path.stat().st_mtime
        if current_mtime != _LAST_FOLDER_MTIME:
            _LAST_FOLDER_MTIME = current_mtime
            _LAST_FOLDER_SIGNATURE = None  # force recompute
            _LAST_FOLDER_CHECK_TS = 0.0
            return True

        # If we recently checked the signature and it was unchanged, skip rechecking
        now = time.time()
        if _LAST_FOLDER_SIGNATURE is not None and (now - _LAST_FOLDER_CHECK_TS) < _FOLDER_CHECK_INTERVAL:
            return False

        # Fallback signature (top-level dirs/files count + max mtime)
        def _signature():
            total = 0
            max_m = current_mtime
            sub_sig = []
            try:
                with os.scandir(root_path) as it:
                    for entry in it:
                        try:
                            st = entry.stat()
                            max_m = max(max_m, st.st_mtime)
                        except Exception:
                            continue
                        total += 1
                        if entry.is_dir():
                            try:
                                with os.scandir(entry.path) as sub:
                                    sub_count = sum(1 for _ in sub)
                                sub_sig.append((entry.name, st.st_mtime, sub_count))
                            except (OSError, PermissionError):
                                # Subdirectory inaccessible, use None for count
                                sub_sig.append((entry.name, st.st_mtime, None))
                        else:
                            sub_sig.append((entry.name, st.st_mtime, None))
            except (OSError, PermissionError) as e:
                log.debug("[Majoor] Failed to read folder entry during signature: %s", e)
                return None
            sub_sig.sort()
            return (total, max_m, tuple(sub_sig))

        sig = _signature()
        _LAST_FOLDER_CHECK_TS = now
        if sig is None:
            return True
        if sig != _LAST_FOLDER_SIGNATURE:
            _LAST_FOLDER_SIGNATURE = sig
            return True
        return False
    except (OSError, PermissionError, AttributeError) as e:
        log.debug("[Majoor] Error checking folder changes: %s", e)
        return True  # Assume changed on error


def _get_output_root() -> Path:
    """Use the ComfyUI output folder (respects --output-directory)."""
    return Path(folder_paths.get_output_directory()).resolve()


def _safe_target(root: Path, subfolder: str, filename: str) -> Path:
    """
    Build a path under root while rejecting traversal/absolute components.
    - filename must be a plain name (no separators)
    - subfolder must be relative and free of '..'
    - Additional security checks for null bytes, suspicious patterns, ADS, UNC paths

    FIX: Added UNC path detection to prevent bypassing is_absolute() check
    """
    if not filename:
        raise ValueError("Missing filename")

    # Security: Reject null bytes (path truncation attacks)
    if "\x00" in filename or (subfolder and "\x00" in subfolder):
        raise ValueError("Null byte in path")

    # Security: Reject UNC paths (\\server\share or //server/share)
    if (filename.startswith("\\\\") or filename.startswith("//") or
        (subfolder and (subfolder.startswith("\\\\") or subfolder.startswith("//")))):
        raise ValueError("UNC paths not allowed")

    # Security: Reject Windows Alternate Data Streams (ADS)
    if sys.platform == "win32":
        if ":" in filename or (subfolder and ":" in subfolder):
            # Allow drive letters in absolute paths but reject in filenames
            if not (len(filename) == 2 and filename[1] == ":"):
                raise ValueError("Invalid path: Alternate Data Streams not allowed")

    # Security: Reject suspicious path components
    if Path(filename).name != filename:
        raise ValueError("Invalid filename")

    # Security: Check for Windows reserved names
    base_name = filename.split('.')[0].upper()
    if base_name in _WINDOWS_RESERVED_NAMES:
        raise ValueError("Invalid filename: Windows reserved name")

    sub = Path(subfolder) if subfolder else Path()
    if sub.is_absolute() or any(part == ".." for part in sub.parts):
        raise ValueError("Invalid subfolder")

    # Security: Additional check for current directory references
    if any(part == "." for part in sub.parts):
        raise ValueError("Invalid subfolder: current directory reference")

    candidate = (root / sub / filename).resolve()

    # Security: Verify resolved path is under root (prevents symlink escapes)
    try:
        candidate.relative_to(root)
    except ValueError:
        raise ValueError("Path outside root directory")

    # Security: Double-check no intermediate symlinks escape root (defense in depth)
    if platform.system() != "Windows":  # Only applicable to Unix-like systems
        # Walk up the path and verify no symlinks point outside root
        check_path = candidate
        while check_path != root:
            if check_path.is_symlink():
                real_target = check_path.readlink()
                if real_target.is_absolute():
                    try:
                        real_target.resolve().relative_to(root)
                    except ValueError:
                        raise ValueError("Symlink points outside root directory")
            check_path = check_path.parent
            if check_path == check_path.parent:  # Reached filesystem root
                break

    return candidate


_STAGE_VIDEO_EXTS = {"mp4", "mov", "mkv", "webm"}


def _is_allowed_video_filename(filename: str) -> bool:
    try:
        ext = Path(filename).suffix.lower().lstrip(".")
    except Exception:
        return False
    return ext in _STAGE_VIDEO_EXTS


def _resolve_stage_collision(
    dest_dir: Path, filename: str, collision_policy: str
) -> tuple[Path, str, str]:
    """
    Returns (dest_path, final_filename, collision_state).
    collision_state is one of: "none", "renamed", "overwritten".
    """
    collision_policy = (collision_policy or "rename").lower().strip()
    if collision_policy not in ("rename", "overwrite", "error"):
        raise ValueError("Invalid collision_policy")

    dest = (dest_dir / filename).resolve()
    dest.relative_to(dest_dir)  # safety guard

    if not dest.exists():
        return dest, filename, "none"

    if collision_policy == "overwrite":
        return dest, filename, "overwritten"

    if collision_policy == "error":
        raise FileExistsError("Destination exists")

    base = Path(filename).stem
    suffix = Path(filename).suffix
    for i in range(1, 10000):
        candidate_name = f"{base}_{i:03d}{suffix}"
        candidate = (dest_dir / candidate_name).resolve()
        candidate.relative_to(dest_dir)
        if not candidate.exists():
            return candidate, candidate_name, "renamed"

    raise RuntimeError("Failed to generate a unique filename")


def _rating_tags_with_fallback(meta_target: Path, kind: str, _cache: Optional[dict] = None) -> tuple[int, List[str]]:
    """
    Read rating/tags for a file, and for videos optionally fall back to a PNG sibling sidecar
    when both rating and tags are missing.

    FIX: Added optional request-scoped cache parameter to prevent redundant reads within same request.
    Pass a dict as _cache to enable caching for the request lifecycle.
    """
    # Check request-scoped cache first
    if _cache is not None:
        cache_key = str(meta_target)
        if cache_key in _cache:
            return _cache[cache_key]
    sys_meta = get_system_metadata(str(meta_target)) or {}
    json_meta = load_metadata(str(meta_target)) or {}

    rating = sys_meta["rating"] if "rating" in sys_meta else json_meta.get("rating")
    tags = sys_meta["tags"] if "tags" in sys_meta else json_meta.get("tags")

    sys_empty = not sys_meta
    json_empty = not json_meta
    emptyish_rating = rating is None or rating == 0
    emptyish_tags = tags is None or tags == []

    if kind == "video" and sys_empty and json_empty and emptyish_rating and emptyish_tags:
        try:
            sib_png = meta_target.with_suffix(".png")
            sib_json = load_metadata(str(sib_png)) or {}
            if rating is None:
                r = sib_json.get("rating")
                if isinstance(r, int):
                    rating = r
            if tags is None:
                t = sib_json.get("tags")
                if isinstance(t, list):
                    tags = t
        except Exception:
            pass

    if rating is None:
        rating = 0
    if tags is None:
        tags = []

    result = (rating, tags if isinstance(tags, list) else [])

    # Store in request-scoped cache
    if _cache is not None:
        _cache[cache_key] = result

    return result


def _open_in_explorer(path: Path) -> bool:
    """Open Windows Explorer selecting the given file."""
    try:
        try:
            fm_timeout = float(os.environ.get("MJR_FILE_MANAGER_TIMEOUT", "15"))
        except Exception:
            fm_timeout = 15.0
        fm_timeout = max(1.0, min(fm_timeout, 60.0))
        start_cmd = f'start "" explorer.exe /select,"{str(path)}"'
        res_start = subprocess.run(
            start_cmd,
            shell=True,
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=fm_timeout,
        )
        if res_start.returncode in (0, 1):
            return True

        cmd = f'explorer.exe /select,"{str(path)}"'
        res = subprocess.run(
            cmd,
            shell=True,
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=fm_timeout,
        )
        if res.returncode in (0, 1):
            return True

        res2 = subprocess.run(
            ["explorer.exe", "/select,", str(path)],
            shell=False,
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=fm_timeout,
        )
        return res2.returncode in (0, 1)
    except Exception:
        return False


def _open_in_file_manager(path: Path) -> tuple[bool, Optional[str]]:
    """
    Open the OS file manager for a given path.
    - Windows: Explorer with selection when possible.
    - macOS: Finder with selection via `open -R`.
    - Linux: open the containing folder via xdg-open/gio/kde-open.
    Returns: (ok, warning_message)
    """
    try:
        system = platform.system()
        is_file = path.is_file()
        folder = path.parent if is_file else path
        try:
            fm_timeout = float(os.environ.get("MJR_FILE_MANAGER_TIMEOUT", "15"))
        except Exception:
            fm_timeout = 15.0
        fm_timeout = max(1.0, min(fm_timeout, 60.0))

        def _run(cmd: List[str]) -> int:
            return subprocess.run(
                cmd,
                shell=False,
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=fm_timeout,
            ).returncode

        if system == "Windows":
            if is_file and _open_in_explorer(path):
                return True, None
            rc = _run(["explorer.exe", str(folder)])
            if rc in (0, 1):
                return True, ("Opened folder (selection may not be highlighted)" if is_file else None)
            return False, f"explorer.exe failed (code {rc})"

        if system == "Darwin":
            if is_file:
                rc = _run(["open", "-R", str(path)])
                if rc == 0:
                    return True, None
                rc2 = _run(["open", str(folder)])
                if rc2 == 0:
                    return True, "Opened folder (selection may not be highlighted)"
                return False, f"open failed (code {rc2})"
            rc = _run(["open", str(folder)])
            return (rc == 0), (None if rc == 0 else f"open failed (code {rc})")

        # Linux / other
        opener = None
        for candidate in ("xdg-open", "gio", "kde-open5", "kde-open", "gnome-open", "exo-open"):
            if shutil.which(candidate):
                opener = candidate
                break
        if not opener:
            return False, "No supported opener found (xdg-open/gio/kde-open/gnome-open)"

        if opener == "gio":
            rc = _run([opener, "open", str(folder)])
        else:
            rc = _run([opener, str(folder)])
        if rc == 0:
            return True, ("Opened folder (selection may not be supported on this OS)" if is_file else None)
        return False, f"{opener} failed (code {rc})"
    except Exception as exc:
        return False, str(exc)


def _format_size(num_bytes: int) -> str:
    if not isinstance(num_bytes, (int, float)) or num_bytes < 0:
        return ""
    units = ["B", "KB", "MB", "GB", "TB"]
    value = float(num_bytes)
    i = 0
    while value >= 1024.0 and i < len(units) - 1:
        value /= 1024.0
        i += 1
    if value >= 10:
        return f"{value:.1f} {units[i]}"
    return f"{value:.2f} {units[i]}"


def _format_date(ts: float) -> str:
    from datetime import datetime

    try:
        return datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M")
    except Exception:
        return ""


def _build_view_url(filename: str, subfolder: str) -> str:
    from urllib.parse import urlencode

    params = {"filename": filename, "type": "output"}
    if subfolder:
        params["subfolder"] = subfolder
    return f"/view?{urlencode(params)}"


# ---------------------------------------------------------------------------
# OPTIMIZED SCANNING LOGIC (os.scandir)
# ---------------------------------------------------------------------------

def _scan_folder_recursive(base_path: str, subfolder: str, results: List[Dict[str, Any]]):
    """
    Recursive scanner using os.scandir for performance.
    - Avoids Path object creation in the hot loop.
    - Uses entry.stat() which is cached on Windows.
    """
    try:
        with os.scandir(base_path) as it:
            for entry in it:
                if entry.is_dir():
                    if not entry.name.startswith("."):
                        new_sub = os.path.join(subfolder, entry.name) if subfolder else entry.name
                        _scan_folder_recursive(entry.path, new_sub, results)
                elif entry.is_file():
                    try:
                        name = entry.name
                        lower = name.lower()
                        kind = classify_ext(lower)
                        if kind == "other":
                            continue

                        stat = entry.stat()
                        mtime = stat.st_mtime
                        size = stat.st_size

                        # FIX: Convert mtime to milliseconds for frontend consistency
                        # Frontend expects milliseconds (JavaScript Date uses ms)
                        mtime_ms = int(mtime * 1000)

                        ext = (os.path.splitext(name)[1][1:] or "").upper()

                        rel_path = f"{subfolder}/{name}" if subfolder else name
                        rel_path = rel_path.replace("\\", "/")
                        sub_clean = subfolder.replace("\\", "/")

                        results.append({
                            "filename": name,
                            "name": name,
                            "subfolder": sub_clean,
                            "relpath": rel_path,
                            "mtime": mtime_ms,  # Send as milliseconds
                            "date": _format_date(mtime),
                            "size": size,
                            "size_readable": _format_size(size),
                            "kind": kind,
                            "ext": ext,
                            "url": _build_view_url(name, sub_clean),
                        })
                    except OSError:
                        continue
    except OSError:
        pass


def _scan_outputs() -> List[Dict[str, Any]]:
    """
    Entry point for the optimized scanner.
    """
    root = _get_output_root()
    files: List[Dict[str, Any]] = []

    if not root.exists():
        return files

    _scan_folder_recursive(str(root), "", files)

    files.sort(key=lambda f: f["mtime"], reverse=True)
    return files


def _scan_outputs_cached(force: bool = False) -> List[Dict[str, Any]]:
    """
    Wrapper around _scan_outputs with in-memory cache.
    Uses double-checked locking with proper atomic update to prevent race conditions.
    """
    global _FILE_CACHE, _LAST_SCAN_TS

    # Fast path: check without lock (read cache snapshot atomically)
    if not force:
        with _CACHE_LOCK:
            now = time.time()
            if _FILE_CACHE and (now - _LAST_SCAN_TS) < _SCAN_MIN_INTERVAL:
                # Return a copy to prevent external modifications
                return _FILE_CACHE

    # Slow path: acquire lock and recheck
    with _CACHE_LOCK:
        now = time.time()
        # Recheck after acquiring lock (another thread may have updated)
        if not force and _FILE_CACHE and (now - _LAST_SCAN_TS) < _SCAN_MIN_INTERVAL:
            return _FILE_CACHE

        root = _get_output_root()
        if not force and _FILE_CACHE and not _folder_changed(root):
            # Update timestamp even if folder hasn't changed (prevents repeated checks)
            _LAST_SCAN_TS = now
            return _FILE_CACHE

        # Perform scan and atomically update cache
        files = _scan_outputs()
        _FILE_CACHE = files
        _LAST_SCAN_TS = now
        return files


async def _scan_outputs_async(force: bool = False) -> List[Dict[str, Any]]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _scan_outputs_cached, force)


@PromptServer.instance.routes.get("/mjr/filemanager/files")
@handle_connection_reset
async def list_files(request: web.Request) -> web.Response:
    _install_windows_asyncio_connection_reset_silencer()
    force_param = (request.query.get("force") or "").lower()
    force = force_param in ("1", "true", "yes", "force")

    # Optional pagination
    # Backward-compatible: if no limit is provided, return the full list.
    try:
        offset = int(request.query.get("offset") or "0")
    except Exception:
        offset = 0
    try:
        limit_raw = request.query.get("limit")
        paged = limit_raw is not None
        limit = int(limit_raw) if limit_raw is not None else 0
    except Exception:
        paged = False
        limit = 0

    offset = max(0, offset)
    limit = max(0, limit)

    files = await _scan_outputs_async(force=force)
    total = len(files)

    items = files
    if limit > 0:
        items = files[offset : offset + limit]
    else:
        offset = 0
        limit = total

    has_more = (offset + len(items)) < total
    next_offset = (offset + len(items)) if has_more else None

    # Prefetch metadata for the first N items without delaying the response.
    # Only do this for the first paged request (offset=0, limit provided).
    # Uses asyncio.create_task for true non-blocking async execution.
    # FIX: Create deep copy of items to avoid race condition with cache modifications
    prefetch_count = min(len(items), _META_PREFETCH_COUNT) if (paged and offset == 0) else 0
    if prefetch_count > 0:
        root = _get_output_root()
        # Make a copy of items to prevent cache mutation race conditions
        import copy
        prefetch_items = copy.deepcopy(items[:prefetch_count])

        async def _prefetch_async():
            """Background task to prefetch metadata without blocking the response."""
            loop = asyncio.get_running_loop()

            def _prefetch_one(f, original_f):
                """Prefetch metadata and update original file dict with lock protection."""
                try:
                    filename = f.get("filename") or f.get("name")
                    subfolder = f.get("subfolder", "")
                    if not filename:
                        return
                    target = (root / subfolder / filename).resolve()
                    try:
                        target.relative_to(root)
                    except ValueError:
                        return
                    kind = f.get("kind") or classify_ext(filename.lower())
                    # FIX: Removed dead code - _metadata_target was a no-op that just returned target
                    if not target.exists():
                        return
                    rating, tags = _rating_tags_with_fallback(target, kind)
                    # Keep workflow dot accurate even when we mark __metaLoaded.
                    has_wf = False
                    if kind in ("image", "video"):
                        try:
                            has_wf = has_generation_workflow(meta_target)
                        except Exception:
                            has_wf = False

                    # Update original with lock to prevent race conditions
                    with _CACHE_LOCK:
                        original_f["rating"] = rating
                        original_f["tags"] = tags
                        original_f["has_workflow"] = has_wf
                        original_f["__metaLoaded"] = True
                except Exception:
                    pass

            # Process items in parallel batches with reference to original
            for idx, f in enumerate(prefetch_items):
                if idx < len(items):
                    await loop.run_in_executor(None, _prefetch_one, f, items[idx])

        # Schedule background task without blocking
        asyncio.create_task(_prefetch_async())

    return _json_response(
        {
            "files": items,
            "total": total,
            "offset": offset,
            "limit": limit,
            "has_more": has_more,
            "next_offset": next_offset,
        }
    )


@PromptServer.instance.routes.post("/mjr/filemanager/metadata/batch")
@handle_connection_reset
async def batch_metadata(request: web.Request) -> web.Response:
    _install_windows_asyncio_connection_reset_silencer()

    # Validate payload size
    size_error = await _validate_payload_size(request, max_size_mb=5.0)
    if size_error:
        return size_error

    root = _get_output_root()

    # FIX: Use specific exception types instead of bare except
    payload, error_response = await _parse_json_payload(request)
    if error_response:
        return error_response

    items = payload.get("items") or []

    # Validate request size to prevent DoS
    max_batch_size = int(os.environ.get("MJR_MAX_BATCH_SIZE", "1000"))
    if len(items) > max_batch_size:
        return _json_response(
            {"ok": False, "error": f"Batch size exceeds limit ({max_batch_size})"},
            status=400
        )

    loop = asyncio.get_running_loop()

    # FIX: Create request-scoped cache to prevent redundant metadata reads
    request_cache: Dict[str, tuple[int, List[str]]] = {}

    def _fetch_one(item: Dict[str, Any]) -> Dict[str, Any]:
        filename = (item or {}).get("filename")
        subfolder = (item or {}).get("subfolder", "")
        result: Dict[str, Any] = {"filename": filename, "subfolder": subfolder}

        if not filename:
            result["error"] = "Missing filename"
            return result

        try:
            target = _safe_target(root, subfolder, filename)
        except ValueError:
            result["error"] = "Outside output directory"
            return result

        if not target.exists():
            result["error"] = "Not found"
            return result

        kind = classify_ext(filename.lower())
        # FIX: Pass request-scoped cache to prevent redundant reads in batch
        rating, tags = _rating_tags_with_fallback(target, kind, _cache=request_cache)

        has_wf = False
        if kind in ("image", "video"):
            try:
                has_wf = has_generation_workflow(target)
            except Exception:
                has_wf = False

        result.update(
            {
                "rating": rating,
                "tags": tags,
                "has_workflow": has_wf,
            }
        )
        return result

    # Parallelize within the executor to avoid long serial batches
    results: List[Dict[str, Any]] = []
    errors: List[Dict[str, Any]] = []
    max_workers_env = os.environ.get("MJR_META_BATCH_WORKERS")
    try:
        max_workers_cfg = int(max_workers_env) if max_workers_env is not None else None
    except (ValueError, TypeError):
        max_workers_cfg = None
    max_workers = max(1, max_workers_cfg) if max_workers_cfg else 4

    # FIX: Track exceptions properly and log failures
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as pool:
        # Map futures to original items for better error reporting
        future_to_item = {pool.submit(_fetch_one, itm): itm for itm in items}

        for fut in concurrent.futures.as_completed(future_to_item):
            item = future_to_item[fut]
            try:
                res = fut.result()
                if res.get("error"):
                    errors.append({"filename": res.get("filename"), "error": res.get("error")})
                elif res.get("filename"):
                    results.append(res)
            except Exception as e:
                # Log the exception and add to errors instead of silently continuing
                filename = item.get("filename", "unknown")
                error_msg = f"Worker exception: {type(e).__name__}: {str(e)}"
                log.warning("[Majoor] Batch metadata worker failed for %s: %s", filename, error_msg)
                errors.append({"filename": filename, "error": error_msg})

    # Log summary if there were failures
    if errors:
        log.info("[Majoor] Batch metadata completed: %d success, %d errors", len(results), len(errors))

    return _json_response({"ok": True, "metadatas": results, "errors": errors})


@PromptServer.instance.routes.post("/mjr/filemanager/delete")
async def delete_files(request: web.Request) -> web.Response:
    # Validate payload size
    size_error = await _validate_payload_size(request, max_size_mb=2.0)
    if size_error:
        return size_error

    root = _get_output_root()

    try:
        payload = await request.json()
    except Exception:
        return _json_response({"ok": False, "error": "Invalid JSON body"}, status=400)

    items = payload.get("items") or []

    # Validate request size to prevent DoS
    max_batch_size = int(os.environ.get("MJR_MAX_BATCH_SIZE", "1000"))
    if len(items) > max_batch_size:
        return _json_response(
            {"ok": False, "error": f"Batch size exceeds limit ({max_batch_size})"},
            status=400
        )

    deleted = []
    errors = []

    for item in items:
        filename = (item or {}).get("filename")
        subfolder = (item or {}).get("subfolder", "")

        if not filename:
            continue

        try:
            candidate = _safe_target(root, subfolder, filename)
        except ValueError:
            errors.append(
                {
                    "filename": filename,
                    "subfolder": subfolder,
                    "error": "Outside output directory",
                }
            )
            continue

        if not candidate.exists():
            errors.append(
                {"filename": filename, "subfolder": subfolder, "error": "Not found"}
            )
            continue

        try:
            if send2trash:
                send2trash(str(candidate))
            else:
                log.warning(
                    "[Majoor.AssetsManager] send2trash unavailable; deleting permanently: %s",
                    candidate,
                )
                candidate.unlink()
            deleted.append({"filename": filename, "subfolder": subfolder})
        except Exception as exc:
            errors.append(
                {"filename": filename, "subfolder": subfolder, "error": str(exc)}
            )

    return _json_response({"ok": True, "deleted": deleted, "errors": errors})


@PromptServer.instance.routes.post("/mjr/filemanager/stage_to_input")
@handle_connection_reset
async def stage_to_input(request: web.Request) -> web.Response:
    """
    Stage a file from ComfyUI output to ComfyUI input for Drag & Drop workflows.
    Expected JSON payload:
      {
        "filename": "xxx.mp4",
        "subfolder": "optional/subfolder",
        "from_type": "output",
        "dest_subfolder": "_mjr_drop" | "",
        "collision_policy": "rename" | "overwrite" | "error"
      }
    """
    _install_windows_asyncio_connection_reset_silencer()
    try:
        payload = await request.json()
    except Exception:
        return _json_response({"ok": False, "error": "Invalid JSON body"}, status=400)

    filename = payload.get("filename")
    subfolder = payload.get("subfolder", "") or ""
    from_type = (payload.get("from_type") or "output").lower().strip()
    dest_subfolder = payload.get("dest_subfolder", None)
    if dest_subfolder is None:
        dest_subfolder = "_mjr_drop"
    else:
        dest_subfolder = str(dest_subfolder)
    collision_policy = payload.get("collision_policy", "rename") or "rename"

    if not filename:
        return _json_response({"ok": False, "error": "Missing filename"}, status=400)
    if Path(str(filename)).name != str(filename):
        return _json_response({"ok": False, "error": "Invalid filename"}, status=400)

    if from_type != "output":
        return _json_response({"ok": False, "error": "Unsupported from_type"}, status=400)

    if not _is_allowed_video_filename(str(filename)):
        return _json_response(
            {"ok": False, "error": "Unsupported video extension (mp4/mov/mkv/webm only)"},
            status=400,
        )

    output_root = _get_output_root()
    try:
        src = _safe_target(output_root, str(subfolder), str(filename))
    except ValueError:
        return _json_response({"ok": False, "error": "File is outside output directory"}, status=400)

    if not src.exists() or not src.is_file():
        return _json_response({"ok": False, "error": "File not found"}, status=404)

    input_root = Path(folder_paths.get_input_directory()).resolve()

    dest_sub = Path(str(dest_subfolder)) if dest_subfolder else Path()
    if dest_sub.is_absolute() or any(part == ".." for part in dest_sub.parts):
        return _json_response({"ok": False, "error": "Invalid dest_subfolder"}, status=400)

    try:
        dest_dir = (input_root / dest_sub).resolve()
        dest_dir.relative_to(input_root)
    except Exception:
        return _json_response({"ok": False, "error": "Destination is outside input directory"}, status=400)

    try:
        os.makedirs(dest_dir, exist_ok=True)
    except Exception as exc:
        return _json_response({"ok": False, "error": str(exc)}, status=500)

    try:
        dest_path, staged_name, collision = _resolve_stage_collision(
            dest_dir, str(filename), str(collision_policy)
        )
    except FileExistsError:
        return _json_response({"ok": False, "error": "Destination file exists"}, status=409)
    except ValueError as exc:
        return _json_response({"ok": False, "error": str(exc)}, status=400)
    except Exception as exc:
        return _json_response({"ok": False, "error": str(exc)}, status=500)

    try:
        # Check disk space before copying
        src_size = src.stat().st_size
        dest_stat = shutil.disk_usage(dest_path.parent)
        available_space = dest_stat.free

        # Require at least 100MB buffer beyond file size
        required_space = src_size + (100 * 1024 * 1024)
        if available_space < required_space:
            return _json_response(
                {
                    "ok": False,
                    "error": f"Insufficient disk space ({available_space / 1024 / 1024:.1f}MB available, {required_space / 1024 / 1024:.1f}MB required)"
                },
                status=507  # HTTP 507 Insufficient Storage
            )

        shutil.copy2(src, dest_path)
    except OSError as exc:
        # Handle specific OS errors with better messages
        if exc.errno == 28:  # ENOSPC - No space left on device
            return _json_response(
                {"ok": False, "error": "Disk full: No space left on device"},
                status=507
            )
        elif exc.errno == 122:  # EDQUOT - Disk quota exceeded
            return _json_response(
                {"ok": False, "error": "Disk quota exceeded"},
                status=507
            )
        return _json_response({"ok": False, "error": f"File operation failed: {exc}"}, status=500)
    except Exception as exc:
        return _json_response({"ok": False, "error": str(exc)}, status=500)

    rel = (dest_sub / staged_name).as_posix() if dest_subfolder else staged_name
    return _json_response(
        {
            "ok": True,
            "filename": staged_name,
            "relative_path": rel,
            "dest_subfolder": str(dest_subfolder),
            "collision": collision,
        }
    )


@PromptServer.instance.routes.post("/mjr/filemanager/batch_zip")
async def create_batch_zip(request: web.Request) -> web.Response:
    size_error = await _validate_payload_size(request, max_size_mb=5.0)
    if size_error:
        return size_error

    try:
        payload = await request.json()
    except Exception:
        return _json_response({"ok": False, "error": "Invalid JSON body"}, status=400)

    token = _sanitize_batch_token(payload.get("token"))
    items = payload.get("items") or []
    if not token:
        return _json_response({"ok": False, "error": "Invalid token"}, status=400)
    if not isinstance(items, list) or not items:
        return _json_response({"ok": False, "error": "No items provided"}, status=400)

    max_batch_size = int(os.environ.get("MJR_MAX_BATCH_SIZE", "1000"))
    if len(items) > max_batch_size:
        return _json_response(
            {"ok": False, "error": f"Batch size exceeds limit ({max_batch_size})"},
            status=400,
        )

    root = _get_output_root()
    _cleanup_batch_zips(root)

    zip_path = (root / f".mjr_batch_{token}.zip").resolve()
    try:
        zip_path.relative_to(root)
    except Exception:
        return _json_response({"ok": False, "error": "Invalid zip path"}, status=400)

    event = asyncio.Event()
    filename = f"Majoor_Batch_{len(items)}.zip"
    with _BATCH_ZIP_LOCK:
        _BATCH_ZIP_CACHE[token] = {
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
        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for item in items:
                filename_item = (item or {}).get("filename")
                subfolder = (item or {}).get("subfolder", "") or ""
                if not filename_item:
                    continue
                try:
                    target = _safe_target(root, str(subfolder), str(filename_item))
                except ValueError:
                    continue
                if not target.exists() or not target.is_file():
                    continue
                arcname = f"{subfolder}/{filename_item}" if subfolder else str(filename_item)
                arcname = arcname.replace("\\", "/")
                try:
                    zf.write(str(target), arcname)
                    count += 1
                except Exception:
                    continue
        return count

    ok = False
    error = None
    count = 0
    try:
        count = await asyncio.to_thread(_build_zip)
        if count > 0:
            ok = True
        else:
            error = "No valid files to archive"
    except Exception as exc:
        error = str(exc)

    with _BATCH_ZIP_LOCK:
        entry = _BATCH_ZIP_CACHE.get(token)
        if entry:
            entry["ready"] = ok
            entry["error"] = error
            entry["count"] = count
            entry["event"].set()

    if not ok:
        try:
            if zip_path.exists():
                zip_path.unlink()
        except Exception:
            pass

    return _json_response({"ok": ok, "token": token, "count": count, "filename": filename, "error": error})


@PromptServer.instance.routes.get("/mjr/filemanager/batch_zip/{token}")
async def get_batch_zip(request: web.Request) -> web.Response:
    token = _sanitize_batch_token(request.match_info.get("token"))
    if not token:
        return _json_response({"ok": False, "error": "Invalid token"}, status=400)

    with _BATCH_ZIP_LOCK:
        entry = _BATCH_ZIP_CACHE.get(token)
    if not entry:
        return _json_response({"ok": False, "error": "Not found"}, status=404)

    event = entry.get("event")
    if isinstance(event, asyncio.Event) and not entry.get("ready"):
        try:
            await asyncio.wait_for(event.wait(), timeout=15.0)
        except asyncio.TimeoutError:
            return _json_response({"ok": False, "error": "Zip not ready"}, status=404)

    with _BATCH_ZIP_LOCK:
        entry = _BATCH_ZIP_CACHE.get(token)
    if not entry or not entry.get("ready"):
        return _json_response({"ok": False, "error": "Not ready"}, status=404)

    path = entry.get("path")
    if not isinstance(path, Path) or not path.exists():
        return _json_response({"ok": False, "error": "File missing"}, status=404)

    name = entry.get("filename") or f"{token}.zip"
    headers = {"Content-Disposition": f'attachment; filename="{name}"'}
    return web.FileResponse(path, headers=headers)


@PromptServer.instance.routes.post("/mjr/filemanager/open_explorer")
async def open_explorer(request: web.Request) -> web.Response:
    return await open_folder(request)


@PromptServer.instance.routes.post("/mjr/filemanager/open_folder")
async def open_folder(request: web.Request) -> web.Response:
    root = _get_output_root()
    try:
        payload = await request.json()
    except Exception:
        return _json_response({"ok": False, "error": "Invalid JSON body"}, status=400)

    filename = payload.get("filename")
    subfolder = payload.get("subfolder", "")
    if not filename:
        return _json_response({"ok": False, "error": "Missing filename"}, status=400)

    try:
        target = _safe_target(root, subfolder, filename)
    except ValueError:
        return _json_response({"ok": False, "error": "File is outside output directory"}, status=400)

    if not target.exists():
        return _json_response({"ok": False, "error": "File not found"}, status=404)

    ok, warning = _open_in_file_manager(target)
    if ok:
        resp = {"ok": True}
        if warning:
            resp["warning"] = warning
        return _json_response(resp, status=200)
    return _json_response({"ok": False, "error": warning or "Failed to open folder"}, status=500)


# ---------------------------------------------------------------------------
# METADATA / WORKFLOW EXTRACTION
# ---------------------------------------------------------------------------

@PromptServer.instance.routes.get("/mjr/filemanager/metadata")
@handle_connection_reset
async def get_metadata(request: web.Request) -> web.Response:
    _install_windows_asyncio_connection_reset_silencer()
    root = _get_output_root()
    filename = request.query.get("filename")
    subfolder = request.query.get("subfolder", "")

    # FIX: Use validation helper to reduce code duplication
    target, error = _validate_file_path(root, filename, subfolder)
    if error:
        # Map error to appropriate status code
        status = 404 if "not found" in error["error"].lower() else 400
        return _json_response(error, status=status)

    def _extract_generation(path: Path) -> Dict[str, Any]:
        def _extract_one(p: Path) -> Dict[str, Any]:
            try:
                return extract_generation_params_from_png(p) or {}
            except Exception as e:
                log.warning(
                    "[Majoor.AssetsManager] metadata parsing error for %s: %s", p.name, e
                )
                return {}

        def _has_wf(p: Dict[str, Any]) -> bool:
            return bool(
                p.get("has_workflow")
                or p.get("workflow")
                or p.get("prompt")
                or p.get("positive_prompt")
                or p.get("negative_prompt")
                or p.get("sampler_name")
                or p.get("model")
                or p.get("loras")
            )

        ext_lower = path.suffix.lower()
        params: Dict[str, Any] = _extract_one(path)

        if ext_lower in {".mp4", ".mov", ".m4v", ".webm", ".mkv"} and not _has_wf(params):
            stem = path.stem
            candidates = []
            try:
                for entry in path.parent.iterdir():
                    if not entry.is_file():
                        continue
                    if entry.suffix.lower() != ".png":
                        continue
                    if (
                        entry.stem == stem
                        or entry.stem.startswith(f"{stem}_")
                        or entry.stem.startswith(f"{stem}-")
                    ):
                        candidates.append(entry)
            except Exception:
                candidates = []

            if candidates:
                candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
                for png in candidates:
                    sib_params = _extract_one(png)
                    if _has_wf(sib_params):
                        params = sib_params
                        params["generation_source"] = "sibling_png"
                        break

        if isinstance(params, dict) and "has_workflow" not in params:
            params["has_workflow"] = _has_wf(params)

        return params

    loop = asyncio.get_running_loop()
    params = await loop.run_in_executor(None, _extract_generation, target)

    kind = classify_ext(filename.lower())
    rating, tags = _rating_tags_with_fallback(target, kind)

    return _json_response({"ok": True, "generation": params, "rating": rating, "tags": tags})


@PromptServer.instance.routes.get("/mjr/filemanager/capabilities")
async def get_capabilities(request: web.Request) -> web.Response:
    os_name = platform.system().lower()
    exiftool_available = _get_exiftool_path() is not None
    return _json_response(
        {
            "ok": True,
            "os": os_name,
            "exiftool_available": exiftool_available,
            "sidecar_enabled": ENABLE_JSON_SIDECAR,
        }
    )


@PromptServer.instance.routes.post("/mjr/filemanager/metadata/update")
async def update_metadata(request: web.Request) -> web.Response:
    root = _get_output_root()

    try:
        payload = await request.json()
    except Exception:
        return _json_response({"ok": False, "error": "Invalid JSON body"}, status=400)

    filename = payload.get("filename")
    subfolder = payload.get("subfolder", "")
    rating_provided = "rating" in payload
    tags_provided = "tags" in payload
    rating = payload.get("rating") if rating_provided else None
    tags = payload.get("tags") if tags_provided else None

    if not filename:
        return _json_response({"ok": False, "error": "Missing filename"}, status=400)

    try:
        target = _safe_target(root, subfolder, filename)
    except ValueError:
        return _json_response({"ok": False, "error": "File is outside output directory"}, status=400)

    kind = classify_ext(filename.lower())
    if not target.exists():
        return _json_response({"ok": False, "error": "File not found"}, status=404)

    updates = {}
    if rating_provided:
        updates["rating"] = rating
    if tags_provided:
        updates["tags"] = tags if tags is not None else []

    try:
        meta = update_metadata_with_windows(str(target), updates)
    except Exception as exc:
        return _json_response(
            {
                "ok": False,
                "file": {"filename": filename, "subfolder": subfolder},
                "error": str(exc),
            },
            status=500,
        )

    return _json_response({"ok": True, "rating": meta.get("rating", 0), "tags": meta.get("tags", [])})


@PromptServer.instance.routes.post("/mjr/filemanager/generation/update")
async def update_generation_sidecar(request: web.Request) -> web.Response:
    """
    Persist prompt/workflow into sidecar JSON for generated videos.
    Payload:
      {
        "files": [{"filename": "...", "subfolder": "..."}],
        "prompt": {...},      # optional prompt graph (id -> node)
        "workflow": {...}     # optional raw workflow
      }
    """
    root = _get_output_root()
    try:
        payload = await request.json()
    except Exception:
        return _json_response({"ok": False, "error": "Invalid JSON body"}, status=400)

    files = payload.get("files") or []
    prompt = payload.get("prompt")
    workflow = payload.get("workflow")

    if not isinstance(files, list) or not files:
        return _json_response({"ok": False, "error": "No files provided"}, status=400)

    updated: List[Dict[str, Any]] = []
    errors: List[Dict[str, Any]] = []

    for item in files:
        filename = (item or {}).get("filename") or (item or {}).get("name")
        subfolder = (item or {}).get("subfolder", "")
        if not filename:
            errors.append({"file": item, "error": "Missing filename"})
            continue
        try:
            target = _safe_target(root, subfolder, filename)
        except ValueError:
            errors.append({"file": {"filename": filename, "subfolder": subfolder}, "error": "Outside output directory"})
            continue
        if not target.exists():
            errors.append({"file": {"filename": filename, "subfolder": subfolder}, "error": "File not found"})
            continue
        if classify_ext(filename.lower()) != "video":
            continue

        meta_path = metadata_path(str(target))
        if not meta_path:
            errors.append({"file": {"filename": filename, "subfolder": subfolder}, "error": "Sidecar disabled"})
            continue

        meta = load_metadata(str(target)) or {}
        if "rating" not in meta:
            meta["rating"] = 0
        if not isinstance(meta.get("tags"), list):
            meta["tags"] = []
        if prompt is not None:
            meta["prompt"] = prompt
        if workflow is not None:
            meta["workflow"] = workflow
        if workflow is not None or prompt is not None:
            meta["has_workflow"] = bool(workflow or prompt)

        try:
            save_metadata(str(target), meta)
            updated.append({"filename": filename, "subfolder": subfolder})
        except Exception as exc:
            errors.append({"file": {"filename": filename, "subfolder": subfolder}, "error": str(exc)})

    return _json_response({"ok": True, "updated": updated, "errors": errors})


@PromptServer.instance.routes.post("/mjr/filemanager/sidecar/update")
async def update_sidecar(request: web.Request) -> web.Response:
    """
    Deep-merge arbitrary meta (rating/tags/prompt/workflow/...) into a file sidecar.
    """
    root = _get_output_root()
    try:
        payload = await request.json()
    except Exception:
        return _json_response({"ok": False, "error": "Invalid JSON body"}, status=400)

    filename = payload.get("filename")
    subfolder = payload.get("subfolder", "")
    meta_updates = payload.get("meta")

    if not filename or not isinstance(meta_updates, dict):
        return _json_response({"ok": False, "error": "Missing filename or invalid meta"}, status=400)

    try:
        target = _safe_target(root, subfolder, filename)
    except ValueError:
        return _json_response({"ok": False, "error": "File is outside output directory"}, status=400)

    if not target.exists():
        return _json_response({"ok": False, "error": "File not found"}, status=404)

    meta_path = metadata_path(str(target))
    if not meta_path:
        return _json_response({"ok": False, "error": "Sidecar disabled"}, status=400)

    try:
        merged = deep_merge_metadata(str(target), meta_updates)
        return _json_response({"ok": True, "meta": merged})
    except Exception as exc:
        return _json_response({"ok": False, "error": str(exc)}, status=500)


# ---------------------------------------------------------------------------
# Collections endpoints
# ---------------------------------------------------------------------------

@PromptServer.instance.routes.get("/mjr/collections/list")
async def list_collections_route(request: web.Request) -> web.Response:
    names = await asyncio.to_thread(get_collections)
    return _json_response({"collections": names})


@PromptServer.instance.routes.get("/mjr/collections/{name}")
async def get_collection_route(request: web.Request) -> web.Response:
    name = request.match_info["name"]
    files = await asyncio.to_thread(load_collection, name)
    return _json_response({"files": files})


@PromptServer.instance.routes.post("/mjr/collections/add")
async def add_to_collection_route(request: web.Request) -> web.Response:
    try:
        data = await request.json()
        await asyncio.to_thread(add_to_collection, data["name"], data["path"])
        return _json_response({"ok": True})
    except Exception as e:
        return _json_response({"ok": False, "error": str(e)}, status=500)


@PromptServer.instance.routes.post("/mjr/collections/remove")
async def remove_from_collection_route(request: web.Request) -> web.Response:
    try:
        data = await request.json()
        await asyncio.to_thread(remove_from_collection, data["name"], data["path"])
        return _json_response({"ok": True})
    except Exception as e:
        return _json_response({"ok": False, "error": str(e)}, status=500)
