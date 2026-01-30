"""
Metadata extractors for different file types.
Extracts ComfyUI workflow and generation parameters from PNG, WEBP, MP4.
"""
import json
import os
import base64
import re
import zlib
from typing import Optional, Dict, Any, Tuple

from ...shared import Result, ErrorCode, get_logger
from .graph_traversal import iter_nested_dicts

logger = get_logger(__name__)

_BASE64_RE = re.compile(r"^[A-Za-z0-9+/=\s]+$")
_AUTO1111_KV_RE = re.compile(r"(?:^|,\s*)([^:,]+):\s*")

MAX_METADATA_JSON_SIZE = 10 * 1024 * 1024  # 10MB
MIN_BASE64_CANDIDATE_LEN = 80
MAX_ZLIB_DECOMPRESS_BYTES = 5 * 1024 * 1024  # 5MB
MAX_TAG_LENGTH = 100


def _try_parse_json_text(text: str) -> Optional[Dict[str, Any]]:
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
        try:
            decoded = zlib.decompress(decoded)
        except Exception:
            pass

    try:
        decoded_text = decoded.decode("utf-8", errors="replace").strip()
    except Exception:
        return None

    if not decoded_text or len(decoded_text) > MAX_METADATA_JSON_SIZE:
        return None

    return _loads_maybe(decoded_text)


def _reconstruct_params_from_workflow(workflow: Dict[str, Any]) -> Dict[str, Any]:
    """
    Fallback: Extract prompts and parameters directly from the Workflow nodes
    when the 'Parameters' text field is missing.
    """
    params = {}
    nodes = workflow.get("nodes", [])
    if not nodes:
        return params

    prompts = []
    negative_prompts = []

    # Simple heuristic scan of nodes
    for node in nodes:
        widgets = node.get("widgets_values")
        if not widgets or not isinstance(widgets, list):
            continue

        node_type = str(node.get("type", "")).lower()
        title = str(node.get("title", "")).lower()

        # 1. Extract Prompts (CLIPTextEncode, PrimitiveString, etc.)
        if "text" in node_type or "string" in node_type or "prompt" in node_type:
            # Usually the first widget is the text
            for val in widgets:
                if isinstance(val, str) and len(val) > 2:
                    # heuristic: negative prompts often have "negative" in title or color/bg
                    if "negative" in title or "negative" in node_type:
                        negative_prompts.append(val)
                    else:
                        prompts.append(val)
                    break # take first string only per node

        # 2. Extract KSampler Info (Seed, Steps, CFG, Sampler)
        if "ksampler" in node_type or "sampler" in node_type:
            # Common widget order varies, but we can look for specific types
            for val in widgets:
                if isinstance(val, int):
                    # Large int is likely seed
                    if val > 10000 and "seed" not in params:
                        params["seed"] = val
                    # Small int (1-100) likely steps
                    elif 1 <= val <= 200 and "steps" not in params:
                        params["steps"] = val
                elif isinstance(val, float):
                    # Small float (1.0-30.0) likely CFG
                    if 1.0 <= val <= 30.0 and "cfg" not in params:
                        params["cfg"] = val
                elif isinstance(val, str):
                    # Check for sampler names
                    v_low = val.lower()
                    if v_low in ["euler", "euler_a", "dpm++", "ddim", "uni_pc"] and "sampler" not in params:
                        params["sampler"] = val

        # 3. Extract Model Name
        if "loader" in node_type and "checkpoint" in node_type:
             for val in widgets:
                 if isinstance(val, str) and (".safetensors" in val or ".ckpt" in val):
                     params["model"] = val
                     break

    # Construct parameter text
    if prompts:
        # Join multiple prompt nodes if found
        full_prompt = "\n".join(prompts)
        params["prompt"] = full_prompt

        # Build a fake parameters string for display
        fake_text = full_prompt
        if negative_prompts:
            neg = "\n".join(negative_prompts)
            params["negative_prompt"] = neg
            fake_text += f"\nNegative prompt: {neg}"

        details = []
        if "steps" in params: details.append(f"Steps: {params['steps']}")
        if "sampler" in params: details.append(f"Sampler: {params['sampler']}")
        if "cfg" in params: details.append(f"CFG scale: {params['cfg']}")
        if "seed" in params: details.append(f"Seed: {params['seed']}")
        if "model" in params: details.append(f"Model: {params['model']}")

        if details:
            fake_text += "\n" + ", ".join(details)

        params["parameters"] = fake_text

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

    if _looks_like_comfyui_workflow(wf):
        metadata["workflow"] = wf
        _bump_quality(metadata, "full")

    if _looks_like_comfyui_prompt_graph(pr):
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
            parsed = _parse_auto1111_params(png_params)
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
                parsed = _parse_json_value(value)
                if parsed is not None:
                    return parsed
            return None

        workflow = _inspect_json_field(["EXIF:Make", "IFD0:Make", "Keys:Workflow", "comfyui:workflow"], exif_data)
        prompt = _inspect_json_field(["EXIF:Model", "IFD0:Model", "Keys:Prompt", "comfyui:prompt"], exif_data)

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
            parsed_json = _try_parse_json_text(candidate)
            if parsed_json:
                if workflow is None and _looks_like_comfyui_workflow(parsed_json):
                    workflow = parsed_json
                    continue
                if prompt is None and _looks_like_comfyui_prompt_graph(parsed_json):
                    prompt = parsed_json
                    continue

            # B) Try to parse as Auto1111 parameters
            parsed_a1111 = _parse_auto1111_params(candidate)
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

        def _inspect_json_field(key_names, container):
            for key in key_names:
                value = container.get(key) if isinstance(container, dict) else None
                parsed = _parse_json_value(value)
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
        workflow = _inspect_json_field(
            ["QuickTime:Workflow", "Keys:Workflow", "comfyui:workflow"],
            exif_data
        )
        prompt = _inspect_json_field(
            ["QuickTime:Prompt", "Keys:Prompt", "comfyui:prompt"],
            exif_data
        )

        # Fallback scan across all ExifTool tags, using shape-based heuristics.
        if workflow is None or prompt is None:
            scanned_workflow, scanned_prompt = _extract_json_fields(exif_data)
            if workflow is None and _looks_like_comfyui_workflow(scanned_workflow):
                workflow = scanned_workflow
            if prompt is None and _looks_like_comfyui_prompt_graph(scanned_prompt):
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
            if workflow is None and _looks_like_comfyui_workflow(scanned_workflow):
                workflow = scanned_workflow
            if prompt is None and _looks_like_comfyui_prompt_graph(scanned_prompt):
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
                if workflow is None and _looks_like_comfyui_workflow(scanned_workflow):
                    workflow = scanned_workflow
                if prompt is None and _looks_like_comfyui_prompt_graph(scanned_prompt):
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
                parsed = _parse_auto1111_params(text)
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

def _parse_auto1111_params(params_text: str) -> Optional[Dict[str, Any]]:
    """
    Parse Auto1111/Forge parameters text.

    Format:
        positive prompt
        Negative prompt: negative text
        Steps: 20, Sampler: DPM++ SDE, CFG scale: 7, Seed: 123, Size: 512x768, Model: model_name

    Args:
        params_text: Parameters text string

    Returns:
        Parsed parameters dict or None
    """
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
            nl = after.find("\n")
            if nl != -1:
                result["negative_prompt"] = after[:nl].strip()
                remaining = after[nl + 1:].strip()
            else:
                result["negative_prompt"] = after.strip()
                remaining = ""
        else:
            # No negative prompt, find where parameter kvs start (usually at "Steps:").
            steps_idx = text.find("\nSteps:")
            if steps_idx == -1:
                steps_idx = text.find("Steps:")
            if steps_idx != -1:
                # Handle either "\nSteps:" or "Steps:" at start.
                if text.startswith("Steps:"):
                    result["prompt"] = ""
                    remaining = text
                else:
                    result["prompt"] = text[:steps_idx].strip()
                    remaining = text[steps_idx:].lstrip()
            else:
                result["prompt"] = text
                remaining = ""

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
                        logger.debug("Invalid steps value: %s", value)
                elif key == "sampler":
                    result["sampler"] = value
                elif key in ("cfg_scale", "cfg"):
                    try:
                        result["cfg"] = float(value)
                    except (ValueError, TypeError):
                        logger.debug("Invalid cfg value: %s", value)
                elif key == "seed":
                    try:
                        result["seed"] = int(value)
                    except (ValueError, TypeError):
                        logger.debug("Invalid seed value: %s", value)
                elif key in ("size", "hires_resize"):
                    if "x" in value:
                        w, h = value.split("x", 1)
                        try:
                            result["width"] = int(w.strip())
                            result["height"] = int(h.strip())
                        except (ValueError, TypeError):
                            logger.debug("Invalid size value: %s", value)
                elif key == "model":
                    result["model"] = value
                elif key == "model_hash":
                    result["model_hash"] = value

        return result or None

    except Exception as e:
        logger.warning(f"Failed to parse Auto1111 params: {e}")
        return None


def _parse_json_value(value: Optional[str]) -> Optional[Dict[str, Any]]:
    """Try to parse a JSON payload from a tag value, trimming known prefixes.

    ExifTool can return duplicate tags as arrays, so accept strings or lists of strings.
    """
    candidates = []
    if isinstance(value, str):
        candidates = [value]
    elif isinstance(value, (list, tuple)):
        candidates = [v for v in value if isinstance(v, str)]
    else:
        return None

    for raw in candidates:
        parsed = _try_parse_json_text(raw)
        if isinstance(parsed, dict):
            return parsed

    return None


def _looks_like_comfyui_workflow(value: Optional[Dict[str, Any]]) -> bool:
    """
    Heuristic check: only treat a JSON dict as a ComfyUI workflow if it matches
    the expected graph structure (prevents false positives from generic JSON
    comments/parameters).
    """
    if not isinstance(value, dict):
        return False

    nodes = value.get("nodes")
    if not isinstance(nodes, list) or not nodes:
        return False

    # Most ComfyUI workflows also contain 'links' as an array, but allow missing.
    links = value.get("links")
    if links is not None and not isinstance(links, list):
        return False

    # Validate a few node fields on first N nodes.
    sample = nodes[:5]
    valid_nodes = 0
    for node in sample:
        if not isinstance(node, dict):
            continue
        if "type" in node and "id" in node:
            valid_nodes += 1
            continue
        # Some exports use 'title' + 'id'
        if "id" in node and ("title" in node or "outputs" in node or "inputs" in node):
            valid_nodes += 1
            continue

    min_required = max(2, len(sample) // 2)  # at least 50% or 2 nodes
    return valid_nodes >= min_required


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

        if isinstance(wf, dict) and _looks_like_comfyui_workflow(wf):
            wf_out = wf
        if isinstance(pr, dict) and _looks_like_comfyui_prompt_graph(pr):
            pr_out = pr
        elif isinstance(pr, str):
            parsed = _try_parse_json_text(pr)
            if isinstance(parsed, dict) and _looks_like_comfyui_prompt_graph(parsed):
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
        parsed = _parse_json_value(value)

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
        if workflow is None and _looks_like_comfyui_workflow(parsed):
            workflow = parsed
        if prompt is None and _looks_like_comfyui_prompt_graph(parsed):
            prompt = parsed

        # Check prefix usage (workflow: ...)
        if isinstance(value, str):
            text_lower = value.strip().lower()
            if workflow is None and (text_lower.startswith("workflow:") or "workflow" in normalized):
                if _looks_like_comfyui_workflow(parsed):
                    workflow = parsed
            if prompt is None and (text_lower.startswith("prompt:") or "prompt" in normalized):
                if _looks_like_comfyui_prompt_graph(parsed):
                    prompt = parsed

    return workflow, prompt


def _looks_like_prompt_node_id(value: Any) -> bool:
    """
    Accept plain integers or colon-delimited numeric ids (e.g. "91:68").
    """
    if isinstance(value, int):
        return True
    if not isinstance(value, str):
        return False
    parts = value.split(":")
    if not parts:
        return False
    return all(part.isdigit() for part in parts)


def _looks_like_comfyui_prompt_graph(value: Optional[Dict[str, Any]]) -> bool:
    """
    Heuristic check for a ComfyUI prompt graph (the runtime `prompt` dict keyed by node id).

    Expected shape:
      { "3": {"class_type": "...", "inputs": {...}}, ... }
    """
    if not isinstance(value, dict) or not value:
        return False

    # Avoid confusing workflow exports (they have `nodes: []`).
    if "nodes" in value and isinstance(value.get("nodes"), list):
        return False

    keys = list(value.keys())[:8]
    digit_keys = 0
    valid_nodes = 0
    for k in keys:
        if _looks_like_prompt_node_id(k):
            digit_keys += 1
        node = value.get(k)
        if not isinstance(node, dict):
            continue
        ct = node.get("class_type") or node.get("type")
        ins = node.get("inputs")
        if isinstance(ct, str) and isinstance(ins, dict):
            valid_nodes += 1

    return digit_keys >= max(2, len(keys) // 2) and valid_nodes >= max(2, len(keys) // 2)
