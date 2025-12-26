from __future__ import annotations

import json
import subprocess
import shutil
import os
import base64
import urllib.parse
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from .metadata.workflow_normalize import _normalize_workflow_to_prompt_graph, _ensure_dict_from_json

from .metadata.video_extraction import _extract_json_from_video
from .metadata.workflow_reconstruct import prompt_graph_to_workflow as _prompt_graph_to_workflow

try:
    from PIL import Image  # type: ignore
except ImportError:
    # Pillow not available - PNG parsing will be disabled
    Image = None
try:
    from .utils import load_metadata, _get_exiftool_path, IMAGE_EXTS  # type: ignore
except ImportError:
    # Utils not available - sidecar fallback disabled
    load_metadata = None
    _get_exiftool_path = None
    IMAGE_EXTS = set()


def _load_custom_node_mappings() -> Dict[str, List[str]]:
    """
    Load custom node type mappings from node_mapping.json.
    Returns a dict with keys like 'sampler_classes', 'checkpoint_loader_classes', etc.
    """
    config_path = Path(__file__).parent.parent / "node_mapping.json"
    if not config_path.exists():
        return {}

    try:
        with open(config_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            # Remove comment fields
            return {k: v for k, v in data.items() if not k.startswith("_")}
    except (json.JSONDecodeError, OSError, ValueError):
        # Invalid config - ignore and use defaults
        return {}


# Samplers treated as source of truth (lowercase)
_DEFAULT_SAMPLER_CLASSES: Set[str] = {
    # Core ComfyUI samplers
    "ksampler",
    "samplercustom",
    "ksampleradvanced",
    "ksamplercustom",
    "ksamplercustomadvanced",
    "ksamplerhires",
    "ksamplerupscale",

    # Efficiency nodes
    "ksampler (efficient)",
    "ksampler adv. (efficient)",
    "ksamplerefficient",
    "ksampleradvefficient",

    # Impact Pack samplers
    "impactksampleradvanced",
    "ksamplerprovider",
    "impactksampler",

    # AnimateDiff samplers
    "animatediffsampler",
    "animatediffksampleradvanced",
    "animatediffksampler",

    # Flux / SD3 / SDXL samplers
    "fluxsampler",
    "fluxguidance",
    "sd3sampler",
    "sdxlsampler",
    "sdxlksampleradvanced",

    # Advanced custom samplers
    "samplerdpmpp_sde",
    "samplerdpmpp_2m",
    "samplerdpmpp_3m_sde",
    "samplerlms",
    "samplereulera",
    "samplereulerancestral",
    "samplerdpm2",
    "samplerdpm2ancestral",
    "samplerheun",
    "samplerdpm_fast",
    "samplerdpm_adaptive",
    "samplerlcm",
    "samplerddim",
    "samplerddpm",
    "sampleruni_pc",
    "sampleruni_pc_bh2",

    # WAN / Kijai wrappers
    "wanvideosampler",
    "wanvideoksampler",
    "wanmoeksampler",

    # ComfyUI-Manager / custom nodes
    "ttn_ksampler",
    "ttN_KSampler",
    "bnsrksampleradv",
    "bnk_sampler",
    "rgthreesampler",
    "rg_sampler",
    "was_sampler",
    "civitai_sampler",
    "adv_sampler",
    "custom_sampler",
    "restart_sampler",

    # Video / Frame samplers
    "videoksampler",
    "frameksampler",
    "batchksampler",
}

# Model loaders (diffusion / checkpoint)
_DEFAULT_CHECKPOINT_LOADER_CLASSES: Set[str] = {
    "CheckpointLoaderSimple",
    "CheckpointLoader",
}
_DEFAULT_UNET_LOADER_CLASSES: Set[str] = {
    "UNETLoader",
    "LoadDiffusionModel",  # certains wrappers utilisent ce label
}
_DEFAULT_DIFFUSERS_LOADER_CLASSES: Set[str] = {
    "DiffusersLoader",
}

# LoRA
_DEFAULT_LORA_CLASSES: Set[str] = {
    "LoraLoader",
    "LoraLoaderModelOnly",
}

# Load custom mappings and merge with defaults
_custom_mappings = _load_custom_node_mappings()

# Merge custom classes with defaults (lowercase normalization)
SAMPLER_CLASSES: Set[str] = _DEFAULT_SAMPLER_CLASSES | {
    s.lower() for s in _custom_mappings.get("sampler_classes", [])
}
CHECKPOINT_LOADER_CLASSES: Set[str] = _DEFAULT_CHECKPOINT_LOADER_CLASSES | set(
    _custom_mappings.get("checkpoint_loader_classes", [])
)
UNET_LOADER_CLASSES: Set[str] = _DEFAULT_UNET_LOADER_CLASSES | set(
    _custom_mappings.get("unet_loader_classes", [])
)
DIFFUSERS_LOADER_CLASSES: Set[str] = _DEFAULT_DIFFUSERS_LOADER_CLASSES | set(
    _custom_mappings.get("diffusers_loader_classes", [])
)
LORA_CLASSES: Set[str] = _DEFAULT_LORA_CLASSES | set(
    _custom_mappings.get("lora_classes", [])
)

def _extract_json_like_from_text(text: str) -> List[str]:
    """
    Extract balanced JSON-like substrings when generation keywords are present.
    """
    if not text or not isinstance(text, str):
        return []
    lower = text.lower()
    keywords = ("prompt", "workflow", "nodes", "extra_pnginfo", "class_type", "inputs")
    if not any(k in lower for k in keywords):
        return []

    results: List[str] = []
    stack: List[str] = []
    start = None
    for idx, ch in enumerate(text):
        if ch in "{[":
            if not stack:
                start = idx
            stack.append(ch)
        elif ch in "}]":
            if not stack:
                continue
            opening = stack.pop()
            if opening == "{" and ch != "}":
                continue
            if opening == "[" and ch != "]":
                continue
            if not stack and start is not None:
                candidate = text[start : idx + 1]
                if candidate:
                    results.append(candidate)
                start = None
    return results


def _parse_candidate_json(s: str):
    try:
        return json.loads(s)
    except (json.JSONDecodeError, ValueError, TypeError):
        # Not valid JSON or wrong type
        pass

    # Some tools stash JSON into a text field but escape quotes, e.g.:
    #   {\"nodes\": [...], \"prompt\": {...}}
    # This is not valid JSON until unescaped.
    if not isinstance(s, str) or not s or '\\"' not in s:
        return None

    def _wrap_as_json_string(val: str) -> str:
        # Build a JSON string literal that preserves existing escapes, while
        # escaping any quotes that would terminate the wrapper.
        out: List[str] = []
        for i, ch in enumerate(val):
            if ch != '"':
                out.append(ch)
                continue
            # Quote is escaped if preceded by an odd number of backslashes.
            backslashes = 0
            j = i - 1
            while j >= 0 and val[j] == "\\":
                backslashes += 1
                j -= 1
            if backslashes % 2 == 1:
                out.append('"')
            else:
                out.append('\\"')
        return '"' + "".join(out) + '"'

    candidate = s
    for _ in range(2):
        try:
            unescaped = json.loads(_wrap_as_json_string(candidate))
        except (json.JSONDecodeError, ValueError):
            return None
        if not isinstance(unescaped, str) or not unescaped:
            return None
        candidate = unescaped
        try:
            return json.loads(candidate)
        except (json.JSONDecodeError, ValueError):
            continue

    return None


def _detect_prompt_graph(obj) -> Optional[Dict[str, Any]]:
    if not isinstance(obj, dict):
        return None
    for v in obj.values():
        if isinstance(v, dict) and ("inputs" in v or "class_type" in v):
            return obj
    return None


def _detect_workflow(obj) -> Optional[Dict[str, Any]]:
    if not isinstance(obj, dict):
        return None
    if isinstance(obj.get("nodes"), list):
        return obj
    if ("last_node_id" in obj or "last_link_id" in obj or "links" in obj) and isinstance(obj.get("nodes"), list):
        return obj
    return None


def _scan_png_info_for_generation(info: Dict[str, Any]) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    """
    Scan PNG metadata for ComfyUI prompt/workflow by recursively searching all fields.

    This function handles various storage formats:
    - Standard ComfyUI fields: 'prompt', 'workflow', 'extra_pnginfo'
    - Alternative fields: 'parameters', 'comment', 'description', 'usercomment'
    - Nested JSON: Handles escaped JSON strings (e.g., "{\"prompt\": ...}")
    - Multiple layers: Recursively scans up to reasonable depth

    Args:
        info: PNG metadata dictionary from PIL Image.info or similar

    Returns:
        Tuple of (prompt_graph, workflow):
        - prompt_graph: Dict with node IDs as keys, containing 'class_type' and 'inputs'
        - workflow: Dict with 'nodes', 'links', 'last_node_id', etc.

    Example:
        >>> from PIL import Image
        >>> img = Image.open("output.png")
        >>> prompt, workflow = _scan_png_info_for_generation(img.info)
        >>> if prompt:
        ...     print(f"Found {len(prompt)} nodes in prompt graph")
    """
    prompt_found = None
    workflow_found = None
    candidate_keys = {"prompt", "workflow", "comment", "parameters", "description", "usercomment", "xpcomment", "software"}

    def try_payload(obj: Any):
        nonlocal prompt_found, workflow_found
        if isinstance(obj, dict):
            # explicit prompt/workflow
            pr = _ensure_dict_from_json(obj.get("prompt"))
            if isinstance(pr, list):
                pr = _normalize_workflow_to_prompt_graph({"nodes": pr})
            if prompt_found is None and isinstance(pr, dict):
                prompt_found = pr

            wf_raw = _ensure_dict_from_json(obj.get("workflow"))
            if workflow_found is None and isinstance(wf_raw, dict):
                if wf_raw.get("nodes"):
                    workflow_found = wf_raw
                else:
                    wf_norm = _normalize_workflow_to_prompt_graph(wf_raw)
                    if wf_norm:
                        workflow_found = wf_raw

            # raw prompt/workflow detections
            if prompt_found is None:
                pg = _detect_prompt_graph(obj)
                if pg:
                    prompt_found = pg
            if workflow_found is None:
                wf = _detect_workflow(obj)
                if wf:
                    workflow_found = wf

            extra = obj.get("extra_pnginfo")
            if isinstance(extra, dict):
                try_payload(extra)
        elif isinstance(obj, (bytes, bytearray)):
            try:
                try_payload(obj.decode("utf-8", errors="replace"))
            except Exception:
                return
        elif isinstance(obj, str):
            txt = obj.strip()
            candidates: List[str] = []
            if txt.startswith("{") or txt.startswith("["):
                candidates.append(txt)
            else:
                candidates.extend(_extract_json_like_from_text(txt))
            for cand in candidates:
                parsed = _parse_candidate_json(cand)
                if isinstance(parsed, (dict, list)):
                    try_payload(parsed)

    for key, val in (info or {}).items():
        try:
            if str(key).lower() not in candidate_keys:
                continue
        except Exception:
            continue
        if prompt_found and workflow_found:
            break
        try_payload(val)

    return prompt_found, workflow_found


def _extract_parameters_from_image(file_path: Path) -> Optional[str]:
    """
    Extract A1111-style 'parameters' text from image file (PNG/WEBP/JPG/TIFF).
    Checks both PNG info dict and EXIF tags with case-insensitive matching.
    Returns the parameters string if found, None otherwise.
    """
    if Image is None:
        return None

    try:
        with Image.open(file_path) as img:
            # Check PNG-style info first
            info = getattr(img, "info", {}) or {}

            # Case-insensitive search in info dict keys
            for key, value in info.items():
                key_lower = str(key).lower()
                if 'parameters' in key_lower:
                    # Handle both string and bytes
                    if isinstance(value, str):
                        return value
                    elif isinstance(value, (bytes, bytearray)):
                        try:
                            return value.decode("utf-8", errors="replace")
                        except:
                            pass

            # Check EXIF data for WEBP/JPG/TIFF
            try:
                from PIL.ExifTags import TAGS
                exif = img.getexif()
                if exif:
                    for tag_id, value in exif.items():
                        tag_name = TAGS.get(tag_id, f"Tag_{tag_id}")
                        tag_name_lower = tag_name.lower()

                        # Decode bytes
                        if isinstance(value, bytes):
                            try:
                                value = value.decode('utf-8', errors='ignore')
                            except:
                                continue

                        # Check for 'parameters' in tag name
                        if 'parameters' in tag_name_lower and isinstance(value, str):
                            return value

                        # Check ImageDescription (270) and UserComment (37510) as fallback
                        # These sometimes contain A1111 parameters
                        if tag_id in (270, 37510) and isinstance(value, str):
                            # Verify it looks like A1111 parameters
                            if any(kw in value.lower() for kw in ['steps:', 'sampler:', 'cfg scale:', 'seed:', 'negative prompt:']):
                                return value
            except:
                pass

    except Exception:
        pass

    return None


def parse_a1111_parameters(text: str) -> Dict[str, Any]:
    """
    Parse A1111/SD-WebUI style 'Parameters' block into a metadata dict.
    """
    result: Dict[str, Any] = {}
    if not isinstance(text, str):
        return result
    raw = text.strip()
    if not raw:
        return result

    lower = raw.lower()
    neg_tag = "negative prompt:"
    steps_tag = "steps:"

    pos = ""
    neg = ""
    params_section = ""

    idx_neg = lower.find(neg_tag)
    if idx_neg != -1:
        pos = raw[:idx_neg].strip()
        rest = raw[idx_neg + len(neg_tag) :].strip()
        lower_rest = rest.lower()
        idx_steps = lower_rest.find(steps_tag)
        if idx_steps != -1:
            neg = rest[:idx_steps].strip()
            params_section = rest[idx_steps:]
        else:
            neg = rest
    else:
        pos = raw
        idx_steps = lower.find(steps_tag)
        if idx_steps != -1:
            params_section = raw[idx_steps:]

    def split_tokens(s: str) -> List[str]:
        tokens: List[str] = []
        current: List[str] = []
        depth = 0
        in_quote = False
        escape = False
        for ch in s:
            if in_quote:
                current.append(ch)
                if escape:
                    escape = False
                    continue
                if ch == "\\":
                    escape = True
                elif ch == '"':
                    in_quote = False
            else:
                if ch == '"':
                    in_quote = True
                    current.append(ch)
                elif ch in "{[":
                    depth += 1
                    current.append(ch)
                elif ch in "}]":
                    depth = max(0, depth - 1)
                    current.append(ch)
                elif ch == "," and depth == 0:
                    tok = "".join(current).strip()
                    if tok:
                        tokens.append(tok)
                    current = []
                else:
                    current.append(ch)
        tok = "".join(current).strip()
        if tok:
            tokens.append(tok)
        return tokens

    def to_int(val: str) -> Optional[int]:
        try:
            return int(str(val).split()[0])
        except Exception:
            return None

    def to_float(val: str) -> Optional[float]:
        try:
            return float(str(val).split()[0])
        except Exception:
            return None

    tokens = split_tokens(params_section) if params_section else []
    hashes = None
    lora_hashes = None

    for tok in tokens:
        if ":" not in tok:
            continue
        key, value = tok.split(":", 1)
        k = key.strip().lower()
        v = value.strip()
        if not v:
            continue
        if k == "steps":
            result["steps"] = to_int(v)
        elif k == "sampler":
            result["sampler_name"] = v
        elif k in ("schedule type", "schedulertype", "scheduler"):
            result["scheduler"] = v
        elif k in ("cfg scale", "cfg"):
            result["cfg"] = to_float(v)
        elif k == "seed":
            result["seed"] = to_int(v)
        elif k == "size":
            if "x" in v.lower():
                parts = v.lower().split("x")
                try:
                    w = int(parts[0].strip())
                    h = int(parts[1].strip())
                    result["size"] = (w, h)
                except Exception:
                    pass
        elif k == "model":
            result["model"] = v
        elif k == "model hash":
            result["model_hash"] = v
        elif k == "denoising strength":
            result["denoising_strength"] = to_float(v)
        elif k == "hires upscale":
            result["hires_upscale"] = to_float(v)
        elif k == "hires steps":
            result["hires_steps"] = to_int(v)
        elif k == "hires upscaler":
            result["hires_upscaler"] = v
        elif k == "version":
            result["version"] = v
        elif k.startswith("hashes"):
            try:
                hashes = json.loads(v)
            except Exception:
                hashes = v
        elif k.startswith("lora hashes"):
            try:
                lora_hashes = json.loads(v)
            except Exception:
                lora_hashes = v

    if hashes is not None:
        result["hashes"] = hashes
    if lora_hashes is not None:
        result["lora_hashes"] = lora_hashes
    if pos:
        result["positive_prompt"] = pos.strip()
    if neg:
        result["negative_prompt"] = neg.strip()
    if raw:
        result["parameters_raw"] = raw

    # If nothing useful parsed, return empty
    if not any(k for k in result if k != "parameters_raw"):
        return {}
    return result


def _resolve_through_reroutes(
    prompt_graph: Dict[str, Any],
    node_id: Optional[str],
    input_name: str = "value",
    max_depth: int = 50
) -> Optional[str]:
    """
    Resolve ComfyUI graph indirections (Reroute, SetNode, GetNode) to find actual source node.

    ComfyUI workflows can use indirection nodes:
    - Reroute: Simple passthrough that redirects connections
    - SetNode/GetNode: Variable storage (Set stores, Get retrieves by name)
    - Primitive: Value nodes that may wrap other connections

    This function traverses the graph following these connections until it finds
    a concrete node (like KSampler, CLIPTextEncode, etc.) or hits max depth.

    Args:
        prompt_graph: ComfyUI prompt graph (dict of node_id -> node_data)
        node_id: Starting node ID to resolve from
        input_name: Which input field to follow (default "value" for Reroute)
        max_depth: Maximum traversal depth to prevent infinite loops (default 50)

    Returns:
        The resolved node ID (str) pointing to actual node, or None if unresolvable

    Example:
        >>> prompt = {"1": {"class_type": "Reroute", "inputs": {"value": ["2", 0]}},
        ...           "2": {"class_type": "KSampler", "inputs": {...}}}
        >>> _resolve_through_reroutes(prompt, "1")
        "2"  # Resolved through Reroute to KSampler

    Graph Traversal:
        Node 1 (GetNode "my_model")
          ↓
        Node 5 (SetNode "my_model" <- ["10", 0])
          ↓
        Node 10 (CheckpointLoaderSimple)  ← Final resolution
    """
    if node_id is None:
        return None

    visited = set()
    current_id = str(node_id)
    depth = 0

    while depth < max_depth and current_id not in visited:
        visited.add(current_id)
        node = prompt_graph.get(current_id)

        if not node:
            return current_id  # Node not found, return what we have

        node_type = str(node.get("class_type", "")).lower()

        # Reroute node: follows the input connection
        if node_type == "reroute":
            inputs = node.get("inputs", {}) or {}
            next_val = inputs.get("value") or inputs.get("input") or inputs.get("link")
            next_id = _extract_link_node_id(next_val)
            if next_id is None:
                return current_id
            current_id = next_id
            depth += 1
            continue

        # GetNode: resolves to the corresponding SetNode's input
        if node_type == "getnode" or "get" in node_type:
            inputs = node.get("inputs", {}) or {}
            # GetNode stores the variable name, find matching SetNode
            var_name = inputs.get("variable") or inputs.get("name") or inputs.get("key")
            if var_name:
                # Search for SetNode with same variable name
                for search_id, search_node in prompt_graph.items():
                    search_type = str(search_node.get("class_type", "")).lower()
                    if search_type == "setnode" or "set" in search_type:
                        search_inputs = search_node.get("inputs", {}) or {}
                        search_var = search_inputs.get("variable") or search_inputs.get("name") or search_inputs.get("key")
                        if search_var == var_name:
                            # Found matching SetNode, follow its input
                            value_input = search_inputs.get("value") or search_inputs.get("input")
                            next_id = _extract_link_node_id(value_input)
                            if next_id:
                                current_id = next_id
                                depth += 1
                                break
                else:
                    # No matching SetNode found
                    return current_id
                continue

        # SetNode: follow the input value
        if node_type == "setnode" or "set" in node_type:
            inputs = node.get("inputs", {}) or {}
            next_val = inputs.get("value") or inputs.get("input")
            next_id = _extract_link_node_id(next_val)
            if next_id is None:
                return current_id
            current_id = next_id
            depth += 1
            continue

        # Not a reroute/set/get node, this is the final node
        return current_id

    # Max depth reached or loop detected
    return current_id


def _extract_link_node_id(val: Any) -> Optional[str]:
    """
    Extract a node id from inputs shaped like:
    - ["node_id", output_idx]
    - [[ "node_id", output_idx ], ...]
    - str/int directly (graph stored only the id)
    """
    if isinstance(val, (str, int)):
        return str(val)
    if isinstance(val, tuple) and val and isinstance(val[0], (str, int)):
        return str(val[0])
    # cas ["5", 0]
    if isinstance(val, list) and len(val) >= 2 and isinstance(val[0], (str, int)):
        return str(val[0])

    # cas [[ "5", 0 ], ...]
    if (
        isinstance(val, list)
        and val
        and isinstance(val[0], list)
        and len(val[0]) >= 2
        and isinstance(val[0][0], (str, int))
    ):
        return str(val[0][0])

    return None


def _normalize_workflow_dict(wf: Dict[str, Any]) -> Dict[str, Any]:
    """
    Normalize a raw workflow to avoid ComfyUI loader errors.
    - force numeric version
    - add last_node_id / last_link_id / links if missing
    - convert node ids to int when possible
    """
    out = dict(wf) if isinstance(wf, dict) else {}

    # version
    try:
        out["version"] = int(out.get("version", 1))
    except Exception:
        out["version"] = 1

    # last_node_id / last_link_id
    try:
        out["last_node_id"] = int(out.get("last_node_id", 0))
    except Exception:
        out["last_node_id"] = 0
    try:
        out["last_link_id"] = int(out.get("last_link_id", 0))
    except Exception:
        out["last_link_id"] = 0

    # links: filtre et assainit
    clean_links: List[List[Any]] = []
    links_val = out.get("links")
    if isinstance(links_val, list):
        for link in links_val:
            if not isinstance(link, (list, tuple)):
                continue
            # pad to length 6
            link_list = list(link) + [None] * (6 - len(link))
            idv, from_node, from_slot, to_node, to_slot, ltype = link_list[:6]
            try:
                idv = int(idv)
            except Exception:
                continue
            try:
                from_node = int(from_node)
            except Exception:
                if from_node is None:
                    from_node = 0
            try:
                from_slot = int(from_slot)
            except Exception:
                from_slot = 0
            try:
                to_node = int(to_node)
            except Exception:
                if to_node is None:
                    to_node = 0
            try:
                to_slot = int(to_slot)
            except Exception:
                to_slot = 0
            ltype = ltype or "ANY"
            clean_links.append([idv, from_node, from_slot, to_node, to_slot, ltype])
    out["links"] = clean_links
    if clean_links:
        try:
            max_link = max(int(l[0]) for l in clean_links)
            out["last_link_id"] = max(out["last_link_id"], max_link)
        except Exception:
            pass

    # nodes
    nodes = out.get("nodes")
    if not isinstance(nodes, list):
        out["nodes"] = []
        return out

    norm_nodes: List[Dict[str, Any]] = []
    max_id = out["last_node_id"]
    for node in nodes:
        if not isinstance(node, dict):
            continue
        n = dict(node)
        nid = n.get("id")
        try:
            nid_int = int(nid)
            n["id"] = nid_int
            max_id = max(max_id, nid_int)
        except Exception:
            pass  # keep as-is
        # inputs: normalise en tableau attendu par le front
        inputs = n.get("inputs")
        if isinstance(inputs, dict):
            inputs_arr = []
            for iname, ival in inputs.items():
                inputs_arr.append({"name": iname, "type": "ANY", "value": ival})
            n["inputs"] = inputs_arr
        elif isinstance(inputs, list):
            n["inputs"] = inputs
        else:
            n["inputs"] = []
        # outputs: assure une liste
        if not isinstance(n.get("outputs"), list):
            n["outputs"] = [] if n.get("outputs") is None else n.get("outputs")
        norm_nodes.append(n)
    out["nodes"] = norm_nodes
    out["last_node_id"] = max_id
    return out


def load_prompt_graph_from_png(path: str | Path) -> Optional[Dict[str, Any]]:
    """
    Load the 'prompt' graph stored in ComfyUI PNG metadata.
    Also supports video containers (MP4/MOV/WEBM/MKV) via exiftool.
    """
    p = Path(path)
    if not p.exists():
        return None

    if p.suffix.lower() in {".mp4", ".mov", ".webm", ".mkv"}:
        pg, _ = _extract_json_from_video(p)
        return pg

    if Image is None:
        return None

    with Image.open(p) as img:
        info = getattr(img, "info", {}) or {}

    def _as_text(v: Any) -> Any:
        if isinstance(v, (bytes, bytearray)):
            try:
                return v.decode("utf-8", errors="replace")
            except Exception:
                return ""
        return v

    # 1) prompt au top-level
    prompt = _ensure_dict_from_json(_as_text(info.get("prompt")))
    if prompt is not None:
        # some dumps contain a list of nodes rather than a map
        if isinstance(prompt, list):
            prompt = _normalize_workflow_to_prompt_graph({"nodes": prompt})
        return prompt

    # 1bis) workflow au top-level
    wf_raw = _ensure_dict_from_json(_as_text(info.get("workflow")))
    if wf_raw is not None:
        pg = _normalize_workflow_to_prompt_graph(wf_raw)
        if pg:
            return pg

    # 1ter) extra_pnginfo containing workflow/prompt (common ComfyUI pattern)
    extra = _as_text(info.get("extra_pnginfo"))
    if isinstance(extra, str):
        try:
            extra = json.loads(extra)
        except Exception:
            extra = None
    if isinstance(extra, dict):
        prompt = _ensure_dict_from_json(_as_text(extra.get("prompt")))
        if prompt is not None:
            if isinstance(prompt, list):
                prompt = _normalize_workflow_to_prompt_graph({"nodes": prompt})
            return prompt
        wf_raw = _ensure_dict_from_json(_as_text(extra.get("workflow")))
        if wf_raw is not None:
            pg = _normalize_workflow_to_prompt_graph(wf_raw)
            if pg:
                return pg

    # 1quater) Additional common ComfyUI metadata fields
    # Check for workflow in 'workflow_json' field (used by some custom nodes)
    workflow_json = _as_text(info.get("workflow_json"))
    if workflow_json:
        wf = _ensure_dict_from_json(workflow_json)
        if isinstance(wf, dict) and wf.get("nodes"):
            pg = _normalize_workflow_to_prompt_graph(wf)
            if pg:
                return pg

    # Check for prompt in 'prompt_json' field
    prompt_json = _as_text(info.get("prompt_json"))
    if prompt_json:
        pr = _ensure_dict_from_json(prompt_json)
        if isinstance(pr, dict):
            first_val = next(iter(pr.values()), None)
            if isinstance(first_val, dict) and "inputs" in first_val and "class_type" in first_val:
                return pr

    # Check for 'workflow_api' field (used by some ComfyUI implementations)
    workflow_api = _as_text(info.get("workflow_api"))
    if workflow_api:
        wf = _ensure_dict_from_json(workflow_api)
        if isinstance(wf, dict) and "nodes" in wf:
            pg = _normalize_workflow_to_prompt_graph(wf)
            if pg:
                return pg

    # Helper to sniff prompt/workflow from a "Parameters" string (some tools stash JSON there)
    def _extract_from_parameters(val: Any) -> Optional[Dict[str, Any]]:
        if isinstance(val, dict):
            return val
        if isinstance(val, str):
            start = val.find("{")
            end = val.rfind("}")
            if start != -1 and end != -1 and end > start:
                try:
                    parsed = json.loads(val[start : end + 1])
                    if isinstance(parsed, dict):
                        return parsed
                except Exception:
                    return None
        return None

    def _maybe_prompt_from_payload(payload: Any) -> Optional[Dict[str, Any]]:
        if not isinstance(payload, dict):
            return None
        pr = _ensure_dict_from_json(payload.get("prompt"))
        if isinstance(pr, list):
            pr = _normalize_workflow_to_prompt_graph({"nodes": pr})
        if isinstance(pr, dict):
            return pr
        wf = _ensure_dict_from_json(payload.get("workflow"))
        if isinstance(wf, dict):
            return _normalize_workflow_to_prompt_graph(wf)
        if isinstance(payload.get("nodes"), list):
            return _normalize_workflow_to_prompt_graph(payload)
        # Raw prompt graph heuristic
        if any(isinstance(v, dict) and "inputs" in v for v in payload.values() if isinstance(v, dict)):
            return payload
        return None

    # 2) prompt dans extra_pnginfo (cas courant)
    extra = _as_text(info.get("extra_pnginfo"))
    if isinstance(extra, str):
        try:
            extra = json.loads(extra)
        except Exception:
            extra = None

    if isinstance(extra, dict):
        prompt = _ensure_dict_from_json(_as_text(extra.get("prompt")))
        if prompt is not None:
            if isinstance(prompt, list):
                prompt = _normalize_workflow_to_prompt_graph({"nodes": prompt})
            return prompt
        wf_raw = _ensure_dict_from_json(_as_text(extra.get("workflow")))
        if wf_raw is not None:
            pg = _normalize_workflow_to_prompt_graph(wf_raw)
            if pg:
                return pg
    if isinstance(extra, list):
        for item in extra:
            if not isinstance(item, dict):
                continue
            prompt = _ensure_dict_from_json(_as_text(item.get("prompt")))
            if prompt is not None:
                return prompt
            wf_raw = _ensure_dict_from_json(_as_text(item.get("workflow")))
            if wf_raw is not None:
                pg = _normalize_workflow_to_prompt_graph(wf_raw)
                if pg:
                    return pg
            maybe = _extract_from_parameters(item.get("parameters"))
            if maybe:
                pg = _maybe_prompt_from_payload(maybe)
                if pg:
                    return pg

    # 3) Parameters field (other tools)
    params_payload = _extract_from_parameters(_as_text(info.get("parameters")))
    if params_payload:
        pg = _maybe_prompt_from_payload(params_payload)
        if pg:
            return pg
    if isinstance(extra, dict):
        params_payload = _extract_from_parameters(_as_text(extra.get("parameters")))
        if params_payload:
            pg = _maybe_prompt_from_payload(params_payload)
            if pg:
                return pg

    # Extended scan for alternative fields (comment/parameters/etc.)
    prompt_alt, _ = _scan_png_info_for_generation(info)
    if prompt_alt:
        return prompt_alt

    # No usable prompt found -> stop here
    return None


def load_raw_workflow_from_png(path: str | Path) -> Optional[Dict[str, Any]]:
    """
    Retrieve the raw workflow (as exported by ComfyUI) if present in PNG metadata.
    Also supports video containers via exiftool.
    No normalization: return as-is so the frontend can load it.
    """
    p = Path(path)
    if not p.exists():
        return None

    if p.suffix.lower() in {".mp4", ".mov", ".webm", ".mkv"}:
        _, wf = _extract_json_from_video(p)
        return wf

    if Image is None:
        return None

    with Image.open(p) as img:
        info = getattr(img, "info", {}) or {}

    def _as_text(v: Any) -> Any:
        if isinstance(v, (bytes, bytearray)):
            try:
                return v.decode("utf-8", errors="replace")
            except Exception:
                return ""
        return v

    def _maybe_workflow(val: Any) -> Optional[Dict[str, Any]]:
        wf = _ensure_dict_from_json(val)
        if isinstance(wf, dict) and wf.get("nodes"):
            return wf
        return None

    def _extract_from_parameters(val: Any) -> Optional[Dict[str, Any]]:
        if isinstance(val, dict):
            return val if val.get("nodes") else None
        if isinstance(val, str):
            start = val.find("{")
            end = val.rfind("}")
            if start != -1 and end != -1 and end > start:
                try:
                    parsed = json.loads(val[start : end + 1])
                    if isinstance(parsed, dict) and parsed.get("nodes"):
                        return parsed
                except Exception:
                    return None
        return None

    # Top-level
    wf = _maybe_workflow(_as_text(info.get("workflow")))
    if wf:
        return wf

    extra = _as_text(info.get("extra_pnginfo"))
    if isinstance(extra, str):
        try:
            extra = json.loads(extra)
        except Exception:
            extra = None

    if isinstance(extra, dict):
        wf = _maybe_workflow(_as_text(extra.get("workflow")))
        if wf:
            return wf
        wf = _extract_from_parameters(_as_text(extra.get("parameters")))
        if wf:
            return wf
    if isinstance(extra, list):
        for item in extra:
            if not isinstance(item, dict):
                continue
            wf = _maybe_workflow(_as_text(item.get("workflow")))
            if wf:
                return wf
            wf = _extract_from_parameters(_as_text(item.get("parameters")))
            if wf:
                return wf

    wf = _extract_from_parameters(_as_text(info.get("parameters")))
    if wf:
        return wf
    wf_alt = _scan_png_info_for_generation(info)[1]
    return wf_alt


def _pick_sampler_node(prompt_graph: Dict[str, Any]) -> Optional[str]:
    """
    Select a single sampler-like node from the graph.
    Strategy (robust):
    1) Prefer nodes whose class_type matches known sampler classes
    2) If none found, fallback to heuristic scan for nodes exposing typical sampler inputs
    3) Deterministic pick: choose candidate with highest numeric id (or first non-numeric)
    """
    strong_candidates = []  # (node_id, is_int, val)
    heuristic_candidates = []  # (node_id, score)

    for node_id, node in prompt_graph.items():
        if not isinstance(node, dict):
            continue
        node_type = (node.get("class_type") or "").lower()
        inputs = node.get("inputs") or {}
        if not isinstance(inputs, dict):
            continue

        # Strong match: class_type is a known sampler
        if node_type in SAMPLER_CLASSES or "sampler" in node_type:
            try:
                int_id = int(node_id)
                strong_candidates.append((node_id, True, int_id))
            except:
                strong_candidates.append((node_id, False, 0))
        else:
            # Heuristic: check if node has sampler-like inputs (seed, steps, cfg, etc.)
            score = 0
            sampler_input_keys = ["seed", "steps", "cfg", "sampler_name", "scheduler"]
            for key in sampler_input_keys:
                if key in inputs:
                    score += 2  # exact match
                else:
                    # partial match (cfg_scale, step, etc.)
                    for inp_key in inputs.keys():
                        if key in str(inp_key).lower():
                            score += 1
                            break
            # If score >= 2, consider it a sampler-like node
            if score >= 2:
                heuristic_candidates.append((node_id, score))

    # Prefer strong candidates
    if strong_candidates:
        # Sort: integer IDs first (by value desc), then non-integer
        strong_candidates.sort(key=lambda x: (not x[1], -x[2] if x[1] else 0))
        return strong_candidates[0][0]

    # Fallback to heuristic candidates
    if heuristic_candidates:
        # Pick highest score, then highest numeric ID if tie
        heuristic_candidates.sort(key=lambda x: (-x[1], x[0]), reverse=False)
        # Try to convert to int for deterministic pick
        best_candidates = [c for c in heuristic_candidates if c[1] == heuristic_candidates[0][1]]
        int_candidates = []
        for node_id, score in best_candidates:
            try:
                int_candidates.append((node_id, int(node_id)))
            except:
                pass
        if int_candidates:
            int_candidates.sort(key=lambda x: -x[1])
            return int_candidates[0][0]
        return best_candidates[0][0]

    return None


def _trace_to_text_node(prompt_graph: Dict[str, Any], link_value: Any, max_depth: int = 5) -> Optional[str]:
    """
    Trace recursively through the graph following links (API format) to find text content.
    Handles: KSampler -> Conditioning -> CLIPTextEncode -> text

    Args:
        prompt_graph: Full prompt graph (API format)
        link_value: Link value from inputs (can be ["node_id", slot] or direct id)
        max_depth: Maximum recursion depth to prevent infinite loops

    Returns:
        Text string if found, None otherwise
    """
    if max_depth <= 0:
        return None

    # Extract node_id from link (handles ["5", 0] format)
    node_id = _extract_link_node_id(link_value)
    if node_id is None:
        return None

    node = prompt_graph.get(str(node_id))
    if not isinstance(node, dict):
        return None

    class_type = str(node.get("class_type", "")).lower()
    inputs = node.get("inputs", {})
    if not isinstance(inputs, dict):
        return None

    # Direct text node detection (CLIPTextEncode variants)
    text_node_keywords = [
        "cliptextencode", "clip_text_encode", "textencode",
        "cliptextencodeadvanced", "cliptextencodesdxl",
        "dualcliptextencodeflux", "t5textencode",
        "sd3textencoder", "promptbuilder", "stringliteral"
    ]

    is_text_node = any(kw in class_type for kw in text_node_keywords)

    if is_text_node:
        # Extract text from known fields
        for field in ("text", "text_g", "text_l", "prompt", "string", "value",
                      "content", "input_text", "clip_l", "clip_g", "t5xxl"):
            val = inputs.get(field)
            if isinstance(val, str) and val.strip():
                return val.strip()

    # Recursive tracing through intermediate nodes
    # Common patterns: ConditioningCombine, ConditioningSetArea, Reroute, etc.
    trace_fields = [
        "conditioning", "conditioning_1", "conditioning_2",  # ConditioningCombine
        "text", "clip", "conditioning_to",  # Various nodes
        "positive", "negative"  # Some custom nodes
    ]

    for field in trace_fields:
        if field in inputs:
            result = _trace_to_text_node(prompt_graph, inputs[field], max_depth - 1)
            if result:
                return result

    return None


def _trace_to_model_node(prompt_graph: Dict[str, Any], link_value: Any, max_depth: int = 5) -> Optional[str]:
    """
    Trace recursively to find model/checkpoint name.

    Args:
        prompt_graph: Full prompt graph
        link_value: Link value from inputs
        max_depth: Maximum recursion depth

    Returns:
        Model filename if found, None otherwise
    """
    if max_depth <= 0:
        return None

    node_id = _extract_link_node_id(link_value)
    if node_id is None:
        return None

    node = prompt_graph.get(str(node_id))
    if not isinstance(node, dict):
        return None

    class_type = str(node.get("class_type", ""))
    inputs = node.get("inputs", {})
    if not isinstance(inputs, dict):
        return None

    # Direct checkpoint loader detection
    if class_type in CHECKPOINT_LOADER_CLASSES:
        ckpt = inputs.get("ckpt_name") or inputs.get("ckpt_file")
        if isinstance(ckpt, str):
            return ckpt

    if class_type in UNET_LOADER_CLASSES:
        unet = inputs.get("unet_name") or inputs.get("model_name")
        if isinstance(unet, str):
            return unet

    # Recursive tracing through model chain (LoRA, etc.)
    if "model" in inputs:
        result = _trace_to_model_node(prompt_graph, inputs["model"], max_depth - 1)
        if result:
            return result

    return None


def _extract_clip_text(prompt_graph: Dict[str, Any], node_id: Optional[str]) -> Optional[str]:
    """
    Extract text from a text-encoder-like node (CLIP / SDXL / Flux, etc.).
    Keep it generic: look at fields 'text', 'text_g', 'text_l', and various custom node fields.

    ENHANCED: If the direct node doesn't contain text, uses recursive tracing to follow
    links and find text in connected nodes (API format link following).
    """
    if node_id is None:
        return None

    node = prompt_graph.get(str(node_id))
    if not node:
        return None

    inputs: Dict[str, Any] = node.get("inputs", {}) or {}

    texts: List[str] = []
    # Check standard fields and custom node variants
    for key in (
        "text", "text_g", "text_l", "prompt", "string", "value",
        "content", "input_text", "prompt_text", "clip_l", "clip_g", "t5xxl"
    ):
        v = inputs.get(key)
        if isinstance(v, str) and v.strip():
            texts.append(v.strip())

    if texts:
        # Direct text found
        return " | ".join(texts)

    # ENHANCED: No direct text found - try recursive tracing through links
    # This handles cases like: Conditioning -> CLIPTextEncode (API format)
    trace_result = _trace_to_text_node(prompt_graph, node_id)
    if trace_result:
        return trace_result

    return None


def _collect_all_texts(prompt_graph: Dict[str, Any]) -> Dict[str, List[str]]:
    """
    Collect all text present in potential nodes (encoders, various prompts).
    Try to separate positive/negative based on class_type/title.
    """
    pos_list: List[str] = []
    neg_list: List[str] = []

    for node_id, node in prompt_graph.items():
        if not isinstance(node, dict):
            continue
        ctype = str(node.get("class_type") or "").lower()
        title = str(node.get("title") or "").lower()
        inputs = node.get("inputs") or {}
        if not isinstance(inputs, dict):
            continue

        text_keywords = [
            # Core CLIP encoders
            "cliptextencode",
            "clip_text_encode",
            "textencode",
            "prompt",

            # Advanced CLIP encoders
            "bnk_cliptextencodeadvanced",
            "cliptextencodeadvanced",
            "clipsetlastlayer",
            "conditioningsetarea",
            "conditioningcombine",

            # SDXL / Flux / SD3 encoders
            "cliptextencodesdxl",
            "cliptextencodesdxlrefiner",
            "dualcliptextencodeflux",
            "fluxguidance",
            "sd3textencoder",
            "t5textencode",
            "llama",
            "qwen",
            "gpt",

            # Custom node text encoders
            "ellatextencode",
            "advancedcliptextencode",
            "promptbuilder",
            "stringliteral",
            "textconcat",
            "text_multiline",
            "dynamicprompt",
            "wildcardprocessor",
            "promptcomposer",

            # Multi-conditioning nodes
            "conditioningsetmask",
            "conditioningaverage",
            "conditioningconcat",

            # Generic text nodes
            "textencoder",
            "customtext",
            "text_node",
            "text",  # generic text node name
        ]
        is_text_node = any(kw in ctype for kw in text_keywords)

        # Fallback: some custom nodes don't advertise "text/prompt" in class_type but still
        # store usable prompt strings in common input fields. If any of those fields are
        # present as strings, treat the node as a text node.
        if not is_text_node:
            for _k in (
                "text", "text_g", "text_l", "prompt", "positive", "negative",
                "string", "value", "content", "input_text", "prompt_text",
                "caption", "description", "instruction"
            ):
                _v = inputs.get(_k)
                if isinstance(_v, str) and _v.strip():
                    is_text_node = True
                    break

        if not is_text_node:
            continue

        texts = []
        # Expanded field names for various custom nodes
        for key in (
            "text", "text_g", "text_l", "prompt", "positive", "negative",
            "string", "value", "content", "input_text", "prompt_text",
            "conditioning", "clip_l", "clip_g", "t5xxl"
        ):
            v = inputs.get(key)
            if isinstance(v, str) and v.strip():
                texts.append(v.strip())

        if not texts:
            continue

        is_neg = "negative" in title or "neg" in title or "negative" in ctype
        if is_neg:
            neg_list.extend(texts)
        else:
            pos_list.extend(texts)

    def _dedup(seq: List[str]) -> List[str]:
        out: List[str] = []
        seen = set()
        for x in seq:
            if x in seen:
                continue
            seen.add(x)
            out.append(x)
        return out

    return {"positive": _dedup(pos_list), "negative": _dedup(neg_list)}


def _walk_model_chain(
    prompt_graph: Dict[str, Any],
    start_id: Optional[str],
) -> Tuple[Optional[str], Optional[str], List[Dict[str, Any]]]:
    """
    Walk the 'model' chain from the sampler to collect:
    - model_name  : ckpt / diffusion model / unet
    - vae_name    : if present (CheckpointLoaderSimple)
    - loras       : list [{name, strength_model, strength_clip}, ...]

    Only follows the 'model' branch.
    """
    model_name: Optional[str] = None
    vae_name: Optional[str] = None
    loras: List[Dict[str, Any]] = []
    visited: Set[str] = set()

    current_id = str(start_id) if start_id is not None else None

    while current_id and current_id not in visited:
        visited.add(current_id)
        node = prompt_graph.get(current_id)
        if not node:
            break

        node_type = node.get("class_type")
        inputs: Dict[str, Any] = node.get("inputs", {}) or {}

        # --- Checkpoints ---
        if node_type in CHECKPOINT_LOADER_CLASSES:
            ckpt = inputs.get("ckpt_name") or inputs.get("ckpt_file")
            if isinstance(ckpt, str):
                model_name = ckpt
            vae = inputs.get("vae_name")
            if isinstance(vae, str):
                vae_name = vae
            break

        # --- UNET / Diffusion model loaders ---
        if node_type in UNET_LOADER_CLASSES:
            unet = inputs.get("unet_name") or inputs.get("model_name")
            if isinstance(unet, str):
                model_name = unet
            break

        if node_type in DIFFUSERS_LOADER_CLASSES:
            m = inputs.get("model_path") or inputs.get("model_name")
            if isinstance(m, str):
                model_name = m
            break

        # --- LoRA chain ---
        if node_type in LORA_CLASSES:
            lora_name = inputs.get("lora_name")
            if isinstance(lora_name, str):
                l_entry = {
                    "name": lora_name,
                    "strength_model": inputs.get("strength_model"),
                    "strength_clip": inputs.get("strength_clip"),
                }
                loras.append(l_entry)

            next_id = _extract_link_node_id(inputs.get("model"))
            # Resolve through reroutes/set/get nodes
            next_id = _resolve_through_reroutes(prompt_graph, next_id)
            if next_id is None:
                break
            current_id = next_id
            continue

        # --- Other links in the 'model' chain ---
        next_id = _extract_link_node_id(inputs.get("model"))
        # Resolve through reroutes/set/get nodes
        next_id = _resolve_through_reroutes(prompt_graph, next_id)
        if next_id is None:
            break
        current_id = next_id

    return model_name, vae_name, loras


def extract_generation_params_from_prompt_graph(
    prompt_graph: Dict[str, Any],
    raw_workflow: Optional[Dict[str, Any]] = None,
    *,
    reconstruct_allowed: bool = False,
) -> Dict[str, Any]:
    """
    Core extraction of generation parameters from a prompt graph (map id -> node).
    - `raw_workflow` can be supplied to return as-is.
    - if `reconstruct_allowed` is True and no workflow is provided, rebuild a minimal workflow.
    """
    if not prompt_graph:
        return {}

    sampler_id = _pick_sampler_node(prompt_graph)

    if sampler_id is None:
        collected = _collect_all_texts(prompt_graph)
        wf_fallback = None
        if isinstance(raw_workflow, dict):
            wf_fallback = raw_workflow
        elif reconstruct_allowed:
            wf_fallback = _prompt_graph_to_workflow(prompt_graph)
        return {
            "positive_prompt": " | ".join(collected.get("positive") or []),
            "negative_prompt": " | ".join(collected.get("negative") or []),
            "seed": None,
            "steps": None,
            "cfg": None,
            "sampler_name": None,
            "scheduler": None,
            "model": None,
            "vae": None,
            "loras": [],
            "workflow": wf_fallback,
        }

    sampler = prompt_graph.get(sampler_id, {})
    inputs: Dict[str, Any] = sampler.get("inputs", {}) or {}

    # seed / cfg / steps / sampler / scheduler / denoise / advanced params
    seed = inputs.get("seed") or inputs.get("noise_seed")
    cfg = (
        inputs.get("cfg")
        or inputs.get("cfg_scale")
        or inputs.get("guidance")
        or inputs.get("guidance_scale")
    )
    steps = inputs.get("steps")
    sampler_name = inputs.get("sampler_name") or inputs.get("sampler")
    scheduler = inputs.get("scheduler")
    denoise = inputs.get("denoise")

    # Advanced sampler parameters
    start_at_step = inputs.get("start_at_step")
    end_at_step = inputs.get("end_at_step")
    return_with_leftover_noise = inputs.get("return_with_leftover_noise")
    add_noise = inputs.get("add_noise")

    # Prompts - resolve through reroutes first
    pos_input = inputs.get("positive")
    neg_input = inputs.get("negative")
    pos_id = _extract_link_node_id(pos_input)
    neg_id = _extract_link_node_id(neg_input)

    # Resolve through reroute/set/get nodes
    pos_id = _resolve_through_reroutes(prompt_graph, pos_id)
    neg_id = _resolve_through_reroutes(prompt_graph, neg_id)

    if pos_id is None and isinstance(pos_input, str):
        positive_prompt = pos_input
    else:
        # Try direct extraction first, then recursive tracing
        positive_prompt = _extract_clip_text(prompt_graph, pos_id)
        if not positive_prompt and pos_input is not None:
            # ENHANCED: Direct trace from sampler's positive input (API format)
            positive_prompt = _trace_to_text_node(prompt_graph, pos_input)

    if neg_id is None and isinstance(neg_input, str):
        negative_prompt = neg_input
    else:
        # Try direct extraction first, then recursive tracing
        negative_prompt = _extract_clip_text(prompt_graph, neg_id)
        if not negative_prompt and neg_input is not None:
            # ENHANCED: Direct trace from sampler's negative input (API format)
            negative_prompt = _trace_to_text_node(prompt_graph, neg_input)

    # Fallback: collect any text nodes if prompts are missing
    if not positive_prompt or not negative_prompt:
        collected = _collect_all_texts(prompt_graph)
        if not positive_prompt and collected.get("positive"):
            positive_prompt = " | ".join(collected["positive"])
        if not negative_prompt and collected.get("negative"):
            negative_prompt = " | ".join(collected["negative"])

    # Model chain - resolve through reroutes first
    model_link_id = (
        _extract_link_node_id(inputs.get("model"))
        or _extract_link_node_id(inputs.get("guider"))
    )
    # Resolve through reroute/set/get nodes
    model_link_id = _resolve_through_reroutes(prompt_graph, model_link_id)

    # If the sampler doesn't expose a model link (common in some video pipelines),
    # fallback to any known model loader node in the graph.
    if model_link_id is None:
        loader_ids: List[str] = []
        for _nid, _node in prompt_graph.items():
            if not isinstance(_node, dict):
                continue
            _ctype = str(_node.get("class_type") or "")
            if _ctype in CHECKPOINT_LOADER_CLASSES or _ctype in UNET_LOADER_CLASSES:
                loader_ids.append(str(_nid))

        if loader_ids:
            def _id_score(_id: str) -> tuple[int, str]:
                try:
                    return (int(_id), _id)
                except Exception:
                    return (-1, _id)

            loader_ids.sort(key=_id_score)
            model_link_id = loader_ids[-1]

    model_name, vae_name, loras = _walk_model_chain(prompt_graph, model_link_id)

    reconstructed_from_prompt = False
    if isinstance(raw_workflow, dict):
        workflow = raw_workflow
    elif reconstruct_allowed:
        workflow = _prompt_graph_to_workflow(prompt_graph)
        reconstructed_from_prompt = workflow is not None
    else:
        workflow = None

    result = {
        "positive_prompt": positive_prompt,
        "negative_prompt": negative_prompt,
        "seed": seed,
        "steps": steps,
        "cfg": cfg,
        "sampler_name": sampler_name,
        "scheduler": scheduler,
        "denoise": denoise,
        "start_at_step": start_at_step,
        "end_at_step": end_at_step,
        "return_with_leftover_noise": return_with_leftover_noise,
        "add_noise": add_noise,
        "model": model_name,
        "vae": vae_name,
        "loras": loras,
        "workflow": workflow,
        "raw_workflow": raw_workflow if isinstance(raw_workflow, dict) else None,
        "prompt_graph": prompt_graph,
        "workflow_reconstructed": workflow if reconstructed_from_prompt else None,
        "has_workflow": True,  # prompt graph present => mark as available
    }
    return result


def extract_generation_params_from_workflow(workflow: Dict[str, Any]) -> Dict[str, Any]:
    """
    Variant that takes a raw ComfyUI workflow (dict with 'nodes': [...]).
    """
    prompt_graph = _normalize_workflow_to_prompt_graph(workflow)
    if prompt_graph is None:
        return {}
    return extract_generation_params_from_prompt_graph(
        prompt_graph, raw_workflow=workflow, reconstruct_allowed=False
    )


def _try_extract_from_history(prompt_id: str, debug: bool = False) -> Optional[Dict[str, Any]]:
    """
    Attempt to extract generation metadata from ComfyUI history using prompt_id.
    Returns prompt_graph dict if found, None otherwise.

    This is a best-effort fallback for files (MP4/WEBP) that don't embed metadata.
    """
    try:
        from server import PromptServer

        if not hasattr(PromptServer, 'instance'):
            if debug:
                from .logger import get_logger
                log = get_logger(__name__)
                log.debug("📁🔍 [Majoor] PromptServer.instance not available for history lookup")
            return None

        prompt_server = PromptServer.instance
        if not hasattr(prompt_server, 'prompt_queue'):
            if debug:
                from .logger import get_logger
                log = get_logger(__name__)
                log.debug("📁🔍 [Majoor] PromptServer.prompt_queue not available")
            return None

        # Get history for this prompt_id
        history = prompt_server.prompt_queue.get_history(prompt_id=prompt_id)
        if not history or prompt_id not in history:
            if debug:
                from .logger import get_logger
                log = get_logger(__name__)
                log.debug(f"📁🔍 [Majoor] No history found for prompt_id: {prompt_id}")
            return None

        prompt_data = history[prompt_id]
        if not isinstance(prompt_data, dict):
            return None

        # Extract prompt graph from history
        # History format: {prompt_id: {"prompt": {node_id: {...}}, ...}}
        prompt_graph = prompt_data.get("prompt")
        if prompt_graph and isinstance(prompt_graph, dict):
            if debug:
                from .logger import get_logger
                log = get_logger(__name__)
                log.debug(f"📁✅ [Majoor] Found prompt graph in history for {prompt_id} ({len(prompt_graph)} nodes)")
            return prompt_graph

        return None

    except Exception as e:
        if debug:
            from .logger import get_logger
            log = get_logger(__name__)
            log.debug(f"📁⚠️ [Majoor] History lookup failed for {prompt_id}: {e}")
        return None


def extract_generation_params_from_png(path: str | Path, *, debug: bool = False) -> Dict[str, Any]:
    """
    Read all generation info from a ComfyUI output.

    - If path is a video, read prompt/workflow directly from the container (no PNG sibling).
    - Read the 'prompt' graph from PNG metadata.
    - Choose a sampler (KSampler / SamplerCustom / WAN...).
    - Walk the 'model' chain and the positive/negative branches.
    """
    p = Path(path)

    original_ext = p.suffix.lower()

    if not p.exists():
        return {}

    # First, try the enhanced comprehensive extraction method
    try:
        from .metadata.enhanced_extraction import extract_comprehensive_metadata
        enhanced_result = extract_comprehensive_metadata(str(p))
        prompt_graph = enhanced_result.get("prompt_graph")
        raw_workflow = enhanced_result.get("workflow")

        # CRITICAL FIX: If we have workflow but no prompt_graph, try to normalize
        if raw_workflow and not prompt_graph:
            prompt_graph = _normalize_workflow_to_prompt_graph(raw_workflow)

            # If normalization failed, try EXIF fallback for prompt_graph
            if not prompt_graph and original_ext in {".webp", ".jpg", ".jpeg", ".tif", ".tiff"}:
                try:
                    from .metadata.exif_extraction import extract_comfyui_prompt_workflow_from_exif_fields
                    exif_prompt, exif_workflow, _ = extract_comfyui_prompt_workflow_from_exif_fields(str(p))
                    if exif_prompt:
                        prompt_graph = exif_prompt
                except:
                    pass

        if prompt_graph or raw_workflow:
            # If we found data with enhanced extraction, use it
            reconstruct_allowed = original_ext != ".png"

            # Use prompt_graph if available, otherwise try to construct from workflow
            graph_for_extraction = prompt_graph
            if not graph_for_extraction and raw_workflow:
                graph_for_extraction = _normalize_workflow_to_prompt_graph(raw_workflow) or {}

            result = extract_generation_params_from_prompt_graph(
                graph_for_extraction,
                raw_workflow=raw_workflow,
                reconstruct_allowed=reconstruct_allowed,
            )
            # Ensure has_workflow is properly set
            result["has_workflow"] = enhanced_result.get("has_workflow", False)
            result["metadata_sources"] = enhanced_result.get("metadata_sources", [])

            # Debug logging if enabled
            if debug and os.environ.get("MJR_DEBUG_METADATA", "0").lower() in ("1", "true", "yes", "on"):
                from .logger import get_logger
                log = get_logger(__name__)
                log.debug(f"📁🔍 [Majoor] Extracted params for {p.name}:")
                log.debug(f"  - has_workflow: {result.get('has_workflow')}")
                log.debug(f"  - has prompt_graph: {bool(prompt_graph)}")
                log.debug(f"  - has raw_workflow: {bool(raw_workflow)}")
                log.debug(f"  - has positive_prompt: {bool(result.get('positive_prompt'))}")
                log.debug(f"  - has seed: {result.get('seed') is not None}")
                log.debug(f"  - has model: {bool(result.get('model'))}")
                log.debug(f"  - sources: {result.get('metadata_sources')}")

            return result
    except ImportError:
        # Fallback to original method if enhanced extraction is not available
        pass

    raw_workflow = None
    prompt_graph = None

    if original_ext in {".mp4", ".mov", ".webm", ".mkv"}:
        prompt_graph, raw_workflow = _extract_json_from_video(p)
    else:
        raw_workflow = load_raw_workflow_from_png(p)
        prompt_graph = load_prompt_graph_from_png(p)

    # Try sidecar metadata and history lookup
    prompt_id_from_sidecar = None
    if prompt_graph is None and load_metadata is not None:
        try:
            side_meta = load_metadata(str(p))
            if isinstance(side_meta, dict):
                # Store prompt_id for potential history lookup
                prompt_id_from_sidecar = side_meta.get("prompt_id")

                prompt = _ensure_dict_from_json(side_meta.get("prompt"))
                if prompt is not None:
                    prompt_graph = prompt
                else:
                    wf_raw = _ensure_dict_from_json(side_meta.get("workflow"))
                    if wf_raw is not None:
                        prompt_graph = _normalize_workflow_to_prompt_graph(wf_raw)
                        if raw_workflow is None and isinstance(wf_raw, dict):
                            raw_workflow = wf_raw
        except Exception:
            prompt_graph = None

    # Sibling PNG fallback for video/WEBP files without embedded metadata
    if prompt_graph is None and original_ext in {".mp4", ".mov", ".webm", ".mkv", ".m4v", ".webp"}:
        try:
            stem = p.stem
            parent_dir = p.parent
            candidates = [
                f for f in parent_dir.iterdir()
                if f.is_file() and f.suffix.lower() == ".png" and (
                    f.stem == stem or f.stem.startswith(f"{stem}_") or f.stem.startswith(f"{stem}-")
                )
            ]

            if candidates:
                # Sort by modification time (most recent first)
                candidates.sort(key=lambda f: f.stat().st_mtime, reverse=True)
                # Try to extract from sibling PNG
                for png_sibling in candidates:
                    try:
                        png_prompt = load_prompt_graph_from_png(png_sibling)
                        if png_prompt:
                            prompt_graph = png_prompt
                            if raw_workflow is None:
                                raw_workflow = load_raw_workflow_from_png(png_sibling)
                            if debug:
                                log.debug(f"📁🔍 [Majoor] Using sibling PNG: {png_sibling.name}")
                            break
                    except Exception:
                        continue
        except Exception:
            pass

    # History lookup fallback for MP4/WEBP and other formats that may lack embedded metadata
    if prompt_graph is None and prompt_id_from_sidecar:
        # Determine if we should try history lookup
        allow_history = original_ext in {".mp4", ".mov", ".m4v", ".webm", ".mkv", ".webp", ".jpg", ".jpeg", ".avif"}

        # Allow override via environment variable
        if os.environ.get("MJR_META_ALLOW_HISTORY", "").lower() in ("1", "true", "yes", "on"):
            allow_history = True

        if allow_history:
            if debug:
                from .logger import get_logger
                log = get_logger(__name__)
                log.debug(f"📁🔍 [Majoor] Attempting history lookup for {p.name} with prompt_id={prompt_id_from_sidecar}")

            history_prompt_graph = _try_extract_from_history(prompt_id_from_sidecar, debug=debug)
            if history_prompt_graph:
                prompt_graph = history_prompt_graph
                if debug:
                    from .logger import get_logger
                    log = get_logger(__name__)
                    log.debug(f"📁✅ [Majoor] Successfully retrieved metadata from history for {p.name}")

    # Fallback: A1111/SD-WebUI Parameters block (no workflow)
    # Extended to support WEBP, JPG, TIFF in addition to PNG
    if prompt_graph is None and original_ext in {".png", ".webp", ".jpg", ".jpeg", ".tif", ".tiff"} and Image is not None:
        try:
            # Use the robust helper that checks both PNG info and EXIF
            params_val = _extract_parameters_from_image(p)

            if isinstance(params_val, str) and params_val.strip():
                parsed = parse_a1111_parameters(params_val)
                if parsed:
                    parsed.setdefault("has_workflow", False)
                    parsed.setdefault("source", "a1111_parameters")
                    # Add informational note
                    parsed.setdefault("metadata_notes", "Generation parameters detected (A1111-style), ComfyUI workflow not embedded")

                    # Log debug info if enabled
                    if debug or os.environ.get("MJR_DEBUG_METADATA", "").lower() in ("1", "true", "yes", "on"):
                        from .logger import get_logger
                        log = get_logger(__name__)
                        log.debug(f"📁✅ [Majoor] Extracted A1111 parameters from {original_ext} file: {p.name}")
                        log.debug(f"📁🔍 [Majoor]   - Positive prompt length: {len(parsed.get('positive_prompt', ''))}")
                        log.debug(f"📁🔍 [Majoor]   - Has seed: {parsed.get('seed') is not None}")
                        log.debug(f"📁🔍 [Majoor]   - Has steps: {parsed.get('steps') is not None}")

                    return parsed
        except Exception as e:
            if debug or os.environ.get("MJR_DEBUG_METADATA", "").lower() in ("1", "true", "yes", "on"):
                from .logger import get_logger
                log = get_logger(__name__)
                log.debug(f"📁⚠️ [Majoor] A1111 parameter extraction failed for {p.name}: {e}")

    if not prompt_graph:
        return {}

    reconstruct_allowed = original_ext != ".png"
    return extract_generation_params_from_prompt_graph(
        prompt_graph,
        raw_workflow=raw_workflow,
        reconstruct_allowed=reconstruct_allowed,
    )


def has_generation_workflow(path: str | Path) -> bool:
    """
    Lightweight presence check for generation workflow/prompt.
    Avoids reconstruction; just detects whether metadata contains a prompt/workflow.

    PATCH #3: Added sibling PNG fallback for WEBP files (like MP4).
    """
    p = Path(path)
    if not p.exists():
        return False

    # First, try the enhanced comprehensive extraction method
    try:
        from .metadata.enhanced_extraction import has_generation_workflow_enhanced
        if has_generation_workflow_enhanced(str(p)):
            return True
    except ImportError:
        # Fallback to original method if enhanced extraction is not available
        pass

    ext = p.suffix.lower()
    prompt_graph = None
    raw_workflow = None

    if ext in {".mp4", ".mov", ".webm", ".mkv"}:
        prompt_graph, raw_workflow = _extract_json_from_video(p)
    else:
        if ext not in IMAGE_EXTS:
            return False
        if Image is None or not p.exists():
            return False
        prompt_graph = None
        raw_workflow = None
        try:
            with Image.open(p) as img:
                info = getattr(img, "info", {}) or {}
            prompt_graph, raw_workflow = _scan_png_info_for_generation(info)
        except Exception:
            prompt_graph = None
            raw_workflow = None
        if not prompt_graph:
            prompt_graph = load_prompt_graph_from_png(p)
        if not raw_workflow:
            raw_workflow = load_raw_workflow_from_png(p)

    if prompt_graph or raw_workflow:
        return True

    if load_metadata is not None:
        try:
            side_meta = load_metadata(str(p))
            if isinstance(side_meta, dict):
                pr = _ensure_dict_from_json(side_meta.get("prompt"))
                wf = _ensure_dict_from_json(side_meta.get("workflow"))
                if (isinstance(pr, dict) and pr) or (isinstance(wf, dict) and wf):
                    return True
        except Exception:
            pass

    # PATCH #3: Sibling PNG fallback for WEBP/MP4 files
    # If this is a WEBP or video file without workflow, check for sibling PNG
    if ext in {".webp", ".mp4", ".mov", ".webm", ".mkv", ".m4v"}:
        try:
            stem = p.stem
            parent_dir = p.parent
            candidates = [
                f for f in parent_dir.iterdir()
                if f.is_file() and f.suffix.lower() == ".png" and (
                    f.stem == stem or f.stem.startswith(f"{stem}_") or f.stem.startswith(f"{stem}-")
                )
            ]

            if candidates:
                # Sort by modification time (most recent first)
                candidates.sort(key=lambda f: f.stat().st_mtime, reverse=True)
                # Check if any sibling PNG has workflow
                for png_sibling in candidates:
                    if has_generation_workflow(png_sibling):
                        return True
        except Exception:
            pass

    return False
