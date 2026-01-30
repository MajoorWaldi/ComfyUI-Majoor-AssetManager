import pytest
import time


@pytest.mark.asyncio
async def test_directory_watcher_can_restart_same_instance():
    from backend.features.index.watcher import DirectoryWatcher
    from backend.shared import Result

    class DummyIndexService:
        def scan_directory(self, *args, **kwargs):
            return Result.Ok(True)

    watcher = DirectoryWatcher(
        index_service=DummyIndexService(),
        directories=[],
        interval_seconds=0.01,
        join_timeout=0.2,
    )

    watcher.start()
    assert watcher.is_alive()
    time.sleep(0.03)
    watcher.stop()
    assert not watcher.is_alive()

    # Restart should not raise RuntimeError (Thread started twice)
    watcher.start()
    assert watcher.is_alive()
    watcher.stop()
    assert not watcher.is_alive()

