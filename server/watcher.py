"""
File system watcher using the `watchdog` library to trigger real-time reindexing.
This is an optional feature. If watchdog is not installed, real-time indexing will be disabled.
"""

import threading
import time
from typing import Optional, Dict, Set
import itertools

from .config import OUTPUT_ROOT
from .logger import get_logger
from .utils import IMAGE_EXTS, VIDEO_EXTS, AUDIO_EXTS, MODEL3D_EXTS

log = get_logger(__name__)

try:
    from watchdog.observers import Observer
    from watchdog.events import PatternMatchingEventHandler, FileSystemEvent, FileSystemMovedEvent
    WATCHDOG_AVAILABLE = True
except ModuleNotFoundError:
    # Create dummy classes to prevent import errors elsewhere
    class Observer: pass
    class PatternMatchingEventHandler: pass
    class FileSystemEvent: pass
    class FileSystemMovedEvent: pass
    WATCHDOG_AVAILABLE = False

_observer: Optional[Observer] = None
_observer_thread: Optional[threading.Thread] = None

# Debounce mechanism to handle files being written in chunks
_pending_reindex: Dict[str, float] = {}  # path -> timestamp
_pending_lock = threading.Lock()
_debounce_thread: Optional[threading.Thread] = None
_debounce_shutdown = threading.Event()
DEBOUNCE_DELAY = 1.0  # Wait 1 second after last modification before indexing

# Patterns for files we want to track
all_exts = itertools.chain(IMAGE_EXTS, VIDEO_EXTS, AUDIO_EXTS, MODEL3D_EXTS)
PATTERNS = [f"*{ext}" for ext in all_exts]
IGNORE_PATTERNS = [
    "*/.mjr_batch_*.zip",
    "*/_mjr_collections/*",
    "*/_mjr_index/*"
]

def _debounce_worker():
    """Background worker that processes pending reindex requests after debounce delay."""
    from .index_db import reindex_paths

    while not _debounce_shutdown.is_set():
        time.sleep(0.5)  # Check every 500ms

        now = time.time()
        ready_paths = []

        with _pending_lock:
            # Find paths that have been quiet for DEBOUNCE_DELAY seconds
            for path, timestamp in list(_pending_reindex.items()):
                if now - timestamp >= DEBOUNCE_DELAY:
                    ready_paths.append(path)
                    del _pending_reindex[path]

        if ready_paths:
            log.debug(f"📁🔍 [Watcher] Debounce completed for {len(ready_paths)} file(s), indexing...")
            try:
                reindex_paths(ready_paths)
            except Exception as e:
                log.error(f"📁❌ [Watcher] Debounced reindex failed: {e}")

def _schedule_reindex(path: str):
    """Schedule a path for reindexing with debounce delay."""
    with _pending_lock:
        _pending_reindex[path] = time.time()
        log.debug(f"📁⏱️ [Watcher] Scheduled debounced reindex: {path}")

class AssetWatcherHandler(PatternMatchingEventHandler):
    """Handles file system events and triggers reindexing."""

    def __init__(self):
        if not WATCHDOG_AVAILABLE:
            return
        super().__init__(patterns=PATTERNS, ignore_patterns=IGNORE_PATTERNS, ignore_directories=True, case_sensitive=False)

    def _get_asset_id_from_path(self, path: str) -> Optional[str]:
        """Helper to construct asset ID from a file path."""
        try:
            from .index_db import _make_asset_id  # Import here to avoid circular dependency
            import os
            from pathlib import Path

            rel_path = os.path.relpath(path, OUTPUT_ROOT)
            parts = Path(rel_path).parts

            if len(parts) == 1:
                type_name = "output"
                subfolder = ""
                filename = parts[0]
            else:
                # This logic should be kept in sync with index_db.reindex_all
                type_name = "output"
                subfolder = os.path.join(*parts[:-1])
                filename = parts[-1]

            return _make_asset_id(type_name, subfolder, filename)
        except Exception:
            return None

    def on_created(self, event: FileSystemEvent):
        log.debug(f"📁🔍 [Watcher] Created: {event.src_path}")
        # Use debounce to avoid race condition with file still being written
        _schedule_reindex(event.src_path)

    def on_deleted(self, event: FileSystemEvent):
        from .index_db import delete_asset  # Import here to avoid circular dependency
        log.debug(f"📁🔍 [Watcher] Deleted: {event.src_path}")

        # Remove from pending reindex if scheduled
        with _pending_lock:
            _pending_reindex.pop(event.src_path, None)

        # Delete immediately (no debounce needed for deletion)
        asset_id = self._get_asset_id_from_path(event.src_path)
        if asset_id:
            try:
                delete_asset(asset_id)
            except Exception as e:
                log.error(f"📁❌ [Watcher] Failed to delete asset {asset_id}: {e}")

    def on_modified(self, event: FileSystemEvent):
        log.debug(f"📁🔍 [Watcher] Modified: {event.src_path}")
        # Use debounce - updates timestamp if already scheduled
        # This handles files being written in chunks (multiple modify events)
        _schedule_reindex(event.src_path)

    def on_moved(self, event: FileSystemMovedEvent):
        from .index_db import delete_asset  # Import here to avoid circular dependency
        log.debug(f"📁🔍 [Watcher] Moved: {event.src_path} to {event.dest_path}")

        # Remove old path from pending if scheduled
        with _pending_lock:
            _pending_reindex.pop(event.src_path, None)

        # Delete the old record immediately
        old_asset_id = self._get_asset_id_from_path(event.src_path)
        if old_asset_id:
            try:
                delete_asset(old_asset_id)
            except Exception as e:
                log.error(f"📁❌ [Watcher] Failed to delete moved asset {old_asset_id}: {e}")

        # Schedule reindex for new path (debounced in case move is still in progress)
        _schedule_reindex(event.dest_path)

def start_watcher(path: str = OUTPUT_ROOT) -> None:
    """Starts the file system watcher in a background thread."""
    global _observer, _observer_thread, _debounce_thread
    if not WATCHDOG_AVAILABLE:
        log.warning("📁⚠️ [Watcher] Watchdog library not found. Real-time indexing is disabled.")
        log.warning("📁⚠️ [Watcher] To enable, run: pip install watchdog")
        return

    if _observer and _observer.is_alive():
        log.warning("📁⚠️ [Watcher] Watcher is already running.")
        return

    # Start debounce worker thread
    _debounce_shutdown.clear()
    _debounce_thread = threading.Thread(target=_debounce_worker, daemon=True, name="MajoorDebounceWorker")
    _debounce_thread.start()
    log.debug("📁✅ [Watcher] Debounce worker started")

    event_handler = AssetWatcherHandler()
    _observer = Observer()
    _observer.schedule(event_handler, path, recursive=True)

    def run():
        log.info(f"📁✅ [Watcher] Starting file system watcher on: {path}")
        _observer.start()
        try:
            while _observer and _observer.is_alive():
                _observer.join(1)
        except Exception as e:
            log.error(f"📁❌ [Watcher] Watcher thread encountered an error: {e}")
        finally:
            if _observer:
                _observer.stop()
                _observer.join()
            log.info("[Watcher] File system watcher stopped.")

    _observer_thread = threading.Thread(target=run, daemon=True)
    _observer_thread.start()

def stop_watcher() -> None:
    """Stops the file system watcher."""
    global _observer, _debounce_thread
    if not WATCHDOG_AVAILABLE:
        return

    # Stop debounce worker
    _debounce_shutdown.set()
    if _debounce_thread:
        _debounce_thread.join(timeout=5.0)
        _debounce_thread = None
        log.debug("📁✅ [Watcher] Debounce worker stopped")

    if _observer:
        _observer.stop()
        # The join is handled in the thread itself
        _observer = None

