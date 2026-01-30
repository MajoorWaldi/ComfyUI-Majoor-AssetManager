import pytest
from backend.adapters.db.sqlite import Sqlite
from backend.settings import AppSettings


async def _init_settings_db(db: Sqlite) -> None:
    await db.aexecutescript(
        """
        CREATE TABLE metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        """
    )


@pytest.mark.asyncio
async def test_settings_cache_version_invalidation(tmp_path):
    db = Sqlite(str(tmp_path / "test.db"))
    await _init_settings_db(db)

    a = AppSettings(db)
    b = AppSettings(db)

    # Make the test deterministic: always re-check version.
    a._cache_ttl_s = 999.0
    a._version_cache_ttl_s = 0.0

    before = await a.get_probe_backend()
    assert before in ("auto", "exiftool", "ffprobe", "both")

    res = await b.set_probe_backend("ffprobe")
    assert res.ok

    after = await a.get_probe_backend()
    assert after == "ffprobe"

    await db.aclose()

