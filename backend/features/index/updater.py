"""
Asset updater - handles rating and tag updates.
"""
import json
from typing import List, Dict, Any

from ...shared import Result
from ...adapters.db.sqlite import Sqlite

MAX_TAG_LENGTH = 100


class AssetUpdater:
    """
    Handles asset metadata updates (ratings and tags).

    Provides methods to update asset ratings and tags while maintaining
    data integrity and handling the tags_text column for FTS5 indexing.
    """

    def __init__(self, db: Sqlite, has_tags_text_column: bool):
        """
        Initialize asset updater.

        Args:
            db: Database adapter instance
            has_tags_text_column: Whether the tags_text column exists in asset_metadata
        """
        self.db = db
        self._has_tags_text_column = has_tags_text_column

    async def update_asset_rating(self, asset_id: int, rating: int) -> Result[Dict[str, Any]]:
        """
        Update the rating for an asset.

        Args:
            asset_id: Asset ID
            rating: Rating value (0-5)

        Returns:
            Result with updated asset info
        """
        rating = max(0, min(5, int(rating or 0)))

        # Ensure asset exists
        check_result = await self.db.aquery(
            "SELECT id FROM assets WHERE id = ?",
            (asset_id,)
        )
        if not check_result.ok or not check_result.data or len(check_result.data) == 0:
            return Result.Err("NOT_FOUND", f"Asset not found: {asset_id}")

        # Update or insert asset_metadata (serialize per-asset to avoid race with enrichers)
        async with self.db.lock_for_asset(asset_id):
            result = await self.db.aexecute(
                """
                INSERT INTO asset_metadata (asset_id, rating, tags)
                VALUES (?, ?, '[]')
                ON CONFLICT(asset_id) DO UPDATE SET
                    rating = excluded.rating
                """,
                (asset_id, rating)
            )

        if not result.ok:
            return Result.Err("UPDATE_FAILED", result.error)

        return Result.Ok({"asset_id": asset_id, "rating": rating})

    async def update_asset_tags(self, asset_id: int, tags: List[str]) -> Result[Dict[str, Any]]:
        """
        Update the tags for an asset.

        Args:
            asset_id: Asset ID
            tags: List of tag strings

        Returns:
            Result with updated asset info
        """
        # Ensure asset exists
        check_result = await self.db.aquery(
            "SELECT id FROM assets WHERE id = ?",
            (asset_id,)
        )
        if not check_result.ok or not check_result.data or len(check_result.data) == 0:
            return Result.Err("NOT_FOUND", f"Asset not found: {asset_id}")

        # Sanitize tags
        sanitized = []
        for tag in tags:
            if not isinstance(tag, str):
                continue
            tag = str(tag).strip()
            if not tag or len(tag) > MAX_TAG_LENGTH:
                continue
            if tag not in sanitized:  # Deduplicate
                sanitized.append(tag)

        tags_json = json.dumps(sanitized, ensure_ascii=False)

        # Build tags_text for FTS5 (if column exists)
        tags_text = " ".join(sanitized) if self._has_tags_text_column else None

        # Update or insert asset_metadata (serialize per-asset to avoid race with enrichers)
        async with self.db.lock_for_asset(asset_id):
            if self._has_tags_text_column:
                result = await self.db.aexecute(
                    """
                    INSERT INTO asset_metadata (asset_id, rating, tags, tags_text)
                    VALUES (?, 0, ?, ?)
                    ON CONFLICT(asset_id) DO UPDATE SET
                        tags = excluded.tags,
                        tags_text = excluded.tags_text
                    """,
                    (asset_id, tags_json, tags_text)
                )
            else:
                result = await self.db.aexecute(
                    """
                    INSERT INTO asset_metadata (asset_id, rating, tags)
                    VALUES (?, 0, ?)
                    ON CONFLICT(asset_id) DO UPDATE SET
                        tags = excluded.tags
                    """,
                    (asset_id, tags_json)
                )

        if not result.ok:
            return Result.Err("UPDATE_FAILED", result.error)

        return Result.Ok({"asset_id": asset_id, "tags": sanitized})

    async def get_all_tags(self) -> Result[List[str]]:
        """
        Get all unique tags from the database for autocomplete.

        Returns:
            Result with list of unique tags sorted alphabetically
        """
        result = await self.db.aquery(
            """
            SELECT DISTINCT tags
            FROM asset_metadata
            WHERE tags IS NOT NULL AND tags != '[]'
            """
        )

        if not result.ok:
            return Result.Err("DB_ERROR", result.error)

        # Collect all unique tags
        all_tags = set()
        for row in result.data or []:
            tags_json = row.get("tags")
            if not tags_json:
                continue
            try:
                tags = json.loads(tags_json) if isinstance(tags_json, str) else tags_json
                if isinstance(tags, list):
                    for tag in tags:
                        if isinstance(tag, str) and tag.strip():
                            all_tags.add(tag.strip())
            except Exception:
                continue

        sorted_tags = sorted(all_tags)
        return Result.Ok(sorted_tags)
