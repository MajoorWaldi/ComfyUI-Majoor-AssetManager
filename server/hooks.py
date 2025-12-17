import os
from typing import Any, Dict, List

import folder_paths

from server import PromptServer
from .logger import get_logger
from .utils import (
    classify_ext,
    get_system_metadata,
    load_metadata,
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


def on_executed(prompt_id, node_id, output_data):
    """
    Hook invoked by PromptServer after a node execution; primes metadata on generated files.
    """
    if not output_data:
        return
    try:
        files = _iter_generated_files(output_data)
        pushed: List[Dict[str, Any]] = []
        for fp in files:
            _apply_default_metadata(fp)
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
        log.exception("[Majoor] hook error: %s", e)


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
