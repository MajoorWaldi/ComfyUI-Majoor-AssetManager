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

    @routes.post("/mjr/am/db/force-delete")
    async def db_force_delete(request: web.Request):
        """
        Emergency nuclear DB delete.

        Bypasses the DB adapter entirely: closes connections, force-deletes the
        SQLite files from disk (with retry + GC for Windows file locks), then
        reinitializes the adapter and triggers a background rescan.

        This works even when the DB is malformed and normal reset/security-pref
        queries would fail.  Only requires CSRF check (no DB-dependent security).
        """
        import asyncio
        import gc
        from pathlib import Path
        from backend.config import INDEX_DB_PATH, OUTPUT_ROOT_PATH

        csrf = _csrf_error(request)
        if csrf:
            return _json_response(Result.Err("CSRF", csrf))

        # Best-effort: get services, but don't fail if DB is broken
        svc = None
        db = None
        index_service = None
        try:
            svc, _ = await _require_services()
            if isinstance(svc, dict):
                db = svc.get("db")
                index_service = svc.get("index")
        except Exception:
            pass

        logger.warning("Force-delete DB requested (emergency recovery)")

        # 1. Try to drain the adapter's connections (best-effort)
        if db is not None:
            try:
                await db.areset()
                logger.info("DB adapter areset() succeeded")
                # If areset worked, skip the manual file deletion
                started_scans = []
                if index_service:
                    try:
                        base_path = str(OUTPUT_ROOT_PATH)
                        asyncio.create_task(
                            index_service.scan_directory(base_path, recursive=True, incremental=False)
                        )
                        started_scans.append(base_path)
                    except Exception:
                        pass
                return _json_response(Result.Ok({
                    "method": "adapter_reset",
                    "deleted": True,
                    "scans_triggered": started_scans,
                }))
            except Exception as exc:
                logger.warning("DB adapter areset() failed (%s), falling back to manual file delete", exc)
                # Close whatever we can before manual delete
                try:
                    db.close()
                except Exception:
                    pass

        # 2. Force GC to release file handles (critical on Windows)
        gc.collect()
        await asyncio.sleep(0.3)
        gc.collect()

        # 3. Manually delete DB files from disk
        base = str(INDEX_DB_PATH)
        deleted_files = []
        failed_files = []
        for suffix in ("", "-wal", "-shm", "-journal"):
            p = Path(base + suffix)
            if not p.exists():
                continue
            removed = False
            for attempt in range(6):
                try:
                    p.unlink()
                    deleted_files.append(str(p))
                    removed = True
                    break
                except PermissionError:
                    gc.collect()
                    await asyncio.sleep(0.3 * (attempt + 1))
                except Exception:
                    break
            if not removed and p.exists():
                failed_files.append(str(p))

        if failed_files:
            logger.error("Force-delete: could not remove files: %s", failed_files)
            return _json_response(Result.Err(
                "DELETE_FAILED",
                f"Could not delete: {', '.join(failed_files)}. "
                "Stop ComfyUI, manually delete the files, then restart.",
            ))

        logger.info("Force-delete: removed %s", deleted_files)

        # 4. Re-initialize the DB adapter so it creates a fresh database
        if db is not None:
            try:
                db._init_db()
                from backend.adapters.db.schema import ensure_tables_exist, ensure_indexes_and_triggers
                await ensure_tables_exist(db)
                await ensure_indexes_and_triggers(db)
                logger.info("DB re-initialized after force delete")
            except Exception as exc:
                logger.warning("DB re-init after force delete failed: %s", exc)

        # 5. Trigger background rescan
        started_scans = []
        if index_service is not None:
            try:
                base_path = str(OUTPUT_ROOT_PATH)
                asyncio.create_task(
                    index_service.scan_directory(base_path, recursive=True, incremental=False)
                )
                started_scans.append(base_path)
            except Exception:
                pass

        return _json_response(Result.Ok({
            "method": "manual_delete",
            "deleted_files": deleted_files,
            "scans_triggered": started_scans,
        }))
