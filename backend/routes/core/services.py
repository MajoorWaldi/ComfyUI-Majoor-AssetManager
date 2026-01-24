"""
Service management and initialization.
"""
import threading
from backend.deps import build_services
from backend.shared import Result, get_logger

logger = get_logger(__name__)

_services = None
_services_error = None
_services_lock = threading.Lock()


def _dispose_services():
    """
    Dispose of all services, ensuring each resource is cleaned up independently.
    Errors in one service disposal do not prevent others from being disposed.
    """
    global _services
    if not _services:
        return

    disposal_errors = []

    # Dispose database connection
    db = _services.get("db")
    if db:
        try:
            db.close()
            logger.debug("Database connection closed successfully")
        except Exception as exc:
            error_msg = f"Error closing database: {exc}"
            logger.warning(error_msg, exc_info=True)
            disposal_errors.append(error_msg)

    # Dispose watcher
    watcher = _services.get("watcher")
    if watcher:
        try:
            watcher.stop()
            logger.debug("File watcher stopped successfully")
        except Exception as exc:
            error_msg = f"Error stopping watcher: {exc}"
            logger.warning(error_msg, exc_info=True)
            disposal_errors.append(error_msg)

    # Stop filesystem list cache watcher (watchdog) if any.
    try:
        from backend.adapters.fs.list_cache_watcher import stop_global_fs_list_cache_watcher

        stop_global_fs_list_cache_watcher()
    except Exception as exc:
        try:
            logger.debug("Error stopping fs cache watcher: %s", exc)
        except Exception:
            pass

    # Clear services reference
    _services = None

    # Log summary if there were any errors
    if disposal_errors:
        logger.warning("Service disposal completed with %d error(s)", len(disposal_errors))


def _build_services(force: bool = False):
    global _services, _services_error
    with _services_lock:
        if _services and not force:
            return _services

        if force:
            _dispose_services()

        try:
            _services = build_services()
            _services_error = None
            return _services
        except Exception as exc:
            _services_error = str(exc)
            logger.error(f"Failed to initialize services: {exc}", exc_info=True)
            _services = None
            return None


def _require_services():
    services = _build_services()
    if services:
        return services, None
    return None, Result.Err(
        "SERVICE_UNAVAILABLE",
        "Services are unavailable",
        detail=_services_error or "Initialization failed"
    )


def get_services_error():
    """Get the current services error if any."""
    return _services_error
