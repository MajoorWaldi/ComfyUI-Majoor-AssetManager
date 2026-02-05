"""
Throttle helpers so background scans can skip directories that were just indexed.
"""
from __future__ import annotations

import os
import threading
import time
from pathlib import Path
from typing import Optional

from backend.config import MANUAL_BG_SCAN_GRACE_SECONDS

_LOCK = threading.Lock()
_MANUAL_SCAN_TIMES: dict[str, float] = {}
_MAX_ENTRY_AGE = max(600, int(MANUAL_BG_SCAN_GRACE_SECONDS * 5))


def normalize_scan_directory(directory: str) -> str:
    """Normalize and resolve a directory path for consistent throttling keys."""
    if not directory:
        return ""
    try:
        resolved = Path(directory).resolve()
        return str(resolved)
    except Exception:
        try:
            return os.path.abspath(directory)
        except Exception:
            return str(directory)


def _scan_key(directory: str, source: str, root_id: Optional[str]) -> str:
    norm_dir = normalize_scan_directory(directory or "")
    return f"{str(source or 'output')}|{str(root_id or '')}|{norm_dir}"


def mark_directory_indexed(
    directory: str,
    source: str = "output",
    root_id: Optional[str] = None,
    metadata_complete: bool = True,
) -> None:
    """
    Record that a directory was just re-indexed, so we can skip redundant background scans.
    Only mark directories when metadata extraction completed (`metadata_complete=True`).
    """
    if not metadata_complete:
        return
    now = time.time()
    key = _scan_key(directory, source, root_id)
    with _LOCK:
        _MANUAL_SCAN_TIMES[key] = now
        _cleanup_locked(now)


def should_skip_background_scan(
    directory: str,
    source: str = "output",
    root_id: Optional[str] = None,
    grace_seconds: float = MANUAL_BG_SCAN_GRACE_SECONDS,
) -> bool:
    """
    Return True if a recent manual index was recorded for the same directory/source/root.
    """
    now = time.time()
    key = _scan_key(directory, source, root_id)
    with _LOCK:
        ts = _MANUAL_SCAN_TIMES.get(key)
        if ts is None:
            return False
        if now - ts < grace_seconds:
            return True
        if now - ts > _MAX_ENTRY_AGE:
            del _MANUAL_SCAN_TIMES[key]
    return False


def _cleanup_locked(now: float) -> None:
    """Prune old entries (expects caller to hold `_LOCK`)."""
    cutoff = now - _MAX_ENTRY_AGE
    keys_to_remove = [k for k, v in _MANUAL_SCAN_TIMES.items() if v < cutoff]
    for k in keys_to_remove:
        _MANUAL_SCAN_TIMES.pop(k, None)
