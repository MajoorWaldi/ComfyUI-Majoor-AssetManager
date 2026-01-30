"""
Metadata enricher - handles background metadata enrichment for assets.
"""
import os
import threading
import asyncio
from typing import List, Dict, Any, Tuple, Optional

from ...shared import get_logger
from ...adapters.db.sqlite import Sqlite
from ..metadata import MetadataService


logger = get_logger(__name__)


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
        scan_lock: asyncio.Lock,
        compute_state_hash_fn,
        prepare_metadata_fields_fn,
        metadata_error_payload_fn,
    ):
        """
        Initialize metadata enricher.

        Args:
            db: Database adapter instance
            metadata_service: Metadata service for extraction
            scan_lock: Shared lock for database writes
            compute_state_hash_fn: Function to compute state hash
            prepare_metadata_fields_fn: Function to prepare metadata fields
            metadata_error_payload_fn: Function to create error payload
        """
        self.db = db
        self.metadata = metadata_service
        self._scan_lock = scan_lock
        self._compute_state_hash = compute_state_hash_fn
        self._prepare_metadata_fields = prepare_metadata_fields_fn
        self._metadata_error_payload = metadata_error_payload_fn
        self._enrich_lock = asyncio.Lock()
        self._enrich_queue: List[str] = []
        self._enrich_thread: Optional[threading.Thread] = None
        self._enrich_running = False

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
            if self._enrich_running and self._enrich_thread and self._enrich_thread.is_alive():
                return
            self._enrich_running = True
            self._enrich_thread = asyncio.create_task(self._enrichment_worker())

    async def _enrichment_worker(self) -> None:
        """Background worker that processes the enrichment queue."""
        try:
            while True:
                async with self._enrich_lock:
                    if not self._enrich_queue:
                        self._enrich_running = False
                        return
                    chunk = self._enrich_queue[:64]
                    del self._enrich_queue[:64]
                await self._enrich_metadata_chunk(chunk)
        except Exception:
            async with self._enrich_lock:
                self._enrich_running = False

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

        asset_updates: List[Tuple[Any, Any, Any, int]] = []
        meta_updates: List[Tuple[int, int, str, str, int]] = []

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
            from .metadata_helpers import MetadataHelpers
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

            has_workflow, has_generation_data, metadata_quality, metadata_raw_json = self._prepare_metadata_fields(metadata_result)
            asset_updates.append((width, height, duration, asset_id))
            meta_updates.append(
                (
                    1 if has_workflow else 0,
                    1 if has_generation_data else 0,
                    metadata_quality,
                    metadata_raw_json,
                    asset_id,
                )
            )

        if not asset_updates and not meta_updates:
            return

        # Keep DB writes serialized with scans/index_files to avoid lock contention.
        async with self._scan_lock:
            async with self.db.atransaction(mode="immediate"):
                if asset_updates:
                    await self.db.aexecutemany(
                        """
                        UPDATE assets
                        SET width = COALESCE(?, width),
                            height = COALESCE(?, height),
                            duration = COALESCE(?, duration),
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                        """,
                        asset_updates,
                    )
                if meta_updates:
                    # executemany() + triggers can be brittle across SQLite builds; keep this robust.
                    for (_, _, _, _, asset_id) in meta_updates:
                        await self.db.aexecute(
                            "INSERT OR IGNORE INTO asset_metadata(asset_id, rating, tags) VALUES (?, 0, '[]')",
                            (asset_id,),
                        )
                    for hw, hg, q, raw, asset_id in meta_updates:
                        await self.db.aexecute(
                            """
                            UPDATE asset_metadata
                            SET has_workflow = ?,
                                has_generation_data = ?,
                                metadata_quality = ?,
                                metadata_raw = ?
                            WHERE asset_id = ?
                            """,
                            (hw, hg, q, raw, asset_id),
                        )
