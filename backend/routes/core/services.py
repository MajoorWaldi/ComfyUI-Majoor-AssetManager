"""
Service management and initialization.
"""
import asyncio
from backend.deps import build_services
from backend.shared import Result, get_logger

logger = get_logger(__name__)

_services = None
_services_error = None
_services_lock = asyncio.Lock()


async def _dispose_services():
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
            await db.aclose()
            logger.debug("Database connection closed successfully")
        except Exception as exc:
            error_msg = f"Error closing database: {exc}"
            logger.warning(error_msg, exc_info=True)
            disposal_errors.append(error_msg)

    # Clear services reference
    _services = None

    # Log summary if there were any errors
    if disposal_errors:
        logger.warning("Service disposal completed with %d error(s)", len(disposal_errors))


async def _build_services(force: bool = False):
    global _services, _services_error
    async with _services_lock:
        if _services and not force:
            return _services

        if force:
            await _dispose_services()

        try:
            services_result = await build_services()
        except Exception as exc:
            _services_error = str(exc)
            logger.error(f"Failed to initialize services: {exc}", exc_info=True)
            _services = None
            return None

        if not services_result or not getattr(services_result, "ok", False):
            _services_error = getattr(services_result, "error", None) or "Initialization failed"
            logger.error("Failed to initialize services: %s", _services_error)
            _services = None
            return None

        _services = services_result.data
        _services_error = None
        return _services


async def _require_services():
    services = await _build_services()
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
