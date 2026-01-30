import json
from pathlib import Path

import pytest

from backend.adapters.db.schema import migrate_schema
from backend.adapters.db.sqlite import Sqlite
from backend.features.metadata.service import MetadataService
from backend.routes.handlers.search import register_search_routes
from backend.shared import Result


class _SettingsStub:
    def get_probe_backend(self) -> str:  # pragma: no cover
        return "auto"


class _ExifToolStub:
    def __init__(self, data):
        self._data = data

    def read(self, path: str, tags=None):
        return Result.Ok(self._data)

    def is_available(self) -> bool:  # pragma: no cover
        return True


class _FFProbeStub:
    def read(self, path: str):  # pragma: no cover
        return Result.Err("NO", "no")

    def is_available(self) -> bool:  # pragma: no cover
        return False


@pytest.mark.asyncio
async def test_get_asset_hydrate_rating_tags_updates_db(tmp_path: Path):
    # DB + schema
    db_path = tmp_path / "t.db"
    db = Sqlite(str(db_path))
    mig = await migrate_schema(db)
    assert mig.ok

    # Asset + empty metadata
    f = tmp_path / "a.png"
    f.write_bytes(b"x")
    ins = await db.aexecute(
        "INSERT INTO assets(filepath, filename, subfolder, source, root_id, kind, ext, size, mtime) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (str(f), "a.png", "", "output", "output", "image", ".png", 1, 1700000000),
    )
    assert ins.ok
    asset_id = (await db.aquery("SELECT id FROM assets")).data[0]["id"]
    await db.aexecute(
        "INSERT INTO asset_metadata(asset_id, rating, tags, tags_text, has_workflow, has_generation_data, metadata_quality, metadata_raw) VALUES(?, 0, '[]', '', 0, 0, 'none', '{}')",
        (asset_id,),
    )

    # Services with stub exif
    exif = {"XMP-xmp:Rating": 4, "XMP-dc:Subject": ["foo"]}
    meta = MetadataService(exiftool=_ExifToolStub(exif), ffprobe=_FFProbeStub(), settings=_SettingsStub())

    from backend.features.index.service import IndexService

    index = IndexService(db=db, metadata_service=meta)

    app = __import__("aiohttp").web.Application()
    routes = __import__("aiohttp").web.RouteTableDef()
    register_search_routes(routes)
    app.add_routes(routes)

    # Inject services into the route core singleton.
    from backend.routes.core import services as core_services  # type: ignore

    core_services._services = {"db": db, "index": index, "metadata": meta}  # type: ignore[attr-defined]
    core_services._services_error = None  # type: ignore[attr-defined]

    from aiohttp.test_utils import TestClient, TestServer

    server = TestServer(app)
    client = TestClient(server)
    await client.start_server()
    resp = await client.get(f"/mjr/am/asset/{asset_id}?hydrate=rating_tags")
    body = await resp.json()
    await client.close()
    assert body["ok"] is True
    assert body["data"]["rating"] == 4
    assert "foo" in (body["data"]["tags"] or [])

    row = (await db.aquery("SELECT rating, tags FROM asset_metadata WHERE asset_id = ?", (asset_id,))).data[0]
    assert row["rating"] == 4
    assert "foo" in json.loads(row["tags"])
