import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from backend.shared import Result
from backend.routes.handlers.search import register_search_routes


class _FakeIndex:
    async def search_scoped(self, *_args, **_kwargs):
        return Result.Ok({"assets": [], "total": 0, "limit": 50, "offset": 0, "query": "*"})


@pytest.mark.asyncio
async def test_list_output_falls_back_to_filesystem_when_db_empty(monkeypatch, tmp_path):
    out_root = tmp_path / "output"
    out_root.mkdir(parents=True, exist_ok=True)
    (out_root / "a.png").write_bytes(b"x")

    import backend.routes.handlers.search as mod

    monkeypatch.setattr(mod, "OUTPUT_ROOT", str(out_root), raising=True)
    
    async def _mock_require_services():
        return ({"index": _FakeIndex()}, None)
        
    monkeypatch.setattr(mod, "_require_services", _mock_require_services, raising=True)
    async def _mock_kickoff(*a, **k):
        return None
    monkeypatch.setattr(mod, "_kickoff_background_scan", _mock_kickoff, raising=True)

    routes = web.RouteTableDef()
    register_search_routes(routes)
    app = web.Application()
    app.add_routes(routes)

    client = TestClient(TestServer(app))
    await client.start_server()
    try:
        resp = await client.get("/mjr/am/list?scope=output&q=*&limit=50&offset=0")
        payload = await resp.json()
        assert payload["ok"] is True
        data = payload["data"]
        assert data["scope"] == "output"
        assert (data.get("total") or 0) >= 1
        assets = data.get("assets") or []
        assert any(a.get("filename") == "a.png" for a in assets if isinstance(a, dict))
    finally:
        await client.close()

