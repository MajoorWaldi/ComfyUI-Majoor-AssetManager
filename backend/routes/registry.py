"""
Route registration system.
Coordinates all route handlers and registers them with PromptServer or aiohttp app.
"""

from __future__ import annotations

from aiohttp import web
from backend.shared import get_logger
from backend.observability import ensure_observability
from typing import Awaitable, Callable, ClassVar, Protocol, cast

# --- CONFIGURATION ---
API_PREFIX = "/mjr/am/"


class _PromptServerInstance(Protocol):
    routes: web.RouteTableDef
    app: web.Application | None


class _PromptServer(Protocol):
    instance: ClassVar[_PromptServerInstance]

try:
    # IMPORTANT (ComfyUI compatibility):
    # Never `import server` here. Importing ComfyUI's `server.py` triggers a cascade
    # (nodes -> torch -> cuda init) which can hard-crash the interpreter in non-ComfyUI
    # contexts (unit tests, docs scripts, standalone runs) or on misconfigured CUDA.
    #
    # In the real ComfyUI runtime, `server` is already imported and lives in
    # `sys.modules`, so we can safely reuse it without re-importing.
    import sys

    _server_mod = sys.modules.get("server")
    if _server_mod is None or not hasattr(_server_mod, "PromptServer"):
        raise ImportError("ComfyUI server not loaded")

    PromptServer = cast(type[_PromptServer], getattr(_server_mod, "PromptServer"))
except Exception:
    class _PromptServerInstanceStub:
        routes: web.RouteTableDef = web.RouteTableDef()
        app: web.Application | None = None

    class _PromptServerStub:
        instance: ClassVar[_PromptServerInstanceStub] = _PromptServerInstanceStub()

    PromptServer = cast(type[_PromptServer], _PromptServerStub)

from .handlers import (
    register_health_routes,
    register_metadata_routes,
    register_custom_roots_routes,
    register_search_routes,
    register_scan_routes,
    register_asset_routes,
    register_collections_routes,
    register_batch_zip_routes,
    register_calendar_routes,
    register_viewer_routes,
    register_db_maintenance_routes,
    register_releases_routes,
    register_version_routes,
    register_download_routes,
    register_duplicates_routes,
)

logger = get_logger(__name__)


@web.middleware
async def security_headers_middleware(
    request: web.Request,
    handler: Callable[[web.Request], Awaitable[web.StreamResponse]],
) -> web.StreamResponse:
    """Apply strict security headers to Majoor API responses only."""
    response = await handler(request)

    # Only apply to Majoor API endpoints. Applying `nosniff` / CSP globally can break
    # ComfyUI's own static assets (e.g. user.css) and frontend runtime.
    try:
        path = request.path or ""
    except Exception:
        path = ""
    # FIX: Utilisation de la constante au lieu du hardcoding
    if not path.startswith(API_PREFIX):
        return response

    try:
        # API responses should never be treated as a document.
        response.headers.setdefault("Content-Security-Policy", "default-src 'none'")
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")

        response.headers.setdefault("Cache-Control", "no-store, no-cache, must-revalidate")
        response.headers.setdefault("Pragma", "no-cache")
    except Exception:
        pass

    return response


@web.middleware
async def api_versioning_middleware(
    request: web.Request,
    handler: Callable[[web.Request], Awaitable[web.StreamResponse]],
) -> web.StreamResponse:
    """
    Support versioned routes without breaking existing clients.

    `/mjr/am/v1/...` redirects to legacy `/mjr/am/...` using 308 (method-preserving).
    """
    try:
        path = request.path or ""
    except Exception:
        path = ""

    prefix = API_PREFIX + "v1"
    if path == prefix or path.startswith(prefix + "/"):
        tail = path[len(prefix):] or "/"
        target = API_PREFIX.rstrip("/") + tail
        qs = ""
        try:
            qs = request.query_string or ""
        except Exception:
            qs = ""
        if qs:
            target = target + "?" + qs
        raise web.HTTPPermanentRedirect(location=target)

    return await handler(request)


def _install_security_middlewares(app: web.Application) -> None:
    try:
        app.middlewares.insert(0, security_headers_middleware)
        app.middlewares.insert(0, api_versioning_middleware)
    except Exception as exc:
        logger.debug("Failed to install security middlewares: %s", exc)


def register_all_routes() -> web.RouteTableDef:
    """
    Register all route handlers and return the RouteTableDef.
    This is the central registration point for all routes.
    """
    routes = PromptServer.instance.routes

    # Register all handler modules
    register_health_routes(routes)
    register_metadata_routes(routes)
    register_custom_roots_routes(routes)
    register_search_routes(routes)
    register_scan_routes(routes)
    register_asset_routes(routes)
    register_collections_routes(routes)
    register_batch_zip_routes(routes)
    register_calendar_routes(routes)
    register_viewer_routes(routes)
    register_db_maintenance_routes(routes)
    # Register releases route (exposes tags/branches + zip template)
    try:
        register_releases_routes(routes)
        logger.info("  GET /mjr/am/releases (Added)")
    except Exception as e:
        logger.error(f"Failed to register releases routes: {e}")

    try:
        register_version_routes(routes)
        logger.info("  GET /majoor/version (Added)")
    except Exception as e:
        logger.error(f"Failed to register version route: {e}")

    # FIX: Enregistrement de la route de téléchargement
    try:
        register_download_routes(routes)
        register_duplicates_routes(routes)
        logger.info("  GET /mjr/am/download (Added)")
    except Exception as e:
        logger.error(f"Failed to register download routes: {e}")

    logger.info("=" * 60)
    logger.info("Routes registered:")
    logger.info("  GET /mjr/am/health")
    logger.info("  GET /mjr/am/health/counters")
    logger.info("  GET /mjr/am/health/db")
    logger.info("  GET /mjr/am/config")
    logger.info("  GET /mjr/am/tools/status")
    logger.info("  GET /mjr/am/metadata?type=<scope>&filename=<name>&subfolder=<sub>&root_id=<id>")
    logger.info("  POST /mjr/am/scan")
    logger.info("  POST /mjr/am/index-files")
    logger.info("  POST /mjr/am/stage-to-input")
    logger.info("  POST /mjr/am/open-in-folder")
    logger.info("  GET /mjr/am/search?q=<query>")
    logger.info("  GET /mjr/am/asset/{asset_id}")
    logger.info("  POST /mjr/am/assets/delete")
    logger.info("  POST /mjr/am/assets/rename")
    logger.info("  GET /mjr/am/collections")
    logger.info("  GET /mjr/am/date-histogram?month=YYYY-MM")
    logger.info("  POST /mjr/am/batch-zip")
    logger.info("  GET /mjr/am/batch-zip/{token}")
    logger.info("  GET /mjr/am/viewer/info?asset_id=<id>")
    logger.info("  POST /mjr/am/db/optimize")
    logger.info("  POST /mjr/am/db/force-delete")
    logger.info("  GET /mjr/am/download")
    logger.info("  GET /mjr/am/releases")
    logger.info("  GET /mjr/am/duplicates/alerts")
    logger.info("=" * 60)

    return routes


def register_routes(app: web.Application) -> None:
    """
    Register routes onto an aiohttp application.

    This is primarily used for unit tests; in ComfyUI, routes are registered
    via PromptServer decorators at import time.
    """
    try:
        ensure_observability(app)
    except Exception as exc:
        logger.debug("Observability not installed on aiohttp app: %s", exc)
    try:
        _install_security_middlewares(app)
    except Exception as exc:
        logger.debug("Security middlewares not installed on aiohttp app: %s", exc)
    try:
        app.add_routes(PromptServer.instance.routes)
    except Exception as exc:
        logger.warning("Failed to register routes on aiohttp app: %s", exc)


def _install_observability_on_prompt_server() -> None:
    """
    Best-effort installation of the middleware into ComfyUI's PromptServer app.
    If PromptServer doesn't expose `app`, this safely no-ops.
    """
    try:
        app = getattr(PromptServer.instance, "app", None)
        if app is not None:
            ensure_observability(app)
            _install_security_middlewares(app)
    except Exception as exc:
        logger.debug("Observability not installed on PromptServer app: %s", exc)
        return
