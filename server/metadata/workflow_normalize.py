import json
from typing import Any, Dict, Optional


def _sanitize_nonfinite_json(text: str) -> str:
    """
    Replace bare NaN/Infinity tokens with null (only when outside JSON strings).
    Some ComfyUI metadata blobs contain `NaN` (e.g. is_changed: NaN), which is invalid JSON.
    """
    if not isinstance(text, str) or not text:
        return text

    out = []
    i = 0
    in_str = False
    escape = False
    n = len(text)

    while i < n:
        ch = text[i]
        if in_str:
            out.append(ch)
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_str = False
            i += 1
            continue

        if ch == '"':
            in_str = True
            out.append(ch)
            i += 1
            continue

        if text.startswith("-Infinity", i):
            out.append("null")
            i += len("-Infinity")
            continue
        if text.startswith("Infinity", i):
            out.append("null")
            i += len("Infinity")
            continue
        if text.startswith("NaN", i):
            out.append("null")
            i += len("NaN")
            continue

        out.append(ch)
        i += 1

    return "".join(out)


def _json_loads_relaxed(text: str) -> Any:
    """
    json.loads with a fallback that tolerates NaN/Infinity tokens from metadata blobs.
    """
    try:
        return json.loads(text)
    except Exception:
        return json.loads(_sanitize_nonfinite_json(text))


def _ensure_dict_from_json(value: Any) -> Optional[Dict[str, Any]]:
    """
    Accept a dict or a JSON string; return a dict or None.
    """
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            data = _json_loads_relaxed(value)
            if isinstance(data, dict):
                return data
        except Exception:
            return None
    return None


def _normalize_workflow_to_prompt_graph(workflow: Any) -> Optional[Dict[str, Any]]:
    """
    Convert a workflow (dict with 'nodes': [...]) into an id->node map for parsing.
    """
    if workflow is None:
        return None
    if isinstance(workflow, dict) and isinstance(workflow.get("nodes"), list):
        nodes_map: Dict[str, Any] = {}
        for n in workflow.get("nodes", []):
            if not isinstance(n, dict):
                continue
            nid = n.get("id")
            if nid is None:
                continue
            ctype = n.get("class_type") or n.get("type") or n.get("title")
            nodes_map[str(nid)] = {
                "class_type": ctype,
                "inputs": n.get("inputs", {}) or {},
                "_meta": n.get("_meta", {}),
                "title": n.get("title"),
                "widgets_values": n.get("widgets_values"),
            }
        return nodes_map if nodes_map else None

    if isinstance(workflow, dict):
        return {str(k): v for k, v in workflow.items() if isinstance(v, dict)}

    return None


__all__ = ["_ensure_dict_from_json", "_normalize_workflow_to_prompt_graph", "_json_loads_relaxed"]
