"""
Filesystem operations: background scanning and file listing.
"""

from __future__ import annotations

import asyncio
import datetime
import time
from collections import OrderedDict
from pathlib import Path
from typing import Any, Mapping, Optional

from backend.shared import Result, classify_file, get_logger
from backend.adapters.fs.list_cache_watcher import ensure_fs_list_cache_watching, get_fs_list_cache_token
from backend.config import (
    FS_LIST_CACHE_MAX,
    FS_LIST_CACHE_TTL_SECONDS,
    FS_LIST_CACHE_WATCHDOG,
    BG_SCAN_FAILURE_HISTORY_MAX,
    SCAN_PENDING_MAX,
    MANUAL_BG_SCAN_GRACE_SECONDS,
)
from shared.scan_throttle import normalize_scan_directory, should_skip_background_scan
from ..core import _safe_rel_path, _is_within_root, _require_services

logger = get_logger(__name__)

# Locks for async concurrency safety
_BACKGROUND_SCAN_LOCK = asyncio.Lock()
_BACKGROUND_SCAN_LAST: dict[str, dict[str, Any]] = {}
_BACKGROUND_SCAN_FAILURES: list[dict[str, Any]] = []
_MAX_FAILURE_HISTORY = int(BG_SCAN_FAILURE_HISTORY_MAX)

_SCAN_PENDING_LOCK = asyncio.Lock()
_SCAN_PENDING: OrderedDict[str, dict[str, Any]] = OrderedDict()
_SCAN_TASK: Optional[asyncio.Task] = None
_SCAN_PENDING_MAX = int(SCAN_PENDING_MAX)
_WORKER_SHUTDOWN = asyncio.Event()

_FS_LIST_CACHE_LOCK = asyncio.Lock()
_FS_LIST_CACHE: OrderedDict[str, dict[str, Any]] = OrderedDict()


async def _kickoff_background_scan(
    directory: str,
    *,
    source: str = "output",
    root_id: Optional[str] = None,
    recursive: bool = True,
    incremental: bool = True,
    fast: bool = True,
    background_metadata: bool = True,
    min_interval_seconds: float = 10.0,
) -> None:
    """
    Fire-and-forget indexing into the DB.

    Used to ensure input/custom folders get indexed without blocking list requests.
    """
    normalized_dir = normalize_scan_directory(directory)
    if should_skip_background_scan(normalized_dir, source, root_id, MANUAL_BG_SCAN_GRACE_SECONDS):
        return

    try:
        key = f"{source}|{str(root_id or '')}|{normalized_dir}"
        now = time.time()
        
        entry = _ensure_background_entry(key)
        if entry["in_progress"]:
            return
        if now - entry["last"] < min_interval_seconds:
            return
        entry["last"] = now
        entry["in_progress"] = False

    except Exception:
        return

    job = {
        "directory": str(normalized_dir),
        "source": str(source),
        "root_id": str(root_id) if root_id is not None else None,
        "recursive": bool(recursive),
        "incremental": bool(incremental),
        "fast": bool(fast),
        "background_metadata": bool(background_metadata),
    }

    _ensure_worker()

    async with _SCAN_PENDING_LOCK:
        # Move to end if exists (refresh priority)
        if key in _SCAN_PENDING:
            del _SCAN_PENDING[key]
        _SCAN_PENDING[key] = job
        
        # Enforce max pending size
        while len(_SCAN_PENDING) > _SCAN_PENDING_MAX:
            _SCAN_PENDING.popitem(last=False)


def _ensure_worker() -> None:
    global _SCAN_TASK
    if _SCAN_TASK and not _SCAN_TASK.done():
        return
    
    _SCAN_TASK = asyncio.create_task(_worker_loop())


def shutdown_worker() -> None:
    _WORKER_SHUTDOWN.set()


async def _worker_loop() -> None:
    while not _WORKER_SHUTDOWN.is_set():
        task = None
        async with _SCAN_PENDING_LOCK:
            if _SCAN_PENDING:
                _, task = _SCAN_PENDING.popitem(last=False)
            else:
                task = None
        
        if not task:
            try:
                await asyncio.wait_for(_WORKER_SHUTDOWN.wait(), timeout=0.5)
            except asyncio.TimeoutError:
                pass
            continue

        entry: Optional[dict[str, Any]] = None
        try:
            key = _build_task_key(task)
            entry = _ensure_background_entry(key)
            entry["in_progress"] = True
            entry["last"] = time.time()

            # Import strictly locally or use the core helper to avoid circular imports if possible
            # But here we are effectively inside backend.routes.handlers
            # We can use the helper from core.
            svc, error_result = await _require_services()
            if error_result:
                _record_scan_failure(str(task.get("directory")), str(task.get("source")), "SERVICE_UNAVAILABLE", str(error_result.error or ""))
                await asyncio.sleep(2) # Backoff if services unavailable
                continue

            try:
                try:
                    await svc["index"].scan_directory(
                        str(task.get("directory")),
                        bool(task.get("recursive")),
                        bool(task.get("incremental")),
                        source=str(task.get("source") or "output"),
                        root_id=task.get("root_id"),
                        fast=bool(task.get("fast")),
                        background_metadata=bool(task.get("background_metadata")),
                    )
                except TypeError:
                     # Fallback in case of call signature mismatch
                    await svc["index"].scan_directory(
                        str(task.get("directory")),
                        bool(task.get("recursive")),
                        bool(task.get("incremental")),
                        source=str(task.get("source") or "output"),
                        root_id=task.get("root_id"),
                    )
            except Exception as exc:
                _record_scan_failure(str(task.get("directory")), str(task.get("source")), "SCAN_FAILED", str(exc))
                logger.warning("Background scan failed: %s", exc)
                
        except Exception:
            try:
                _record_scan_failure(str(task.get("directory")), str(task.get("source")), "EXCEPTION", "Unhandled exception")
            except Exception:
                pass
        finally:
            if entry is not None:
                entry["in_progress"] = False
                entry["last"] = time.time()
        
        # Yield to event loop
        await asyncio.sleep(0)


def _record_scan_failure(directory: str, source: str, code: str, error: str) -> None:
    # No async lock needed for simple append/pop in main thread
    _BACKGROUND_SCAN_FAILURES.insert(0, {
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "directory": directory,
        "source": source,
        "code": code,
        "error": error
    })
    # Trim
    while len(_BACKGROUND_SCAN_FAILURES) > _MAX_FAILURE_HISTORY:
        _BACKGROUND_SCAN_FAILURES.pop()


def _ensure_background_entry(key: str) -> dict[str, Any]:
    entry = _BACKGROUND_SCAN_LAST.get(key)
    if isinstance(entry, dict):
        return entry
    if isinstance(entry, (int, float)):
        entry = {"last": float(entry), "in_progress": False}
    else:
        entry = {"last": 0.0, "in_progress": False}
    _BACKGROUND_SCAN_LAST[key] = entry
    return entry


def _build_task_key(task: dict[str, Any]) -> str:
    source = str(task.get("source") or "output")
    root_id = str(task.get("root_id") or "")
    directory = normalize_scan_directory(str(task.get("directory") or ""))
    return f"{source}|{root_id}|{directory}"


async def _fs_cache_get_or_build(
    base: Path,
    target_dir_resolved: Path,
    asset_type: str,
    root_id: Optional[str],
) -> Result[dict[str, Any]]:
    # Made async to allow async locking if needed, though mostly sync logic
    try:
        if FS_LIST_CACHE_WATCHDOG:
            ensure_fs_list_cache_watching(str(base))
    except Exception:
        pass

    try:
        dir_mtime_ns = target_dir_resolved.stat().st_mtime_ns
    except OSError as exc:
        return Result.Err("DIR_NOT_FOUND", f"Directory not found: {exc}")

    try:
        watch_token = get_fs_list_cache_token(str(base)) if FS_LIST_CACHE_WATCHDOG else 0
    except Exception:
        watch_token = 0

    cache_key = f"{str(base)}|{str(target_dir_resolved)}|{asset_type}|{str(root_id or '')}"
    
    async with _FS_LIST_CACHE_LOCK:
        cached = _FS_LIST_CACHE.get(cache_key)
        if (
            cached
            and cached.get("dir_mtime_ns") == dir_mtime_ns
            and cached.get("watch_token") == watch_token
            and isinstance(cached.get("entries"), list)
        ):
            try:
                now = time.time()
                cached_at = float(cached.get("cached_at") or 0.0)
                if cached_at and (now - cached_at) <= float(FS_LIST_CACHE_TTL_SECONDS):
                    _FS_LIST_CACHE.move_to_end(cache_key)
                    return Result.Ok({"entries": cached["entries"], "dir_mtime_ns": dir_mtime_ns})
            except Exception:
                pass
            _FS_LIST_CACHE.move_to_end(cache_key)

    entries: list[dict[str, Any]] = []
    try:
        # Note: os.scandir/iterdir is synchronous I/O. 
        # For large directories, this will block the loop.
        # Ideally this should run in a thread executor, but for now we keep it simple.
        for entry in target_dir_resolved.iterdir():
            if not entry.is_file():
                continue
            filename = entry.name
            kind = classify_file(filename)
            if kind == "unknown":
                continue
            try:
                stat = entry.stat()
            except OSError:
                continue

            try:
                rel_to_root = entry.parent.relative_to(base)
                sub = "" if str(rel_to_root) == "." else str(rel_to_root).replace("\\", "/")
            except ValueError:
                sub = ""
                
            entries.append(
                {
                    "id": None,
                    "filename": filename,
                    "subfolder": sub,
                    "filepath": str(entry),
                    "kind": kind,
                    "ext": entry.suffix.lower(),
                    "size": stat.st_size,
                    "mtime": int(stat.st_mtime),
                    "width": None,
                    "height": None,
                    "duration": None,
                    "rating": 0,
                    "tags": [],
                    "has_workflow": 0,
                    "has_generation_data": 0,
                    "type": asset_type,
                    "root_id": root_id,
                }
            )
    except OSError as exc:
        return Result.Err("LIST_FAILED", f"Failed to list directory: {exc}")

    async with _FS_LIST_CACHE_LOCK:
        _FS_LIST_CACHE[cache_key] = {
            "dir_mtime_ns": dir_mtime_ns,
            "watch_token": watch_token,
            "entries": entries,
            "cached_at": time.time(),
        }
        _FS_LIST_CACHE.move_to_end(cache_key)
        while len(_FS_LIST_CACHE) > int(FS_LIST_CACHE_MAX):
            _FS_LIST_CACHE.popitem(last=False)

    return Result.Ok({"entries": entries, "dir_mtime_ns": dir_mtime_ns})


async def _list_filesystem_assets(
    root_dir: Path,
    subfolder: str,
    query: str,
    limit: int,
    offset: int,
    asset_type: str,
    root_id: Optional[str] = None,
    filters: Optional[Mapping[str, Any]] = None,
    index_service: Optional[Any] = None,
) -> Result[dict[str, Any]]:
    try:
        base = root_dir.resolve()
    except OSError as exc:
        return Result.Err("INVALID_INPUT", f"Invalid root directory: {exc}")

    rel = _safe_rel_path(subfolder or "")
    if rel is None:
        return Result.Err("INVALID_INPUT", "Invalid subfolder")

    target_dir = (base / rel)
    try:
        target_dir_resolved = target_dir.resolve(strict=True)
    except OSError:
        return Result.Err("DIR_NOT_FOUND", f"Directory not found: {target_dir}")

    if not _is_within_root(target_dir_resolved, base):
        return Result.Err("INVALID_INPUT", "Subfolder outside root")

    q = (query or "*").strip()
    q_lower = q.lower()
    browse_all = q == "*" or q == ""

    filter_kind = str(filters.get("kind") or "").strip().lower() if filters is not None else ""
    filter_min_rating = int(filters.get("min_rating") or 0) if filters is not None else 0
    filter_workflow_only = bool(filters.get("has_workflow")) if filters is not None else False

    mtime_start_raw = filters.get("mtime_start") if filters is not None else None
    mtime_end_raw = filters.get("mtime_end") if filters is not None else None
    filter_mtime_start = int(mtime_start_raw) if mtime_start_raw is not None else None
    filter_mtime_end = int(mtime_end_raw) if mtime_end_raw is not None else None

    # Changed to await the async cache builder
    cache_result = await _fs_cache_get_or_build(base, target_dir_resolved, asset_type, root_id)
    if not cache_result.ok:
        return cache_result
    all_entries = cache_result.data.get("entries") if isinstance(cache_result.data, dict) else None
    if not isinstance(all_entries, list):
        return Result.Err("LIST_FAILED", "Failed to list directory")

    entries = []
    for item in all_entries:
        if not isinstance(item, dict):
            continue
        filename = str(item.get("filename") or "")
        kind = str(item.get("kind") or "")
        if not filename or kind == "unknown":
            continue
        if filter_kind and kind != filter_kind:
            continue
        if not browse_all and q_lower not in filename.lower():
            continue
        entries.append(item)

    entries.sort(key=lambda x: x.get("mtime") or 0, reverse=True)

    # Enrich with DB fields (workflow/generation/tags/rating) when available.
    try:
        lookup = getattr(index_service, "lookup_assets_by_filepaths", None)
        if callable(lookup) and entries:
            filepaths = [str(a.get("filepath") or "") for a in entries if isinstance(a, dict)]
            filepaths = [p for p in filepaths if p]
            if filepaths:
                enrich_result = await lookup(filepaths)
                if enrich_result and getattr(enrich_result, "ok", False) and isinstance(enrich_result.data, dict):
                    mapping = enrich_result.data
                    for asset in entries:
                        if not isinstance(asset, dict):
                            continue
                        fp = str(asset.get("filepath") or "")
                        db_row = mapping.get(fp)
                        if not isinstance(db_row, dict):
                            continue
                        asset["id"] = db_row.get("id")
                        asset["rating"] = int(db_row.get("rating") or 0)
                        asset["tags"] = db_row.get("tags") or []
                        asset["has_workflow"] = int(db_row.get("has_workflow") or 0)
                        has_gen = int(db_row.get("has_generation_data") or 0)
                        asset["has_generation_data"] = has_gen
                        # Prefer stored root_id if present (custom)
                        if db_row.get("root_id"):
                            asset["root_id"] = db_row.get("root_id")
    except Exception as exc:
        logger.debug("Filesystem DB enrichment skipped: %s", exc)

    # Apply filters after enrichment.
    total = 0
    paged: list[dict[str, Any]] = []
    start = max(0, int(offset or 0))
    limit_int = int(limit or 0)
    end = start + limit_int if limit_int > 0 else None

    for item in entries:
        if filter_kind and item.get("kind") != filter_kind:
            continue
        if filter_min_rating > 0 and int(item.get("rating", 0)) < filter_min_rating:
            continue
        if filter_workflow_only and not int(item.get("has_workflow", 0)):
            continue
        try:
            entry_mtime = int(item.get("mtime") or 0)
        except Exception:
            entry_mtime = 0
        if filter_mtime_start is not None and entry_mtime < filter_mtime_start:
            continue
        if filter_mtime_end is not None and entry_mtime >= filter_mtime_end:
            continue
        if not browse_all and q_lower not in str(item.get("filename", "")).lower():
            continue

        # This entry passed all filters; count it for total.
        if total >= start:
            if end is None or len(paged) < (end - start):
                paged.append(item)
        total += 1

    return Result.Ok({"assets": paged, "total": total, "limit": limit, "offset": offset, "query": q})
