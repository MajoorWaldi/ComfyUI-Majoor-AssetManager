"""
Enhanced Metadata Extraction Integration

Integrates new metadata parsers (EXIF UserComment, ComfyUI tracer v2, PNG inject, workflow fingerprint)
with the existing metadata pipeline.

This module provides a unified API that:
- Uses new parsers when available/enabled
- Falls back to legacy parsers on error
- Respects configuration flags
- Never crashes on corrupted files

Usage:
    from server.metadata.enhanced_extraction import extract_enhanced_metadata, write_enhanced_metadata

    # Extract metadata (hybrid mode: try new, fallback to legacy)
    metadata = extract_enhanced_metadata("/path/to/image.png")

    # Write metadata (lossless PNG injection if supported)
    write_enhanced_metadata("/path/to/image.png", {"rating": 5, "tags": ["test"]})
"""

import logging
from typing import Dict, Any, Optional
from pathlib import Path

# Import config flags
from ..config import (
    METADATA_MODE,
    METADATA_EXIF_NATIVE,
    METADATA_COMFY_TRACE_V2,
    METADATA_PNG_INJECT,
    METADATA_WORKFLOW_HASH,
    METADATA_DEBUG,
    METADATA_SAFE_FALLBACK
)

# Import new parsers
from .exif_usercomment import decode_user_comment
from .comfy_tracer import extract_comfy_params
from .png_inject import read_metadata as png_read_metadata, inject_metadata as png_inject_metadata
from .workflow_fingerprint import create_workflow_fingerprint

# Import existing metadata utilities
from .core import get_metadata as legacy_get_metadata, update_metadata as legacy_update_metadata

log = logging.getLogger(__name__)


def extract_enhanced_metadata(file_path: str) -> Dict[str, Any]:
    """
    Extract metadata using enhanced parsers (with fallback to legacy).

    This is the main entry point for metadata extraction.

    Args:
        file_path: Path to asset file

    Returns:
        Metadata dictionary with all extracted fields

    Mode behavior:
        - legacy: Use only existing Windows props / ExifTool / sidecar
        - hybrid: Try new parsers first, fallback to legacy on error (default)
        - native: Use only new parsers (no fallback)
    """
    if METADATA_DEBUG:
        log.debug(f"[Majoor] Extracting enhanced metadata from {file_path} (mode: {METADATA_MODE})")

    # Start with empty metadata
    metadata = {}

    # Legacy mode: skip new parsers entirely
    if METADATA_MODE == "legacy":
        if METADATA_DEBUG:
            log.debug("[Majoor] Using legacy mode - skipping new parsers")
        return legacy_get_metadata(file_path)

    # Try new parsers
    try:
        # 1. Extract from PNG iTXt chunks (if PNG file)
        if file_path.lower().endswith('.png') and METADATA_PNG_INJECT:
            try:
                png_metadata = png_read_metadata(file_path)
                if png_metadata:
                    if METADATA_DEBUG:
                        log.debug(f"[Majoor] Found {len(png_metadata)} PNG iTXt metadata keys")

                    # Convert mjr:* keys to standard keys
                    for key, value in png_metadata.items():
                        if key.startswith("mjr:"):
                            clean_key = key[4:]  # Remove "mjr:" prefix
                            metadata[clean_key] = value

            except Exception as e:
                if METADATA_DEBUG:
                    log.debug(f"[Majoor] PNG metadata extraction failed: {e}")
                if not METADATA_SAFE_FALLBACK:
                    raise

        # 2. Extract EXIF UserComment (if enabled)
        if METADATA_EXIF_NATIVE and file_path.lower().endswith(('.jpg', '.jpeg', '.png', '.tiff', '.tif')):
            try:
                try:
                    from PIL import Image
                    from PIL.ExifTags import TAGS
                except ImportError:
                    if METADATA_DEBUG:
                        log.debug("[Majoor] PIL/Pillow not available, skipping EXIF extraction")
                else:
                    # Read EXIF data
                    with Image.open(file_path) as img:
                        exif_data = img.getexif()
                        if exif_data:
                            # Look for UserComment tag (0x9286)
                            for tag_id, value in exif_data.items():
                                tag_name = TAGS.get(tag_id, tag_id)

                                if tag_name == "UserComment" or tag_id == 0x9286:
                                    if isinstance(value, bytes):
                                        decoded = decode_user_comment(value)
                                        if decoded:
                                            metadata['user_comment'] = decoded
                                            if METADATA_DEBUG:
                                                log.debug(f"[Majoor] Decoded EXIF UserComment: {decoded[:50]}...")
                                    elif isinstance(value, str):
                                        metadata['user_comment'] = value
                                        if METADATA_DEBUG:
                                            log.debug(f"[Majoor] Found EXIF UserComment (already string): {value[:50]}...")

            except Exception as e:
                if METADATA_DEBUG:
                    log.debug(f"[Majoor] EXIF extraction failed: {e}")
                if not METADATA_SAFE_FALLBACK:
                    raise

        # 3. Extract workflow metadata (if workflow_json present)
        if METADATA_COMFY_TRACE_V2 or METADATA_WORKFLOW_HASH:
            # First, get existing metadata to check for workflow
            existing = legacy_get_metadata(file_path)
            workflow_json = existing.get("workflow")

            if workflow_json:
                try:
                    if METADATA_WORKFLOW_HASH:
                        # Create fingerprint
                        fp = create_workflow_fingerprint(workflow_json)

                        if METADATA_DEBUG:
                            log.debug(f"[Majoor] Workflow hash: {fp['hash'][:12]}...")

                        metadata["workflow_hash"] = fp["hash"]

                    if METADATA_COMFY_TRACE_V2:
                        # Extract workflow params
                        params = extract_comfy_params(workflow_json)

                        if METADATA_DEBUG:
                            log.debug(f"[Majoor] Extracted {len(params['positive_prompts'])} prompts from workflow")

                        # Merge extracted params
                        if params["positive_prompts"]:
                            metadata["prompt"] = " | ".join(params["positive_prompts"])

                        if params["negative_prompts"]:
                            metadata["negative"] = " | ".join(params["negative_prompts"])

                        if params["model"]:
                            metadata["model"] = params["model"]

                        if params["steps"]:
                            metadata["steps"] = params["steps"]

                        if params["cfg"]:
                            metadata["cfg"] = params["cfg"]

                        if params["sampler_name"]:
                            metadata["sampler"] = params["sampler_name"]

                        if params["seed"]:
                            metadata["seed"] = params["seed"]

                except Exception as e:
                    if METADATA_DEBUG:
                        log.debug(f"[Majoor] Workflow extraction failed: {e}")
                    if not METADATA_SAFE_FALLBACK:
                        raise

        # 4. Merge with legacy metadata (hybrid mode)
        if METADATA_MODE == "hybrid" or not metadata:
            if METADATA_DEBUG:
                log.debug("[Majoor] Merging with legacy metadata")

            legacy_metadata = legacy_get_metadata(file_path)

            # Merge: new parsers take precedence
            for key, value in legacy_metadata.items():
                if key not in metadata:
                    metadata[key] = value

        return metadata

    except Exception as e:
        # Fallback to legacy on error (if safe fallback enabled)
        if METADATA_SAFE_FALLBACK:
            log.warning(f"[Majoor] Enhanced metadata extraction failed for {file_path}, falling back to legacy: {e}")
            return legacy_get_metadata(file_path)
        else:
            log.error(f"[Majoor] Enhanced metadata extraction failed for {file_path}: {e}")
            raise


def write_enhanced_metadata(file_path: str, updates: Dict[str, Any]) -> Dict[str, Any]:
    """
    Write metadata using enhanced writers (with fallback to legacy).

    Args:
        file_path: Path to asset file
        updates: Metadata updates to apply

    Returns:
        Full metadata after update

    Mode behavior:
        - legacy: Use only sidecar / Windows props
        - hybrid: Try PNG inject first, fallback to sidecar on error
        - native: Use only PNG inject (no fallback)
    """
    if METADATA_DEBUG:
        log.debug(f"[Majoor] Writing enhanced metadata to {file_path} (mode: {METADATA_MODE})")

    # Validate inputs
    if not updates:
        log.debug("[Majoor] Empty metadata update, skipping")
        return extract_enhanced_metadata(file_path)

    if not isinstance(updates, dict):
        raise ValueError(f"Updates must be a dict, got {type(updates)}")

    # Validate for namespace collisions and reserved keys
    RESERVED_KEYS = {'workflow', 'prompt', 'metadata', '__metadata__'}
    filtered_updates = {}

    for key, value in updates.items():
        # Skip reserved keys
        if key in RESERVED_KEYS:
            log.warning(f"[Majoor] Ignoring reserved key in metadata update: '{key}'")
            continue

        # Skip None values
        if value is None:
            log.debug(f"[Majoor] Skipping None value for key: '{key}'")
            continue

        # Validate key is a valid identifier (no special chars that could cause issues)
        if not isinstance(key, str) or not key:
            log.warning(f"[Majoor] Ignoring invalid key: {key!r}")
            continue

        filtered_updates[key] = value

    if not filtered_updates:
        log.debug("[Majoor] All metadata keys were filtered out, skipping update")
        return extract_enhanced_metadata(file_path)

    # Use filtered updates
    updates = filtered_updates

    # Legacy mode: skip new writers entirely
    if METADATA_MODE == "legacy":
        if METADATA_DEBUG:
            log.debug("[Majoor] Using legacy mode - skipping PNG inject")
        return legacy_update_metadata(file_path, updates)

    # Try PNG inject for PNG files
    if file_path.lower().endswith('.png') and METADATA_PNG_INJECT:
        try:
            # Convert updates to mjr:* namespaced keys
            png_updates = {}
            for key, value in updates.items():
                # Convert value to string for PNG iTXt
                if isinstance(value, (list, dict)):
                    import json
                    value_str = json.dumps(value)
                else:
                    value_str = str(value)

                png_updates[f"mjr:{key}"] = value_str

            # Inject into PNG
            success = png_inject_metadata(file_path, png_updates, backup=True)

            if success:
                if METADATA_DEBUG:
                    log.debug(f"[Majoor] Wrote {len(png_updates)} keys to PNG iTXt chunks")

                # In hybrid mode, also update sidecar for compatibility
                if METADATA_MODE == "hybrid":
                    legacy_update_metadata(file_path, updates)

                # Return full metadata
                return extract_enhanced_metadata(file_path)

        except Exception as e:
            if METADATA_DEBUG:
                log.debug(f"[Majoor] PNG metadata write failed: {e}")

            if not METADATA_SAFE_FALLBACK:
                raise

    # Fallback to legacy (or if not a PNG)
    if METADATA_MODE == "hybrid" or not file_path.lower().endswith('.png'):
        if METADATA_DEBUG:
            log.debug("[Majoor] Falling back to legacy metadata write")
        return legacy_update_metadata(file_path, updates)

    # Native mode for non-PNG files: error
    if METADATA_MODE == "native":
        raise NotImplementedError(f"Native mode PNG inject not supported for {Path(file_path).suffix} files")

    return {}


def extract_workflow_hash(workflow_json: Dict[str, Any]) -> str:
    """
    Extract workflow hash (convenience wrapper).

    Args:
        workflow_json: ComfyUI workflow dict

    Returns:
        40-character SHA1 hash or empty string
    """
    if not METADATA_WORKFLOW_HASH:
        return ""

    try:
        fp = create_workflow_fingerprint(workflow_json)
        return fp["hash"]
    except Exception as e:
        if METADATA_DEBUG:
            log.debug(f"[Majoor] Workflow hash extraction failed: {e}")
        return ""


def get_metadata_source_info(file_path: str) -> Dict[str, Any]:
    """
    Get information about which metadata sources are available for a file.

    Useful for debugging and UI display.

    Args:
        file_path: Path to asset file

    Returns:
        {
            "has_png_metadata": bool,
            "has_sidecar": bool,
            "has_windows_props": bool,
            "has_workflow": bool,
            "png_keys": [str, ...],
            "mode": str
        }
    """
    info = {
        "has_png_metadata": False,
        "has_sidecar": False,
        "has_windows_props": False,
        "has_workflow": False,
        "png_keys": [],
        "mode": METADATA_MODE
    }

    try:
        # Check PNG metadata
        if file_path.lower().endswith('.png'):
            png_metadata = png_read_metadata(file_path)
            if png_metadata:
                info["has_png_metadata"] = True
                info["png_keys"] = list(png_metadata.keys())

        # Check legacy metadata
        legacy_metadata = legacy_get_metadata(file_path)
        if legacy_metadata:
            if "workflow" in legacy_metadata:
                info["has_workflow"] = True

            # Check if sidecar file exists
            from ..utils import metadata_path
            import os
            sidecar_path = metadata_path(file_path)
            if os.path.exists(sidecar_path):
                info["has_sidecar"] = True

            # On Windows, check if Windows props are available
            from ..config import IS_WINDOWS
            if IS_WINDOWS:
                # If we have metadata but no sidecar, assume Windows props
                if not info["has_sidecar"] and legacy_metadata:
                    info["has_windows_props"] = True

    except Exception as e:
        if METADATA_DEBUG:
            log.debug(f"[Majoor] Error getting metadata source info: {e}")

    return info


__all__ = [
    "extract_enhanced_metadata",
    "write_enhanced_metadata",
    "extract_workflow_hash",
    "get_metadata_source_info"
]
