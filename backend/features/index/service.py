"""
Index Service - file scanning, incremental updates, and FTS search.

This service coordinates multiple specialized components:
- IndexScanner: Directory scanning and file indexing
- IndexSearcher: Search and retrieval operations
- AssetUpdater: Rating and tag updates
- MetadataEnricher: Background metadata enrichment
- MetadataHelpers: Shared metadata utilities
"""
import asyncio
from pathlib import Path
from typing import Optional, List, Dict, Any

from ...shared import get_logger, Result
from shared.scan_throttle import mark_directory_indexed
from ...adapters.db.sqlite import Sqlite
from ..metadata import MetadataService
from .scanner import IndexScanner
from .searcher import IndexSearcher
from .updater import AssetUpdater
from .enricher import MetadataEnricher
from .metadata_helpers import MetadataHelpers


logger = get_logger(__name__)


class IndexService:
    """
    Handles file indexing and search operations.

    Features:
    - Recursive directory scanning
    - Incremental updates based on mtime
    - FTS5 full-text search with BM25 ranking
    - Asset metadata extraction integration

    This service acts as a coordinator, delegating to specialized components
    for each area of functionality.
    """

    def __init__(self, db: Sqlite, metadata_service: MetadataService, has_tags_text_column: bool = False):
        self.db = db
        self.metadata = metadata_service
        self._scan_lock = asyncio.Lock()
        self._has_tags_text_column = has_tags_text_column
        logger.debug("asset_metadata.tags_text column available: %s", self._has_tags_text_column)

        # Initialize specialized components
        self._scanner = IndexScanner(db, metadata_service, self._scan_lock)
        self.searcher = IndexSearcher(db, self._has_tags_text_column)
        self._updater = AssetUpdater(db, self._has_tags_text_column)
        self._enricher = MetadataEnricher(
            db,
            metadata_service,
            self._scanner._compute_state_hash,
            MetadataHelpers.prepare_metadata_fields,
            MetadataHelpers.metadata_error_payload,
        )

    # ==================== Scanning Operations ====================

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
        result = await self._scanner.scan_directory(
            directory,
            recursive,
            incremental,
            source,
            root_id,
            fast,
            background_metadata,
        )

        if result.ok:
            try:
                # Notify frontend of scan completion
                from ...routes.registry import PromptServer
                PromptServer.instance.send_sync("mjr-scan-complete", result.data)
            except Exception as e:
                logger.debug("Failed to emit scan-complete event: %s", e)
            if not fast:
                mark_directory_indexed(directory, source, root_id, metadata_complete=True)

        # Handle background enrichment if requested
        if result.ok and fast and background_metadata:
            to_enrich = result.data.get("to_enrich", [])
            if to_enrich:
                try:
                    await self._enricher.start_enrichment(to_enrich)
                except Exception as exc:
                    logger.debug("Background enrichment start skipped: %s", exc)
                # Remove from stats as it's internal
                result.data.pop("to_enrich", None)

        return result

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
        res = await self._scanner.index_paths(paths, base_dir, incremental, source, root_id)
        if res.ok:
            try:
                # Notify frontend (useful for drag-drop staging updates)
                from ...routes.registry import PromptServer
                PromptServer.instance.send_sync("mjr-scan-complete", res.data)
            except Exception as e:
                logger.debug("Failed to emit scan-complete event: %s", e)
            mark_directory_indexed(base_dir, source, root_id)
        return res

    async def remove_file(self, filepath: str) -> Result[bool]:
        """
        Remove a file from the index.

        Args:
            filepath: Absolute path of the file to remove

        Returns:
            Result indicating success
        """
        # ON DELETE CASCADE handles asset_metadata, scan_journal, etc.
        res = await self.db.aexecute("DELETE FROM assets WHERE filepath = ?", (str(filepath),))
        if not res.ok:
            logger.warning("Failed to remove asset from index (%s): %s", filepath, res.error)
            return Result.Err("DB_ERROR", res.error or "Failed to delete asset")
        logger.debug(f"Removed from index: {filepath}")
        return Result.Ok(True)

    # ==================== Search Operations ====================

    async def search(
        self,
        query: str,
        limit: int = 50,
        offset: int = 0,
        filters: Optional[Dict[str, Any]] = None,
        include_total: bool = True,
    ) -> Result[Dict[str, Any]]:
        """
        Search assets using FTS5 full-text search, or browse all if query is '*'.

        Args:
            query: Search query (FTS5 syntax supported, or '*' to browse all)
            limit: Max results to return
            offset: Pagination offset
            filters: Optional filters (kind, rating, tags, etc.)

        Returns:
            Result with search results and metadata
        """
        return await self.searcher.search(query, limit, offset, filters, include_total=include_total)

    async def search_scoped(
        self,
        query: str,
        roots: List[str],
        limit: int = 50,
        offset: int = 0,
        filters: Optional[Dict[str, Any]] = None,
        include_total: bool = True,
    ) -> Result[Dict[str, Any]]:
        """
        Search assets but restrict results to files whose absolute filepath is under one of the provided roots.

        This is used for UI scopes like Outputs / Inputs / All without breaking the existing DB structure.
        """
        return await self.searcher.search_scoped(query, roots, limit, offset, filters, include_total=include_total)

    async def has_assets_under_root(self, root: str) -> Result[bool]:
        """
        Return True if the DB has at least one asset under the provided root.
        """
        return await self.searcher.has_assets_under_root(root)

    async def date_histogram_scoped(
        self,
        roots: List[str],
        month_start: int,
        month_end: int,
        filters: Optional[Dict[str, Any]] = None,
    ) -> Result[Dict[str, int]]:
        """
        Return a day->count mapping for assets within a month for the given roots.

        Used by the UI calendar to mark days that have assets.
        """
        return await self.searcher.date_histogram_scoped(roots, month_start, month_end, filters)

    async def get_asset(self, asset_id: int) -> Result[Optional[Dict[str, Any]]]:
        """Fetch a single asset row by id."""
        # Async path: return the DB row; deep "self-heal" is handled by scan/enrich flows.
        return await self.searcher.get_asset(asset_id)

    async def get_assets_batch(self, asset_ids: List[int]) -> Result[List[Dict[str, Any]]]:
        """
        Batch fetch assets by ID (single query).

        This is used by the UI to reduce network chatter and avoid triggering per-asset self-heal
        paths that may invoke external tools.
        """
        return await self.searcher.get_assets(asset_ids)

    async def lookup_assets_by_filepaths(self, filepaths: List[str]) -> Result[Dict[str, Dict[str, Any]]]:
        """
        Lookup DB-enriched asset fields for a set of absolute filepaths.

        This is used to enrich filesystem listings (input/custom) without requiring
        a full directory scan on every request.
        """
        return await self.searcher.lookup_assets_by_filepaths(filepaths)

    # ==================== Update Operations ====================

    async def update_asset_rating(self, asset_id: int, rating: int) -> Result[Dict[str, Any]]:
        """
        Update the rating for an asset.

        Args:
            asset_id: Asset ID
            rating: Rating value (0-5)

        Returns:
            Result with updated asset info
        """
        return await self._updater.update_asset_rating(asset_id, rating)

    async def update_asset_tags(self, asset_id: int, tags: List[str]) -> Result[Dict[str, Any]]:
        """
        Update the tags for an asset.

        Args:
            asset_id: Asset ID
            tags: List of tag strings

        Returns:
            Result with updated asset info
        """
        return await self._updater.update_asset_tags(asset_id, tags)

    async def get_all_tags(self) -> Result[List[str]]:
        """
        Get all unique tags from the database for autocomplete.

        Returns:
            Result with list of unique tags sorted alphabetically
        """
        return await self._updater.get_all_tags()
