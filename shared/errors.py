"""
Shared helpers for sanitizing error messages before they reach clients.
"""
from __future__ import annotations

import os
import re
from typing import Any

from .log import get_logger

logger = get_logger(__name__)
_DEBUG_MODE = os.getenv("MJR_DEBUG", "").strip().lower() in ("1", "true", "yes", "on")
_WINDOWS_PATH_RE = re.compile(r"[A-Za-z]:\\[^\s]+")
_UNIX_PATH_RE = re.compile(r"/[^\s]+")


def _mask_paths(value: str) -> str:
    """Mask path-looking substrings to avoid leaking filesystem structure."""
    cleaned = _WINDOWS_PATH_RE.sub("[path]", value)
    cleaned = _UNIX_PATH_RE.sub("[path]", cleaned)
    return cleaned


def sanitize_error_message(exc: Any, fallback: str) -> str:
    """
    Build a safe error message for clients.

    Args:
        exc: Exception or raw value to sanitize.
        fallback: Fallback message to show when nothing meaningful remains.

    Returns:
        A string suitable for inclusion in API responses.
    """
    if not fallback:
        fallback = "An error occurred"

    if exc is None:
        return fallback

    try:
        raw = str(exc)
    except Exception:
        raw = ""

    if not raw:
        return fallback

    sanitized = _mask_paths(raw.replace(os.getcwd(), "[cwd]"))
    sanitized = " ".join(sanitized.splitlines()).strip()

    if _DEBUG_MODE:
        logger.debug("Sanitized error payload: %s", sanitized, exc_info=True)

    if sanitized:
        return f"{fallback}: {sanitized[:200]}"
    return fallback
