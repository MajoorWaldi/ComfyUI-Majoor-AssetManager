import json
from pathlib import Path

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from backend.adapters.db.sqlite import Sqlite
from backend.routes.handlers.assets import register_asset_routes
from backend.shared import Result


@pytest.mark.asyncio
async def test_open_in_folder_returns_ok(tmp_path: Path, monkeypatch):
    db = Sqlite(str(tmp_path / "assets.db"))
    await db.aexecutescript(
        """
        CREATE TABLE assets (
            id INTEGER PRIMARY KEY,
            filepath TEXT NOT NULL
        );
        """
    )

    out_dir = tmp_path / "out"
    out_dir.mkdir(parents=True, exist_ok=True)
    file_path = out_dir / "a.png"
    file_path.write_bytes(b"x")
    await db.aexecute("INSERT INTO assets(id, filepath) VALUES (?, ?)", (1, str(file_path)))

    import backend.routes.handlers.assets as assets_mod

    async def _mock_require_services():
        return ({"db": db}, None)

    async def _mock_resolve_security_prefs(_svc):
        return {}

    monkeypatch.setattr(assets_mod, "_require_services", _mock_require_services)
    monkeypatch.setattr(assets_mod, "_resolve_security_prefs", _mock_resolve_security_prefs)
    monkeypatch.setattr(assets_mod, "_require_operation_enabled", lambda *a, **k: Result.Ok(True))
    monkeypatch.setattr(assets_mod, "_require_write_access", lambda *a, **k: Result.Ok(True))
    monkeypatch.setattr(assets_mod, "_check_rate_limit", lambda *a, **k: (True, None))
    monkeypatch.setattr(assets_mod, "_is_path_allowed", lambda p: True)
    monkeypatch.setattr(assets_mod, "_is_path_allowed_custom", lambda p: False)

    class _DummyPopen:
        def __init__(self, *args, **kwargs):
            pass

    monkeypatch.setattr(assets_mod.subprocess, "Popen", _DummyPopen)

    routes = web.RouteTableDef()
    register_asset_routes(routes)
    app = web.Application()
    app.add_routes(routes)

    client = TestClient(TestServer(app))
    await client.start_server()
    try:
        resp = await client.post(
            "/mjr/am/open-in-folder",
            data=json.dumps({"asset_id": 1}),
            headers={"Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest"},
        )
        payload = await resp.json()
        assert payload["ok"] is True, payload
    finally:
        await client.close()
        try:
            await db.aclose()
        except Exception:
            pass
