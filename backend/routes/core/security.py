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
from typing import Optional, Tuple
from urllib.parse import urlparse

from aiohttp import web

# Per-client rate limiting state: {client_id: {endpoint: [timestamps]}}
# Use LRU eviction to prevent unbounded memory growth from spoofed client IPs.
_DEFAULT_MAX_RATE_LIMIT_CLIENTS = 10_000
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
    while len(_rate_limit_state) > _MAX_RATE_LIMIT_CLIENTS:
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
