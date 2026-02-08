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

        workflow, prompt = _extract_json_fields(exif_data)
        if isinstance(fmt, dict):
            wf2, pr2 = _extract_json_fields(fmt.get("tags"))
            workflow = workflow or wf2
            prompt = prompt or pr2

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
            metadata.update(parsed)
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
