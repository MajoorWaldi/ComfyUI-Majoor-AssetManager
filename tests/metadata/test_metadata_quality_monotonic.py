import json
from pathlib import Path

from backend.adapters.db.schema import init_schema
from backend.adapters.db.sqlite import Sqlite
from backend.features.index.metadata_helpers import MetadataHelpers
from backend.shared import Result


def test_write_asset_metadata_row_does_not_downgrade_quality(tmp_path: Path):
    db_path = tmp_path / "assets.sqlite"
    db = Sqlite(str(db_path), max_connections=1, timeout=1.0)
    assert init_schema(db).ok

    root_dir = (tmp_path / "out").resolve()
    root_dir.mkdir(parents=True, exist_ok=True)
    filepath = str(root_dir / "a.png")

    db.execute(
        """
        INSERT INTO assets(filename, subfolder, filepath, source, root_id, kind, ext, size, mtime, width, height, duration)
        VALUES ('a.png', '', ?, 'output', NULL, 'image', 'png', 1, 1, NULL, NULL, NULL)
        """,
        (filepath,),
    )
    asset_id = int(db.query("SELECT id FROM assets LIMIT 1").data[0]["id"])

    full_meta = Result.Ok(
        {
            "quality": "full",
            "workflow": {"nodes": [{"type": "KSampler"}]},
            "parameters": {"prompt": "x"},
        },
        quality="full",
    )
    assert MetadataHelpers.write_asset_metadata_row(db, asset_id, full_meta).ok

    failed = Result.Err("PARSE_ERROR", "boom", quality="degraded")
    degraded_payload = MetadataHelpers.metadata_error_payload(failed, filepath)
    assert degraded_payload.ok
    assert MetadataHelpers.write_asset_metadata_row(db, asset_id, degraded_payload).ok

    row = db.query(
        "SELECT has_workflow, has_generation_data, metadata_quality, metadata_raw FROM asset_metadata WHERE asset_id = ?",
        (asset_id,),
    ).data[0]
    assert int(row["has_workflow"]) == 1
    assert int(row["has_generation_data"]) == 1
    assert row["metadata_quality"] == "full"
    parsed = json.loads(row["metadata_raw"])
    assert parsed.get("quality") == "full"

    db.close()
