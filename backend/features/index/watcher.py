"""
Lightweight directory watcher that triggers incremental scans.
Replaced with Watchdog for real-time event handling.
"""
from __future__ import annotations

import logging
import threading
import asyncio
import time
from pathlib import Path
from typing import Dict, Iterable, Optional

from .service import IndexService
from ...shared import get_logger
from ...config import WATCHER_JOIN_TIMEOUT

logger = get_logger(__name__)

try:
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler
    HAS_WATCHDOG = True
except ImportError:
    HAS_WATCHDOG = False
    class Observer:
        def schedule(self, *args, **kwargs): pass
        def start(self): pass
        def stop(self): pass
        def join(self, **kwargs): pass
    class FileSystemEventHandler: 
        pass
    logger.warning("Watchdog module not found. Real-time file watching will be disabled.")


class IndexEventHandler(FileSystemEventHandler):
    """Handles file system events and queues index updates."""
    
    def __init__(self, watcher):
        self.watcher = watcher
        self.last_events: Dict[str, float] = {}
        self.debounce_seconds = 1.0

    def _is_valid_file(self, path_str: str) -> bool:
        try:
            p = Path(path_str)
            if p.name.startswith(".") or not p.name:
                return False
            
            # Ignore SQLite database files and journals to prevent feedback loops
            # when the DB is located within the watched directory.
            name_lower = p.name.lower()
            if (name_lower.endswith(".db") or 
                name_lower.endswith(".db-journal") or 
                name_lower.endswith(".db-shm") or 
                name_lower.endswith(".db-wal") or
                name_lower.endswith(".sqlite") or
                name_lower.endswith(".sqlite3") or
                "-journal" in name_lower):
                return False

            # Ignore common temp extensions and partial downloads
            if p.suffix.lower() in {".tmp", ".crdownload", ".part", ".lock", ".aria2"}:
                return False
            return True
        except Exception:
            return False

    def _debounce(self, filepath: str) -> bool:
        # Simple debounce to avoid double-processing (created + modified)
        now = time.time()
        last = self.last_events.get(filepath, 0)
        if now - last < self.debounce_seconds:
            return True
        self.last_events[filepath] = now
        # Cleanup old entries
        if len(self.last_events) > 1000:
            self.last_events.clear() 
        return False

    def on_created(self, event):
        if event.is_directory or not self._is_valid_file(event.src_path):
            return
        if self._debounce(event.src_path):
            return
        # logger.debug(f"Watcher: Created {event.src_path}")
        self.watcher.queue_update(event.src_path, action="add")

    def on_moved(self, event):
        if event.is_directory:
            return
        
        # REMOVE old path
        if self._is_valid_file(event.src_path):
            # logger.debug(f"Watcher: Moved from {event.src_path}")
            self.watcher.queue_update(event.src_path, action="remove")
            
        # ADD new path
        if self._is_valid_file(event.dest_path):
            # logger.debug(f"Watcher: Moved to {event.dest_path}")
            self.watcher.queue_update(event.dest_path, action="add")

    def on_deleted(self, event):
        if event.is_directory:
            return
        # logger.debug(f"Watcher: Deleted {event.src_path}")
        self.watcher.queue_update(event.src_path, action="remove")

    def on_modified(self, event):
        if event.is_directory or not self._is_valid_file(event.src_path):
            return
        if self._debounce(event.src_path):
            return
        # logger.debug(f"Watcher: Modified {event.src_path}")
        self.watcher.queue_update(event.src_path, action="add")


class DirectoryWatcher:
    """Uses watchdog to listen for file events without full rescans."""

    def __init__(
        self,
        index_service: IndexService,
        directories: Iterable[str],
        interval_seconds: Optional[float] = None, # Deprecated/Unused
        join_timeout: Optional[float] = None
    ):
        self.index_service = index_service
        self.directories = [Path(dir_path).resolve() for dir_path in directories if dir_path]
        # NOTE: Do NOT cache the event loop here. The loop may not exist yet at __init__ time
        # (e.g., when DirectoryWatcher is instantiated before asyncio.run()). Instead, we
        # fetch the running loop dynamically in queue_update() and _setup_observer().
        self._join_timeout = join_timeout if join_timeout is not None else WATCHER_JOIN_TIMEOUT
        self._observer = None
        self._shutdown = False
        
        if not HAS_WATCHDOG:
             logger.warning("File watcher disabled: Watchdog module missing. Manual refresh required.")

    def _setup_observer(self):
        if not HAS_WATCHDOG:
            return None
        
        observer = Observer()
        handler = IndexEventHandler(self)
        scheduled = 0
        for d in self.directories:
            if d.exists() and d.is_dir():
                try:
                    observer.schedule(handler, str(d), recursive=True)
                    scheduled += 1
                except Exception as exc:
                    logger.warning(f"Failed to watch {d}: {exc}")
        
        if scheduled > 0:
            logger.info(f"File watcher initialized for {scheduled} directories (Mode: Event-Driven/Watchdog)")
        return observer

    def start(self):
        """Start the background watcher thread."""
        if self._observer and self._observer.is_alive():
            return

        self._observer = self._setup_observer()
        if self._observer:
            try:
                self._observer.start()
                logger.info("File watcher started (event-based)")
            except Exception as exc:
                logger.error(f"Failed to start file watcher: {exc}")

    def stop(self):
        """Request the watcher thread to stop."""
        self._shutdown = True
        if self._observer:
            try:
                self._observer.stop()
                self._observer.join(timeout=self._join_timeout)
            except Exception:
                pass
        logger.info("File watcher stopped")

    def is_alive(self) -> bool:
        """Return True if the watcher thread is running."""
        return self._observer.is_alive() if self._observer else False

    def queue_update(self, filepath: str, action: str):
        if self._shutdown:
            return
        
        # Capture values needed in the coroutine (avoid closure issues)
        _filepath = str(filepath)
        _action = str(action)
        _directories = list(self.directories)
        _index_service = self.index_service
            
        async def _process():
            try:
                # Small delay to allow file writes to settle (e.g. copy paste)
                if _action == "add":
                    await asyncio.sleep(0.5)
                
                if _action == "remove":
                    await _index_service.remove_file(_filepath)
                elif _action == "add":
                    # Determine base dir for relative path calculation
                    path_obj = Path(_filepath)
                    base_dir = str(path_obj.parent)
                    for d in _directories:
                        if str(d) in _filepath:
                            base_dir = str(d)
                            break
                    
                    await _index_service.index_paths(
                        paths=[path_obj],
                        base_dir=base_dir,
                        incremental=True,
                        source="output" # Default to output, logic could be refined
                    )
            except Exception as exc:
                logger.debug(f"Watcher update processing failed for {_filepath}: {exc}")

        try:
            # Get the running loop dynamically (may have changed since __init__)
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                # No running loop - try to get the default loop (may not exist)
                try:
                    loop = asyncio.get_event_loop()
                    if loop.is_closed():
                        logger.debug("Event loop is closed, cannot queue watcher update")
                        return
                except RuntimeError:
                    logger.debug("No event loop available for watcher update")
                    return
            
            asyncio.run_coroutine_threadsafe(_process(), loop)
        except Exception as exc:
            logger.debug(f"Failed to queue watcher update: {exc}")

# Legacy implementation removed. Watchdog is now required for auto-updates without full scan.

