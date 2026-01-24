from backend.adapters.db.sqlite import Sqlite
from backend.settings import AppSettings


def _init_settings_db(db: Sqlite) -> None:
    db.executescript(
        """
        CREATE TABLE metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        """
    )


def test_settings_cache_version_invalidation(tmp_path):
    db = Sqlite(str(tmp_path / "test.db"))
    _init_settings_db(db)

    a = AppSettings(db)
    b = AppSettings(db)

    # Make the test deterministic: always re-check version.
    a._cache_ttl_s = 999.0
    a._version_cache_ttl_s = 0.0

    before = a.get_probe_backend()
    assert before in ("auto", "exiftool", "ffprobe", "both")

    res = b.set_probe_backend("ffprobe")
    assert res.ok

    after = a.get_probe_backend()
    assert after == "ffprobe"

    db.close()

