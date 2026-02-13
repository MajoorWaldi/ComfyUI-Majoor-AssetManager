import json

import pytest

from mjr_am_backend.shared import Result


@pytest.mark.asyncio
async def test_get_asset_does_not_self_heal_incomplete_geninfo(services):
    db = services["db"]
    index = services["index"]

    prompt_graph = {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "sdxl.safetensors"}},
        "2": {"class_type": "CLIPTextEncode", "inputs": {"text": "a cat", "clip": ["1", 1]}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"text": "blurry", "clip": ["1", 1]}},
        "4": {"class_type": "EmptyLatentImage", "inputs": {"width": 512, "height": 512}},
        "5": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["1", 0],
                "positive": ["2", 0],
                "negative": ["3", 0],
                "latent_image": ["4", 0],
                "seed": 1,
                "steps": 5,
                "cfg": 2.0,
                "sampler_name": "euler",
                "scheduler": "normal",
            },
        },
        "6": {"class_type": "SaveImage", "inputs": {"images": ["5", 0]}},
    }

    # Simulate a stale/partial cached metadata_raw where geninfo exists but is incomplete.
    metadata_obj = {
        "prompt": prompt_graph,
        # Real-world stale case: only sampler + vae recorded, prompts and checkpoint missing.
        "geninfo": {"engine": {"parser_version": "old"}, "sampler": {"name": "euler"}, "models": {"vae": {"name": "ae"}}},
        "quality": "partial",
    }

    res = await db.aexecute(
        """
        INSERT INTO assets (filepath, filename, kind, ext, subfolder, source, root_id, size, mtime)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            r"C:\fake\girl_in_field.png",
            "girl_in_field.png",
            "image",
            ".png",
            "",
            "output",
            0,
            1,
            1,
        ),
    )
    assert res.ok
    row = await db.aquery("SELECT id FROM assets WHERE filepath = ?", (r"C:\fake\girl_in_field.png",))
    assert row.ok and row.data
    asset_id = int(row.data[0].get("id") or 0)
    assert asset_id > 0

    meta_res = Result.Ok(metadata_obj, quality="partial")
    res = await db.aexecute(
        """
        INSERT INTO asset_metadata (asset_id, rating, tags, tags_text, has_workflow, has_generation_data, metadata_quality, metadata_raw)
        VALUES (?, 0, '[]', '', 1, 1, 'partial', ?)
        """,
        (asset_id, json.dumps(meta_res.data)),
    )
    assert res.ok

    result = await index.get_asset(asset_id)
    assert result.ok
    asset = result.data
    assert isinstance(asset, dict)
    gi = asset.get("geninfo")
    assert isinstance(gi, dict)
    # IndexService.get_asset is a fast DB read; "self-heal" happens during scan/enrich flows.
    assert gi.get("engine", {}).get("parser_version") == "old"
    assert gi.get("positive") in (None, {})
    assert gi.get("negative") in (None, {})
    assert gi.get("checkpoint") in (None, {})


@pytest.mark.asyncio
async def test_rename_file_updates_fk_linked_tables_without_integrity_error(services, tmp_path):
    db = services["db"]
    index = services["index"]

    old_file = tmp_path / "old_name.png"
    new_file = tmp_path / "new_name.png"
    old_file.write_bytes(b"png")
    new_file.write_bytes(b"png")

    old_fp = str(old_file)
    new_fp = str(new_file)

    res = await db.aexecute(
        """
        INSERT INTO assets (filepath, filename, kind, ext, subfolder, source, root_id, size, mtime)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            old_fp,
            old_file.name,
            "image",
            ".png",
            str(old_file.parent),
            "output",
            None,
            old_file.stat().st_size,
            int(old_file.stat().st_mtime),
        ),
    )
    assert res.ok, res.error

    res = await db.aexecute(
        "INSERT INTO scan_journal(filepath, dir_path, state_hash, mtime, size) VALUES (?, ?, ?, ?, ?)",
        (old_fp, str(old_file.parent), "state", int(old_file.stat().st_mtime), old_file.stat().st_size),
    )
    assert res.ok, res.error

    res = await db.aexecute(
        "INSERT INTO metadata_cache(filepath, state_hash, metadata_hash, metadata_raw) VALUES (?, ?, ?, ?)",
        (old_fp, "state", "meta", "{}"),
    )
    assert res.ok, res.error

    rename_res = await index.rename_file(old_fp, new_fp)
    assert rename_res.ok, rename_res.error

    q_assets = await db.aquery("SELECT filepath FROM assets WHERE filepath = ?", (new_fp,))
    assert q_assets.ok and q_assets.data
    q_sj = await db.aquery("SELECT filepath FROM scan_journal WHERE filepath = ?", (new_fp,))
    assert q_sj.ok and q_sj.data
    q_mc = await db.aquery("SELECT filepath FROM metadata_cache WHERE filepath = ?", (new_fp,))
    assert q_mc.ok and q_mc.data

