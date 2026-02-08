"""
GenInfo parser (backend-first).

Goal: deterministically extract generation parameters from a ComfyUI prompt-graph
without "guessing" across unrelated nodes.
"""

from __future__ import annotations

import os
from collections import deque
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Set, Tuple

from ...shared import Result, get_logger

logger = get_logger(__name__)

DEFAULT_MAX_GRAPH_NODES = int(os.environ.get("MJR_MAX_GRAPH_NODES", "5000"))
DEFAULT_MAX_LINK_NODES = int(os.environ.get("MJR_MAX_LINK_NODES", "200"))
DEFAULT_MAX_GRAPH_DEPTH = int(os.environ.get("MJR_MAX_GRAPH_DEPTH", "100"))


SINK_CLASS_TYPES: Set[str] = {
    "saveimage",
    "saveimagewebsocket",
    "previewimage",
    "vhs_savevideo",
    "vhs_videocombine",
    "saveanimatedwebp",
    "savegif",
    "savevideo",
    "saveaudio",
    "save_audio",
    "vhs_saveaudio",
}


def _sink_priority(node: Dict[str, Any], node_id: Optional[str] = None) -> Tuple[int, int, int]:
    """
    Rank sinks so we pick the "real" output when multiple sinks exist.

    Video graphs often contain both PreviewImage and SaveVideo; PreviewImage can be
    attached to intermediate nodes and does not reliably reflect the final render.
    """
    ct = _lower(_node_type(node))
    
    # Group 0: Video Sinks (Explicit & Heuristic)
    if ct in ("savevideo", "vhs_savevideo", "vhs_videocombine") or (("save" in ct) and ("video" in ct)):
        group = 0
    # Group 1: Audio Sinks
    elif ct in ("saveaudio", "save_audio", "vhs_saveaudio") or (("save" in ct) and ("audio" in ct)):
        group = 1
    # Group 2: Image/Gif Sinks (Explicit & Heuristic)
    elif ct in ("saveimage", "saveimagewebsocket", "saveanimatedwebp", "savegif") or (("save" in ct) and ("image" in ct)):
        group = 2
    # Group 3: Preview
    elif ct == "previewimage" or "preview" in ct:
        group = 3
    # Group 4: Fallback
    else:
        group = 4

    # Within group: prefer sinks that consume `images` (common for image outputs)
    try:
        has_images = 0 if _is_link(_inputs(node).get("images")) else 1
    except Exception:
        has_images = 1
    
    # Tie-breaker: prefer higher node IDs (likely added later / final output)
    try:
        nid_score = -int(node_id) if node_id is not None else 0
    except Exception:
        nid_score = 0
        
    prio = (group, has_images, nid_score)
    # print(f"DEBUG: Sink {node_id} priority {prio}")
    return prio

_MODEL_EXTS: Tuple[str, ...] = (
    ".safetensors",
    ".ckpt",
    ".pt",
    ".pth",
    ".bin",
    ".gguf",
    ".json",
)


def _clean_model_id(value: Any) -> Optional[str]:
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    s = s.replace("\\", "/")
    s = s.split("/")[-1]
    lower = s.lower()
    for ext in _MODEL_EXTS:
        if lower.endswith(ext):
            return s[: -len(ext)]
    return s


def _to_int(value: Any) -> Optional[int]:
    try:
        if value is None:
            return None
        return int(value)
    except Exception:
        return None


def _looks_like_node_id(value: Any) -> bool:
    """
    Prompt-graph link node ids are usually integers, but some exporters encode ids like
    "57:35" (multi-part numeric ids). Accept only digit-or-digit+colon patterns.
    """
    if value is None:
        return False
    if isinstance(value, int):
        return True
    if not isinstance(value, str):
        return False
    s = value.strip()
    if not s:
        return False
    parts = s.split(":")
    return all(p.isdigit() for p in parts if p != "")


def _is_link(value: Any) -> bool:
    if not isinstance(value, (list, tuple)) or len(value) != 2:
        return False
    a, b = value[0], value[1]
    return _looks_like_node_id(a) and _to_int(b) is not None


def _resolve_link(value: Any) -> Optional[Tuple[str, int]]:
    if not _is_link(value):
        return None
    a, b = value[0], value[1]
    return str(a).strip(), int(_to_int(b) or 0)


def _node_type(node: Any) -> str:
    if not isinstance(node, dict):
        return ""
    return str(node.get("class_type") or node.get("type") or "")


def _inputs(node: Any) -> Dict[str, Any]:
    if not isinstance(node, dict):
        return {}
    ins = node.get("inputs")
    return ins if isinstance(ins, dict) else {}


def _lower(s: Any) -> str:
    return str(s or "").lower()

def _looks_like_prompt_string(value: Any) -> bool:
    """
    Conservative heuristic: accept human-ish prompt strings; reject numbers/gibberish.
    """
    if not isinstance(value, str):
        return False
    s = value.strip()
    if not s:
        return False
    if len(s) < 6:
        return False
    # Reject numeric-only payloads (common for some nodes that also have `text`).
    if all(ch.isdigit() or ch.isspace() or ch in ".,+-" for ch in s):
        return False
    # Reject control-heavy strings (binary-ish).
    bad = sum(1 for ch in s if ord(ch) < 9)
    if bad > 0:
        return False
    # Require at least one letter (unicode-aware).
    if not any(ch.isalpha() for ch in s):
        return False
    return True


def _is_reroute(node: Dict[str, Any]) -> bool:
    ct = _lower(_node_type(node))
    return ct == "reroute" or "reroute" in ct


def _walk_passthrough(
    nodes_by_id: Dict[str, Dict[str, Any]],
    start_link: Any,
    max_hops: int = 50,
) -> Optional[str]:
    """
    Follow link through obvious pass-through nodes (Reroute).
    Returns the final source node id (string) or None.
    """
    link = _resolve_link(start_link)
    if not link:
        return None
    node_id, _ = link
    hops = 0
    while hops < max_hops:
        hops += 1
        node = nodes_by_id.get(node_id)
        if not isinstance(node, dict):
            return node_id
        if not _is_reroute(node):
            return node_id
        ins = _inputs(node)
        # Reroute nodes typically have a single link input.
        next_link = None
        for v in ins.values():
            if _is_link(v):
                next_link = v
                break
        if not next_link:
            return node_id
        resolved = _resolve_link(next_link)
        if not resolved:
            return node_id
        node_id, _ = resolved
    return node_id


@dataclass(frozen=True)
class _Field:
    value: Any
    confidence: str
    source: str


def _field(value: Any, confidence: str, source: str) -> Optional[Dict[str, Any]]:
    if value is None or value == "":
        return None
    return {"value": value, "confidence": confidence, "source": source}


def _field_name(name: Any, confidence: str, source: str) -> Optional[Dict[str, Any]]:
    if not name:
        return None
    return {"name": name, "confidence": confidence, "source": source}


def _field_size(width: Any, height: Any, confidence: str, source: str) -> Optional[Dict[str, Any]]:
    if width is None or height is None:
        return None
    return {"width": width, "height": height, "confidence": confidence, "source": source}


def _pick_sink_inputs(node: Dict[str, Any]) -> Optional[Any]:
    ins = _inputs(node)
    preferred = ["audio", "audios", "waveform", "images", "image", "frames", "video", "samples", "latent", "latent_image"]
    for k in preferred:
        v = ins.get(k)
        if _is_link(v):
            return v
    for v in ins.values():
        if _is_link(v):
            return v
    return None


def _find_candidate_sinks(nodes_by_id: Dict[str, Dict[str, Any]]) -> List[str]:
    sinks: List[str] = []
    for node_id, node in nodes_by_id.items():
        ct = _lower(_node_type(node))
        if ct in SINK_CLASS_TYPES:
            sinks.append(node_id)
            continue
            
        # Heuristic for custom save nodes (e.g. WAS, Impact, CR, etc)
        # Must contain "save" or "preview" AND media hint
        if ("save" in ct or "preview" in ct) and ("image" in ct or "video" in ct or "audio" in ct):
            sinks.append(node_id)
            continue
            
    return sinks


def _collect_upstream_nodes(
    nodes_by_id: Dict[str, Dict[str, Any]],
    start_node_id: str,
    max_nodes: int = DEFAULT_MAX_GRAPH_NODES,
    max_depth: int = DEFAULT_MAX_GRAPH_DEPTH
) -> Dict[str, int]:
    """
    BFS upstream from a node id, returning node->distance.

    Args:
        nodes_by_id: Dictionary of node_id -> node data
        start_node_id: Starting node for traversal
        max_nodes: Maximum number of nodes to visit
        max_depth: Maximum depth to traverse (prevents DoS)
    """
    dist: Dict[str, int] = {}
    q: deque[Tuple[str, int]] = deque([(start_node_id, 0)])

    while q and len(dist) < max_nodes:
        nid, d = q.popleft()

        # Depth limit check
        if d > max_depth:
            continue

        if nid in dist:
            continue
        dist[nid] = d

        node = nodes_by_id.get(nid)
        if not isinstance(node, dict):
            continue

        for v in _inputs(node).values():
            if not _is_link(v):
                continue
            resolved = _resolve_link(v)
            if not resolved:
                continue
            src_id, _ = resolved
            q.append((src_id, d + 1))
    return dist


def _is_sampler(node: Dict[str, Any]) -> bool:
    """
    Return True for sampler-like nodes that represent the core diffusion step.

    Historically this was only "KSampler*", but video/custom stacks (e.g. Wan) use
    different sampler node names while still providing sampler parameters.
    """
    ct = _lower(_node_type(node))
    if not ct:
        return False
    # KSamplerSelect is a sampler selector node, not a diffusion sampler.
    if "ksampler" in ct and "select" in ct:
        return False
    if "ksampler" in ct:
        return True
    if "iterativelatentupscale" in ct:
        return True
    # Marigold depth estimation (acts as sampler for depth maps)
    if "marigold" in ct:
        return True
    # Kijai Flux inference sampler
    if "flux" in ct and ("sampler" in ct or "params" in ct):
        return True
    
    # Generic "Flux" nodes that act as samplers (e.g. "Flux2")
    if ct == "flux2" or "flux_2" in ct:
        return True

    # Generic detection: any node with (steps + cfg + seed) is likely a sampler
    try:
        ins = _inputs(node)
        has_steps = ins.get("steps") is not None
        has_cfg = ins.get("cfg") is not None or ins.get("cfg_scale") is not None or ins.get("guidance") is not None
        has_seed = ins.get("seed") is not None or ins.get("noise_seed") is not None
        if has_steps and has_cfg and has_seed:
            return True
    except Exception:
        pass

    # WanVideoSampler / custom samplers
    if ("sampler" in ct) and ("select" not in ct) and ("ksamplerselect" not in ct):
        try:
            ins = _inputs(node)
            # Avoid matching unrelated nodes that happen to contain "sampler" in their name.
            if _is_link(ins.get("model")):
                return True
            # Require at least one real sampling parameter (not just "sampler_name" selector nodes).
            for k in ("steps", "cfg", "cfg_scale", "seed", "scheduler", "denoise"):
                if ins.get(k) is not None:
                    return True
            # Wan samplers often take `text_embeds` rather than conditioning.
            if _is_link(ins.get("text_embeds")) or _is_link(ins.get("hyvid_embeds")):
                return True
        except (TypeError, ValueError, KeyError):
            return False
    return False


def _is_advanced_sampler(node: Dict[str, Any]) -> bool:
    """
    Flux/SD3 pipelines can use SamplerCustomAdvanced which orchestrates multiple nodes:
    - noise -> RandomNoise(noise_seed)
    - sigmas -> BasicScheduler(steps/scheduler/denoise/model)
    - sampler -> KSamplerSelect(sampler_name)
    - guider -> BasicGuider(conditioning/model)
    """
    ct = _lower(_node_type(node))
    if not ct:
        return False
    if "samplercustom" in ct:
        return True
    try:
        ins = _inputs(node)
        # Heuristic: orchestration sampler has these link inputs.
        # Strict check for all 4 caused issues with custom nodes that auto-provide noise/sampler.
        # "guider" + "sigmas" is the defining signature of the advanced decoupled interaction.
        if _is_link(ins.get("guider")) and _is_link(ins.get("sigmas")):
            return True
        # Also accept guider + sampler interaction (common if sigmas handled internally or named differently)
        if _is_link(ins.get("guider")) and _is_link(ins.get("sampler")):
            return True
        keys = ("noise", "guider", "sampler", "sigmas")
        return all(_is_link(ins.get(k)) for k in keys)
    except (TypeError, ValueError, KeyError):
        return False


def _extract_posneg_from_text_embeds(
    nodes_by_id: Dict[str, Dict[str, Any]], text_embeds_link: Any
) -> Tuple[Optional[Tuple[str, str]], Optional[Tuple[str, str]]]:
    """
    Wan/video stacks often encode prompts into "text_embeds" via nodes like
    WanVideoTextEncode which keep positive/negative as plain string inputs.
    """
    src_id = _walk_passthrough(nodes_by_id, text_embeds_link)
    if not src_id:
        return None, None
    node = nodes_by_id.get(src_id)
    if not isinstance(node, dict):
        return None, None
    ins = _inputs(node)

    def _get_str(*keys: str) -> Optional[str]:
        for k in keys:
            v = ins.get(k)
            if isinstance(v, str) and v.strip():
                return v.strip()
        return None

    # WanVideoTextEncode uses 'positive_prompt'/'negative_prompt'
    # HyVideoTextEncode uses 'prompt'
    pos = _get_str("positive", "prompt", "text", "text_g", "text_l", "positive_prompt")
    neg = _get_str("negative", "negative_prompt")

    pos_val = (pos, f"{_node_type(node)}:{src_id}") if pos else None
    neg_val = (neg, f"{_node_type(node)}:{src_id}") if neg else None
    return pos_val, neg_val


def _select_primary_sampler(
    nodes_by_id: Dict[str, Dict[str, Any]], sink_node_id: str
) -> Tuple[Optional[str], str]:
    sink = nodes_by_id.get(sink_node_id)
    if not isinstance(sink, dict):
        return None, "none"
    start_link = _pick_sink_inputs(sink)
    start_src = _walk_passthrough(nodes_by_id, start_link) if start_link else None
    if not start_src:
        return None, "none"
    dist = _collect_upstream_nodes(nodes_by_id, start_src)
    samplers: List[Tuple[str, int]] = []
    for nid, d in dist.items():
        node = nodes_by_id.get(nid)
        if not isinstance(node, dict):
            continue
        if _is_sampler(node):
            samplers.append((nid, d))
    if not samplers:
        return None, "none"
    samplers.sort(key=lambda x: x[1])
    best_depth = samplers[0][1]
    best = [nid for nid, d in samplers if d == best_depth]
    if len(best) == 1:
        return best[0], "high"
    # Ambiguous: multiple samplers equally close to sink
    return best[0], "medium"


def _select_advanced_sampler(
    nodes_by_id: Dict[str, Dict[str, Any]], sink_node_id: str
) -> Tuple[Optional[str], str]:
    sink = nodes_by_id.get(sink_node_id)
    if not isinstance(sink, dict):
        return None, "none"
    start_link = _pick_sink_inputs(sink)
    start_src = _walk_passthrough(nodes_by_id, start_link) if start_link else None
    if not start_src:
        return None, "none"
    dist = _collect_upstream_nodes(nodes_by_id, start_src)
    candidates: List[Tuple[str, int]] = []
    for nid, d in dist.items():
        node = nodes_by_id.get(nid)
        if not isinstance(node, dict):
            continue
        if _is_advanced_sampler(node):
            candidates.append((nid, d))
    if not candidates:
        return None, "none"
    candidates.sort(key=lambda x: x[1])
    best_depth = candidates[0][1]
    best = [nid for nid, d in candidates if d == best_depth]
    if len(best) == 1:
        return best[0], "high"
    return best[0], "medium"


def _select_any_sampler(nodes_by_id: Dict[str, Dict[str, Any]]) -> Tuple[Optional[str], str]:
    """
    Last resort when sinks exist but are not linked to the generation branch.
    Choose the "best" sampler-like node in the whole prompt graph.
    """
    candidates: List[Tuple[int, int, str]] = []
    for nid, node in nodes_by_id.items():
        if not isinstance(node, dict):
            continue
        if not _is_sampler(node):
            continue
        ins = _inputs(node)
        score = 0
        if _is_link(ins.get("model")):
            score += 3
        if _is_link(ins.get("positive")) or _is_link(ins.get("text_embeds")):
            score += 3
        for k in ("steps", "cfg", "cfg_scale", "seed", "denoise", "scheduler"):
            if ins.get(k) is not None:
                score += 1
        # Prefer numeric node ids (stable ordering).
        try:
            n_int = int(nid)
        except Exception:
            n_int = 10**9
        candidates.append((-score, n_int, nid))
    if not candidates:
        return None, "none"
    candidates.sort()
    return candidates[0][2], "low"


def _trace_sampler_name(nodes_by_id: Dict[str, Dict[str, Any]], link: Any) -> Optional[Tuple[str, str]]:
    src_id = _walk_passthrough(nodes_by_id, link)
    if not src_id:
        return None
    node = nodes_by_id.get(src_id)
    if not isinstance(node, dict):
        return None
    ins = _inputs(node)
    val = _scalar(ins.get("sampler_name")) or _scalar(ins.get("sampler"))
    if val is None:
        return None
    return str(val), f"{_node_type(node)}:{src_id}"


def _trace_noise_seed(nodes_by_id: Dict[str, Dict[str, Any]], link: Any) -> Optional[Tuple[Any, str]]:
    src_id = _walk_passthrough(nodes_by_id, link)
    if not src_id:
        return None
    node = nodes_by_id.get(src_id)
    if not isinstance(node, dict):
        return None
    ins = _inputs(node)
    for k in ("noise_seed", "seed", "value", "int", "number"):
        v = _scalar(ins.get(k))
        if v is not None:
            return v, f"{_node_type(node)}:{src_id}"
    return None


def _trace_scheduler_sigmas(
    nodes_by_id: Dict[str, Dict[str, Any]], link: Any
) -> Tuple[Optional[Any], Optional[Any], Optional[Any], Optional[Any], Optional[Tuple[str, str]], Optional[str]]:
    """
    For advanced sampler pipelines, `sigmas` points to a scheduler node that carries steps/scheduler/denoise
    and sometimes a `model` link.
    """
    src_id = _walk_passthrough(nodes_by_id, link)
    if not src_id:
        return (None, None, None, None, None, None)
    node = nodes_by_id.get(src_id)
    if not isinstance(node, dict):
        return (None, None, None, None, None, None)
    ins = _inputs(node)
    steps = _scalar(ins.get("steps"))
    steps_confidence: Optional[str] = "high" if steps is not None else None
    if steps is None:
        # Some video workflows use manual sigma schedules (e.g. ManualSigmas) instead of an explicit `steps` field.
        # Best-effort: count the comma-separated values and treat it as (steps + 1).
        try:
            sigmas = ins.get("sigmas")
            if isinstance(sigmas, str) and sigmas.strip():
                raw_parts = [p.strip() for p in sigmas.replace("\n", " ").split(",")]
                parts = [p for p in raw_parts if p]
                # Ensure these are numeric-ish to avoid accidentally treating random strings as step schedules.
                numeric = 0
                for p in parts:
                    try:
                        float(p)
                        numeric += 1
                    except Exception:
                        pass
                if numeric >= 2:
                    steps = max(1, numeric - 1)
                    steps_confidence = "low"
        except Exception:
            pass
    scheduler = _scalar(ins.get("scheduler"))
    denoise = _scalar(ins.get("denoise"))
    model_link = ins.get("model") if _is_link(ins.get("model")) else None
    src = f"{_node_type(node)}:{src_id}"
    return (steps, scheduler, denoise, model_link, (src_id, src), steps_confidence)


def _trace_guidance_from_conditioning(nodes_by_id: Dict[str, Dict[str, Any]], conditioning_link: Any) -> Optional[Tuple[Any, str]]:
    start_id = _walk_passthrough(nodes_by_id, conditioning_link)
    if not start_id:
        return None
    dist = _collect_upstream_nodes(nodes_by_id, start_id)
    for nid, d in sorted(dist.items(), key=lambda x: x[1]):
        node = nodes_by_id.get(nid)
        if not isinstance(node, dict):
            continue
        ins = _inputs(node)
        for k in ("guidance", "cfg", "cfg_scale"):
            v = _scalar(ins.get(k))
            if v is not None:
                return v, f"{_node_type(node)}:{nid}"
    return None


def _scalar(value: Any) -> Optional[Any]:
    if value is None:
        return None
    if isinstance(value, (int, float, str)):
        return value
    return None


def _extract_ksampler_widget_params(node: Dict[str, Any]) -> Dict[str, Any]:
    """
    Fallback extraction for KSampler values stored in LiteGraph `widgets_values`.
    Common order:
      [seed, control_after_generate, steps, cfg, sampler_name, scheduler, denoise]
    """
    out: Dict[str, Any] = {}
    if not isinstance(node, dict):
        return out
    ct = _lower(_node_type(node))
    if "ksampler" not in ct:
        return out
    widgets = node.get("widgets_values")
    if not isinstance(widgets, list):
        return out
    try:
        if len(widgets) > 0:
            out["seed"] = widgets[0]
        if len(widgets) > 2:
            out["steps"] = widgets[2]
        if len(widgets) > 3:
            out["cfg"] = widgets[3]
        if len(widgets) > 4:
            out["sampler_name"] = widgets[4]
        if len(widgets) > 5:
            out["scheduler"] = widgets[5]
        if len(widgets) > 6:
            out["denoise"] = widgets[6]
    except Exception:
        return {}
    return out


def _extract_lyrics_from_prompt_nodes(nodes_by_id: Dict[str, Dict[str, Any]]) -> Tuple[Optional[str], Optional[Any], Optional[str]]:
    """
    Best-effort lyrics extraction for audio text-encode nodes (AceStep-like nodes).
    Returns: (lyrics, lyrics_strength, source)
    """
    for nid, node in nodes_by_id.items():
        if not isinstance(node, dict):
            continue
        ct = _lower(_node_type(node))
        if "textencode" not in ct and "lyrics" not in ct:
            continue
        ins = _inputs(node)

        lyrics = None
        for key in ("lyrics", "lyric", "lyric_text", "text_lyrics"):
            v = ins.get(key)
            if isinstance(v, str) and v.strip():
                lyrics = v.strip()
                break

        strength = None
        for key in ("lyrics_strength", "lyric_strength"):
            v = _scalar(ins.get(key))
            if v is not None:
                strength = v
                break

        widgets = node.get("widgets_values")
        if isinstance(widgets, list):
            # AceStep: widgets_values[0]=tags, [1]=lyrics, [2]=lyrics_strength
            if not lyrics and len(widgets) > 1 and isinstance(widgets[1], str) and widgets[1].strip():
                lyrics = widgets[1].strip()
            if strength is None and len(widgets) > 2:
                strength = _scalar(widgets[2])

        if isinstance(lyrics, str) and lyrics.strip():
            return lyrics, strength, f"{_node_type(node)}:{nid}"
    return None, None, None


def _resolve_scalar_from_link(nodes_by_id: Dict[str, Dict[str, Any]], value: Any) -> Optional[Any]:
    src_id = _walk_passthrough(nodes_by_id, value)
    if not src_id:
        return None
    node = nodes_by_id.get(src_id)
    if not isinstance(node, dict):
        return None
    ins = _inputs(node)
    for k in (
        "seed", "value", "number", "int", "float", "text",
        "string", "prompt", "input", "text_a", "text_b"
    ):
        v = ins.get(k)
        s = _scalar(v)
        if s is not None:
            return s
    return None


def _extract_text(nodes_by_id: Dict[str, Dict[str, Any]], link: Any) -> Optional[Tuple[str, str]]:
    node_id = _walk_passthrough(nodes_by_id, link)
    if not node_id:
        return None
    node = nodes_by_id.get(node_id)
    if not isinstance(node, dict):
        return None
    ins = _inputs(node)
    # Text-encode nodes vary: SDXL often uses text_g/text_l, some nodes use "prompt".
    candidates: List[str] = []
    for key in ("text", "prompt", "text_g", "text_l"):
        v = ins.get(key)
        if isinstance(v, str) and v.strip():
            candidates.append(v.strip())
    if candidates:
        return "\n".join(candidates), f"{_node_type(node)}:{node_id}"
    return None


def _looks_like_text_encoder(node: Dict[str, Any]) -> bool:
    """
    Conservative signal: a node that has textual inputs AND a linked `clip` input.
    This avoids "guessing" prompts from unrelated nodes.
    """
    try:
        ins = _inputs(node)
        if not _is_link(ins.get("clip")):
            return False
        for key in ("text", "prompt", "text_g", "text_l", "instruction"):
            v = ins.get(key)
            if isinstance(v, str) and v.strip():
                return True
            if _is_link(v):
                return True
        return False
    except Exception:
        return False


def _looks_like_conditioning_text(node: Dict[str, Any]) -> bool:
    """
    Some custom nodes output CONDITIONING directly without an explicit `clip` link
    but still store the prompt text in a `text`/`prompt` field. Only accept nodes
    that look clearly related to conditioning/prompt generation.
    """
    try:
        ct = _lower(_node_type(node))
        if "conditioning" not in ct and "prompt" not in ct and "textencode" not in ct:
            return False
        ins = _inputs(node)
        for key in ("text", "prompt", "text_g", "text_l", "instruction"):
            v = ins.get(key)
            if _looks_like_prompt_string(v):
                return True
            if _is_link(v):
                return True
        return False
    except Exception:
        return False


def _collect_text_encoder_nodes_from_conditioning(
    nodes_by_id: Dict[str, Dict[str, Any]],
    start_link: Any,
    max_nodes: int = DEFAULT_MAX_LINK_NODES,
    max_depth: int = DEFAULT_MAX_GRAPH_DEPTH,
    branch: Optional[str] = None
) -> List[str]:
    """
    DFS upstream from a conditioning link, collecting "text-encoder-like" node ids.
    Traversal expands only through nodes that look like conditioning composition or
    reroute-ish passthrough nodes.

    Args:
        nodes_by_id: Node dictionary
        start_link: Starting link to trace
        max_nodes: Maximum nodes to visit
        max_depth: Maximum traversal depth
        branch: Optional branch hint ("positive" or "negative")
    """
    start_id = _walk_passthrough(nodes_by_id, start_link)
    if not start_id:
        return []

    visited: Set[str] = set()
    stack: List[Tuple[str, int]] = [(start_id, 0)]
    found: List[str] = []

    def _should_expand(node: Dict[str, Any]) -> bool:
        ct = _lower(_node_type(node))
        # Negative "ConditioningZeroOut" chains don't represent a user-authored negative prompt.
        # Avoid surfacing the positive prompt as the negative prompt when a graph uses
        # ConditioningZeroOut to satisfy a required negative input.
        if branch == "negative" and "conditioningzeroout" in ct:
            return False
            
        # Optimization: Pass through Area Setters transparently
        if "conditioningsetarea" in ct:
            return True
            
        if _is_reroute(node):
            return True
        if "conditioning" in ct:
            return True
        ins = _inputs(node)
        if any("conditioning" in str(k).lower() for k in ins.keys()):
            return True
        # Some pipelines (e.g. Wan/VHS wrappers) pass conditioning through nodes that
        # expose `positive` / `negative` links but aren't named "Conditioning*".
        try:
            if branch in ("positive", "negative") and _is_link(ins.get(branch)):
                return True
            if _is_link(ins.get("positive")) or _is_link(ins.get("negative")):
                return True
        except (TypeError, ValueError, KeyError):
            return False
        return False

    while stack and len(visited) < max_nodes:
        nid, depth = stack.pop()

        # Enforce depth limit
        if depth > max_depth:
            continue

        if nid in visited:
            continue
        visited.add(nid)
        node = nodes_by_id.get(nid)
        if not isinstance(node, dict):
            continue

        if _looks_like_text_encoder(node):
            found.append(nid)
            continue
        if _looks_like_conditioning_text(node):
            found.append(nid)
            continue

        if not _should_expand(node):
            continue

        ins = _inputs(node)

        # If the caller requested a branch ("positive"/"negative") and this node has that
        # explicit input, follow only that path to avoid mixing pos/neg prompts.
        if branch in ("positive", "negative") and _is_link(ins.get(branch)):
            v = ins.get(branch)
            src_id = _walk_passthrough(nodes_by_id, v)
            if src_id and src_id not in visited:
                stack.append((src_id, depth + 1))
            continue

        for k, v in ins.items():
            k_s = str(k).lower()
            if branch == "positive" and (k_s in ("negative", "neg", "negative_prompt") or k_s.startswith("negative_")):
                continue
            if branch == "negative" and (k_s in ("positive", "pos", "positive_prompt") or k_s.startswith("positive_")):
                continue

            if _is_link(v):
                src_id = _walk_passthrough(nodes_by_id, v)
                if src_id and src_id not in visited:
                    stack.append((src_id, depth + 1))

    # Stable ordering: node id is usually numeric
    def _nid_key(x: str) -> Tuple[int, str]:
        try:
            return int(x), x
        except Exception:
            return 10**9, x

    found.sort(key=_nid_key)
    return found


def _collect_texts_from_conditioning(
    nodes_by_id: Dict[str, Dict[str, Any]], start_link: Any, max_nodes: int = DEFAULT_MAX_LINK_NODES, branch: Optional[str] = None
) -> List[Tuple[str, str]]:
    """
    Collect prompt text fragments from a conditioning link, returning (text, source).
    Deterministic order; never invents text when none is present.
    """
    node_ids = _collect_text_encoder_nodes_from_conditioning(nodes_by_id, start_link, max_nodes=max_nodes, branch=branch)
    out: List[Tuple[str, str]] = []
    for nid in node_ids:
        node = nodes_by_id.get(nid)
        if not isinstance(node, dict):
            continue
        ins = _inputs(node)
        candidates: List[str] = []
        for key in ("text", "prompt", "text_g", "text_l", "instruction"):
            v = ins.get(key)
            if isinstance(v, str) and v.strip():
                candidates.append(v.strip())
            elif _is_link(v):
                resolved = _resolve_scalar_from_link(nodes_by_id, v)
                if _looks_like_prompt_string(resolved):
                    candidates.append(str(resolved).strip())
        if candidates:
            out.append(("\n".join(candidates), f"{_node_type(node)}:{nid}"))
    return out


def _trace_model_chain(
    nodes_by_id: Dict[str, Dict[str, Any]], model_link: Any, confidence: str
) -> Tuple[Dict[str, Dict[str, Any]], List[Dict[str, Any]]]:
    loras: List[Dict[str, Any]] = []
    models: Dict[str, Dict[str, Any]] = {}

    current_link = model_link
    hops = 0
    while current_link is not None and hops < 80:
        hops += 1
        node_id = _walk_passthrough(nodes_by_id, current_link)
        if not node_id:
            break
        node = nodes_by_id.get(node_id)
        if not isinstance(node, dict):
            break
        ct = _lower(_node_type(node))
        ins = _inputs(node)


        def _first_model_string() -> Optional[str]:
            for k in (
                "ckpt_name",
                "checkpoint",
                "checkpoint_name",
                "model_name",
                "model",
                "diffusion_name",
                "diffusion",
                "diffusion_model",
                "unet_name",
                "unet",
            ):
                v = ins.get(k)
                if isinstance(v, str) and v.strip():
                    return v.strip()
            # Last resort: scan for any model-like filename.
            for v in ins.values():
                if not isinstance(v, str):
                    continue
                s = v.strip()
                if not s:
                    continue
                lower_s = s.lower().replace("\\", "/")
                if any(lower_s.endswith(ext) for ext in _MODEL_EXTS):
                    return s
            return None

        # Some custom LoRA loader nodes do not contain "lora" in their class_type,
        # but expose `lora_name` + a linked `model` input. Treat these as LoRA loaders.
        if ("lora" in ct) or (ins.get("lora_name") is not None and _is_link(ins.get("model"))):
            # rgthree "Power Lora Loader" stores multiple LoRAs under lora_1/lora_2/...
            # objects instead of a flat `lora_name`.
            for k, v in ins.items():
                if not str(k).lower().startswith("lora_"):
                    continue
                if not isinstance(v, dict):
                    continue
                enabled = v.get("on")
                if enabled is False:
                    continue
                name = _clean_model_id(v.get("lora") or v.get("lora_name") or v.get("name"))
                if not name:
                    continue
                strength = v.get("strength") or v.get("strength_model") or v.get("weight") or v.get("lora_strength")
                loras.append(
                    {
                        "name": name,
                        "strength_model": strength,
                        "strength_clip": v.get("strength_clip") or v.get("clip_strength"),
                        "confidence": confidence,
                        "source": f"{_node_type(node)}:{node_id}:{k}",
                    }
                )

            name = _clean_model_id(ins.get("lora_name") or ins.get("lora") or ins.get("name"))
            if name:
                strength_model = ins.get("strength_model") or ins.get("strength") or ins.get("weight") or ins.get("lora_strength")
                strength_clip = ins.get("strength_clip") or ins.get("clip_strength")
                loras.append(
                    {
                        "name": name,
                        "strength_model": strength_model,
                        "strength_clip": strength_clip,
                        "confidence": confidence,
                        "source": f"{_node_type(node)}:{node_id}",
                    }
                )

            # If this node is LoRA-ish but didn't yield any LoRA entries, still follow the chain.
            current_link = ins.get("model") if _is_link(ins.get("model")) else None
            if current_link is not None:
                continue
            # No model link to follow; stop here.
            break

        # Model sampling / patch nodes are common in video stacks (e.g. ModelSamplingSD3).
        # They typically just transform a model object; follow their `model` input.
        if ("modelsampling" in ct or "model_sampling" in ct) and _is_link(ins.get("model")):
            current_link = ins.get("model")
            continue

        # Common diffusion model loaders (video stacks, gguf, unet-only, etc.)
        if (
            "loaddiffusionmodel" in ct
            or "diffusionmodel" in ct
            or "unetloader" in ct
            or "loadunet" in ct
            or "unet" == ct
            or "videomodel" in ct # Helper for LTX/Wan video models
        ):
            unet = _clean_model_id(ins.get("unet_name") or ins.get("unet"))
            diffusion = _clean_model_id(ins.get("diffusion_name") or ins.get("diffusion") or ins.get("model_name") or ins.get("ckpt_name") or ins.get("model"))
            if unet and "unet" not in models:
                models["unet"] = {"name": unet, "confidence": confidence, "source": f"{_node_type(node)}:{node_id}"}
            if diffusion and "diffusion" not in models:
                models["diffusion"] = {"name": diffusion, "confidence": confidence, "source": f"{_node_type(node)}:{node_id}"}
            next_model = ins.get("model")
            if _is_link(next_model):
                current_link = next_model
                continue
            break

        # Generic "model loader" style custom nodes (e.g. WanVideoModelLoader) often expose
        # only a model path/identifier without "ckpt_name" naming.
        if (
            "modelloader" in ct 
            or "model_loader" in ct 
            or "model-loader" in ct
            or "ltxvideomodel" in ct
            or "wanvideomodel" in ct
            or "hyvideomodel" in ct
            or "cogvideomodel" in ct
        ):
            raw = _first_model_string()
            name = _clean_model_id(raw)
            if name:
                # Many video wrappers use a single diffusion model file; map it to checkpoint.
                models.setdefault(
                    "checkpoint",
                    {"name": name, "confidence": confidence, "source": f"{_node_type(node)}:{node_id}"},
                )
            break

        is_checkpoint_loader = any(
            s in ct
            for s in (
                "checkpointloader",
                "checkpoint_loader",
                "loadcheckpoint",
                "load_checkpoint",
            )
        )
        if is_checkpoint_loader or ins.get("ckpt_name") is not None:
            ckpt = _clean_model_id(ins.get("ckpt_name") or ins.get("model_name"))
            if ckpt:
                models.setdefault(
                    "checkpoint",
                    {"name": ckpt, "confidence": confidence, "source": f"{_node_type(node)}:{node_id}"},
                )
            break

        # Some graphs insert generic "switch"/"selector" nodes in the model chain (e.g. rgthree).
        # Follow the single upstream link when present to reach the actual loader node.
        if ("switch" in ct or "selector" in ct) and not _is_link(ins.get("model")):
            links = [v for v in ins.values() if _is_link(v)]
            if len(links) == 1:
                current_link = links[0]
                continue

        # Heuristic: if the node exposes a model-like filename, record it as checkpoint.
        raw = _first_model_string()
        name = _clean_model_id(raw)
        if name and "checkpoint" not in models:
            models["checkpoint"] = {"name": name, "confidence": confidence, "source": f"{_node_type(node)}:{node_id}"}

        # Generic model passthrough
        next_model = ins.get("model")
        if _is_link(next_model):
            current_link = next_model
            continue
        break

    return models, loras


def _trace_named_loader(nodes_by_id: Dict[str, Dict[str, Any]], link: Any, keys: Tuple[str, ...], confidence: str) -> Optional[Dict[str, Any]]:
    current_link = link
    hops = 0
    while current_link is not None and hops < 80:
        hops += 1
        node_id = _walk_passthrough(nodes_by_id, current_link)
        if not node_id:
            return None
        node = nodes_by_id.get(node_id)
        if not isinstance(node, dict):
            return None
        ins = _inputs(node)
        # Special case: DualCLIPLoader-style nodes expose clip_name1/clip_name2.
        if "clip_name1" in keys and "clip_name2" in keys:
            c1 = _clean_model_id(ins.get("clip_name1"))
            c2 = _clean_model_id(ins.get("clip_name2"))
            if c1 and c2:
                return {
                    "name": f"{c1} + {c2}",
                    "confidence": confidence,
                    "source": f"{_node_type(node)}:{node_id}",
                }
        for k in keys:
            name = _clean_model_id(ins.get(k))
            if name:
                return {"name": name, "confidence": confidence, "source": f"{_node_type(node)}:{node_id}"}
        next_link = ins.get("clip") if _is_link(ins.get("clip")) else None
        if _is_link(next_link):
            current_link = next_link
            continue
        next_link = ins.get("vae") if _is_link(ins.get("vae")) else None
        if _is_link(next_link):
            current_link = next_link
            continue
        next_link = ins.get("model") if _is_link(ins.get("model")) else None
        if _is_link(next_link):
            current_link = next_link
            continue
        return None
    return None


def _trace_vae_from_sink(nodes_by_id: Dict[str, Dict[str, Any]], sink_start_id: str, confidence: str) -> Optional[Dict[str, Any]]:
    dist = _collect_upstream_nodes(nodes_by_id, sink_start_id)
    candidates: List[Tuple[str, int]] = []
    for nid, d in dist.items():
        node = nodes_by_id.get(nid)
        if not isinstance(node, dict):
            continue
        ct = _lower(_node_type(node))
        if "vaedecode" in ct:
            candidates.append((nid, d))
    if not candidates:
        return None
    candidates.sort(key=lambda x: x[1])
    node_id = candidates[0][0]
    node = nodes_by_id.get(node_id) or {}
    ins = _inputs(node)
    if _is_link(ins.get("vae")):
        return _trace_named_loader(nodes_by_id, ins.get("vae"), ("vae_name", "name"), confidence)
    return None


def _trace_clip_from_text_encoder(nodes_by_id: Dict[str, Dict[str, Any]], encoder_link: Any, confidence: str) -> Optional[Dict[str, Any]]:
    encoder_id = _walk_passthrough(nodes_by_id, encoder_link)
    if encoder_id:
        node = nodes_by_id.get(encoder_id)
        if isinstance(node, dict) and _is_link(_inputs(node).get("clip")):
            return _trace_named_loader(
                nodes_by_id,
                _inputs(node).get("clip"),
                ("clip_name", "clip_name1", "clip_name2", "clip_name_l", "clip_name_g", "name"),
                confidence,
            )

    # Fallback: encoder_link might point to a Conditioning* node; collect upstream encoders.
    encoders = _collect_text_encoder_nodes_from_conditioning(nodes_by_id, encoder_link, branch="positive")
    if not encoders:
        return None
    node = nodes_by_id.get(encoders[0])
    if not isinstance(node, dict):
        return None
    clip_link = _inputs(node).get("clip")
    if not _is_link(clip_link):
        return None
    return _trace_named_loader(
        nodes_by_id, clip_link, ("clip_name", "clip_name1", "clip_name2", "clip_name_l", "clip_name_g", "name"), confidence
    )


def _trace_clip_skip(nodes_by_id: Dict[str, Dict[str, Any]], clip_link: Any, confidence: str) -> Optional[Dict[str, Any]]:
    current_link = clip_link
    hops = 0
    while current_link is not None and hops < 60:
        hops += 1
        node_id = _walk_passthrough(nodes_by_id, current_link)
        if not node_id:
            return None
        node = nodes_by_id.get(node_id)
        if not isinstance(node, dict):
            return None
        ct = _lower(_node_type(node))
        ins = _inputs(node)
        if "clipsetlastlayer" in ct or "clipsetlastlayer" in ct.replace("_", ""):
            val = ins.get("stop_at_clip_layer") or ins.get("clip_stop_at_layer") or ins.get("clip_skip")
            v = _scalar(val)
            return _field(v, confidence, f"{_node_type(node)}:{node_id}")
        next_clip = ins.get("clip")
        if _is_link(next_clip):
            current_link = next_clip
            continue
        return None
    return None


def _trace_size(nodes_by_id: Dict[str, Dict[str, Any]], latent_link: Any, confidence: str) -> Optional[Dict[str, Any]]:
    current_link = latent_link
    hops = 0
    while current_link is not None and hops < 80:
        hops += 1
        node_id = _walk_passthrough(nodes_by_id, current_link)
        if not node_id:
            return None
        node = nodes_by_id.get(node_id)
        if not isinstance(node, dict):
            return None
        ct = _lower(_node_type(node))
        ins = _inputs(node)

        if "emptylatentimage" in ct:
            w = _scalar(ins.get("width"))
            h = _scalar(ins.get("height"))
            return _field_size(w, h, confidence, f"{_node_type(node)}:{node_id}")

        # Common resize/upscale latent nodes can carry explicit width/height
        w = _scalar(ins.get("width"))
        h = _scalar(ins.get("height"))
        if w is not None and h is not None:
            return _field_size(w, h, confidence, f"{_node_type(node)}:{node_id}")

        # Pass-through along latent/sample link
        for key in ("samples", "latent", "latent_image", "image"):
            v = ins.get(key)
            if _is_link(v):
                current_link = v
                break
        else:
            return None
    return None


def _trace_guidance_value(nodes_by_id: Dict[str, Dict[str, Any]], start_link: Any, max_hops: int = 15) -> Optional[Tuple[float, str]]:
    """
    Traverse conditioning chain upstream to find a node providing 'guidance' (Flux).
    """
    start_id = _walk_passthrough(nodes_by_id, start_link)
    if not start_id:
        return None

    # stack: (node_id, depth)
    stack = [(start_id, 0)]
    visited = set()

    while stack:
        nid, depth = stack.pop()
        if nid in visited or depth > max_hops:
            continue
        visited.add(nid)
        
        node = nodes_by_id.get(nid)
        if not isinstance(node, dict):
            continue
            
        ins = _inputs(node)
        # Check if this node has guidance
        g_val = _scalar(ins.get("guidance"))
        if g_val is not None:
             return float(g_val), f"{_node_type(node)}:{nid}"
             
        # Traverse upstream
        ct = _lower(_node_type(node))
        should_expand = False
        
        if _is_reroute(node):
            should_expand = True
        elif "conditioning" in ct or "guider" in ct or "flux" in ct:
            should_expand = True
        elif any("conditioning" in str(k).lower() for k in ins.keys()):
            should_expand = True
            
        if should_expand:
            # Add conditioning sources to stack
            for k, v in ins.items():
                if "conditioning" in str(k).lower() and _is_link(v):
                     src = _walk_passthrough(nodes_by_id, v)
                     if src and src not in visited:
                         stack.append((src, depth + 1))
    return None


def _extract_workflow_metadata(workflow: Any) -> Dict[str, Any]:
    meta = {}
    if isinstance(workflow, dict):
        extra = workflow.get("extra", {})
        if isinstance(extra, dict):
            for k in ("title", "author", "license", "version", "description"):
                if extra.get(k):
                    meta[k] = str(extra[k]).strip()
    return meta



def _detect_input_role(nodes_by_id: Dict[str, Any], subject_node_id: str) -> str:
    """
    Determine how an input node is used (e.g. 'first_frame', 'last_frame', 'reference', 
    'control_video', 'control_image', 'mask/inpaint', 'source', 'style', 'depth').
    Performs a limited-depth BFS downstream to handle intermediate nodes (Resize, VAE, etc).
    """
    roles = set()
    frontier = {str(subject_node_id)}
    visited = {str(subject_node_id)}
    
    # Also check the subject node's title for hints (e.g. "FIRST_FRAME", "LAST_FRAME")
    subject = nodes_by_id.get(str(subject_node_id)) or nodes_by_id.get(subject_node_id)
    if isinstance(subject, dict):
        title = _lower(subject.get("_meta", {}).get("title", "") or subject.get("title", ""))
        filename = ""
        ins = _inputs(subject)
        filename = _lower(str(ins.get("image", "") or ins.get("video", "") or ""))
        
        # Check title/filename for first/last frame hints
        if "first" in title or "first" in filename or "start" in title:
            roles.add("first_frame")
        if "last" in title or "last" in filename or "end" in title:
            roles.add("last_frame")
        if "control" in title:
            roles.add("control")
        if "mask" in title or "inpaint" in title:
            roles.add("mask/inpaint")
        if "depth" in title:
            roles.add("depth")
        if "reference" in title or "ref" in title or "style" in title:
            roles.add("style/reference")
    
    # Limit depth to avoid infinite loops or massive fan-out
    for _ in range(8): 
        if not frontier: break
        next_frontier = set()
        
        for nid, node in nodes_by_id.items():
            if str(nid) in visited: continue 
            if not isinstance(node, dict): continue
            
            # Check if 'node' inputs from 'frontier'
            ins = _inputs(node)
            linked = False
            hit_input_name = ""
            
            for k, v in ins.items():
                if _is_link(v):
                    src_id, _ = _resolve_link(v)
                    if str(src_id) in frontier:
                        linked = True
                        hit_input_name = str(k).lower()
                        break
            
            if linked:
                # Found a consumer
                target_type = _lower(_node_type(node))
                title = _lower(node.get("_meta", {}).get("title", "") or node.get("title", ""))
                
                # 1. High specific roles
                if "ipadapter" in target_type:
                    roles.add("style/reference")
                elif "controlnet" in target_type:
                    if subject and _lower(_node_type(subject)).find("video") >= 0:
                        roles.add("control_video")
                    else:
                        roles.add("control_image")
                elif "mask" in hit_input_name or "mask" in target_type or "inpaint" in target_type:
                    roles.add("mask/inpaint")
                elif "depth" in target_type or "depth" in hit_input_name:
                    roles.add("depth")
                
                # 2. Video-specific nodes (WAN VACE, AnimateDiff, etc.)
                elif "vace" in target_type or "wanvace" in target_type:
                    # VACE uses control video/image for video generation
                    if "control" in hit_input_name or "reference" in hit_input_name:
                        roles.add("control_video")
                    elif "start" in hit_input_name or "first" in hit_input_name:
                        roles.add("first_frame")
                    elif "end" in hit_input_name or "last" in hit_input_name:
                        roles.add("last_frame")
                    else:
                        roles.add("source")
                        
                elif "starttoend" in target_type or "framerange" in target_type:
                    # Nodes like WanVideoVACEStartToEndFrame
                    if "start" in hit_input_name or "first" in hit_input_name:
                        roles.add("first_frame")
                    elif "end" in hit_input_name or "last" in hit_input_name:
                        roles.add("last_frame")
                    else:
                        # Check if the input connects to start_image or end_image
                        roles.add("frame_range")
                
                # 3. Frame position detection
                elif "first" in hit_input_name or "start" in hit_input_name:
                    roles.add("first_frame")
                elif "last" in hit_input_name or "end" in hit_input_name:
                    roles.add("last_frame")
                elif "img2vid" in target_type or "i2v" in target_type:
                    roles.add("source")

                # 4. VAE Encode -> likely source material (I2I/I2V)
                elif "vaeencode" in target_type:
                    roles.add("source")
                
                # 5. If connected directly to sampler input (rare for images)
                elif "sampler" in target_type:
                     if "image" in hit_input_name or "latent" in hit_input_name:
                         roles.add("source")
                
                else:
                    # Unknown/Intermediate node (Resize, Upscale, etc.)
                    # Add to frontier to trace what IT connects to
                    next_frontier.add(str(nid))
                    
        visited.update(next_frontier)
        frontier = next_frontier

    # Priority resolution (more specific roles first)
    if "first_frame" in roles: return "first_frame"
    if "last_frame" in roles: return "last_frame"
    if "mask/inpaint" in roles: return "mask/inpaint"
    if "depth" in roles: return "depth"
    if "control_video" in roles: return "control_video"
    if "control_image" in roles: return "control_image"
    if "control" in roles: return "control"
    if "source" in roles: return "source"
    if "style/reference" in roles: return "style/reference"
    if "frame_range" in roles: return "frame_range"
    
    return "input" # Default - generic input


def _extract_input_files(nodes_by_id: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Extract input file references (LoadImage/LoadVideo/LoadAudio, etc) with usage context.
    """
    inputs = []
    seen = set()
    
    for nid, node in nodes_by_id.items():
        if not isinstance(node, dict):
            continue
            
        ntype = _lower(_node_type(node))
        ntype_clean = ntype.replace(" ", "").replace("_", "").replace("-", "")
        
        # Standard input nodes (robust to spacing/naming variations)
        is_image_load = "loadimage" in ntype_clean or "imageloader" in ntype_clean or "inputimage" in ntype_clean
        is_video_load = "loadvideo" in ntype_clean or "videoloader" in ntype_clean or "inputvideo" in ntype_clean
        is_audio_load = "loadaudio" in ntype_clean or "audioloader" in ntype_clean or "inputaudio" in ntype_clean
        
        # Also check for known specific nodes like LTX or IPAdapter that might not match above
        if "ipadapter" in ntype_clean and "image" in ntype_clean:
            is_image_load = True

        if is_image_load or is_video_load or is_audio_load:
            ins = _inputs(node)
            
            # 1. API Format inputs (broadened search for file/path keys)
            filename = (
                ins.get("image") or ins.get("video") or ins.get("filename") or 
                ins.get("audio") or ins.get("file") or ins.get("media_source") or ins.get("path") or
                ins.get("image_path") or ins.get("video_path") or ins.get("audio_path")
            )
            
            # 2. Workflow Format widgets_values (Heuristic)
            if not filename:
                widgets = node.get("widgets_values")
                if isinstance(widgets, list) and len(widgets) > 0:
                    # Some nodes put the file at index 0, others index 1 (like "upload" switch)
                    # Iterate to find the first string that looks like a file path
                    for w in widgets:
                        if isinstance(w, str) and (
                            "." in w or "/" in w or "\\" in w
                        ):
                             # Exclude simple extensions selection like "format: png"
                             if len(w) > 4: 
                                filename = w
                                break

            if isinstance(filename, str) and filename:
                # Deduplicate by (filename, subfolder, type)
                subfolder = ins.get("subfolder", "") or ""
                key = (filename, str(subfolder), ntype)
                
                if key not in seen:
                    seen.add(key)
                    # Determine role
                    usage = _detect_input_role(nodes_by_id, nid)
                    
                    inputs.append({
                        "filename": filename,
                        "subfolder": subfolder,
                        "type": "audio" if is_audio_load else ("video" if is_video_load else "image"),
                        "node_id": nid,
                        "folder_type": ins.get("type", "input"),
                        "role": usage
                    })
    
    return inputs


def _collect_all_prompts_from_sinks(
    nodes_by_id: Dict[str, Any],
    sinks: List[str],
    max_sinks: int = 20
) -> Tuple[List[str], List[str]]:
    """
    Collect all distinct positive and negative prompts from multiple sinks.
    
    For multi-output workflows (like batch generation with different prompts),
    this gathers all unique prompts to show the user what variants were generated.
    
    Returns:
        (all_positive_prompts, all_negative_prompts) - deduplicated lists
    """
    all_positive: List[str] = []
    all_negative: List[str] = []
    seen_pos: Set[str] = set()
    seen_neg: Set[str] = set()
    
    for sink_id in sinks[:max_sinks]:
        try:
            # Try primary sampler first
            sampler_id, _ = _select_primary_sampler(nodes_by_id, sink_id)
            if not sampler_id:
                sampler_id, _ = _select_advanced_sampler(nodes_by_id, sink_id)
            if not sampler_id:
                continue
                
            sampler_node = nodes_by_id.get(sampler_id)
            if not isinstance(sampler_node, dict):
                continue
            
            ins = _inputs(sampler_node)
            
            # Extract positive prompt
            if _is_link(ins.get("positive")):
                items = _collect_texts_from_conditioning(nodes_by_id, ins.get("positive"), branch="positive")
                for text, _ in items:
                    t = text.strip()
                    if t and t not in seen_pos:
                        seen_pos.add(t)
                        all_positive.append(t)
            
            # Extract negative prompt
            if _is_link(ins.get("negative")):
                items = _collect_texts_from_conditioning(nodes_by_id, ins.get("negative"), branch="negative")
                for text, _ in items:
                    t = text.strip()
                    if t and t not in seen_neg:
                        seen_neg.add(t)
                        all_negative.append(t)
                        
        except Exception:
            continue
    
    return all_positive, all_negative


def _determine_workflow_type(nodes_by_id: Dict[str, Any], sink_node_id: str, sampler_id: Optional[str]) -> str:
    """
    Classify: T2I/I2I/T2V/I2V/V2V and audio variants (T2A/A2A)
    
    Improved detection:
    - Checks latent path (EmptyLatent vs VAEEncode)
    - Also scans for LoadImage/LoadVideo nodes feeding into VAEEncode anywhere in the graph
      (for reference-based workflows like Flux2 Redux, IP-Adapter, ControlNet, etc.)
    """
    # 1. Output Type
    sink = nodes_by_id.get(sink_node_id)
    sink_type = _lower(_node_type(sink))
    # Heuristic: SaveVideo -> V, SaveAudio -> A, SaveImage -> I
    is_audio_out = ("audio" in sink_type) and ("image" not in sink_type) and ("video" not in sink_type)
    is_video_out = (not is_audio_out) and ("video" in sink_type or "animate" in sink_type or "gif" in sink_type)
    suffix = "A" if is_audio_out else ("V" if is_video_out else "I")
    
    # 2. Input Type (Trace Latent Origin)
    prefix = "T" # Default to Text
    
    # 2a. First, scan the entire graph for LoadImage/LoadVideo -> VAEEncode patterns
    # This catches reference-based workflows (Flux2 Redux, IP-Adapter, ControlNet, etc.)
    has_image_input = False
    has_video_input = False
    has_audio_input = False
    
    for nid, node in nodes_by_id.items():
        if not isinstance(node, dict):
            continue
        ct = _lower(_node_type(node))
        
        # Check for VAEEncode nodes and trace their pixel input
        if "vaeencode" in ct:
            vae_ins = _inputs(node)
            pixel_link = vae_ins.get("pixels") or vae_ins.get("image")
            if _is_link(pixel_link):
                # Trace pixel source
                pix_src_id = _walk_passthrough(nodes_by_id, pixel_link)
                if pix_src_id:
                    pix_node = nodes_by_id.get(pix_src_id)
                    pct = _lower(_node_type(pix_node))
                    if "loadvideo" in pct or "videoloader" in pct:
                        has_video_input = True
                    elif "loadimage" in pct or "imageloader" in pct:
                        has_image_input = True
        
        # Also check direct LoadImage/LoadVideo that feed into conditioning nodes
        # (IP-Adapter, ControlNet, etc. may not use VAEEncode)
        if "loadimage" in ct or "imageloader" in ct:
            # Check if this node's output goes to something other than preview
            has_image_input = True
        if "loadvideo" in ct or "videoloader" in ct:
            has_video_input = True
        if "loadaudio" in ct or "audioloader" in ct or ("load" in ct and "audio" in ct):
            has_audio_input = True
    
    # 2b. Now check the main latent path for EmptyLatent (which would indicate pure T2X)
    if sampler_id:
        sampler = nodes_by_id.get(sampler_id)
        if isinstance(sampler, dict):
            ins = _inputs(sampler)
            # Standard KSampler 'latent_image', or 'samples' input
            latent_link = ins.get("latent_image") or ins.get("samples") or ins.get("latent")
            
            if _is_link(latent_link):
                 # Trace upstream to find if it comes from EmptyLatent (T2...) or VAEEncode (I2...)
                 curr_id = _walk_passthrough(nodes_by_id, latent_link)
                 hops = 0
                 while curr_id and hops < 15:
                     hops += 1
                     node = nodes_by_id.get(curr_id)
                     if not isinstance(node, dict): break
                     ct = _lower(_node_type(node))
                     
                     if "emptylatent" in ct:
                         break
                     if "vaeencode" in ct:
                         # Found encoder -> I2 or V2 (main latent path)
                         # Check what feeds the VAE
                         vae_ins = _inputs(node)
                         pixel_link = vae_ins.get("pixels") or vae_ins.get("image")
                         if _is_link(pixel_link):
                             # Trace pixel source to see if it's "LoadVideo" or "LoadImage"
                             pix_src_id = _walk_passthrough(nodes_by_id, pixel_link)
                             if pix_src_id:
                                 pix_node = nodes_by_id.get(pix_src_id)
                                 pct = _lower(_node_type(pix_node))
                                 if "loadvideo" in pct or "videoloader" in pct:
                                     has_video_input = True
                                 else:
                                     has_image_input = True
                             else:
                                 has_image_input = True
                         else:
                             has_image_input = True
                         break
                     
                     # Input is latent directly (LoadLatent)
                     if "loadlatent" in ct:
                         has_image_input = True  # Assume loaded latent came from image
                         break
                         
                     # Pass-through logic (LatentUpscale, Duplicate, etc.)
                     found_next = False
                     for k in ("samples", "latent", "latent_image"):
                         if _is_link(_inputs(node).get(k)):
                             curr_id = _walk_passthrough(nodes_by_id, _inputs(node).get(k))
                             found_next = True
                             break
                     if not found_next:
                         break
    
    # 3. Determine prefix based on findings
    # Priority: A (audio) > V (video) > I (image) > T (text-only)
    if has_audio_input:
        prefix = "A"
    elif has_video_input:
        prefix = "V"
    elif has_image_input:
        prefix = "I"
    else:
        prefix = "T"
                     
    return f"{prefix}2{suffix}"


def parse_geninfo_from_prompt(prompt_graph: Any, workflow: Any = None) -> Result[Optional[Dict[str, Any]]]:
    """
    Parse generation information from a ComfyUI prompt graph (dict of nodes).
    Returns Ok(None) when not enough information is available (do-not-lie).
    """
    # Extract workflow metadata (safe operation)
    workflow_meta = _extract_workflow_metadata(workflow)

    # Validate and normalize input graph
    try:
        nodes_by_id = _normalize_graph_input(prompt_graph, workflow)
    except ValueError:
        if workflow_meta:
            return Result.Ok({"metadata": workflow_meta})
        return Result.Ok(None)

    if not nodes_by_id:
        if workflow_meta:
            return Result.Ok({"metadata": workflow_meta})
        return Result.Ok(None)

    # Find sink nodes
    try:
        sinks = _find_candidate_sinks(nodes_by_id)
    except Exception as e:
        logger.warning(f"Sink detection failed: {e}")
        sinks = []

    if not sinks:
        if workflow_meta:
            return Result.Ok({"metadata": workflow_meta})
        return Result.Ok(None)

    # Prefer "real" sinks (SaveVideo over PreviewImage, etc.)
    try:
        sinks.sort(key=lambda nid: _sink_priority(nodes_by_id.get(nid, {}) or {}, nid))

        sink_id = sinks[0]
        sampler_id, sampler_conf = _select_primary_sampler(nodes_by_id, sink_id)
        
        # ... logic continues ...
        # Since I'm refactoring the monolithic block, I'll call a helper for the core logic
        # OR I can inline the rest if it's manageable. The main issue was the huge try/except.
        # Let's delegate the rest of extraction to a helper or just protect the extraction part.
        
        return _extract_geninfo(nodes_by_id, sinks, workflow_meta)

    except (ValueError, TypeError, KeyError, AttributeError) as e:
        logger.warning(f"GenInfo parsing failed: {e}")
        if workflow_meta:
            return Result.Ok({"metadata": workflow_meta})
        return Result.Ok(None)
    except Exception as e:
        # Unexpected error - log with full traceback for debugging
        logger.exception(f"Unexpected error in GenInfo parsing: {e}")
        if workflow_meta:
            return Result.Ok({"metadata": workflow_meta})
        return Result.Ok(None)

def _normalize_graph_input(prompt_graph: Any, workflow: Any) -> Optional[Dict[str, Dict[str, Any]]]:
    """Normalize prompt graph or workflow into nodes_by_id dict.
    
    Handles both ComfyUI prompt-graph format and LiteGraph workflow format.
    LiteGraph format has:
      - nodes: list of {id, type, inputs: [{name, link}], widgets_values: [...]}
      - links: list of [link_id, src_node, src_slot, tgt_node, tgt_slot, type]
    Prompt-graph format has:
      - dict with node_id as key: {class_type, inputs: {name: value}}
    """
    target_graph = prompt_graph

    if not isinstance(target_graph, dict) or not target_graph:
        if isinstance(workflow, dict) and "nodes" in workflow:
            target_graph = workflow
        else:
            return None

    nodes_by_id: Dict[str, Dict[str, Any]] = {}

    if "nodes" in target_graph and isinstance(target_graph["nodes"], list):
        # LiteGraph format - need to convert inputs list to dict and apply widgets_values
        links = target_graph.get("links", [])
        
        # Build link map: link_id -> (src_node_id, src_slot)
        link_to_source: Dict[int, Tuple[int, int]] = {}
        for link in links:
            if isinstance(link, list) and len(link) >= 3:
                link_id, src_node, src_slot = link[0], link[1], link[2]
                link_to_source[link_id] = (src_node, src_slot)
        
        for node in target_graph["nodes"]:
            if isinstance(node, dict):
                node_id = str(node.get("id"))
                # Convert LiteGraph node to prompt-graph-like format
                converted = {
                    "class_type": node.get("type"),
                    "type": node.get("type"),  # Keep both for compatibility
                    "id": node.get("id"),
                    "inputs": {},
                    # Preserve original fields for other parsers
                    "widgets_values": node.get("widgets_values"),
                    "outputs": node.get("outputs"),
                    "properties": node.get("properties"),
                    "title": node.get("title"),
                    "mode": node.get("mode"),
                }
                
                raw_inputs = node.get("inputs", [])
                widgets_values = node.get("widgets_values", [])
                
                # Build inputs dict from:
                # 1. Links (for connected inputs) -> store as ["node_id", slot]
                # 2. widgets_values (for widget inputs)
                # Note: widgets_values can be a list or a dict (e.g., VHS nodes use dict)
                widgets_list = widgets_values if isinstance(widgets_values, list) else []
                
                if isinstance(raw_inputs, list):
                    widget_idx = 0
                    for inp in raw_inputs:
                        if isinstance(inp, dict):
                            name = inp.get("name")
                            if not name:
                                continue
                            link_id = inp.get("link")
                            if link_id is not None and link_id in link_to_source:
                                # Connected input - store as [source_node_id, source_slot]
                                src_node_id, src_slot = link_to_source[link_id]
                                converted["inputs"][name] = [str(src_node_id), src_slot]
                            elif "widget" in inp:
                                # Widget input - try to get value from widgets_values
                                # LiteGraph stores widget values in order they appear
                                if widget_idx < len(widgets_list):
                                    converted["inputs"][name] = widgets_list[widget_idx]
                                widget_idx += 1
                elif isinstance(raw_inputs, dict):
                    # Already in dict format (shouldn't happen for LiteGraph but handle it)
                    converted["inputs"] = raw_inputs
                
                # Handle widgets_values as dict (VHS and some other nodes)
                if isinstance(widgets_values, dict):
                    for k, v in widgets_values.items():
                        if k not in converted["inputs"]:
                            converted["inputs"][k] = v
                
                # Also copy widgets_values to inputs if they have meaningful names
                # This helps with nodes that have prompts in widgets but no widget definition
                if widgets_list:
                    # For text encoder nodes, widgets_values[0] is usually the text
                    node_type_lower = _lower(node.get("type"))
                    if "text" not in converted["inputs"]:
                        if any(x in node_type_lower for x in ["primitive", "string", "text", "encode"]):
                            for wv in widgets_list:
                                if isinstance(wv, str) and len(wv.strip()) > 10:
                                    converted["inputs"]["text"] = wv
                                    converted["inputs"]["value"] = wv
                                    break
                
                nodes_by_id[node_id] = converted
    else:
        # Prompt-graph format - use as-is
        for k, v in target_graph.items():
            if isinstance(v, dict):
                nodes_by_id[str(k)] = v

    return nodes_by_id if nodes_by_id else None

def _extract_geninfo(nodes_by_id: Dict[str, Any], sinks: List[str], workflow_meta: Optional[Dict]) -> Result:
    sink_id = sinks[0]
    sampler_id, sampler_conf = _select_primary_sampler(nodes_by_id, sink_id)
    sampler_mode = "primary"
    
    if not sampler_id:
        sampler_id, sampler_conf = _select_advanced_sampler(nodes_by_id, sink_id)
        sampler_mode = "advanced" if sampler_id else sampler_mode
    
    if not sampler_id:
        sampler_id, sampler_conf = _select_any_sampler(nodes_by_id)
        sampler_mode = "global" if sampler_id else sampler_mode

    # Marigold / Qwen detection
    if not sampler_id:
        for nid, val in nodes_by_id.items():
            ct_lower = _lower(_node_type(val))
            if "marigold" in ct_lower:
                 sampler_id = nid
                 break
            if "instruction" in ct_lower and "qwen" in ct_lower:
                 sampler_id = nid
                 break

    if not sampler_id:
        out_fallback: Dict[str, Any] = {}
        if workflow_meta:
            out_fallback["metadata"] = workflow_meta
            
        input_files_fallback = _extract_input_files(nodes_by_id)
        if input_files_fallback:
            out_fallback["inputs"] = input_files_fallback
            
        if out_fallback:
            return Result.Ok(out_fallback)
        return Result.Ok(None)

    # For secondary traces (VAE, etc.), compute a stable upstream set from the sink input.
    sink = nodes_by_id.get(sink_id) or {}
    sink_link = _pick_sink_inputs(sink)
    sink_start_id = _walk_passthrough(nodes_by_id, sink_link) if sink_link else None

    sampler_node = nodes_by_id.get(sampler_id) or {}
    sampler_source = f"{_node_type(sampler_node)}:{sampler_id}"
    confidence = sampler_conf

    ins = _inputs(sampler_node)
    field_sources: Dict[str, str] = {}
    field_confidence: Dict[str, str] = {}

    # Advanced sampler pipelines (Flux/SD3): derive fields from orchestrator dependencies.
    advanced = _is_advanced_sampler(sampler_node)

    # Qwen2-VL captioning workflows often don't have a sampler, but result in string output.
    # If sink usage is text-based (rare for image gen tool, but possibly valid for caption), skip.

    # Detect Marigold (Depth) - often no sampler, just an estimator node or inserted in pipe.
    # If the sink comes from a Marigold node, treat it as the "sampler".
    if not sampler_id:
        for nid, val in nodes_by_id.items():
            ct_lower = _lower(_node_type(val))
            if "marigold" in ct_lower:
                 # Marigold acts as the processor
                 sampler_id = nid
                 # Marigold usually takes 'image' input, not latent.
                 # Metadata to extract: seed, denoise_steps, ensemble_size.
                 break
            # Qwen/Instruction nodes acted as sinks/processors
            if "instruction" in ct_lower and "qwen" in ct_lower:
                 sampler_id = nid
                 # Needs special handling for prompt extraction later
                 break
    
    # Ensure sampler_node object is up to date if we just found an ID in the fallback
    if sampler_id and (not sampler_node or str(sampler_node.get("id")) != str(sampler_id)):
         sampler_node = nodes_by_id.get(sampler_id) or {}
         ins = _inputs(sampler_node)
         confidence = "low" # Fallback confidence

    # Prompts
    pos_val: Optional[Tuple[str, str]] = None
    neg_val: Optional[Tuple[str, str]] = None
    conditioning_link = None
    guider_cfg_value: Optional[Any] = None
    guider_cfg_source: Optional[str] = None
    guider_model_link: Optional[Any] = None

    # Handle Qwen Instruction Prompts (stored directly on the node)
    if sampler_node and "instruction" in _lower(_node_type(sampler_node)) and "qwen" in _lower(_node_type(sampler_node)):
        p = ins.get("instruction") or ins.get("text")
        if isinstance(p, str) and p.strip():
            pos_val = (p.strip(), f"{_node_type(sampler_node)}:{sampler_id}:instruction")

    # FluxKohyaInferenceSampler (Kijai) - stores prompt directly
    if "flux" in _lower(_node_type(sampler_node)) and "trainer" in _lower(_node_type(sampler_node)):
        p = ins.get("prompt")
        if isinstance(p, str) and p.strip():
            pos_val = (p.strip(), f"{_node_type(sampler_node)}:{sampler_id}:prompt")

    # Wan/video stacks: prompts are often encoded into text embeds rather than conditioning.
    if _is_link(ins.get("text_embeds")) or _is_link(ins.get("hyvid_embeds")):
        link = ins.get("text_embeds") or ins.get("hyvid_embeds")
        p, n = _extract_posneg_from_text_embeds(nodes_by_id, link)
        pos_val = pos_val or p
        neg_val = neg_val or n

    if _is_link(ins.get("positive")):
        items = _collect_texts_from_conditioning(nodes_by_id, ins.get("positive"), branch="positive")
        if items:
            text = "\n".join([t for t, _ in items]).strip()
            srcs = [s for _, s in items]
            source = srcs[0] if len(set(srcs)) <= 1 else f"{srcs[0]} (+{len(srcs)-1})"
            if text:
                pos_val = (text, source)
        conditioning_link = ins.get("positive")
    if _is_link(ins.get("negative")):
        items = _collect_texts_from_conditioning(nodes_by_id, ins.get("negative"), branch="negative")
        if items:
            text = "\n".join([t for t, _ in items]).strip()
            srcs = [s for _, s in items]
            source = srcs[0] if len(set(srcs)) <= 1 else f"{srcs[0]} (+{len(srcs)-1})"
            if text:
                neg_val = (text, source)

    # Flux-style guidance pipelines: conditioning is passed through a guider node.
    if advanced and _is_link(ins.get("guider")):
        guider_id = _walk_passthrough(nodes_by_id, ins.get("guider"))
        guider_node = nodes_by_id.get(guider_id) if guider_id else None
        if isinstance(guider_node, dict):
            gins = _inputs(guider_node)
            # Some guiders pass a single `conditioning` link.
            if _is_link(gins.get("conditioning")):
                conditioning_link = gins.get("conditioning")
                items = _collect_texts_from_conditioning(nodes_by_id, conditioning_link)
                if items and not pos_val:
                    text = "\n".join([t for t, _ in items]).strip()
                    srcs = [s for _, s in items]
                    source = srcs[0] if len(set(srcs)) <= 1 else f"{srcs[0]} (+{len(srcs)-1})"
                    if text:
                        pos_val = (text, source)

            # Other guiders (e.g. CFGGuider in some video stacks) expose `positive` / `negative`.
            if _is_link(gins.get("positive")):
                conditioning_link = conditioning_link or gins.get("positive")
                if not pos_val:
                    items = _collect_texts_from_conditioning(nodes_by_id, gins.get("positive"), branch="positive")
                    if items:
                        text = "\n".join([t for t, _ in items]).strip()
                        srcs = [s for _, s in items]
                        source = srcs[0] if len(set(srcs)) <= 1 else f"{srcs[0]} (+{len(srcs)-1})"
                        if text:
                            pos_val = (text, source)

            if _is_link(gins.get("negative")) and not neg_val:
                items = _collect_texts_from_conditioning(nodes_by_id, gins.get("negative"), branch="negative")
                if items:
                    text = "\n".join([t for t, _ in items]).strip()
                    srcs = [s for _, s in items]
                    source = srcs[0] if len(set(srcs)) <= 1 else f"{srcs[0]} (+{len(srcs)-1})"
                    if text:
                        neg_val = (text, source)

            # Guidance scale sometimes lives on the guider node.
            cfg_val = _scalar(gins.get("cfg")) or _scalar(gins.get("cfg_scale")) or _scalar(gins.get("guidance"))
            if cfg_val is not None:
                guider_cfg_value = cfg_val
                guider_cfg_source = f"{_node_type(guider_node)}:{guider_id}"
            else:
                # Flux-style: check if guidance is provided by an upstream node (e.g. FluxGuidance via conditioning)
                cond_link = gins.get("conditioning")
                found_guidance = _trace_guidance_value(nodes_by_id, cond_link)
                if found_guidance:
                    guider_cfg_value, guider_cfg_source = found_guidance

            # Model chain for video stacks can also originate on the guider node.
            if _is_link(gins.get("model")):
                guider_model_link = gins.get("model")

    # Last-resort (still no guessing): some custom sampler nodes store prompt strings directly.
    if not pos_val:
        for k in ("positive_prompt", "prompt", "positive", "text", "text_g", "text_l"):
            v = ins.get(k)
            if _looks_like_prompt_string(v):
                pos_val = (str(v).strip(), f"{_node_type(sampler_node)}:{sampler_id}:{k}")
                break
    if not neg_val:
        for k in ("negative_prompt", "negative", "neg", "text_negative"):
            v = ins.get(k)
            if _looks_like_prompt_string(v):
                neg_val = (str(v).strip(), f"{_node_type(sampler_node)}:{sampler_id}:{k}")
                break

    # Sampler params
    sampler_name = _scalar(ins.get("sampler_name")) or _scalar(ins.get("sampler"))
    
    # Check if this node class itself implies a specific sampler (Marigold/Depth)
    if not sampler_name and "marigold" in _lower(_node_type(sampler_node)):
        sampler_name = _node_type(sampler_node)
        
    scheduler = _scalar(ins.get("scheduler"))
    steps = _scalar(ins.get("steps")) or _scalar(ins.get("denoise_steps")) # Marigold uses denoise_steps
    # embedded_guidance_scale is used by HunyuanVideoSampler
    cfg = _scalar(ins.get("cfg")) or _scalar(ins.get("cfg_scale")) or _scalar(ins.get("guidance")) or _scalar(ins.get("guidance_scale")) or _scalar(ins.get("embedded_guidance_scale"))
    denoise = _scalar(ins.get("denoise"))
    seed_val = _scalar(ins.get("seed"))
    if seed_val is None and _is_link(ins.get("seed")):
        seed_val = _resolve_scalar_from_link(nodes_by_id, ins.get("seed"))

    # LiteGraph workflows often keep KSampler scalar params in widgets_values.
    if any(v is None for v in (sampler_name, scheduler, steps, cfg, denoise, seed_val)):
        ks_w = _extract_ksampler_widget_params(sampler_node)
        if sampler_name is None:
            sampler_name = _scalar(ks_w.get("sampler_name"))
        if scheduler is None:
            scheduler = _scalar(ks_w.get("scheduler"))
        if steps is None:
            steps = _scalar(ks_w.get("steps"))
        if cfg is None:
            cfg = _scalar(ks_w.get("cfg"))
        if denoise is None:
            denoise = _scalar(ks_w.get("denoise"))
        if seed_val is None:
            seed_val = _scalar(ks_w.get("seed"))

    # Advanced sampler: sampler_name/steps/scheduler/denoise/seed may be stored on linked nodes.
    model_link_for_chain = ins.get("model") if _is_link(ins.get("model")) else None
    if model_link_for_chain is None and _is_link(guider_model_link):
        model_link_for_chain = guider_model_link

    if advanced:
        if _is_link(ins.get("sampler")):
            s = _trace_sampler_name(nodes_by_id, ins.get("sampler"))
            if s and not sampler_name:
                sampler_name = s[0]
        if _is_link(ins.get("sigmas")):
            st, sch, den, model_link, _src, st_conf = _trace_scheduler_sigmas(nodes_by_id, ins.get("sigmas"))
            if st is not None and steps is None:
                steps = st
                if _src and isinstance(_src, tuple) and len(_src) == 2:
                    field_sources["steps"] = _src[1]
                if st_conf:
                    field_confidence["steps"] = st_conf
            if sch is not None and not scheduler:
                scheduler = sch
                if _src and isinstance(_src, tuple) and len(_src) == 2:
                    field_sources["scheduler"] = _src[1]
            if den is not None and denoise is None:
                denoise = den
                if _src and isinstance(_src, tuple) and len(_src) == 2:
                    field_sources["denoise"] = _src[1]
            if model_link and not model_link_for_chain:
                model_link_for_chain = model_link
        if _is_link(ins.get("noise")) and seed_val is None:
            s = _trace_noise_seed(nodes_by_id, ins.get("noise"))
            if s:
                seed_val = s[0]
                field_sources["seed"] = s[1]
        if conditioning_link and cfg is None:
            g = _trace_guidance_from_conditioning(nodes_by_id, conditioning_link)
            if g:
                cfg = g[0]
                field_sources["cfg"] = g[1]

    if cfg is None and guider_cfg_value is not None:
        cfg = guider_cfg_value
        if guider_cfg_source:
            field_sources["cfg"] = guider_cfg_source

    # Model chain + LoRAs
    models: Dict[str, Dict[str, Any]] = {}
    loras: List[Dict[str, Any]] = []
    if model_link_for_chain and _is_link(model_link_for_chain):
        models, loras = _trace_model_chain(nodes_by_id, model_link_for_chain, confidence)

    # Related model loaders (non-diffusion): e.g. latent upscalers in video workflows.
    if "upscaler" not in models:
        try:
            for node_id, node in nodes_by_id.items():
                if not isinstance(node, dict):
                    continue
                ct = _lower(_node_type(node))
                if "upscalemodelloader" not in ct and "upscale_model" not in ct and "latentupscale" not in ct:
                    continue
                ins2 = _inputs(node)
                name = _clean_model_id(ins2.get("model_name") or ins2.get("upscale_model") or ins2.get("upscale_model_name"))
                if name:
                    models["upscaler"] = {"name": name, "confidence": "medium", "source": f"{_node_type(node)}:{node_id}"}
                    break
        except Exception:
            pass

    # Size
    size = None
    if _is_link(ins.get("latent_image")):
        size = _trace_size(nodes_by_id, ins.get("latent_image"), confidence)

    # Clip skip (from positive encoder's clip link)
    clip_skip = None
    encoder_id = None
    if conditioning_link and _is_link(conditioning_link):
        encoders = _collect_text_encoder_nodes_from_conditioning(nodes_by_id, conditioning_link, branch="positive")
        encoder_id = encoders[0] if encoders else _walk_passthrough(nodes_by_id, conditioning_link)
        pos_node = nodes_by_id.get(encoder_id) if encoder_id else None
        if isinstance(pos_node, dict) and _is_link(_inputs(pos_node).get("clip")):
            clip_skip = _trace_clip_skip(nodes_by_id, _inputs(pos_node).get("clip"), confidence)

    # CLIP model (from text encoder clip input)
    clip = None
    if conditioning_link and _is_link(conditioning_link):
        clip = _trace_clip_from_text_encoder(nodes_by_id, conditioning_link, confidence)

    # VAE model (from VAE decode on the sink path)
    vae = None
    if sink_start_id:
        vae = _trace_vae_from_sink(nodes_by_id, sink_start_id, confidence)

    # Determine Workflow Type (T2I, I2V, etc.)
    wf_type = _determine_workflow_type(nodes_by_id, sink_id, sampler_id)
    
    out: Dict[str, Any] = {
        "engine": {
            "parser_version": "geninfo-v1",
            "sink": str(_node_type(nodes_by_id.get(sink_id, {}))),
            "sampler_mode": sampler_mode,
            "type": wf_type,
        },
    }
    if workflow_meta:
        out["metadata"] = workflow_meta

    if pos_val:
        out["positive"] = {"value": pos_val[0], "confidence": confidence, "source": pos_val[1]}
    if neg_val:
        out["negative"] = {"value": neg_val[0], "confidence": confidence, "source": neg_val[1]}

    lyrics_text, lyrics_strength, lyrics_source = _extract_lyrics_from_prompt_nodes(nodes_by_id)
    if lyrics_text:
        out["lyrics"] = {"value": lyrics_text, "confidence": "high", "source": lyrics_source or sampler_source}
    if lyrics_strength is not None:
        lyr_field = _field(lyrics_strength, "high", lyrics_source or sampler_source)
        if lyr_field:
            out["lyrics_strength"] = lyr_field

    # Backward compatible: keep top-level `checkpoint` (best-effort)
    if models:
        preferred = (
            models.get("checkpoint")
            or models.get("unet")
            or models.get("diffusion")
            or None
        )
        if preferred:
            out["checkpoint"] = preferred

    if loras:
        out["loras"] = loras
    if clip:
        out["clip"] = clip
    if vae:
        out["vae"] = vae

    if models or clip or vae:
        merged: Dict[str, Dict[str, Any]] = {}
        if models.get("checkpoint"):
            merged["checkpoint"] = models["checkpoint"]
        if models.get("unet"):
            merged["unet"] = models["unet"]
        if models.get("diffusion"):
            merged["diffusion"] = models["diffusion"]
        if models.get("upscaler"):
            merged["upscaler"] = models["upscaler"]
        if clip:
            merged["clip"] = clip
        if vae:
            merged["vae"] = vae
        if merged:
            out["models"] = merged

    sname = _field_name(sampler_name, confidence, sampler_source)
    if sname:
        out["sampler"] = sname
    sch = _field_name(scheduler, confidence, sampler_source)
    if sch:
        out["scheduler"] = sch

    for key, val in (
        ("steps", steps),
        ("cfg", cfg),
        ("seed", seed_val),
        ("denoise", denoise),
    ):
        source = field_sources.get(key, sampler_source)
        conf = field_confidence.get(key, confidence)
        f = _field(val, conf, source)
        if f:
            out[key] = f

    if size:
        out["size"] = size

    if clip_skip:
        out["clip_skip"] = clip_skip
    
    # Extract inputs (images/videos used)
    input_files = _extract_input_files(nodes_by_id)
    if input_files:
        out["inputs"] = input_files

    # For multi-output workflows, collect all distinct prompts
    # This helps users see all variations when a workflow generates multiple outputs
    if len(sinks) > 1:
        all_pos, all_neg = _collect_all_prompts_from_sinks(nodes_by_id, sinks)
        # Only add if there are multiple distinct prompts
        if len(all_pos) > 1:
            out["all_positive_prompts"] = all_pos
        if len(all_neg) > 1:
            out["all_negative_prompts"] = all_neg

    # Do-not-lie: if nothing useful extracted besides engine, return None.
    if len(out.keys()) <= 1:
        if workflow_meta:
            return Result.Ok({"metadata": workflow_meta})
        return Result.Ok(None)

    return Result.Ok(out)
