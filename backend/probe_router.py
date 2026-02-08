"""
ProbeRouter: Decides which metadata extraction tools to use based on settings.
"""
from typing import List
from pathlib import Path

from backend.config import MEDIA_PROBE_BACKEND
from backend.tool_detect import has_exiftool, has_ffprobe
from backend.shared import get_logger
from backend.features.audio import AUDIO_EXTENSIONS

logger = get_logger(__name__)

# Video extensions
VIDEO_EXTS = {'.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v', '.flv', '.wmv', '.mpg', '.mpeg'}


def pick_probe_backend(
    filepath: str | Path,
    want_generation_tags: bool = True,
    settings_override: str | None = None
) -> List[str]:
    """
    Pick which probe backend(s) to use for metadata extraction.

    Args:
        filepath: Path to the file being probed
        want_generation_tags: Whether generation metadata (prompt/workflow) is needed
        settings_override: Override the global MEDIA_PROBE_BACKEND setting

    Returns:
        List of backends to use, in order: ["exiftool"], ["ffprobe"], or ["exiftool", "ffprobe"]
    """
    mode = settings_override or MEDIA_PROBE_BACKEND

    # Validate mode
    if mode not in ("auto", "exiftool", "ffprobe", "both"):
        logger.warning(f"Invalid media_probe_backend '{mode}', falling back to 'auto'")
        mode = "auto"

    # Determine file type
    ext = Path(filepath).suffix.lower()
    is_video = ext in VIDEO_EXTS
    is_audio = ext in AUDIO_EXTENSIONS

    # Simple modes
    if mode == "exiftool":
        if has_exiftool():
            return ["exiftool"]
        logger.warning("ExifTool requested but not available, trying ffprobe")
        if has_ffprobe():
            return ["ffprobe"]
        return []

    if mode == "ffprobe":
        if has_ffprobe():
            return ["ffprobe"]
        logger.warning("FFprobe requested but not available, trying exiftool")
        if has_exiftool():
            return ["exiftool"]
        return []

    if mode == "both":
        tools = []
        if has_exiftool():
            tools.append("exiftool")
        if has_ffprobe():
            tools.append("ffprobe")
        return tools

    # Auto mode (recommended)
    if mode == "auto":
        if is_video or is_audio:
            # For videos: use both if available
            # ExifTool for generation tags, FFprobe for tech metadata
            tools = []
            if has_exiftool():
                tools.append("exiftool")
            if has_ffprobe():
                tools.append("ffprobe")
            return tools if tools else []
        else:
            # For images: ExifTool is sufficient
            if has_exiftool():
                return ["exiftool"]
            # Fallback to ffprobe if available (won't get generation tags though)
            if has_ffprobe():
                logger.debug("Using ffprobe for image (ExifTool not available)")
                return ["ffprobe"]
            return []

    return []


def get_probe_strategy_description(filepath: str | Path) -> str:
    """
    Get a human-readable description of the probe strategy for a file.
    Useful for debugging/logging.
    """
    backends = pick_probe_backend(filepath)
    if not backends:
        return "No probe backends available"
    if len(backends) == 1:
        return f"Using {backends[0]} only"
    return f"Using {' + '.join(backends)}"
