"""
Audio metadata/geninfo extraction helpers.
"""

from __future__ import annotations

import os
from typing import Any, Dict, Optional, Tuple

from ...shared import ErrorCode, Result
from ..metadata.parsing_utils import (
    looks_like_comfyui_prompt_graph,
    looks_like_comfyui_workflow,
    parse_auto1111_params,
    parse_json_value,
    try_parse_json_text,
)
from ..metadata.extractors import extract_rating_tags_from_exif


def _extract_json_fields(container: Any) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    if not isinstance(container, dict):
        return (None, None)
    workflow = None
    prompt = None
    for key, value in container.items():
        parsed = parse_json_value(value)
        if not isinstance(parsed, dict):
            continue
        key_lower = str(key or "").lower()
        if workflow is None and looks_like_comfyui_workflow(parsed):
            workflow = parsed
        if prompt is None and looks_like_comfyui_prompt_graph(parsed):
            prompt = parsed
        if workflow is None and "workflow" in key_lower and isinstance(parsed, dict):
            workflow = parsed if looks_like_comfyui_workflow(parsed) else workflow
        if prompt is None and "prompt" in key_lower and isinstance(parsed, dict):
            prompt = parsed if looks_like_comfyui_prompt_graph(parsed) else prompt
        if workflow is not None and prompt is not None:
            break
    return (workflow, prompt)


def _unwrap_workflow_prompt_container(container: Any) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    """
    Handle wrapper payloads embedded in a single text field/tag, e.g:
    {"workflow": {...}, "prompt": "{...json...}"}
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
        parsed = try_parse_json_text(pr)
        if isinstance(parsed, dict) and looks_like_comfyui_prompt_graph(parsed):
            pr_out = parsed

    return (wf_out, pr_out)


def _scan_for_workflow_prompt(*containers: Any) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    """
    Robust scan across one or multiple metadata containers.
    """
    workflow: Optional[Dict[str, Any]] = None
    prompt: Optional[Dict[str, Any]] = None

    for container in containers:
        if not isinstance(container, dict):
            continue

        # 1) Fast key-based parse first
        wf, pr = _extract_json_fields(container)
        if workflow is None:
            workflow = wf
        if prompt is None:
            prompt = pr

        # 2) Wrapper scan for JSON values under comments/descriptions
        if workflow is None or prompt is None:
            for _, value in container.items():
                parsed = parse_json_value(value)
                if not isinstance(parsed, dict):
                    continue
                wf2, pr2 = _unwrap_workflow_prompt_container(parsed)
                if workflow is None and wf2 is not None:
                    workflow = wf2
                if prompt is None and pr2 is not None:
                    prompt = pr2
                if workflow is not None and prompt is not None:
                    break

        if workflow is not None and prompt is not None:
            break

    return (workflow, prompt)


def extract_audio_metadata(
    file_path: str,
    exif_data: Optional[Dict[str, Any]] = None,
    ffprobe_data: Optional[Dict[str, Any]] = None,
) -> Result[Dict[str, Any]]:
    """
    Extract audio technical metadata + embedded generation metadata when present.
    """
    if not os.path.exists(file_path):
        return Result.Err(ErrorCode.NOT_FOUND, f"File not found: {file_path}")

    exif_data = exif_data or {}
    ffprobe_data = ffprobe_data or {}
    metadata: Dict[str, Any] = {
        "raw": exif_data,
        "raw_ffprobe": ffprobe_data,
        "workflow": None,
        "prompt": None,
        "parameters": None,
        "duration": None,
        "audio_codec": None,
        "sample_rate": None,
        "channels": None,
        "bitrate": None,
        "quality": "none",
    }

    try:
        audio_stream = {}
        fmt = {}
        if isinstance(ffprobe_data, dict):
            audio_stream = ffprobe_data.get("audio_stream") or {}
            fmt = ffprobe_data.get("format") or {}
        if isinstance(audio_stream, dict):
            metadata["audio_codec"] = audio_stream.get("codec_name")
            metadata["sample_rate"] = audio_stream.get("sample_rate")
            metadata["channels"] = audio_stream.get("channels")
            metadata["bitrate"] = audio_stream.get("bit_rate")
            metadata["duration"] = audio_stream.get("duration")
        if metadata["duration"] is None and isinstance(fmt, dict):
            metadata["duration"] = fmt.get("duration")
            if metadata["bitrate"] is None:
                metadata["bitrate"] = fmt.get("bit_rate")

        format_tags = fmt.get("tags") if isinstance(fmt, dict) and isinstance(fmt.get("tags"), dict) else {}
        stream_tag_dicts = []
        if isinstance(ffprobe_data, dict) and isinstance(ffprobe_data.get("streams"), list):
            for stream in ffprobe_data.get("streams") or []:
                if not isinstance(stream, dict):
                    continue
                tags = stream.get("tags")
                if isinstance(tags, dict):
                    stream_tag_dicts.append(tags)

        workflow, prompt = _scan_for_workflow_prompt(exif_data, format_tags, *stream_tag_dicts)

        if workflow is not None:
            metadata["workflow"] = workflow
            metadata["quality"] = "full"
        if prompt is not None:
            metadata["prompt"] = prompt
            if metadata["quality"] != "full":
                metadata["quality"] = "partial"

        text_candidates = []
        if isinstance(exif_data, dict):
            text_candidates.extend(v for v in exif_data.values() if isinstance(v, str))
        if isinstance(fmt, dict) and isinstance(fmt.get("tags"), dict):
            text_candidates.extend(v for v in fmt.get("tags").values() if isinstance(v, str))
        for text in text_candidates:
            t = str(text or "").strip()
            if t.startswith("{") or t.startswith("["):
                continue
            parsed = parse_auto1111_params(text)
            if not parsed:
                continue
            metadata["parameters"] = text
            # Preserve already-parsed ComfyUI structures. Some free-text fields can
            # produce a "prompt" string via A1111 parser and must not clobber a real
            # prompt graph dict extracted from metadata tags.
            for key, value in parsed.items():
                if key in ("workflow", "prompt") and isinstance(metadata.get(key), dict):
                    continue
                metadata[key] = value
            if metadata["quality"] != "full":
                metadata["quality"] = "partial"
            break

        rating, tags = extract_rating_tags_from_exif(exif_data)
        if rating is not None:
            metadata["rating"] = rating
        if tags:
            metadata["tags"] = tags

        if metadata["quality"] == "none" and (exif_data or ffprobe_data):
            metadata["quality"] = "partial"

        return Result.Ok(metadata, quality=metadata["quality"])
    except Exception as exc:
        return Result.Err(ErrorCode.PARSE_ERROR, str(exc), quality="degraded")
