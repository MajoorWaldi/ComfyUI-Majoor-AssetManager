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

    @routes.post("/mjr/am/db/reset")
    async def db_reset(request: web.Request):
        """
        Legacy DB reset endpoint (compat).

        This performs a hard DB reset (delete + recreate SQLite files) and triggers a rescan.
        It is gated behind the same security checks as /mjr/am/index/reset.
        """
        import asyncio
        from backend.config import OUTPUT_ROOT_PATH
        from ..core.security import _require_operation_enabled, _require_write_access, _resolve_security_prefs

        csrf = _csrf_error(request)
        if csrf:
            return _json_response(Result.Err("CSRF", csrf))

        svc, error_result = await _require_services()
        if error_result:
            return _json_response(error_result)

        prefs = await _resolve_security_prefs(svc)
        op = _require_operation_enabled("reset_index", prefs=prefs)
        if not op.ok:
            return _json_response(op)

        auth = _require_write_access(request)
        if not auth.ok:
            return _json_response(auth)

        db = svc.get("db")
        index_service = svc.get("index")
        
        if not db or not index_service:
             return _json_response(Result.Err("SERVICE_UNAVAILABLE", "Services unavailable"))

        # 1. Reset DB
        logger.warning("Resetting database requested by user")
        reset_res = await db.areset()
        if not reset_res.ok:
            return _json_response(reset_res)

        # 2. Trigger Rescan
        started_scans = []
        try:
            base_path = str(OUTPUT_ROOT_PATH)
        except Exception:
            base_path = ""
        if base_path:
            asyncio.create_task(index_service.scan_directory(base_path, recursive=True, incremental=False))
            started_scans.append(base_path)
             
        return _json_response(Result.Ok({"reset": True, "scans_triggered": started_scans, "file_ops": (reset_res.meta or {})}))
