import pytest
import time
from pathlib import Path

@pytest.mark.asyncio
async def test_fast_scan_enriches_metadata_in_background(tmp_path: Path):
    """
    Fast scan should avoid running metadata tools inline (metadata_raw initially '{}'),
    then background enrichment should populate metadata_raw and metadata_cache.
    """
    from backend.deps import build_services

    db_path = tmp_path / "fast_scan.db"
    services_res = await build_services(db_path=str(db_path))
    assert services_res.ok, services_res.error
    services = services_res.data
    index = services["index"]
    db = services["db"]

    # Create a few dummy supported files (valid bytes not required; tools may be missing).
    scan_dir = tmp_path / "scan_root"
    scan_dir.mkdir(parents=True, exist_ok=True)
    files = [
        scan_dir / "a.png",
        scan_dir / "b.webp",
        scan_dir / "c.mp4",
    ]
    for f in files:
        f.write_bytes(b"not-a-real-file")

    # Run fast scan with background enrichment.
    res = await index.scan_directory(
        str(scan_dir),
        recursive=False,
        incremental=False,
        source="output",
        root_id=None,
        fast=True,
        background_metadata=True,
    )
    assert res.ok, res.error

    filepaths = [str(f) for f in files]
    placeholders = ", ".join(["?"] * len(files))

    # Immediately after fast scan: asset_metadata exists but metadata_raw is still '{}' (fast path).
    meta_res = await db.aquery(
        f"""
        SELECT a.filepath, m.metadata_raw
        FROM assets a
        LEFT JOIN asset_metadata m ON a.id = m.asset_id
        WHERE a.filepath IN ({placeholders})
        """,
        tuple(filepaths),
    )
    assert meta_res.ok, meta_res.error
    assert len(meta_res.data or []) == len(files)
    assert all((row.get("metadata_raw") or "{}") == "{}" for row in (meta_res.data or []))

    # Background worker should populate metadata_raw and metadata_cache entries.
    deadline = time.time() + 8.0
    while time.time() < deadline:
        meta_res2 = await db.aquery(
            f"""
            SELECT a.filepath, m.metadata_raw
            FROM assets a
            LEFT JOIN asset_metadata m ON a.id = m.asset_id
            WHERE a.filepath IN ({placeholders})
            """,
            tuple(filepaths),
        )
        assert meta_res2.ok, meta_res2.error
        raws = [row.get("metadata_raw") for row in (meta_res2.data or [])]
        if raws and all(isinstance(r, str) and r != "{}" for r in raws):
            break
        time.sleep(0.1)

    assert raws and all(isinstance(r, str) and r != "{}" for r in raws)

    cache_res = await db.aquery(
        f"SELECT COUNT(*) as c FROM metadata_cache WHERE filepath IN ({placeholders})",
        tuple(filepaths),
    )
    assert cache_res.ok, cache_res.error
    count = int((cache_res.data or [{}])[0].get("c") or 0)
    assert count == len(files)
