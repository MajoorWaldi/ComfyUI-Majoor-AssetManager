"""
SQLite-based asset index for fast search and metadata queries.

Provides:
- Thread-safe database access with WAL mode
- FTS5 full-text search (with fallback for systems without FTS5)
- Incremental indexing (only parse changed files)
- Background reindexing with progress tracking
"""

import os
import sqlite3
import json
import threading
import time
import hashlib
import atexit
from typing import Optional, Dict, List, Callable, Any
from pathlib import Path
from .config import OUTPUT_ROOT, INDEX_DIR, INDEX_DB
from .utils import (
    load_metadata,
    get_system_metadata,
    classify_ext,
    _get_mtime_safe,
    IMAGE_EXTS,
    VIDEO_EXTS,
)
from .logger import get_logger
from .workflow_hash import hash_workflow_robust

log = get_logger(__name__)

# Thread-local storage for DB connections (one per thread)
_thread_local = threading.local()

# Global index status
_index_status = {
    "status": "idle",  # idle|indexing|error
    "last_scan": None,
    "total_assets": 0,
    "indexed_assets": 0,
    "backlog": 0,
    "errors": [],
    "fts_available": False,
    "json1_available": False,
    "freshness": "unknown",  # up_to_date|stale|unknown
}
_status_lock = threading.Lock()

# Indexing worker state
_indexing_thread: Optional[threading.Thread] = None
_stop_indexing = threading.Event()
_JSON1_AVAILABLE: Optional[bool] = None


# ===== Database Initialization =====

def init_db(db_path: Optional[str] = None) -> None:
    """
    Initialize the SQLite database with schema and indexes.
    Creates the database file and tables if they don't exist.
    """
    if db_path is None:
        db_path = INDEX_DB

    # Ensure directory exists
    os.makedirs(os.path.dirname(db_path), exist_ok=True)

    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row

    try:
        _configure_db(conn)
        _create_schema(conn)
        _detect_fts5(conn)
        _detect_json1(conn)
        conn.commit()
        log.info(f"[Majoor] Index database initialized at {db_path}")
    except Exception as e:
        log.error(f"[Majoor] Failed to initialize database: {e}")
        raise
    finally:
        conn.close()


def _configure_db(conn: sqlite3.Connection) -> None:
    """Apply performance optimizations to the database."""
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA temp_store=MEMORY")
    conn.execute("PRAGMA cache_size=-64000")  # 64MB cache
    conn.execute("PRAGMA mmap_size=268435456")  # 256MB memory-mapped I/O
    conn.execute("PRAGMA foreign_keys=ON")


def _create_schema(conn: sqlite3.Connection) -> None:
    """Create database tables and indexes."""
    # Main assets table
    conn.execute("""
        CREATE TABLE IF NOT EXISTS assets (
            -- Identity (stable key)
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            subfolder TEXT,
            filename TEXT NOT NULL,
            ext TEXT,
            abs_path TEXT,

            -- File metadata
            mtime INTEGER,
            size INTEGER,
            kind TEXT,

            -- Media properties
            width INTEGER,
            height INTEGER,
            duration_ms INTEGER,

            -- User metadata
            rating REAL,
            tags_json TEXT,
            notes TEXT,

            -- Generation params
            prompt TEXT,
            negative TEXT,
            model TEXT,
            sampler TEXT,
            steps INTEGER,
            cfg REAL,
            seed TEXT,

            -- Workflow tracking
            has_workflow INTEGER DEFAULT 0,
            workflow_hash TEXT,

            -- Full metadata dump (fallback/archive)
            meta_json TEXT,

            -- Timestamps
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
    """)

    # Indexes for common queries
    conn.execute("CREATE INDEX IF NOT EXISTS idx_assets_mtime ON assets(mtime)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_assets_kind ON assets(kind)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_assets_rating ON assets(rating)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_assets_has_workflow ON assets(has_workflow)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_assets_workflow_hash ON assets(workflow_hash)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_assets_type_subfolder ON assets(type, subfolder)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_assets_filename ON assets(filename)")


def _detect_fts5(conn: sqlite3.Connection) -> None:
    """Detect FTS5 availability and create FTS table if available."""
    global _index_status

    # Check if FTS5 is compiled in
    cursor = conn.execute("PRAGMA compile_options")
    compile_options = [row[0] for row in cursor.fetchall()]
    fts5_available = any("FTS5" in opt for opt in compile_options)

    with _status_lock:
        _index_status["fts_available"] = fts5_available

    if not fts5_available:
        log.warning("[Majoor] FTS5 not available, instant search disabled")
        return

    def _fts_columns() -> List[str]:
        try:
            rows = conn.execute("PRAGMA table_info(assets_fts)").fetchall()
        except sqlite3.OperationalError:
            return []
        return [row[1] for row in rows]

    existing_cols = _fts_columns()
    needs_rebuild = bool(existing_cols) and "tags_text" not in existing_cols

    if needs_rebuild:
        log.warning("[Majoor] FTS schema outdated (missing tags_text); rebuilding index")
        conn.execute("DROP TRIGGER IF EXISTS assets_fts_insert")
        conn.execute("DROP TRIGGER IF EXISTS assets_fts_update")
        conn.execute("DROP TRIGGER IF EXISTS assets_fts_delete")
        conn.execute("DROP TABLE IF EXISTS assets_fts")
        existing_cols = []

    # Create FTS5 virtual table
    try:
        conn.execute("""
            CREATE VIRTUAL TABLE IF NOT EXISTS assets_fts USING fts5(
                id UNINDEXED,
                filename,
                subfolder,
                prompt,
                negative,
                tags_text,
                notes,
                model,
                sampler,
                content='assets',
                content_rowid='rowid'
            )
        """)

        # Create triggers to keep FTS in sync
        conn.execute("""
            CREATE TRIGGER IF NOT EXISTS assets_fts_insert AFTER INSERT ON assets BEGIN
                INSERT INTO assets_fts(rowid, id, filename, subfolder, prompt, negative, tags_text, notes, model, sampler)
                VALUES (new.rowid, new.id, new.filename, new.subfolder, new.prompt, new.negative,
                        replace(replace(new.tags_json, '["', ''), '"]', ''), new.notes, new.model, new.sampler);
            END
        """)

        conn.execute("""
            CREATE TRIGGER IF NOT EXISTS assets_fts_update AFTER UPDATE ON assets BEGIN
                UPDATE assets_fts SET
                    filename = new.filename,
                    subfolder = new.subfolder,
                    prompt = new.prompt,
                    negative = new.negative,
                    tags_text = replace(replace(new.tags_json, '["', ''), '"]', ''),
                    notes = new.notes,
                    model = new.model,
                    sampler = new.sampler
                WHERE rowid = new.rowid;
            END
        """)

        conn.execute("""
            CREATE TRIGGER IF NOT EXISTS assets_fts_delete AFTER DELETE ON assets BEGIN
                DELETE FROM assets_fts WHERE rowid = old.rowid;
            END
        """)

        if needs_rebuild or not existing_cols:
            try:
                conn.execute("""
                    INSERT INTO assets_fts(
                        rowid, id, filename, subfolder, prompt, negative, tags_text, notes, model, sampler
                    )
                    SELECT
                        rowid, id, filename, subfolder, prompt, negative,
                        replace(replace(tags_json, '["', ''), '"]', ''), notes, model, sampler
                    FROM assets
                """)
            except Exception as e:
                log.warning(f"[Majoor] Failed to seed FTS index: {e}")

        log.info("[Majoor] FTS5 search enabled")
    except Exception as e:
        log.warning(f"[Majoor] Failed to create FTS5 table: {e}")
        with _status_lock:
            _index_status["fts_available"] = False


def _detect_json1(conn: sqlite3.Connection) -> None:
    """Detect JSON1 availability for efficient tag filtering."""
    global _JSON1_AVAILABLE
    try:
        conn.execute("SELECT json('[]')")
        _JSON1_AVAILABLE = True
    except Exception:
        _JSON1_AVAILABLE = False
    with _status_lock:
        _index_status["json1_available"] = bool(_JSON1_AVAILABLE)


def get_db() -> sqlite3.Connection:
    """
    Get a thread-safe database connection.
    Each thread gets its own connection from thread-local storage.
    """
    if not hasattr(_thread_local, "connection"):
        _thread_local.connection = sqlite3.connect(
            INDEX_DB,
            check_same_thread=False,
            timeout=30.0  # 30 second timeout to prevent deadlocks
        )
        _thread_local.connection.row_factory = sqlite3.Row
        _configure_db(_thread_local.connection)

    return _thread_local.connection


def _cleanup_connections():
    """Close all thread-local connections on exit."""
    if hasattr(_thread_local, "connection"):
        try:
            _thread_local.connection.close()
            log.debug("[Majoor] Database connection closed")
        except Exception as e:
            log.debug(f"[Majoor] Error closing connection: {e}")


# Register cleanup handler
atexit.register(_cleanup_connections)


# ===== Asset ID Generation =====

def _make_asset_id(type_name: str, subfolder: str, filename: str) -> str:
    """
    Generate stable asset ID from type|subfolder|filename.
    Normalized to handle path separators consistently.
    """
    subfolder_norm = (subfolder or "").replace("\\", "/").strip("/")
    return f"{type_name}|{subfolder_norm}|{filename}"


def _parse_asset_id(asset_id: str) -> Dict[str, str]:
    """Parse asset ID back into components."""
    parts = asset_id.split("|", 2)
    if len(parts) != 3:
        return {"type": "output", "subfolder": "", "filename": asset_id}
    return {"type": parts[0], "subfolder": parts[1], "filename": parts[2]}


# ===== CRUD Operations =====

def upsert_asset(record: Dict[str, Any]) -> None:
    """
    Insert or update an asset record.
    Record should contain at minimum: id, filename, type, mtime, size
    """
    conn = get_db()

    # Ensure tags_json is properly serialized
    if "tags" in record and "tags_json" not in record:
        record["tags_json"] = json.dumps(record["tags"], ensure_ascii=False)
    # Remove non-schema keys to avoid insert errors
    if "tags" in record:
        record.pop("tags", None)

    # Build SQL dynamically based on provided fields
    fields = list(record.keys())
    placeholders = ", ".join(["?"] * len(fields))
    update_clause = ", ".join([f"{f} = excluded.{f}" for f in fields if f != "id"])

    sql = f"""
        INSERT INTO assets ({", ".join(fields)})
        VALUES ({placeholders})
        ON CONFLICT(id) DO UPDATE SET
            {update_clause},
            updated_at = strftime('%s', 'now')
    """

    try:
        conn.execute(sql, [record[f] for f in fields])
        conn.commit()
    except Exception as e:
        log.error(f"[Majoor] Failed to upsert asset {record.get('id')}: {e}")
        conn.rollback()
        raise


def delete_asset(asset_id: str) -> None:
    """Delete an asset from the index."""
    conn = get_db()
    try:
        conn.execute("DELETE FROM assets WHERE id = ?", (asset_id,))
        conn.commit()
    except Exception as e:
        log.error(f"[Majoor] Failed to delete asset {asset_id}: {e}")
        conn.rollback()
        raise


def get_asset(asset_id: str) -> Optional[Dict[str, Any]]:
    """Get a single asset by ID."""
    conn = get_db()
    cursor = conn.execute("SELECT * FROM assets WHERE id = ?", (asset_id,))
    row = cursor.fetchone()
    if row is None:
        return None
    return dict(row)


# ===== Query Operations =====

def query_assets(
    filters: Optional[Dict[str, Any]] = None,
    q: Optional[str] = None,
    sort: str = "mtime_desc",
    limit: int = 100,
    offset: int = 0
) -> Dict[str, Any]:
    """
    Query assets with filters and full-text search.

    Args:
        filters: Dict with keys: kind, tags, rating_min, has_workflow, workflow_hash, type, subfolder
        q: Full-text search query (requires FTS5)
        sort: Sort order (mtime_desc, mtime_asc, rating_desc, rating_asc, filename_asc)
        limit: Max results to return
        offset: Pagination offset

    Returns:
        Dict with keys: assets (list), total (int), limit, offset
    """
    conn = get_db()
    filters = filters or {}

    # Build WHERE clause
    where_clauses = []
    params = []

    # FTS search (if available and query provided)
    use_fts = q and _index_status.get("fts_available", False)

    if use_fts:
        # Join with FTS table for full-text search
        base_query = """
            SELECT assets.*, rank
            FROM assets
            JOIN assets_fts ON assets.rowid = assets_fts.rowid
            WHERE assets_fts MATCH ?
        """
        count_query = """
            SELECT COUNT(*)
            FROM assets
            JOIN assets_fts ON assets.rowid = assets_fts.rowid
            WHERE assets_fts MATCH ?
        """
        params.append(q)
    else:
        base_query = "SELECT * FROM assets WHERE 1=1"
        count_query = "SELECT COUNT(*) FROM assets WHERE 1=1"

        # Fallback simple search on filename
        if q:
            where_clauses.append("(filename LIKE ? OR prompt LIKE ?)")
            params.extend([f"%{q}%", f"%{q}%"])

    # Apply filters
    if filters.get("kind"):
        kind_filter = filters["kind"]
        if isinstance(kind_filter, (list, tuple, set)):
            kinds = [k for k in kind_filter if k]
            if kinds:
                placeholders = ", ".join(["?"] * len(kinds))
                where_clauses.append(f"kind IN ({placeholders})")
                params.extend(kinds)
        else:
            where_clauses.append("kind = ?")
            params.append(kind_filter)

    if filters.get("type"):
        where_clauses.append("type = ?")
        params.append(filters["type"])

    if filters.get("subfolder") is not None:
        where_clauses.append("subfolder = ?")
        params.append(filters["subfolder"])

    if filters.get("rating_min") is not None:
        where_clauses.append("rating >= ?")
        params.append(float(filters["rating_min"]))

    if filters.get("has_workflow") == 1:
        where_clauses.append("has_workflow = 1")
    elif filters.get("has_workflow") == 0:
        where_clauses.append("has_workflow = 0")

    if filters.get("workflow_hash"):
        where_clauses.append("workflow_hash = ?")
        params.append(filters["workflow_hash"])

    # Tags filter (AND logic for multiple tags)
    if filters.get("tags"):
        tag_list = filters["tags"] if isinstance(filters["tags"], list) else filters["tags"].split(",")
        for tag in tag_list:
            tag = tag.strip()
            if not tag:
                continue
            if _JSON1_AVAILABLE:
                where_clauses.append(
                    "EXISTS (SELECT 1 FROM json_each(assets.tags_json) WHERE value = ?)"
                )
                params.append(tag)
            else:
                where_clauses.append("tags_json LIKE ?")
                params.append(f'%"{tag}"%')

    # Add WHERE clauses
    if where_clauses:
        clause = " AND " + " AND ".join(where_clauses)
        base_query += clause
        count_query += clause

    # Sort order
    sort_map = {
        "mtime_desc": "mtime DESC",
        "mtime_asc": "mtime ASC",
        "rating_desc": "rating DESC, mtime DESC",
        "rating_asc": "rating ASC, mtime DESC",
        "filename_asc": "filename ASC",
        "filename_desc": "filename DESC",
    }
    order_by = sort_map.get(sort, "mtime DESC")

    if use_fts:
        # For FTS, use BM25 ranking
        order_by = "rank, " + order_by

    base_query += f" ORDER BY {order_by}"

    # Count total (without limit)
    try:
        cursor = conn.execute(count_query, params)
        total = cursor.fetchone()[0]
    except Exception as e:
        log.error(f"[Majoor] Failed to count assets: {e}")
        total = 0

    # Paginate
    base_query += " LIMIT ? OFFSET ?"
    params.extend([limit, offset])

    try:
        cursor = conn.execute(base_query, params)
        rows = cursor.fetchall()
        assets = [_row_to_asset(row) for row in rows]
    except Exception as e:
        log.error(f"[Majoor] Failed to query assets: {e}")
        assets = []

    return {
        "assets": assets,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


def _row_to_asset(row: sqlite3.Row) -> Dict[str, Any]:
    """Convert database row to asset dict."""
    asset = dict(row)

    # Parse tags_json back to list
    if asset.get("tags_json"):
        try:
            asset["tags"] = json.loads(asset["tags_json"])
        except:
            asset["tags"] = []
    else:
        asset["tags"] = []

    # Remove internal fields from API response
    asset.pop("tags_json", None)
    asset.pop("meta_json", None)

    return asset


# ===== Indexing Operations =====

def _should_reindex(file_path: str, db_record: Optional[Dict[str, Any]]) -> bool:
    """
    Check if file changed since last index.
    Returns True if file should be reindexed.
    """
    if db_record is None:
        return True  # New file

    stat = os.stat(file_path)
    mtime_ms = int(stat.st_mtime * 1000)
    size = stat.st_size

    # Compare mtime and size
    if mtime_ms != db_record.get("mtime"):
        return True
    if size != db_record.get("size"):
        return True

    return False  # Skip, unchanged


def _extract_asset_metadata(file_path: str, type_name: str, subfolder: str, filename: str) -> Dict[str, Any]:
    """
    Extract metadata from a file for indexing.
    Reuses existing metadata loaders (Windows/sidecar/exiftool).
    """
    stat = os.stat(file_path)
    ext = os.path.splitext(filename)[1].lower()
    kind = classify_ext(filename.lower())

    # Base record
    record = {
        "id": _make_asset_id(type_name, subfolder, filename),
        "type": type_name,
        "subfolder": subfolder or "",
        "filename": filename,
        "ext": ext,
        "abs_path": file_path,
        "mtime": int(stat.st_mtime * 1000),
        "size": stat.st_size,
        "kind": kind,
    }

    # Load metadata (system metadata + sidecar)
    try:
        sys_meta = get_system_metadata(file_path) or {}
        sidecar_meta = load_metadata(file_path) or {}

        # Merge metadata (prioritize system metadata for rating/tags)
        record["rating"] = sys_meta.get("rating", sidecar_meta.get("rating", 0))
        record["tags"] = sys_meta.get("tags", sidecar_meta.get("tags", []))

        # Sidecar-only fields
        record["notes"] = sidecar_meta.get("notes", "")
        record["prompt"] = sidecar_meta.get("prompt", {}).get("text", "")
        record["negative"] = sidecar_meta.get("prompt", {}).get("negative", "")

        # Generation params (from ComfyUI workflow/prompt)
        workflow = sidecar_meta.get("workflow")
        if workflow:
            record["has_workflow"] = 1
            # Calculate workflow hash
            record["workflow_hash"] = hash_workflow_robust(workflow)
        else:
            record["has_workflow"] = 0
            record["workflow_hash"] = None

        # Extract common generation params from prompt
        prompt_data = sidecar_meta.get("prompt", {})
        if isinstance(prompt_data, dict):
            # Try to extract from common node types
            for node_data in prompt_data.values():
                if isinstance(node_data, dict):
                    inputs = node_data.get("inputs", {})
                    if "ckpt_name" in inputs:
                        record["model"] = inputs["ckpt_name"]
                    if "sampler_name" in inputs:
                        record["sampler"] = inputs["sampler_name"]
                    if "steps" in inputs:
                        record["steps"] = inputs["steps"]
                    if "cfg" in inputs:
                        record["cfg"] = inputs["cfg"]
                    if "seed" in inputs:
                        record["seed"] = str(inputs["seed"])

        # Media properties (basic extraction, can be extended with PIL/ffmpeg)
        if kind == "image" and ext in IMAGE_EXTS:
            try:
                from PIL import Image
                with Image.open(file_path) as img:
                    record["width"], record["height"] = img.size
            except:
                pass

        # Store full metadata as JSON (optional, for debugging)
        record["meta_json"] = json.dumps({**sys_meta, **sidecar_meta}, ensure_ascii=False)

    except Exception as e:
        log.warning(f"[Majoor] Failed to extract metadata for {file_path}: {e}")

    return record


def reindex_paths(paths: List[str], progress_cb: Optional[Callable[[int, int], None]] = None) -> Dict[str, Any]:
    """
    Reindex specific file paths.

    Args:
        paths: List of absolute file paths to reindex
        progress_cb: Optional callback(current, total) for progress updates

    Returns:
        Dict with keys: indexed (int), skipped (int), errors (list)
    """
    indexed = 0
    skipped = 0
    errors = []

    total = len(paths)

    for i, file_path in enumerate(paths):
        try:
            # Determine type/subfolder from path
            if not os.path.exists(file_path):
                errors.append(f"File not found: {file_path}")
                continue

            # Guess type from path (assumes files are in OUTPUT_ROOT)
            rel_path = os.path.relpath(file_path, OUTPUT_ROOT)
            parts = Path(rel_path).parts

            if len(parts) == 1:
                type_name = "output"
                subfolder = ""
                filename = parts[0]
            else:
                type_name = parts[0] if parts[0] in ("output", "input", "temp") else "output"
                subfolder = os.path.join(*parts[1:-1]) if len(parts) > 2 else parts[1] if len(parts) == 2 else ""
                filename = parts[-1]

            asset_id = _make_asset_id(type_name, subfolder, filename)

            # Check if reindex needed
            db_record = get_asset(asset_id)
            if not _should_reindex(file_path, db_record):
                skipped += 1
                if progress_cb:
                    progress_cb(i + 1, total)
                continue

            # Extract metadata and upsert
            record = _extract_asset_metadata(file_path, type_name, subfolder, filename)
            upsert_asset(record)
            indexed += 1

        except Exception as e:
            log.error(f"[Majoor] Failed to index {file_path}: {e}")
            errors.append(f"{file_path}: {e}")

        if progress_cb:
            progress_cb(i + 1, total)

    return {
        "indexed": indexed,
        "skipped": skipped,
        "errors": errors,
    }


def reindex_all(progress_cb: Optional[Callable[[int, int], None]] = None) -> Dict[str, Any]:
    """
    Reindex all assets in OUTPUT_ROOT.
    Scans filesystem and updates index incrementally.

    Args:
        progress_cb: Optional callback(current, total) for progress updates

    Returns:
        Dict with keys: indexed (int), skipped (int), deleted (int), errors (list)
    """
    global _index_status

    with _status_lock:
        _index_status["status"] = "indexing"
        _index_status["backlog"] = 0
        _index_status["errors"] = []

    indexed = 0
    skipped = 0
    deleted = 0
    errors = []

    try:
        # Scan filesystem
        file_paths = []
        for root, dirs, files in os.walk(OUTPUT_ROOT):
            # Skip index directory
            if "_mjr_index" in root:
                continue

            for filename in files:
                # Skip metadata sidecar files
                if filename.endswith(".mjr.json"):
                    continue

                # Skip hidden files
                if filename.startswith("."):
                    continue

                file_path = os.path.join(root, filename)
                file_paths.append(file_path)

        total = len(file_paths)

        with _status_lock:
            _index_status["backlog"] = total

        # Build set of existing asset IDs in DB
        conn = get_db()
        cursor = conn.execute("SELECT id, abs_path FROM assets")
        db_assets = {row["id"]: row["abs_path"] for row in cursor.fetchall()}

        # Track seen IDs to detect deleted files
        seen_ids = set()

        # Index each file
        for i, file_path in enumerate(file_paths):
            if _stop_indexing.is_set():
                log.info("[Majoor] Indexing stopped by user")
                break

            try:
                # Determine type/subfolder from path
                rel_path = os.path.relpath(file_path, OUTPUT_ROOT)
                parts = Path(rel_path).parts

                if len(parts) == 1:
                    type_name = "output"
                    subfolder = ""
                    filename = parts[0]
                else:
                    type_name = parts[0] if parts[0] in ("output", "input", "temp") else "output"
                    subfolder = os.path.join(*parts[1:-1]) if len(parts) > 2 else ""
                    filename = parts[-1]

                asset_id = _make_asset_id(type_name, subfolder, filename)
                seen_ids.add(asset_id)

                # Check if reindex needed
                db_record = get_asset(asset_id)
                if not _should_reindex(file_path, db_record):
                    skipped += 1
                else:
                    # Extract metadata and upsert
                    record = _extract_asset_metadata(file_path, type_name, subfolder, filename)
                    upsert_asset(record)
                    indexed += 1

            except Exception as e:
                log.error(f"[Majoor] Failed to index {file_path}: {e}")
                errors.append(f"{file_path}: {e}")

            if progress_cb:
                progress_cb(i + 1, total)

            with _status_lock:
                _index_status["backlog"] = total - (i + 1)

        # Delete assets that no longer exist on filesystem
        for asset_id, abs_path in db_assets.items():
            if asset_id not in seen_ids:
                delete_asset(asset_id)
                deleted += 1

        with _status_lock:
            _index_status["status"] = "idle"
            _index_status["last_scan"] = time.time()
            _index_status["backlog"] = 0
            _index_status["errors"] = errors
            _index_status["freshness"] = "up_to_date"

            # Update counts
            cursor = conn.execute("SELECT COUNT(*) FROM assets")
            _index_status["total_assets"] = cursor.fetchone()[0]
            _index_status["indexed_assets"] = _index_status["total_assets"]

    except Exception as e:
        log.error(f"[Majoor] Reindex failed: {e}")
        with _status_lock:
            _index_status["status"] = "error"
            _index_status["errors"].append(str(e))

    return {
        "indexed": indexed,
        "skipped": skipped,
        "deleted": deleted,
        "errors": errors,
    }


def start_background_reindex() -> None:
    """Start reindexing in a background thread."""
    global _indexing_thread

    if _indexing_thread and _indexing_thread.is_alive():
        log.warning("[Majoor] Indexing already in progress")
        return

    _stop_indexing.clear()

    def worker():
        try:
            reindex_all()
        except Exception as e:
            log.error(f"[Majoor] Background reindex failed: {e}")

    _indexing_thread = threading.Thread(target=worker, daemon=True)
    _indexing_thread.start()


def stop_background_reindex() -> None:
    """Stop the background reindexing."""
    _stop_indexing.set()


# ===== Status Operations =====

def get_index_status() -> Dict[str, Any]:
    """Get current index status."""
    with _status_lock:
        status = dict(_index_status)

    # Format last_scan as ISO timestamp
    if status["last_scan"]:
        from datetime import datetime
        status["last_scan"] = datetime.fromtimestamp(status["last_scan"]).isoformat()

    return status


def check_freshness() -> str:
    """
    Check if index is fresh by comparing file count on disk vs DB.
    Returns: "up_to_date", "stale", or "unknown"
    """
    try:
        # Quick filesystem count
        file_count = 0
        for root, dirs, files in os.walk(OUTPUT_ROOT):
            if "_mjr_index" in root:
                continue
            file_count += sum(1 for f in files if not f.endswith(".mjr.json") and not f.startswith("."))

        # DB count
        conn = get_db()
        cursor = conn.execute("SELECT COUNT(*) FROM assets")
        db_count = cursor.fetchone()[0]

        # Allow 5% difference for tolerance
        diff = abs(file_count - db_count)
        if diff == 0:
            return "up_to_date"
        elif diff / max(file_count, 1) < 0.05:
            return "up_to_date"
        else:
            return "stale"

    except Exception as e:
        log.error(f"[Majoor] Failed to check freshness: {e}")
        return "unknown"


# ===== Initialization =====

def auto_init_index() -> None:
    """
    Auto-initialize index after ComfyUI is ready.
    Creates DB if it doesn't exist, checks freshness, and triggers reindex if needed.

    IMPORTANT: Must be called AFTER ComfyUI server is fully initialized.
    Do NOT call on module import (race condition with OUTPUT_ROOT).
    """
    try:
        # Ensure index directory exists
        os.makedirs(INDEX_DIR, exist_ok=True)

        if not os.path.exists(INDEX_DB):
            log.info("[Majoor] Creating index database for the first time")
            init_db()
            # First-time index in background
            start_background_reindex()
        else:
            # Database exists, just ensure schema is up to date
            init_db()

            # Check freshness
            freshness = check_freshness()
            with _status_lock:
                _index_status["freshness"] = freshness

            # Auto-reindex if stale or last scan > 1 hour ago
            status = get_index_status()
            should_reindex = False

            if freshness == "stale":
                should_reindex = True
                log.info("[Majoor] Index is stale, triggering auto-reindex")

            if status.get("last_scan"):
                from datetime import datetime
                last_scan = datetime.fromisoformat(status["last_scan"])
                age_seconds = (datetime.now() - last_scan).total_seconds()
                if age_seconds > 3600:  # 1 hour
                    should_reindex = True
                    log.info("[Majoor] Index is >1 hour old, triggering auto-reindex")

            if should_reindex:
                start_background_reindex()

    except Exception as e:
        log.error(f"[Majoor] Failed to auto-initialize index: {e}")


# Note: auto_init_index() should be called from __init__.py or routes.py after server starts
# Commenting out auto-init on import to avoid race condition
# auto_init_index()
