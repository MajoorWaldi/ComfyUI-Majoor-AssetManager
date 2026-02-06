import json

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from backend.routes.handlers.scan import register_scan_routes

@pytest.mark.asyncio
async def test_watcher_scope_returns_ok_without_watcher(monkeypatch):
    import backend.routes.handlers.scan as scan_mod

    async def _mock_require_services():
        return ({"watcher": None, "db": None}, None)

    monkeypatch.setattr(scan_mod, "_require_services", _mock_require_services)

    routes = web.RouteTableDef()
    register_scan_routes(routes)
    app = web.Application()
    app.add_routes(routes)

    client = TestClient(TestServer(app))
    await client.start_server()
    try:
        resp = await client.post(
            "/mjr/am/watcher/scope",
            data=json.dumps({"scope": "output"}),
            headers={"Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest"},
        )
        payload = await resp.json()
        assert payload["ok"] is True, payload
        assert payload["data"]["enabled"] is False
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_watcher_toggle_requires_index(monkeypatch):
    import backend.routes.handlers.scan as scan_mod

    async def _mock_require_services():
        return ({"watcher": None}, None)

    monkeypatch.setattr(scan_mod, "_require_services", _mock_require_services)

    routes = web.RouteTableDef()
    register_scan_routes(routes)
    app = web.Application()
    app.add_routes(routes)

    client = TestClient(TestServer(app))
    await client.start_server()
    try:
        resp = await client.post(
            "/mjr/am/watcher/toggle",
            data=json.dumps({"enabled": True}),
            headers={"Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest"},
        )
        payload = await resp.json()
        assert payload["ok"] is False, payload
        assert payload.get("code") == "SERVICE_UNAVAILABLE"
    finally:
        await client.close()
