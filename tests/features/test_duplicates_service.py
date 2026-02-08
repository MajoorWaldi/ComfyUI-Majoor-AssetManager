import asyncio
from pathlib import Path

import pytest
from PIL import Image


def _make_image(path: Path, color: tuple[int, int, int]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img = Image.new("RGB", (32, 32), color=color)
    img.save(path)


@pytest.mark.asyncio
async def test_duplicates_analysis_and_alerts(services, tmp_path):
    db = services["db"]
    dup = services["duplicates"]

    a = tmp_path / "a.png"
    b = tmp_path / "b.png"
    _make_image(a, (255, 0, 0))
    _make_image(b, (255, 0, 0))

    await db.aexecute(
        """
        INSERT INTO assets (filename, subfolder, filepath, source, root_id, kind, ext, size, mtime)
        VALUES (?, '', ?, 'output', NULL, 'image', '.png', ?, ?)
        """,
        ("a.png", str(a), int(a.stat().st_size), int(a.stat().st_mtime)),
    )
    await db.aexecute(
        """
        INSERT INTO assets (filename, subfolder, filepath, source, root_id, kind, ext, size, mtime)
        VALUES (?, '', ?, 'output', NULL, 'image', '.png', ?, ?)
        """,
        ("b.png", str(b), int(b.stat().st_size), int(b.stat().st_mtime)),
    )

    started = await dup.start_background_analysis(limit=50)
    assert started.ok

    for _ in range(30):
        status = await dup.get_status()
        assert status.ok
        if not status.data.get("running"):
            break
        await asyncio.sleep(0.1)

    alerts = await dup.get_alerts(roots=[str(tmp_path.resolve())], max_groups=10, max_pairs=10, phash_distance=8)
    assert alerts.ok
    exact = alerts.data.get("exact_groups") or []
    assert len(exact) >= 1
    assert int(exact[0].get("count") or 0) >= 2


@pytest.mark.asyncio
async def test_duplicates_merge_tags(services):
    db = services["db"]
    dup = services["duplicates"]

    await db.aexecute(
        """
        INSERT INTO assets (filename, subfolder, filepath, source, root_id, kind, ext, size, mtime)
        VALUES ('k.png', '', 'C:/tmp/k.png', 'output', NULL, 'image', '.png', 1, 1)
        """
    )
    await db.aexecute(
        """
        INSERT INTO assets (filename, subfolder, filepath, source, root_id, kind, ext, size, mtime)
        VALUES ('d.png', '', 'C:/tmp/d.png', 'output', NULL, 'image', '.png', 1, 1)
        """
    )
    rows = await db.aquery("SELECT id FROM assets ORDER BY id ASC")
    ids = [int((r or {}).get("id") or 0) for r in (rows.data or [])]
    keep_id, dup_id = ids[-2], ids[-1]

    await db.aexecute(
        "INSERT INTO asset_metadata (asset_id, tags) VALUES (?, ?)",
        (keep_id, '["alpha"]'),
    )
    await db.aexecute(
        "INSERT INTO asset_metadata (asset_id, tags) VALUES (?, ?)",
        (dup_id, '["beta","alpha"]'),
    )

    merged = await dup.merge_tags_for_group(keep_id, [dup_id])
    assert merged.ok
    assert set(merged.data.get("tags") or []) == {"alpha", "beta"}
