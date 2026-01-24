"""
Best-effort filesystem event watcher for invalidating directory listing caches.

Uses watchdog when available; must never raise to callers (anti-crash rule).
"""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Dict, Optional

from backend.shared import get_logger

logger = get_logger(__name__)

_LOCK = threading.Lock()
_OBSERVER = None
_TOKENS: Dict[str, int] = {}
_WATCHED: Dict[str, object] = {}


def _normalize_watch_path(path: str) -> Optional[str]:
    try:
        if not path:
            return None
        return str(Path(path).resolve())
    except Exception:
        return None


def _bump(path_key: str) -> None:
    try:
        with _LOCK:
            _TOKENS[path_key] = int(_TOKENS.get(path_key, 0)) + 1
    except Exception:
        return


def get_fs_list_cache_token(path: str) -> int:
    """
    Returns a monotonically increasing token for the watched root directory.
    If the directory is not watched, returns 0.
    """
    key = _normalize_watch_path(path)
    if not key:
        return 0
    try:
        with _LOCK:
            return int(_TOKENS.get(key, 0))
    except Exception:
        return 0


def ensure_fs_list_cache_watching(path: str) -> None:
    """
    Ensure watchdog observer is running and watching `path` recursively.
    Safe no-op if watchdog is unavailable or path cannot be watched.
    """
    key = _normalize_watch_path(path)
    if not key:
        return

    try:
        # Lazy import: watchdog is optional at runtime.
        from watchdog.events import FileSystemEventHandler
        from watchdog.observers import Observer
    except Exception:
        return

    try:
        with _LOCK:
            global _OBSERVER
            if _OBSERVER is None:
                obs = Observer()
                try:
                    obs.daemon = True
                except Exception:
                    pass
                try:
                    obs.start()
                except Exception as exc:
                    logger.debug("Failed to start watchdog observer: %s", exc)
                    return
                _OBSERVER = obs

            if key in _WATCHED:
                return

            class _Handler(FileSystemEventHandler):
                def on_any_event(self, event):  # type: ignore[override]
                    try:
                        _bump(key)
                    except Exception:
                        return

            handler = _Handler()
            try:
                watch = _OBSERVER.schedule(handler, key, recursive=True)
            except Exception as exc:
                logger.debug("Failed to watch path %s: %s", key, exc)
                return

            _WATCHED[key] = watch
            _TOKENS.setdefault(key, 0)
    except Exception:
        return


def stop_global_fs_list_cache_watcher() -> None:
    """
    Stop the global observer (called on service disposal).
    Safe to call multiple times.
    """
    try:
        with _LOCK:
            global _OBSERVER
            obs = _OBSERVER
            _OBSERVER = None
            _WATCHED.clear()
            _TOKENS.clear()
    except Exception:
        obs = None

    if not obs:
        return

    try:
        obs.stop()
    except Exception:
        pass
    try:
        obs.join(timeout=2.0)
    except Exception:
        pass

