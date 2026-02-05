import json
import time
from pathlib import Path

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from backend.adapters.db.sqlite import Sqlite
from backend.adapters.db.schema import ensure_tables_exist, ensure_indexes_and_triggers
from backend.routes.handlers.scan import register_scan_routes


@pytest.mark.asyncio
async def test_reset_index_hard_reset_deletes_and_recreates_db(monkeypatch, tmp_path: Path):
    # Reset is gated behind an explicit opt-in for safety.
    monkeypatch.setenv("MAJOOR_ALLOW_RESET_INDEX", "1")

    db_path = tmp_path / "assets.sqlite"
    db = Sqlite(str(db_path))

    # Initialize schema + create some data so the file definitely exists.
    schema_res = await ensure_tables_exist(db)
    assert schema_res.ok, schema_res.error
    idx_res = await ensure_indexes_and_triggers(db)
    assert idx_res.ok, idx_res.error

    await db.aexecute("INSERT INTO assets(filename, filepath, kind, ext, size, mtime) VALUES(?,?,?,?,?,?)", (
        "a.png",
        str(tmp_path / "a.png"),
        "image",
        "png",
        1,
        1,
    ))

    assert db_path.exists()
    before_mtime = db_path.stat().st_mtime

    # Ensure WAL/SHM can exist on some platforms (best-effort; not strictly required).
    wal_path = Path(str(db_path) + "-wal")
    shm_path = Path(str(db_path) + "-shm")

    # Monkeypatch scan handler to run without ComfyUI folder_paths.
    import backend.routes.handlers.scan as scan_mod

    class _FP:
        @staticmethod
        def get_input_directory():
            p = tmp_path / "input"
            p.mkdir(parents=True, exist_ok=True)
            return str(p)

    monkeypatch.setattr(scan_mod, "folder_paths", _FP, raising=False)
    monkeypatch.setattr(scan_mod, "OUTPUT_ROOT", str(tmp_path / "output"), raising=False)

    async def _mock_require_services():
        # No index service needed because reindex=False.
        return ({"db": db}, None)

    monkeypatch.setattr(scan_mod, "_require_services", _mock_require_services)

    routes = web.RouteTableDef()
    register_scan_routes(routes)
    app = web.Application()
    app.add_routes(routes)

    client = TestClient(TestServer(app))
    await client.start_server()
    try:
        time.sleep(1.05)  # mtime resolution guard (Windows)
        resp = await client.post(
            "/mjr/am/index/reset",
            data=json.dumps(
                {
                    "scope": "all",
                    "reindex": False,
                    "hard_reset_db": True,
                    "rebuild_fts": False,
                }
            ),
            headers={"Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest"},
        )
        payload = await resp.json()
        assert payload["ok"] is True, payload

        assert db_path.exists()
        after_mtime = db_path.stat().st_mtime
        assert after_mtime >= before_mtime

        # Data should be gone after hard reset.
        q = await db.aquery("SELECT COUNT(*) as c FROM assets")
        assert q.ok
        count = int((q.data or [{}])[0].get("c") or 0)
        assert count == 0

        # WAL/SHM are adapter-managed; they may or may not exist immediately.
        # If they do exist, they should be regular files.
        if wal_path.exists():
            assert wal_path.is_file()
        if shm_path.exists():
            assert shm_path.is_file()
    finally:
        await client.close()
        await db.aclose()
