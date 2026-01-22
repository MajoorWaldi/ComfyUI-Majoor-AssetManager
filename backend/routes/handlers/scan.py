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

from backend.config import OUTPUT_ROOT
from backend.custom_roots import resolve_custom_root
from backend.shared import Result, get_logger
from ..core import (
    _json_response,
    _require_services,
    _csrf_error,
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

_MAX_UPLOAD_SIZE = int(os.environ.get("MJR_MAX_UPLOAD_SIZE", str(500 * 1024 * 1024)))
_MAX_CONCURRENT_INDEX = int(os.environ.get("MJR_MAX_CONCURRENT_INDEX", "10"))
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
                chunk = await field.read_chunk(size=262144)
                if not chunk:
                    break
                total += len(chunk)
                if total > _MAX_UPLOAD_SIZE:
                    raise ValueError(f"File exceeds maximum size ({_MAX_UPLOAD_SIZE} bytes)")
                f.write(chunk)

        tmp_obj = Path(str(tmp_path))
        final = dest_dir / safe_name
        counter = 0
        while final.exists():
            counter += 1
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

def _files_equal_content(src: Path, dst: Path, *, chunk_size: int = 4 * 1024 * 1024) -> bool:
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
    @routes.post("/mjr/am/scan")
    async def scan_directory(request):
        """
        Scan a directory for assets.

        JSON body:
            directory: Path to scan (optional, defaults to ComfyUI output directory)
            recursive: Scan subdirectories (default: true)
            incremental: Only update changed files (default: true)
        """
        svc, error_result = _require_services()
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
                out_res = await asyncio.to_thread(
                    svc["index"].scan_directory,
                    str(Path(OUTPUT_ROOT).resolve()),
                    recursive,
                    incremental,
                    "output",
                    None,
                    fast,
                    background_metadata,
                )
                in_res = await asyncio.to_thread(
                    svc["index"].scan_directory,
                    str(Path(folder_paths.get_input_directory()).resolve()),
                    recursive,
                    incremental,
                    "input",
                    None,
                    fast,
                    background_metadata,
                )
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
            result = await asyncio.to_thread(
                svc["index"].scan_directory,
                str(normalized_dir),
                recursive,
                incremental,
                scan_source,
                scan_root_id,
                fast,
                background_metadata,
            )
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
        svc, error_result = _require_services()
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
        if not isinstance(files, list) or not files:
            result = Result.Err("INVALID_INPUT", "Missing or invalid 'files' list")
            return _json_response(result)

        incremental = body.get("incremental", True)
        grouped_paths: Dict[Tuple[str, str, str], list] = {}

        for item in files:
            if not isinstance(item, dict):
                continue
            filename = item.get("filename") or item.get("name")
            if not filename:
                continue
            subfolder = item.get("subfolder") or ""
            file_type = (item.get("type") or "output").lower()
            root_id = item.get("root_id") or item.get("custom_root_id")

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

        if not grouped_paths:
            result = Result.Err("INVALID_INPUT", "No valid files to index")
            return _json_response(result)

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
                result = await asyncio.to_thread(
                    svc["index"].index_paths,
                    paths,
                    base_dir,
                    incremental,
                    source,
                    (root_id or None),
                )
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

    @routes.post("/mjr/am/stage-to-input")
    async def stage_to_input(request):
        """
        Copy files into the ComfyUI input directory.

        JSON body:
            files: [{ filename, subfolder?, type? }]
            index: bool (optional, default true) - whether to index staged files into the DB
            purpose: string (optional) - purpose of staging (e.g. "node_drop" for fast path)
        """
        svc, error_result = _require_services()
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

            try:
                # Performance: for large media, copying can be slow. Run in thread to avoid blocking event loop.
                # Prefer a hardlink when possible (same filesystem/volume). Fall back to copy2 if linking is not supported.
                def link_or_copy():
                    did_link = False
                    try:
                        src = Path(str(normalized))
                        dst = Path(str(dest_path))
                        # Only attempt hardlink when both paths are on the same drive (Windows)
                        # or when the OS supports hardlinks generally.
                        same_drive = True
                        try:
                            if getattr(src, "drive", "") and getattr(dst, "drive", ""):
                                same_drive = src.drive.lower() == dst.drive.lower()
                        except Exception:
                            same_drive = True

                        if same_drive:
                            import os
                            os.link(str(src), str(dst))
                            did_link = True
                    except Exception:
                        did_link = False

                    if not did_link:
                        shutil.copy2(str(normalized), str(dest_path))
                    return did_link

                # Run the potentially slow file operation in a thread
                did_link = await asyncio.to_thread(link_or_copy)
            except Exception as exc:
                errors.append({"file": raw_filename, "error": str(exc)})
                continue
            try:
                staged_paths.append(dest_path)
            except Exception as exc:
                logger.debug("Failed to track staged path: %s", exc)

            staged.append({
                "name": dest_path.name,
                "subfolder": "" if dest_dir == input_root else str(dest_dir.relative_to(input_root)),
                "path": str(dest_path)
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
                    lambda: asyncio.to_thread(
                        svc["index"].index_paths,
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

            # Get input directory
            try:
                import folder_paths
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
                    svc, error_result = _require_services()
                    if svc and svc.get("index"):
                        # Index in the background so upload returns quickly
                        _schedule_index_task(
                            lambda: asyncio.to_thread(
                                svc["index"].index_paths,
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

    @routes.get("/mjr/am/download")
    async def download_asset(request):
        """
        Download an asset file by asset ID or path.

        Query params:
            - asset_id: integer asset ID (optional)
            - path: relative path (optional)
            - type: asset type (output, input, custom) - default: output
            - filename: filename for Content-Disposition header
        """
        from aiohttp import web, StreamResponse
        import mimetypes
        from pathlib import Path

        # Get parameters
        asset_id = request.query.get("asset_id")
        path = request.query.get("path")
        asset_type = request.query.get("type", "output").lower()
        filename = request.query.get("filename")

        # Validate inputs
        if not asset_id and not path:
            return _json_response(Result.Err("INVALID_INPUT", "Either asset_id or path must be provided"))

        # Get file path based on asset_id or path
        file_path = None

        if asset_id:
            try:
                asset_id = int(asset_id)
            except ValueError:
                return _json_response(Result.Err("INVALID_INPUT", "Invalid asset_id"))

            # Get asset from database
            svc, error_result = _require_services()
            if error_result:
                return _json_response(error_result)

            try:
                asset_result = await svc["index"].get_asset(asset_id)
                if not asset_result.ok or not asset_result.data:
                    return _json_response(Result.Err("NOT_FOUND", "Asset not found"))

                asset_data = asset_result.data
                file_path = Path(asset_data.get("filepath", ""))

                if not filename:
                    filename = asset_data.get("filename", "download")
            except Exception as e:
                return _json_response(Result.Err("QUERY_ERROR", f"Error fetching asset: {str(e)}"))
        else:
            # Use path directly
            if asset_type == "input":
                try:
                    import folder_paths
                    base_dir = Path(folder_paths.get_input_directory())
                except Exception:
                    base_dir = Path(__file__).parent.parent.parent.parent / "input"
            elif asset_type == "custom":
                # For custom paths, we need to validate carefully
                return _json_response(Result.Err("INVALID_INPUT", "Path-based download not supported for custom assets"))
            else:  # output
                from backend.config import OUTPUT_ROOT
                base_dir = Path(OUTPUT_ROOT)

            # Validate path is within allowed directory
            try:
                file_path = (base_dir / path).resolve()
                if not _is_within_root(file_path, base_dir):
                    return _json_response(Result.Err("INVALID_INPUT", "Path outside allowed directory"))
            except Exception:
                return _json_response(Result.Err("INVALID_INPUT", "Invalid path"))

        # Validate file exists
        if not file_path or not file_path.exists() or not file_path.is_file():
            return _json_response(Result.Err("NOT_FOUND", "File not found"))

        # Validate file is allowed to be accessed
        if not _is_path_allowed(file_path):
            return _json_response(Result.Err("FORBIDDEN", "File access not allowed"))

        # Sanitize filename to prevent header injection
        safe_filename = (filename or file_path.name).replace('"', '').replace('\r', '').replace('\n', '')
        safe_filename = safe_filename[:255]  # Limit length

        # Determine content type
        content_type, _ = mimetypes.guess_type(str(file_path))
        if not content_type:
            content_type = "application/octet-stream"

        # Use FileResponse for better performance with large files
        from aiohttp import FileResponse
        return FileResponse(
            file_path,
            headers={
                "Content-Type": content_type,
                "Content-Disposition": f'attachment; filename="{safe_filename}"',
                "Cache-Control": "no-cache",
                "Content-Security-Policy": "default-src 'none'",
                "X-Content-Type-Options": "nosniff",
            }
        )
