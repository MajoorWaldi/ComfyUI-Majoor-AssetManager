"""
Directory scanning and file indexing endpoints.
"""
import asyncio
import os
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional, Tuple
from aiohttp import web

try:
    import folder_paths  # type: ignore
except Exception:
    class _FolderPathsStub:
        @staticmethod
        def get_input_directory() -> str:
            return str((Path(__file__).resolve().parents[3] / "input").resolve())

    folder_paths = _FolderPathsStub()  # type: ignore

from backend.adapters.db.schema import rebuild_fts
from backend.config import (
    OUTPUT_ROOT, 
    TO_THREAD_TIMEOUT_S, 
    INDEX_DIR_PATH, 
    INDEX_DB_PATH, 
    COLLECTIONS_DIR_PATH
)
from backend.custom_roots import resolve_custom_root
from backend.shared import Result, ErrorCode, get_logger
from backend.utils import parse_bool
from backend.features.index.metadata_helpers import MetadataHelpers
from backend.features.index.watcher_scope import (
    build_watch_paths,
    normalize_scope,
    WATCHER_SCOPE_KEY,
    WATCHER_CUSTOM_ROOT_ID_KEY,
)
from ..core import (
    _json_response,
    _require_services,
    _csrf_error,
    _require_operation_enabled,
    _resolve_security_prefs,
    _require_write_access,
    _check_rate_limit,
    _read_json,
    safe_error_message,
    _normalize_path,
    _is_path_allowed,
    _is_path_allowed_custom,
    _safe_rel_path,
    _is_within_root,
)

logger = get_logger(__name__)

_DEFAULT_MAX_UPLOAD_SIZE_BYTES = 500 * 1024 * 1024
_DEFAULT_MAX_RENAME_ATTEMPTS = 1000
_DEFAULT_MAX_CONCURRENT_INDEX = 10
_UPLOAD_READ_CHUNK_BYTES = 256 * 1024
_FILE_COMPARE_CHUNK_BYTES = 4 * 1024 * 1024
_MAX_FILENAME_LEN = 255

_MAX_UPLOAD_SIZE = int(os.environ.get("MJR_MAX_UPLOAD_SIZE", str(_DEFAULT_MAX_UPLOAD_SIZE_BYTES)))
_MAX_RENAME_ATTEMPTS = int(os.environ.get("MJR_MAX_RENAME_ATTEMPTS", str(_DEFAULT_MAX_RENAME_ATTEMPTS)))
_MAX_CONCURRENT_INDEX = int(os.environ.get("MJR_MAX_CONCURRENT_INDEX", str(_DEFAULT_MAX_CONCURRENT_INDEX)))
_INDEX_SEMAPHORE = asyncio.Semaphore(max(1, _MAX_CONCURRENT_INDEX))


def _allowed_upload_exts() -> set[str]:
    try:
        from backend.shared import EXTENSIONS  # type: ignore
        allowed: set[str] = set()
        for exts in (EXTENSIONS or {}).values():
            for ext in exts or []:
                allowed.add(str(ext).lower())
        allowed.update({".json", ".txt", ".csv"})
    except Exception:
        allowed = {
            ".png",
            ".jpg",
            ".jpeg",
            ".webp",
            ".gif",
            ".mp4",
            ".webm",
            ".mov",
            ".mkv",
            ".wav",
            ".mp3",
            ".flac",
            ".ogg",
            ".m4a",
            ".aac",
            ".obj",
            ".fbx",
            ".glb",
            ".gltf",
            ".stl",
            ".json",
            ".txt",
            ".csv",
        }

    try:
        extra = os.environ.get("MJR_UPLOAD_EXTRA_EXT", "")
        if extra:
            for item in extra.split(","):
                e = item.strip().lower()
                if e and not e.startswith("."):
                    e = "." + e
                if e:
                    allowed.add(e)
    except Exception:
        pass
    return allowed


async def _write_multipart_file_atomic(dest_dir: Path, filename: str, field) -> Result[Path]:
    """
    Write a multipart field to dest_dir using an atomic rename, enforcing max size.
    Never overwrites existing files.
    """
    try:
        dest_dir.mkdir(parents=True, exist_ok=True)
    except Exception as exc:
        return Result.Err("UPLOAD_FAILED", f"Cannot create destination directory: {exc}")

    safe_name = Path(str(filename)).name
    if not safe_name or "\x00" in safe_name or safe_name.startswith(".") or ".." in safe_name:
        return Result.Err("INVALID_INPUT", "Invalid filename")

    ext = Path(safe_name).suffix.lower()
    if ext not in _allowed_upload_exts():
        return Result.Err("INVALID_INPUT", "File extension not allowed")

    total = 0
    fd = None
    tmp_path = None
    try:
        fd, tmp_path = tempfile.mkstemp(dir=str(dest_dir), prefix=".upload_", suffix=ext)
        with os.fdopen(fd, "wb") as f:
            fd = None
            while True:
                chunk = await field.read_chunk(size=_UPLOAD_READ_CHUNK_BYTES)
                if not chunk:
                    break
                total += len(chunk)
                if total > _MAX_UPLOAD_SIZE:
                    raise ValueError(f"File exceeds maximum size ({_MAX_UPLOAD_SIZE} bytes)")
                # Avoid blocking the event loop on large writes.
                await asyncio.to_thread(f.write, chunk)

        tmp_obj = Path(str(tmp_path))
        final = dest_dir / safe_name
        counter = 0
        while final.exists():
            counter += 1
            if counter > _MAX_RENAME_ATTEMPTS:
                raise RuntimeError("Too many rename attempts")
            final = dest_dir / f"{Path(safe_name).stem}_{counter}{ext}"
        tmp_obj.replace(final)
        return Result.Ok(final)
    except Exception as exc:
        try:
            if fd is not None:
                os.close(fd)
        except Exception:
            pass
        try:
            if tmp_path:
                Path(str(tmp_path)).unlink(missing_ok=True)
        except Exception:
            pass
        return Result.Err("UPLOAD_FAILED", safe_error_message(exc, "Upload failed"))


def _schedule_index_task(fn) -> None:
    async def _runner():
        try:
            async with _INDEX_SEMAPHORE:
                await fn()
        except Exception:
            return

    try:
        asyncio.create_task(_runner())
    except Exception:
        return

def _files_equal_content(src: Path, dst: Path, *, chunk_size: int = _FILE_COMPARE_CHUNK_BYTES) -> bool:
    """
    Return True if two files have identical bytes.

    Used to avoid creating *_1 duplicates when re-staging the exact same file.
    """
    try:
        if not src.exists() or not dst.exists():
            return False
        if not src.is_file() or not dst.is_file():
            return False
    except Exception:
        return False

    try:
        import os
        if os.path.samefile(str(src), str(dst)):
            return True
    except Exception:
        pass

    try:
        if src.stat().st_size != dst.stat().st_size:
            return False
    except Exception:
        return False

    try:
        with open(src, "rb") as fs, open(dst, "rb") as fd:
            while True:
                bs = fs.read(chunk_size)
                bd = fd.read(chunk_size)
                if bs != bd:
                    return False
                if not bs:
                    return True
    except Exception:
        return False


@dataclass(frozen=True)
class StageDestination:
    """Resolved destination for staging (path + whether it was reused)."""
    path: Path
    reused_existing: bool


def _resolve_stage_destination(dest_dir: Path, filename: str, src_path: Path) -> StageDestination:
    """
    Choose a destination path for staging.

    - If `<dest_dir>/<filename>` already exists and is byte-identical to `src_path`, reuse it.
    - Otherwise, use `<filename>`, `<stem>_1<ext>`, ... to avoid clobbering.
    """
    dest_path = dest_dir / filename
    if dest_path.exists():
        if _files_equal_content(src_path, dest_path):
            return StageDestination(path=dest_path, reused_existing=True)

        stem = dest_path.stem
        suffix = dest_path.suffix
        counter = 1
        while dest_path.exists():
            dest_path = dest_dir / f"{stem}_{counter}{suffix}"
            counter += 1

    return StageDestination(path=dest_path, reused_existing=False)


def _resolve_scan_root(directory: str) -> Result[Path]:
    """
    Resolve a scan root strictly (follow symlinks/junctions) and ensure it exists.

    This prevents scanning arbitrary paths via symlink escapes inside allowed roots.
    """
    if not directory or "\x00" in str(directory):
        return Result.Err("INVALID_INPUT", "Invalid directory")
    try:
        resolved = Path(str(directory)).expanduser().resolve(strict=True)
    except (OSError, RuntimeError, ValueError) as exc:
        return Result.Err("DIR_NOT_FOUND", f"Directory not found: {exc}")
    if not resolved.exists() or not resolved.is_dir():
        return Result.Err("DIR_NOT_FOUND", "Directory not found")
    return Result.Ok(resolved)


def register_scan_routes(routes: web.RouteTableDef) -> None:
    """Register scan/index/stage/open-in-folder routes."""
    @routes.post("/mjr/am/scan")
    async def scan_directory(request):
        """
        Scan a directory for assets.

        JSON body:
            directory: Path to scan (optional, defaults to ComfyUI output directory)
            recursive: Scan subdirectories (default: true)
            incremental: Only update changed files (default: true)
        """
        svc, error_result = await _require_services()
        if error_result:
            return _json_response(error_result)

        csrf = _csrf_error(request)
        if csrf:
            return _json_response(Result.Err("CSRF", csrf))

        allowed, retry_after = _check_rate_limit(request, "scan", max_requests=3, window_seconds=60)
        if not allowed:
            return _json_response(Result.Err("RATE_LIMITED", "Too many scan requests. Please wait before retrying.", retry_after=retry_after))

        body_res = await _read_json(request)
        if not body_res.ok:
            return _json_response(body_res)
        body = body_res.data or {}

        scope = (body.get("scope") or "").lower().strip()
        custom_root_id = body.get("custom_root_id") or body.get("root_id") or body.get("customRootId")

        # Use ComfyUI output directory if not specified (backwards-compatible)
        directory = body.get("directory", OUTPUT_ROOT)
        if not directory:
            result = Result.Err("INVALID_INPUT", "No directory specified and no output directory configured")
            return _json_response(result)

        scan_source = "output"
        scan_root_id = None

        # Optional scoped scans (output/input/custom/all)
        if scope:
            if scope in ("output", "outputs"):
                directory = OUTPUT_ROOT
                scan_source = "output"
                custom_root_id = None
            elif scope in ("input", "inputs"):
                directory = folder_paths.get_input_directory()
                scan_source = "input"
                custom_root_id = None
            elif scope == "custom":
                root_result = resolve_custom_root(str(custom_root_id or ""))
                if not root_result.ok:
                    return _json_response(Result.Err("INVALID_INPUT", root_result.error))
                directory = str(root_result.data)
                scan_source = "custom"
                scan_root_id = str(custom_root_id) if custom_root_id else None
            elif scope == "all":
                # Run both output and input scans sequentially.
                recursive = body.get("recursive", True)
                incremental = body.get("incremental", True)
                fast = bool(body.get("fast") or body.get("mode") == "fast" or body.get("manifest_only") is True)
                background_metadata = bool(body.get("background_metadata") or body.get("enrich_metadata") or body.get("enqueue_metadata"))
                try:
                    # [OPTIMIZATION] Parallel Scan (Output + Input)
                    # Use gather instead of sequential await
                    out_coro = svc['index'].scan_directory(
                        str(Path(OUTPUT_ROOT).resolve()),
                        recursive,
                        incremental,
                        "output",
                        None,
                        fast,
                        background_metadata,
                    )
                    in_coro = svc['index'].scan_directory(
                        str(Path(folder_paths.get_input_directory()).resolve()),
                        recursive,
                        incremental,
                        "input",
                        None,
                        fast,
                        background_metadata,
                    )
                    
                    results = await asyncio.wait_for(
                        asyncio.gather(out_coro, in_coro, return_exceptions=True),
                        timeout=TO_THREAD_TIMEOUT_S
                    )
                    
                    out_res = results[0]
                    in_res = results[1]

                    # Handle exceptions if any (never raise to UI).
                    if isinstance(out_res, Exception):
                        logger.error("Output scan failed: %s", out_res)
                        return _json_response(Result.Err("SCAN_FAILED", safe_error_message(out_res, "Output scan failed")))
                    if isinstance(in_res, Exception):
                        logger.error("Input scan failed: %s", in_res)
                        return _json_response(Result.Err("SCAN_FAILED", safe_error_message(in_res, "Input scan failed")))
                    
                except asyncio.TimeoutError:
                    return _json_response(Result.Err("TIMEOUT", "Scan timed out"))
                if not out_res.ok:
                    return _json_response(out_res)
                if not in_res.ok:
                    return _json_response(in_res)
                out_stats = out_res.data or {}
                in_stats = in_res.data or {}
                merged = {
                    "scanned": out_stats.get("scanned", 0) + in_stats.get("scanned", 0),
                    "added": out_stats.get("added", 0) + in_stats.get("added", 0),
                    "updated": out_stats.get("updated", 0) + in_stats.get("updated", 0),
                    "skipped": out_stats.get("skipped", 0) + in_stats.get("skipped", 0),
                    "errors": out_stats.get("errors", 0) + in_stats.get("errors", 0),
                    "start_time": out_stats.get("start_time") or in_stats.get("start_time"),
                    "end_time": in_stats.get("end_time") or out_stats.get("end_time"),
                    "scope": "all",
                }
                try:
                    if isinstance(merged, dict):
                        request["mjr_stats"] = {
                            "scanned": merged.get("scanned", 0),
                            "added": merged.get("added", 0),
                            "updated": merged.get("updated", 0),
                            "skipped": merged.get("skipped", 0),
                            "errors": merged.get("errors", 0),
                            "scope": "all",
                        }
                except Exception as exc:
                    logger.debug("Failed to attach scan stats: %s", exc)
                return _json_response(Result.Ok(merged))
            else:
                return _json_response(Result.Err("INVALID_INPUT", f"Unknown scope: {scope}"))

        # SECURITY: resolve directory strictly (follows symlinks) and validate it stays within allowed roots.
        resolved_dir_res = _resolve_scan_root(str(directory))
        if not resolved_dir_res.ok:
            return _json_response(resolved_dir_res)
        normalized_dir = resolved_dir_res.data

        # Validate with strict root containment to prevent symlink/junction traversal outside roots.
        allowed = False
        try:
            if scan_source == "output":
                base_root_res = _resolve_scan_root(str(OUTPUT_ROOT))
                allowed = base_root_res.ok and _is_within_root(normalized_dir, base_root_res.data)
            elif scan_source == "input":
                base_root_res = _resolve_scan_root(str(folder_paths.get_input_directory()))
                allowed = base_root_res.ok and _is_within_root(normalized_dir, base_root_res.data)
            elif scan_source == "custom":
                root_result = resolve_custom_root(str(custom_root_id or scan_root_id or ""))
                if root_result.ok:
                    base_root_res = _resolve_scan_root(str(root_result.data))
                    allowed = base_root_res.ok and _is_within_root(normalized_dir, base_root_res.data)
                else:
                    allowed = False
            else:
                # No explicit scope: allow only within configured output/input or registered custom roots.
                out_root = _resolve_scan_root(str(OUTPUT_ROOT))
                in_root = _resolve_scan_root(str(folder_paths.get_input_directory()))
                allowed = (
                    (out_root.ok and _is_within_root(normalized_dir, out_root.data))
                    or (in_root.ok and _is_within_root(normalized_dir, in_root.data))
                    or _is_path_allowed_custom(normalized_dir)
                )
        except Exception as exc:
            logger.debug("Scan root containment check failed: %s", exc)
            allowed = False

        if not allowed or not (_is_path_allowed(normalized_dir) or _is_path_allowed_custom(normalized_dir)):
            return _json_response(Result.Err("INVALID_INPUT", "Directory not allowed"))

        recursive = body.get("recursive", True)
        incremental = body.get("incremental", True)
        fast = bool(body.get("fast") or body.get("mode") == "fast" or body.get("manifest_only") is True)
        background_metadata = bool(body.get("background_metadata") or body.get("enrich_metadata") or body.get("enqueue_metadata"))

        try:
            try:
                result = await asyncio.wait_for(
                    svc['index'].scan_directory(
                        str(normalized_dir),
                        recursive,
                        incremental,
                        scan_source,
                        scan_root_id,
                        fast,
                        background_metadata,
                    ),
                    timeout=TO_THREAD_TIMEOUT_S,
                )
            except asyncio.TimeoutError:
                return _json_response(Result.Err("TIMEOUT", "Scan timed out"))
            try:
                if result.ok and isinstance(result.data, dict):
                    request["mjr_stats"] = {
                        "scanned": result.data.get("scanned", 0),
                        "added": result.data.get("added", 0),
                        "updated": result.data.get("updated", 0),
                        "skipped": result.data.get("skipped", 0),
                        "errors": result.data.get("errors", 0),
                        "scope": scan_source,
                        "fast": bool(fast),
                    }
            except Exception as exc:
                logger.debug("Failed to attach scan stats: %s", exc)
        except Exception as exc:
            logger.exception("Unhandled error while scanning directory")
            error_result = Result.Err(
                "SCAN_FAILED",
                "Internal error while scanning assets",
                detail=str(exc)
            )
            return _json_response(error_result)

        return _json_response(result)

    @routes.post("/mjr/am/index-files")
    async def index_files(request):
        """
        Index a list of files (no directory scan).

        JSON body:
            files: [{ filename, subfolder?, type? }]
            incremental: Only update changed files (default: true)
        """
        svc, error_result = await _require_services()
        if error_result:
            return _json_response(error_result)

        csrf = _csrf_error(request)
        if csrf:
            return _json_response(Result.Err("CSRF", csrf))

        body_res = await _read_json(request)
        if not body_res.ok:
            return _json_response(body_res)
        body = body_res.data or {}

        files = body.get("files")
        origin = str(body.get("origin") or body.get("source") or "").strip().lower()
        if not isinstance(files, list) or not files:
            result = Result.Err("INVALID_INPUT", "Missing or invalid 'files' list")
            return _json_response(result)

        incremental = body.get("incremental", True)
        grouped_paths: Dict[Tuple[str, str, str], list] = {}
        recent_generated_paths: list[str] = []

        pending_ops: list[dict[str, Any]] = []

        for item in files:
            if not isinstance(item, dict):
                continue
            filename = item.get("filename") or item.get("name")
            if not filename:
                filename = None
            subfolder = item.get("subfolder") or ""
            file_type = (item.get("type") or "output").lower()
            root_id = item.get("root_id") or item.get("custom_root_id")
            raw_path = item.get("path") or item.get("filepath") or item.get("fullpath") or item.get("full_path")

            # If an absolute path is provided, prefer it (more robust across ComfyUI variants).
            if raw_path:
                normalized = None
                try:
                    p = Path(str(raw_path)).expanduser()
                    if p.is_absolute() or getattr(p, "drive", ""):
                        normalized = p.resolve(strict=True)
                except Exception:
                    normalized = None

                if normalized is not None:
                    base_root = None
                    base_type = None
                    base_root_id = root_id

                    try:
                        out_root = Path(OUTPUT_ROOT).resolve(strict=True)
                    except Exception:
                        out_root = None
                    try:
                        in_root = Path(folder_paths.get_input_directory()).resolve(strict=True)
                    except Exception:
                        in_root = None

                    if out_root and _is_within_root(normalized, out_root):
                        base_root = str(out_root)
                        base_type = "output"
                        base_root_id = None
                    elif in_root and _is_within_root(normalized, in_root):
                        base_root = str(in_root)
                        base_type = "input"
                        base_root_id = None
                    elif file_type == "custom":
                        root_result = resolve_custom_root(str(root_id or ""))
                        if root_result.ok:
                            try:
                                custom_root = Path(str(root_result.data)).resolve(strict=True)
                            except Exception:
                                custom_root = None
                            if custom_root and _is_within_root(normalized, custom_root):
                                base_root = str(custom_root)
                                base_type = "custom"
                    else:
                        try:
                            if _is_path_allowed_custom(normalized):
                                from backend.custom_roots import list_custom_roots

                                roots_res = list_custom_roots()
                                if roots_res.ok and isinstance(roots_res.data, list):
                                    for r in roots_res.data:
                                        try:
                                            rp = Path(str(r.get("path") or "")).resolve(strict=True)
                                            if _is_within_root(normalized, rp):
                                                base_root = str(rp)
                                                base_type = "custom"
                                                base_root_id = r.get("id") or root_id
                                                break
                                        except Exception:
                                            continue
                        except Exception:
                            pass

                    if base_root and base_type:
                        # Enforce allowlist checks
                        if base_type == "custom":
                            if not _is_path_allowed_custom(normalized):
                                continue
                        else:
                            if not _is_path_allowed(normalized):
                                continue
                        grouped_paths.setdefault((base_root, base_type, str(base_root_id or "")), []).append(normalized)
                        if origin in ("generation", "executed", "comfy", "comfyui"):
                            try:
                                recent_generated_paths.append(str(normalized))
                            except Exception:
                                pass
                        continue

            if not filename:
                continue

            if file_type == "input":
                base_root = folder_paths.get_input_directory()
            elif file_type == "custom":
                root_result = resolve_custom_root(str(root_id or ""))
                if not root_result.ok:
                    continue
                base_root = str(root_result.data)
            else:
                base_root = OUTPUT_ROOT

            # SECURITY: subfolder must be a safe relative path (no traversal, no absolute/drive).
            rel = _safe_rel_path(subfolder or "")
            if rel is None:
                continue

            base_dir = str(Path(base_root).resolve(strict=False))
            candidate = (Path(base_dir) / rel / filename) if str(rel) else (Path(base_dir) / filename)
            try:
                normalized = candidate.resolve(strict=True)
            except Exception:
                continue
            if not normalized.exists() or not normalized.is_file():
                continue
            if not _is_within_root(normalized, Path(base_dir)):
                continue
            if file_type == "custom":
                if not _is_path_allowed_custom(normalized):
                    continue
            else:
                if not _is_path_allowed(normalized):
                    continue

            grouped_paths.setdefault((base_dir, file_type, str(root_id or "")), []).append(normalized)
            if origin in ("generation", "executed", "comfy", "comfyui"):
                try:
                    recent_generated_paths.append(str(normalized))
                except Exception:
                    pass

        if not grouped_paths:
            result = Result.Err("INVALID_INPUT", "No valid files to index")
            return _json_response(result)

        if recent_generated_paths:
            try:
                from backend.features.index.watcher import mark_recent_generated
                mark_recent_generated(recent_generated_paths)
            except Exception:
                pass

        total_stats = {
            "scanned": 0,
            "added": 0,
            "updated": 0,
            "skipped": 0,
            "errors": 0,
            "start_time": "",
            "end_time": ""
        }

        for (base_dir, file_type, root_id), paths in grouped_paths.items():
            source = file_type if file_type in ("output", "input", "custom") else "output"
            try:
                try:
                    result = await asyncio.wait_for(
                        svc['index'].index_paths(
                            paths,
                            base_dir,
                            incremental,
                            source,
                            (root_id or None),
                        ),
                        timeout=TO_THREAD_TIMEOUT_S,
                    )
                except asyncio.TimeoutError:
                    result = Result.Err("TIMEOUT", "Indexing timed out")
            except Exception as exc:
                result = Result.Err("INDEX_FAILED", f"Indexing failed: {exc}")
            if not result.ok:
                return _json_response(result)

            stats = result.data or {}
            if not total_stats["start_time"]:
                total_stats["start_time"] = str(stats.get("start_time") or "")
            total_stats["end_time"] = str(stats.get("end_time") or total_stats["end_time"] or "")
            total_stats["scanned"] += stats.get("scanned", 0)
            total_stats["added"] += stats.get("added", 0)
            total_stats["updated"] += stats.get("updated", 0)
            total_stats["skipped"] += stats.get("skipped", 0)
            total_stats["errors"] += stats.get("errors", 0)

        # POST-PROCESSING: Enhance metadata with frontend-provided info (e.g. generation_time_ms)
        # We process this via a temporary table batch update to avoid N+1 queries.
        _enhancement_map: Dict[str, Dict[str, Any]] = {}

        insert_params = []
        for item in files:
            gen_time = item.get("generation_time_ms") or item.get("duration_ms")
            if gen_time and isinstance(gen_time, (int, float)) and gen_time > 0:
                fname = item.get("filename")
                if not fname: continue
                s_name = item.get("subfolder") or ""
                s_src = (item.get("type") or "output").lower()
                
                # Check duplication in params list
                # (Simple dedupe by tuple key)
                key = (fname, str(s_name), s_src)
                if key not in _enhancement_map:
                    _enhancement_map[key] = True
                    insert_params.append((str(fname), str(s_name), s_src, int(gen_time)))

        if insert_params:
             try:
                 db_adapter = svc['db']
                 
                 async with db_adapter.atransaction() as tx:
                     if not tx.ok:
                         raise RuntimeError(tx.error or "Failed to begin transaction")
                     # A. Create Temp Table for Batch Processing
                     await db_adapter.aexecute("CREATE TEMPORARY TABLE IF NOT EXISTS temp_gen_updates (filename TEXT, subfolder TEXT, source TEXT, gen_time INTEGER)")
                     await db_adapter.aexecute("DELETE FROM temp_gen_updates")

                     # B. Bulk Insert
                     await db_adapter.aexecutemany("INSERT INTO temp_gen_updates (filename, subfolder, source, gen_time) VALUES (?, ?, ?, ?)", insert_params)

                     # C. Fetch joined data in ONE query
                     # We need existing metadata to merge safely (read-modify-write pattern required for JSON in SQLite < 3.38 json_patch, or generally for safety)
                     q_res = await db_adapter.aquery("""
                        SELECT a.id, am.metadata_raw, t.gen_time 
                        FROM temp_gen_updates t
                        JOIN assets a ON a.filename = t.filename AND a.subfolder = t.subfolder AND a.source = t.source
                        LEFT JOIN asset_metadata am ON a.id = am.asset_id
                     """)
                     
                     if q_res.ok and q_res.data:
                         import json
                         upsert_params = []
                         
                         for row in q_res.data:
                             asset_id = row["id"]
                             raw = row["metadata_raw"]
                             new_time = row["gen_time"]
                             
                             current_meta = {}
                             if raw:
                                 try:
                                     current_meta = json.loads(raw)
                                 except (json.JSONDecodeError, TypeError, ValueError):
                                     pass
                            
                             # Merge updates
                             current_meta["generation_time_ms"] = new_time
                             new_json = json.dumps(current_meta, ensure_ascii=False)
                             
                             upsert_params.append((asset_id, new_json))
                         
                         # D. Bulk Upsert (INSERT or UPDATE)
                         # Prefer per-asset locked writes using MetadataHelpers to avoid races
                         # with other concurrent metadata writers (background enrichers, manual edits).
                         if upsert_params:
                             try:
                                 from backend.features.index.metadata_helpers import MetadataHelpers
                                 for asset_id, new_json in upsert_params:
                                     try:
                                         async with db_adapter.lock_for_asset(int(asset_id)):
                                             # Load current metadata_raw for this asset (if any)
                                             cur = await db_adapter.aquery("SELECT metadata_raw FROM asset_metadata WHERE asset_id = ? LIMIT 1", (int(asset_id),))
                                             cur_meta = {}
                                             if cur.ok and cur.data and cur.data[0].get("metadata_raw"):
                                                 try:
                                                     cur_meta = json.loads(cur.data[0].get("metadata_raw") or "{}")
                                                 except Exception:
                                                     cur_meta = {}

                                             # Parse incoming partial metadata (e.g., {'generation_time_ms': 123})
                                             incoming_meta = {}
                                             try:
                                                 incoming_meta = json.loads(new_json) if new_json else {}
                                             except Exception:
                                                 incoming_meta = {}

                                             # Merge conservatively: preserve existing keys and update with incoming values
                                             merged = dict(cur_meta)
                                             merged.update(incoming_meta)

                                             # Use MetadataHelpers to write merged metadata safely (it handles quality/tags/flags)
                                             await MetadataHelpers.write_asset_metadata_row(db_adapter, int(asset_id), Result.Ok(merged))
                                     except Exception:
                                         logger.debug("Failed to upsert generation time for asset %s", asset_id)
                             except Exception:
                                 # Fallback: if per-asset path fails for any reason, try the original bulk upsert SQL
                                 try:
                                     await db_adapter.aexecutemany("""
                                         INSERT INTO asset_metadata (asset_id, metadata_raw)
                                         VALUES (?, ?)
                                         ON CONFLICT(asset_id) DO UPDATE SET
                                             metadata_raw = excluded.metadata_raw
                                     """, upsert_params)
                                 except Exception:
                                     logger.debug("Fallback SQL bulk upsert failed")
                     
                     # Cleanup
                     await db_adapter.aexecute("DROP TABLE IF EXISTS temp_gen_updates")
                 if not tx.ok:
                     raise RuntimeError(tx.error or "Commit failed")

             except Exception as ex:
                 logger.debug("Failed during batch metadata enhancement: %s", ex)


        try:
            request["mjr_stats"] = {
                "scanned": total_stats.get("scanned", 0),
                "added": total_stats.get("added", 0),
                "updated": total_stats.get("updated", 0),
                "skipped": total_stats.get("skipped", 0),
                "errors": total_stats.get("errors", 0),
                "scope": "index-files",
            }
        except Exception as exc:
            logger.debug("Failed to attach scan stats: %s", exc)

        return _json_response(Result.Ok(total_stats))

    @routes.post("/mjr/am/index/reset")
    async def reset_index(request):
        """
        Reset index caches and optionally re-run scans.

        Body fields:
            scope: "output"|"input"|"custom"|"all" (default: "output")
            custom_root_id/root_id: required when scope="custom"
            reindex: bool (default: true)
            clear_scan_journal: bool (default: true)
            clear_metadata_cache: bool (default: true)
            rebuild_fts: bool (default: true)
            incremental: bool (default: false)
            fast: bool (default: true)
            background_metadata: bool (default: true)
        """
        csrf = _csrf_error(request)
        if csrf:
            return _json_response(Result.Err("CSRF", csrf))

        svc, error_result = await _require_services()
        if error_result:
            return _json_response(error_result)

        prefs = await _resolve_security_prefs(svc)
        op = _require_operation_enabled("reset_index", prefs=prefs)
        if not op.ok:
            return _json_response(op)

        auth = _require_write_access(request)
        if not auth.ok:
            return _json_response(auth)

        body_res = await _read_json(request)
        if not body_res.ok:
            return _json_response(body_res)
        body = body_res.data or {}

        def _bool_option(keys, default):
            for key in keys:
                if key in body:
                    return parse_bool(body[key], default)
            return default

        scope = str(body.get("scope") or "output").strip().lower() or "output"
        custom_root_id = ""
        for key in ("custom_root_id", "root_id", "customRootId", "customRoot"):
            candidate = body.get(key)
            if candidate:
                custom_root_id = str(candidate).strip()
                break

        reindex = _bool_option(("reindex",), True)
        clear_scan_journal = _bool_option(("clear_scan_journal", "clearScanJournal"), True)
        clear_metadata_cache = _bool_option(("clear_metadata_cache", "clearMetadataCache"), True)
        clear_asset_metadata = _bool_option(("clear_asset_metadata", "clearAssetMetadata"), True)
        clear_assets_table = _bool_option(("clear_assets", "clearAssets"), True)
        rebuild_fts_flag = _bool_option(("rebuild_fts", "rebuildFts"), True)
        incremental = _bool_option(("incremental",), False)
        fast = _bool_option(("fast",), True)
        background_metadata = _bool_option(("background_metadata", "backgroundMetadata"), True)

        # Hard reset deletes and recreates the SQLite DB files (assets.sqlite, -wal, -shm).
        # This matches the "Reset Index Now" maintenance intent.
        hard_reset_db = _bool_option(
            (
                "hard_reset_db",
                "hardResetDb",
                "delete_db_files",
                "deleteDbFiles",
                "delete_db",
                "deleteDb",
            ),
            False,
        )

        target_roots: list[dict[str, str | None]] = []
        try:
            if scope in ("output", "outputs"):
                target_roots.append({"source": "output", "path": str(Path(OUTPUT_ROOT).resolve(strict=False)), "root_id": None})
            elif scope in ("input", "inputs"):
                target_roots.append(
                    {
                        "source": "input",
                        "path": str(Path(folder_paths.get_input_directory()).resolve(strict=False)),
                        "root_id": None,
                    }
                )
            elif scope == "all":
                target_roots.append({"source": "output", "path": str(Path(OUTPUT_ROOT).resolve(strict=False)), "root_id": None})
                target_roots.append(
                    {
                        "source": "input",
                        "path": str(Path(folder_paths.get_input_directory()).resolve(strict=False)),
                        "root_id": None,
                    }
                )
            elif scope == "custom":
                if not custom_root_id:
                    return _json_response(Result.Err("INVALID_INPUT", "Missing custom_root_id for custom scope"))
                root_result = resolve_custom_root(custom_root_id)
                if not root_result.ok:
                    return _json_response(root_result)
                resolved = str(root_result.data)
                target_roots.append({"source": "custom", "path": resolved, "root_id": custom_root_id})
            else:
                return _json_response(Result.Err("INVALID_INPUT", f"Unknown scope: {scope}"))
        except Exception as exc:
            logger.debug("Failed to resolve reset index roots: %s", exc)
            return _json_response(Result.Err("INVALID_INPUT", "Unable to resolve reset scope"))

        db = svc.get("db")
        if not db:
            return _json_response(Result.Err("SERVICE_UNAVAILABLE", "Database service unavailable"))

        # Best-effort coordination with concurrent scans.
        # Do NOT hold the scan lock while invoking scan_directory() (it also uses the same lock).
        scan_lock = None
        try:
            index_svc = svc.get("index")
            scan_lock = getattr(index_svc, "_scan_lock", None)
        except Exception:
            scan_lock = None

        cache_prefixes: list[str] | None = None if scope == "all" else [entry["path"] for entry in target_roots]

        # If the caller is effectively requesting a full wipe (the usual UI path),
        # treat it as a hard reset by default when scope=all.
        implied_full_clear = bool(clear_scan_journal and clear_metadata_cache and clear_asset_metadata and clear_assets_table)
        should_hard_reset_db = bool(scope == "all" and (hard_reset_db or implied_full_clear))

        if should_hard_reset_db:
            # 1) Hard reset DB files (includes -wal/-shm) using adapter logic (Windows-safe).
            try:
                if scan_lock is not None and hasattr(scan_lock, "__aenter__"):
                    async with scan_lock:
                        reset_res = await db.areset()
                else:
                    reset_res = await db.areset()
            except Exception as exc:
                logger.exception("Hard reset DB failed")
                return _json_response(Result.Err("RESET_FAILED", f"Hard reset failed: {exc}"))

            if not reset_res.ok:
                return _json_response(reset_res)

            cleared = {
                "scan_journal": None,
                "metadata_cache": None,
                "asset_metadata": None,
                "assets": None,
                "hard_reset_db": True,
                "file_ops": (reset_res.meta or {}),
            }

            # 2) Optionally reindex after reset.
            scan_details: list[dict[str, Any]] = []
            totals = {key: 0 for key in ("scanned", "added", "updated", "skipped", "errors")}
            if reindex:
                if not svc.get("index"):
                    return _json_response(Result.Err("SERVICE_UNAVAILABLE", "Index service unavailable"))
                for target in target_roots:
                    try:
                        result = await asyncio.wait_for(
                            svc['index'].scan_directory(
                                target["path"],
                                True,
                                incremental,
                                target["source"],
                                target.get("root_id"),
                                fast,
                                background_metadata,
                            ),
                            timeout=TO_THREAD_TIMEOUT_S,
                        )
                    except asyncio.TimeoutError:
                        return _json_response(Result.Err("TIMEOUT", "Index reset scan timed out"))
                    except Exception as exc:
                        logger.exception("Index reset scan failed")
                        return _json_response(Result.Err("RESET_FAILED", f"Index reset scan failed: {exc}"))

                    if not result.ok:
                        return _json_response(result)

                    stats = result.data or {}
                    counts = {key: int(stats.get(key) or 0) for key in totals}
                    for key in totals:
                        totals[key] += counts[key]
                    scan_details.append(
                        {
                            "source": target["source"],
                            "root_id": target.get("root_id"),
                            **counts,
                        }
                    )

            scan_summary = {
                "scope": scope,
                "reindex": bool(reindex),
                "details": scan_details,
                **totals,
            }

            # No need to VACUUM or rebuild FTS here: db.areset() reinitializes schema + indexes.
            return _json_response(Result.Ok({"cleared": cleared, "scan_summary": scan_summary, "rebuild_fts": None}))

        async def _clear_table(table: str, prefixes: list[str] | None) -> Result[int]:
            total_deleted = 0
            if prefixes is None:
                res = await db.aexecute(f"DELETE FROM {table}")
                if not res.ok:
                    return res
                return Result.Ok(int(res.data or 0))
            for prefix in prefixes:
                try:
                    normalized = str(Path(prefix).resolve(strict=False))
                except Exception:
                    return Result.Err("INVALID_INPUT", f"Invalid path for cache clearing: {prefix}")
                like = normalized.rstrip(os.path.sep) + os.path.sep + "%"
                res = await db.aexecute(
                    f"DELETE FROM {table} WHERE filepath = ? OR filepath LIKE ?",
                    (normalized, like),
                )
                if not res.ok:
                    return res
                total_deleted += int(res.data or 0)
            return Result.Ok(total_deleted)

        async def _clear_assets(prefixes: list[str] | None) -> Result[int]:
            # Deleting from assets cascades to asset_metadata/scan_journal/metadata_cache.
            return await _clear_table("assets", prefixes)

        async def _clear_asset_metadata(prefixes: list[str] | None) -> Result[int]:
            total_deleted = 0
            if prefixes is None:
                res = await db.aexecute("DELETE FROM asset_metadata")
                if not res.ok:
                    return res
                return Result.Ok(int(res.data or 0))

            for prefix in prefixes:
                try:
                    normalized = str(Path(prefix).resolve(strict=False))
                except Exception:
                    return Result.Err("INVALID_INPUT", f"Invalid path for metadata clearing: {prefix}")
                like = normalized.rstrip(os.path.sep) + os.path.sep + "%"
                res = await db.aexecute(
                    """
                    DELETE FROM asset_metadata
                    WHERE asset_id IN (
                        SELECT id FROM assets
                        WHERE filepath = ? OR filepath LIKE ?
                    )
                    """,
                    (normalized, like),
                )
                if not res.ok:
                    return res
                total_deleted += int(res.data or 0)
            return Result.Ok(total_deleted)

        cleared = {"scan_journal": 0, "metadata_cache": 0, "asset_metadata": 0, "assets": 0}

        async def _do_clears() -> Result[dict]:
            # Make clears atomic and resistant to concurrent writers.
            async with db.atransaction(mode="immediate") as tx:
                if not tx.ok:
                    return Result.Err("DB_ERROR", tx.error or "Failed to begin transaction")
                if clear_scan_journal:
                    res = await _clear_table("scan_journal", cache_prefixes)
                    if not res.ok:
                        return res
                    cleared["scan_journal"] = int(res.data or 0)
                if clear_metadata_cache:
                    res = await _clear_table("metadata_cache", cache_prefixes)
                    if not res.ok:
                        return res
                    cleared["metadata_cache"] = int(res.data or 0)

                # IMPORTANT: scope-aware clears.
                # Previous implementation cleared the entire tables, even for output/custom scope.
                if clear_asset_metadata:
                    res = await _clear_asset_metadata(cache_prefixes)
                    if not res.ok:
                        return res
                    cleared["asset_metadata"] = int(res.data or 0)
                if clear_assets_table:
                    res = await _clear_assets(cache_prefixes)
                    if not res.ok:
                        return res
                    cleared["assets"] = int(res.data or 0)
            if not tx.ok:
                return Result.Err("DB_ERROR", tx.error or "Commit failed")
            return Result.Ok(cleared)

        try:
            if scan_lock is not None and hasattr(scan_lock, "__aenter__"):
                async with scan_lock:
                    res = await _do_clears()
            else:
                res = await _do_clears()
        except Exception as exc:
            logger.exception("Index reset clear phase failed")
            return _json_response(Result.Err("RESET_FAILED", f"Index reset failed during clear phase: {exc}"))

        if not res.ok:
            return _json_response(res)

        # FULL RESET CLEANUP: VACUUM and Physical Files
        if scope == "all" and (clear_scan_journal or clear_metadata_cache):
            # 1. Vacuum DB to reclaim space and rebuild file
            try:
                await asyncio.to_thread(db.execute, "VACUUM")
                logger.info("Database VACUUM completed during index reset")
            except Exception as exc:
                logger.warning(f"Failed to VACUUM database: {exc}")

            # 2. Cleanup physical stray files in index directory
            # Verify we are cleaning the right folder and safeguard critical files
            if reindex and INDEX_DIR_PATH.exists():
                def _cleanup_index_dir():
                    for item in INDEX_DIR_PATH.iterdir():
                        if item.name.startswith("assets.sqlite"):
                            continue
                        if item == COLLECTIONS_DIR_PATH:
                            continue
                        # Preserve user configuration/state stored in the index directory.
                        if item.name == "custom_roots.json":
                            continue

                        try:
                            if item.is_dir():
                                shutil.rmtree(item)
                            else:
                                item.unlink()
                            logger.info(f"Deleted stray index item: {item.name}")
                        except Exception as e:
                            logger.warning(f"Failed to delete {item.name}: {e}")

                try:
                    await asyncio.to_thread(_cleanup_index_dir)
                except Exception as exc:
                    logger.warning(f"Index directory cleanup failed: {exc}")

        scan_details: list[dict[str, Any]] = []
        totals = {key: 0 for key in ("scanned", "added", "updated", "skipped", "errors")}
        if reindex:
            for target in target_roots:
                try:
                    result = await asyncio.wait_for(
                        svc['index'].scan_directory(
                            target["path"],
                            True,
                            incremental,
                            target["source"],
                            target.get("root_id"),
                            fast,
                            background_metadata,
                        ),
                        timeout=TO_THREAD_TIMEOUT_S,
                    )
                except asyncio.TimeoutError:
                    return _json_response(Result.Err("TIMEOUT", "Index reset scan timed out"))
                except Exception as exc:
                    logger.exception("Index reset scan failed")
                    return _json_response(Result.Err("RESET_FAILED", f"Index reset scan failed: {exc}"))

                if not result.ok:
                    return _json_response(result)

                stats = result.data or {}
                counts = {key: int(stats.get(key) or 0) for key in totals}
                for key in totals:
                    totals[key] += counts[key]
                scan_details.append(
                    {
                        "source": target["source"],
                        "root_id": target.get("root_id"),
                        **counts,
                    }
                )

        scan_summary = {
            "scope": scope,
            "reindex": bool(reindex),
            "details": scan_details,
            **totals,
        }

        rebuild_status = None
        if rebuild_fts_flag:
            try:
                async with db.atransaction(mode="immediate") as tx:
                    if not tx.ok:
                        return _json_response(Result.Err("DB_ERROR", tx.error or "Failed to begin transaction"))
                    rebuild_result = await rebuild_fts(db)
                if not tx.ok:
                    return _json_response(Result.Err("DB_ERROR", tx.error or "Commit failed"))
            except Exception as exc:
                logger.exception("FTS rebuild failed during index reset")
                return _json_response(Result.Err("DB_ERROR", f"FTS rebuild failed: {exc}"))
            if not rebuild_result.ok:
                return _json_response(rebuild_result)
            rebuild_status = True

        return _json_response(
            Result.Ok(
                {
                    "cleared": cleared,
                    "scan_summary": scan_summary,
                    "rebuild_fts": rebuild_status,
                }
            )
        )

    @routes.post("/mjr/am/stage-to-input")
    async def stage_to_input(request):
        """
        Copy files into the ComfyUI input directory.

        JSON body:
            files: [{ filename, subfolder?, type? }]
            index: bool (optional, default true) - whether to index staged files into the DB
            purpose: string (optional) - purpose of staging (e.g. "node_drop" for fast path)
        """
        svc, error_result = await _require_services()
        if error_result:
            return _json_response(error_result)

        csrf = _csrf_error(request)
        if csrf:
            return _json_response(Result.Err("CSRF", csrf))

        body_res = await _read_json(request)
        if not body_res.ok:
            return _json_response(body_res)
        body = body_res.data or {}

        # Check if this is a fast path request (e.g., for node drop)
        purpose = body.get("purpose", "").lower().strip()
        skip_index = (purpose == "node_drop")

        # Allow explicit index override to take precedence
        index_staged = body.get("index", not skip_index)  # Default to not indexing if purpose is node_drop
        if isinstance(index_staged, str):
            index_staged = index_staged.strip().lower() in ("1", "true", "yes", "on")
        else:
            index_staged = bool(index_staged)

        files = body.get("files")
        if not isinstance(files, list) or not files:
            result = Result.Err("INVALID_INPUT", "Missing or invalid 'files' list")
            return _json_response(result)

        input_root = Path(folder_paths.get_input_directory()).resolve()
        staged = []
        staged_paths = []
        errors = []
        pending_ops = []

        def _safe_filename(name: str) -> Optional[str]:
            if not name or "\x00" in name:
                return None
            cleaned = Path(name).name
            if cleaned != name:
                return None
            return cleaned

        def _safe_rel_subfolder(value: Any) -> Optional[Path]:
            if value is None:
                return None
            if not isinstance(value, str):
                return None
            text = value.strip()
            if text == "":
                return Path(".")
            if "\x00" in text:
                return None
            p = Path(text)
            # Windows drive paths like "C:..." or absolute paths are not allowed.
            if getattr(p, "drive", ""):
                return None
            if p.is_absolute():
                return None
            # Disallow traversal
            if any(part == ".." for part in p.parts):
                return None
            return p

        for item in files:
            if not isinstance(item, dict):
                continue
            raw_filename = item.get("filename") or item.get("name")
            filename = _safe_filename(raw_filename)
            if not filename:
                errors.append({"file": raw_filename, "error": "Invalid filename"})
                continue

            subfolder = item.get("subfolder") or ""
            file_type = (item.get("type") or "output").lower()
            root_id = item.get("root_id") or item.get("custom_root_id")
            dest_subfolder = _safe_rel_subfolder(item.get("dest_subfolder", None))
            if "dest_subfolder" in item and dest_subfolder is None:
                errors.append({"file": raw_filename, "error": "Invalid dest_subfolder"})
                continue

            if file_type == "input":
                base_root = folder_paths.get_input_directory()
            elif file_type == "custom":
                root_result = resolve_custom_root(str(root_id or ""))
                if not root_result.ok:
                    errors.append({"file": raw_filename, "error": root_result.error})
                    continue
                base_root = str(root_result.data)
            else:
                base_root = OUTPUT_ROOT
            base_dir = str(Path(base_root).resolve())

            candidate = Path(base_dir) / subfolder / filename if subfolder else Path(base_dir) / filename
            normalized = _normalize_path(str(candidate))
            if not normalized or not normalized.exists():
                errors.append({"file": raw_filename, "error": "Source file not found"})
                continue

            if file_type == "custom":
                if not _is_within_root(normalized, Path(base_dir)):
                    errors.append({"file": raw_filename, "error": "Source file outside custom root"})
                    continue
            else:
                if not _is_path_allowed(normalized):
                    errors.append({"file": raw_filename, "error": "Source file not allowed"})
                    continue

            # Destination:
            # - default: keep current behavior under input/mjr_staged/<source_subfolder?>
            # - if dest_subfolder is provided: stage under input/<dest_subfolder> (no extra prefix)
            if dest_subfolder is None:
                dest_dir = input_root / "mjr_staged"
                if subfolder:
                    dest_dir = dest_dir / subfolder
            else:
                dest_dir = (input_root / dest_subfolder).resolve()
                if not _is_within_root(dest_dir, input_root):
                    errors.append({"file": raw_filename, "error": "Invalid dest_subfolder"})
                    continue
            dest_dir.mkdir(parents=True, exist_ok=True)
            if not dest_dir.is_dir():
                errors.append({"file": raw_filename, "error": "Destination path exists but is not a directory"})
                continue

            resolved = _resolve_stage_destination(dest_dir, filename, Path(str(normalized)))
            dest_path = resolved.path
            if resolved.reused_existing:
                try:
                    staged_paths.append(dest_path)
                except Exception as exc:
                    logger.debug("Failed to track staged path: %s", exc)

                staged.append({
                    "name": dest_path.name,
                    "subfolder": "" if dest_dir == input_root else str(dest_dir.relative_to(input_root)),
                    "path": str(dest_path)
                })
                continue

            # Batch file ops into a single threadpool task to reduce overhead and avoid threadpool pressure.
            try:
                pending_ops.append({
                    "raw_filename": raw_filename,
                    "src": str(normalized),
                    "dst": str(dest_path),
                    "name": dest_path.name,
                    "subfolder": "" if dest_dir == input_root else str(dest_dir.relative_to(input_root)),
                })
            except Exception:
                errors.append({"file": raw_filename, "error": "Failed to stage file (internal error)"})
                continue

        if pending_ops:
            def _link_or_copy_many(ops: list[dict[str, Any]]) -> list[dict[str, Any]]:
                results: list[dict[str, Any]] = []
                for op in ops:
                    try:
                        src = Path(str(op.get("src") or ""))
                        dst = Path(str(op.get("dst") or ""))
                        did_link = False
                        try:
                            same_drive = True
                            try:
                                if getattr(src, "drive", "") and getattr(dst, "drive", ""):
                                    same_drive = src.drive.lower() == dst.drive.lower()
                            except Exception:
                                same_drive = True

                            if same_drive:
                                os.link(str(src), str(dst))
                                did_link = True
                        except Exception:
                            did_link = False

                        if not did_link:
                            shutil.copy2(str(src), str(dst))

                        results.append({"ok": True})
                    except Exception as exc:
                        results.append({"ok": False, "error": str(exc)})
                return results

            try:
                results = await asyncio.wait_for(asyncio.to_thread(_link_or_copy_many, pending_ops), timeout=TO_THREAD_TIMEOUT_S)
            except asyncio.TimeoutError as exc:
                result = Result.Err("TIMEOUT", safe_error_message(exc, "Staging timed out"), errors=errors)
                return _json_response(result)
            except Exception as exc:
                result = Result.Err("STAGE_FAILED", safe_error_message(exc, "Failed to stage files"), errors=errors)
                return _json_response(result)

            for op, r in zip(pending_ops, results):
                if not isinstance(r, dict) or not r.get("ok"):
                    errors.append({"file": op.get("raw_filename"), "error": str((r or {}).get("error") or "Failed to stage file")})
                    continue
                try:
                    dest_path = Path(str(op.get("dst") or ""))
                    staged_paths.append(dest_path)
                except Exception as exc:
                    logger.debug("Failed to track staged path: %s", exc)
                staged.append({
                    "name": op.get("name"),
                    "subfolder": op.get("subfolder") or "",
                    "path": str(op.get("dst") or ""),
                })

        if not staged:
            result = Result.Err("STAGE_FAILED", "No files staged", errors=errors)
            return _json_response(result)

        # Ensure staged files are indexed in DB as input assets (best-effort).
        try:
            if index_staged and staged_paths:
                # Index in the background so staging returns quickly (DnD UX),
                # and avoid blocking the aiohttp event loop on ExifTool/FFprobe.
                _schedule_index_task(
                    lambda: svc['index'].index_paths(
                        staged_paths,
                        str(input_root),
                        True,  # incremental
                        "input",
                    )
                )
        except Exception as exc:
            logger.debug("Indexing staged files skipped: %s", exc)

        return _json_response(Result.Ok({"staged": staged, "errors": errors}))

    @routes.post("/mjr/am/upload_input")
    async def upload_input_file(request):
        """
        Upload a file directly to the ComfyUI input directory.

        Multipart form data with 'file' field.
        Query params:
            - purpose: string (optional) - purpose of upload (e.g. "node_drop" for fast path)
        """
        # CSRF protection
        csrf = _csrf_error(request)
        if csrf:
            return _json_response(Result.Err("CSRF", csrf))

        try:
            reader = await request.multipart()

            # Get the file from multipart data
            field = await reader.next()
            if field.name != 'file':
                return _json_response(Result.Err("INVALID_INPUT", "Expected 'file' field"))

            filename = field.filename
            if not filename:
                return _json_response(Result.Err("INVALID_INPUT", "No filename provided"))

            # Get purpose from query params
            purpose = request.query.get("purpose", "").lower().strip()
            skip_index = (purpose == "node_drop")

            # Get input directory (use module-level `folder_paths` so tests can monkeypatch)
            try:
                input_dir = Path(folder_paths.get_input_directory()).resolve()
            except Exception:
                input_dir = Path(__file__).parent.parent.parent.parent / "input"
                input_dir = input_dir.resolve()

            write_res = await _write_multipart_file_atomic(input_dir, str(filename), field)
            if not write_res.ok:
                return _json_response(write_res)
            dest_path = write_res.data

            # Optionally index the file (skip for fast path)
            if not skip_index:
                try:
                    svc, error_result = await _require_services()
                    if svc and svc.get("index"):
                        # Index in the background so upload returns quickly
                        _schedule_index_task(
                            lambda: svc['index'].index_paths(
                                [dest_path],
                                str(input_dir),
                                True,  # incremental
                                "input",
                            )
                        )
                except Exception as exc:
                    logger.debug("Indexing uploaded file skipped: %s", exc)

            return _json_response(Result.Ok({
                "name": dest_path.name,
                "subfolder": "",
                "path": str(dest_path)
            }))

        except Exception as e:
            logger.error(f"Upload failed: {e}")
            return _json_response(Result.Err("UPLOAD_FAILED", "Upload failed"))

    @routes.get("/mjr/am/watcher/status")
    async def watcher_status(request):
        """Get watcher status."""
        svc, error_result = await _require_services()
        if error_result:
            return _json_response(error_result)

        watcher = svc.get("watcher")
        return _json_response(Result.Ok({
            "enabled": watcher is not None and watcher.is_running,
            "directories": watcher.watched_directories if watcher else [],
        }))

    @routes.post("/mjr/am/watcher/toggle")
    async def watcher_toggle(request):
        """Start or stop the file watcher."""
        svc, error_result = await _require_services()
        if error_result:
            return _json_response(error_result)

        csrf = _csrf_error(request)
        if csrf:
            return _json_response(Result.Err("CSRF", csrf))

        body_res = await _read_json(request)
        if not body_res.ok:
            return _json_response(body_res)
        body = body_res.data or {}

        enabled = body.get("enabled", True)
        watcher = svc.get("watcher")

        if enabled:
            # Start watcher
            if watcher and watcher.is_running:
                return _json_response(Result.Ok({"enabled": True, "directories": watcher.watched_directories}))

            from backend.features.index.watcher import OutputWatcher

            index_service = svc.get("index")
            if not index_service:
                return _json_response(Result.Err("SERVICE_UNAVAILABLE", "Index service not available"))

            async def index_callback(filepaths, base_dir, source=None, root_id=None):
                if not filepaths:
                    return
                try:
                    # Give executed-event a moment to mark generated files.
                    await asyncio.sleep(0.2)
                except Exception:
                    pass
                try:
                    from backend.features.index.watcher import is_recent_generated
                    filepaths = [f for f in (filepaths or []) if f and not is_recent_generated(f)]
                except Exception:
                    pass
                if not filepaths:
                    return
                paths = [Path(f) for f in filepaths if f]
                if paths:
                    await index_service.index_paths(
                        paths=paths,
                        base_dir=base_dir,
                        incremental=True,
                        source=source or "watcher",
                        root_id=root_id,
                    )

            new_watcher = OutputWatcher(index_callback)
            scope_cfg = svc.get("watcher_scope") if isinstance(svc, dict) else None
            desired_scope = normalize_scope((scope_cfg or {}).get("scope"))
            desired_root_id = (scope_cfg or {}).get("custom_root_id") or (scope_cfg or {}).get("root_id")
            watch_paths = build_watch_paths(desired_scope, desired_root_id)

            if watch_paths:
                loop = asyncio.get_event_loop()
                await new_watcher.start(watch_paths, loop)
                svc["watcher"] = new_watcher
                svc["watcher_scope"] = {"scope": desired_scope, "custom_root_id": desired_root_id or ""}
                return _json_response(Result.Ok({"enabled": True, "directories": new_watcher.watched_directories}))
            else:
                return _json_response(Result.Err("NO_DIRECTORIES", "No directories to watch"))
        else:
            # Stop watcher
            if watcher:
                await watcher.stop()
                svc["watcher"] = None
            return _json_response(Result.Ok({"enabled": False, "directories": []}))

    @routes.post("/mjr/am/watcher/scope")
    async def watcher_scope(request):
        """Configure watcher to follow a single scope (global mode)."""
        svc, error_result = await _require_services()
        if error_result:
            return _json_response(error_result)

        csrf = _csrf_error(request)
        if csrf:
            return _json_response(Result.Err("CSRF", csrf))

        body_res = await _read_json(request)
        if not body_res.ok:
            return _json_response(body_res)
        body = body_res.data or {}

        scope = normalize_scope(body.get("scope"))
        custom_root_id = body.get("custom_root_id") or body.get("root_id") or body.get("customRootId")
        custom_root_id = str(custom_root_id or "").strip()

        # Persist desired scope in memory even if watcher is disabled.
        svc["watcher_scope"] = {"scope": scope, "custom_root_id": custom_root_id}
        try:
            db = svc.get("db")
            if db:
                await MetadataHelpers.set_metadata_value(db, WATCHER_SCOPE_KEY, str(scope))
                await MetadataHelpers.set_metadata_value(db, WATCHER_CUSTOM_ROOT_ID_KEY, str(custom_root_id or ""))
        except Exception:
            pass

        # If watcher is not enabled, just acknowledge.
        watcher = svc.get("watcher")
        if not watcher or not watcher.is_running:
            return _json_response(Result.Ok({"enabled": False, "directories": [], "scope": scope}))

        from backend.features.index.watcher import OutputWatcher

        index_service = svc.get("index")
        if not index_service:
            return _json_response(Result.Err("SERVICE_UNAVAILABLE", "Index service not available"))

        watch_paths = build_watch_paths(scope, custom_root_id)
        if not watch_paths:
            try:
                if watcher and watcher.is_running:
                    await watcher.stop()
                    svc["watcher"] = None
            except Exception:
                pass
            return _json_response(Result.Ok({"enabled": False, "directories": [], "scope": scope}))

        try:
            await watcher.stop()
        except Exception:
            pass

        async def index_callback(filepaths, base_dir, source=None, root_id=None):
            if not filepaths:
                return
            try:
                # Give executed-event a moment to mark generated files.
                await asyncio.sleep(0.2)
            except Exception:
                pass
            try:
                from backend.features.index.watcher import is_recent_generated
                filepaths = [f for f in (filepaths or []) if f and not is_recent_generated(f)]
            except Exception:
                pass
            if not filepaths:
                return
            paths = [Path(f) for f in filepaths if f]
            if paths:
                await index_service.index_paths(
                    paths=paths,
                    base_dir=base_dir,
                    incremental=True,
                    source=source or "watcher",
                    root_id=root_id,
                )

        new_watcher = OutputWatcher(index_callback)
        loop = asyncio.get_event_loop()
        await new_watcher.start(watch_paths, loop)
        svc["watcher"] = new_watcher
        return _json_response(Result.Ok({"enabled": True, "directories": new_watcher.watched_directories, "scope": scope}))

