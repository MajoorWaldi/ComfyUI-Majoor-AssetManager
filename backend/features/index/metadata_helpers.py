"""
Metadata helpers - shared utilities for metadata operations.
"""
import hashlib
import asyncio
import json
from typing import Dict, Any, Tuple, Optional

from ...config import MAX_METADATA_JSON_BYTES
from ...shared import Result
from ...adapters.db.sqlite import Sqlite
from ..metadata.parsing_utils import (
    looks_like_comfyui_workflow,
    looks_like_comfyui_prompt_graph,
    try_parse_json_text,
)

MAX_TAG_LENGTH = 100


class MetadataHelpers:
    """
    Shared utilities for metadata operations.

    Provides static methods for metadata caching, field preparation,
    and error handling that are used across multiple components.
    """

    @staticmethod
    def prepare_metadata_fields(metadata_result: Result[Dict[str, Any]]) -> Tuple[bool, bool, str, str]:
        """
        Extract the workflow/generation metadata attributes and JSON payload.

        Args:
            metadata_result: Result from metadata extraction

        Returns:
            Tuple of (has_workflow, has_generation_data, metadata_quality, metadata_raw_json)
        """
        has_workflow = False
        has_generation_data = False
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

        if metadata_result and metadata_result.ok and metadata_result.data:
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
    async def write_asset_metadata_row(db: Sqlite, asset_id: int, metadata_result: Result[Dict[str, Any]]) -> Result[Any]:
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

        # Guard against pathological/huge JSON payloads; keep DB stable.
        try:
            max_bytes = int(MAX_METADATA_JSON_BYTES or 0)
        except Exception:
            max_bytes = 0
        if max_bytes and isinstance(metadata_raw_json, str):
            try:
                nbytes = len(metadata_raw_json.encode("utf-8", errors="ignore"))
            except Exception:
                nbytes = 0
            if nbytes > max_bytes:
                try:
                    metadata_raw_json = json.dumps(
                        {"_truncated": True, "original_bytes": int(nbytes)},
                        ensure_ascii=False,
                        separators=(",", ":"),
                    )
                except Exception:
                    metadata_raw_json = "{}"

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
            geninfo = meta.get("geninfo")
            if isinstance(geninfo, dict):
                extras = []
                
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
                1 if has_workflow else 0,
                1 if has_generation_data else 0,
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

            current_has_workflow = current["has_workflow"] if current else 0
            current_has_generation = current["has_generation_data"] if current else 0
            current_raw = current["metadata_raw"] if current else ""

            if (current_has_workflow == (1 if new_has_workflow else 0) and
                    current_has_generation == (1 if new_has_generation_data else 0) and
                    current_raw == new_metadata_raw):
                return False

            write_result = await MetadataHelpers.write_asset_metadata_row(db, asset_id, metadata_result)
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
                return Result.Err("CACHE_SKIPPED", "Metadata JSON too large to cache")
        metadata_hash = MetadataHelpers.compute_metadata_hash(metadata_raw)

        return await db.aexecute(
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
