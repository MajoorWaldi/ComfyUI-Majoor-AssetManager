"""
Tool detection helpers for ExifTool and FFprobe.
Cached detection to avoid repeated subprocess calls.
"""
import re
import shutil
import subprocess
from typing import Any, Dict, Optional, Tuple

from backend.config import (
    EXIFTOOL_BIN,
    EXIFTOOL_MIN_VERSION,
    FFPROBE_BIN,
    FFPROBE_MIN_VERSION,
)
from backend.shared import get_logger

logger = get_logger(__name__)

# Cache tool availability (None = not checked, True/False = result)
_TOOL_CACHE: Dict[str, Optional[bool]] = {
    "exiftool": None,
    "ffprobe": None,
}

# Cache tool versions
_TOOL_VERSIONS: Dict[str, Optional[str]] = {
    "exiftool": None,
    "ffprobe": None,
}


def parse_tool_version(value: Optional[str]) -> Tuple[int, ...]:
    if not value:
        return ()
    parts = re.findall(r"\d+", value)
    out: list[int] = []
    for part in parts:
        try:
            out.append(int(part))
        except ValueError:
            continue
    return tuple(out)


def version_satisfies_minimum(actual: Optional[str], minimum: str) -> bool:
    if not minimum:
        return True
    minimum_parts = parse_tool_version(minimum)
    if not minimum_parts:
        return True
    actual_parts = parse_tool_version(actual or "")
    if not actual_parts:
        return False
    length = max(len(actual_parts), len(minimum_parts))
    padded_actual = list(actual_parts) + [0] * (length - len(actual_parts))
    padded_minimum = list(minimum_parts) + [0] * (length - len(minimum_parts))
    return tuple(padded_actual) >= tuple(padded_minimum)


def _enforce_min_version(name: str, actual: Optional[str], minimum: str) -> bool:
    if not minimum:
        return True
    if version_satisfies_minimum(actual, minimum):
        return True
    logger.warning(
        "%s version %s does not meet minimum required %s",
        name,
        actual or "<unknown>",
        minimum,
    )
    return False


def _run_command(cmd: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=2,
        check=False,
    )


def has_exiftool() -> bool:
    """Check if ExifTool is available."""
    if _TOOL_CACHE["exiftool"] is not None:
        return _TOOL_CACHE["exiftool"]

    try:
        if shutil.which(EXIFTOOL_BIN) is None:
            logger.debug("ExifTool binary not found in PATH: %s", EXIFTOOL_BIN)
        result = _run_command([EXIFTOOL_BIN, "-ver"])
        available = result.returncode == 0
        _TOOL_CACHE["exiftool"] = available

        if available:
            version = result.stdout.strip()
            _TOOL_VERSIONS["exiftool"] = version
            if not _enforce_min_version("ExifTool", version, EXIFTOOL_MIN_VERSION):
                _TOOL_CACHE["exiftool"] = False
                return False
            logger.info("ExifTool detected: version %s", version)
        else:
            logger.warning("ExifTool not found or failed to start: %s", result.stderr.strip())

        return available
    except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
        logger.warning("ExifTool detection failed: %s", exc)
        _TOOL_CACHE["exiftool"] = False
        return False
    except Exception as exc:
        logger.warning("ExifTool detection raised unexpected error: %s", exc)
        _TOOL_CACHE["exiftool"] = False
        return False


def has_ffprobe() -> bool:
    """Check if FFprobe is available."""
    if _TOOL_CACHE["ffprobe"] is not None:
        return _TOOL_CACHE["ffprobe"]

    try:
        if shutil.which(FFPROBE_BIN) is None:
            logger.debug("FFprobe binary not found in PATH: %s", FFPROBE_BIN)
        result = _run_command([FFPROBE_BIN, "-version"])
        available = result.returncode == 0
        _TOOL_CACHE["ffprobe"] = available

        if available:
            version_line = result.stdout.split("\n")[0] if result.stdout else ""
            version = version_line.strip()
            _TOOL_VERSIONS["ffprobe"] = version
            if not _enforce_min_version("FFprobe", version, FFPROBE_MIN_VERSION):
                _TOOL_CACHE["ffprobe"] = False
                return False
            logger.info("FFprobe detected: %s", version)
        else:
            logger.warning("FFprobe not found or failed to start: %s", result.stderr.strip())

        return available
    except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
        logger.warning("FFprobe detection failed: %s", exc)
        _TOOL_CACHE["ffprobe"] = False
        return False
    except Exception as exc:
        logger.warning("FFprobe detection raised unexpected error: %s", exc)
        _TOOL_CACHE["ffprobe"] = False
        return False


def get_tool_status() -> Dict[str, Any]:
    """
    Get the status of all tools.
    Returns: {
        "exiftool": bool,
        "ffprobe": bool,
        "versions": {
            "exiftool": str | null,
            "ffprobe": str | null
        }
    }
    """
    return {
        "exiftool": has_exiftool(),
        "ffprobe": has_ffprobe(),
        "versions": {
            "exiftool": _TOOL_VERSIONS.get("exiftool"),
            "ffprobe": _TOOL_VERSIONS.get("ffprobe"),
        },
    }


def reset_tool_cache():
    """Reset tool detection cache (for testing or manual refresh)."""
    global _TOOL_CACHE, _TOOL_VERSIONS
    _TOOL_CACHE = {"exiftool": None, "ffprobe": None}
    _TOOL_VERSIONS = {"exiftool": None, "ffprobe": None}
