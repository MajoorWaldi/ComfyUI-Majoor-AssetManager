"""
Shared parsing utilities for metadata extraction (used by both generic extractors.py and native_extractors.py).
"""
import json
import base64
import re
import zlib
import logging
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)

MAX_METADATA_JSON_SIZE = 10 * 1024 * 1024  # 10MB
# 50MB Decompressed limit (Critical-003)
MAX_DECOMPRESSED_SIZE = 50 * 1024 * 1024  
MIN_BASE64_CANDIDATE_LEN = 80

_BASE64_RE = re.compile(r"^[A-Za-z0-9+/=\s]+$")
_AUTO1111_KV_RE = re.compile(r"(?:^|,\s*)([^:,]+):\s*")


def _safe_zlib_decompress(data: bytes, max_size: int = MAX_DECOMPRESSED_SIZE) -> Optional[bytes]:
    """
    Safely decompress zlib data with size limit.
    """
    try:
        decompressor = zlib.decompressobj()
        result = bytearray()
        
        chunk_size = 81920 # 80KB chunks
        offset = 0
        
        while offset < len(data):
            chunk = decompressor.decompress(data[offset:offset + chunk_size])
            if chunk:
                result.extend(chunk)
                if len(result) > max_size:
                    return None
            offset += chunk_size
            
        chunk = decompressor.flush()
        if chunk:
            result.extend(chunk)
            
        if len(result) > max_size:
            return None
            
        return bytes(result)
    except Exception:
        return None


def try_parse_json_text(text: str) -> Optional[Dict[str, Any]]:
    """Parse JSON embedded in text, handling standard ComfyUI prefixes."""
    if not isinstance(text, str):
        return None
    raw = text.strip()
    if not raw:
        return None

    # Handle common prefixes
    lower_raw = raw.lower()
    if lower_raw.startswith("workflow:"):
        raw = raw[9:].strip()
    elif lower_raw.startswith("prompt:"):
        raw = raw[7:].strip()
    elif lower_raw.startswith("makeprompt:"):
        raw = raw[11:].strip()

    if len(raw) > MAX_METADATA_JSON_SIZE:
        return None

    def _loads_maybe(s: str) -> Optional[Dict[str, Any]]:
        try:
            parsed = json.loads(s)
        except Exception:
            return None
        if isinstance(parsed, dict):
            return parsed
        if isinstance(parsed, str):
            try:
                nested = json.loads(parsed)
            except Exception:
                return None
            return nested if isinstance(nested, dict) else None
        return None

    direct = _loads_maybe(raw)
    if direct is not None:
        return direct

    # Base64 check
    if len(raw) < MIN_BASE64_CANDIDATE_LEN or len(raw) > (MAX_METADATA_JSON_SIZE * 2):
        return None
    if not _BASE64_RE.match(raw):
        return None

    try:
        decoded = base64.b64decode(raw, validate=False)
    except Exception:
        return None

    # Zlib check
    if decoded.startswith(b"x\x9c") or decoded.startswith(b"x\xda"):
        decompressed = _safe_zlib_decompress(decoded)
        if decompressed is not None:
             decoded = decompressed
        # Fallback to usage as-is if decompression fails or is skipped (unlikely valid though)

    try:
        decoded_text = decoded.decode("utf-8", errors="replace").strip()
    except Exception:
        return None

    if not decoded_text or len(decoded_text) > MAX_METADATA_JSON_SIZE:
        return None

    return _loads_maybe(decoded_text)


def parse_json_value(value: Any) -> Optional[Dict[str, Any]]:
    """Try to parse a JSON payload from a tag value. Accept strings or lists."""
    candidates = []
    if isinstance(value, str):
        candidates = [value]
    elif isinstance(value, (list, tuple)):
        candidates = [v for v in value if isinstance(v, str)]
    else:
        return None

    for raw in candidates:
        parsed = try_parse_json_text(raw)
        if isinstance(parsed, dict):
            return parsed

    return None


def looks_like_prompt_node_id(value: Any) -> bool:
    """Accept plain integers or colon-delimited numeric ids (e.g. '91:68')."""
    if isinstance(value, int):
        return True
    if not isinstance(value, str):
        return False
    parts = value.split(":")
    if not parts:
        return False
    return all(part.isdigit() for part in parts)


def looks_like_comfyui_workflow(value: Optional[Dict[str, Any]]) -> bool:
    """Heuristic check for ComfyUI workflow graph."""
    if not isinstance(value, dict):
        return False

    nodes = value.get("nodes")
    if not isinstance(nodes, list) or not nodes:
        return False

    links = value.get("links")
    if links is not None and not isinstance(links, list):
        return False

    sample = nodes[:5]
    valid_nodes = 0
    for node in sample:
        if not isinstance(node, dict):
            continue
        if "type" in node and "id" in node:
            valid_nodes += 1
            continue
        if "id" in node and ("title" in node or "outputs" in node or "inputs" in node):
            valid_nodes += 1
            continue

    min_required = max(1, len(sample) // 2)
    return valid_nodes >= min_required


def looks_like_comfyui_prompt_graph(value: Optional[Dict[str, Any]]) -> bool:
    """Heuristic check for ComfyUI prompt graph (runtime prompt dict)."""
    if not isinstance(value, dict) or not value:
        return False

    # Avoid confusing workflow exports (they have `nodes: []`).
    if "nodes" in value and isinstance(value.get("nodes"), list):
        return False

    keys = list(value.keys())[:8]
    digit_keys = 0
    valid_nodes = 0
    for k in keys:
        if looks_like_prompt_node_id(k):
            digit_keys += 1
        node = value.get(k)
        if not isinstance(node, dict):
            continue
        ct = node.get("class_type") or node.get("type")
        ins = node.get("inputs")
        if isinstance(ct, str) and isinstance(ins, dict):
            valid_nodes += 1

    return digit_keys >= max(2, len(keys) // 2) and valid_nodes >= max(2, len(keys) // 2)


def parse_auto1111_params(params_text: str) -> Optional[Dict[str, Any]]:
    """Parse Auto1111/Forge parameters text."""
    if not params_text:
        return None

    try:
        text = params_text.strip()
        if not text:
            return None

        result: Dict[str, Any] = {}

        remaining = ""
        neg_marker = "Negative prompt:"
        neg_idx = text.find(neg_marker)
        if neg_idx != -1:
            result["prompt"] = text[:neg_idx].strip()
            after = text[neg_idx + len(neg_marker):].lstrip()
            
            # Find the start of the key-value parameters block (e.g. "Steps: 20, ...")
            # We look for a line starting with "Steps:" or a standard key.
            # Using regex to find the boundary more reliably than just "\n".
            # Common starting keys: Steps, Size, Model hash, Seed, CFG scale.
            # We look for "\n" followed by one of those keys.
            param_start_match = re.search(r"\n(?:Steps|Size|Model|Seed|CFG|Sampler|Denoising|Ens|Version):", after)
            
            if param_start_match:
                split_idx = param_start_match.start()
                result["negative_prompt"] = after[:split_idx].strip()
                remaining = after[split_idx:].strip()
            else:
                # Fallback: if no parameters found, assume remaining is all negative prompt
                # (unless it's empty)
                result["negative_prompt"] = after.strip()
                remaining = ""
        else:
            # No negative prompt marker.
            # Split positive prompt from params directly.
            param_start_match = re.search(r"\n(?:Steps|Size|Model|Seed|CFG|Sampler|Denoising|Ens|Version):", text)
            if param_start_match:
                split_idx = param_start_match.start()
                result["prompt"] = text[:split_idx].strip()
                remaining = text[split_idx:].strip()
            else:
                steps_idx = text.find("\nSteps:")
                if steps_idx == -1:
                    if text.startswith("Steps:"):
                        result["prompt"] = ""
                        remaining = text
                    else:
                        result["prompt"] = text
                        remaining = ""
                else:
                    result["prompt"] = text[:steps_idx].strip()
                    remaining = text[steps_idx:].lstrip()

        if remaining:
            matches = list(_AUTO1111_KV_RE.finditer(remaining))
            for i, match in enumerate(matches):
                key = match.group(1).strip().lower().replace(" ", "_")
                value_start = match.end()
                value_end = matches[i + 1].start() if (i + 1) < len(matches) else len(remaining)
                value = remaining[value_start:value_end].strip().strip(",").strip()

                if not key:
                    continue

                if key == "steps":
                    try:
                        result["steps"] = int(value)
                    except (ValueError, TypeError):
                        pass
                elif key == "sampler":
                    result["sampler"] = value
                elif key in ("cfg_scale", "cfg"):
                    try:
                        result["cfg"] = float(value)
                    except (ValueError, TypeError):
                        pass
                elif key == "seed":
                    try:
                        result["seed"] = int(value)
                    except (ValueError, TypeError):
                        pass
                elif key in ("size", "hires_resize"):
                    if "x" in value:
                        w, h = value.split("x", 1)
                        try:
                            result["width"] = int(w.strip())
                            result["height"] = int(h.strip())
                        except (ValueError, TypeError):
                            pass
                elif key == "model":
                    result["model"] = value

        return result or None

    except Exception as e:
        logger.debug(f"Failed to parse Auto1111 params: {e}")
        return None
