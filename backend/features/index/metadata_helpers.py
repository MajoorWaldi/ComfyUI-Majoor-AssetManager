"""
Metadata helpers - shared utilities for metadata operations.
"""
import hashlib
import asyncio
import json
import time
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, Tuple, Optional

from ...config import (
    MAX_METADATA_JSON_BYTES,
    METADATA_CACHE_MAX,
    METADATA_CACHE_TTL_SECONDS,
    METADATA_CACHE_CLEANUP_INTERVAL_SECONDS,
)
from ...shared import Result, get_logger
from ...adapters.db.sqlite import Sqlite
from ..metadata.parsing_utils import (
    looks_like_comfyui_workflow,
    looks_like_comfyui_prompt_graph,
    try_parse_json_text,
)

MAX_TAG_LENGTH = 100
logger = get_logger(__name__)
_METADATA_CACHE_CLEANUP_LOCK = asyncio.Lock()
_METADATA_CACHE_LAST_CLEANUP = 0.0


class MetadataHelpers:
    """
    Shared utilities for metadata operations.

    Provides static methods for metadata caching, field preparation,
    and error handling that are used across multiple components.
    """

    @staticmethod
    def prepare_metadata_fields(metadata_result: Result[Dict[str, Any]]) -> Tuple[Optional[bool], Optional[bool], str, str]:
        """
        Extract the workflow/generation metadata attributes and JSON payload.

        Args:
            metadata_result: Result from metadata extraction

        Returns:
            Tuple of (has_workflow, has_generation_data, metadata_quality, metadata_raw_json)
        """
        has_workflow: Optional[bool] = None
        has_generation_data: Optional[bool] = None
        metadata_quality = "none"
        metadata_raw_json = "{}"

        def _graph_has_sampler(graph: Any) -> bool:
            try:
                # Workflow export: dict with `nodes: []` and nodes have `type`.
                if isinstance(graph, dict) and isinstance(graph.get("nodes"), list):
                    for node in graph.get("nodes") or []:
                        if not isinstance(node, dict):
                            continue
                        ct = str(node.get("type") or node.get("class_type") or "").lower()
                        if not ct:
                            continue
                        if "ksampler" in ct and "select" not in ct:
                            return True
                        if "samplercustom" in ct:
                            return True
                        if "sampler" in ct and "select" not in ct:
                            return True
                    return False

                # Prompt graph: dict of nodes with `class_type`.
                if isinstance(graph, dict):
                    for node in graph.values():
                        if not isinstance(node, dict):
                            continue
                        ct = str(node.get("class_type") or node.get("type") or "").lower()
                        if not ct:
                            continue
                        if "ksampler" in ct and "select" not in ct:
                            return True
                        if "samplercustom" in ct:
                            return True
                        if "sampler" in ct and "select" not in ct:
                            # Require a couple of sampling-ish keys to avoid false positives.
                            ins = node.get("inputs")
                            if isinstance(ins, dict) and any(k in ins for k in ("steps", "cfg", "cfg_scale", "seed", "denoise")):
                                return True
                    return False
            except Exception:
                return False
            return False

        def _coerce_json_dict(value: Any) -> Optional[Dict[str, Any]]:
            if isinstance(value, dict):
                return value
            if isinstance(value, str):
                parsed = try_parse_json_text(value)
                return parsed if isinstance(parsed, dict) else None
            return None

        if metadata_result and metadata_result.ok and isinstance(metadata_result.data, dict) and metadata_result.data:
            meta = metadata_result.data

            raw_workflow = meta.get("workflow")
            raw_prompt = meta.get("prompt")

            workflow_obj = _coerce_json_dict(raw_workflow)
            prompt_obj = _coerce_json_dict(raw_prompt)

            workflow_ok = bool(workflow_obj and looks_like_comfyui_workflow(workflow_obj))
            prompt_ok = bool(prompt_obj and looks_like_comfyui_prompt_graph(prompt_obj))

            # Backward-compatible: if the extractor stored non-empty strings but we can't parse,
            # still count it as "has_workflow" so Workflow-only filters don't hide the asset.
            workflow_present = bool(raw_workflow)
            prompt_present = bool(raw_prompt)

            has_workflow = bool(
                workflow_ok or
                prompt_ok or
                workflow_present or
                prompt_present or
                meta.get("parameters")
            )

            has_generation_data = bool(
                meta.get("parameters") or
                meta.get("geninfo") or
                meta.get("model") or
                meta.get("seed") or
                _graph_has_sampler(prompt_obj or raw_prompt) or
                _graph_has_sampler(workflow_obj or raw_workflow)
            )

            metadata_quality = meta.get("quality", "none")
            metadata_raw_json = json.dumps(meta)

        return has_workflow, has_generation_data, metadata_quality, metadata_raw_json

    @staticmethod
    def _bool_to_db(value: Optional[bool]) -> Optional[int]:
        if value is True:
            return 1
        if value is False:
            return 0
        return None

    @staticmethod
    def metadata_error_payload(metadata_result: Result[Dict[str, Any]], filepath: str) -> Result[Dict[str, Any]]:
        """
        Build a degraded metadata payload when extraction failed.

        Args:
            metadata_result: Failed result from metadata extraction
            filepath: File path for context

        Returns:
            Result with degraded payload
        """
        quality = metadata_result.meta.get("quality", "degraded")
        payload = {
            "filepath": filepath,
            "error": metadata_result.error or "Metadata extraction failed",
            "code": metadata_result.code,
            # Persist quality in the payload so downstream DB writes can avoid treating
            # degraded results as "none" and inadvertently downgrading existing metadata.
            "quality": quality,
        }

        for key, value in metadata_result.meta.items():
            if key == "quality" or value is None:
                continue
            payload[key] = value

        return Result.Ok(payload, quality=quality)

    @staticmethod
    async def write_asset_metadata_row(
        db: Sqlite,
        asset_id: int,
        metadata_result: Result[Dict[str, Any]],
        filepath: Optional[str] = None,
    ) -> Result[Any]:
        """
        Insert or update the asset_metadata row with the latest metadata flags.

        Args:
            db: Database adapter instance
            asset_id: Asset ID to update
            metadata_result: Result from metadata extraction

        Returns:
            Result from database operation
        """
        has_workflow, has_generation_data, metadata_quality, metadata_raw_json = MetadataHelpers.prepare_metadata_fields(metadata_result)
        db_has_workflow = MetadataHelpers._bool_to_db(has_workflow)
        db_has_generation = MetadataHelpers._bool_to_db(has_generation_data)

        # Guard against pathological/huge JSON payloads; keep DB stable.
        try:
            max_bytes = int(MAX_METADATA_JSON_BYTES or 0)
        except Exception:
            max_bytes = 0
        truncated = False
        original_bytes = 0
        if max_bytes and isinstance(metadata_raw_json, str):
            try:
                nbytes = len(metadata_raw_json.encode("utf-8", errors="ignore"))
            except Exception:
                nbytes = 0
            if nbytes > max_bytes:
                truncated = True
                original_bytes = int(nbytes)
                try:
                    metadata_raw_json = json.dumps(
                        {"_truncated": True, "original_bytes": int(nbytes)},
                        ensure_ascii=False,
                        separators=(",", ":"),
                    )
                except Exception:
                    metadata_raw_json = "{}"
        if truncated:
            try:
                metadata_result.meta["truncated"] = True
                metadata_result.meta["original_bytes"] = int(original_bytes)
                metadata_result.meta["max_bytes"] = int(max_bytes)
            except Exception:
                pass
            try:
                fp = filepath
                if not fp and metadata_result and isinstance(metadata_result.data, dict):
                    fp = metadata_result.data.get("filepath")
                suffix = f" filepath={fp}" if isinstance(fp, str) and fp else ""
                logger.warning(
                    "Metadata JSON truncated for asset_id=%s%s (bytes=%s > max=%s)",
                    asset_id,
                    suffix,
                    original_bytes,
                    max_bytes,
                )
            except Exception:
                pass

        extracted_rating = 0
        extracted_tags_json = "[]"
        extracted_tags_text = ""
        if metadata_result and metadata_result.ok and metadata_result.data:
            meta = metadata_result.data
            try:
                r = meta.get("rating")
                if r is not None:
                    extracted_rating = max(0, min(5, int(r)))
            except Exception:
                extracted_rating = 0
            try:
                t = meta.get("tags")
                if isinstance(t, list):
                    cleaned = []
                    seen = set()
                    for item in t:
                        if not isinstance(item, str):
                            continue
                        tag = item.strip()
                        if not tag or len(tag) > MAX_TAG_LENGTH or tag in seen:
                            continue
                        seen.add(tag)
                        cleaned.append(tag)
                    extracted_tags_json = json.dumps(cleaned, ensure_ascii=False)
                    extracted_tags_text = " ".join(cleaned)
            except Exception:
                extracted_tags_json = "[]"
                extracted_tags_text = ""

        # Enrich tags_text with GenInfo (Models, LoRAs, Prompts) for FTS
        if metadata_result and metadata_result.ok and metadata_result.data:
            meta = metadata_result.data
            extras = []
            geninfo = meta.get("geninfo")
            if isinstance(geninfo, dict):
                # Models
                models = geninfo.get("models", {})
                if isinstance(models, dict):
                    for m_key, m_val in models.items():
                        if isinstance(m_val, dict) and "name" in m_val:
                            n = str(m_val["name"]).strip()
                            if n: extras.append(n)

                # LoRAs
                loras = geninfo.get("loras", [])
                if isinstance(loras, list):
                    for lora in loras:
                        if isinstance(lora, dict) and "name" in lora:
                            n = str(lora["name"]).strip()
                            if n: extras.append(n)

                # Positive Prompt
                pos_obj = geninfo.get("positive")
                if isinstance(pos_obj, dict):
                    p_val = pos_obj.get("value")
                    if isinstance(p_val, str) and p_val.strip():
                        extras.append(p_val.strip())

                # Workflow Type (T2I, I2V, etc.)
                engine = geninfo.get("engine")
                if isinstance(engine, dict):
                    wf_type = engine.get("type")
                    if isinstance(wf_type, str) and wf_type.strip():
                        extras.append(wf_type.strip()) # e.g. "I2V", "T2I"

                # Input files (to find assets using a specific source)
                inputs = geninfo.get("inputs")
                if isinstance(inputs, list):
                    for inp in inputs:
                        if isinstance(inp, dict):
                            fname = inp.get("filename")
                            if isinstance(fname, str) and fname.strip():
                                extras.append(fname.strip())
                            
                            role = inp.get("role")
                            if isinstance(role, str) and role.strip() and role not in ("secondary",):
                                # Index roles too? Maybe overkill to add "first_frame" to index, 
                                # but "mask" or "source" could be useful. 
                                # Let's keep it simple for now and just index the filenames.
                                pass

            if extras:
                if extracted_tags_text:
                    extracted_tags_text += " " + " ".join(extras)
                else:
                    extracted_tags_text = " ".join(extras)

            # Concat all metadata fields for metadata_text
            meta_fields = [extracted_tags_text] + extras
            # Add prompts, parameters, model, workflow, etc. from metadata_raw
            if meta.get("prompt"):
                meta_fields.append(str(meta.get("prompt")))
            if meta.get("parameters"):
                meta_fields.append(str(meta.get("parameters")))
            if meta.get("model"):
                meta_fields.append(str(meta.get("model")))
            if meta.get("workflow_type"):
                meta_fields.append(str(meta.get("workflow_type")))
            if meta.get("metadata_raw"):
                meta_fields.append(str(meta.get("metadata_raw")))
            " ".join([str(f) for f in meta_fields if f])

        # Import existing OS/file metadata when DB has defaults, without overriding user edits.
        # - rating: only set if current rating is 0
        # - tags: only set if current tags are empty ('[]' or '')
        # Never downgrade metadata flags/raw on transient tool failures.
        # We keep the best known metadata_quality for a file unless a newer extraction
        # yields an equal-or-better quality. This prevents counters/progress from
        # "going backwards" during background enrichment retries.
        quality_rank_excluded = "CASE excluded.metadata_quality WHEN 'full' THEN 3 WHEN 'partial' THEN 2 WHEN 'degraded' THEN 1 ELSE 0 END"
        quality_rank_current = "CASE COALESCE(asset_metadata.metadata_quality, 'none') WHEN 'full' THEN 3 WHEN 'partial' THEN 2 WHEN 'degraded' THEN 1 ELSE 0 END"
        should_upgrade = f"({quality_rank_excluded} >= {quality_rank_current})"

        return await db.aexecute(
            """
            INSERT INTO asset_metadata
            (asset_id, rating, tags, tags_text, has_workflow, has_generation_data, metadata_quality, metadata_raw)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(asset_id) DO UPDATE SET
                rating = CASE
                    WHEN COALESCE(asset_metadata.rating, 0) = 0 THEN excluded.rating
                    ELSE asset_metadata.rating
                END,
                tags = CASE
                    WHEN COALESCE(asset_metadata.tags, '[]') IN ('[]', '') THEN excluded.tags
                    ELSE asset_metadata.tags
                END,
                tags_text = CASE
                    WHEN COALESCE(asset_metadata.tags, '[]') IN ('[]', '') THEN excluded.tags_text
                    ELSE asset_metadata.tags_text
                END,
                has_workflow = CASE
                    WHEN {should_upgrade} THEN excluded.has_workflow
                    ELSE asset_metadata.has_workflow
                END,
                has_generation_data = CASE
                    WHEN {should_upgrade} THEN excluded.has_generation_data
                    ELSE asset_metadata.has_generation_data
                END,
                metadata_quality = CASE
                    WHEN {should_upgrade} THEN excluded.metadata_quality
                    ELSE asset_metadata.metadata_quality
                END,
                metadata_raw = CASE
                    WHEN {should_upgrade} THEN excluded.metadata_raw
                    ELSE asset_metadata.metadata_raw
                END
            """.format(should_upgrade=should_upgrade),
            (
                asset_id,
                extracted_rating,
                extracted_tags_json,
                extracted_tags_text,
                db_has_workflow,
                db_has_generation,
                metadata_quality,
                metadata_raw_json,
            ),
        )

    @staticmethod
    async def refresh_metadata_if_needed(
        db: Sqlite,
        asset_id: int,
        metadata_result: Result[Dict[str, Any]],
        filepath: str,
        base_dir: str,
        state_hash: str,
        mtime: int,
        size: int,
        write_journal_fn,
    ) -> bool:
        """
        Re-run metadata extraction for unchanged files if the metadata flags changed.

        Args:
            db: Database adapter instance
            asset_id: Asset ID to check
            metadata_result: New metadata result
            filepath: File path
            base_dir: Base directory
            state_hash: State hash for journaling
            mtime: File modification time
            size: File size
            write_journal_fn: Function to write journal entry

        Returns:
            True if metadata was refreshed, False otherwise
        """
        async with db.lock_for_asset(asset_id):
            result = await db.aquery(
                "SELECT has_workflow, has_generation_data, metadata_raw FROM asset_metadata WHERE asset_id = ?",
                (asset_id,)
            )
            if not result.ok:
                return False

            current = result.data[0] if result.data else None
            new_has_workflow, new_has_generation_data, _, new_metadata_raw = MetadataHelpers.prepare_metadata_fields(metadata_result)
            new_has_workflow_db = MetadataHelpers._bool_to_db(new_has_workflow)
            new_has_generation_db = MetadataHelpers._bool_to_db(new_has_generation_data)

            current_has_workflow = current.get("has_workflow") if current else None
            current_has_generation = current.get("has_generation_data") if current else None
            current_raw = current["metadata_raw"] if current else ""

            if (current_has_workflow == new_has_workflow_db and
                    current_has_generation == new_has_generation_db and
                    current_raw == new_metadata_raw):
                return False

            write_result = await MetadataHelpers.write_asset_metadata_row(db, asset_id, metadata_result, filepath=filepath)
            if write_result.ok:
                # We assume write_journal_fn is async now
                await write_journal_fn(filepath, base_dir, state_hash, mtime, size)
            return write_result.ok

    @staticmethod
    async def retrieve_cached_metadata(db: Sqlite, filepath: str, state_hash: str) -> Optional[Result[Dict[str, Any]]]:
        """
        Retrieve metadata from cache if available.

        Args:
            db: Database adapter instance
            filepath: File path
            state_hash: State hash to validate cache

        Returns:
            Cached metadata result or None if not found
        """
        if not state_hash:
            return None

        result = await db.aquery(
            "SELECT metadata_raw FROM metadata_cache WHERE filepath = ? AND state_hash = ?",
            (filepath, state_hash)
        )

        if not result.ok or not result.data:
            return None

        raw = result.data[0].get("metadata_raw")
        if not raw:
            return None

        try:
            payload = json.loads(raw)
            return Result.Ok(payload, source="cache")
        except json.JSONDecodeError:
            return None

    @staticmethod
    async def _maybe_cleanup_metadata_cache(db: Sqlite) -> None:
        global _METADATA_CACHE_LAST_CLEANUP
        try:
            max_entries = int(METADATA_CACHE_MAX or 0)
        except Exception:
            max_entries = 0
        try:
            ttl_seconds = float(METADATA_CACHE_TTL_SECONDS or 0)
        except Exception:
            ttl_seconds = 0.0
        try:
            interval = float(METADATA_CACHE_CLEANUP_INTERVAL_SECONDS or 0)
        except Exception:
            interval = 0.0

        if max_entries <= 0 and ttl_seconds <= 0:
            return

        now = time.time()
        if interval > 0 and (now - _METADATA_CACHE_LAST_CLEANUP) < interval:
            return

        async with _METADATA_CACHE_CLEANUP_LOCK:
            now = time.time()
            if interval > 0 and (_METADATA_CACHE_LAST_CLEANUP and (now - _METADATA_CACHE_LAST_CLEANUP) < interval):
                return
            _METADATA_CACHE_LAST_CLEANUP = now

            if ttl_seconds > 0:
                try:
                    cutoff = datetime.now(timezone.utc) - timedelta(seconds=ttl_seconds)
                    cutoff_str = cutoff.strftime("%Y-%m-%d %H:%M:%S")
                    await db.aexecute(
                        "DELETE FROM metadata_cache WHERE last_updated < ?",
                        (cutoff_str,),
                    )
                except Exception:
                    pass

            if max_entries > 0:
                try:
                    count_res = await db.aquery("SELECT COUNT(1) AS count FROM metadata_cache")
                    if count_res.ok and count_res.data:
                        total = int(count_res.data[0].get("count") or 0)
                    else:
                        total = 0
                    if total > max_entries:
                        to_remove = max(0, total - max_entries)
                        if to_remove:
                            await db.aexecute(
                                """
                                DELETE FROM metadata_cache
                                WHERE filepath IN (
                                    SELECT filepath
                                    FROM metadata_cache
                                    ORDER BY last_updated ASC
                                    LIMIT ?
                                )
                                """,
                                (to_remove,),
                            )
                except Exception:
                    pass

    @staticmethod
    async def store_metadata_cache(db: Sqlite, filepath: str, state_hash: str, metadata_result: Result[Dict[str, Any]]) -> Result[Any]:
        """
        Store metadata in cache for future use.

        Args:
            db: Database adapter instance
            filepath: File path
            state_hash: State hash for validation
            metadata_result: Metadata result to cache

        Returns:
            Result from database operation
        """
        if not metadata_result.ok or not metadata_result.data:
            return Result.Err("CACHE_SKIPPED", "No metadata to cache")

        metadata_raw = json.dumps(
            metadata_result.data,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True
        )
        try:
            max_bytes = int(MAX_METADATA_JSON_BYTES or 0)
        except Exception:
            max_bytes = 0
        if max_bytes and isinstance(metadata_raw, str):
            try:
                nbytes = len(metadata_raw.encode("utf-8", errors="ignore"))
            except Exception:
                nbytes = 0
            if nbytes > max_bytes:
                try:
                    logger.warning(
                        "Metadata cache skipped (payload too large) for %s (bytes=%s > max=%s)",
                        filepath,
                        int(nbytes),
                        int(max_bytes),
                    )
                except Exception:
                    pass
                return Result.Err(
                    "CACHE_SKIPPED",
                    "Metadata JSON too large to cache",
                    original_bytes=int(nbytes),
                    max_bytes=int(max_bytes),
                )
        metadata_hash = MetadataHelpers.compute_metadata_hash(metadata_raw)

        write_res = await db.aexecute(
            """
            INSERT INTO metadata_cache
            (filepath, state_hash, metadata_hash, metadata_raw)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(filepath) DO UPDATE SET
                state_hash = excluded.state_hash,
                metadata_hash = excluded.metadata_hash,
                metadata_raw = excluded.metadata_raw,
                last_updated = CURRENT_TIMESTAMP
            """,
            (filepath, state_hash, metadata_hash, metadata_raw)
        )
        try:
            await MetadataHelpers._maybe_cleanup_metadata_cache(db)
        except Exception:
            pass
        return write_res

    @staticmethod
    def compute_metadata_hash(raw_json: str) -> str:
        """
        Compute hash of metadata JSON.

        Args:
            raw_json: JSON string to hash

        Returns:
            MD5 hash of the JSON
        """
        return hashlib.md5(raw_json.encode("utf-8")).hexdigest()

    @staticmethod
    async def set_metadata_value(db: Sqlite, key: str, value: str) -> Result[Any]:
        """
        Persist a simple key/value in the metadata table.

        Args:
            db: Database adapter instance
            key: Metadata key
            value: Metadata value

        Returns:
            Result from database operation
        """
        return await db.aexecute(
            "INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)",
            (key, value)
        )
