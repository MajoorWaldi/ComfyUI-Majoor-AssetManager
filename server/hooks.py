import os
from typing import Any, Dict, List, Optional

import folder_paths

from server import PromptServer
from .logger import get_logger
from .utils import (
    classify_ext,
    get_system_metadata,
    load_metadata,
    save_metadata,
    set_windows_metadata,
    set_exif_metadata,
    _get_exiftool_path,
)

log = get_logger(__name__)


def _iter_generated_files(output_data: Dict[str, Any]) -> List[str]:
    """
    Extract absolute paths for generated files from the ComfyUI execution payload.
    """
    files: List[str] = []
    ui = output_data.get("ui") if isinstance(output_data, dict) else None
    if not isinstance(ui, dict):
        return files

    for category, items in ui.items():
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            filename = item.get("filename")
            subfolder = item.get("subfolder", "")
            type_ = item.get("type", "output")
            if not filename:
                continue
            try:
                dir_path = folder_paths.get_directory_by_type(type_)  # type: ignore
            except Exception:
                continue
            if subfolder:
                dir_path = os.path.join(dir_path, subfolder)
            files.append(os.path.join(dir_path, filename))
    return files


def _is_missing_meta(meta: Dict[str, Any]) -> bool:
    """
    Determine if metadata is missing (None) or effectively absent.
    Treat explicit rating=0/tags=[] as present unless both are empty and no source hints.
    """
    if not isinstance(meta, dict):
        return True
    rating = meta.get("rating")
    tags = meta.get("tags")
    if rating is None or tags is None:
        return True
    if rating == 0 and (tags == [] or tags is None):
        # consider missing only if nothing else in meta hints at a source
        return True
    return False


def _apply_default_metadata(file_path: str):
    """
    Apply default rating/tags to a generated file (video/image) if missing.
    Idempotent: never overwrites user-set rating/tags.
    """
    try:
        if not str(os.environ.get("MJR_PRIME_METADATA", "0")).lower() in ("1", "true", "yes", "on"):
            return
    except Exception:
        return

    filename_lower = os.path.basename(file_path).lower()
    kind = classify_ext(filename_lower)
    if kind not in ("video", "image"):
        return

    if not os.path.exists(file_path):
        return

    try:
        existing = get_system_metadata(file_path) or load_metadata(file_path) or {}
        if not _is_missing_meta(existing):
            return

        current_rating = existing.get("rating")
        current_tags = existing.get("tags")
        default_rating = 0 if current_rating is None else current_rating
        default_tags = ["ComfyUI"] if current_tags is None else current_tags

        try:
            set_windows_metadata(file_path, default_rating, default_tags)
        except Exception:
            pass

        if _get_exiftool_path():
            try:
                set_exif_metadata(file_path, default_rating, default_tags)
            except Exception:
                pass
    except Exception:
        pass


def _get_prompt_entry(prompt_id: str) -> Optional[Dict[str, Any]]:
    """
    Retrieve prompt entry from ComfyUI history/queue.

    CRITICAL FIX: History is only populated AFTER task_done, but on_executed runs DURING execution.
    Solution: Try history first, then fall back to current running queue.

    Returns dict with 'prompt' and potentially 'workflow' if available.
    Returns None if not found or on error.
    """
    try:
        if not hasattr(PromptServer, 'instance'):
            return None

        prompt_server = PromptServer.instance
        if not hasattr(prompt_server, 'prompt_queue'):
            return None

        prompt_queue = prompt_server.prompt_queue

        # STEP 1: Try history (this works for completed prompts)
        try:
            history = prompt_queue.get_history(prompt_id=prompt_id)
            if history and prompt_id in history:
                entry = history[prompt_id]
                if isinstance(entry, dict):
                    result = {}

                    # Extract prompt graph
                    if "prompt" in entry and isinstance(entry["prompt"], dict):
                        result["prompt"] = entry["prompt"]

                    # Extract workflow from extra_pnginfo or direct workflow field
                    try:
                        extra_pnginfo = entry.get("extra_data", {}).get("extra_pnginfo", {})
                        if isinstance(extra_pnginfo, dict) and "workflow" in extra_pnginfo:
                            result["workflow"] = extra_pnginfo["workflow"]
                        elif "workflow" in entry:
                            result["workflow"] = entry["workflow"]
                    except:
                        pass

                    if result:
                        result["source"] = "history"
                        return result
        except:
            pass

        # STEP 2: Try current queue (THIS IS THE FIX - works during execution)
        # During on_executed(), the prompt is still in the running queue, not yet in history
        try:
            running, pending = prompt_queue.get_current_queue()

            # Search in running queue first (most likely location during on_executed)
            for queue_item in running:
                # Queue item format: (number, prompt_id, prompt_dict, extra_data, outputs_to_execute)
                # We need index 1 (prompt_id), 2 (prompt_dict), 3 (extra_data)
                if len(queue_item) >= 4 and queue_item[1] == prompt_id:
                    result = {}

                    # Extract prompt graph (index 2)
                    if len(queue_item) > 2 and isinstance(queue_item[2], dict):
                        result["prompt"] = queue_item[2]

                    # Extract workflow from extra_data (index 3)
                    if len(queue_item) > 3 and isinstance(queue_item[3], dict):
                        extra_data = queue_item[3]
                        extra_pnginfo = extra_data.get("extra_pnginfo", {})
                        if isinstance(extra_pnginfo, dict) and "workflow" in extra_pnginfo:
                            result["workflow"] = extra_pnginfo["workflow"]
                        elif "workflow" in extra_data:
                            result["workflow"] = extra_data["workflow"]

                    if result:
                        result["source"] = "queue_running"
                        return result

            # Also check pending queue (less likely but possible)
            for queue_item in pending:
                if len(queue_item) >= 4 and queue_item[1] == prompt_id:
                    result = {}

                    if len(queue_item) > 2 and isinstance(queue_item[2], dict):
                        result["prompt"] = queue_item[2]

                    if len(queue_item) > 3 and isinstance(queue_item[3], dict):
                        extra_data = queue_item[3]
                        extra_pnginfo = extra_data.get("extra_pnginfo", {})
                        if isinstance(extra_pnginfo, dict) and "workflow" in extra_pnginfo:
                            result["workflow"] = extra_pnginfo["workflow"]
                        elif "workflow" in extra_data:
                            result["workflow"] = extra_data["workflow"]

                    if result:
                        result["source"] = "queue_pending"
                        return result

        except Exception as e:
            log.debug(f"📁🔍 [Majoor] Queue lookup failed: {e}")

        return None

    except Exception as e:
        log.debug(f"📁🔍 [Majoor] Failed to get prompt entry for {prompt_id}: {e}")
        return None


def _attach_generation_sidecar(prompt_id: str, file_path: str):
    """
    Attach generation metadata to file via sidecar.
    For MP4/WEBP/etc that don't embed metadata, this creates a .mjr.json sidecar
    with prompt_id, prompt graph, and workflow if available.

    This enables metadata recovery even after ComfyUI restart.
    """
    try:
        from pathlib import Path

        # Check if we should create sidecars
        # MJR_FORCE_SIDECAR=1 forces sidecar creation even on Windows
        force_sidecar = os.environ.get("MJR_FORCE_SIDECAR", "").lower() in ("1", "true", "yes", "on")
        debug_meta = os.environ.get("MJR_DEBUG_METADATA", "").lower() in ("1", "true", "yes", "on")

        ext = Path(file_path).suffix.lower()

        # Priority for sidecar creation:
        # 1. Always for MP4/video files (they rarely embed metadata)
        # 2. Always for WEBP (often lacks embedded workflow, needs persistent metadata)
        # 3. For JPG/JPEG if MJR_FORCE_SIDECAR=1
        # 4. Skip PNG (has embedded metadata)
        create_sidecar = False
        if ext in {".mp4", ".mov", ".webm", ".mkv", ".m4v", ".avi"}:
            create_sidecar = True  # Always for video
        elif ext == ".webp":
            create_sidecar = True  # ALWAYS for WEBP (CRITICAL FIX)
        elif ext in {".jpg", ".jpeg"} and force_sidecar:
            create_sidecar = True  # Optional for JPG

        if not create_sidecar:
            return

        # Load existing sidecar
        existing_meta = load_metadata(file_path) or {}

        # Don't overwrite if sidecar already has valid prompt/workflow
        if existing_meta.get("prompt") and existing_meta.get("workflow"):
            if debug_meta:
                log.debug(f"📁🔍 [Majoor] Sidecar already complete for {Path(file_path).name}, skipping")
            return

        # Get prompt entry from queue/history
        entry = _get_prompt_entry(prompt_id)
        if not entry:
            if debug_meta:
                log.debug(f"📁⚠️ [Majoor] No queue/history entry found for {prompt_id}, creating minimal sidecar")
            # Still create sidecar with prompt_id for future history lookup
            meta = existing_meta.copy()
            meta["prompt_id"] = prompt_id
            meta["meta_version"] = 1
            meta["source"] = "unknown"
            save_metadata(file_path, meta, force=True)
            return

        # Merge with existing metadata
        meta = existing_meta.copy()
        meta["prompt_id"] = prompt_id
        meta["meta_version"] = 1
        meta["source"] = entry.get("source", "unknown")  # "queue_running", "history", "queue_pending"

        if "prompt" in entry:
            meta["prompt"] = entry["prompt"]
        if "workflow" in entry:
            meta["workflow"] = entry["workflow"]

        # Save sidecar (force=True to ensure it's written even on Windows)
        save_metadata(file_path, meta, force=True)

        if debug_meta:
            log.debug(f"📁✅ [Majoor] Created sidecar for {Path(file_path).name}")
            log.debug(f"📁🔍 [Majoor]   - Source: {meta.get('source')}")
            log.debug(f"📁🔍 [Majoor]   - Has prompt: {('prompt' in meta)}")
            log.debug(f"📁🔍 [Majoor]   - Has workflow: {('workflow' in meta)}")

    except Exception as e:
        log.debug(f"📁❌ [Majoor] Failed to attach sidecar for {file_path}: {e}")


def on_executed(prompt_id, node_id, output_data):
    """
    Hook invoked by PromptServer after a node execution; primes metadata on generated files.
    Creates sidecars for MP4/WEBP with prompt/workflow data to enable metadata recovery.
    """
    if not output_data:
        return
    try:
        files = _iter_generated_files(output_data)
        pushed: List[Dict[str, Any]] = []
        for fp in files:
            _apply_default_metadata(fp)

            # Attach generation sidecar for MP4/WEBP (replaces _store_prompt_id)
            # This stores the full prompt graph + workflow, not just prompt_id
            if prompt_id:
                _attach_generation_sidecar(prompt_id, fp)

            try:
                stat = os.stat(fp)
                pushed.append(
                    {
                        "filename": os.path.basename(fp),
                        "subfolder": os.path.dirname(fp).replace(folder_paths.get_output_directory(), "").lstrip("\\/"),
                        "mtime": stat.st_mtime,
                    }
                )
            except Exception:
                continue

        if pushed:
            try:
                PromptServer.instance.send_sync("mjr_new_files", {"files": pushed})
            except Exception:
                pass
    except Exception as e:
        log.exception("📁❌ [Majoor] hook error: %s", e)


# Register hook once (only if supported)
try:
    if hasattr(PromptServer.instance, "add_on_executed"):
        PromptServer.instance.add_on_executed(on_executed)
    else:
        log.warning(
            "[Majoor] add_on_executed not available on PromptServer (legacy frontend); hook disabled."
        )
except Exception as e:
    log.exception("[Majoor] failed to register on_executed hook: %s", e)
