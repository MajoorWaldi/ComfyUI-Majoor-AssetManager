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
from typing import Dict, Any, Optional, Tuple
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
from .workflow_normalize import _normalize_workflow_to_prompt_graph
from .workflow_reconstruct import prompt_graph_to_workflow

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
            if sidecar_path and os.path.exists(sidecar_path):
                info["has_sidecar"] = True

        # Check for Windows properties
        if os.name == "nt":
            windows_meta = get_windows_metadata(file_path)
            if windows_meta.get("rating") or windows_meta.get("tags"):
                info["has_windows_props"] = True

    except Exception as e:
        if METADATA_DEBUG:
            log.debug(f"[Majoor] Error getting metadata source info: {e}")

    return info


def _extract_json_from_text(text: str) -> Optional[Dict[str, Any]]:
    """
    Extract JSON from text by looking for JSON-like patterns and structures.
    This function looks for JSON in any text field, not just standard metadata fields.
    """
    if not text or not isinstance(text, str):
        return None

    from .video_extraction import _balanced_json_from_text  # Import here to avoid circular import

    # First, try to find JSON directly
    if text.strip().startswith('{'):
        try:
            return json.loads(text.strip())
        except json.JSONDecodeError:
            pass

    # Extract potential JSON structures
    start = text.find('{')
    while start != -1:
        json_candidate = _balanced_json_from_text(text, start)
        if json_candidate:
            try:
                parsed = json.loads(json_candidate)
                if isinstance(parsed, (dict, list)):
                    return parsed if isinstance(parsed, dict) else {"nodes": parsed}
            except json.JSONDecodeError:
                pass
        start = text.find('{', start + 1)

    # Try to find JSON-like patterns with common ComfyUI keys
    keywords = ['"prompt"', '"workflow"', '"nodes"', '"extra_pnginfo"', '"class_type"', '"inputs"']
    for keyword in keywords:
        if keyword in text.lower():
            start = text.find('{')
            if start != -1:
                json_candidate = _balanced_json_from_text(text, start)
                if json_candidate:
                    try:
                        parsed = json.loads(json_candidate)
                        if isinstance(parsed, (dict, list)):
                            return parsed if isinstance(parsed, dict) else {"nodes": parsed}
                    except json.JSONDecodeError:
                        pass

    return None


def _is_comfyui_prompt_graph(obj: Any) -> bool:
    """
    Check if an object looks like a ComfyUI prompt graph.

    A prompt graph is a dict where:
    - Keys are node IDs (usually numeric strings like "1", "2", "42")
    - Values are dicts with "inputs" and "class_type" fields

    This works for ANY ComfyUI node type, built-in or custom.
    """
    if not isinstance(obj, dict) or len(obj) == 0:
        return False

    # Check if at least one value looks like a ComfyUI node
    node_count = 0
    for key, value in obj.items():
        if isinstance(value, dict):
            # Must have "class_type" field (identifies the node type)
            if "class_type" in value:
                node_count += 1
                # Most nodes have "inputs", but some might not (e.g., constant nodes)
                # So we don't require "inputs", just "class_type"

    # If at least 30% of entries look like nodes, it's likely a prompt graph
    # This handles edge cases where metadata might have mixed content
    if node_count > 0 and node_count >= len(obj) * 0.3:
        return True

    return False


def _is_comfyui_workflow(obj: Any) -> bool:
    """
    Check if an object looks like a ComfyUI workflow.

    A workflow is a dict with:
    - "nodes" array (visual node positions, connections, etc.)
    - Usually also has "links", "groups", "config", "extra", "version"
    """
    if not isinstance(obj, dict):
        return False

    # Primary indicator: "nodes" field that's a list
    if "nodes" in obj and isinstance(obj["nodes"], list):
        # Validate that nodes have workflow-specific fields
        nodes = obj["nodes"]
        if len(nodes) > 0:
            # Check first node for workflow-specific fields like "id", "type", "pos"
            first_node = nodes[0]
            if isinstance(first_node, dict):
                # Workflow nodes have "type" (node class), not "class_type"
                if "type" in first_node or "id" in first_node:
                    return True
        # Empty nodes array is still valid
        return True

    return False


def _scan_all_metadata_fields(metadata_dict: Dict[str, Any]) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    """
    Recursively scan all metadata fields to find JSON, workflow, or prompt information.
    This enhanced function looks through all metadata fields, not just standard ones.

    Enhanced to work with:
    - ANY ComfyUI node type (built-in or custom)
    - Multiple metadata storage patterns
    - Nested and prefixed metadata formats
    """
    from .workflow_normalize import _ensure_dict_from_json  # Import here to avoid circular import

    prompt_found = None
    workflow_found = None

    def scan_recursive(obj: Any, path: str = ""):
        nonlocal prompt_found, workflow_found

        if isinstance(obj, dict):
            # Check for direct prompt/workflow fields
            if "prompt" in obj and isinstance(obj["prompt"], (str, dict)):
                prompt_data = _ensure_dict_from_json(obj["prompt"])
                if _is_comfyui_prompt_graph(prompt_data):
                    prompt_found = prompt_data

            if "workflow" in obj and isinstance(obj["workflow"], (str, dict)):
                workflow_data = _ensure_dict_from_json(obj["workflow"])
                if _is_comfyui_workflow(workflow_data):
                    workflow_found = workflow_data

            # Check if this dict itself looks like a prompt graph or workflow
            if prompt_found is None and _is_comfyui_prompt_graph(obj):
                prompt_found = obj

            if workflow_found is None and _is_comfyui_workflow(obj):
                workflow_found = obj

            # Scan all values recursively
            for key, value in obj.items():
                current_path = f"{path}.{key}" if path else key
                scan_recursive(value, current_path)

        elif isinstance(obj, list):
            for i, item in enumerate(obj):
                current_path = f"{path}[{i}]" if path else f"[{i}]"
                scan_recursive(item, current_path)

        elif isinstance(obj, str):
            # Try to extract JSON from string values in any field
            # CRITICAL FIX: Check for { anywhere in string, not just at start
            # ComfyUI stores data as "prompt:{JSON}" and "workflow:{JSON}"
            if '{' in obj:
                json_data = _extract_json_from_text(obj)
                if json_data:
                    if prompt_found is None and _is_comfyui_prompt_graph(json_data):
                        prompt_found = json_data
                    if workflow_found is None and _is_comfyui_workflow(json_data):
                        workflow_found = json_data

    scan_recursive(metadata_dict)
    return prompt_found, workflow_found


def extract_comprehensive_metadata_png(file_path: str) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    """
    Extract comprehensive metadata from PNG files using PIL.
    This enhanced version scans ALL PNG info fields AND all EXIF tags for JSON/workflow/prompt data.
    """
    from PIL import Image
    from PIL.ExifTags import TAGS
    from ..logger import get_logger
    import json

    log = get_logger(__name__)

    try:
        with Image.open(file_path) as img:
            info = getattr(img, "info", {}) or {}

            # Also extract ALL EXIF data comprehensively
            exif_data = {}
            try:
                exif = img.getexif()
                if exif:
                    for tag_id, value in exif.items():
                        tag_name = TAGS.get(tag_id, f"Tag_{tag_id}")
                        exif_data[tag_name] = value
                        # Also store by numeric ID for comprehensive coverage
                        exif_data[f"0x{tag_id:04x}"] = value

                        # CRITICAL FIX: ComfyUI stores workflow/prompt in Make/Model tags!
                        # Decode bytes values immediately to check for JSON
                        if isinstance(value, bytes):
                            try:
                                decoded = value.decode('utf-8', errors='ignore')
                                # Store decoded version for scanning
                                exif_data[f"{tag_name}_decoded"] = decoded
                                exif_data[f"0x{tag_id:04x}_decoded"] = decoded
                            except Exception:
                                pass
            except Exception as e:
                if METADATA_DEBUG:
                    log.debug(f"[Majoor] Could not extract EXIF from {file_path}: {e}")

        # Combine PNG info and EXIF data for comprehensive scanning
        all_metadata = {**info, **exif_data}

        # Scan all PNG info fields for JSON/workflow/prompt data using enhanced scanner
        prompt, workflow = _scan_all_metadata_fields(all_metadata)

        # If not found, try more aggressive extraction from all string values
        # This catches data stored in non-standard fields like Make/Model EXIF tags
        if not prompt and not workflow:
            for key, value in all_metadata.items():
                if isinstance(value, str) and '{' in value:
                    json_data = _extract_json_from_text(value)
                    if json_data:
                        if not prompt and _is_comfyui_prompt_graph(json_data):
                            prompt = json_data
                            if METADATA_DEBUG:
                                log.debug(f"[Majoor] Found prompt in EXIF field: {key}")
                        if not workflow and _is_comfyui_workflow(json_data):
                            workflow = json_data
                            if METADATA_DEBUG:
                                log.debug(f"[Majoor] Found workflow in EXIF field: {key}")
                # Check bytes/bytearray fields too
                elif isinstance(value, (bytes, bytearray)):
                    try:
                        text_value = value.decode('utf-8', errors='ignore')
                        if '{' in text_value:
                            json_data = _extract_json_from_text(text_value)
                            if json_data:
                                if not prompt and _is_comfyui_prompt_graph(json_data):
                                    prompt = json_data
                                    if METADATA_DEBUG:
                                        log.debug(f"[Majoor] Found prompt in bytes field: {key}")
                                if not workflow and _is_comfyui_workflow(json_data):
                                    workflow = json_data
                                    if METADATA_DEBUG:
                                        log.debug(f"[Majoor] Found workflow in bytes field: {key}")
                    except Exception:
                        pass

        return prompt, workflow
    except Exception as e:
        if METADATA_DEBUG:
            log.debug(f"[Majoor] Failed to extract PNG metadata from {file_path}: {e}")
        return None, None


def extract_comprehensive_metadata_video_exiftool(file_path: str) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    """
    Extract comprehensive metadata from video/image files using ExifTool.
    This version uses enhanced scanning of ALL metadata fields with aggressive extraction.

    ExifTool flags used:
    - -j: JSON output
    - -g: Group names for organization
    - -ee: Extract embedded data
    - -a: Allow duplicate tags
    - -U: Extract unknown tags
    - -G1: Include group1 names
    """
    from ..utils import _get_exiftool_path
    from ..logger import get_logger
    import json
    import subprocess

    log = get_logger(__name__)
    exe = _get_exiftool_path()
    if not exe:
        return None, None

    try:
        # Run ExifTool with maximum extraction flags to get ALL possible metadata
        cmd = [
            exe,
            "-j",           # JSON output
            "-g",           # Group names
            "-ee",          # Extract embedded data
            "-a",           # Allow duplicate tags
            "-U",           # Extract unknown tags
            "-G1",          # Include group1 names
            "-b",           # Binary mode for non-printable data
            str(file_path)
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)

        if result.returncode != 0 or not result.stdout:
            return None, None

        # Parse the JSON output from ExifTool
        try:
            exif_data = json.loads(result.stdout)
            if not exif_data:
                return None, None
        except json.JSONDecodeError:
            return None, None

        # Get the first entry (ExifTool returns array with one object per file)
        metadata = exif_data[0] if exif_data else {}

        # Scan all extracted metadata for JSON/workflow/prompt data using enhanced scanner
        prompt, workflow = _scan_all_metadata_fields(metadata)

        # If not found, do aggressive text extraction from ALL fields
        if not prompt and not workflow:
            for key, value in metadata.items():
                if isinstance(value, str) and ('{' in value or '"prompt"' in value.lower() or '"workflow"' in value.lower()):
                    json_data = _extract_json_from_text(value)
                    if json_data:
                        if not prompt and _is_comfyui_prompt_graph(json_data):
                            prompt = json_data
                        if not workflow and _is_comfyui_workflow(json_data):
                            workflow = json_data

        return prompt, workflow
    except subprocess.TimeoutExpired:
        if METADATA_DEBUG:
            log.debug(f"[Majoor] ExifTool timeout on {file_path}")
        return None, None
    except Exception as e:
        if METADATA_DEBUG:
            log.debug(f"[Majoor] ExifTool error on {file_path}: {e}")
        return None, None


def extract_comprehensive_metadata_video_ffprobe(file_path: str) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    """
    Extract comprehensive metadata from video files using FFprobe.
    This version uses enhanced scanning of ALL metadata fields including all stream tags.
    """
    import shutil
    import json
    import subprocess
    from ..logger import get_logger

    log = get_logger(__name__)
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return None, None

    try:
        # Extract ALL possible metadata: format, streams, chapters, and data
        cmd = [
            ffprobe,
            "-v", "quiet",              # Suppress warnings
            "-print_format", "json",
            "-show_format",             # Show container format
            "-show_streams",            # Show all streams
            "-show_chapters",           # Show chapters (may contain metadata)
            "-show_entries",            # Show specific entries
            "format_tags:stream_tags",  # All format and stream tags
            str(file_path)
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)

        if result.returncode != 0 or not result.stdout:
            return None, None

        try:
            ffprobe_data = json.loads(result.stdout)
        except json.JSONDecodeError:
            return None, None

        # Scan the FFprobe output for JSON/workflow/prompt data using enhanced scanner
        prompt, workflow = _scan_all_metadata_fields(ffprobe_data)

        # If not found, aggressively search all tags in format and streams
        if not prompt and not workflow:
            # Check format tags
            format_tags = ffprobe_data.get("format", {}).get("tags", {})
            if format_tags:
                for key, value in format_tags.items():
                    if isinstance(value, str) and ('{' in value or '"prompt"' in value.lower() or '"workflow"' in value.lower()):
                        json_data = _extract_json_from_text(value)
                        if json_data:
                            if not prompt and _is_comfyui_prompt_graph(json_data):
                                prompt = json_data
                            if not workflow and _is_comfyui_workflow(json_data):
                                workflow = json_data

            # Check stream tags
            for stream in ffprobe_data.get("streams", []):
                if prompt and workflow:
                    break
                stream_tags = stream.get("tags", {})
                if stream_tags:
                    for key, value in stream_tags.items():
                        if isinstance(value, str) and ('{' in value or '"prompt"' in value.lower() or '"workflow"' in value.lower()):
                            json_data = _extract_json_from_text(value)
                            if json_data:
                                if not prompt and _is_comfyui_prompt_graph(json_data):
                                    prompt = json_data
                                if not workflow and _is_comfyui_workflow(json_data):
                                    workflow = json_data

        return prompt, workflow
    except subprocess.TimeoutExpired:
        if METADATA_DEBUG:
            log.debug(f"[Majoor] FFprobe timeout on {file_path}")
        return None, None
    except Exception as e:
        if METADATA_DEBUG:
            log.debug(f"[Majoor] FFprobe error on {file_path}: {e}")
        return None, None


def _detect_generation_metadata(file_path: str) -> tuple[bool, str | None]:
    """
    Detect if a file contains generation metadata from various AI image generation tools.

    Supports detection of metadata from:
    - Automatic1111 / Forge / SD.Next (parameters field)
    - NovelAI (Comment field)
    - Fooocus (fooocus_meta field)
    - InvokeAI (invokeai_metadata field)
    - StableSwarmUI (sd_metadata field)
    - Generic tools (generation_data, Description, Software, UserComment)

    Args:
        file_path: Path to the file to check

    Returns:
        Tuple of (has_generation_metadata: bool, source_name: str | None)
    """
    from pathlib import Path

    try:
        file_path = Path(file_path)
        ext = file_path.suffix.lower()

        # Only check image formats where these tools typically store metadata
        if ext not in [".png", ".jpg", ".jpeg", ".webp", ".tiff", ".tif"]:
            return False, None

        # For PNG files, check PNG info chunks
        if ext == ".png":
            from PIL import Image

            with Image.open(file_path) as img:
                info = getattr(img, "info", {}) or {}

                # Check for various metadata field formats used by different tools
                # Case-insensitive matching for parameters field
                generation_fields = [
                    ('parameters', 'A1111/Forge/SD.Next'),
                    ('Parameters', 'A1111/Forge/SD.Next'),
                    ('Comment', 'NovelAI'),
                    ('Description', 'metadata'),
                    ('Software', 'metadata'),
                    ('generation_data', 'generic'),
                    ('fooocus_meta', 'Fooocus'),
                    ('invokeai_metadata', 'InvokeAI'),
                    ('sd_metadata', 'StableSwarmUI'),
                    ('UserComment', 'EXIF'),
                ]

                for field_name, source_name in generation_fields:
                    if field_name in info:
                        field_value = info[field_name]
                        # Check if it's a valid non-empty string with meaningful content
                        if isinstance(field_value, str) and len(field_value) > 20:
                            if METADATA_DEBUG:
                                from ..logger import get_logger
                                log = get_logger(__name__)
                                log.debug(f"📁🔍 [Majoor] Found {source_name} metadata in '{field_name}' field ({len(field_value)} chars)")
                            return True, source_name

        # For WEBP/JPEG/TIFF, check both PNG-style info AND EXIF data
        elif ext in [".webp", ".jpg", ".jpeg", ".tiff", ".tif"]:
            from PIL import Image
            from PIL.ExifTags import TAGS

            with Image.open(file_path) as img:
                # Check PNG-style info first (WEBP can have this)
                info = getattr(img, "info", {}) or {}

                # Case-insensitive check for 'parameters' in info dict
                for key in info.keys():
                    key_lower = str(key).lower()
                    # Match 'parameters', 'xmp:parameters', etc.
                    if 'parameters' in key_lower:
                        field_value = info[key]
                        if isinstance(field_value, str) and len(field_value) > 20:
                            if METADATA_DEBUG:
                                from ..logger import get_logger
                                log = get_logger(__name__)
                                log.debug(f"📁🔍 [Majoor] Found A1111 parameters in '{key}' field ({len(field_value)} chars)")
                            return True, 'A1111/Forge/SD.Next'
                        elif isinstance(field_value, bytes) and len(field_value) > 20:
                            if METADATA_DEBUG:
                                from ..logger import get_logger
                                log = get_logger(__name__)
                                log.debug(f"📁🔍 [Majoor] Found A1111 parameters (bytes) in '{key}' field ({len(field_value)} bytes)")
                            return True, 'A1111/Forge/SD.Next'

                # Check EXIF data
                try:
                    exif = img.getexif()
                    if exif:
                        # Check all EXIF tags for parameters-like content
                        for tag_id, value in exif.items():
                            tag_name = TAGS.get(tag_id, f"Tag_{tag_id}")
                            tag_name_lower = tag_name.lower()

                            # Decode bytes values
                            if isinstance(value, bytes):
                                try:
                                    value = value.decode('utf-8', errors='ignore')
                                except:
                                    continue

                            # FIX #2: Detect ComfyUI prefixed strings in EXIF (Make/Model tags)
                            # Pattern: Make="workflow:{...json...}", Model="prompt:{...json...}"
                            if isinstance(value, str) and len(value) > 20:
                                v = value.lstrip()
                                vl = v.lower()

                                # Exact prefix match for ComfyUI format
                                if vl.startswith("workflow:{") or vl.startswith("prompt:{"):
                                    if METADATA_DEBUG:
                                        from ..logger import get_logger
                                        log = get_logger(__name__)
                                        log.debug(f"📁🔍 [Majoor] Found ComfyUI prefixed JSON in EXIF tag '{tag_name}' ({len(v)} chars)")
                                    return True, "ComfyUI/EXIF_prefixed"

                                # Generic heuristic: JSON-like content with workflow/prompt hints
                                if ('"workflow"' in vl or '"prompt"' in vl) and '{' in vl and '}' in vl:
                                    if METADATA_DEBUG:
                                        from ..logger import get_logger
                                        log = get_logger(__name__)
                                        log.debug(f"📁🔍 [Majoor] Found ComfyUI JSON hint in EXIF tag '{tag_name}' ({len(v)} chars)")
                                    return True, "ComfyUI/EXIF_json_hint"

                            # Check for 'parameters' in tag name
                            if 'parameters' in tag_name_lower and isinstance(value, str) and len(value) > 20:
                                if METADATA_DEBUG:
                                    from ..logger import get_logger
                                    log = get_logger(__name__)
                                    log.debug(f"📁🔍 [Majoor] Found parameters in EXIF tag '{tag_name}' ({len(value)} chars)")
                                return True, 'A1111/Forge/SD.Next'

                            # Check UserComment tag (37510)
                            if tag_id == 37510 and isinstance(value, str) and len(value) > 20:
                                return True, 'EXIF/UserComment'

                            # Check ImageDescription tag (270)
                            if tag_id == 270 and isinstance(value, str) and len(value) > 20:
                                # Check if it looks like generation params
                                if any(keyword in value.lower() for keyword in ['steps:', 'sampler:', 'cfg scale:', 'seed:', 'model:', 'negative prompt:']):
                                    return True, 'EXIF/ImageDescription'

                except Exception:
                    pass

    except Exception:
        pass

    return False, None


def extract_comprehensive_metadata(file_path: str) -> Dict[str, Any]:
    """
    Extract comprehensive metadata from any file type using multiple methods.

    CRITICAL: Checks sidecar .mjr.json FIRST for WEBP/MP4/etc before scanning EXIF/ffprobe.
    This is the primary metadata source for files that don't embed workflow data.

    This enhanced function thoroughly analyzes all possible metadata fields to find
    JSON, workflow, or prompt-like information using ExifTool, FFprobe, and Pillow.
    It searches every possible metadata field instead of just standard ones.

    Args:
        file_path: Path to the file to analyze

    Returns:
        Dictionary with extracted metadata including:
        - prompt_graph: The extracted prompt graph if found
        - workflow: The extracted workflow if found
        - has_workflow: Boolean indicating if workflow/prompt was found
        - metadata_sources: List of sources where metadata was found
        - has_generation_metadata: Boolean indicating if generation metadata from any AI tool was found
        - generation_metadata_source: Name of the tool that created the metadata (if detected)
    """
    from pathlib import Path
    import json
    from ..config import METADATA_EXT
    from ..metadata.workflow_normalize import _ensure_dict_from_json

    file_path = Path(file_path)
    if not file_path.exists():
        return {"has_workflow": False}

    # Initialize result
    result = {
        "prompt_graph": None,
        "workflow": None,
        "has_workflow": False,
        "metadata_sources": []
    }

    ext = file_path.suffix.lower()

    # Track what we find
    found_prompt = None
    found_workflow = None
    sources = []

    # PATCH #2 - CRITICAL FIX: Check sidecar .mjr.json FIRST
    # This is the primary metadata source for WEBP/MP4 that don't embed workflow
    sidecar_path = Path(str(file_path) + METADATA_EXT)
    if sidecar_path.exists():
        try:
            with open(sidecar_path, 'r', encoding='utf-8') as f:
                sidecar_data = json.load(f)

            if isinstance(sidecar_data, dict):
                # Try to extract prompt (can be under "prompt" or "prompt_graph")
                prompt_from_sidecar = sidecar_data.get("prompt") or sidecar_data.get("prompt_graph")
                if prompt_from_sidecar:
                    # Handle case where it might be JSON string
                    prompt_from_sidecar = _ensure_dict_from_json(prompt_from_sidecar)
                    if isinstance(prompt_from_sidecar, dict):
                        found_prompt = prompt_from_sidecar
                        sources.append("sidecar")

                # Try to extract workflow
                workflow_from_sidecar = sidecar_data.get("workflow")
                if workflow_from_sidecar:
                    workflow_from_sidecar = _ensure_dict_from_json(workflow_from_sidecar)
                    if isinstance(workflow_from_sidecar, dict):
                        found_workflow = workflow_from_sidecar
                        if "sidecar" not in sources:
                            sources.append("sidecar")

                # If we found complete metadata in sidecar, return early (performance optimization)
                if found_prompt or found_workflow:
                    if METADATA_DEBUG:
                        from ..logger import get_logger
                        log = get_logger(__name__)
                        log.debug(f"📁✅ [Majoor] Found metadata in sidecar for {file_path.name}")
                        log.debug(f"📁🔍 [Majoor]   - Has prompt: {found_prompt is not None}")
                        log.debug(f"📁🔍 [Majoor]   - Has workflow: {found_workflow is not None}")

                    # Early return with sidecar data
                    result["prompt_graph"] = found_prompt
                    result["workflow"] = found_workflow
                    result["has_workflow"] = True
                    result["metadata_sources"] = sources
                    return result

        except Exception as e:
            if METADATA_DEBUG:
                from ..logger import get_logger
                log = get_logger(__name__)
                log.debug(f"📁⚠️ [Majoor] Failed to read sidecar for {file_path.name}: {e}")
            # Continue to other extraction methods

    # For PNG files, use enhanced PIL extraction
    if ext == ".png":
        prompt, workflow = extract_comprehensive_metadata_png(str(file_path))
        if prompt:
            found_prompt = prompt
            sources.append("png_info")
        if workflow:
            found_workflow = workflow
            sources.append("png_info")

    # For video files, use multiple methods with enhanced scanning
    elif ext in [".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v", ".wmv", ".flv"]:
        # Try ExifTool first with enhanced scanning
        prompt, workflow = extract_comprehensive_metadata_video_exiftool(str(file_path))
        if prompt:
            found_prompt = prompt
            sources.append("exiftool")
        if workflow:
            found_workflow = workflow
            sources.append("exiftool")

        # Try FFprobe if ExifTool didn't find anything
        if not found_prompt and not found_workflow:
            prompt, workflow = extract_comprehensive_metadata_video_ffprobe(str(file_path))
            if prompt:
                found_prompt = prompt
                sources.append("ffprobe")
            if workflow:
                found_workflow = workflow
                sources.append("ffprobe")

    # For other image formats, try both Pillow and ExifTool with enhanced scanning
    elif ext in [".jpg", ".jpeg", ".tiff", ".tif", ".webp", ".gif", ".bmp", ".ico"]:
        # CRITICAL FIX: Use dedicated EXIF extractor for ComfyUI data FIRST
        # This handles prefixed formats like Make="workflow:{json}", Model="prompt:{json}"
        try:
            from .exif_extraction import extract_comfyui_prompt_workflow_from_exif_fields

            prompt, workflow, exif_sources = extract_comfyui_prompt_workflow_from_exif_fields(str(file_path))
            if prompt:
                found_prompt = prompt
                sources.extend(exif_sources)
            if workflow:
                found_workflow = workflow
                if exif_sources and exif_sources not in sources:
                    sources.extend(exif_sources)

            if METADATA_DEBUG and (prompt or workflow):
                from ..logger import get_logger
                log = get_logger(__name__)
                log.debug(f"📁✅ [Majoor] EXIF extractor found data in: {exif_sources}")

        except Exception as e:
            if METADATA_DEBUG:
                from ..logger import get_logger
                log = get_logger(__name__)
                log.debug(f"📁⚠️ [Majoor] EXIF extractor failed: {e}")

        # Fallback: Try generic Pillow scan if still missing
        if not found_prompt or not found_workflow:
            try:
                from PIL import Image
                from PIL.ExifTags import TAGS
                from ..logger import get_logger

                log = get_logger(__name__)

                with Image.open(file_path) as img:
                    # Extract PNG-style info if available
                    info = getattr(img, "info", {}) or {}

                    # Extract EXIF data
                    exif_data = {}
                    try:
                        exif = img.getexif()
                        if exif:
                            for tag_id, value in exif.items():
                                tag_name = TAGS.get(tag_id, f"Tag_{tag_id}")
                                exif_data[tag_name] = value
                                exif_data[f"0x{tag_id:04x}"] = value

                                # Decode bytes values
                                if isinstance(value, bytes):
                                    try:
                                        decoded = value.decode('utf-8', errors='replace')
                                        exif_data[f"{tag_name}_decoded"] = decoded
                                        exif_data[f"0x{tag_id:04x}_decoded"] = decoded
                                    except Exception:
                                        pass
                    except Exception:
                        pass

                    # Combine and scan
                    all_metadata = {**info, **exif_data}
                    if all_metadata:
                        prompt, workflow = _scan_all_metadata_fields(all_metadata)
                        if prompt and not found_prompt:
                            found_prompt = prompt
                            sources.append("pillow_scan")
                        if workflow and not found_workflow:
                            found_workflow = workflow
                            sources.append("pillow_scan")
            except Exception as e:
                if METADATA_DEBUG:
                    log.debug(f"[Majoor] Pillow fallback scan failed for {file_path}: {e}")

        # Then try ExifTool for even more comprehensive extraction
        if not found_prompt or not found_workflow:
            prompt, workflow = extract_comprehensive_metadata_video_exiftool(str(file_path))
            if prompt and not found_prompt:
                found_prompt = prompt
                sources.append("exiftool")
            if workflow and not found_workflow:
                found_workflow = workflow
                sources.append("exiftool")

    # Check for generation metadata from other AI tools (A1111, Forge, NovelAI, etc.)
    has_gen_metadata, gen_metadata_source = _detect_generation_metadata(str(file_path))

    # Update result
    result["prompt_graph"] = found_prompt
    result["workflow"] = found_workflow
    result["has_generation_metadata"] = has_gen_metadata
    result["generation_metadata_source"] = gen_metadata_source
    # Mark has_workflow as true if we found ComfyUI workflow OR generation metadata from other tools
    result["has_workflow"] = bool(found_prompt or found_workflow or has_gen_metadata)
    result["metadata_sources"] = sources

    # If we found a workflow but no prompt, try to normalize it
    if found_workflow and not found_prompt:
        normalized_prompt = _normalize_workflow_to_prompt_graph(found_workflow)
        if normalized_prompt:
            result["prompt_graph"] = normalized_prompt

    # If we found a prompt but no workflow, create a minimal workflow
    if found_prompt and not found_workflow:
        reconstructed_workflow = prompt_graph_to_workflow(found_prompt)
        if reconstructed_workflow:
            result["workflow"] = reconstructed_workflow

    return result


def has_generation_workflow_enhanced(file_path: str) -> bool:
    """
    Enhanced version of has_generation_workflow that uses comprehensive extraction.
    This function uses the enhanced extraction method to find workflow/prompt data
    in any possible metadata field.

    PATCH #2: Ultra-fast sidecar check first for performance.
    If sidecar exists and contains prompt/workflow, return True immediately.
    """
    from pathlib import Path
    import json
    from ..config import METADATA_EXT

    # Ultra-fast sidecar check first (PATCH #2)
    sidecar_path = Path(str(file_path) + METADATA_EXT)
    if sidecar_path.exists():
        try:
            with open(sidecar_path, 'r', encoding='utf-8') as f:
                sidecar_data = json.load(f)
            if isinstance(sidecar_data, dict):
                # Check for prompt/workflow/prompt_graph
                if sidecar_data.get("prompt") or sidecar_data.get("workflow") or sidecar_data.get("prompt_graph"):
                    return True
        except Exception:
            pass

    # Fall back to comprehensive extraction
    result = extract_comprehensive_metadata(file_path)
    return result.get("has_workflow", False)


__all__ = [
    "extract_enhanced_metadata",
    "write_enhanced_metadata",
    "extract_workflow_hash",
    "get_metadata_source_info",
    "extract_comprehensive_metadata",
    "has_generation_workflow_enhanced",
    "_extract_json_from_text",
    "_scan_all_metadata_fields"
]


