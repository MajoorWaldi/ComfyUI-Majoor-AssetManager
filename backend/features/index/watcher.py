"""
Lightweight directory watcher that triggers incremental scans.
"""
import logging
import threading
import asyncio
from pathlib import Path
from typing import Iterable, Optional

from .service import IndexService
from ...shared import get_logger
from ...config import WATCHER_INTERVAL_SECONDS, WATCHER_JOIN_TIMEOUT

logger = get_logger(__name__)


class DirectoryWatcher:
    """Polls directories and enqueues scans when changes may exist."""

    def __init__(
        self,
        index_service: IndexService,
        directories: Iterable[str],
        interval_seconds: Optional[float] = None,
        join_timeout: Optional[float] = None
    ):
        self.index_service = index_service
        self.directories = [Path(dir_path).resolve() for dir_path in directories if dir_path]
        try:
            self._loop = asyncio.get_running_loop()
        except RuntimeError:
            self._loop = asyncio.get_event_loop()
        self.interval = interval_seconds or WATCHER_INTERVAL_SECONDS
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()
        self._join_timeout = join_timeout if join_timeout is not None else WATCHER_JOIN_TIMEOUT

    def _create_thread(self) -> threading.Thread:
        return threading.Thread(target=self._run, daemon=True)

    def start(self):
        """Start the background watcher thread (idempotent)."""
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return

            # Allow restart on the same instance
            self._stop_event.clear()
            self._thread = self._create_thread()
            self._thread.start()

        logger.info("File watcher started", extra={"directories": [str(d) for d in self.directories]})

    def stop(self):
        """Request the watcher thread to stop and join it (best-effort)."""
        self._stop_event.set()

        with self._lock:
            thread = self._thread

        if not thread:
            return

        # Avoid deadlocking if stop is (unexpectedly) called from the watcher thread itself.
        if thread is threading.current_thread():
            return

        try:
            thread.join(timeout=self._join_timeout)
        except Exception as exc:
            logger.warning("Exception during watcher thread join: %s", exc)
            return

        if thread.is_alive():
            logger.warning(
                "File watcher thread did not stop within timeout (%.2fs). Thread will be abandoned as daemon.",
                self._join_timeout,
            )
            return

        with self._lock:
            if self._thread is thread:
                self._thread = None
        logger.info("File watcher stopped successfully")

    def is_alive(self) -> bool:
        """Return True if the watcher thread is currently running."""
        with self._lock:
            return bool(self._thread and self._thread.is_alive())

    def _run(self):
        while not self._stop_event.is_set():
            for directory in self.directories:
                if self._stop_event.is_set():
                    break
                # Check existence but handle gracefully if directory disappears during scan.
                # This is a benign TOCTOU - if it disappears mid-scan, scan_directory will
                # return an error which we log and continue.
                try:
                    exists = directory.exists()
                except Exception as exc:
                    logger.debug("Watcher cannot stat directory %s: %s", directory, exc)
                    exists = False

                if not exists:
                    # Avoid busy-looping when watched path disappears
                    self._stop_event.wait(self.interval)
                    continue

                try:
                    future = asyncio.run_coroutine_threadsafe(
                        self.index_service.scan_directory(str(directory), recursive=True, incremental=True),
                        self._loop
                    )
                    scan_result = future.result()
                    if not scan_result.ok:
                        logger.warning(
                            "Watcher scan reported issues for %s: %s (code=%s)",
                            directory, scan_result.error, getattr(scan_result, 'code', 'UNKNOWN')
                        )
                except Exception as exc:
                    logger.warning("Watcher scan failed for %s: %s", directory, exc)
            self._stop_event.wait(self.interval)
