"""
Database maintenance endpoints (safe, opt-in).
"""

from __future__ import annotations

from aiohttp import web

from backend.shared import Result, get_logger
from ..core import _json_response, _csrf_error, _require_services, safe_error_message

logger = get_logger(__name__)


def register_db_maintenance_routes(routes: web.RouteTableDef) -> None:
    """Register database maintenance routes."""
    @routes.post("/mjr/am/db/optimize")
    async def db_optimize(request: web.Request):
        """
        Run SQLite maintenance pragmas (best-effort).

        This is useful after large scans or deletes.
        Always returns Result (never throws to UI).
        """
        csrf = _csrf_error(request)
        if csrf:
            return _json_response(Result.Err("CSRF", csrf))

        svc, error_result = await _require_services()
        if error_result:
            return _json_response(error_result)

        db = svc.get("db") if isinstance(svc, dict) else None
        if not db:
            return _json_response(Result.Err("SERVICE_UNAVAILABLE", "Database service unavailable"))

        steps = []
        try:
            try:
                await db.aquery("PRAGMA optimize", ())
                steps.append("PRAGMA optimize")
            except Exception as exc:
                logger.debug("DB optimize step failed: %s", exc)
            try:
                await db.aquery("ANALYZE", ())
                steps.append("ANALYZE")
            except Exception as exc:
                logger.debug("DB analyze step failed: %s", exc)
        except Exception as exc:
            return _json_response(Result.Err("DB_ERROR", safe_error_message(exc, "Database optimize failed")))

        return _json_response(Result.Ok({"ran": steps}))
