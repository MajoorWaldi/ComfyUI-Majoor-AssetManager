from __future__ import annotations
from typing import Dict

from .utils import load_metadata, save_metadata, update_metadata_with_windows as _update_metadata_with_windows


def get_metadata(path: str) -> Dict:
    """Load sidecar JSON (or fallback) for the given path."""
    return load_metadata(path)


def update_metadata(path: str, updates: dict) -> Dict:
    """Update and persist the sidecar JSON for a file."""
    meta = load_metadata(path)
    meta.update(updates or {})
    save_metadata(path, meta)
    return meta


def update_metadata_with_windows(path: str, updates: dict) -> Dict:
    """Delegate to the canonical implementation in utils to avoid divergence."""
    return _update_metadata_with_windows(path, updates)


__all__ = ["get_metadata", "update_metadata", "update_metadata_with_windows"]
