"""
Metadata extractors for different file types.
Extracts ComfyUI workflow and generation parameters from PNG, WEBP, MP4.
"""
import json
import os
import re
from typing import Optional, Dict, Any, Tuple

from ...shared import Result, ErrorCode, get_logger
from .graph_traversal import iter_nested_dicts
from .parsing_utils import (
    try_parse_json_text,
    parse_json_value,
    looks_like_comfyui_workflow,
    looks_like_comfyui_prompt_graph,
    parse_auto1111_params
)

logger = get_logger(__name__)

# Constants removed (moved to parsing_utils)
MAX_TAG_LENGTH = 100


def _reconstruct_params_from_workflow(workflow: Dict[str, Any]) -> Dict[str, Any]:
    """
    Fallback: Extract prompts and parameters directly from the Workflow nodes.
    Uses link traversal to distinguish Positive vs Negative prompts.
    """
    params = {}
    nodes = workflow.get("nodes", [])
    links = workflow.get("links", [])  # [[id, src_node, src_slot, tgt_node, tgt_slot, type], ...]
    if not nodes:
        return params

    # 1. Index Nodes by ID and Links by Target
    node_map = {n["id"]: n for n in nodes if "id" in n}
    
    # link_lookup: link_id -> (origin_node_id, origin_slot_idx, target_node_id, target_slot_idx)
    link_lookup = {}
    for link in links:
        # [id, src_node, src_slot, tgt_node, tgt_slot, type]
        if len(link) >= 4:
            link_lookup[link[0]] = (link[1], link[2], link[3], link[4])

    def get_source_data(target_node_id, input_name):
        """Find the (origin_node, link_id) connected to a specific named input."""
        t_node = node_map.get(target_node_id)
        if not t_node: return None
        
        inp_def = next((i for i in t_node.get("inputs", []) if i.get("name") == input_name), None)
        if not inp_def: return None
        
        link_id = inp_def.get("link")
        if not link_id: return None
        
        link_info = link_lookup.get(link_id)
        if not link_info: return None
        
        origin_id = link_info[0]
        return (node_map.get(origin_id), link_id)

    def get_node_text(node, context=None):
        """
        Extract text widget value from a node.
        If context='negative' and multiple widgets exist, prefers the second/last one.
        If context='positive' and multiple widgets exist, prefers the first one.
        """
        widgets = node.get("widgets_values")
        if not widgets or not isinstance(widgets, list):
            return None
        
        # Filter for string widgets that look like prompts
        s_widgets = [w for w in widgets if isinstance(w, str) and len(w.strip()) > 0]
        
        if not s_widgets:
            return None
            
        if len(s_widgets) == 1:
            return s_widgets[0]
            
        # Heuristic for multi-widget nodes (like Weaver's PromptToLoras)
        if context == "negative":
            # Return the last one (usually negative)
            return s_widgets[-1]
        
        # Default/Positive: Return the first one
        return s_widgets[0]

    def find_upstream_text(start_node, depth=0, seen=None, context=None):
        """Find prompt-ish text upstream with semantic filtering.

        Converted to an iterative traversal to avoid relying on Python recursion
        limits on deep or cyclic graphs.
        """
        if not start_node:
            return []

        if seen is None:
            seen = set()

        # Allow deeper traversal than before without recursion risk.
        max_depth = 32

        found_texts = []
        stack = [(start_node, depth)]

        while stack:
            node, d = stack.pop()
            if not node or d > max_depth:
                continue

            node_id = node.get("id")
            if node_id is not None:
                if node_id in seen:
                    continue
                seen.add(node_id)

            node_type = str(node.get("type", "")).lower()

            # 1. Widgets in this node
            # We assume if a node has text widgets, it contributes to the prompt.
            # But we must be careful with Loaders (filenames).
            if "loader" not in node_type and "checkpoint" not in node_type and "loadimage" not in node_type:
                txt = get_node_text(node, context)
                if txt:
                    found_texts.append(txt)

            # 2. Walk upstream
            inputs = node.get("inputs", [])
            if not isinstance(inputs, list) or not inputs:
                continue

            # Use reversed order so traversal order stays close to the previous
            # recursive implementation.
            for inp in reversed(inputs):
                link_id = inp.get("link")
                if not link_id:
                    continue

                name = str(inp.get("name", "")).lower()
                if context == "positive" and "negative" in name:
                    continue
                if context == "negative" and "positive" in name:
                    continue

                link_info = link_lookup.get(link_id)
                if not link_info:
                    continue

                origin_id = link_info[0]
                origin_node = node_map.get(origin_id)
                if origin_node:
                    stack.append((origin_node, d + 1))

        return found_texts

    # Detect Samplers
    unique_prompts = set()
    unique_negatives = set()
    visited_nodes = set()
    sampler_found = False

    for node in nodes:
        node_type = str(node.get("type", "")).lower()
        if "ksampler" in node_type or "sampler" in node_type:
            sampler_found = True
            
            # Extract Params from Widgets
            widgets = node.get("widgets_values", [])
            for val in widgets:
                if isinstance(val, int):
                    if val > 10000 and "seed" not in params: params["seed"] = val
                    elif 1 <= val <= 200 and "steps" not in params: params["steps"] = val
                elif isinstance(val, float):
                    if 1.0 <= val <= 30.0 and "cfg" not in params: params["cfg"] = val
                elif isinstance(val, str):
                    v_low = val.lower()
                    if v_low in ["euler", "euler_a", "dpm++", "ddim", "uni_pc"] and "sampler" not in params:
                        params["sampler"] = val

            # Trace Prompts
            # 1. Positive
            pos_info = get_source_data(node["id"], "positive")
            if pos_info:
                # Use a local set for this trace to allow the same node to be visited 
                # in the negative trace (e.g. dual-role nodes like PromptToLoras)
                trace_seen = set()
                pos_texts = find_upstream_text(pos_info[0], context="positive", seen=trace_seen)
                unique_prompts.update(pos_texts)
                visited_nodes.update(trace_seen)

            # 2. Negative
            neg_info = get_source_data(node["id"], "negative")
            if neg_info:
                trace_seen = set()
                neg_texts = find_upstream_text(neg_info[0], context="negative", seen=trace_seen)
                unique_negatives.update(neg_texts)
                visited_nodes.update(trace_seen)

            # 3. Flux/Advanced Sampler (via Guider)
            guider_info = get_source_data(node["id"], "guider")
            if guider_info:
                guider_node = guider_info[0]
                if guider_node:
                    # Guider usually has 'conditioning' or 'positive' input
                    cond_info = get_source_data(guider_node["id"], "conditioning") or get_source_data(guider_node["id"], "positive")
                    if cond_info:
                        trace_seen = set()
                        pos_texts = find_upstream_text(cond_info[0], context="positive", seen=trace_seen)
                        unique_prompts.update(pos_texts)
                        visited_nodes.update(trace_seen)
                    
                    # Some guiders (CFGGuider) also have negative
                    neg_guider_info = get_source_data(guider_node["id"], "negative")
                    if neg_guider_info:
                        trace_seen = set()
                        neg_texts = find_upstream_text(neg_guider_info[0], context="negative", seen=trace_seen)
                        unique_negatives.update(neg_texts)
                        visited_nodes.update(trace_seen)

            # 4. Model
            model_info = get_source_data(node["id"], "model")
            if model_info:
                model_node = model_info[0]
                # Often connects to CheckpointLoaderSimple
                widgets_m = model_node.get("widgets_values", [])
                for w in widgets_m:
                    if isinstance(w, str) and (".safetensors" in w or ".ckpt" in w):
                        params["model"] = w
                        break

    # HEURISTIC FALLBACK / POST-PASS
    # If we found disjoint text nodes (not connected to KSampler directly, e.g. WanVideo Bridge),
    # we should try to include them by inferring their role from their DOWNSTREAM connections.
    
    # helper to check if a node connects to a positive/negative input anywhere
    # Now recursive (depth-limited) to catch Resize/VAE chains in I2I/Video workflows
    def classify_unconnected_node(start_node, depth=0, visited_trace=None):
        if visited_trace is None: visited_trace = set()
        
        nid = start_node.get("id")
        if nid in visited_trace or depth > 6: 
            return "unknown"
        visited_trace.add(nid)
        
        outputs = start_node.get("outputs", [])
        for out in outputs:
            links_arr = out.get("links") 
            if not links_arr: continue
            if not isinstance(links_arr, list): links_arr = [links_arr] 
            
            for lid in links_arr:
                # Check where this link goes
                link_target = link_lookup.get(lid)
                if not link_target: continue
                
                tgt_id = link_target[2]
                tgt_node = node_map.get(tgt_id)
                if not tgt_node: continue
                
                # 1. Direct Input Check
                tgt_inputs = tgt_node.get("inputs", [])
                for inp in tgt_inputs:
                    if inp.get("link") == lid:
                        iname = str(inp.get("name", "")).lower()
                        if "positive" in iname: return "positive"
                        if "negative" in iname: return "negative"
                
                # 2. Recursive downstream
                role = classify_unconnected_node(tgt_node, depth + 1, visited_trace)
                if role != "unknown":
                    return role
                    
        return "unknown"

    for node in nodes:
        uid = node.get("id")
        if uid in visited_nodes: continue
        
        node_type = str(node.get("type", "")).lower()
        title = str(node.get("title", "")).lower()
        
        # Check if it looks like a text node
        if "text" in node_type or "string" in node_type or "prompt" in node_type:
            # Check widgets first
            txt = get_node_text(node)
            if not txt: continue
            
            # Check Title hint
            if "negative" in title:
                unique_negatives.add(txt)
                continue
            if "positive" in title:
                unique_prompts.add(txt)
                continue
            
            # Check Downstream connections
            role = classify_unconnected_node(node)
            if role == "positive":
                unique_prompts.add(txt)
            elif role == "negative":
                unique_negatives.add(txt)
            elif not sampler_found: 
                # If NO sampler was found at all, we fall back to dumping everything into positive/negative based on heuristic
                # But here we are in post-pass.
                pass 

    # HEURISTIC FALLBACK: If no sampler tracing worked (e.g. non-standard sampler names or broken links),
    # revert to the "title contains negative" scan, BUT ONLY for nodes not already found.
    if not unique_prompts and not unique_negatives:
        for node in nodes:
            widgets = node.get("widgets_values")
            if not widgets or not isinstance(widgets, list): continue
            
            node_type = str(node.get("type", "")).lower()
            title = str(node.get("title", "")).lower()
            
            if "text" in node_type or "string" in node_type or "prompt" in node_type:
                 for val in widgets:
                    if isinstance(val, str) and len(val) > 2:
                        if "negative" in title or "negative" in node_type:
                            unique_negatives.add(val)
                        else:
                            unique_prompts.add(val)
                        break

    # Construct output
    # NOTE: Use "positive_prompt" not "prompt" to avoid overwriting the prompt graph dict
    # in metadata. The prompt graph (dict) is used by geninfo parser; positive_prompt (str)
    # is just the extracted text for display purposes.
    if unique_prompts:
        params["positive_prompt"] = "\n".join(unique_prompts)
    
    if unique_negatives:
        params["negative_prompt"] = "\n".join(unique_negatives)

    # Build fake parameters text
    fake_text_parts = []
    if "positive_prompt" in params:
        fake_text_parts.append(params["positive_prompt"])
    if "negative_prompt" in params:
        fake_text_parts.append(f"Negative prompt: {params['negative_prompt']}")
    
    details = []
    if "steps" in params: details.append(f"Steps: {params['steps']}")
    if "sampler" in params: details.append(f"Sampler: {params['sampler']}")
    if "cfg" in params: details.append(f"CFG scale: {params['cfg']}")
    if "seed" in params: details.append(f"Seed: {params['seed']}")
    if "model" in params: details.append(f"Model: {params['model']}")
    
    if details:
        fake_text_parts.append(", ".join(details))
        
    if fake_text_parts:
        params["parameters"] = "\n".join(fake_text_parts)

    return params

def _coerce_rating_to_stars(value: Any) -> Optional[int]:
    """
    Normalize rating values to 0..5 stars.

    Accepts:
    - 0..5 directly
    - 0..100-ish "percent" (Windows SharedUserRating / RatingPercent)
    - string numbers
    """
    if value is None:
        return None
    try:
        if isinstance(value, list) and value:
            value = value[0]
        if isinstance(value, str):
            value = value.strip()
            if not value:
                return None
            value = float(value.replace(",", "."))
        if isinstance(value, (int, float)):
            v = float(value)
        else:
            return None
    except Exception:
        return None

    if v <= 5.0:
        stars = int(round(v))
        return max(0, min(5, stars))

    # Treat as percent-like
    if v <= 0:
        return 0
    if v >= 88:
        return 5
    if v >= 63:
        return 4
    if v >= 38:
        return 3
    if v >= 13:
        return 2
    return 1


def _split_tags(text: str) -> list[str]:
    raw = str(text or "").strip()
    if not raw:
        return []
    # Common separators: semicolon (Windows), comma (many tools), pipe/newlines.
    parts = []
    for chunk in raw.replace("\r", "\n").replace("|", ";").split("\n"):
        parts.extend(chunk.split(";"))
    out: list[str] = []
    seen = set()
    for p in parts:
        for t in p.split(","):
            tag = str(t).strip()
            if not tag:
                continue
            if tag in seen:
                continue
            if len(tag) > MAX_TAG_LENGTH:
                continue
            seen.add(tag)
            out.append(tag)
    return out


def _extract_rating_tags(exif_data: Optional[Dict]) -> tuple[Optional[int], list[str]]:
    if not exif_data or not isinstance(exif_data, dict):
        return (None, [])

    # ExifTool key normalization:
    # - We run ExifTool with `-G1 -s`, which typically yields keys like `XMP-xmp:Rating`
    #   instead of the simpler `XMP:Rating`.
    # - To avoid missing OS metadata (Windows Explorer stars/tags), normalize keys into
    #   a few predictable aliases and match against those.
    #
    # Examples:
    # - `XMP-xmp:Rating` -> `xmp-xmp:rating`, `xmp:rating`, `rating`
    # - `XMP-microsoft:RatingPercent` -> `xmp-microsoft:ratingpercent`, `microsoft:ratingpercent`, `ratingpercent`
    def _build_norm_map(d: Dict[str, Any]) -> Dict[str, Any]:
        out: Dict[str, Any] = {}
        for k, v in d.items():
            try:
                key = str(k)
            except Exception:
                continue
            if not key:
                continue
            kl = key.strip().lower()
            if not kl:
                continue
            out.setdefault(kl, v)

            if ":" in kl:
                group, tag = kl.split(":", 1)
                if tag:
                    out.setdefault(tag, v)
                    # Reduce group like `xmp-xmp` -> `xmp`
                    group_last = group.split("-")[-1] if group else ""
                    if group_last and group_last != group:
                        out.setdefault(f"{group_last}:{tag}", v)
        return out

    norm = _build_norm_map(exif_data)

    rating_candidates = (
        # Common XMP rating keys (as seen with ExifTool -G1)
        "xmp:rating",
        "xmp-xmp:rating",
        # Windows Explorer often maps stars into XMP-microsoft rating percent
        "microsoft:ratingpercent",
        "xmp-microsoft:ratingpercent",
        # Windows Property System / legacy keys
        "microsoft:shareduserrating",
        "xmp-microsoft:shareduserrating",
        # Generic tag-only fallbacks
        "rating",
        "ratingpercent",
        "shareduserrating",
    )
    rating: Optional[int] = None
    for key in rating_candidates:
        if key in norm:
            rating = _coerce_rating_to_stars(norm.get(key))
            if rating is not None:
                break

    tag_candidates = (
        # Common XMP subjects/keywords (ExifTool -G1)
        "dc:subject",
        "xmp-dc:subject",
        "xmp:subject",
        "iptc:keywords",
        "photoshop:keywords",
        "lr:hierarchicalsubject",
        # Windows Explorer category/keywords
        "microsoft:category",
        "xmp-microsoft:category",
        "xpkeywords",
        # Generic tag-only fallbacks
        "keywords",
        "subject",
        "category",
    )
    tags: list[str] = []
    for key in tag_candidates:
        if key not in norm:
            continue
        val = norm.get(key)
        if val is None:
            continue
        if isinstance(val, list):
            for item in val:
                if item is None:
                    continue
                tags.extend(_split_tags(str(item)))
        else:
            tags.extend(_split_tags(str(val)))
    # De-dupe while keeping order
    seen = set()
    deduped: list[str] = []
    for t in tags:
        if t in seen:
            continue
        seen.add(t)
        deduped.append(t)
    return (rating, deduped)


def _extract_date_created(exif_data: Optional[Dict[str, Any]]) -> Optional[str]:
    """
    Extract the best candidate for 'Generation Time' (Content Creation) from Exif.
    """
    if not exif_data:
        return None
    
    # Priority list for "Date Taken" / "Content Created"
    candidates = [
        "ExifIFD:DateTimeOriginal",
        "ExifIFD:CreateDate",
        "DateTimeOriginal",
        "CreateDate",
        "QuickTime:CreateDate",
        "QuickTime:CreationDate",
        "RIFF:DateTimeOriginal",
        "IPTC:DateCreated",
        "XMP-photoshop:DateCreated",
        "Composite:DateTimeCreated"
    ]
    
    for key in candidates:
        val = exif_data.get(key)
        if val and isinstance(val, str):
            # Basic validation/cleaning could happen here
            # ExifTool usually returns "YYYY:MM:DD HH:MM:SS" or similar
            return val
    
    return None


def extract_rating_tags_from_exif(exif_data: Optional[Dict]) -> tuple[Optional[int], list[str]]:
    """
    Public wrapper for rating/tags extraction from ExifTool metadata dict.

    This is used by lightweight backends that only want rating/tags without parsing workflows.
    """
    return _extract_rating_tags(exif_data)

def _bump_quality(metadata: Dict[str, Any], quality: str) -> None:
    """
    Upgrade metadata["quality"] without downgrading.

    Expected values: none < partial < full
    """
    order = {"none": 0, "partial": 1, "full": 2}
    try:
        current = str(metadata.get("quality") or "none")
    except Exception:
        current = "none"
    if order.get(quality, 0) > order.get(current, 0):
        metadata["quality"] = quality


def _apply_common_exif_fields(
    metadata: Dict[str, Any],
    exif_data: Dict[str, Any],
    *,
    workflow: Optional[Dict[str, Any]] = None,
    prompt: Optional[Dict[str, Any]] = None,
) -> None:
    """
    Apply workflow/prompt + rating/tags into an existing metadata dict.
    """
    wf = workflow
    pr = prompt
    if wf is None or pr is None:
        scanned_workflow, scanned_prompt = _extract_json_fields(exif_data)
        if wf is None:
            wf = scanned_workflow
        if pr is None:
            pr = scanned_prompt

    if looks_like_comfyui_workflow(wf):
        metadata["workflow"] = wf
        _bump_quality(metadata, "full")

    if looks_like_comfyui_prompt_graph(pr):
        metadata["prompt"] = pr
        if str(metadata.get("quality") or "none") != "full":
            _bump_quality(metadata, "partial")

    # FALLBACK: If we have a workflow but NO parameters text, reconstruct it
    if metadata.get("workflow") and not metadata.get("parameters"):
        reconstructed = _reconstruct_params_from_workflow(metadata["workflow"])
        if reconstructed:
            metadata.update(reconstructed)
            if metadata.get("quality") != "full":
                _bump_quality(metadata, "partial")

    rating, tags = _extract_rating_tags(exif_data)
    if rating is not None:
        metadata["rating"] = rating
    if tags:
        metadata["tags"] = tags

    date_created = _extract_date_created(exif_data)
    if date_created:
        metadata["generation_time"] = date_created


def extract_png_metadata(file_path: str, exif_data: Optional[Dict] = None) -> Result[Dict[str, Any]]:
    if not os.path.exists(file_path):
        return Result.Err(ErrorCode.NOT_FOUND, f"File not found: {file_path}")

    metadata = {
        "raw": exif_data or {},
        "workflow": None,
        "prompt": None,
        "parameters": None,
        "quality": "none"
    }

    if not exif_data:
        return Result.Ok(metadata, quality="none")

    try:
        png_params = exif_data.get("PNG:Parameters")
        if png_params:
            metadata["parameters"] = png_params
            _bump_quality(metadata, "partial")
            parsed = parse_auto1111_params(png_params)
            if parsed:
                metadata.update(parsed)

        _apply_common_exif_fields(metadata, exif_data)
        return Result.Ok(metadata, quality=metadata["quality"])
    except Exception as e:
        logger.warning(f"PNG metadata extraction error: {e}")
        return Result.Err(ErrorCode.PARSE_ERROR, str(e), quality="degraded")

def extract_webp_metadata(file_path: str, exif_data: Optional[Dict] = None) -> Result[Dict[str, Any]]:
    """
    Extract ComfyUI metadata from WEBP file.
    Handles JSON in EXIF:Make/Model and text fields (ImageDescription) with prefixes.
    """
    if not os.path.exists(file_path):
        return Result.Err(ErrorCode.NOT_FOUND, f"File not found: {file_path}")

    metadata = {
        "raw": exif_data or {},
        "workflow": None,
        "prompt": None,
        "quality": "none"
    }

    if not exif_data:
        return Result.Ok(metadata, quality="none")

    try:
        # 1) Direct check in standard ComfyUI locations for WebP
        def _inspect_json_field(key_names, container):
            for key in key_names:
                value = container.get(key) if isinstance(container, dict) else None
                parsed = parse_json_value(value)
                if parsed is not None:
                    return parsed
            return None

        workflow = None
        prompt = None

        potential_workflow = _inspect_json_field(["EXIF:Make", "IFD0:Make", "Keys:Workflow", "comfyui:workflow"], exif_data)
        potential_prompt = _inspect_json_field(["EXIF:Model", "IFD0:Model", "Keys:Prompt", "comfyui:prompt"], exif_data)

        # Cross-check because sometimes Prompt is in Make, or Workflow is in ImageDescription
        if potential_workflow:
            if looks_like_comfyui_workflow(potential_workflow):
                workflow = potential_workflow
            elif looks_like_comfyui_prompt_graph(potential_workflow) and not prompt:
                prompt = potential_workflow

        if potential_prompt:
            if looks_like_comfyui_prompt_graph(potential_prompt) and not prompt:
                prompt = potential_prompt
            elif looks_like_comfyui_workflow(potential_prompt) and not workflow:
                workflow = potential_prompt

        # 2) Fallback: scan all tags (optimized scan)
        if not workflow or not prompt:
            scanned_workflow, scanned_prompt = _extract_json_fields(exif_data)
            if not workflow:
                workflow = scanned_workflow
            if not prompt:
                prompt = scanned_prompt

        # 3) Look for Auto1111-style text OR prefixed JSON in description fields
        # This fixes files where workflow is stored as "Workflow: {...}" in ImageDescription
        text_keys = [
            "EXIF:ImageDescription", "IFD0:ImageDescription", "ImageDescription",
            "EXIF:UserComment", "IFD0:UserComment", "UserComment",
            "EXIF:Comment", "IFD0:Comment",
            "EXIF:Subject", "IFD0:Subject",
        ]

        for key in text_keys:
            candidate = exif_data.get(key)
            if not candidate or not isinstance(candidate, str):
                continue

            # A) Try to parse as JSON first (handles "Workflow: {...}")
            parsed_json = try_parse_json_text(candidate)
            if parsed_json:
                if workflow is None and looks_like_comfyui_workflow(parsed_json):
                    workflow = parsed_json
                    continue
                if prompt is None and looks_like_comfyui_prompt_graph(parsed_json):
                    prompt = parsed_json
                    continue

            # B) Try to parse as Auto1111 parameters
            parsed_a1111 = parse_auto1111_params(candidate)
            if parsed_a1111:
                metadata["parameters"] = candidate
                metadata.update(parsed_a1111)
                if metadata["quality"] != "full":
                    _bump_quality(metadata, "partial")
                # Don't overwrite existing prompt graph with simple text prompt
                if not prompt and not metadata.get("prompt") and parsed_a1111.get("prompt"):
                    metadata["prompt"] = parsed_a1111["prompt"]

        _apply_common_exif_fields(metadata, exif_data, workflow=workflow, prompt=prompt)

        return Result.Ok(metadata, quality=metadata["quality"])

    except Exception as e:
        logger.warning(f"WEBP metadata extraction error: {e}")
        return Result.Err(ErrorCode.PARSE_ERROR, str(e), quality="degraded")

def extract_video_metadata(file_path: str, exif_data: Optional[Dict] = None, ffprobe_data: Optional[Dict] = None) -> Result[Dict[str, Any]]:
    """
    Extract ComfyUI metadata from video file (MP4, MOV, WEBM, MKV).

    Video files store metadata in QuickTime:Workflow and QuickTime:Prompt fields.

    Args:
        file_path: Path to video file
        exif_data: Optional pre-fetched EXIF data from ExifTool
        ffprobe_data: Optional pre-fetched ffprobe data

    Returns:
        Result with extracted metadata (all raw data + interpreted fields)
    """
    if not os.path.exists(file_path):
        return Result.Err(ErrorCode.NOT_FOUND, f"File not found: {file_path}")

    exif_data = exif_data or {}
    # Start with all raw data
    metadata = {
        "raw": exif_data or {},
        "raw_ffprobe": ffprobe_data or {},
        "workflow": None,
        "prompt": None,
        "parameters": None,
        "duration": None,
        "resolution": None,
        "fps": None,
        "quality": "none"
    }

    try:
        # Extract video properties from ffprobe
        if ffprobe_data:
            video_stream = ffprobe_data.get("video_stream", {})
            format_info = ffprobe_data.get("format", {})

            metadata["resolution"] = (
                video_stream.get("width"),
                video_stream.get("height")
            )
            metadata["fps"] = video_stream.get("r_frame_rate")
            metadata["duration"] = format_info.get("duration")

        def _unwrap_workflow_prompt_container(container: Any) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
            """
            Some pipelines embed a wrapper object like:
              {"workflow": {...}, "prompt": "{...json...}"}
            inside a single tag (often `ItemList:Comment`).

            Only return values if they match ComfyUI shapes (prevents false positives).
            """
            if not isinstance(container, dict):
                return (None, None)

            wf = container.get("workflow") or container.get("Workflow") or None
            pr = container.get("prompt") or container.get("Prompt") or None

            wf_out: Optional[Dict[str, Any]] = None
            pr_out: Optional[Dict[str, Any]] = None

            if isinstance(wf, dict) and looks_like_comfyui_workflow(wf):
                wf_out = wf

            if isinstance(pr, dict) and looks_like_comfyui_prompt_graph(pr):
                pr_out = pr
            elif isinstance(pr, str):
                # Prompt can be a JSON string literal.
                parsed = try_parse_json_text(pr)
                if isinstance(parsed, dict) and looks_like_comfyui_prompt_graph(parsed):
                    pr_out = parsed

            if wf_out or pr_out:
                return (wf_out, pr_out)
            return (None, None)

        def _inspect_json_field(key_names, container):
            for key in key_names:
                value = container.get(key) if isinstance(container, dict) else None
                parsed = parse_json_value(value)
                
                # Check for wrapped container (Legacy behavior restoration)
                if isinstance(parsed, dict):
                     wf_wrapped, pr_wrapped = _unwrap_workflow_prompt_container(parsed)
                     if wf_wrapped or pr_wrapped:
                         return parsed

                if parsed is not None:
                    return parsed
            return None

        def _collect_text_candidates(container):
            if not isinstance(container, dict):
                return []
            out = []
            for k, v in container.items():
                if isinstance(v, str):
                    out.append((k, v))
                elif isinstance(v, (list, tuple)):
                    for item in v:
                        if isinstance(item, str):
                            out.append((k, item))
            return out

        # NOTE: Some encoders store JSON in ItemList:Comment that is NOT a ComfyUI workflow.
        # We intentionally do not treat ItemList:Comment as a workflow source unless it
        # clearly contains a workflow payload (see fallback scan below).
        workflow = None
        prompt = None

        potential_workflow = _inspect_json_field(
            ["QuickTime:Workflow", "Keys:Workflow", "comfyui:workflow"],
            exif_data
        )
        potential_prompt = _inspect_json_field(
            ["QuickTime:Prompt", "Keys:Prompt", "comfyui:prompt"],
            exif_data
        )

        # Cross-check to handle swapped tags (e.g. prompt in workflow tag)
        if potential_workflow:
            if looks_like_comfyui_workflow(potential_workflow):
                workflow = potential_workflow
            elif looks_like_comfyui_prompt_graph(potential_workflow) and not prompt:
                prompt = potential_workflow
            else:
                 # Check for legacy wrapper format in tags like "QuickTime:Workflow"
                 wf_w, pr_w = _unwrap_workflow_prompt_container(potential_workflow)
                 if wf_w and not workflow: workflow = wf_w
                 if pr_w and not prompt: prompt = pr_w

        if potential_prompt:
            if looks_like_comfyui_prompt_graph(potential_prompt) and not prompt:
                prompt = potential_prompt
            elif looks_like_comfyui_workflow(potential_prompt) and not workflow:
                workflow = potential_prompt
            else:
                 wf_w, pr_w = _unwrap_workflow_prompt_container(potential_prompt)
                 if wf_w and not workflow: workflow = wf_w
                 if pr_w and not prompt: prompt = pr_w

        # Fallback scan across all ExifTool tags, using shape-based heuristics.
        if workflow is None or prompt is None:
            scanned_workflow, scanned_prompt = _extract_json_fields(exif_data)
            if workflow is None and looks_like_comfyui_workflow(scanned_workflow):
                workflow = scanned_workflow
            if prompt is None and looks_like_comfyui_prompt_graph(scanned_prompt):
                prompt = scanned_prompt

        # Fallback: check ffprobe container tags (some encoders store metadata here).
        format_tags = None
        if isinstance(ffprobe_data, dict):
            fmt = ffprobe_data.get("format") or {}
            if isinstance(fmt, dict):
                tags = fmt.get("tags")
                if isinstance(tags, dict):
                    format_tags = tags

        if format_tags and (workflow is None or prompt is None):
            scanned_workflow, scanned_prompt = _extract_json_fields(format_tags)
            if workflow is None and looks_like_comfyui_workflow(scanned_workflow):
                workflow = scanned_workflow
            if prompt is None and looks_like_comfyui_prompt_graph(scanned_prompt):
                prompt = scanned_prompt

        # VHS/other pipelines may store tags on the stream rather than container.
        stream_tag_dicts = []
        try:
            if isinstance(ffprobe_data, dict) and isinstance(ffprobe_data.get("streams"), list):
                for s in ffprobe_data.get("streams") or []:
                    if not isinstance(s, dict):
                        continue
                    tags = s.get("tags")
                    if isinstance(tags, dict):
                        stream_tag_dicts.append(tags)
        except Exception:
            stream_tag_dicts = []

        if stream_tag_dicts and (workflow is None or prompt is None):
            for tags in stream_tag_dicts:
                scanned_workflow, scanned_prompt = _extract_json_fields(tags)
                if workflow is None and looks_like_comfyui_workflow(scanned_workflow):
                    workflow = scanned_workflow
                if prompt is None and looks_like_comfyui_prompt_graph(scanned_prompt):
                    prompt = scanned_prompt
                if workflow is not None and prompt is not None:
                    break

        # Auto1111-style "parameters" text can also appear in video tags (comment/description).
        if metadata.get("parameters") is None:
            candidates = _collect_text_candidates(exif_data)
            if format_tags:
                candidates.extend(_collect_text_candidates(format_tags))
            for tags in stream_tag_dicts or []:
                candidates.extend(_collect_text_candidates(tags))
            for _, text in candidates:
                parsed = parse_auto1111_params(text)
                if not parsed:
                    continue
                metadata["parameters"] = text
                # Keep prompt as a string-based fallback only if we don't have a prompt graph.
                if prompt is None and parsed.get("prompt"):
                    metadata["prompt"] = parsed.get("prompt")
                    if parsed.get("negative_prompt"):
                        metadata["negative_prompt"] = parsed.get("negative_prompt")
                if metadata["quality"] != "full":
                    _bump_quality(metadata, "partial")
                break

        # NOTE: No sidecar fallback here (e.g. .json/.txt). We only trust embedded tags
        # (ExifTool/FFprobe) for video generation metadata to avoid hidden filesystem coupling.

        _apply_common_exif_fields(metadata, exif_data, workflow=workflow, prompt=prompt)

        return Result.Ok(metadata, quality=metadata["quality"])

    except Exception as e:
        logger.warning(f"Video metadata extraction error: {e}")
        return Result.Err(ErrorCode.PARSE_ERROR, str(e), quality="degraded")

def _extract_json_fields(exif_data: Dict[str, Any]) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    """
    Optimized scan of EXIF/ffprobe metadata for workflow/prompt JSON fields.
    Prioritizes known keys before scanning strictly.
    """
    workflow = None
    prompt = None

    # 1. Prioritize known keys where JSON is typically found
    # This avoids expensive regex/zlib on thousands of irrelevant EXIF tags
    PRIORITY_KEYS = [
        "UserComment", "Comment", "Description", "ImageDescription",
        "Parameters", "Workflow", "Prompt", "ExifOffset", "Make", "Model"
    ]

    # Helper to check if a key matches our priority list (case-insensitive partial match)
    def is_priority_key(k: str) -> bool:
        k_lower = k.lower()
        return any(pk.lower() in k_lower for pk in PRIORITY_KEYS)

    # Sort keys to process priority ones first
    sorted_items = sorted(
        exif_data.items(),
        key=lambda item: 0 if is_priority_key(str(item[0])) else 1
    )

    def _unwrap_workflow_prompt_container(container: Any) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
        if not isinstance(container, dict):
            return (None, None)

        wf = container.get("workflow") or container.get("Workflow")
        pr = container.get("prompt") or container.get("Prompt")

        wf_out, pr_out = None, None

        if isinstance(wf, dict) and looks_like_comfyui_workflow(wf):
            wf_out = wf
        if isinstance(pr, dict) and looks_like_comfyui_prompt_graph(pr):
            pr_out = pr
        elif isinstance(pr, str):
            parsed = try_parse_json_text(pr)
            if isinstance(parsed, dict) and looks_like_comfyui_prompt_graph(parsed):
                pr_out = parsed
        return (wf_out, pr_out)

    for key, value in sorted_items:
        # Stop early if we found both
        if workflow and prompt:
            break

        # Skip obviously short strings to save CPU
        if isinstance(value, str) and len(value) < 10:
            continue

        normalized = key.lower() if isinstance(key, str) else ""
        parsed = parse_json_value(value)

        if not parsed:
            continue

        # Check for container pattern
        if workflow is None or prompt is None:
            wf_candidate, pr_candidate = _unwrap_workflow_prompt_container(parsed)
            if workflow is None and wf_candidate:
                workflow = wf_candidate
            if prompt is None and pr_candidate:
                prompt = pr_candidate
            if workflow and prompt:
                break

        # Check direct match
        if workflow is None and looks_like_comfyui_workflow(parsed):
            workflow = parsed
        if prompt is None and looks_like_comfyui_prompt_graph(parsed):
            prompt = parsed

        # Check prefix usage (workflow: ...)
        if isinstance(value, str):
            text_lower = value.strip().lower()
            if workflow is None and (text_lower.startswith("workflow:") or "workflow" in normalized):
                if looks_like_comfyui_workflow(parsed):
                    workflow = parsed
            if prompt is None and (text_lower.startswith("prompt:") or "prompt" in normalized):
                if looks_like_comfyui_prompt_graph(parsed):
                    prompt = parsed

    return workflow, prompt
