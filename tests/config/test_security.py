from aiohttp.test_utils import make_mocked_request

from backend.routes.core.security import _check_rate_limit, _csrf_error, _reset_security_state_for_tests


class _DummyTransport:
    def __init__(self, peername):
        self._peername = peername

    def get_extra_info(self, name, default=None):
        if name == "peername":
            return self._peername
        return default


def test_csrf_allows_get():
    req = make_mocked_request("GET", "/mjr/am/health", headers={"Host": "localhost:8188"})
    assert _csrf_error(req) is None


def test_csrf_rejects_missing_header_on_post():
    req = make_mocked_request("POST", "/mjr/am/scan", headers={"Host": "localhost:8188"})
    assert _csrf_error(req)


def test_csrf_accepts_x_requested_with_on_post():
    req = make_mocked_request(
        "POST",
        "/mjr/am/scan",
        headers={"Host": "localhost:8188", "X-Requested-With": "XMLHttpRequest"},
    )
    assert _csrf_error(req) is None


def test_csrf_rejects_cross_origin():
    req = make_mocked_request(
        "POST",
        "/mjr/am/scan",
        headers={
            "Host": "localhost:8188",
            "Origin": "http://evil.example:8188",
            "X-Requested-With": "XMLHttpRequest",
        },
    )
    err = _csrf_error(req)
    assert err and "Cross-site request blocked" in err


def test_rate_limit_is_per_client():
    _reset_security_state_for_tests()

    req1 = make_mocked_request(
        "POST",
        "/mjr/am/scan",
        headers={"X-Forwarded-For": "1.2.3.4", "X-Requested-With": "XMLHttpRequest"},
        transport=_DummyTransport(("127.0.0.1", 1234)),
    )
    req2 = make_mocked_request(
        "POST",
        "/mjr/am/scan",
        headers={"X-Forwarded-For": "5.6.7.8", "X-Requested-With": "XMLHttpRequest"},
        transport=_DummyTransport(("127.0.0.1", 1235)),
    )

    assert _check_rate_limit(req1, "scan", max_requests=2, window_seconds=60)[0] is True
    assert _check_rate_limit(req1, "scan", max_requests=2, window_seconds=60)[0] is True
    allowed, retry_after = _check_rate_limit(req1, "scan", max_requests=2, window_seconds=60)
    assert allowed is False
    assert isinstance(retry_after, int) and retry_after >= 1

    # Different client should still be allowed.
    assert _check_rate_limit(req2, "scan", max_requests=2, window_seconds=60)[0] is True


def test_csrf_accepts_csrf_token_header():
    """X-CSRF-Token header should also work as anti-CSRF protection."""
    req = make_mocked_request(
        "POST",
        "/mjr/am/asset/delete",
        headers={"Host": "localhost:8188", "X-CSRF-Token": "test-token-123"},
    )
    assert _csrf_error(req) is None


def test_csrf_rejects_origin_null():
    """Origin: null should be blocked (common in sandboxed iframes)."""
    req = make_mocked_request(
        "POST",
        "/mjr/am/scan",
        headers={
            "Host": "localhost:8188",
            "Origin": "null",
            "X-Requested-With": "XMLHttpRequest",
        },
    )
    err = _csrf_error(req)
    assert err and "Origin=null" in err


def test_csrf_allows_loopback_aliases():
    """Loopback aliases (localhost, 127.0.0.1, ::1) should interoperate."""
    req = make_mocked_request(
        "POST",
        "/mjr/am/scan",
        headers={
            "Host": "localhost:8188",
            "Origin": "http://127.0.0.1:8188",
            "X-Requested-With": "XMLHttpRequest",
        },
    )
    assert _csrf_error(req) is None


def test_csrf_checks_put_delete_patch():
    """All state-changing methods should be checked."""
    for method in ["PUT", "DELETE", "PATCH"]:
        req = make_mocked_request(method, "/mjr/am/asset/123", headers={"Host": "localhost:8188"})
        err = _csrf_error(req)
        assert err is not None, f"{method} should require CSRF protection"


def test_rate_limit_per_endpoint():
    """Rate limits should be independent per endpoint."""
    _reset_security_state_for_tests()

    req = make_mocked_request(
        "POST",
        "/mjr/am/scan",
        headers={"X-Forwarded-For": "1.2.3.4", "X-Requested-With": "XMLHttpRequest"},
    )

    # Exhaust scan endpoint
    for _ in range(2):
        _check_rate_limit(req, "scan", max_requests=2, window_seconds=60)

    # scan blocked
    allowed, _ = _check_rate_limit(req, "scan", max_requests=2, window_seconds=60)
    assert allowed is False

    # delete still allowed
    allowed, _ = _check_rate_limit(req, "delete", max_requests=2, window_seconds=60)
    assert allowed is True


def test_rate_limit_returns_retry_after():
    """Rate limit should return retry-after seconds."""
    _reset_security_state_for_tests()

    req = make_mocked_request(
        "POST",
        "/mjr/am/scan",
        headers={"X-Forwarded-For": "1.2.3.4", "X-Requested-With": "XMLHttpRequest"},
    )

    # Exhaust limit
    for _ in range(3):
        _check_rate_limit(req, "test", max_requests=3, window_seconds=60)

    # Check retry-after
    allowed, retry_after = _check_rate_limit(req, "test", max_requests=3, window_seconds=60)
    assert allowed is False
    assert retry_after is not None
    assert 1 <= retry_after <= 61  # Should be between 1 and window_seconds + 1


def test_rate_limit_uses_x_real_ip():
    """Should use X-Real-IP if X-Forwarded-For not present."""
    _reset_security_state_for_tests()

    req = make_mocked_request(
        "POST",
        "/mjr/am/scan",
        headers={"X-Real-IP": "1.2.3.4", "X-Requested-With": "XMLHttpRequest"},
    )

    # Exhaust limit
    for _ in range(2):
        allowed, _ = _check_rate_limit(req, "test", max_requests=2, window_seconds=60)
        assert allowed is True

    # Should be blocked
    allowed, _ = _check_rate_limit(req, "test", max_requests=2, window_seconds=60)
    assert allowed is False
