"""
Index scanner - handles directory scanning and file indexing operations.
"""
import hashlib
import logging
import os
import time
import threading
import asyncio
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from queue import Empty, Queue
from typing import List, Dict, Any, Iterable, Optional
from datetime import datetime
from uuid import uuid4

from ...shared import get_logger, Result, classify_file, FileKind, ErrorCode, log_structured, EXTENSIONS
from ...adapters.db.sqlite import Sqlite
from ...config import (
    SCAN_BATCH_SMALL_THRESHOLD,
    SCAN_BATCH_MED_THRESHOLD,
    SCAN_BATCH_LARGE_THRESHOLD,
    SCAN_BATCH_SMALL,
    SCAN_BATCH_MED,
    SCAN_BATCH_LARGE,
    SCAN_BATCH_XL,
    MAX_TO_ENRICH_ITEMS,
)
from ..metadata import MetadataService
from .metadata_helpers import MetadataHelpers


logger = get_logger(__name__)

# Single-thread executor to ensure the directory walk generator is never advanced from
# different threads (which can cause subtle corruption / deadlocks).
_FS_WALK_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="mjr-fs-walk")

MAX_TRANSACTION_BATCH_SIZE = 500
MAX_SCAN_JOURNAL_LOOKUP = 5000
STAT_RETRY_COUNT = 3
STAT_RETRY_BASE_DELAY_S = 0.15

_EXT_TO_KIND: Dict[str, FileKind] = {}
try:
    for _kind, _exts in (EXTENSIONS or {}).items():
        for _ext in _exts or []:
            _EXT_TO_KIND[str(_ext).lower()] = _kind  # type: ignore[assignment]
except Exception:
    _EXT_TO_KIND = {}


class IndexScanner:
    """
    Handles directory scanning and file indexing operations.

    Provides recursive directory scanning, incremental updates based on mtime,
    and integration with metadata extraction.
    """

    def __init__(self, db: Sqlite, metadata_service: MetadataService, scan_lock: asyncio.Lock):
        """
        Initialize index scanner.

        Args:
            db: Database adapter instance
            metadata_service: Metadata service for extraction
            scan_lock: Shared lock for database operations
        """
        self.db = db
        self.metadata = metadata_service
        self._scan_lock = scan_lock
        self._current_scan_id = None

    async def scan_directory(
        self,
        directory: str,
        recursive: bool = True,
        incremental: bool = True,
        source: str = "output",
        root_id: Optional[str] = None,
        fast: bool = False,
        background_metadata: bool = False,
    ) -> Result[Dict[str, Any]]:
        """
        Scan a directory for asset files.

        Args:
            directory: Path to scan
            recursive: Scan subdirectories
            incremental: Only update changed files (based on mtime)
            source: Source identifier for the scan
            root_id: Root identifier for the scan
            fast: Skip metadata extraction during scan
            background_metadata: Enable background metadata enrichment

        Returns:
            Result with scan statistics
        """
        to_enrich: List[str] = []
        async with self._scan_lock:
            dir_path = Path(directory)

            if not dir_path.exists():
                return Result.Err("DIR_NOT_FOUND", f"Directory not found: {directory}")

            if not dir_path.is_dir():
                return Result.Err("NOT_A_DIRECTORY", f"Not a directory: {directory}")

            scan_id = str(uuid4())
            self._current_scan_id = scan_id
            scan_start = time.perf_counter()

            self._log_scan_event(
                logging.INFO,
                "Starting directory scan",
                directory=directory,
                recursive=recursive,
                incremental=incremental,
                files_root=str(dir_path)
            )

            stats = {
                "scanned": 0,
                "added": 0,
                "updated": 0,
                "skipped": 0,
                "errors": 0,
                "start_time": datetime.now().isoformat()
            }

            def _stream_batch_target(scanned_count: int) -> int:
                try:
                    n = int(scanned_count or 0)
                except (ValueError, TypeError):
                    n = 0
                if n <= SCAN_BATCH_SMALL_THRESHOLD:
                    return int(SCAN_BATCH_SMALL)
                if n <= SCAN_BATCH_MED_THRESHOLD:
                    return int(SCAN_BATCH_MED)
                if n <= SCAN_BATCH_LARGE_THRESHOLD:
                    return int(SCAN_BATCH_LARGE)
                return int(SCAN_BATCH_XL)

            try:
                # IMPORTANT: os.walk() / Path.iterdir() are blocking and can freeze aiohttp.
                # Walk the filesystem in a dedicated thread and consume results in batches.
                loop = asyncio.get_running_loop()
                stop_event = threading.Event()
                q: "Queue[Optional[Path]]" = Queue(maxsize=max(1000, int(SCAN_BATCH_XL) * 4))

                def _walk_and_put() -> None:
                    try:
                        for fp in self._iter_files(dir_path, recursive):
                            if stop_event.is_set():
                                break
                            try:
                                q.put(fp)
                            except Exception:
                                break
                    except Exception:
                        pass
                    finally:
                        try:
                            q.put(None)
                        except Exception:
                            pass

                walk_future = loop.run_in_executor(_FS_WALK_EXECUTOR, _walk_and_put)

                def _get_many(max_items: int) -> list[Optional[Path]]:
                    items: list[Optional[Path]] = []
                    try:
                        first = q.get()
                    except Exception:
                        return items
                    items.append(first)
                    # Drain without blocking.
                    try:
                        while len(items) < max(1, int(max_items or 1)):
                            try:
                                items.append(q.get_nowait())
                            except Empty:
                                break
                    except Exception:
                        pass
                    return items

                batch: List[Path] = []
                done = False
                try:
                    while not done:
                        target = _stream_batch_target(stats["scanned"])
                        pulled = await asyncio.to_thread(_get_many, target)
                        if not pulled:
                            # Yield and try again.
                            await asyncio.sleep(0)
                            continue

                        for file_path in pulled:
                            if file_path is None:
                                done = True
                                break

                            batch.append(file_path)
                            stats["scanned"] += 1

                            if len(batch) >= _stream_batch_target(stats["scanned"]):
                                await self._scan_stream_batch(
                                    batch=batch,
                                    base_dir=directory,
                                    incremental=incremental,
                                    source=source,
                                    root_id=root_id,
                                    fast=fast,
                                    stats=stats,
                                    to_enrich=to_enrich,
                                )
                                batch = []

                    if batch:
                        await self._scan_stream_batch(
                            batch=batch,
                            base_dir=directory,
                            incremental=incremental,
                            source=source,
                            root_id=root_id,
                            fast=fast,
                            stats=stats,
                            to_enrich=to_enrich,
                        )
                        batch = []
                except asyncio.CancelledError:
                    stop_event.set()
                    raise
                finally:
                    stop_event.set()
                    try:
                        await asyncio.wait_for(walk_future, timeout=2.0)
                    except Exception:
                        pass
            finally:
                stats["end_time"] = datetime.now().isoformat()
                duration = time.perf_counter() - scan_start

                await MetadataHelpers.set_metadata_value(self.db, "last_scan_end", stats["end_time"])

                self._log_scan_event(
                    logging.INFO,
                    "Directory scan complete",
                    duration_seconds=duration,
                    scanned=stats["scanned"],
                    added=stats["added"],
                    updated=stats["updated"],
                    skipped=stats["skipped"],
                    errors=stats["errors"]
                )
                self._current_scan_id = None

        # Return to_enrich list for background enrichment
        if to_enrich:
            stats["to_enrich"] = to_enrich

        logger.debug(
            f"Scan complete: {stats['added']} added, "
            f"{stats['updated']} updated, {stats['skipped']} skipped, "
            f"{stats['errors']} errors"
        )

        return Result.Ok(stats)

    async def _scan_stream_batch(
        self,
        *,
        batch: List[Path],
        base_dir: str,
        incremental: bool,
        source: str,
        root_id: Optional[str],
        fast: bool,
        stats: Dict[str, Any],
        to_enrich: List[str],
    ) -> None:
        if not batch:
            return

        filepaths = [str(p) for p in batch]
        journal_map = (await self._get_journal_entries(filepaths)) if incremental and filepaths else {}
        existing_map: Dict[str, Dict[str, Any]] = {}

        if filepaths:
            existing_rows = await self.db.aquery_in(
                "SELECT filepath, id, mtime FROM assets WHERE {IN_CLAUSE}",
                "filepath",
                filepaths,
            )
            if existing_rows.ok and existing_rows.data and len(existing_rows.data) > 0:
                for row in existing_rows.data:
                    fp = row.get("filepath")
                    if fp:
                        existing_map[str(fp)] = row

        await self._index_batch(
            batch=batch,
            base_dir=base_dir,
            incremental=incremental,
            source=source,
            root_id=root_id,
            fast=fast,
            journal_map=journal_map,
            existing_map=existing_map,
            stats=stats,
            to_enrich=to_enrich,
        )

    async def index_paths(
        self,
        paths: List[Path],
        base_dir: str,
        incremental: bool = True,
        source: str = "output",
        root_id: Optional[str] = None,
    ) -> Result[Dict[str, Any]]:
        """
        Index a list of file paths (no directory scan).

        Args:
            paths: List of file paths to index
            base_dir: Base directory for relative path calculation
            incremental: Skip if already indexed and unchanged
            source: Source identifier for the index
            root_id: Root identifier for the index

        Returns:
            Result with indexing statistics
        """
        async with self._scan_lock:
            # Filter unsupported files to prevent indexing internal files (DBs, etc.)
            filtered_paths = []
            for p in paths:
                try:
                    ext = p.suffix.lower() if p.suffix else ""
                    if ext and _EXT_TO_KIND:
                        if _EXT_TO_KIND.get(ext, "unknown") != "unknown":
                            filtered_paths.append(p)
                            continue
                    if classify_file(str(p)) != "unknown":
                        filtered_paths.append(p)
                except Exception:
                    pass
            paths = filtered_paths
            
            if not paths:
                return Result.Ok({
                    "scanned": 0, "added": 0, "updated": 0, "skipped": 0, "errors": 0,
                    "start_time": datetime.now().isoformat(),
                    "end_time": datetime.now().isoformat()
                })

            scan_id = str(uuid4())
            self._current_scan_id = scan_id
            scan_start = time.perf_counter()

            # Reduce log noise for single-file indexing (common in watchers)
            start_log_level = logging.DEBUG if len(paths) == 1 else logging.INFO
            self._log_scan_event(
                start_log_level,
                "Starting file list index",
                file_count=len(paths),
                base_dir=base_dir,
                incremental=incremental
            )

            stats = {
                "scanned": len(paths),
                "added": 0,
                "updated": 0,
                "skipped": 0,
                "errors": 0,
                "start_time": datetime.now().isoformat()
            }

            try:
                for batch in self._chunk_file_batches(paths):
                    if not batch:
                        continue

                    filepaths = [str(p) for p in batch]
                    journal_map = (await self._get_journal_entries(filepaths)) if incremental and filepaths else {}
                    existing_map: Dict[str, Dict[str, Any]] = {}

                    if filepaths:
                        existing_rows = await self.db.aquery_in(
                            "SELECT filepath, id, mtime FROM assets WHERE {IN_CLAUSE}",
                            "filepath",
                            filepaths,
                        )
                        if existing_rows.ok and existing_rows.data and len(existing_rows.data) > 0:
                            for row in existing_rows.data:
                                fp = row.get("filepath")
                                if fp:
                                    existing_map[str(fp)] = row

                    await self._index_batch(
                        batch=batch,
                        base_dir=base_dir,
                        incremental=incremental,
                        source=source,
                        root_id=root_id,
                        fast=False,
                        journal_map=journal_map,
                        existing_map=existing_map,
                        stats=stats,
                        to_enrich=None,
                    )
            finally:
                stats["end_time"] = datetime.now().isoformat()
                duration = time.perf_counter() - scan_start

                # Do not update last_scan_end for targeted indexing (DnD, executed events, etc.).
                # The UI uses last_scan_end to detect *full scans* and reload the grid; updating it
                # for single-file indexing causes unnecessary grid reloads/flicker.
                await MetadataHelpers.set_metadata_value(self.db, "last_index_end", stats["end_time"])

                # Only log completion at INFO if meaningful changes occurred
                has_changes = stats["added"] > 0 or stats["updated"] > 0 or stats["errors"] > 0
                complete_log_level = logging.INFO if has_changes else logging.DEBUG

                self._log_scan_event(
                    complete_log_level,
                    "File list index complete",
                    duration_seconds=duration,
                    scanned=stats["scanned"],
                    added=stats["added"],
                    updated=stats["updated"],
                    skipped=stats["skipped"],
                    errors=stats["errors"]
                )
                self._current_scan_id = None

        return Result.Ok(stats)

    async def _index_batch(
        self,
        batch: List[Path],
        base_dir: str,
        incremental: bool,
        source: str,
        root_id: Optional[str],
        fast: bool,
        journal_map: Dict[str, str],
        existing_map: Dict[str, Dict[str, Any]],
        stats: Dict[str, Any],
        to_enrich: Optional[List[str]] = None,
    ) -> None:
        """
        Index a batch of files using a single transaction for all DB writes.

        This drastically reduces SQLite transaction overhead on large scans (10k+ files)
        while keeping the "do not crash UI" and Result patterns intact.
        """

        # Phase 1: Stat files and determine which need metadata extraction
        prepared: List[Dict[str, Any]] = []
        needs_metadata: List[tuple[Path, str, int, int, str, Optional[int]]] = []  # (path, filepath, mtime, size, state_hash, existing_id)

        # Prefetch metadata cache and asset_metadata entries for the entire batch to avoid N+1 queries
        filepaths = [str(p) for p in batch]
        cache_map = {}
        has_meta_set = set()

        if filepaths:
            # Prefetch metadata_cache entries
            cache_rows = await self.db.aquery_in(
                "SELECT filepath, state_hash, metadata_raw FROM metadata_cache WHERE {IN_CLAUSE}",
                "filepath",
                filepaths,
            )
            if cache_rows.ok and cache_rows.data:
                for row in cache_rows.data:
                    fp = row.get("filepath")
                    state_hash = row.get("state_hash")
                    if fp and state_hash:
                        cache_map[(fp, state_hash)] = row.get("metadata_raw")

            # Prefetch asset_metadata entries
            asset_ids = []
            for fp in filepaths:
                existing_state = existing_map.get(fp)
                if existing_state and existing_state.get("id"):
                    try:
                        existing_id = int(existing_state.get("id") or 0)
                        if existing_id:
                            asset_ids.append(existing_id)
                    except (ValueError, TypeError):
                        pass

            if asset_ids:
                meta_rows = await self.db.aquery_in(
                    "SELECT asset_id FROM asset_metadata WHERE {IN_CLAUSE}",
                    "asset_id",
                    asset_ids,
                )
                if meta_rows.ok and meta_rows.data:
                    for row in meta_rows.data:
                        asset_id = row.get("asset_id")
                        if asset_id:
                            try:
                                has_meta_set.add(int(asset_id))
                            except Exception:
                                pass

        for file_path in batch:
            fp = str(file_path)
            existing_state: Optional[Dict[str, Any]]
            if incremental and fp in journal_map:
                existing_state = dict(existing_map.get(fp) or {})
                existing_state["journal_state_hash"] = journal_map.get(fp)
            else:
                existing_state = existing_map.get(fp)

            # Stat the file
            stat_result = await self._stat_with_retry(file_path)
            if not stat_result[0]:
                stats["errors"] += 1
                logger.warning("Failed to stat %s: %s", str(file_path), stat_result[1])
                continue

            stat = stat_result[1]
            mtime_ns = stat.st_mtime_ns
            mtime = int(stat.st_mtime)
            size = int(stat.st_size)
            filepath = str(file_path)
            state_hash = self._compute_state_hash(filepath, mtime_ns, size)

            # Check journal skip
            journal_state_hash = None
            if isinstance(existing_state, dict) and "journal_state_hash" in existing_state:
                journal_state_hash = existing_state.get("journal_state_hash")

            if incremental and journal_state_hash and str(journal_state_hash) == state_hash:
                prepared.append({"action": "skipped_journal"})
                continue

            existing_id = 0
            existing_mtime = 0
            if isinstance(existing_state, dict) and existing_state.get("id") is not None:
                try:
                    existing_id = int(existing_state.get("id") or 0)
                    existing_mtime = int(existing_state.get("mtime") or 0)
                except Exception:
                    pass

            # Check cache skip using prefetched data
            # Optimization: Skip processing if mtime matches, even for non-incremental scans.
            # This prevents massive redundant DB updates when performing full directory scans.
            if existing_id and existing_mtime == mtime:
                # Check if we have cached metadata for this filepath and state_hash
                cached_raw = cache_map.get((filepath, state_hash))
                if cached_raw:
                    cached_result = Result.Ok({"metadata_raw": cached_raw}, source="cache")
                    prepared.append({
                        "action": "refresh",
                        "asset_id": existing_id,
                        "metadata_result": cached_result,
                        "filepath": filepath,
                        "file_path": file_path,
                        "state_hash": state_hash,
                        "mtime": mtime,
                        "size": size,
                        "fast": fast,
                        "cache_store": False,
                    })
                    continue

                # Check if asset has metadata using prefetched data
                if existing_id in has_meta_set:
                    prepared.append({"action": "skipped"})
                    continue

            # This file needs processing
            if not fast:
                needs_metadata.append((file_path, filepath, mtime, size, state_hash, existing_id if existing_id else None))
            else:
                # Fast mode - no metadata
                rel_path = self._safe_relative_path(file_path, base_dir)
                prepared.append({
                    "action": "updated" if existing_id else "added",
                    "asset_id": existing_id if existing_id else None,
                    "metadata_result": Result.Ok({}),
                    "filepath": filepath,
                    "file_path": file_path,
                    "state_hash": state_hash,
                    "mtime": mtime,
                    "size": size,
                    "fast": True,
                    "cache_store": False,
                    "filename": file_path.name if not existing_id else None,
                    "subfolder": str(rel_path.parent) if not existing_id and rel_path.parent != Path(".") else ("" if not existing_id else None),
                    "kind": classify_file(file_path.name) if not existing_id else None,
                })

        # Phase 2: Batch metadata extraction
        if needs_metadata:
            paths_to_extract = [item[0] for item in needs_metadata]
            batch_metadata = await self.metadata.get_metadata_batch([str(p) for p in paths_to_extract], scan_id=self._current_scan_id)

            for file_path, filepath, mtime, size, state_hash, existing_id in needs_metadata:
                metadata_result = batch_metadata.get(str(file_path))
                if not metadata_result:
                    metadata_result = MetadataHelpers.metadata_error_payload(Result.Err("METADATA_MISSING", "No metadata returned"), filepath)
                elif not metadata_result.ok:
                    metadata_result = MetadataHelpers.metadata_error_payload(metadata_result, filepath)

                cache_store = metadata_result.ok

                if existing_id:
                    prepared.append({
                        "action": "updated",
                        "asset_id": existing_id,
                        "metadata_result": metadata_result,
                        "filepath": filepath,
                        "file_path": file_path,
                        "state_hash": state_hash,
                        "mtime": mtime,
                        "size": size,
                        "fast": fast,
                        "cache_store": cache_store,
                    })
                else:
                    rel_path = self._safe_relative_path(file_path, base_dir)
                    filename = file_path.name
                    subfolder = str(rel_path.parent) if rel_path.parent != Path(".") else ""
                    kind = classify_file(filename)

                    prepared.append({
                        "action": "added",
                        "filename": filename,
                        "subfolder": subfolder,
                        "filepath": filepath,
                        "kind": kind,
                        "metadata_result": metadata_result,
                        "file_path": file_path,
                        "state_hash": state_hash,
                        "mtime": mtime,
                        "size": size,
                        "fast": fast,
                        "cache_store": cache_store,
                    })

        if not prepared:
            return

        # Apply DB writes for the whole batch in one transaction.
        # If the batch fails, fall back to processing items individually
        batch_failed = False
        try:
            async with self.db.atransaction(mode="immediate"):
                for entry in prepared:
                    action = entry.get("action")

                    if action in ("skipped", "skipped_journal"):
                        stats["skipped"] += 1
                        continue

                    if action == "refresh":
                        asset_id = entry.get("asset_id")
                        metadata_result = entry.get("metadata_result")
                        if not asset_id or not isinstance(metadata_result, Result):
                            stats["skipped"] += 1
                            continue
                        try:
                            refreshed = await MetadataHelpers.refresh_metadata_if_needed(
                                self.db,
                                int(asset_id),
                                metadata_result,
                                entry.get("filepath") or "",
                                base_dir,
                                entry.get("state_hash") or "",
                                int(entry.get("mtime") or 0),
                                int(entry.get("size") or 0),
                                self._write_scan_journal_entry,
                            )
                            stats["skipped"] += 1
                            if refreshed and entry.get("fast") and to_enrich is not None:
                                if len(to_enrich) < MAX_TO_ENRICH_ITEMS:
                                    to_enrich.append(entry.get("filepath") or str(entry.get("file_path") or ""))
                        except Exception as exc:
                            stats["errors"] += 1
                            logger.warning("Metadata refresh failed for asset_id=%s: %s", asset_id, exc)
                        continue

                    if action == "updated":
                        asset_id = entry.get("asset_id")
                        metadata_result = entry.get("metadata_result")
                        if not asset_id or not isinstance(metadata_result, Result):
                            stats["errors"] += 1
                            continue
                        cache_store = bool(entry.get("cache_store"))
                        if cache_store:
                            try:
                                await MetadataHelpers.store_metadata_cache(
                                    self.db,
                                    entry.get("filepath") or "",
                                    entry.get("state_hash") or "",
                                    metadata_result,
                                )
                            except Exception:
                                pass
                        res = await self._update_asset(
                            int(asset_id),
                            entry.get("file_path"),
                            int(entry.get("mtime") or 0),
                            int(entry.get("size") or 0),
                            metadata_result,
                            source=source,
                            root_id=root_id,
                            write_metadata=not bool(entry.get("fast")),
                        )
                        if res.ok:
                            await self._write_scan_journal_entry(
                                entry.get("filepath") or "",
                                base_dir,
                                entry.get("state_hash") or "",
                                int(entry.get("mtime") or 0),
                                int(entry.get("size") or 0),
                            )
                            stats["updated"] += 1
                            if entry.get("fast") and to_enrich is not None:
                                if len(to_enrich) < MAX_TO_ENRICH_ITEMS:
                                    to_enrich.append(entry.get("filepath") or str(entry.get("file_path") or ""))
                        else:
                            stats["errors"] += 1
                        continue

                    if action == "added":
                        metadata_result = entry.get("metadata_result")
                        if not isinstance(metadata_result, Result):
                            stats["errors"] += 1
                            continue
                        cache_store = bool(entry.get("cache_store"))
                        res = await self._add_asset(
                            entry.get("filename") or "",
                            entry.get("subfolder") or "",
                            entry.get("filepath") or "",
                            entry.get("kind"),
                            int(entry.get("mtime") or 0),
                            int(entry.get("size") or 0),
                            entry.get("file_path"),
                            metadata_result,
                            source=source,
                            root_id=root_id,
                            write_metadata=True,
                        )
                        if res.ok:
                            if cache_store:
                                try:
                                    await MetadataHelpers.store_metadata_cache(
                                        self.db,
                                        entry.get("filepath") or "",
                                        entry.get("state_hash") or "",
                                        metadata_result,
                                    )
                                except Exception:
                                    pass
                            await self._write_scan_journal_entry(
                                entry.get("filepath") or "",
                                base_dir,
                                entry.get("state_hash") or "",
                                int(entry.get("mtime") or 0),
                                int(entry.get("size") or 0),
                            )
                            stats["added"] += 1
                            if entry.get("fast") and to_enrich is not None:
                                if len(to_enrich) < MAX_TO_ENRICH_ITEMS:
                                    to_enrich.append(entry.get("filepath") or str(entry.get("file_path") or ""))
                        else:
                            stats["errors"] += 1
                        continue

                    # Unknown action: count as skipped to be safe.
                    stats["skipped"] += 1
        except Exception as batch_error:
            # If the entire batch transaction fails, fall back to processing items individually
            batch_failed = True
            logger.warning("Batch transaction failed: %s. Falling back to individual processing.", str(batch_error))
            stats["errors"] += len(prepared)  # Temporarily count all as errors, will be corrected below

            # Process each item individually to isolate failures
            for entry in prepared:
                action = entry.get("action")

                if action in ("skipped", "skipped_journal"):
                    stats["skipped"] += 1
                    stats["errors"] -= 1  # Correct the error count
                    continue

                try:
                    async with self.db.atransaction(mode="immediate"):
                        if action == "refresh":
                            asset_id = entry.get("asset_id")
                            metadata_result = entry.get("metadata_result")
                            if not asset_id or not isinstance(metadata_result, Result):
                                stats["skipped"] += 1
                                stats["errors"] -= 1  # Correct the error count
                                continue
                            try:
                                refreshed = await MetadataHelpers.refresh_metadata_if_needed(
                                    self.db,
                                    int(asset_id),
                                    metadata_result,
                                    entry.get("filepath") or "",
                                    base_dir,
                                    entry.get("state_hash") or "",
                                    int(entry.get("mtime") or 0),
                                    int(entry.get("size") or 0),
                                    self._write_scan_journal_entry,
                                )
                                stats["skipped"] += 1
                                stats["errors"] -= 1  # Correct the error count
                                if refreshed and entry.get("fast") and to_enrich is not None:
                                    if len(to_enrich) < MAX_TO_ENRICH_ITEMS:
                                        to_enrich.append(entry.get("filepath") or str(entry.get("file_path") or ""))
                            except Exception as exc:
                                stats["errors"] += 1  # Keep as error
                                logger.warning("Metadata refresh failed for asset_id=%s: %s", asset_id, exc)
                            continue

                        if action == "updated":
                            asset_id = entry.get("asset_id")
                            metadata_result = entry.get("metadata_result")
                            if not asset_id or not isinstance(metadata_result, Result):
                                stats["errors"] += 1  # Keep as error
                                continue
                            cache_store = bool(entry.get("cache_store"))
                            if cache_store:
                                try:
                                    await MetadataHelpers.store_metadata_cache(
                                        self.db,
                                        entry.get("filepath") or "",
                                        entry.get("state_hash") or "",
                                        metadata_result,
                                    )
                                except Exception:
                                    pass
                            res = await self._update_asset(
                                int(asset_id),
                                entry.get("file_path"),
                                int(entry.get("mtime") or 0),
                                int(entry.get("size") or 0),
                                metadata_result,
                                source=source,
                                root_id=root_id,
                                write_metadata=not bool(entry.get("fast")),
                            )
                            if res.ok:
                                await self._write_scan_journal_entry(
                                    entry.get("filepath") or "",
                                    base_dir,
                                    entry.get("state_hash") or "",
                                    int(entry.get("mtime") or 0),
                                    int(entry.get("size") or 0),
                                )
                                stats["updated"] += 1
                                stats["errors"] -= 1  # Correct the error count
                                if entry.get("fast") and to_enrich is not None:
                                    to_enrich.append(entry.get("filepath") or str(entry.get("file_path") or ""))
                            else:
                                stats["errors"] += 1  # Keep as error
                            continue

                        if action == "added":
                            metadata_result = entry.get("metadata_result")
                            if not isinstance(metadata_result, Result):
                                stats["errors"] += 1  # Keep as error
                                continue
                            cache_store = bool(entry.get("cache_store"))
                            res = await self._add_asset(
                                entry.get("filename") or "",
                                entry.get("subfolder") or "",
                                entry.get("filepath") or "",
                                entry.get("kind"),
                                int(entry.get("mtime") or 0),
                                int(entry.get("size") or 0),
                                entry.get("file_path"),
                                metadata_result,
                                source=source,
                                root_id=root_id,
                                write_metadata=True,
                            )
                            if res.ok:
                                if cache_store:
                                    try:
                                        await MetadataHelpers.store_metadata_cache(
                                            self.db,
                                            entry.get("filepath") or "",
                                            entry.get("state_hash") or "",
                                            metadata_result,
                                        )
                                    except Exception:
                                        pass
                                await self._write_scan_journal_entry(
                                    entry.get("filepath") or "",
                                    base_dir,
                                    entry.get("state_hash") or "",
                                    int(entry.get("mtime") or 0),
                                    int(entry.get("size") or 0),
                                )
                                stats["added"] += 1
                                stats["errors"] -= 1  # Correct the error count
                                if entry.get("fast") and to_enrich is not None:
                                    to_enrich.append(entry.get("filepath") or str(entry.get("file_path") or ""))
                            else:
                                stats["errors"] += 1  # Keep as error
                            continue

                        # Unknown action: count as skipped to be safe.
                        stats["skipped"] += 1
                        stats["errors"] -= 1  # Correct the error count
                except Exception as individual_error:
                    # If individual processing also fails, log and keep as error
                    logger.warning("Individual processing failed for entry: %s. Error: %s", str(entry.get("filepath", "unknown")), str(individual_error))
                    # Error count is already correct

    async def _prepare_index_entry(
        self,
        file_path: Path,
        base_dir: str,
        incremental: bool,
        existing_state: Optional[Dict[str, Any]] = None,
        source: str = "output",
        root_id: Optional[str] = None,
        fast: bool = False,
    ) -> Result[Dict[str, Any]]:
        """
        Prepare indexing work for a file (stat + incremental decision + metadata extraction),
        but do not write to the DB. DB writes are applied in a batch transaction.
        """
        stat_result = await self._stat_with_retry(file_path)
        if not stat_result[0]:
            return Result.Err("STAT_FAILED", f"Failed to stat file: {stat_result[1]}")
        stat = stat_result[1]
        mtime_ns = stat.st_mtime_ns
        mtime = int(stat.st_mtime)
        size = int(stat.st_size)

        filepath = str(file_path)
        state_hash = self._compute_state_hash(filepath, mtime_ns, size)

        journal_state_hash = None
        if isinstance(existing_state, dict) and "journal_state_hash" in existing_state:
            journal_state_hash = existing_state.get("journal_state_hash")
        elif incremental:
            journal_entry = self._get_journal_entry(filepath)
            journal_state_hash = journal_entry.get("state_hash") if isinstance(journal_entry, dict) else None

        if incremental and journal_state_hash and str(journal_state_hash) == state_hash:
            return Result.Ok({"action": "skipped_journal"})

        existing_asset = existing_state if isinstance(existing_state, dict) and existing_state.get("id") is not None else None
        existing_id = 0
        existing_mtime = 0
        if existing_asset is not None:
            try:
                existing_id = int(existing_asset.get("id") or 0)
                existing_mtime = int(existing_asset.get("mtime") or 0)
            except Exception:
                existing_id = 0
                existing_mtime = 0

        # If incremental and unchanged, try cached metadata first.
        if incremental and existing_id and existing_mtime == mtime:
            cached_metadata = await MetadataHelpers.retrieve_cached_metadata(self.db, filepath, state_hash)
            if cached_metadata and cached_metadata.ok:
                return Result.Ok(
                    {
                        "action": "refresh",
                        "asset_id": existing_id,
                        "metadata_result": cached_metadata,
                        "filepath": filepath,
                        "file_path": file_path,
                        "state_hash": state_hash,
                        "mtime": mtime,
                        "size": size,
                        "fast": fast,
                        "cache_store": False,
                    }
                )

            meta_row = await self.db.aquery("SELECT 1 FROM asset_metadata WHERE asset_id = ? LIMIT 1", (existing_id,))
            if meta_row.ok and meta_row.data:
                return Result.Ok({"action": "skipped"})

        # Compute metadata only when needed.
        cache_store = False
        if fast:
            metadata_result: Result[Dict[str, Any]] = Result.Ok({})
        else:
            metadata_result = await self.metadata.get_metadata(filepath, scan_id=self._current_scan_id)
            if metadata_result.ok:
                cache_store = True
            if not metadata_result.ok:
                metadata_result = MetadataHelpers.metadata_error_payload(metadata_result, filepath)

        # For unchanged files, this is a metadata refresh attempt.
        if incremental and existing_id and existing_mtime == mtime:
            return Result.Ok(
                {
                    "action": "refresh",
                    "asset_id": existing_id,
                    "metadata_result": metadata_result,
                    "filepath": filepath,
                    "file_path": file_path,
                    "state_hash": state_hash,
                    "mtime": mtime,
                    "size": size,
                    "fast": fast,
                    "cache_store": cache_store,
                }
            )

        # Calculate relative path components (needed for inserts).
        rel_path = self._safe_relative_path(file_path, base_dir)
        filename = file_path.name
        subfolder = str(rel_path.parent) if rel_path.parent != Path(".") else ""
        kind = classify_file(filename)

        if existing_id:
            return Result.Ok(
                {
                    "action": "updated",
                    "asset_id": existing_id,
                    "metadata_result": metadata_result,
                    "filepath": filepath,
                    "file_path": file_path,
                    "state_hash": state_hash,
                    "mtime": mtime,
                    "size": size,
                    "fast": fast,
                    "cache_store": cache_store,
                }
            )

        return Result.Ok(
            {
                "action": "added",
                "filename": filename,
                "subfolder": subfolder,
                "filepath": filepath,
                "kind": kind,
                "metadata_result": metadata_result,
                "file_path": file_path,
                "state_hash": state_hash,
                "mtime": mtime,
                "size": size,
                "fast": fast,
                "cache_store": cache_store,
            }
        )



    def _iter_files(self, directory: Path, recursive: bool):
        """
        Generator to iterate over all asset files from directory (streaming).

        Args:
            directory: Directory to scan
            recursive: Scan subdirectories

        Yields:
            File paths one by one
        """
        def _is_supported(p: Path) -> bool:
            try:
                ext = p.suffix.lower()
            except Exception:
                ext = ""
            if ext and _EXT_TO_KIND:
                return _EXT_TO_KIND.get(ext, "unknown") != "unknown"
            return classify_file(str(p)) != "unknown"

        if recursive:
            for root, _, filenames in os.walk(directory):
                for filename in filenames:
                    # Avoid Path allocation + classify loops when possible.
                    try:
                        ext = os.path.splitext(filename)[1].lower()
                    except Exception:
                        ext = ""
                    if ext and _EXT_TO_KIND and _EXT_TO_KIND.get(ext, "unknown") == "unknown":
                        continue
                    file_path = Path(root) / filename
                    if _is_supported(file_path):
                        yield file_path
        else:
            for item in directory.iterdir():
                if item.is_file() and _is_supported(item):
                    yield item

    def _chunk_file_batches(self, files: List[Path]) -> Iterable[List[Path]]:
        """Yield batches of files for bounded transactions."""
        total = len(files)
        if total <= 0:
            return

        # Dynamic batch sizing: fewer transactions for large scans, but still bounded.
        if total < int(SCAN_BATCH_SMALL_THRESHOLD):
            batch_size = int(SCAN_BATCH_SMALL)
        elif total < int(SCAN_BATCH_MED_THRESHOLD):
            batch_size = int(SCAN_BATCH_MED)
        elif total < int(SCAN_BATCH_LARGE_THRESHOLD):
            batch_size = int(SCAN_BATCH_LARGE)
        else:
            batch_size = int(SCAN_BATCH_XL)

        batch_size = max(1, min(MAX_TRANSACTION_BATCH_SIZE, int(batch_size)))

        for start in range(0, total, batch_size):
            yield files[start:start + batch_size]

    def _safe_relative_path(self, file_path: Path, base_dir: str) -> Path:
        try:
            return file_path.relative_to(base_dir)
        except Exception:
            try:
                rel = os.path.relpath(str(file_path), base_dir)
                return Path(rel)
            except Exception:
                logger.warning(
                    "Could not compute relative path for %s from %s; using absolute path",
                    str(file_path),
                    str(base_dir),
                )
                return file_path

    def _compute_state_hash(self, filepath: str, mtime_ns: int, size: int) -> str:
        parts = [
            filepath.encode("utf-8"),
            str(mtime_ns).encode("utf-8"),
            str(size).encode("utf-8"),
        ]
        h = hashlib.sha256()
        for part in parts:
            h.update(part)
            h.update(b"\x00")
        return h.hexdigest()

    async def _get_journal_entry(self, filepath: str) -> Optional[Dict[str, Any]]:
        result = await self.db.aquery(
            "SELECT state_hash FROM scan_journal WHERE filepath = ?",
            (filepath,)
        )
        if not result.ok or not result.data:
            return None
        return result.data[0]

    async def _get_journal_entries(self, filepaths: List[str]) -> Dict[str, str]:
        """
        Batch lookup scan_journal state_hash for a list of filepaths.
        Returns {filepath: state_hash}.
        """
        cleaned = [str(p) for p in (filepaths or []) if p]
        if not cleaned:
            return {}
        if len(cleaned) > MAX_SCAN_JOURNAL_LOOKUP:
            cleaned = cleaned[:MAX_SCAN_JOURNAL_LOOKUP]
        res = await self.db.aquery_in(
            "SELECT filepath, state_hash FROM scan_journal WHERE {IN_CLAUSE}",
            "filepath",
            cleaned,
        )
        if not res.ok:
            return {}
        out: Dict[str, str] = {}
        for row in res.data or []:
            if not isinstance(row, dict):
                continue
            fp = row.get("filepath")
            sh = row.get("state_hash")
            if fp and sh:
                out[str(fp)] = str(sh)
        return out

    async def _write_scan_journal_entry(
        self,
        filepath: str,
        base_dir: str,
        state_hash: str,
        mtime: int,
        size: int
    ) -> Result[Any]:
        dir_path = str(Path(base_dir).resolve())
        return await self.db.aexecute(
            """
            INSERT OR REPLACE INTO scan_journal
            (filepath, dir_path, state_hash, mtime, size, last_seen)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            """,
            (filepath, dir_path, state_hash, mtime, size)
        )

    async def _stat_with_retry(self, file_path: Path):
        for attempt in range(STAT_RETRY_COUNT):
            try:
                stat = await asyncio.to_thread(file_path.stat)
                return True, stat
            except OSError as exc:
                if attempt < (STAT_RETRY_COUNT - 1):
                    await asyncio.sleep(STAT_RETRY_BASE_DELAY_S * (attempt + 1))
                    continue
                logger.warning("Failed to stat %s after retries: %s", file_path, exc)
                return False, exc

    async def _index_file(
        self,
        file_path: Path,
        base_dir: str,
        incremental: bool,
        existing_state: Optional[Dict[str, Any]] = None,
        source: str = "output",
        root_id: Optional[str] = None,
        fast: bool = False,
    ) -> Result[Dict[str, str]]:
        """
        Index a single file.

        Args:
            file_path: File to index
            base_dir: Base directory for relative path calculation
            incremental: Skip if already indexed and unchanged
            existing_state: Pre-fetched existing state
            source: Source identifier
            root_id: Root identifier
            fast: Skip metadata extraction

        Returns:
            Result with action taken (added, updated, skipped)
        """
        stat_result = await self._stat_with_retry(file_path)
        if not stat_result[0]:
            return Result.Err("STAT_FAILED", f"Failed to stat file: {stat_result[1]}")
        stat = stat_result[1]
        mtime_ns = stat.st_mtime_ns
        mtime = int(stat.st_mtime)
        size = stat.st_size

        # Compute file fingerprint before any caching or journal logic (prevents use-before-set bugs)
        filepath = str(file_path)
        state_hash = self._compute_state_hash(filepath, mtime_ns, size)

        # Skip unchanged files as early as possible (before running ExifTool/FFProbe).
        journal_state_hash = None
        if isinstance(existing_state, dict) and "journal_state_hash" in existing_state:
            journal_state_hash = existing_state.get("journal_state_hash")
        else:
            journal_entry = await self._get_journal_entry(filepath)
            journal_state_hash = journal_entry.get("state_hash") if isinstance(journal_entry, dict) else None

        if incremental and journal_state_hash and str(journal_state_hash) == state_hash:
            return Result.Ok({"action": "skipped_journal"})

        # Check if file already exists (allow caller to prefetch to avoid N+1 queries)
        existing_asset = None
        if isinstance(existing_state, dict) and existing_state.get("id") is not None:
            existing_asset = existing_state
        else:
            existing = await self.db.aquery(
                "SELECT id, mtime FROM assets WHERE filepath = ?",
                (filepath,)
            )

            if existing.ok and existing.data and len(existing.data) > 0:
                existing_asset = existing.data[0]

        if existing_asset is not None:
            try:
                existing_mtime = int(existing_asset.get("mtime") or 0)
                existing_id = int(existing_asset.get("id") or 0)
            except Exception:
                existing_mtime = 0
                existing_id = 0

            if incremental and existing_mtime == mtime and existing_id:
                # Prefer cached metadata; it's cheap and avoids rerunning tools.
                cached_metadata = await MetadataHelpers.retrieve_cached_metadata(self.db, filepath, state_hash)
                if cached_metadata and cached_metadata.ok:
                    refreshed = False
                    async with self.db.atransaction(mode="immediate"):
                        refreshed = await MetadataHelpers.refresh_metadata_if_needed(
                            self.db,
                            existing_id,
                            cached_metadata,
                            filepath,
                            base_dir,
                            state_hash,
                            mtime,
                            size,
                            self._write_scan_journal_entry,
                        )
                        if refreshed:
                            await self._write_scan_journal_entry(filepath, base_dir, state_hash, mtime, size)
                    action = "skipped_refresh" if refreshed else "skipped"
                    return Result.Ok({"action": action})

                # If we already have a metadata row, don't rerun tools just for an incremental pass.
                meta_row = await self.db.aquery("SELECT 1 FROM asset_metadata WHERE asset_id = ? LIMIT 1", (existing_id,))
                if meta_row.ok and meta_row.data:
                    return Result.Ok({"action": "skipped"})

        # Compute metadata (may run tools) only when needed.
        if fast:
            metadata_result = Result.Ok({})
        else:
            metadata_result = await self.metadata.get_metadata(filepath, scan_id=self._current_scan_id)
            if metadata_result.ok:
                quality = metadata_result.meta.get("quality", "full")
                if quality in ("degraded", "partial"):
                    logger.debug(
                        "Metadata extraction completed with degraded quality for %s: %s",
                        file_path,
                        quality,
                    )
                await MetadataHelpers.store_metadata_cache(self.db, filepath, state_hash, metadata_result)

        if not metadata_result.ok:
            if metadata_result.code == ErrorCode.FFPROBE_ERROR:
                self._log_scan_event(
                    logging.WARNING,
                    "FFprobe error during metadata extraction",
                    filepath=str(file_path),
                    tool="ffprobe",
                    error=metadata_result.error,
                    code=metadata_result.code
                )
            else:
                self._log_scan_event(
                    logging.WARNING,
                    "Metadata extraction issue",
                    filepath=str(file_path),
                    error=metadata_result.error,
                    code=metadata_result.code
                )
            metadata_result = MetadataHelpers.metadata_error_payload(metadata_result, str(file_path))

        # Calculate relative path components
        rel_path = self._safe_relative_path(file_path, base_dir)
        filename = file_path.name
        subfolder = str(rel_path.parent) if rel_path.parent != Path(".") else ""
        kind = classify_file(filename)

        if existing_asset is not None:
            # Skip if incremental and unchanged
            try:
                existing_mtime = int(existing_asset.get("mtime") or 0)
                existing_id = int(existing_asset.get("id") or 0)
            except Exception:
                existing_mtime = 0
                existing_id = 0

            if incremental and existing_mtime == mtime and existing_id:
                refreshed = False
                # Keep write transactions short: metadata extraction is already done.
                async with self.db.atransaction(mode="immediate"):
                    refreshed = await MetadataHelpers.refresh_metadata_if_needed(
                        self.db,
                        existing_id,
                        metadata_result,
                        filepath,
                        base_dir,
                        state_hash,
                        mtime,
                        size,
                        self._write_scan_journal_entry,
                    )
                    if refreshed:
                        await self._write_scan_journal_entry(filepath, base_dir, state_hash, mtime, size)
                action = "skipped_refresh" if refreshed else "skipped"
                return Result.Ok({"action": action})

            # Update existing asset
            if existing_id:
                async with self.db.atransaction(mode="immediate"):
                    result = await self._update_asset(
                        existing_id,
                        file_path,
                        mtime,
                        size,
                        metadata_result,
                        source=source,
                        root_id=root_id,
                        write_metadata=(not fast),
                    )
                    if result.ok:
                        await self._write_scan_journal_entry(filepath, base_dir, state_hash, mtime, size)
                return result

        # Add new asset
        async with self.db.atransaction(mode="immediate"):
            result = await self._add_asset(
                filename,
                subfolder,
                filepath,
                kind,
                mtime,
                size,
                file_path,
                metadata_result,
                source=source,
                root_id=root_id,
                write_metadata=True,
            )
            if result.ok:
                await self._write_scan_journal_entry(filepath, base_dir, state_hash, mtime, size)
        return result

    async def _add_asset(
        self,
        filename: str,
        subfolder: str,
        filepath: str,
        kind: FileKind,
        mtime: int,
        size: int,
        file_path: Path,
        metadata_result: Result[Dict[str, Any]],
        source: str = "output",
        root_id: Optional[str] = None,
        write_metadata: bool = True,
    ) -> Result[Dict[str, str]]:
        """
        Add new asset to database.
        """
        width = None
        height = None
        duration = None

        if metadata_result.ok and metadata_result.data:
            meta = metadata_result.data
            width = meta.get("width")
            height = meta.get("height")
            duration = meta.get("duration")

        # Insert into assets table (NO workflow fields here)
        insert_result = await self.db.aexecute(
            """
            INSERT INTO assets
            (filename, subfolder, filepath, source, root_id, kind, ext, width, height, duration, size, mtime)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                filename,
                subfolder,
                filepath,
                str(source or "output"),
                str(root_id) if root_id else None,
                kind,
                Path(filename).suffix.lower(),
                width,
                height,
                duration,
                size,
                mtime,
            )
        )

        if not insert_result.ok:
            return Result.Err("INSERT_FAILED", insert_result.error)

        asset_id = insert_result.data if insert_result.ok else None
        if not asset_id:
            return Result.Err("INSERT_FAILED", "Failed to get inserted asset ID")
        if write_metadata:
            metadata_write = await MetadataHelpers.write_asset_metadata_row(self.db, asset_id, metadata_result)
            if not metadata_write.ok:
                self._log_scan_event(
                    logging.WARNING,
                    "Failed to insert metadata row",
                    asset_id=asset_id,
                    error=metadata_write.error,
                    stage="metadata_write"
                )

        return Result.Ok({"action": "added"})

    async def _update_asset(
        self,
        asset_id: int,
        file_path: Path,
        mtime: int,
        size: int,
        metadata_result: Result[Dict[str, Any]],
        source: str = "output",
        root_id: Optional[str] = None,
        write_metadata: bool = True,
    ) -> Result[Dict[str, str]]:
        """
        Update existing asset in database.
        """
        width = None
        height = None
        duration = None

        if metadata_result.ok and metadata_result.data:
            meta = metadata_result.data
            width = meta.get("width")
            height = meta.get("height")
            duration = meta.get("duration")

        # Update assets table (NO workflow fields)
        update_result = await self.db.aexecute(
            """
            UPDATE assets
            SET width = COALESCE(?, width),
                height = COALESCE(?, height),
                duration = COALESCE(?, duration),
                size = ?, mtime = ?,
                source = ?, root_id = ?,
                indexed_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (width, height, duration, size, mtime, str(source or "output"), str(root_id) if root_id else None, asset_id)
        )

        if not update_result.ok:
            return Result.Err("UPDATE_FAILED", update_result.error)

        if write_metadata:
            metadata_write = await MetadataHelpers.write_asset_metadata_row(self.db, asset_id, metadata_result)
            if not metadata_write.ok:
                self._log_scan_event(
                    logging.WARNING,
                    "Failed to update metadata row",
                    asset_id=asset_id,
                    error=metadata_write.error,
                    stage="metadata_write"
                )

        return Result.Ok({"action": "updated"})

    def _scan_context(self, **kwargs) -> Dict[str, Any]:
        context = {"scan_id": self._current_scan_id} if self._current_scan_id else {}
        context.update(kwargs)
        return context

    def _log_scan_event(self, level: int, message: str, **context):
        log_structured(logger, level, message, **self._scan_context(**context))
