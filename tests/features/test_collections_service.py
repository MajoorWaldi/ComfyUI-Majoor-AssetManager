from pathlib import Path

from backend.features.collections.service import CollectionsService


def test_add_assets_reports_skipped_existing_and_duplicates(monkeypatch, tmp_path):
    # Ensure the service writes into a temp collections directory.
    import backend.features.collections.service as service_mod

    monkeypatch.setattr(service_mod, "COLLECTIONS_DIR_PATH", tmp_path, raising=True)

    svc = CollectionsService()
    created = svc.create("Test")
    assert created.ok
    cid = created.data["id"]

    fp = str((tmp_path / "a.png").resolve())

    # Same filepath twice in the same request -> 1 added, 1 duplicate skipped.
    res1 = svc.add_assets(
        cid,
        [
            {"filepath": fp, "filename": "a.png", "type": "output"},
            {"filepath": fp, "filename": "a.png", "type": "output"},
        ],
    )
    assert res1.ok
    assert res1.data["added"] == 1
    assert res1.data["skipped_duplicate"] == 1
    assert res1.data["skipped_existing"] == 0

    # Adding again -> skipped_existing increments.
    res2 = svc.add_assets(cid, [{"filepath": fp, "filename": "a.png", "type": "output"}])
    assert res2.ok
    assert res2.data["added"] == 0
    assert res2.data["skipped_existing"] == 1

