"""
Security utilities: CSRF protection and rate limiting.
"""

from __future__ import annotations

import hashlib
import ipaddress
import os
import threading
import time
from collections import defaultdict, OrderedDict
from typing import Any, Mapping, Optional, Tuple
from urllib.parse import urlparse

from aiohttp import web
from backend.shared import Result

# Per-client rate limiting state: {client_id: {endpoint: [timestamps]}}
# Use LRU eviction to prevent unbounded memory growth from spoofed client IPs.
_DEFAULT_MAX_RATE_LIMIT_CLIENTS = 1_000
_DEFAULT_RATE_LIMIT_CLEANUP_INTERVAL = 100
_DEFAULT_RATE_LIMIT_MIN_WINDOW_SECONDS = 60
_DEFAULT_CLIENT_ID_HASH_HEX_CHARS = 16
_DEFAULT_TRUSTED_PROXIES = "127.0.0.1,::1"

try:
    _MAX_RATE_LIMIT_CLIENTS = int(os.environ.get("MAJOOR_RATE_LIMIT_MAX_CLIENTS", str(_DEFAULT_MAX_RATE_LIMIT_CLIENTS)))
except Exception:
    _MAX_RATE_LIMIT_CLIENTS = _DEFAULT_MAX_RATE_LIMIT_CLIENTS

try:
    _rate_limit_cleanup_interval = int(
        os.environ.get("MAJOOR_RATE_LIMIT_CLEANUP_INTERVAL", str(_DEFAULT_RATE_LIMIT_CLEANUP_INTERVAL))
    )
except Exception:
    _rate_limit_cleanup_interval = _DEFAULT_RATE_LIMIT_CLEANUP_INTERVAL

try:
    _RATE_LIMIT_MIN_WINDOW_SECONDS = int(
        os.environ.get("MAJOOR_RATE_LIMIT_MIN_WINDOW_SECONDS", str(_DEFAULT_RATE_LIMIT_MIN_WINDOW_SECONDS))
    )
except Exception:
    _RATE_LIMIT_MIN_WINDOW_SECONDS = _DEFAULT_RATE_LIMIT_MIN_WINDOW_SECONDS

try:
    _CLIENT_ID_HASH_HEX_CHARS = int(
        os.environ.get("MAJOOR_CLIENT_ID_HASH_CHARS", str(_DEFAULT_CLIENT_ID_HASH_HEX_CHARS))
    )
except Exception:
    _CLIENT_ID_HASH_HEX_CHARS = _DEFAULT_CLIENT_ID_HASH_HEX_CHARS

_rate_limit_state: "OrderedDict[str, dict]" = OrderedDict()
_rate_limit_lock = threading.Lock()
_rate_limit_cleanup_counter = 0


def _env_truthy(name: str, default: bool = False) -> bool:
    try:
        raw = os.environ.get(name)
    except Exception:
        raw = None
    if raw is None:
        return bool(default)
    return str(raw).strip().lower() in ("1", "true", "yes", "on")


def _safe_mode_enabled() -> bool:
    """
    Return True when Majoor Safe Mode is enabled.

    Safe Mode is enabled by default to reduce risk when ComfyUI is exposed to remote clients
    (via --listen, tunnels, reverse proxies, etc.).
    """
    # Default: enabled when unset.
    try:
        raw = os.environ.get("MAJOOR_SAFE_MODE")
    except Exception:
        raw = None
    if raw is None:
        return True
    return str(raw).strip().lower() in ("1", "true", "yes", "on")


def _require_operation_enabled(operation: str, *, prefs: Mapping[str, Any] | None = None) -> "Result[bool]":
    """
    Gate "dangerous" or state-changing operations behind explicit opt-ins.

    Policy:
      - Safe Mode enabled by default: blocks write operations unless explicitly allowed.
      - Delete/Rename/Open-in-folder are always opt-in (even when Safe Mode is off).

    Environment variables:
      - MAJOOR_SAFE_MODE=0 to disable safe mode
      - MAJOOR_ALLOW_WRITE=1 to enable rating/tags writes while in safe mode
      - MAJOOR_ALLOW_DELETE=1 to enable deletion
      - MAJOOR_ALLOW_RENAME=1 to enable renaming
      - MAJOOR_ALLOW_OPEN_IN_FOLDER=1 to enable open-in-folder
    """
    from ...shared import Result

    op = str(operation or "").strip().lower()
    if prefs and "safe_mode" in prefs:
        safe_mode = bool(prefs.get("safe_mode"))
    else:
        safe_mode = _safe_mode_enabled()

    def _pref_truthy(key: str, env_var: str) -> bool:
        if prefs is not None and key in prefs:
            try:
                return bool(prefs[key])
            except Exception:
                pass
        return _env_truthy(env_var)

    if op in ("reset_index",):
        if _pref_truthy("allow_reset_index", "MAJOOR_ALLOW_RESET_INDEX"):
            return Result.Ok(True, operation=op, safe_mode=safe_mode)
        return Result.Err(
            "FORBIDDEN",
            "Reset index is disabled by default. Enable 'allow_reset_index' in settings or set MAJOOR_ALLOW_RESET_INDEX=1.",
            operation=op,
            safe_mode=safe_mode,
        )

    if op in ("delete", "asset_delete", "assets_delete"):
        if _pref_truthy("allow_delete", "MAJOOR_ALLOW_DELETE"):
            return Result.Ok(True, operation=op, safe_mode=safe_mode)
        return Result.Err(
            "FORBIDDEN",
            "Delete is disabled by default. Set MAJOOR_ALLOW_DELETE=1 to enable asset deletion.",
            operation=op,
            safe_mode=safe_mode,
        )

    if op in ("rename", "asset_rename"):
        if _pref_truthy("allow_rename", "MAJOOR_ALLOW_RENAME"):
            return Result.Ok(True, operation=op, safe_mode=safe_mode)
        return Result.Err(
            "FORBIDDEN",
            "Rename is disabled by default. Set MAJOOR_ALLOW_RENAME=1 to enable asset renaming.",
            operation=op,
            safe_mode=safe_mode,
        )

    if op in ("open_in_folder", "open-in-folder"):
        if _pref_truthy("allow_open_in_folder", "MAJOOR_ALLOW_OPEN_IN_FOLDER"):
            return Result.Ok(True, operation=op, safe_mode=safe_mode)
        return Result.Err(
            "FORBIDDEN",
            "Open-in-folder is disabled by default. Set MAJOOR_ALLOW_OPEN_IN_FOLDER=1 to enable it.",
            operation=op,
            safe_mode=safe_mode,
        )

    if op in ("write", "rating", "tags", "asset_rating", "asset_tags"):
        if not safe_mode:
            return Result.Ok(True, operation=op, safe_mode=safe_mode)
        if _pref_truthy("allow_write", "MAJOOR_ALLOW_WRITE"):
            return Result.Ok(True, operation=op, safe_mode=safe_mode)
        return Result.Err(
            "FORBIDDEN",
            "Write operations are disabled in Safe Mode. Set MAJOOR_SAFE_MODE=0 to disable safe mode, or MAJOOR_ALLOW_WRITE=1 to allow rating/tags writes.",
            operation=op,
            safe_mode=safe_mode,
        )

    # Unknown operation: fail closed only in safe mode.
    if safe_mode:
        return Result.Err(
            "FORBIDDEN",
            "Operation blocked in Safe Mode (unknown operation).",
            operation=op,
            safe_mode=safe_mode,
        )
    return Result.Ok(True, operation=op, safe_mode=safe_mode)


async def _resolve_security_prefs(services: Mapping[str, Any] | None) -> Mapping[str, Any] | None:
    """
    Extract stored security preferences from the services container safely.
    """
    if not services:
        return None
    settings_service = services.get("settings")
    if not settings_service:
        return None
    try:
        return await settings_service.get_security_prefs()
    except Exception:
        return None


def _get_write_token() -> str:
    """
    Return configured API token used to authorize destructive/write operations.

    Supported env vars:
      - MAJOOR_API_TOKEN (preferred)
      - MJR_API_TOKEN (compat / shorter alias)
    """
    try:
        raw = (os.environ.get("MAJOOR_API_TOKEN") or os.environ.get("MJR_API_TOKEN") or "").strip()
    except Exception:
        raw = ""
    return raw


def _extract_bearer_token(headers: Mapping[str, str]) -> str:
    try:
        auth = str(headers.get("Authorization") or "").strip()
    except Exception:
        auth = ""
    if not auth:
        return ""
    prefix = "bearer "
    if auth.lower().startswith(prefix):
        return auth[len(prefix):].strip()
    return ""


def _extract_write_token_from_headers(headers: Mapping[str, str]) -> str:
    """
    Extract a user-provided write token from request headers.

    Accepted:
      - Authorization: Bearer <token>
      - X-MJR-Token: <token>
    """
    bearer = _extract_bearer_token(headers)
    if bearer:
        return bearer

    try:
        token = str(headers.get("X-MJR-Token") or "").strip()
    except Exception:
        token = ""
    return token


def _resolve_client_ip(peer_ip: str, headers: Mapping[str, str]) -> str:
    """
    Resolve client IP, honoring X-Forwarded-For / X-Real-IP only from trusted proxies.

    Note: This mirrors the rate-limit identity resolution but returns the IP string (not a hash),
    so it can be used for local/remote authorization checks.
    """
    peer = str(peer_ip or "").strip()
    if not peer:
        return "unknown"

    if _is_trusted_proxy(peer):
        try:
            forwarded_for = str(headers.get("X-Forwarded-For") or "").strip()
        except Exception:
            forwarded_for = ""
        if forwarded_for:
            cand = forwarded_for.split(",")[0].strip()
            try:
                ipaddress.ip_address(cand)
                return cand
            except Exception:
                return peer

        try:
            real_ip = str(headers.get("X-Real-IP") or "").strip()
        except Exception:
            real_ip = ""
        if real_ip:
            try:
                ipaddress.ip_address(real_ip)
                return real_ip
            except Exception:
                return peer

    return peer


def _is_loopback_ip(value: str) -> bool:
    try:
        return ipaddress.ip_address(str(value or "").strip()).is_loopback
    except Exception:
        return False


def _check_write_access(*, peer_ip: str, headers: Mapping[str, str]) -> "Result[bool]":
    """
    Authorization guard for destructive/write endpoints.

    Default policy (safe-by-default):
      - If a token is configured, it must be provided for *all* write operations.
      - If no token is configured, allow only loopback clients (localhost / 127.0.0.1 / ::1).

    Overrides:
      - MAJOOR_REQUIRE_AUTH=1 forces token auth even for loopback (requires MAJOOR_API_TOKEN).
      - MAJOOR_ALLOW_REMOTE_WRITE=1 disables the loopback-only restriction when no token is set.

    Returns a Result that never raises (route handlers should return 200 with this Result on error).
    """
    import hmac

    # Local import to avoid cycles: core/security must remain lightweight.
    from ...shared import Result

    configured = _get_write_token()
    require_auth = _env_truthy("MAJOOR_REQUIRE_AUTH")
    # By default, remote write access is NOT allowed unless explicitly configured.
    allow_remote = _env_truthy("MAJOOR_ALLOW_REMOTE_WRITE", default=False)

    client_ip = _resolve_client_ip(peer_ip, headers)

    provided = _extract_write_token_from_headers(headers)
    if configured:
        # Prevent timing attacks
        if provided and hmac.compare_digest(provided, configured):
            return Result.Ok(True, auth="token", client_ip=client_ip)
        return Result.Err(
            "AUTH_REQUIRED",
            "Write operation blocked: missing or invalid API token. Set MAJOOR_API_TOKEN and send it via X-MJR-Token or Authorization: Bearer <token>.",
            auth="token",
            client_ip=client_ip,
        )

    if require_auth:
        return Result.Err(
            "AUTH_REQUIRED",
            "Write operation blocked: MAJOOR_REQUIRE_AUTH=1 is set but no MAJOOR_API_TOKEN is configured.",
            auth="required_missing_token",
            client_ip=client_ip,
        )

    if allow_remote:
        return Result.Ok(True, auth="allow_remote_no_token", client_ip=client_ip)

    if _is_loopback_ip(client_ip):
        return Result.Ok(True, auth="loopback", client_ip=client_ip)

    return Result.Err(
        "FORBIDDEN",
        "Write operation blocked for non-local clients. If you exposed ComfyUI with --listen/tunnels, set MAJOOR_API_TOKEN (recommended) or MAJOOR_ALLOW_REMOTE_WRITE=1 (unsafe).",
        auth="loopback_only",
        client_ip=client_ip,
    )


def _require_write_access(request: web.Request) -> "Result[bool]":
    """
    Request-level wrapper for `_check_write_access()`.

    Never raises. Meant to be used at the top of handlers that modify filesystem/DB.
    """
    try:
        peer = str(getattr(request, "remote", None) or "").strip()
    except Exception:
        peer = ""
    if not peer:
        peer = _extract_peer_ip(request)
    try:
        headers = request.headers  # CIMultiDictProxy
    except Exception:
        headers = {}
    return _check_write_access(peer_ip=peer, headers=headers)


def _parse_trusted_proxies() -> list["ipaddress._BaseNetwork"]:
    raw = os.environ.get("MAJOOR_TRUSTED_PROXIES", _DEFAULT_TRUSTED_PROXIES)
    out: list["ipaddress._BaseNetwork"] = []
    for part in (raw or "").split(","):
        s = part.strip()
        if not s:
            continue
        try:
            # Accept either an IP or a CIDR.
            if "/" in s:
                out.append(ipaddress.ip_network(s, strict=False))
            else:
                ip = ipaddress.ip_address(s)
                out.append(ipaddress.ip_network(f"{ip}/{ip.max_prefixlen}", strict=False))
        except Exception:
            continue
    return out


_TRUSTED_PROXY_NETS = _parse_trusted_proxies()


def _is_trusted_proxy(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(str(ip or "").strip())
    except Exception:
        return False
    try:
        for net in _TRUSTED_PROXY_NETS:
            try:
                if addr in net:
                    return True
            except Exception:
                continue
    except Exception:
        return False
    return False


def _extract_peer_ip(request: web.Request) -> str:
    try:
        peername = request.transport.get_extra_info("peername") if request.transport else None
        return peername[0] if peername else "unknown"
    except Exception:
        return "unknown"


def _get_client_identifier(request: web.Request) -> str:
    peer_ip = _extract_peer_ip(request)

    # Only trust X-Forwarded-For / X-Real-IP when we are behind a trusted proxy.
    forwarded_for = request.headers.get("X-Forwarded-For") if _is_trusted_proxy(peer_ip) else None
    if forwarded_for:
        cand = forwarded_for.split(",")[0].strip()
        try:
            ipaddress.ip_address(cand)
            client_ip = cand
        except Exception:
            client_ip = peer_ip
    else:
        real_ip = request.headers.get("X-Real-IP") if _is_trusted_proxy(peer_ip) else None
        if real_ip:
            cand = real_ip.strip()
            try:
                ipaddress.ip_address(cand)
                client_ip = cand
            except Exception:
                client_ip = peer_ip
        else:
            client_ip = peer_ip
    return hashlib.sha256(client_ip.encode("utf-8", errors="ignore")).hexdigest()[:_CLIENT_ID_HASH_HEX_CHARS]

def _evict_oldest_clients_if_needed() -> None:
    # Evict more aggressively when near capacity
    target = int(_MAX_RATE_LIMIT_CLIENTS * 0.9)
    while len(_rate_limit_state) > target:
        try:
            _rate_limit_state.popitem(last=False)
        except KeyError:
            break

def _get_or_create_client_state(client_id: str) -> dict:
    if client_id in _rate_limit_state:
        _rate_limit_state.move_to_end(client_id)
        return _rate_limit_state[client_id]
    _evict_oldest_clients_if_needed()
    state = defaultdict(list)
    _rate_limit_state[client_id] = state
    return state


def _cleanup_rate_limit_state(now: float, window_seconds: int) -> None:
    with _rate_limit_lock:
        for client_id, endpoints in list(_rate_limit_state.items()):
            for endpoint, timestamps in list(endpoints.items()):
                recent = [ts for ts in timestamps if now - ts < window_seconds]
                if recent:
                    endpoints[endpoint] = recent
                else:
                    endpoints.pop(endpoint, None)
            if not endpoints:
                _rate_limit_state.pop(client_id, None)


def _check_rate_limit(
    request: web.Request,
    endpoint: str,
    max_requests: int = 10,
    window_seconds: int = 60
) -> Tuple[bool, Optional[int]]:
    """
    Check if the current client exceeded the rate limit.

    Returns:
        (allowed, retry_after_seconds)
    """
    global _rate_limit_cleanup_counter

    try:
        client_id = _get_client_identifier(request)
        now = time.time()
    except Exception:
        # If we can't identify the client, fail open to avoid breaking UI.
        return True, None

    try:
        with _rate_limit_lock:
            _rate_limit_cleanup_counter += 1
            if _rate_limit_cleanup_counter >= _rate_limit_cleanup_interval:
                _cleanup_rate_limit_state(now, max(window_seconds, _RATE_LIMIT_MIN_WINDOW_SECONDS))
                _rate_limit_cleanup_counter = 0

            client_state = _get_or_create_client_state(client_id)
            recent = [ts for ts in client_state[endpoint] if now - ts < window_seconds]

            if len(recent) >= max_requests:
                retry_after = int(window_seconds - (now - recent[0])) + 1
                return False, max(1, retry_after)

            recent.append(now)
            client_state[endpoint] = recent
            return True, None
    except Exception:
        return True, None


def _csrf_error(request: web.Request) -> Optional[str]:
    """
    Enhanced CSRF protection for state-changing endpoints.

    Layers:
      1) Require an anti-CSRF header for state-changing methods (X-Requested-With or X-CSRF-Token)
      2) If Origin is present, validate it against Host (with loopback allowance)
    """
    method = request.method.upper()
    if method not in ("POST", "PUT", "DELETE", "PATCH"):
        return None

    try:
        has_xrw = bool(request.headers.get("X-Requested-With"))
        has_token = bool(request.headers.get("X-CSRF-Token"))
    except Exception:
        has_xrw = False
        has_token = False
    if not has_xrw and not has_token:
        return "Missing anti-CSRF header (X-Requested-With or X-CSRF-Token)"

    origin = request.headers.get("Origin")
    if not origin:
        return None
    if origin == "null":
        return "Cross-site request blocked (Origin=null)"

    host = request.headers.get("Host")
    if not host:
        return "Missing Host header"

    try:
        parsed = urlparse(origin)
    except Exception:
        return "Cross-site request blocked (invalid Origin)"

    if not parsed.scheme or not parsed.netloc:
        return "Cross-site request blocked (invalid Origin)"

    if parsed.netloc != host:
        # Allow loopback aliases (localhost, 127.0.0.1, ::1) to interoperate when the
        # user opens ComfyUI via a different hostname than the server reports.
        try:
            origin_host = parsed.hostname or ""
            origin_port = parsed.port
        except Exception:
            origin_host = ""
            origin_port = None

        try:
            if ":" in host and not host.endswith("]"):
                host_name, host_port_raw = host.rsplit(":", 1)
                host_port = int(host_port_raw)
            else:
                host_name = host
                host_port = None
        except Exception:
            host_name = host
            host_port = None

        loopback = {"localhost", "127.0.0.1", "::1"}
        if origin_host in loopback and host_name in loopback:
            if origin_port is None or host_port is None or origin_port == host_port:
                return None

        return f"Cross-site request blocked ({parsed.netloc} != {host})"

    return None


def _reset_security_state_for_tests() -> None:
    try:
        with _rate_limit_lock:
            _rate_limit_state.clear()
    except Exception:
        pass
