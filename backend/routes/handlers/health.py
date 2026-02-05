"""
Health check endpoints.
"""
import asyncio
from pathlib import Path
from aiohttp import web

try:
    import folder_paths  # type: ignore
except Exception:
    class _FolderPathsStub:
        @staticmethod
        def get_input_directory() -> str:
            return str((Path(__file__).resolve().parents[3] / "input").resolve())

    folder_paths = _FolderPathsStub()  # type: ignore

from backend.config import OUTPUT_ROOT, get_tool_paths, MEDIA_PROBE_BACKEND
from backend.config import TO_THREAD_TIMEOUT_S
from backend.custom_roots import resolve_custom_root
from backend.shared import Result, ErrorCode
from backend.tool_detect import get_tool_status
from backend.utils import parse_bool
from ..core import _json_response, _require_services, _csrf_error, _require_write_access, _read_json

SECURITY_PREF_KEYS = {
    "safe_mode",
    "allow_write",
    "allow_delete",
    "allow_rename",
    "allow_open_in_folder",
    "allow_reset_index",
}


def register_health_routes(routes: web.RouteTableDef) -> None:
    """Register health and diagnostics routes."""
    @routes.get("/mjr/am/health")
    async def health(request):
        """Get health status."""
        svc, error_result = await _require_services()
        if error_result:
            return _json_response(error_result)

        try:
            result = await asyncio.wait_for(svc['health'].status(), timeout=TO_THREAD_TIMEOUT_S)
        except asyncio.TimeoutError:
            result = Result.Err(ErrorCode.TIMEOUT, "Health status timed out")
        except Exception as exc:
            result = Result.Err(ErrorCode.DEGRADED, f"Health status failed: {exc}")
        return _json_response(result)

    @routes.get("/mjr/am/health/counters")
    async def health_counters(request):
        """Get database counters."""
        svc, error_result = await _require_services()
        if error_result:
            return _json_response(error_result)

        scope = (request.query.get("scope") or "output").strip().lower()
        custom_root_id = request.query.get("custom_root_id") or request.query.get("root_id") or None

        roots = None
        if scope == "output":
            roots = [str(Path(OUTPUT_ROOT).resolve(strict=False))]
        elif scope == "input":
            roots = [str(Path(folder_paths.get_input_directory()).resolve(strict=False))]
        elif scope == "all":
            roots = [
                str(Path(OUTPUT_ROOT).resolve(strict=False)),
                str(Path(folder_paths.get_input_directory()).resolve(strict=False)),
            ]
        elif scope == "custom":
            root_result = resolve_custom_root(str(custom_root_id or ""))
            if not root_result.ok:
                return _json_response(Result.Err(ErrorCode.INVALID_INPUT, root_result.error))
            roots = [str(Path(str(root_result.data)).resolve(strict=False))]
        else:
            return _json_response(Result.Err(ErrorCode.INVALID_INPUT, f"Unknown scope: {scope}"))

        try:
            result = await asyncio.wait_for(svc['health'].get_counters(roots=roots), timeout=TO_THREAD_TIMEOUT_S)
        except asyncio.TimeoutError:
            result = Result.Err(ErrorCode.TIMEOUT, "Health counters timed out")
        except Exception as exc:
            result = Result.Err(ErrorCode.DEGRADED, f"Health counters failed: {exc}")
        if result.ok:
            if isinstance(result.data, dict):
                result.data["scope"] = scope
                if scope == "custom":
                    result.data["custom_root_id"] = custom_root_id
        return _json_response(result)

    @routes.get("/mjr/am/config")
    async def get_config(request):
        """
        Get configuration (output directory, etc.).
        """
        svc, _ = await _require_services()
        
        probe_mode = MEDIA_PROBE_BACKEND
        
        if svc:
            settings_service = svc.get("settings")
            if settings_service:
                try:
                    # FIX: await the async method
                    probe_mode = await settings_service.get_probe_backend()
                except Exception:
                    # fallback to defaults
                    pass
                    
        return _json_response(Result.Ok({
            "output_directory": OUTPUT_ROOT,
            "tool_paths": get_tool_paths(),
            "media_probe_backend": probe_mode,
        }))

    @routes.post("/mjr/am/settings/probe-backend")
    async def update_probe_backend(request):
        """
        Update media probe backend preference (ExifTool, FFprobe, Both, Auto).
        """
        csrf = _csrf_error(request)
        if csrf:
            return _json_response(Result.Err(ErrorCode.CSRF, csrf))

        svc, error_result = await _require_services()
        if error_result:
            return _json_response(error_result)

        settings_service = svc.get("settings")
        if not settings_service:
            return _json_response(Result.Err(ErrorCode.SERVICE_UNAVAILABLE, "Settings service unavailable"))

        body_res = await _read_json(request)
        if not body_res.ok:
            return _json_response(body_res)
        body = body_res.data or {}

        mode = (body.get("mode") or body.get("media_probe_backend") or "").strip()
        if not mode:
            return _json_response(Result.Err("INVALID_INPUT", "Missing probe backend mode"))

        result = await settings_service.set_probe_backend(mode)
        if result.ok:
            return _json_response(Result.Ok({"media_probe_backend": result.data}))
        return _json_response(result)

    @routes.get("/mjr/am/settings/security")
    async def get_security_settings(request):
        svc, error_result = await _require_services()
        if error_result:
            return _json_response(error_result)

        settings_service = svc.get("settings")
        if not settings_service:
            return _json_response(Result.Err("SERVICE_UNAVAILABLE", "Settings service unavailable"))

        prefs = await settings_service.get_security_prefs()
        return _json_response(Result.Ok({"prefs": prefs}))

    @routes.post("/mjr/am/settings/security")
    async def update_security_settings(request):
        csrf = _csrf_error(request)
        if csrf:
            return _json_response(Result.Err("CSRF", csrf))

        auth = _require_write_access(request)
        if not auth.ok:
            return _json_response(auth)

        svc, error_result = await _require_services()
        if error_result:
            return _json_response(error_result)

        settings_service = svc.get("settings")
        if not settings_service:
            return _json_response(Result.Err("SERVICE_UNAVAILABLE", "Settings service unavailable"))

        body_res = await _read_json(request)
        if not body_res.ok:
            return _json_response(body_res)
        body = body_res.data or {}

        prefs = {}
        for key in SECURITY_PREF_KEYS:
            if key in body:
                prefs[key] = parse_bool(body[key], False)
        if not prefs:
            return _json_response(Result.Err("INVALID_INPUT", "No security settings provided"))

        result = await settings_service.set_security_prefs(prefs)
        if result.ok:
            current_prefs = result.data or (await settings_service.get_security_prefs())
            return _json_response(Result.Ok({"prefs": current_prefs}))
        return _json_response(result)

    @routes.get("/mjr/am/tools/status")
    async def tools_status(request):
        """
        Get status of external tools (ExifTool, FFprobe).
        Returns availability and version info.
        """
        status = get_tool_status()
        return _json_response(Result.Ok(status))

    @routes.get("/mjr/am/roots")
    async def get_roots(request):
        """
        Get core roots and custom roots.
        """
        from backend.custom_roots import list_custom_roots

        roots = {
            "output_directory": str(Path(OUTPUT_ROOT).resolve()),
            "input_directory": str(Path(folder_paths.get_input_directory()).resolve()),
        }

        custom = list_custom_roots()
        if custom.ok:
            roots["custom_roots"] = custom.data
        else:
            roots["custom_roots"] = []
            roots["custom_roots_error"] = custom.error

        return _json_response(Result.Ok(roots))
