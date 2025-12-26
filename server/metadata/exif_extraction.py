"""
Robust EXIF extraction for ComfyUI prompt/workflow data.
Handles various storage patterns used by different Save nodes.
"""
from typing import Optional, Dict, Any, Tuple, List
import json


def extract_comfyui_prompt_workflow_from_exif_fields(file_path: str) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]], List[str]]:
    """
    Extract ComfyUI prompt_graph and workflow from EXIF/metadata fields.

    Handles various patterns:
    - "prompt:{json}" / "workflow:{json}" (prefixed format)
    - "Prompt:{json}" / "Workflow:{json}" (capitalized)
    - Direct JSON in tags (Make/Model/ImageDescription/UserComment)

    Args:
        file_path: Path to image file

    Returns:
        (prompt_graph, workflow, sources) tuple
        - prompt_graph: dict with node IDs as keys, or None
        - workflow: dict with nodes array, or None
        - sources: list of tag names where data was found
    """
    from PIL import Image
    from PIL.ExifTags import TAGS

    prompt_graph = None
    workflow = None
    sources = []

    try:
        with Image.open(file_path) as img:
            # 1. Check PNG-style info dict first (WEBP can have this)
            info = getattr(img, "info", {}) or {}

            for key, value in info.items():
                if not isinstance(value, (str, bytes)):
                    continue

                # Decode bytes
                if isinstance(value, bytes):
                    try:
                        value = value.decode('utf-8', errors='replace')
                    except:
                        continue

                # Try to extract JSON
                extracted = _extract_from_field(str(key), value)
                if extracted:
                    p, w = extracted
                    if p and not prompt_graph:
                        prompt_graph = p
                        sources.append(f"info.{key}")
                    if w and not workflow:
                        workflow = w
                        sources.append(f"info.{key}")

            # 2. Check EXIF tags
            try:
                exif = img.getexif()
                if exif:
                    # Priority tags that commonly contain ComfyUI data
                    priority_tags = [
                        (0x010F, 'Make'),          # Often contains "workflow:{...}"
                        (0x0110, 'Model'),         # Often contains "prompt:{...}"
                        (0x010E, 'ImageDescription'),
                        (0x9286, 'UserComment'),
                    ]

                    # Check priority tags first
                    for tag_id, tag_name in priority_tags:
                        if tag_id in exif:
                            value = exif[tag_id]

                            # Decode bytes
                            if isinstance(value, bytes):
                                try:
                                    value = value.decode('utf-8', errors='replace')
                                except:
                                    continue

                            if isinstance(value, str):
                                extracted = _extract_from_field(tag_name, value)
                                if extracted:
                                    p, w = extracted
                                    if p and not prompt_graph:
                                        prompt_graph = p
                                        sources.append(f"exif.{tag_name}")
                                    if w and not workflow:
                                        workflow = w
                                        sources.append(f"exif.{tag_name}")

                    # If still missing, scan all other tags
                    if not prompt_graph or not workflow:
                        for tag_id, value in exif.items():
                            if tag_id in [t[0] for t in priority_tags]:
                                continue  # Already checked

                            tag_name = TAGS.get(tag_id, f"Tag_{tag_id}")

                            # Decode bytes
                            if isinstance(value, bytes):
                                try:
                                    value = value.decode('utf-8', errors='replace')
                                except:
                                    continue

                            if isinstance(value, str):
                                extracted = _extract_from_field(tag_name, value)
                                if extracted:
                                    p, w = extracted
                                    if p and not prompt_graph:
                                        prompt_graph = p
                                        sources.append(f"exif.{tag_name}")
                                    if w and not workflow:
                                        workflow = w
                                        sources.append(f"exif.{tag_name}")

                            # Stop if we found both
                            if prompt_graph and workflow:
                                break

            except Exception:
                pass

    except Exception:
        pass

    return prompt_graph, workflow, sources


def _extract_from_field(field_name: str, value: str) -> Optional[Tuple[Optional[Dict], Optional[Dict]]]:
    """
    Extract prompt_graph and/or workflow from a single metadata field.

    Returns:
        (prompt_graph, workflow) tuple, or None if nothing found
    """
    if not value or len(value) < 20:
        return None

    value = value.strip()
    value_lower = value.lower()

    prompt_graph = None
    workflow = None

    # Pattern 1: Prefixed format "prompt:{json}" or "workflow:{json}"
    if value_lower.startswith("prompt:"):
        json_str = value[7:].lstrip()  # Remove "prompt:" prefix
        prompt_graph = _parse_json_safe(json_str)
        if prompt_graph and _is_comfyui_prompt_graph(prompt_graph):
            return (prompt_graph, None)

    if value_lower.startswith("workflow:"):
        json_str = value[9:].lstrip()  # Remove "workflow:" prefix
        workflow = _parse_json_safe(json_str)
        if workflow and _is_comfyui_workflow(workflow):
            return (None, workflow)

    # Pattern 2: Direct JSON (starts with '{')
    if value.startswith('{'):
        obj = _parse_json_safe(value)
        if obj:
            if _is_comfyui_prompt_graph(obj):
                return (obj, None)
            elif _is_comfyui_workflow(obj):
                return (None, obj)

    # Pattern 3: JSON embedded somewhere in text
    if '{' in value:
        # Find first '{' and try to extract balanced JSON
        start = value.find('{')
        if start != -1:
            json_str = value[start:]
            obj = _parse_json_safe(json_str)
            if obj:
                if _is_comfyui_prompt_graph(obj):
                    return (obj, None)
                elif _is_comfyui_workflow(obj):
                    return (None, obj)

    return None


def _parse_json_safe(text: str) -> Optional[Dict]:
    """Parse JSON safely, return None on error."""
    try:
        obj = json.loads(text)
        if isinstance(obj, dict):
            return obj
    except:
        pass
    return None


def _is_comfyui_prompt_graph(obj: Any) -> bool:
    """
    Check if object looks like a ComfyUI prompt graph.
    Prompt graph: dict with node IDs as keys, values have "class_type" field.
    """
    if not isinstance(obj, dict) or len(obj) == 0:
        return False

    # Check if at least one value looks like a ComfyUI node
    node_count = 0
    for key, value in obj.items():
        if isinstance(value, dict) and "class_type" in value:
            node_count += 1

    # If at least 30% of entries look like nodes, it's likely a prompt graph
    if node_count > 0 and node_count >= len(obj) * 0.3:
        return True

    return False


def _is_comfyui_workflow(obj: Any) -> bool:
    """
    Check if object looks like a ComfyUI workflow.
    Workflow: dict with "nodes" array.
    """
    if not isinstance(obj, dict):
        return False

    # Primary indicator: "nodes" field that's a list
    if "nodes" in obj and isinstance(obj["nodes"], list):
        nodes = obj["nodes"]
        if len(nodes) > 0:
            # Check first node has workflow-specific fields
            first_node = nodes[0]
            if isinstance(first_node, dict):
                # Workflow nodes have "type" (node class), not "class_type"
                if "type" in first_node or "id" in first_node:
                    return True

    return False
