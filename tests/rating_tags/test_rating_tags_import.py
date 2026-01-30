"""
Tests for importing ratings and tags logic, ensuring no data loss or incorrect overwrites.
"""
import pytest
import json
from pathlib import Path

from backend.adapters.db.sqlite import Sqlite
from backend.adapters.db.schema import migrate_schema
from backend.features.index.metadata_helpers import MetadataHelpers
from backend.shared import Result


async def _make_db(tmp_path: Path) -> Sqlite:
    db_path = tmp_path / "test.db"
    db = Sqlite(str(db_path))
    mig = await migrate_schema(db)
    assert mig.ok
    return db


@pytest.mark.asyncio
async def test_imports_rating_tags_when_db_empty(tmp_path: Path):
    db = await _make_db(tmp_path)

    ins = await db.aexecute(
        "INSERT INTO assets(filepath, filename, subfolder, source, root_id, kind, ext, size, mtime) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("C:\\x\\a.png", "a.png", "", "output", "output", "image", ".png", 123, 1700000000),
    )
    assert ins.ok
    asset_id = (await db.aquery("SELECT id FROM assets")).data[0]["id"]

    meta = Result.Ok({"rating": 4, "tags": ["foo", "bar"], "quality": "partial"})
    w = await MetadataHelpers.write_asset_metadata_row(db, asset_id, meta)
    assert w.ok

    row = (await db.aquery("SELECT rating, tags, tags_text FROM asset_metadata WHERE asset_id = ?", (asset_id,))).data[0]
    assert row["rating"] == 4
    assert json.loads(row["tags"]) == ["foo", "bar"]
    assert row["tags_text"] == "foo bar"


@pytest.mark.asyncio
async def test_does_not_override_existing_db_rating_tags(tmp_path: Path):
    db = await _make_db(tmp_path)

    ins = await db.aexecute(
        "INSERT INTO assets(filepath, filename, subfolder, source, root_id, kind, ext, size, mtime) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("C:\\x\\b.png", "b.png", "", "output", "output", "image", ".png", 123, 1700000000),
    )
    assert ins.ok
    asset_id = (await db.aquery("SELECT id FROM assets")).data[0]["id"]

    await db.aexecute(
        "INSERT INTO asset_metadata(asset_id, rating, tags, tags_text, has_workflow, has_generation_data, metadata_quality, metadata_raw) VALUES(?, ?, ?, ?, 0, 0, 'none', '{}')",
        (asset_id, 5, json.dumps(["keep"], ensure_ascii=False), "keep"),
    )

    meta = Result.Ok({"rating": 1, "tags": ["overwrite"], "quality": "partial"})
    w = await MetadataHelpers.write_asset_metadata_row(db, asset_id, meta)
    assert w.ok

    row = (await db.aquery("SELECT rating, tags, tags_text FROM asset_metadata WHERE asset_id = ?", (asset_id,))).data[0]
    assert row["rating"] == 5
    assert json.loads(row["tags"]) == ["keep"]
    assert row["tags_text"] == "keep"
