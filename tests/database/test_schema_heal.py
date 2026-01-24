import sqlite3


def test_schema_self_heals_missing_columns(tmp_path):
    from backend.adapters.db.sqlite import Sqlite
    from backend.adapters.db.schema import CURRENT_SCHEMA_VERSION, migrate_schema

    db_path = tmp_path / "partial_schema.db"

    # Create an "old/partial" schema that reports as up-to-date but is missing columns.
    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute(
            "CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
        )
        conn.execute(
            "INSERT OR REPLACE INTO metadata (key, value) VALUES ('schema_version', ?)",
            (str(CURRENT_SCHEMA_VERSION),),
        )
        conn.execute(
            """
            CREATE TABLE assets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT NOT NULL,
                filepath TEXT NOT NULL UNIQUE,
                kind TEXT NOT NULL,
                ext TEXT NOT NULL,
                size INTEGER NOT NULL,
                mtime INTEGER NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE asset_metadata (
                asset_id INTEGER PRIMARY KEY,
                rating INTEGER DEFAULT 0
            )
            """
        )
        conn.commit()
    finally:
        conn.close()

    db = Sqlite(str(db_path))
    try:
        result = migrate_schema(db)
        assert result.ok, result.error

        assets_cols = db.query("PRAGMA table_info('assets')")
        assert assets_cols.ok, assets_cols.error
        assets_col_names = {row["name"] for row in (assets_cols.data or [])}
        for name in ["source", "root_id", "subfolder", "width", "height", "duration", "indexed_at"]:
            assert name in assets_col_names

        meta_cols = db.query("PRAGMA table_info('asset_metadata')")
        assert meta_cols.ok, meta_cols.error
        meta_col_names = {row["name"] for row in (meta_cols.data or [])}
        for name in [
            "tags",
            "tags_text",
            "workflow_hash",
            "has_workflow",
            "has_generation_data",
            "metadata_quality",
            "metadata_raw",
        ]:
            assert name in meta_col_names

        # Ensure common queries won't crash with "no such column".
        assert db.query("SELECT source, root_id FROM assets LIMIT 0").ok
        assert db.query(
            """
            SELECT tags, metadata_raw, has_workflow, has_generation_data, metadata_quality
            FROM asset_metadata
            LIMIT 0
            """
        ).ok
    finally:
        try:
            db.close()
        except Exception:
            pass

