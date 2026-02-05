"""
Observability helpers (request id + timing) for aiohttp routes.

This is designed to be safe in ComfyUI's PromptServer environment and also work
in unit tests where we create our own aiohttp app.
"""

from __future__ import annotations

import asyncio
import time
import os
import threading
from typing import Any, Dict, Optional
from uuid import uuid4

from aiohttp import web

from .shared import get_logger, request_id_var
from .utils import env_float

# --- Client disconnection errors (benign) ---
# These exceptions occur when the client closes the connection before the server
# finishes sending the response. This is normal (page refresh, navigation, etc.)
# and should be silently ignored to avoid polluting logs.
# NOTE: Do NOT include asyncio.CancelledError here — it's a BaseException that
# must propagate to allow proper task cancellation.
_CLIENT_DISCONNECT_ERRORS = (
    ConnectionResetError,      # [WinError 10054] on Windows
    BrokenPipeError,           # EPIPE on Unix
    ConnectionAbortedError,    # [WinError 10053] on Windows
    OSError,                   # Catch-all for other socket errors (errno checked)
)

# OSError errno codes that indicate client disconnect (not server-side issues)
_CLIENT_DISCONNECT_ERRNO = frozenset({
    10053,  # WSAECONNABORTED (Windows)
    10054,  # WSAECONNRESET (Windows)
    104,    # ECONNRESET (Linux/macOS)
    32,     # EPIPE (Linux/macOS)
    9,      # EBADF (bad file descriptor, connection closed)
})


def _is_client_disconnect(exc: BaseException) -> bool:
    """
    Check if an exception represents a benign client disconnect.
    """
    if isinstance(exc, (ConnectionResetError, BrokenPipeError, ConnectionAbortedError)):
        return True
    if isinstance(exc, OSError):
        errno = getattr(exc, 'errno', None)
        if errno in _CLIENT_DISCONNECT_ERRNO:
            return True
        # Also check winerror on Windows
        winerror = getattr(exc, 'winerror', None)
        if winerror in _CLIENT_DISCONNECT_ERRNO:
            return True
    return False

logger = get_logger(__name__)

_APPKEY_OBS_INSTALLED = web.AppKey("mjr_observability_installed", bool)

# Time constants (ms) / tunables
MS_PER_S = 1000.0
_DEFAULT_LOG_RATELIMIT_MS = 2000.0
_DEFAULT_SLOW_MS = 750.0
_DEFAULT_RATELIMIT_CLEAN_INTERVAL_MS = 60_000.0
_DEFAULT_RATELIMIT_CLEAN_WINDOW_MULT = 4.0
_DEFAULT_RATELIMIT_CLEAN_MIN_CUTOFF_MS = 120_000.0

# Prevent log spam when a client polls rapidly or an endpoint repeatedly errors (e.g. 404 loop).
# This rate limiter is intentionally simple and process-local.
_LOG_RATELIMIT_LOCK = threading.Lock()
_LOG_RATELIMIT_STATE: Dict[str, float] = {}
_LOG_RATELIMIT_CLEAN_AT = 0.0

# Runtime-configured values are read from env at call time (tests rely on monkeypatching env).


def _new_request_id() -> str:
    return uuid4().hex


def _get_request_id(request: web.Request) -> str:
    rid = (request.headers.get("X-Request-ID") or "").strip()
    return rid or _new_request_id()


def _env_flag(name: str, default: bool = False) -> bool:
    try:
        raw = os.environ.get(name)
    except Exception:
        raw = None
    if raw is None:
        return default
    value = str(raw).strip().lower()
    return value in ("1", "true", "yes", "on")



# (no cached env reads here on purpose)


def _should_emit_log(key: str, *, window_ms: float) -> bool:
    """
    Return True if this log key should be emitted now (best-effort rate limit).
    """
    global _LOG_RATELIMIT_CLEAN_AT
    now = time.monotonic() * MS_PER_S
    try:
        with _LOG_RATELIMIT_LOCK:
            last = _LOG_RATELIMIT_STATE.get(key, 0.0)
            if last and now - last < window_ms:
                return False
            _LOG_RATELIMIT_STATE[key] = now

            # Periodic cleanup to avoid unbounded growth.
            clean_interval_ms = env_float("MJR_OBS_RATELIMIT_CLEAN_INTERVAL_MS", _DEFAULT_RATELIMIT_CLEAN_INTERVAL_MS)
            clean_window_mult = env_float("MJR_OBS_RATELIMIT_CLEAN_WINDOW_MULT", _DEFAULT_RATELIMIT_CLEAN_WINDOW_MULT)
            clean_min_cutoff_ms = env_float("MJR_OBS_RATELIMIT_CLEAN_MIN_CUTOFF_MS", _DEFAULT_RATELIMIT_CLEAN_MIN_CUTOFF_MS)

            if not _LOG_RATELIMIT_CLEAN_AT or now - _LOG_RATELIMIT_CLEAN_AT > clean_interval_ms:
                cutoff = now - max(window_ms * clean_window_mult, clean_min_cutoff_ms)
                for k, ts in list(_LOG_RATELIMIT_STATE.items()):
                    if ts < cutoff:
                        _LOG_RATELIMIT_STATE.pop(k, None)
                _LOG_RATELIMIT_CLEAN_AT = now
    except Exception:
        # If rate limiting fails for any reason, fall back to logging.
        return True
    return True


def _should_log(request: web.Request, *, status: Optional[int], duration_ms: float) -> bool:
    # Only log Majoor endpoints by default to avoid spamming ComfyUI logs.
    try:
        path = request.path or ""
    except Exception:
        path = ""

    if not path.startswith("/mjr/am/"):
        return False

    # Client-side control (e.g. ComfyUI settings toggle).
    try:
        client_flag = (request.headers.get("X-MJR-OBS") or "").strip().lower()
    except Exception:
        client_flag = ""
    if client_flag in ("0", "false", "off", "disable", "disabled", "no"):
        return False

    client_explicit_on = client_flag in ("1", "true", "on", "enable", "enabled", "yes")

    # Allow opt-in verbose logging
    if _env_flag("MJR_OBS_LOG_ALL", default=False):
        return True

    # Health polling can be extremely chatty; never log successful polls by default.
    if path in ("/mjr/am/health", "/mjr/am/health/counters"):
        if status is not None and status >= 400:
            return True
        return False

    # Always log errors (unless client explicitly opted out above).
    if status is not None and status >= 400:
        return True

    # By default, do NOT log successes (otherwise polling endpoints spam).
    if not _env_flag("MJR_OBS_LOG_SUCCESS", default=False):
        return False

    # If the client did not explicitly enable observability, keep successful requests quiet.
    if not client_explicit_on:
        return False

    # Optional: log slow successful requests (threshold configurable).
    if not _env_flag("MJR_OBS_LOG_SLOW", default=False):
        return False

    slow_ms = env_float("MJR_OBS_SLOW_MS", _DEFAULT_SLOW_MS)
    return duration_ms >= slow_ms


@web.middleware
async def request_context_middleware(request: web.Request, handler):
    """Add request-id correlation and lightweight request logging context."""
    if _env_flag("MJR_OBS_DISABLE", default=False):
        return await handler(request)

    rid = _get_request_id(request)
    request["mjr_request_id"] = rid
    token = None
    try:
        if request_id_var is not None:
            token = request_id_var.set(rid)
    except Exception:
        token = None
    start = time.perf_counter()
    status: Optional[int] = None
    error: Optional[str] = None
    error_type: Optional[str] = None
    try:
        response = await handler(request)
        try:
            status = int(getattr(response, "status", 200) or 200)
        except Exception:
            status = 200
        response.headers["X-Request-ID"] = rid
        return response
    except web.HTTPException as exc:
        try:
            status = int(getattr(exc, "status", 500) or 500)
        except Exception:
            status = 500
        error_type = exc.__class__.__name__
        try:
            error = str(exc)
        except Exception:
            error = "HTTPException"
        try:
            exc.headers["X-Request-ID"] = rid
        except (AttributeError, TypeError, KeyError) as exc2:
            logger.debug("Unable to attach X-Request-ID to HTTPException: %s", exc2)
        raise
    except Exception as exc:
        status = 500
        error_type = exc.__class__.__name__
        try:
            error = str(exc)
        except Exception:
            error = "Unhandled error"
        raise
    finally:
        duration_ms = (time.perf_counter() - start) * 1000.0
        request["mjr_duration_ms"] = duration_ms
        try:
            if token is not None and request_id_var is not None:
                request_id_var.reset(token)
        except Exception:
            pass
        try:
            fields = build_request_log_fields(request, response_status=status)
            if error:
                fields["error"] = error
                fields["error_type"] = error_type

            if _should_log(request, status=status, duration_ms=duration_ms):
                # Rate-limit repetitive logs (especially error loops / polling).
                window_ms = env_float("MJR_OBS_RATELIMIT_MS", _DEFAULT_LOG_RATELIMIT_MS)
                try:
                    key = f"{request.method}:{request.path}:{status}"
                except Exception:
                    key = f"unknown:{status}"

                should_emit = _should_emit_log(key, window_ms=window_ms)
                if should_emit:
                    if status is not None and status >= 500:
                        logger.error("Request handled", extra=fields)
                    elif status is not None and status >= 400:
                        logger.warning("Request handled", extra=fields)
                    else:
                        logger.info("Request handled", extra=fields)
        except Exception as exc:
            # Never let logging failures interfere with the request.
            try:
                logger.debug("Observability log emit failed: %s", exc)
            except Exception:
                _ = None


def ensure_observability(app: web.Application) -> None:
    """
    Install middleware once.
    """
    try:
        if app.get(_APPKEY_OBS_INSTALLED):
            return
        app[_APPKEY_OBS_INSTALLED] = True
    except Exception:
        return

    try:
        app.middlewares.append(request_context_middleware)
    except Exception as exc:
        logger.debug("Failed to install observability middleware: %s", exc)

    # Install asyncio exception handler to silence benign client disconnects.
    # These errors occur at the transport level (after middleware) when clients
    # close the connection mid-response (page refresh, navigation, etc.).
    _install_asyncio_exception_handler()


_ASYNCIO_HANDLER_INSTALLED = False


def _install_asyncio_exception_handler() -> None:
    """
    Install a custom asyncio exception handler that silences benign client
    disconnect errors (ConnectionResetError, BrokenPipeError, etc.).

    These errors appear in asyncio's proactor_events.py _call_connection_lost
    and are normal in web servers — they just mean the client closed the
    connection before the server finished sending data.
    """
    global _ASYNCIO_HANDLER_INSTALLED
    if _ASYNCIO_HANDLER_INSTALLED:
        return

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        # No running loop yet (e.g., during module import).
        # This is fine; the handler will be installed when ensure_observability
        # is called at runtime with an active loop.
        return

    original_handler = loop.get_exception_handler()

    def _quiet_exception_handler(loop: asyncio.AbstractEventLoop, context: Dict[str, Any]) -> None:
        """
        Custom exception handler that silences client disconnect errors.
        """
        exc = context.get("exception")
        if exc is not None and _is_client_disconnect(exc):
            # Silently ignore client disconnect errors.
            # These are benign and expected in web servers.
            return

        # For all other exceptions, use the original handler or default.
        if original_handler is not None:
            original_handler(loop, context)
        else:
            loop.default_exception_handler(context)

    try:
        loop.set_exception_handler(_quiet_exception_handler)
        _ASYNCIO_HANDLER_INSTALLED = True
        logger.debug("Installed asyncio exception handler for client disconnect errors")
    except Exception as exc:
        logger.debug("Failed to install asyncio exception handler: %s", exc)


def build_request_log_fields(request: web.Request, response_status: Optional[int] = None) -> Dict[str, Any]:
    """Build a JSON-serializable dict of request/response fields for logs."""
    stats = request.get("mjr_stats")
    return {
        "request_id": request.get("mjr_request_id"),
        "method": request.method,
        "path": request.path,
        "query": dict(request.query),
        "status": response_status,
        "duration_ms": request.get("mjr_duration_ms"),
        "remote": getattr(request, "remote", None),
        "stats": stats if isinstance(stats, dict) else None,
    }
