import json

import pytest

@pytest.mark.asyncio
async def test_search_matches_tags_and_metadata(services):
    db = services["db"]
    index = services["index"]

    # Insert a fake asset + metadata containing searchable tags and prompt-like text.
    insert_asset = await db.aexecute(
        """
        INSERT INTO assets (filename, subfolder, filepath, source, kind, ext, size, mtime)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        ("ftstest.png", "output", "C:/tmp/ftstest.png", "output", "image", ".png", 123, 1700000000),
    )
    assert insert_asset.ok, insert_asset.error
    asset_id = int(insert_asset.data)

    meta_raw = {"prompt": "a cute red panda on a tree", "model": "some-model.safetensors"}
    insert_meta = await db.aexecute(
        """
        INSERT INTO asset_metadata (
            asset_id, rating, tags, tags_text, workflow_hash,
            has_workflow, has_generation_data, metadata_quality, metadata_raw
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            asset_id,
            0,
            json.dumps(["redpanda", "cute"]),
            "redpanda cute",
            None,
            0,
            1,
            "full",
            json.dumps(meta_raw),
        ),
    )
    assert insert_meta.ok, insert_meta.error

    # Regression: Workflow-only filter should not hide assets when DB flags are stale
    # but metadata_raw still contains prompt/workflow.
    res_wf = await index.search("*", limit=50, offset=0, filters={"has_workflow": True})
    assert res_wf.ok, res_wf.error
    wf_ids = [a.get("id") for a in (res_wf.data or {}).get("assets", [])]
    assert asset_id in wf_ids

    # Search by tag
    res = await index.search("redpanda", limit=50, offset=0)
    assert res.ok, res.error
    ids = [a.get("id") for a in (res.data or {}).get("assets", [])]
    assert asset_id in ids

    # Search by prompt/model content (metadata_raw) is intentionally NOT indexed via FTS
    # to keep DB size under control. Only tags/tags_text are indexed.
    res2 = await index.search("panda", limit=50, offset=0)
    assert res2.ok, res2.error
    ids2 = [a.get("id") for a in (res2.data or {}).get("assets", [])]
    assert asset_id not in ids2
