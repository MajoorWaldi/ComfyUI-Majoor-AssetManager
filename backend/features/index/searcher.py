"""
Index searcher - handles asset search and retrieval operations.
"""
import json
import logging
import os
import re
from pathlib import Path
from typing import Optional, List, Dict, Any, Tuple

from ...shared import get_logger, Result
from ...adapters.db.sqlite import Sqlite


logger = get_logger(__name__)

MAX_SEARCH_QUERY_LENGTH = 512
MAX_SEARCH_TOKENS = 16
MAX_TOKEN_LENGTH = 64
MAX_ASSET_BATCH_IDS = 200
MAX_FILEPATH_LOOKUP = 5000


def _build_filter_clauses(filters: Optional[Dict[str, Any]], alias: str = "a") -> Tuple[List[str], List[Any]]:
    clauses: List[str] = []
    params: List[Any] = []
    if not filters:
        return clauses, params
    kind = filters.get("kind")
    if isinstance(kind, str) and kind:
        clauses.append(f"AND {alias}.kind = ?")
        params.append(kind)
    if "min_rating" in filters:
        clauses.append("AND COALESCE(m.rating, 0) >= ?")
        params.append(filters["min_rating"])
    if "has_workflow" in filters:
        clauses.append("AND COALESCE(m.has_workflow, 0) = ?")
        params.append(1 if filters["has_workflow"] else 0)
    if "mtime_start" in filters:
        clauses.append(f"AND {alias}.mtime >= ?")
        params.append(filters["mtime_start"])
    if "mtime_end" in filters:
        clauses.append(f"AND {alias}.mtime < ?")
        params.append(filters["mtime_end"])
    return clauses, params


class IndexSearcher:
    """
    Handles asset search and retrieval operations.

    Provides FTS5 full-text search, scoped search, single asset lookup,
    and bulk filepath lookups for asset enrichment.
    """

    def __init__(self, db: Sqlite, has_tags_text_column: bool):
        """
        Initialize index searcher.

        Args:
            db: Database adapter instance
            has_tags_text_column: Whether the tags_text column exists in asset_metadata
        """
        self.db = db
        self._has_tags_text_column = has_tags_text_column

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
        if not query or not query.strip():
            return Result.Err("EMPTY_QUERY", "Search query cannot be empty")

        validation = self._validate_search_input(query)
        if validation and not validation.ok:
            return validation

        logger.debug(f"Searching for: {query} (limit={limit}, offset={offset})")
        metadata_tags_text_clause = self._build_tags_text_clause()

        # Check if this is a "browse all" request
        is_browse_all = query.strip() == "*"

        if is_browse_all:
            # Browse all assets (no FTS, just regular query)
            sql_parts = [
                f"""
                SELECT
                    a.id, a.filename, a.subfolder, a.filepath, a.kind,
                    a.source, a.root_id,
                    a.width, a.height, a.duration, a.size, a.mtime,
                    COALESCE(m.rating, 0) as rating,
                    COALESCE(m.tags, '[]') as tags,
 {metadata_tags_text_clause}                    COALESCE(m.has_workflow, 0) as has_workflow,
                    COALESCE(m.has_generation_data, 0) as has_generation_metadata
                FROM assets a
                LEFT JOIN asset_metadata m ON a.id = m.asset_id
                WHERE 1=1
                """
            ]
            params = []

            filter_clauses, filter_params = _build_filter_clauses(filters)
            sql_parts.extend(filter_clauses)
            params.extend(filter_params)

            # Order by most recent first
            sql_parts.append("ORDER BY a.mtime DESC")
            sql_parts.append("LIMIT ? OFFSET ?")
            params.extend([limit, offset])

            sql = " ".join(sql_parts)
            result = await self.db.aquery(sql, tuple(params))

            if not result.ok:
                return Result.Err("SEARCH_FAILED", result.error)

            rows = result.data

            total = None
            if include_total:
                # Get total count
                count_sql = "SELECT COUNT(*) as total FROM assets a LEFT JOIN asset_metadata m ON a.id = m.asset_id WHERE 1=1"
                count_params = []

                if filter_clauses:
                    count_sql += " " + " ".join(filter_clauses)
                    count_params.extend(filter_params)

                count_result = await self.db.aquery(count_sql, tuple(count_params))
                total = count_result.data[0]["total"] if count_result.ok and count_result.data else 0

        else:
            # FTS5 search
            fts_query = self._sanitize_fts_query(query)

            sql_parts = [
                f"""
                WITH matches AS (
                    SELECT rowid AS asset_id, bm25(assets_fts) AS rank
                    FROM assets_fts
                    WHERE assets_fts MATCH ?

                    UNION ALL

                    SELECT rowid AS asset_id, (bm25(asset_metadata_fts) + 8.0) AS rank
                    FROM asset_metadata_fts
                    WHERE asset_metadata_fts MATCH ?
                ),
                best AS (
                    SELECT asset_id, MIN(rank) AS rank
                    FROM matches
                    GROUP BY asset_id
                )
                SELECT
                    a.id, a.filename, a.subfolder, a.filepath, a.kind,
                    a.source, a.root_id,
                    a.width, a.height, a.duration, a.size, a.mtime,
                    COALESCE(m.rating, 0) as rating,
                    COALESCE(m.tags, '[]') as tags,
 {metadata_tags_text_clause}                    COALESCE(m.has_workflow, 0) as has_workflow,
                    COALESCE(m.has_generation_data, 0) as has_generation_metadata,
                    best.rank as rank
                FROM best
                JOIN assets a ON best.asset_id = a.id
                LEFT JOIN asset_metadata m ON a.id = m.asset_id
                WHERE 1=1
                """
            ]

            params = [fts_query, fts_query]

            filter_clauses, filter_params = _build_filter_clauses(filters)
            sql_parts.extend(filter_clauses)
            params.extend(filter_params)

            # Add ordering and pagination
            sql_parts.append("ORDER BY rank")
            sql_parts.append("LIMIT ? OFFSET ?")
            params.extend([limit, offset])

            sql = " ".join(sql_parts)

            # Execute search
            result = await self.db.aquery(sql, tuple(params))

            if not result.ok:
                return Result.Err("SEARCH_FAILED", result.error)

            rows = result.data

            total = None
            if include_total:
                # Get total count (without pagination)
                count_sql = """
                    WITH matches AS (
                        SELECT rowid AS asset_id
                        FROM assets_fts
                        WHERE assets_fts MATCH ?

                        UNION

                        SELECT rowid AS asset_id
                        FROM asset_metadata_fts
                        WHERE asset_metadata_fts MATCH ?
                    )
                    SELECT COUNT(*) as total
                    FROM (SELECT DISTINCT asset_id FROM matches) t
                    JOIN assets a ON t.asset_id = a.id
                    LEFT JOIN asset_metadata m ON a.id = m.asset_id
                    WHERE 1=1
                """
                count_params = [fts_query, fts_query]

                if filter_clauses:
                    count_sql += " " + " ".join(filter_clauses)
                    count_params.extend(filter_params)

                count_result = await self.db.aquery(count_sql, tuple(count_params))
                total = count_result.data[0]["total"] if count_result.ok and count_result.data else 0

        # Format results
        assets = []
        for row in rows:
            asset = dict(row)
            # Parse tags from JSON string
            if asset.get("tags"):
                try:
                    asset["tags"] = json.loads(asset["tags"])
                except (ValueError, json.JSONDecodeError, TypeError):
                    asset["tags"] = []
            else:
                asset["tags"] = []
            asset.setdefault("tags_text", "")

            assets.append(asset)

        logger.debug("Found %s results (total=%s)", len(assets), total if include_total else "skipped")

        payload: Dict[str, Any] = {"assets": assets, "limit": limit, "offset": offset, "query": query}
        payload["total"] = int(total or 0) if include_total else None
        return Result.Ok(payload)

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
        cleaned_roots: List[str] = []
        for r in roots or []:
            if not r:
                continue
            try:
                cleaned_roots.append(str(Path(r).resolve()))
            except Exception:
                continue

        if not cleaned_roots:
            return Result.Err("INVALID_INPUT", "Missing or invalid roots")

        # Reuse the existing search logic but inject a filepath prefix constraint.
        if not query or not query.strip():
            return Result.Err("EMPTY_QUERY", "Search query cannot be empty")

        validation = self._validate_search_input(query)
        if validation and not validation.ok:
            return validation

        logger.debug(f"Searching (scoped) for: {query} (limit={limit}, offset={offset}, roots={len(cleaned_roots)})")
        metadata_tags_text_clause = self._build_tags_text_clause()

        def _escape_like_pattern(pattern: str) -> str:
            """Escape LIKE special characters (% and _) for safe prefix matching."""
            return pattern.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")

        def _roots_where() -> Tuple[str, List[Any]]:
            parts = []
            params: List[Any] = []
            for root in cleaned_roots:
                prefix = root.rstrip(os.sep) + os.sep
                escaped_prefix = _escape_like_pattern(prefix)
                parts.append("(a.filepath = ? OR a.filepath LIKE ? ESCAPE '\\')")
                params.extend([root, f"{escaped_prefix}%"])
            return "(" + " OR ".join(parts) + ")", params

        is_browse_all = query.strip() == "*"

        roots_clause, roots_params = _roots_where()

        if is_browse_all:
            sql_parts = [
                f"""
                SELECT
                    a.id, a.filename, a.subfolder, a.filepath, a.kind,
                    a.width, a.height, a.duration, a.size, a.mtime,
                    COALESCE(m.rating, 0) as rating,
                    COALESCE(m.tags, '[]') as tags,
{metadata_tags_text_clause}                    COALESCE(m.has_workflow, 0) as has_workflow,
                    COALESCE(m.has_generation_data, 0) as has_generation_metadata
                FROM assets a
                LEFT JOIN asset_metadata m ON a.id = m.asset_id
                WHERE {roots_clause}
                """
            ]
            params: List[Any] = []
            params.extend(roots_params)

            filter_clauses, filter_params = _build_filter_clauses(filters)
            sql_parts.extend(filter_clauses)
            params.extend(filter_params)

            sql_parts.append("ORDER BY a.mtime DESC")
            sql_parts.append("LIMIT ? OFFSET ?")
            params.extend([limit, offset])

            sql = " ".join(sql_parts)
            result = await self.db.aquery(sql, tuple(params))
            if not result.ok:
                return Result.Err("SEARCH_FAILED", result.error)

            rows = result.data

            total = None
            if include_total:
                count_sql = f"""
                    SELECT COUNT(*) as total
                    FROM assets a
                    LEFT JOIN asset_metadata m ON a.id = m.asset_id
                    WHERE {roots_clause}
                """
                count_params: List[Any] = []
                count_params.extend(roots_params)

                if filter_clauses:
                    count_sql += " " + " ".join(filter_clauses)
                    count_params.extend(filter_params)

                count_result = await self.db.aquery(count_sql, tuple(count_params))
                total = count_result.data[0]["total"] if count_result.ok and count_result.data else 0
        else:
            fts_query = self._sanitize_fts_query(query)
            sql_parts = [
                f"""
                WITH matches AS (
                    SELECT rowid AS asset_id, bm25(assets_fts) AS rank
                    FROM assets_fts
                    WHERE assets_fts MATCH ?

                    UNION ALL

                    SELECT rowid AS asset_id, (bm25(asset_metadata_fts) + 8.0) AS rank
                    FROM asset_metadata_fts
                    WHERE asset_metadata_fts MATCH ?
                ),
                best AS (
                    SELECT asset_id, MIN(rank) AS rank
                    FROM matches
                    GROUP BY asset_id
                )
                SELECT
                    a.id, a.filename, a.subfolder, a.filepath, a.kind,
                    a.width, a.height, a.duration, a.size, a.mtime,
                    COALESCE(m.rating, 0) as rating,
                    COALESCE(m.tags, '[]') as tags,
{metadata_tags_text_clause}                    COALESCE(m.has_workflow, 0) as has_workflow,
                    COALESCE(m.has_generation_data, 0) as has_generation_metadata,
                    best.rank as rank
                FROM best
                JOIN assets a ON best.asset_id = a.id
                LEFT JOIN asset_metadata m ON a.id = m.asset_id
                WHERE {roots_clause}
                """
            ]

            params: List[Any] = [fts_query, fts_query]
            params.extend(roots_params)

            filter_clauses, filter_params = _build_filter_clauses(filters)
            sql_parts.extend(filter_clauses)
            params.extend(filter_params)

            sql_parts.append("ORDER BY rank")
            sql_parts.append("LIMIT ? OFFSET ?")
            params.extend([limit, offset])

            sql = " ".join(sql_parts)
            result = await self.db.aquery(sql, tuple(params))
            if not result.ok:
                return Result.Err("SEARCH_FAILED", result.error)

            rows = result.data

            total = None
            if include_total:
                count_sql = f"""
                    WITH matches AS (
                        SELECT rowid AS asset_id
                        FROM assets_fts
                        WHERE assets_fts MATCH ?

                        UNION

                        SELECT rowid AS asset_id
                        FROM asset_metadata_fts
                        WHERE asset_metadata_fts MATCH ?
                    )
                    SELECT COUNT(*) as total
                    FROM (SELECT DISTINCT asset_id FROM matches) t
                    JOIN assets a ON t.asset_id = a.id
                    LEFT JOIN asset_metadata m ON a.id = m.asset_id
                    WHERE {roots_clause}
                """
                count_params: List[Any] = [fts_query, fts_query]
                count_params.extend(roots_params)

                if filter_clauses:
                    count_sql += " " + " ".join(filter_clauses)
                    count_params.extend(filter_params)

                count_result = await self.db.aquery(count_sql, tuple(count_params))
                total = count_result.data[0]["total"] if count_result.ok and count_result.data else 0

        assets = []
        for row in rows:
            asset = dict(row)
            if asset.get("tags"):
                try:
                    asset["tags"] = json.loads(asset["tags"])
                except Exception:
                    asset["tags"] = []
            else:
                asset["tags"] = []
            asset.setdefault("tags_text", "")
            assets.append(asset)

        payload: Dict[str, Any] = {"assets": assets, "limit": limit, "offset": offset, "query": query}
        payload["total"] = int(total or 0) if include_total else None
        return Result.Ok(payload)

    async def has_assets_under_root(self, root: str) -> Result[bool]:
        """
        Return True if the DB contains at least one asset whose filepath is exactly `root`
        or is nested under it (prefix match).
        """
        try:
            resolved = str(Path(root).resolve())
        except Exception as exc:
            return Result.Err("INVALID_INPUT", f"Invalid root: {exc}")

        def _escape_like_pattern(pattern: str) -> str:
            return pattern.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")

        prefix = resolved.rstrip(os.sep) + os.sep
        escaped_prefix = _escape_like_pattern(prefix)
        sql = """
            SELECT 1
            FROM assets a
            WHERE (a.filepath = ? OR a.filepath LIKE ? ESCAPE '\\')
            LIMIT 1
        """
        result = await self.db.aquery(sql, (resolved, f"{escaped_prefix}%"))
        if not result.ok:
            return Result.Err("DB_ERROR", result.error)
        return Result.Ok(bool(result.data))

    async def date_histogram_scoped(
        self,
        roots: List[str],
        month_start: int,
        month_end: int,
        filters: Optional[Dict[str, Any]] = None,
    ) -> Result[Dict[str, int]]:
        """
        Return a day->count mapping for assets whose mtime falls inside [month_start, month_end).

        Notes:
        - Uses localtime conversion to match the UI's date filters (which use local time).
        - Intended for calendar "days with assets" indicators (no query/FTS).
        """
        cleaned_roots: List[str] = []
        for r in roots or []:
            if not r:
                continue
            try:
                cleaned_roots.append(str(Path(r).resolve()))
            except Exception:
                continue

        if not cleaned_roots:
            return Result.Err("INVALID_INPUT", "Missing or invalid roots")

        try:
            start_i = int(month_start)
            end_i = int(month_end)
        except Exception:
            return Result.Err("INVALID_INPUT", "Invalid month range")

        if start_i <= 0 or end_i <= 0 or end_i <= start_i:
            return Result.Err("INVALID_INPUT", "Invalid month range")

        def _escape_like_pattern(pattern: str) -> str:
            return pattern.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")

        def _roots_where() -> Tuple[str, List[Any]]:
            parts = []
            params: List[Any] = []
            for root in cleaned_roots:
                prefix = root.rstrip(os.sep) + os.sep
                escaped_prefix = _escape_like_pattern(prefix)
                parts.append("(a.filepath = ? OR a.filepath LIKE ? ESCAPE '\\')")
                params.extend([root, f"{escaped_prefix}%"])
            return "(" + " OR ".join(parts) + ")", params

        roots_clause, roots_params = _roots_where()

        # Do not allow callers to inject their own mtime window beyond the month we requested.
        safe_filters = dict(filters or {})
        safe_filters.pop("mtime_start", None)
        safe_filters.pop("mtime_end", None)

        sql_parts = [
            """
            SELECT
                strftime('%Y-%m-%d', a.mtime, 'unixepoch', 'localtime') AS day,
                COUNT(*) AS count
            FROM assets a
            LEFT JOIN asset_metadata m ON a.id = m.asset_id
            WHERE
            """,
            roots_clause,
            "AND a.mtime >= ? AND a.mtime < ?",
        ]
        params: List[Any] = []
        params.extend(roots_params)
        params.extend([start_i, end_i])

        filter_clauses, filter_params = _build_filter_clauses(safe_filters)
        sql_parts.extend(filter_clauses)
        params.extend(filter_params)

        sql_parts.append("GROUP BY day ORDER BY day ASC")

        sql = " ".join(sql_parts)
        result = await self.db.aquery(sql, tuple(params))
        if not result.ok:
            return Result.Err("DB_ERROR", result.error)

        days: Dict[str, int] = {}
        for row in result.data or []:
            try:
                day = str(row.get("day") or "").strip()
                count = int(row.get("count") or 0)
            except Exception:
                continue
            if day:
                days[day] = max(0, count)

        return Result.Ok(days)

    async def get_asset(self, asset_id: int) -> Result[Optional[Dict[str, Any]]]:
        """
        Get a single asset by ID.

        Args:
            asset_id: Asset database ID

        Returns:
            Result with asset data or None if not found
        """
        result = await self.db.aquery(
            """
            SELECT
                a.*,
                COALESCE(m.rating, 0) AS rating,
                COALESCE(m.tags, '') AS tags,
                COALESCE(m.tags_text, '') AS tags_text,
                m.workflow_hash,
                COALESCE(m.has_workflow, 0) AS has_workflow,
                COALESCE(m.has_generation_data, 0) AS has_generation_data,
                COALESCE(m.metadata_quality, 'none') AS metadata_quality,
                COALESCE(m.metadata_raw, '{}') AS metadata_raw
            FROM assets a
            LEFT JOIN asset_metadata m ON m.asset_id = a.id
            WHERE a.id = ?
            """,
            (asset_id,),
        )

        if not result.ok:
            return Result.Err("QUERY_FAILED", result.error)

        if not result.data:
            return Result.Ok(None)

        asset = self._hydrate_asset_payload(dict(result.data[0]))
        return Result.Ok(asset)

    async def get_assets(self, asset_ids: List[int]) -> Result[List[Dict[str, Any]]]:
        """
        Batch fetch assets by ID (single query).

        Intended for UI batching (viewer preloading) without triggering per-asset metadata extraction.
        """
        cleaned: List[int] = []
        seen = set()
        for raw in asset_ids or []:
            try:
                n = int(raw)
            except Exception:
                continue
            if n <= 0:
                continue
            if n in seen:
                continue
            seen.add(n)
            cleaned.append(n)
            if len(cleaned) >= MAX_ASSET_BATCH_IDS:
                break

        if not cleaned:
            return Result.Ok([])

        result = await self.db.aquery_in(
            """
            SELECT
                a.*,
                COALESCE(m.rating, 0) AS rating,
                COALESCE(m.tags, '') AS tags,
                COALESCE(m.tags_text, '') AS tags_text,
                m.workflow_hash,
                COALESCE(m.has_workflow, 0) AS has_workflow,
                COALESCE(m.has_generation_data, 0) AS has_generation_data,
                COALESCE(m.metadata_quality, 'none') AS metadata_quality,
                COALESCE(m.metadata_raw, '{{}}') AS metadata_raw
            FROM assets a
            LEFT JOIN asset_metadata m ON m.asset_id = a.id
            WHERE {IN_CLAUSE}
            """,
            "a.id",
            cleaned,
        )

        if not result.ok:
            return Result.Err("QUERY_FAILED", result.error)

        by_id: Dict[int, Dict[str, Any]] = {}
        for row in result.data or []:
            try:
                asset = self._hydrate_asset_payload(dict(row))
            except Exception:
                continue
            try:
                aid = int(asset.get("id"))
            except Exception:
                continue
            by_id[aid] = asset

        # Preserve requested ordering.
        out: List[Dict[str, Any]] = []
        for aid in cleaned:
            item = by_id.get(aid)
            if item:
                out.append(item)
        return Result.Ok(out)

    def _hydrate_asset_payload(self, asset: Dict[str, Any]) -> Dict[str, Any]:
        # Parse tags JSON (stored as string in DB)
        tags_raw = asset.get("tags") or ""
        if tags_raw:
            try:
                asset["tags"] = json.loads(tags_raw)
            except (ValueError, json.JSONDecodeError, TypeError):
                asset["tags"] = []
        else:
            asset["tags"] = []

        # Parse metadata_raw JSON and expose common top-level fields for the UI.
        metadata_raw_text = asset.get("metadata_raw") or "{}"
        try:
            metadata_obj = json.loads(metadata_raw_text) if isinstance(metadata_raw_text, str) else metadata_raw_text
        except (ValueError, json.JSONDecodeError, TypeError):
            metadata_obj = {}

        asset["metadata_raw"] = metadata_obj
        if isinstance(metadata_obj, dict):
            # Common nested fields produced by our extractors
            asset.setdefault("prompt", metadata_obj.get("prompt"))
            asset.setdefault("workflow", metadata_obj.get("workflow"))
            asset.setdefault("exif", metadata_obj.get("exif") or metadata_obj.get("raw"))
            asset.setdefault("geninfo", metadata_obj.get("geninfo"))

        return asset

    async def lookup_assets_by_filepaths(self, filepaths: List[str]) -> Result[Dict[str, Dict[str, Any]]]:
        """
        Lookup DB-enriched asset fields for a set of absolute filepaths.

        This is used to enrich filesystem listings (input/custom) without requiring
        a full directory scan on every request.
        """
        cleaned = [str(p) for p in (filepaths or []) if p]
        if not cleaned:
            return Result.Ok({})
        # Guard against overly large IN clauses
        if len(cleaned) > MAX_FILEPATH_LOOKUP:
            cleaned = cleaned[:MAX_FILEPATH_LOOKUP]

        result = await self.db.aquery_in(
            """
            SELECT
                a.filepath,
                a.id,
                a.source,
                a.root_id,
                COALESCE(m.rating, 0) as rating,
                COALESCE(m.tags, '[]') as tags,
                COALESCE(m.has_workflow, 0) as has_workflow,
                COALESCE(m.has_generation_data, 0) as has_generation_metadata
            FROM assets a
            LEFT JOIN asset_metadata m ON a.id = m.asset_id
            WHERE {IN_CLAUSE}
            """,
            "a.filepath",
            cleaned,
        )
        if not result.ok:
            return Result.Err("DB_ERROR", result.error)

        out: Dict[str, Dict[str, Any]] = {}
        for row in result.data or []:
            if not isinstance(row, dict):
                continue
            fp = row.get("filepath")
            if not fp:
                continue
            item = dict(row)
            tags_raw = item.get("tags")
            if tags_raw:
                try:
                    item["tags"] = json.loads(tags_raw) if isinstance(tags_raw, str) else tags_raw
                except Exception:
                    item["tags"] = []
            else:
                item["tags"] = []
            out[str(fp)] = item
        return Result.Ok(out)

    def _sanitize_fts_query(self, query: str) -> str:
        """
        Escape special characters for FTS5 and collapse whitespace.
        """
        text = query.strip()
        if not text:
            return "*"

        # Replace FTS5 special characters with spaces
        sanitized = re.sub(r"[\"'\-:&/\\|;@#*~()\[\]{}\.]+", " ", text)
        # Replace non-printable / control chars
        sanitized = re.sub(r"[^\x20-\x7E]+", " ", sanitized)
        # Collapse whitespace
        sanitized = re.sub(r"\s+", " ", sanitized).strip()
        return sanitized or "*"

    def _validate_search_input(self, query: str) -> Optional[Result[Any]]:
        trimmed = query.strip()
        # Allow "browse all" queries.
        if trimmed == "*" or (trimmed and all(token == "*" for token in trimmed.split())):
            return None
        if len(trimmed) > MAX_SEARCH_QUERY_LENGTH:
            return Result.Err(
                "QUERY_TOO_LONG",
                f"Search queries must be at most {MAX_SEARCH_QUERY_LENGTH} characters"
            )

        tokens = trimmed.split()
        if len(tokens) > MAX_SEARCH_TOKENS:
            return Result.Err(
                "QUERY_TOO_COMPLEX",
                f"Use at most {MAX_SEARCH_TOKENS} tokens for search queries"
            )

        if any(len(token) > MAX_TOKEN_LENGTH for token in tokens):
            return Result.Err(
                "TOKEN_TOO_LONG",
                f"Each search token must be under {MAX_TOKEN_LENGTH} characters"
            )

        # Reject suspicious patterns (repeated wildcard tokens)
        wildcard_hits = sum(1 for token in tokens if token == "*")
        if wildcard_hits > 0 and wildcard_hits >= len(tokens) - 1:
            return Result.Err(
                "QUERY_TOO_GENERAL",
                "Search query must contain at least one non-wildcard term"
            )

        return None

    def _build_tags_text_clause(self) -> str:
        if self._has_tags_text_column:
            return "                    COALESCE(m.tags_text, '') as tags_text,\n"
        return ""
