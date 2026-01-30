import json
from pathlib import Path

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from backend.adapters.db.sqlite import Sqlite
from backend.shared import Result
from backend.routes.handlers.assets import register_asset_routes


async def _init_schema(db: Sqlite) -> None:
    await db.aexecutescript(
        """
        PRAGMA foreign_keys=ON;
        CREATE TABLE assets (
            id INTEGER PRIMARY KEY,
            filepath TEXT NOT NULL
        );
        CREATE TABLE scan_journal (
            filepath TEXT PRIMARY KEY,
            state_hash TEXT
        );
        CREATE TABLE metadata_cache (
            filepath TEXT NOT NULL,
            state_hash TEXT NOT NULL,
            metadata_raw TEXT,
            PRIMARY KEY(filepath, state_hash)
        );
        """
    )


@pytest.mark.asyncio
async def test_bulk_delete_aborts_on_file_delete_error(monkeypatch, tmp_path):
    # Deletion is gated behind an explicit opt-in for safety.
    monkeypatch.setenv("MAJOOR_ALLOW_DELETE", "1")

    db = Sqlite(str(tmp_path / "test.db"))
    await _init_schema(db)

    f1 = tmp_path / "a.png"
    f2 = tmp_path / "b.png"
    f1.write_bytes(b"x")
    f2.write_bytes(b"y")

    await db.aexecute("INSERT INTO assets(id, filepath) VALUES (?, ?)", (1, str(f1)))
    await db.aexecute("INSERT INTO assets(id, filepath) VALUES (?, ?)", (2, str(f2)))

    # Patch the imported reference in the handlers module (not the core module).
    import backend.routes.handlers.assets as assets_mod

    async def _mock_require_services():
        return ({"db": db}, None)

    monkeypatch.setattr(assets_mod, "_require_services", _mock_require_services)
    monkeypatch.setattr(assets_mod, "_is_path_allowed", lambda *_args, **_kwargs: True)
    monkeypatch.setattr(assets_mod, "_is_path_allowed_custom", lambda *_args, **_kwargs: True)

    def fake_delete_file_best_effort(path: Path) -> Result[bool]:
        if str(path) == str(f1):
            return Result.Err("DELETE_FAILED", "blocked")
        return Result.Ok(True)

    monkeypatch.setattr(assets_mod, "_delete_file_best_effort", fake_delete_file_best_effort, raising=True)

    routes = web.RouteTableDef()
    register_asset_routes(routes)
    app = web.Application()
    app.add_routes(routes)

    client = TestClient(TestServer(app))
    await client.start_server()
    try:
        resp = await client.post(
            "/mjr/am/assets/delete",
            data=json.dumps({"ids": [1, 2]}),
            headers={"Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest"},
        )
        payload = await resp.json()
        assert payload["ok"] is False
        assert payload["code"] == "DELETE_FAILED"

        still = await db.aquery("SELECT id FROM assets ORDER BY id")
        assert still.ok
        assert [row["id"] for row in (still.data or [])] == [1, 2]
    finally:
        await client.close()
        await db.aclose()
