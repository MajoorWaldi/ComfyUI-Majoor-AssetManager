import pytest
import contextlib
from pathlib import Path


@pytest.mark.asyncio
async def test_scan_uses_batched_transactions(tmp_path: Path):
    """
    Large scans should not BEGIN/COMMIT per file.

    We count `db.transaction()` invocations during a scan and ensure it's bounded
    by the batch size logic (<< number of files).
    """
    from backend.deps import build_services

    db_path = tmp_path / "batching.db"
    services_res = await build_services(db_path=str(db_path))
    assert services_res.ok, services_res.error
    services = services_res.data
    index = services["index"]
    db = services["db"]

    scan_dir = tmp_path / "scan_root"
    scan_dir.mkdir(parents=True, exist_ok=True)

    files = []
    for i in range(120):
        p = scan_dir / f"f_{i:03d}.png"
        p.write_bytes(b"not-a-real-file")
        files.append(p)

    txn_calls = {"count": 0}
    original_txn = db.transaction

    @contextlib.contextmanager
    def counted_transaction(*args, **kwargs):
        txn_calls["count"] += 1
        with original_txn(*args, **kwargs):
            yield

    db.transaction = counted_transaction  # type: ignore[assignment]
    try:
        res = await index.scan_directory(
            str(scan_dir),
            recursive=False,
            incremental=False,
            source="output",
            root_id=None,
            fast=True,
            background_metadata=False,
        )
        assert res.ok, res.error
    finally:
        db.transaction = original_txn  # type: ignore[assignment]

    # With default batching for ~120 files we expect ~3 transactions (50-sized batches),
    # but allow a small buffer if batching logic changes slightly.
    assert txn_calls["count"] <= 6
    assert txn_calls["count"] < len(files)

    c = await db.aquery("SELECT COUNT(*) as c FROM assets")
    assert c.ok
    assert int((c.data or [{}])[0].get("c") or 0) == len(files)
