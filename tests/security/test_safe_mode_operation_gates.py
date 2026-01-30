import pytest
from backend.routes.core.security import _require_operation_enabled


def _clear_env(monkeypatch):
    for key in (
        "MAJOOR_SAFE_MODE",
        "MAJOOR_ALLOW_WRITE",
        "MAJOOR_ALLOW_DELETE",
        "MAJOOR_ALLOW_RENAME",
        "MAJOOR_ALLOW_OPEN_IN_FOLDER",
    ):
        monkeypatch.delenv(key, raising=False)


@pytest.mark.asyncio
async def test_safe_mode_blocks_write_by_default(monkeypatch):
    _clear_env(monkeypatch)
    res = _require_operation_enabled("asset_rating")
    assert not res.ok
    assert res.code == "FORBIDDEN"


@pytest.mark.asyncio
async def test_safe_mode_allows_write_with_allow_write(monkeypatch):
    _clear_env(monkeypatch)
    monkeypatch.setenv("MAJOOR_ALLOW_WRITE", "1")
    res = _require_operation_enabled("asset_tags")
    assert res.ok, res.error


@pytest.mark.asyncio
async def test_disable_safe_mode_allows_write(monkeypatch):
    _clear_env(monkeypatch)
    monkeypatch.setenv("MAJOOR_SAFE_MODE", "0")
    res = _require_operation_enabled("asset_tags")
    assert res.ok, res.error


@pytest.mark.asyncio
async def test_delete_requires_explicit_opt_in_even_if_safe_mode_off(monkeypatch):
    _clear_env(monkeypatch)
    monkeypatch.setenv("MAJOOR_SAFE_MODE", "0")
    res = _require_operation_enabled("asset_delete")
    assert not res.ok
    assert res.code == "FORBIDDEN"

    monkeypatch.setenv("MAJOOR_ALLOW_DELETE", "1")
    res2 = _require_operation_enabled("asset_delete")
    assert res2.ok, res2.error


@pytest.mark.asyncio
async def test_rename_requires_explicit_opt_in(monkeypatch):
    _clear_env(monkeypatch)
    monkeypatch.setenv("MAJOOR_ALLOW_RENAME", "1")
    res = _require_operation_enabled("asset_rename")
    assert res.ok, res.error


@pytest.mark.asyncio
async def test_open_in_folder_requires_explicit_opt_in(monkeypatch):
    _clear_env(monkeypatch)
    res = _require_operation_enabled("open_in_folder")
    assert not res.ok
    monkeypatch.setenv("MAJOOR_ALLOW_OPEN_IN_FOLDER", "1")
    res2 = _require_operation_enabled("open_in_folder")
    assert res2.ok, res2.error

