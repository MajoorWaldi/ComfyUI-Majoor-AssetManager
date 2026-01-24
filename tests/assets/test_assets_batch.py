import json

import pytest


@pytest.mark.asyncio
async def test_get_assets_batch_preserves_order_and_parses_fields(services):
    db = services["db"]
    index = services["index"]

    # Insert two assets
    r1 = db.execute(
        """
        INSERT INTO assets (filepath, filename, kind, ext, subfolder, source, root_id, size, mtime)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (r"C:\fake\a.png", "a.png", "image", ".png", "", "output", 0, 1, 1),
    )
    assert r1.ok
    r2 = db.execute(
        """
        INSERT INTO assets (filepath, filename, kind, ext, subfolder, source, root_id, size, mtime)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (r"C:\fake\b.png", "b.png", "image", ".png", "", "output", 0, 1, 1),
    )
    assert r2.ok

    rows = db.query(
        "SELECT id, filepath FROM assets WHERE filepath IN (?, ?) ORDER BY filepath ASC",
        (r"C:\fake\a.png", r"C:\fake\b.png"),
    )
    assert rows.ok and rows.data and len(rows.data) == 2
    id_a = int(rows.data[0]["id"])
    id_b = int(rows.data[1]["id"])

    meta_a = {"quality": "partial", "prompt": {"1": {"class_type": "KSampler", "inputs": {}}}}
    meta_b = {"quality": "none"}

    assert db.execute(
        """
        INSERT INTO asset_metadata (asset_id, rating, tags, tags_text, has_workflow, has_generation_data, metadata_quality, metadata_raw)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (id_a, 3, json.dumps(["tag1", "tag2"]), "tag1 tag2", 1, 1, "partial", json.dumps(meta_a)),
    ).ok
    assert db.execute(
        """
        INSERT INTO asset_metadata (asset_id, rating, tags, tags_text, has_workflow, has_generation_data, metadata_quality, metadata_raw)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (id_b, 0, json.dumps([]), "", 0, 0, "none", json.dumps(meta_b)),
    ).ok

    res = await index.get_assets_batch([id_b, id_a])
    assert res.ok
    assets = res.data
    assert isinstance(assets, list)
    assert [a.get("id") for a in assets] == [id_b, id_a]

    # Tags parsed as list
    assert isinstance(assets[0].get("tags"), list)
    assert isinstance(assets[1].get("tags"), list)
    assert assets[1]["tags"] == ["tag1", "tag2"]
