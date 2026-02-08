from __future__ import annotations

from typing import Any

import pytest
from backend.routes.handlers import filesystem


class _RaisingPending(dict):
    def __contains__(self, key: Any) -> bool:
        raise RuntimeError("boom")

    def __setitem__(self, key: Any, value: Any) -> None:
        raise RuntimeError("boom")
        
    def __delitem__(self, key: Any) -> None:
        raise RuntimeError("boom")


@pytest.mark.asyncio
async def test_kickoff_background_scan_does_not_update_throttle_marker_if_enqueue_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Avoid starting a real background task
    monkeypatch.setattr(filesystem, "_ensure_worker", lambda: None)

    # Force the enqueue path to fail deterministically.
    monkeypatch.setattr(filesystem, "_SCAN_PENDING", _RaisingPending())

    filesystem._BACKGROUND_SCAN_LAST.clear()

    await filesystem._kickoff_background_scan(
        "C:/tmp",
        source="output",
        root_id=None,
        min_interval_seconds=9999.0,
    )
    
    # Validation: because the inner block raised (which is caught inside kickoff), 
    # the line `_BACKGROUND_SCAN_LAST[key] = now` should NOT have been reached.
    assert len(filesystem._BACKGROUND_SCAN_LAST) == 0
