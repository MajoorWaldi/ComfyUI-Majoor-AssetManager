"""
Runtime watcher tuning knobs (debounce + dedupe) that can be updated without restarting.
"""
from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Optional

from backend.config import WATCHER_DEFAULT_DEBOUNCE_MS, WATCHER_DEFAULT_DEDUPE_TTL_MS


@dataclass(frozen=True)
class WatcherSettings:
    debounce_ms: int
    dedupe_ttl_ms: int


_lock = threading.Lock()
_state = {
    "debounce_ms": max(50, int(WATCHER_DEFAULT_DEBOUNCE_MS)),
    "dedupe_ttl_ms": max(100, int(WATCHER_DEFAULT_DEDUPE_TTL_MS)),
}


def _clamp(value: int, minimum: int, maximum: int) -> int:
    return max(minimum, min(maximum, value))


def get_watcher_settings() -> WatcherSettings:
    with _lock:
        return WatcherSettings(
            debounce_ms=_state["debounce_ms"],
            dedupe_ttl_ms=_state["dedupe_ttl_ms"],
        )


def update_watcher_settings(*, debounce_ms: Optional[int] = None, dedupe_ttl_ms: Optional[int] = None) -> WatcherSettings:
    with _lock:
        if debounce_ms is not None:
            _state["debounce_ms"] = _clamp(int(debounce_ms), 50, 5000)
        if dedupe_ttl_ms is not None:
            _state["dedupe_ttl_ms"] = _clamp(int(dedupe_ttl_ms), 100, 30_000)
        return get_watcher_settings()
