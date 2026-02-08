import pytest


from backend.routes.core.security import _check_write_access


def _clear_auth_env(monkeypatch):
    for key in (
        "MAJOOR_API_TOKEN",
        "MJR_API_TOKEN",
        "MAJOOR_SAFE_MODE",
        "MAJOOR_ALLOW_WRITE",
        "MAJOOR_ALLOW_DELETE",
        "MAJOOR_ALLOW_RENAME",
        "MAJOOR_ALLOW_OPEN_IN_FOLDER",
        "MAJOOR_REQUIRE_AUTH",
        "MAJOOR_ALLOW_REMOTE_WRITE",
    ):
        monkeypatch.delenv(key, raising=False)


@pytest.mark.asyncio
async def test_write_allowed_on_loopback_when_no_token(monkeypatch):
    _clear_auth_env(monkeypatch)
    res = _check_write_access(peer_ip="127.0.0.1", headers={})
    assert res.ok, res.error


@pytest.mark.asyncio
async def test_write_blocked_for_forwarded_remote_when_no_token(monkeypatch):
    _clear_auth_env(monkeypatch)
    # 127.0.0.1 is a trusted proxy by default (see MAJOOR_TRUSTED_PROXIES default),
    # so X-Forwarded-For should be honored and treated as the true client.
    res = _check_write_access(peer_ip="127.0.0.1", headers={"X-Forwarded-For": "8.8.8.8"})
    assert not res.ok
    assert res.code in ("FORBIDDEN", "AUTH_REQUIRED")


@pytest.mark.asyncio
async def test_write_requires_token_when_configured(monkeypatch):
    _clear_auth_env(monkeypatch)
    monkeypatch.setenv("MAJOOR_API_TOKEN", "secret")

    res = _check_write_access(peer_ip="127.0.0.1", headers={})
    assert not res.ok
    assert res.code == "AUTH_REQUIRED"

    res2 = _check_write_access(peer_ip="127.0.0.1", headers={"X-MJR-Token": "secret"})
    assert res2.ok, res2.error


@pytest.mark.asyncio
async def test_write_token_accepts_bearer_header(monkeypatch):
    _clear_auth_env(monkeypatch)
    monkeypatch.setenv("MAJOOR_API_TOKEN", "secret")

    res = _check_write_access(peer_ip="127.0.0.1", headers={"Authorization": "Bearer secret"})
    assert res.ok, res.error


@pytest.mark.asyncio
async def test_allow_remote_write_override(monkeypatch):
    _clear_auth_env(monkeypatch)
    monkeypatch.setenv("MAJOOR_ALLOW_REMOTE_WRITE", "1")

    res = _check_write_access(peer_ip="203.0.113.10", headers={})
    assert res.ok, res.error


@pytest.mark.asyncio
async def test_require_auth_without_token_blocks(monkeypatch):
    _clear_auth_env(monkeypatch)
    monkeypatch.setenv("MAJOOR_REQUIRE_AUTH", "1")

    res = _check_write_access(peer_ip="127.0.0.1", headers={})
    assert not res.ok
    assert res.code == "AUTH_REQUIRED"
