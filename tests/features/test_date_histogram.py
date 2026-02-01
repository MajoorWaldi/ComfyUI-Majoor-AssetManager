import datetime
from pathlib import Path

from backend.adapters.db.schema import init_schema, table_has_column
from backend.adapters.db.sqlite import Sqlite
from backend.features.index.searcher import IndexSearcher


def _ts(y, m, d, hh=0, mm=0, ss=0) -> int:
    return int(datetime.datetime(y, m, d, hh, mm, ss).timestamp())


import pytest


@pytest.mark.asyncio
async def test_date_histogram_scoped_counts_days(tmp_path: Path):
    db_path = tmp_path / "assets.sqlite"
    db = Sqlite(str(db_path), max_connections=1, timeout=1.0)
    assert (await init_schema(db)).ok

    root_dir = (tmp_path / "out").resolve()
    root_dir.mkdir(parents=True, exist_ok=True)

    assets = [
        # Jan 5th: 2 assets
        ("a.png", str(root_dir / "a.png"), "image", _ts(2026, 1, 5, 12, 0, 0), 111),
        ("b.mp4", str(root_dir / "b.mp4"), "video", _ts(2026, 1, 5, 18, 0, 0), 222),
        # Jan 10th: 1 asset
        ("c.png", str(root_dir / "sub" / "c.png"), "image", _ts(2026, 1, 10, 1, 2, 3), 333),
        # Feb 1st: should be excluded
        ("d.png", str(root_dir / "d.png"), "image", _ts(2026, 2, 1, 0, 0, 0), 444),
    ]

    for filename, filepath, kind, mtime, size in assets:
        await db.aexecute(
            """
            INSERT INTO assets(filename, subfolder, filepath, source, root_id, kind, ext, size, mtime, width, height, duration)
            VALUES (?, '', ?, 'output', NULL, ?, ?, ?, ?, NULL, NULL, NULL)
            """,
            (filename, filepath, kind, filename.split(".")[-1], int(size), int(mtime)),
        )

    # Add metadata rows so rating/workflow filters can be exercised.
    rows = (await db.aquery("SELECT id FROM assets ORDER BY id")).data
    for r in rows:
        await db.aexecute(
            "INSERT INTO asset_metadata(asset_id, rating, tags, tags_text, has_workflow, has_generation_data, metadata_raw) VALUES (?, ?, '[]', '', ?, 0, '{}')",
            (int(r["id"]), 0, 0),
        )

    has_tags_text = await table_has_column(db, "asset_metadata", "tags_text")
    searcher = IndexSearcher(db, has_tags_text)

    month_start = _ts(2026, 1, 1, 0, 0, 0)
    month_end = _ts(2026, 2, 1, 0, 0, 0)

    res = await searcher.date_histogram_scoped([str(root_dir)], month_start, month_end)
    assert res.ok
    assert res.data["2026-01-05"] == 2
    assert res.data["2026-01-10"] == 1
    assert "2026-02-01" not in res.data

    res_video = await searcher.date_histogram_scoped([str(root_dir)], month_start, month_end, filters={"kind": "video"})
    assert res_video.ok
    assert res_video.data == {"2026-01-05": 1}
    await db.aclose()
