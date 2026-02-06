"""
Database schema and migrations.
"""
import hashlib
import re
from pathlib import Path
from typing import List

from ...shared import Result, get_logger, log_success

logger = get_logger(__name__)

CURRENT_SCHEMA_VERSION = 7
# Schema version history (high-level):
# 1: initial assets + metadata tables
# 2-4: incremental columns and FTS/search support
# 5: workflow/generation flags, scan journal, and robustness fixes
# 6: asset sources (output/input/custom) + custom root id
# 7: metadata FTS (tags/metadata_raw) to improve search UX

# Schema definition
SCHEMA_V1 = """
-- Metadata table for schema versioning
CREATE TABLE IF NOT EXISTS metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Assets table
CREATE TABLE IF NOT EXISTS assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    subfolder TEXT DEFAULT '',
    filepath TEXT NOT NULL UNIQUE,
    source TEXT DEFAULT 'output', -- output, input, custom
    root_id TEXT, -- for source=custom
    kind TEXT NOT NULL,  -- image, video, audio, model3d
    ext TEXT NOT NULL,
    size INTEGER NOT NULL,  -- File size in bytes
    mtime INTEGER NOT NULL,  -- File modification time (unix timestamp)
    width INTEGER,  -- Image/video width (NULL for non-visual assets)
    height INTEGER,  -- Image/video height (NULL for non-visual assets)
    duration REAL,  -- Video/audio duration in seconds (NULL for non-temporal assets)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Asset metadata (ratings, tags, workflow)
CREATE TABLE IF NOT EXISTS asset_metadata (
    asset_id INTEGER PRIMARY KEY,
    rating INTEGER DEFAULT 0,
    tags TEXT DEFAULT '',  -- JSON array stored as string
    tags_text TEXT DEFAULT '',  -- Legacy text column
    workflow_hash TEXT,
    has_workflow BOOLEAN DEFAULT 0,
    has_generation_data BOOLEAN DEFAULT 0,
    metadata_quality TEXT DEFAULT 'none',  -- full, partial, degraded, none
    metadata_raw TEXT DEFAULT '{}',  -- Full raw metadata as JSON
    FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);

-- Scan journal to track last-processed state per file
CREATE TABLE IF NOT EXISTS scan_journal (
    filepath TEXT PRIMARY KEY,
    dir_path TEXT,
    state_hash TEXT,
    mtime INTEGER,
    size INTEGER,
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (filepath) REFERENCES assets(filepath) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS metadata_cache (
    filepath TEXT PRIMARY KEY,
    state_hash TEXT,
    metadata_hash TEXT,
    metadata_raw TEXT DEFAULT '{}',
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (filepath) REFERENCES assets(filepath) ON DELETE CASCADE
);
"""

# Migration from v1 to v2: Add metadata_raw column
COLUMN_DEFINITIONS = {
    "assets": [
        # Contract columns used by services/UI (self-heal for partially/old-created DBs)
        ("subfolder", "subfolder TEXT DEFAULT ''"),
        ("source", "source TEXT DEFAULT 'output'"),
        ("root_id", "root_id TEXT"),
        ("width", "width INTEGER"),
        ("height", "height INTEGER"),
        ("duration", "duration REAL"),
        ("created_at", "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"),
        ("updated_at", "updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"),
        ("indexed_at", "indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"),
    ],
    "asset_metadata": [
        ("rating", "rating INTEGER DEFAULT 0"),
        ("tags", "tags TEXT DEFAULT ''"),
        ("tags_text", "tags_text TEXT DEFAULT ''"),
        ("workflow_hash", "workflow_hash TEXT"),
        ("has_workflow", "has_workflow BOOLEAN DEFAULT 0"),
        ("has_generation_data", "has_generation_data BOOLEAN DEFAULT 0"),
        ("metadata_quality", "metadata_quality TEXT DEFAULT 'none'"),
        ("metadata_raw", "metadata_raw TEXT DEFAULT '{}'"),
    ],
    "scan_journal": [
        ("dir_path", "dir_path TEXT"),
        ("state_hash", "state_hash TEXT"),
        ("mtime", "mtime INTEGER"),
        ("size", "size INTEGER"),
        ("last_seen", "last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP"),
    ],
    "metadata_cache": [
        ("state_hash", "state_hash TEXT"),
        ("metadata_hash", "metadata_hash TEXT"),
        ("metadata_raw", "metadata_raw TEXT DEFAULT '{}'"),
        ("last_updated", "last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP"),
    ],
}

INDEXES_AND_TRIGGERS = """
-- Full-text search (FTS5) for filenames
CREATE VIRTUAL TABLE IF NOT EXISTS assets_fts USING fts5(
    filename,
    subfolder,
    content='assets',
    content_rowid='id'
);

-- Full-text search (FTS5) for metadata/tags
-- Note: contentless table keyed by asset_id to avoid duplicating base rows.
-- Removed metadata_raw to reduce DB size and improve performance
CREATE VIRTUAL TABLE IF NOT EXISTS asset_metadata_fts USING fts5(
    tags,
    tags_text,
    content=''
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_assets_filename ON assets(filename);
CREATE INDEX IF NOT EXISTS idx_assets_subfolder ON assets(subfolder);
CREATE INDEX IF NOT EXISTS idx_assets_kind ON assets(kind);
CREATE INDEX IF NOT EXISTS idx_assets_mtime ON assets(mtime);
CREATE INDEX IF NOT EXISTS idx_assets_kind_mtime ON assets(kind, mtime);
CREATE INDEX IF NOT EXISTS idx_assets_source ON assets(source);
CREATE INDEX IF NOT EXISTS idx_assets_root_id ON assets(root_id);
CREATE INDEX IF NOT EXISTS idx_assets_source_root_id ON assets(source, root_id);
-- Prevent duplicate entries for the same path/source/root (best-effort; filepath is already UNIQUE).
CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_filepath_source_root ON assets(filepath, source, root_id);
CREATE INDEX IF NOT EXISTS idx_metadata_rating ON asset_metadata(rating);
CREATE INDEX IF NOT EXISTS idx_metadata_workflow_hash ON asset_metadata(workflow_hash);
CREATE INDEX IF NOT EXISTS idx_metadata_quality_workflow ON asset_metadata(metadata_quality, has_workflow);
-- Performance Audit Additions
CREATE INDEX IF NOT EXISTS idx_assets_source_mtime_desc ON assets(source, mtime DESC);
CREATE INDEX IF NOT EXISTS idx_asset_metadata_has_workflow_true ON asset_metadata(has_workflow) WHERE has_workflow = 1;
CREATE INDEX IF NOT EXISTS idx_asset_metadata_has_generation_data_true ON asset_metadata(has_generation_data) WHERE has_generation_data = 1;
CREATE INDEX IF NOT EXISTS idx_assets_list_cover ON assets(source, mtime DESC, id, filename, filepath, kind);

CREATE INDEX IF NOT EXISTS idx_scan_journal_dir ON scan_journal(dir_path);
CREATE INDEX IF NOT EXISTS idx_metadata_cache_state ON metadata_cache(state_hash);

CREATE TRIGGER IF NOT EXISTS assets_fts_insert AFTER INSERT ON assets BEGIN
    INSERT INTO assets_fts(rowid, filename, subfolder)
    VALUES (new.id, new.filename, new.subfolder);
END;

CREATE TRIGGER IF NOT EXISTS assets_fts_delete AFTER DELETE ON assets BEGIN
    DELETE FROM assets_fts WHERE rowid = old.id;
END;

CREATE TRIGGER IF NOT EXISTS assets_fts_update AFTER UPDATE ON assets BEGIN
    UPDATE assets_fts SET filename = new.filename, subfolder = new.subfolder
    WHERE rowid = new.id;
END;

-- Keep metadata FTS in sync
CREATE TRIGGER IF NOT EXISTS asset_metadata_fts_insert AFTER INSERT ON asset_metadata BEGIN
    INSERT INTO asset_metadata_fts(rowid, tags, tags_text)
    VALUES (new.asset_id, COALESCE(new.tags, ''), COALESCE(new.tags_text, ''));
END;

CREATE TRIGGER IF NOT EXISTS asset_metadata_fts_delete AFTER DELETE ON asset_metadata BEGIN
    INSERT INTO asset_metadata_fts(asset_metadata_fts, rowid) VALUES('delete', old.asset_id);
END;

CREATE TRIGGER IF NOT EXISTS asset_metadata_fts_update AFTER UPDATE ON asset_metadata BEGIN
    INSERT INTO asset_metadata_fts(asset_metadata_fts, rowid) VALUES('delete', old.asset_id);
    INSERT INTO asset_metadata_fts(rowid, tags, tags_text)
    VALUES (new.asset_id, COALESCE(new.tags, ''), COALESCE(new.tags_text, ''));
END;
"""

_SAFE_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _is_safe_identifier(value: str) -> bool:
    return bool(value and isinstance(value, str) and _SAFE_IDENT_RE.match(value))


async def _get_table_columns(db, table_name: str) -> Result[List[str]]:
    if not _is_safe_identifier(table_name):
        return Result.Err("INVALID_INPUT", f"Invalid table name: {table_name}")
    result = await db.aquery(f"PRAGMA table_info('{table_name}')")
    if not result.ok:
        return Result.Err("PRAGMA_FAILED", f"Unable to inspect {table_name}: {result.error}")
    return Result.Ok([row["name"] for row in result.data or []])


async def table_has_column(db, table_name: str, column_name: str) -> bool:
    """Return True if `table_name` has `column_name` (best-effort)."""
    if not _is_safe_identifier(table_name) or not _is_safe_identifier(column_name):
        logger.warning("Invalid identifier in table_has_column: %s.%s", table_name, column_name)
        return False
    columns_result = await _get_table_columns(db, table_name)
    if not columns_result.ok:
        logger.warning(
            "Unable to determine columns for %s.%s: %s",
            table_name,
            column_name,
            columns_result.error
        )
        return False

    return column_name in columns_result.data


async def _ensure_column(db, table_name: str, column_name: str, definition: str) -> Result[bool]:
    columns_result = await _get_table_columns(db, table_name)
    if not columns_result.ok:
        return columns_result

    if column_name in columns_result.data:
        return Result.Ok(True)

    logger.info("Adding missing column %s.%s", table_name, column_name)
    alter_result = await db.aexecute(
        f"ALTER TABLE {table_name} ADD COLUMN {definition}"
    )
    return alter_result


async def ensure_columns_exist(db) -> Result[bool]:
    """Ensure required columns exist in existing tables (best-effort)."""
    for table, columns in COLUMN_DEFINITIONS.items():
        for column_name, definition in columns:
            result = await _ensure_column(db, table, column_name, definition)
            if not result.ok:
                logger.error("Failed to ensure column %s.%s: %s", table, column_name, result.error)
                return result
    return Result.Ok(True)


async def ensure_tables_exist(db) -> Result[bool]:
    """Ensure base schema tables exist (idempotent)."""
    logger.info("Ensuring tables exist...")
    result = await db.aexecutescript(SCHEMA_V1)
    if not result.ok:
        logger.error("Failed to ensure base tables: %s", result.error)
    return result


async def ensure_indexes_and_triggers(db) -> Result[bool]:
    """Ensure indexes/triggers exist and repair FTS metadata (best-effort)."""
    logger.info("Ensuring indexes/triggers exist...")
    result = await db.aexecutescript(INDEXES_AND_TRIGGERS)
    if not result.ok:
        logger.error("Failed to ensure indexes/triggers: %s", result.error)
        return result
    repair_result = await _repair_asset_metadata_fts(db)
    if repair_result and not repair_result.ok:
        logger.warning("Failed to repair asset_metadata_fts: %s", repair_result.error)
    return result


async def _fts_has_column(db, table: str, col: str) -> bool:
    """Check if an FTS table has a specific column."""
    try:
        r = await db.aquery(f"PRAGMA table_info({table})")
        if not r.ok or not r.data:
            return False
        return any((row.get("name") == col) for row in r.data)
    except Exception:
        return False


async def _repair_asset_metadata_fts(db) -> Result[bool]:
    """
    Repair legacy/incorrect FTS definition for asset metadata.

    Older versions used `content_rowid='asset_id'` on a contentless table, which can
    break updates with errors like "no such column: T.asset_id".
    Also check for missing `tags_text` column in existing FTS tables.
    """
    try:
        table_row = await db.aquery("SELECT sql FROM sqlite_master WHERE type='table' AND name='asset_metadata_fts' LIMIT 1")
        ddl = ""
        if table_row.ok and table_row.data:
            ddl = str(table_row.data[0].get("sql") or "")
        ddl_lower = ddl.lower()

        trig_row = await db.aquery("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='asset_metadata_fts_update' LIMIT 1")
        trig_sql = ""
        if trig_row.ok and trig_row.data:
            trig_sql = str(trig_row.data[0].get("sql") or "")
        trig_lower = trig_sql.lower()

        needs_table_rebuild = ("content_rowid" in ddl_lower and "asset_id" in ddl_lower)
        needs_trigger_rebuild = ("update asset_metadata_fts" in trig_lower)
        missing_tags_text = not await _fts_has_column(db, "asset_metadata_fts", "tags_text")

        if missing_tags_text:
            needs_table_rebuild = True

        if not (needs_table_rebuild or needs_trigger_rebuild):
            return Result.Ok(True)
    except Exception:
        return Result.Ok(True)

    logger.warning("Repairing asset_metadata_fts (schema/triggers)")

    try:
        async with db.atransaction(mode="immediate") as tx:
            if not tx.ok:
                return Result.Err("DB_ERROR", tx.error or "Failed to begin transaction")
            if needs_table_rebuild:
                await db.aexecutescript(
                    """
                    DROP TRIGGER IF EXISTS asset_metadata_fts_insert;
                    DROP TRIGGER IF EXISTS asset_metadata_fts_delete;
                    DROP TRIGGER IF EXISTS asset_metadata_fts_update;
                    DROP TABLE IF EXISTS asset_metadata_fts;
                    """
                )
                await db.aexecutescript(
                    """
                    CREATE VIRTUAL TABLE IF NOT EXISTS asset_metadata_fts USING fts5(
                        tags,
                        tags_text,
                        content=''
                    );
                    """
                )
            else:
                await db.aexecutescript(
                    """
                    DROP TRIGGER IF EXISTS asset_metadata_fts_insert;
                    DROP TRIGGER IF EXISTS asset_metadata_fts_delete;
                    DROP TRIGGER IF EXISTS asset_metadata_fts_update;
                    """
                )

            await db.aexecutescript(
                """
                CREATE TRIGGER IF NOT EXISTS asset_metadata_fts_insert AFTER INSERT ON asset_metadata BEGIN
                    INSERT INTO asset_metadata_fts(rowid, tags, tags_text)
                    VALUES (new.asset_id, COALESCE(new.tags, ''), COALESCE(new.tags_text, ''));
                END;

                CREATE TRIGGER IF NOT EXISTS asset_metadata_fts_delete AFTER DELETE ON asset_metadata BEGIN
                    INSERT INTO asset_metadata_fts(asset_metadata_fts, rowid) VALUES('delete', old.asset_id);
                END;

                CREATE TRIGGER IF NOT EXISTS asset_metadata_fts_update AFTER UPDATE ON asset_metadata BEGIN
                    INSERT INTO asset_metadata_fts(asset_metadata_fts, rowid) VALUES('delete', old.asset_id);
                    INSERT INTO asset_metadata_fts(rowid, tags, tags_text)
                    VALUES (new.asset_id, COALESCE(new.tags, ''), COALESCE(new.tags_text, ''));
                END;
                """
            )

            await db.aexecutescript(
                """
                DELETE FROM asset_metadata_fts;
                INSERT INTO asset_metadata_fts(rowid, tags, tags_text)
                SELECT asset_id, COALESCE(tags, ''), COALESCE(tags_text, '')
                FROM asset_metadata;
                """
            )
        if not tx.ok:
            return Result.Err("DB_ERROR", tx.error or "Commit failed")
        return Result.Ok(True)
    except Exception as exc:
        logger.warning("Failed to repair asset_metadata_fts: %s", exc)
        return Result.Err("FTS_REPAIR_FAILED", str(exc))


def _schema_fingerprint() -> str:
    """
    Store a stable fingerprint of the schema DDL so we can detect "exotic" DBs.
    This is informational (self-heal is done via COLUMN_DEFINITIONS).
    """
    ddl = f"{SCHEMA_V1}\n{INDEXES_AND_TRIGGERS}"
    normalized = "\n".join(line.strip() for line in ddl.splitlines() if line.strip())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


async def _ensure_schema_fingerprint(db) -> Result[bool]:
    if not db.has_table("metadata"):
        return Result.Ok(True)

    try:
        fingerprint = _schema_fingerprint()
    except Exception as exc:
        logger.warning("Unable to compute schema fingerprint: %s", exc)
        return Result.Ok(True)

    existing = await db.aexecute(
        "SELECT value FROM metadata WHERE key = 'schema_ddl_hash'",
        fetch=True
    )
    if existing.ok and existing.data:
        try:
            current = (existing.data[0] or {}).get("value") or ""
        except Exception:
            current = ""
        if current and current != fingerprint:
            logger.warning(
                "Database schema fingerprint differs from expected (will self-heal columns anyway)"
            )

    return await db.aexecute(
        "INSERT OR REPLACE INTO metadata (key, value) VALUES ('schema_ddl_hash', ?)",
        (fingerprint,)
    )


async def _ensure_schema(db) -> Result[bool]:
    result = await ensure_tables_exist(db)
    if not result.ok:
        return result

    result = await ensure_columns_exist(db)
    if not result.ok:
        return result

    result = await ensure_indexes_and_triggers(db)
    if not result.ok:
        return result

    version_result = await db.aset_schema_version(CURRENT_SCHEMA_VERSION)
    if not version_result.ok:
        logger.error("Failed to set schema version: %s", version_result.error)
        return version_result

    fp_result = await _ensure_schema_fingerprint(db)
    if not fp_result.ok:
        logger.warning("Failed to store schema fingerprint: %s", fp_result.error)

    log_success(logger, f"Schema ensured (version {CURRENT_SCHEMA_VERSION})")
    return Result.Ok(True)


async def init_schema(db) -> Result[bool]:
    """
    Initialize the schema (useful for tests or first-time installs).
    """
    return await _ensure_schema(db)

async def migrate_schema(db) -> Result[bool]:
    """
    Repair schema to current version by ensuring expected tables, columns,
    indexes, and triggers exist.

    Args:
        db: Sqlite instance

    Returns:
        Result with success boolean
    """
    current_version = await db.aget_schema_version()
    logger.info("Ensuring schema (current version %s -> target %s)", current_version, CURRENT_SCHEMA_VERSION)

    repair_result = await _ensure_schema(db)
    if not repair_result.ok:
        return repair_result

    final_version = await db.aget_schema_version()

    if current_version == final_version:
        logger.info("Schema already reported up to date (%s)", final_version)
    else:
        log_success(logger, f"Schema repaired from version {current_version} to {final_version}")

    return Result.Ok(True)

async def rebuild_fts(db) -> Result[bool]:
    """
    Rebuild full-text search index.

    Args:
        db: Sqlite instance

    Returns:
        Result with success boolean
    """
    logger.info("Rebuilding FTS index...")

    result = await db.aexecute("INSERT INTO assets_fts(assets_fts) VALUES('rebuild')")
    if not result.ok:
        logger.error(f"Failed to rebuild assets_fts: {result.error}")
        return result

    repair_result = await _repair_asset_metadata_fts(db)
    if repair_result is not None and not repair_result.ok:
        logger.error(f"Failed to rebuild asset_metadata_fts: {repair_result.error}")
        return repair_result

    log_success(logger, "FTS index rebuilt")
    return Result.Ok(True)
