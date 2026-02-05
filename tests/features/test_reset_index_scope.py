import json
from pathlib import Path

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from backend.adapters.db.sqlite import Sqlite
from backend.routes.handlers.scan import register_scan_routes


async def _init_schema(db: Sqlite) -> None:
    await db.aexecutescript(
        """
        PRAGMA foreign_keys=ON;

        CREATE TABLE assets (
            id INTEGER PRIMARY KEY,
            filepath TEXT NOT NULL UNIQUE
        );

        CREATE TABLE asset_metadata (
            asset_id INTEGER PRIMARY KEY,
            metadata_raw TEXT DEFAULT '{}',
            FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
        );

        CREATE TABLE scan_journal (
            filepath TEXT PRIMARY KEY,
            state_hash TEXT,
            FOREIGN KEY (filepath) REFERENCES assets(filepath) ON DELETE CASCADE
        );

        CREATE TABLE metadata_cache (
            filepath TEXT PRIMARY KEY,
            state_hash TEXT,
            metadata_raw TEXT DEFAULT '{}',
            FOREIGN KEY (filepath) REFERENCES assets(filepath) ON DELETE CASCADE
        );
        """
    )


@pytest.mark.asyncio
async def test_reset_index_output_scope_does_not_wipe_other_roots(monkeypatch, tmp_path: Path):
    # Reset is gated behind an explicit opt-in for safety.
    monkeypatch.setenv("MAJOOR_ALLOW_RESET_INDEX", "1")

    db = Sqlite(str(tmp_path / "test.db"))
    await _init_schema(db)

    out_dir = tmp_path / "out"
    in_dir = tmp_path / "in"
    custom_dir = tmp_path / "custom"
    out_dir.mkdir(parents=True, exist_ok=True)
    in_dir.mkdir(parents=True, exist_ok=True)
    custom_dir.mkdir(parents=True, exist_ok=True)

    fp_out = str(out_dir / "a.png")
    fp_in = str(in_dir / "b.png")
    fp_custom = str(custom_dir / "c.png")

    await db.aexecute("INSERT INTO assets(id, filepath) VALUES (?, ?)", (1, fp_out))
    await db.aexecute("INSERT INTO assets(id, filepath) VALUES (?, ?)", (2, fp_in))
    await db.aexecute("INSERT INTO assets(id, filepath) VALUES (?, ?)", (3, fp_custom))

    await db.aexecute("INSERT INTO asset_metadata(asset_id, metadata_raw) VALUES (?, ?)", (1, "{\"x\": 1}"))
    await db.aexecute("INSERT INTO asset_metadata(asset_id, metadata_raw) VALUES (?, ?)", (2, "{\"x\": 2}"))
    await db.aexecute("INSERT INTO asset_metadata(asset_id, metadata_raw) VALUES (?, ?)", (3, "{\"x\": 3}"))

    await db.aexecute("INSERT INTO scan_journal(filepath, state_hash) VALUES (?, ?)", (fp_out, "o"))
    await db.aexecute("INSERT INTO scan_journal(filepath, state_hash) VALUES (?, ?)", (fp_in, "i"))
    await db.aexecute("INSERT INTO scan_journal(filepath, state_hash) VALUES (?, ?)", (fp_custom, "c"))

    await db.aexecute("INSERT INTO metadata_cache(filepath, state_hash, metadata_raw) VALUES (?, ?, ?)", (fp_out, "o", "{}"))
    await db.aexecute("INSERT INTO metadata_cache(filepath, state_hash, metadata_raw) VALUES (?, ?, ?)", (fp_in, "i", "{}"))
    await db.aexecute("INSERT INTO metadata_cache(filepath, state_hash, metadata_raw) VALUES (?, ?, ?)", (fp_custom, "c", "{}"))

    import backend.routes.handlers.scan as scan_mod

    async def _mock_require_services():
        return ({"db": db}, None)

    monkeypatch.setattr(scan_mod, "_require_services", _mock_require_services)
    monkeypatch.setattr(scan_mod, "OUTPUT_ROOT", str(out_dir))

    routes = web.RouteTableDef()
    register_scan_routes(routes)
    app = web.Application()
    app.add_routes(routes)

    client = TestClient(TestServer(app))
    await client.start_server()
    try:
        resp = await client.post(
            "/mjr/am/index/reset",
            data=json.dumps(
                {
                    "scope": "output",
                    "reindex": False,
                    "rebuild_fts": False,
                    "clear_scan_journal": True,
                    "clear_metadata_cache": True,
                    "clear_asset_metadata": True,
                    "clear_assets": True,
                }
            ),
            headers={"Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest"},
        )
        payload = await resp.json()
        assert payload["ok"] is True, payload

        # Output entries should be removed; input/custom should remain.
        q_assets = await db.aquery("SELECT filepath FROM assets ORDER BY id")
        assert q_assets.ok
        remaining = [row["filepath"] for row in (q_assets.data or [])]
        assert remaining == [fp_in, fp_custom]

        q_meta = await db.aquery("SELECT asset_id FROM asset_metadata ORDER BY asset_id")
        assert q_meta.ok
        assert [row["asset_id"] for row in (q_meta.data or [])] == [2, 3]

        q_sj = await db.aquery("SELECT filepath FROM scan_journal ORDER BY filepath")
        assert q_sj.ok
        assert [row["filepath"] for row in (q_sj.data or [])] == sorted([fp_in, fp_custom])

        q_mc = await db.aquery("SELECT filepath FROM metadata_cache ORDER BY filepath")
        assert q_mc.ok
        assert [row["filepath"] for row in (q_mc.data or [])] == sorted([fp_in, fp_custom])
    finally:
        await client.close()
        await db.aclose()
