import json
from pathlib import Path

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from mjr_am_backend.adapters.db.sqlite import Sqlite
from mjr_am_backend.routes.handlers.assets import register_asset_routes


async def _init_schema(db: Sqlite) -> None:
    await db.aexecutescript(
        """
        PRAGMA foreign_keys=ON;
        CREATE TABLE assets (
            id INTEGER PRIMARY KEY,
            filename TEXT NOT NULL,
            filepath TEXT NOT NULL UNIQUE,
            mtime INTEGER DEFAULT 0
        );
        CREATE TABLE scan_journal (
            filepath TEXT PRIMARY KEY,
            state_hash TEXT,
            FOREIGN KEY (filepath) REFERENCES assets(filepath) ON DELETE CASCADE
        );
        CREATE TABLE metadata_cache (
            filepath TEXT PRIMARY KEY,
            state_hash TEXT,
            FOREIGN KEY (filepath) REFERENCES assets(filepath) ON DELETE CASCADE
        );
        """
    )


@pytest.mark.asyncio
async def test_asset_rename_updates_fk_tables_without_integrity_error(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("MAJOOR_ALLOW_RENAME", "1")

    db = Sqlite(str(tmp_path / "test.db"))
    await _init_schema(db)

    old_file = tmp_path / "old_name.png"
    old_file.write_bytes(b"x")
    old_fp = str(old_file)
    new_name = "new_name.png"
    new_fp = str(tmp_path / new_name)

    await db.aexecute(
        "INSERT INTO assets(id, filename, filepath, mtime) VALUES (?, ?, ?, ?)",
        (1, old_file.name, old_fp, int(old_file.stat().st_mtime)),
    )
    await db.aexecute("INSERT INTO scan_journal(filepath, state_hash) VALUES (?, ?)", (old_fp, "s"))
    await db.aexecute("INSERT INTO metadata_cache(filepath, state_hash) VALUES (?, ?)", (old_fp, "m"))

    import mjr_am_backend.routes.handlers.assets as assets_mod

    async def _mock_require_services():
        return ({"db": db}, None)

    monkeypatch.setattr(assets_mod, "_require_services", _mock_require_services)
    monkeypatch.setattr(assets_mod, "_is_path_allowed", lambda *_args, **_kwargs: True)
    monkeypatch.setattr(assets_mod, "_is_path_allowed_custom", lambda *_args, **_kwargs: True)

    routes = web.RouteTableDef()
    register_asset_routes(routes)
    app = web.Application()
    app.add_routes(routes)

    client = TestClient(TestServer(app))
    await client.start_server()
    try:
        resp = await client.post(
            "/mjr/am/asset/rename",
            data=json.dumps({"asset_id": 1, "new_name": new_name}),
            headers={"Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest"},
        )
        payload = await resp.json()
        assert payload["ok"] is True, payload

        q_asset = await db.aquery("SELECT filepath, filename FROM assets WHERE id = 1")
        assert q_asset.ok and q_asset.data
        assert q_asset.data[0]["filepath"] == new_fp
        assert q_asset.data[0]["filename"] == new_name

        q_sj = await db.aquery("SELECT filepath FROM scan_journal")
        assert q_sj.ok and q_sj.data
        assert q_sj.data[0]["filepath"] == new_fp

        q_mc = await db.aquery("SELECT filepath FROM metadata_cache")
        assert q_mc.ok and q_mc.data
        assert q_mc.data[0]["filepath"] == new_fp
    finally:
        await client.close()
        await db.aclose()
