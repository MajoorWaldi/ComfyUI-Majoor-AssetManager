"""
Metadata enricher - handles background metadata enrichment for assets.
"""
from __future__ import annotations

import os
import asyncio
import time
from typing import List, Dict, Any, Optional

from ...shared import get_logger, Result
from ...adapters.db.sqlite import Sqlite
from ..metadata import MetadataService


logger = get_logger(__name__)
_DB_RESETTING_MSG = "database is resetting - connection rejected"
_DB_LOCKED_MSGS = ("database is locked", "busy")
_MAX_ENRICH_RETRIES = 5


def _is_db_resetting_error(exc: Exception) -> bool:
    try:
        return _DB_RESETTING_MSG in str(exc).lower()
    except Exception:
        return False


def _is_transient_db_error(exc: Exception) -> bool:
    try:
        msg = str(exc).lower()
    except Exception:
        return False
    if _DB_RESETTING_MSG in msg:
        return True
    return any(token in msg for token in _DB_LOCKED_MSGS)


class MetadataEnricher:
    """
    Handles background metadata enrichment for assets.

    Manages a queue of files that need metadata enrichment and processes
    them in the background using a worker thread. This is used for fast
    scans that skip metadata extraction during the initial pass.
    """

    def __init__(
        self,
        db: Sqlite,
        metadata_service: MetadataService,
        compute_state_hash_fn,
        prepare_metadata_fields_fn,
        metadata_error_payload_fn,
    ):
        """
        Initialize metadata enricher.

        Args:
            db: Database adapter instance
            metadata_service: Metadata service for extraction
            compute_state_hash_fn: Function to compute state hash
            prepare_metadata_fields_fn: Function to prepare metadata fields
            metadata_error_payload_fn: Function to create error payload
        """
        self.db = db
        self.metadata = metadata_service
        self._compute_state_hash = compute_state_hash_fn
        self._prepare_metadata_fields = prepare_metadata_fields_fn
        self._metadata_error_payload = metadata_error_payload_fn
        self._enrich_lock = asyncio.Lock()
        self._enrich_queue: List[str] = []
        self._enrich_task: Optional[asyncio.Task[None]] = None
        self._enrich_running = False
        self._retry_counts: Dict[str, int] = {}
        self._pause_until_monotonic: float = 0.0
        self._status_active: bool = False

    def _emit_status(self, active: bool, **extra: Any) -> None:
        try:
            if self._status_active == bool(active):
                return
            self._status_active = bool(active)
            from ...routes.registry import PromptServer
            payload = {"active": bool(active), **extra}
            PromptServer.instance.send_sync("mjr-enrichment-status", payload)
        except Exception:
            pass

    def pause_for_interaction(self, seconds: float = 1.5) -> None:
        """
        Pause enrichment briefly during UI interactions (search/sort/list).
        """
        try:
            ttl = max(0.1, min(5.0, float(seconds)))
        except Exception:
            ttl = 1.5
        now = time.monotonic()
        self._pause_until_monotonic = max(self._pause_until_monotonic, now + ttl)

    async def start_enrichment(self, filepaths: List[str]) -> None:
        """
        Enqueue files for background metadata enrichment.

        Args:
            filepaths: List of file paths to enqueue
        """
        cleaned = [str(p) for p in (filepaths or []) if p]
        if not cleaned:
            return
        async with self._enrich_lock:
            existing = set(self._enrich_queue)
            for fp in cleaned:
                if fp in existing:
                    continue
                self._enrich_queue.append(fp)
                existing.add(fp)
            if self._enrich_running and self._enrich_task and not self._enrich_task.done():
                return
            self._emit_status(True, queued=len(self._enrich_queue))
            self._enrich_running = True
            self._enrich_task = asyncio.create_task(self._enrichment_worker())

    async def stop_enrichment(self, clear_queue: bool = True) -> None:
        """
        Stop background enrichment worker and optionally clear pending queue.
        """
        task: Optional[asyncio.Task[None]] = None
        async with self._enrich_lock:
            task = self._enrich_task
            self._enrich_task = None
            self._enrich_running = False
            if clear_queue:
                self._enrich_queue.clear()
                self._retry_counts.clear()
        if task and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            except Exception:
                pass
        self._emit_status(False, queue_left=0 if clear_queue else len(self._enrich_queue))

    async def _enrichment_worker(self) -> None:
        """Background worker that processes the enrichment queue."""
        try:
            while True:
                now = time.monotonic()
                if self._pause_until_monotonic > now:
                    await asyncio.sleep(min(0.25, self._pause_until_monotonic - now))
                    continue
                async with self._enrich_lock:
                    if not self._enrich_queue:
                        return
                    chunk = self._enrich_queue[:64]
                    del self._enrich_queue[:64]
                await self._enrich_metadata_chunk(chunk)
        except Exception as exc:
            if _is_db_resetting_error(exc):
                logger.info("Metadata enrichment paused during DB maintenance/reset: %s", exc)
            else:
                logger.warning("Metadata enrichment worker failed: %s", exc)
        finally:
            async with self._enrich_lock:
                self._enrich_running = False
                self._enrich_task = None
                queue_left = len(self._enrich_queue)
            self._emit_status(False, queue_left=queue_left)

    async def _enrich_metadata_chunk(self, filepaths: List[str]) -> None:
        """
        Process a chunk of files for metadata enrichment.

        Args:
            filepaths: List of file paths to process
        """
        cleaned = [str(p) for p in (filepaths or []) if p]
        if not cleaned:
            return

        id_res = await self.db.aquery_in(
            "SELECT id, filepath FROM assets WHERE {IN_CLAUSE}",
            "filepath",
            cleaned,
        )
        if not id_res.ok:
            return
        id_by_fp: Dict[str, int] = {}
        for row in id_res.data or []:
            if not isinstance(row, dict):
                continue
            fp = row.get("filepath")
            try:
                aid = int(row.get("id") or 0)
            except Exception:
                aid = 0
            if fp and aid:
                id_by_fp[str(fp)] = aid

        updates: List[Dict[str, Any]] = []
        retry_paths: List[str] = []

        # Import helper locally to use shared logic (including FTS population)
        from .metadata_helpers import MetadataHelpers

        for fp in cleaned:
            asset_id = id_by_fp.get(fp)
            if not asset_id:
                continue
            try:
                stat = os.stat(fp)
            except Exception:
                continue
            mtime_ns = getattr(stat, "st_mtime_ns", int(stat.st_mtime * 1_000_000_000))
            state_hash = self._compute_state_hash(fp, int(mtime_ns), int(stat.st_size))

            # Try cache first to avoid tool work.
            metadata_result = await MetadataHelpers.retrieve_cached_metadata(self.db, fp, state_hash)
            if not (metadata_result and metadata_result.ok):
                metadata_result = await self.metadata.get_metadata(fp, scan_id=None)
                if metadata_result.ok:
                    await MetadataHelpers.store_metadata_cache(self.db, fp, state_hash, metadata_result)
            if not metadata_result.ok:
                metadata_result = self._metadata_error_payload(metadata_result, fp)

            width = None
            height = None
            duration = None
            if metadata_result.ok and metadata_result.data:
                meta = metadata_result.data
                width = meta.get("width")
                height = meta.get("height")
                duration = meta.get("duration")

            updates.append(
                {
                    "asset_id": asset_id,
                    "width": width,
                    "height": height,
                    "duration": duration,
                    "metadata_result": metadata_result,
                    "filepath": fp,
                }
            )

        if not updates:
            return

        for item in updates:
            asset_id = item.get("asset_id")
            if not asset_id:
                continue
            meta_res = item.get("metadata_result")
            if not isinstance(meta_res, Result):
                continue
            try:
                async with self.db.lock_for_asset(asset_id):
                    # Use deferred tx to reduce lock contention with concurrent search/sort reads.
                    async with self.db.atransaction(mode="deferred") as tx:
                        if not tx.ok:
                            logger.warning(
                                "Metadata enrichment skipped (transaction begin failed) for asset_id=%s: %s",
                                asset_id,
                                tx.error,
                            )
                            fp = str(item.get("filepath") or "")
                            if fp:
                                retry_paths.append(fp)
                            continue
                        await self.db.aexecute(
                            """
                            UPDATE assets
                            SET width = COALESCE(?, width),
                                height = COALESCE(?, height),
                                duration = COALESCE(?, duration),
                                updated_at = CURRENT_TIMESTAMP
                            WHERE id = ?
                            """,
                            (item.get("width"), item.get("height"), item.get("duration"), asset_id),
                        )
                        # Use shared helper to write metadata (ensures tags_text/FTS is populated with prompt/geninfo)
                        await MetadataHelpers.write_asset_metadata_row(
                            self.db,
                            asset_id,
                            meta_res,
                            filepath=item.get("filepath"),
                        )
                    if not tx.ok:
                        logger.warning("Metadata enrichment commit failed for asset_id=%s: %s", asset_id, tx.error)
                        fp = str(item.get("filepath") or "")
                        if fp:
                            retry_paths.append(fp)
                    else:
                        fp = str(item.get("filepath") or "")
                        if fp:
                            self._retry_counts.pop(fp, None)
                        # Notify frontend so workflow dot updates promptly.
                        try:
                            res = await self.db.aquery(
                                """
                                SELECT a.id, m.has_workflow AS has_workflow,
                                       m.has_generation_data AS has_generation_data
                                FROM assets a
                                LEFT JOIN asset_metadata m ON a.id = m.asset_id
                                WHERE a.id = ?
                                LIMIT 1
                                """,
                                (int(asset_id),),
                            )
                            if res.ok and res.data:
                                payload = dict(res.data[0])
                                from ...routes.registry import PromptServer
                                PromptServer.instance.send_sync("mjr-asset-updated", payload)
                        except Exception:
                            pass
            except Exception as exc:
                fp = str(item.get("filepath") or "")
                if _is_transient_db_error(exc):
                    logger.info("Metadata enrichment deferred for asset_id=%s due to DB contention/reset: %s", asset_id, exc)
                    if fp:
                        retry_paths.append(fp)
                else:
                    logger.warning("Metadata enrichment update failed for asset_id=%s: %s", asset_id, exc)

        if retry_paths:
            to_requeue: List[str] = []
            for fp in retry_paths:
                try:
                    c = int(self._retry_counts.get(fp, 0)) + 1
                except Exception:
                    c = 1
                self._retry_counts[fp] = c
                if c <= _MAX_ENRICH_RETRIES:
                    to_requeue.append(fp)
                else:
                    logger.warning("Metadata enrichment dropped after max retries (%s): %s", _MAX_ENRICH_RETRIES, fp)
                    self._retry_counts.pop(fp, None)
            if to_requeue:
                await asyncio.sleep(0.2)
                await self.start_enrichment(to_requeue)
