import pytest
from pathlib import Path
from aiohttp import web, FormData
from aiohttp.test_utils import TestClient, TestServer

from backend.routes.handlers.scan import register_scan_routes


@pytest.mark.asyncio
async def test_upload_input_file_writes_to_input_dir(tmp_path: Path, monkeypatch):
    import backend.routes.handlers.scan as scan_mod

    input_dir = tmp_path / "input"
    input_dir.mkdir(parents=True, exist_ok=True)

    class _FolderPathsStub:
        @staticmethod
        def get_input_directory() -> str:
            return str(input_dir)

    monkeypatch.setattr(scan_mod, "folder_paths", _FolderPathsStub(), raising=False)

    routes = web.RouteTableDef()
    register_scan_routes(routes)
    app = web.Application()
    app.add_routes(routes)

    client = TestClient(TestServer(app))
    await client.start_server()
    try:
        data = FormData()
        data.add_field("file", b"hello-world", filename="hello.txt", content_type="text/plain")
        resp = await client.post(
            "/mjr/am/upload_input?purpose=node_drop",
            data=data,
            headers={"X-Requested-With": "XMLHttpRequest"},
        )
        payload = await resp.json()
        assert payload["ok"] is True, payload
        assert (input_dir / "hello.txt").exists()
    finally:
        await client.close()
