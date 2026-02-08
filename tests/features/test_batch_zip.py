import io
import json
import zipfile

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from backend.routes.handlers.batch_zip import register_batch_zip_routes


@pytest.mark.asyncio
async def test_batch_zip_is_flat_and_renames_duplicates(monkeypatch, tmp_path):
    # Arrange: two files with the same name under different subfolders.
    out_root = tmp_path / "output"
    (out_root / "a").mkdir(parents=True)
    (out_root / "b").mkdir(parents=True)
    (out_root / "a" / "same.png").write_bytes(b"a")
    (out_root / "b" / "same.png").write_bytes(b"b")

    # Patch handler module globals to use temp output/batch directory.
    import backend.routes.handlers.batch_zip as mod

    monkeypatch.setattr(mod, "OUTPUT_ROOT_PATH", out_root, raising=True)
    monkeypatch.setattr(mod, "_BATCH_DIR", out_root / "_mjr_batch_zips", raising=True)

    routes = web.RouteTableDef()
    register_batch_zip_routes(routes)
    app = web.Application()
    app.add_routes(routes)

    client = TestClient(TestServer(app))
    await client.start_server()
    try:
        token = "mjr_testtoken_abcdef12"
        resp = await client.post(
            "/mjr/am/batch-zip",
            data=json.dumps(
                {
                    "token": token,
                    "items": [
                        {"filename": "same.png", "subfolder": "a", "type": "output"},
                        {"filename": "same.png", "subfolder": "b", "type": "output"},
                    ],
                }
            ),
            headers={"Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest"},
        )
        payload = await resp.json()
        assert payload["ok"] is True
        assert payload["data"]["token"] == token
        assert payload["data"]["count"] == 2

        dl = await client.get(f"/mjr/am/batch-zip/{token}")
        assert dl.status == 200
        body = await dl.read()

        zf = zipfile.ZipFile(io.BytesIO(body), "r")
        names = zf.namelist()
        assert "same.png" in names
        assert "same (2).png" in names
        assert all("/" not in n and "\\" not in n for n in names)
    finally:
        await client.close()

