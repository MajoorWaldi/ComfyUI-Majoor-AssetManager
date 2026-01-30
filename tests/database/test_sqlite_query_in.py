import pytest
from backend.adapters.db.sqlite import Sqlite


async def _init_db(db: Sqlite) -> None:
    await db.aexecutescript(
        """
        CREATE TABLE assets (
            id INTEGER PRIMARY KEY,
            filepath TEXT NOT NULL,
            mtime INTEGER NOT NULL
        );
        INSERT INTO assets(id, filepath, mtime) VALUES (1, 'a.png', 10);
        INSERT INTO assets(id, filepath, mtime) VALUES (2, 'b.png', 20);
        """
    )


@pytest.mark.asyncio
async def test_query_in_empty_list_returns_ok(tmp_path):
    db = Sqlite(str(tmp_path / "test.db"))
    await _init_db(db)
    res = await db.aquery_in("SELECT * FROM assets WHERE {IN_CLAUSE}", "id", [])
    assert res.ok
    assert res.data == []
    await db.aclose()


@pytest.mark.asyncio
async def test_query_in_rejects_invalid_column(tmp_path):
    db = Sqlite(str(tmp_path / "test.db"))
    await _init_db(db)
    res = await db.aquery_in("SELECT * FROM assets WHERE {IN_CLAUSE}", "id; DROP TABLE assets;--", [1])
    assert not res.ok
    await db.aclose()


@pytest.mark.asyncio
async def test_query_in_supports_additional_params(tmp_path):
    db = Sqlite(str(tmp_path / "test.db"))
    await _init_db(db)
    res = await db.aquery_in(
        "SELECT id FROM assets WHERE {IN_CLAUSE} AND mtime > ?",
        "id",
        [1, 2],
        additional_params=(15,),
    )
    assert res.ok
    assert [row["id"] for row in (res.data or [])] == [2]
    await db.aclose()


@pytest.mark.asyncio
async def test_query_in_allows_table_alias_column(tmp_path):
    db = Sqlite(str(tmp_path / "test.db"))
    await _init_db(db)
    res = await db.aquery_in("SELECT a.id FROM assets a WHERE {IN_CLAUSE}", "a.id", [1, 2])
    assert res.ok
    assert [row["id"] for row in (res.data or [])] == [1, 2]
    await db.aclose()


@pytest.mark.asyncio
async def test_query_in_repairs_whitespace_column(tmp_path):
    db = Sqlite(str(tmp_path / "test.db"))
    await _init_db(db)
    res = await db.aquery_in("SELECT id FROM assets WHERE {IN_CLAUSE}", "  id  ", [1, 2])
    assert res.ok
    assert [row["id"] for row in (res.data or [])] == [1, 2]
    await db.aclose()
