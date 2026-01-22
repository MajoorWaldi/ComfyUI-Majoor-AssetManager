"""
SQLite database connection manager.

Implementation note (Option A migration):
- This adapter uses `aiosqlite` internally.
- The public API remains synchronous for compatibility with the existing codebase.

Why this shape:
- Most of the backend logic (scanner/searcher/updater/schema) is synchronous today.
- aiohttp handlers already offload DB-heavy work via `asyncio.to_thread(...)` (Option B).
- This migration replaces the blocking `sqlite3` usage with `aiosqlite` without forcing a full
  async refactor of the whole backend at once.

Critical guarantee:
- The adapter never raises to callers; it returns `Result(...)`.
"""

from __future__ import annotations

import asyncio
import contextvars
import random
import re
import threading
import time
import uuid
from contextlib import contextmanager, asynccontextmanager
from pathlib import Path
from queue import Empty, Queue
from typing import Any, Dict, List, Optional, Tuple

import aiosqlite
import sqlite3

from ...config import DB_MAX_CONNECTIONS, DB_QUERY_TIMEOUT
from ...shared import ErrorCode, Result, get_logger

logger = get_logger(__name__)

_TX_TOKEN: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar("mjr_db_tx_token", default=None)
_COLUMN_NAME_PATTERN = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)?$")
_KNOWN_COLUMNS = {
    # assets
    "id",
    "filename",
    "subfolder",
    "filepath",
    "source",
    "root_id",
    "kind",
    "ext",
    "size",
    "mtime",
    "width",
    "height",
    "duration",
    "created_at",
    "updated_at",
    "indexed_at",
    # asset_metadata
    "asset_id",
    "rating",
    "tags",
    "tags_text",
    "workflow_hash",
    "has_workflow",
    "has_generation_data",
    "metadata_quality",
    "metadata_raw",
    # scan_journal
    "dir_path",
    "state_hash",
    "last_seen",
    # metadata_cache
    "metadata_hash",
    # common aliases
    "a.id",
    "a.filepath",
    "a.filename",
    "a.subfolder",
    "a.kind",
    "a.mtime",
    "a.source",
    "a.root_id",
    "m.asset_id",
    "m.rating",
    "m.tags",
    "m.tags_text",
    "m.metadata_raw",
    "m.has_workflow",
    "m.has_generation_data",
}
_KNOWN_COLUMNS_LOWER = {c.lower(): c for c in _KNOWN_COLUMNS}

_IN_QUERY_FORBIDDEN = re.compile(
    r"(--|/\*|\*/|;|\bpragma\b|\battach\b|\bdetach\b|\bvacuum\b|\balter\b|\bdrop\b|\binsert\b|\bupdate\b|\bdelete\b)",
    re.IGNORECASE,
)


def _validate_in_base_query(base_query: str) -> Tuple[bool, str]:
    """
    Validate the `base_query` template used by `query_in`.

    Threat model: even though `base_query` is expected to be a constant defined in code,
    enforcing a conservative allowlist prevents accidental misuse that could reintroduce
    SQL injection.
    """
    try:
        q = str(base_query or "").strip()
    except Exception:
        return False, "base_query must be a string"

    if not q:
        return False, "base_query is empty"

    if q.count("{IN_CLAUSE}") != 1:
        return False, "base_query must contain exactly one {IN_CLAUSE}"

    # Only allow SELECT (optionally with WITH) templates.
    q_lower = q.lower().lstrip()
    if not (q_lower.startswith("select ") or q_lower.startswith("with ")):
        return False, "base_query must be a SELECT query"

    # Reject obvious multi-statement or dangerous SQL constructs.
    if _IN_QUERY_FORBIDDEN.search(q):
        return False, "base_query contains forbidden SQL tokens"

    return True, ""


def _try_repair_column_name(column: str) -> Optional[str]:
    if not column or not isinstance(column, str):
        return None

    normalized = column.strip()
    if not normalized:
        return None

    # Case-insensitive match against known columns/aliases.
    hit = _KNOWN_COLUMNS_LOWER.get(normalized.lower())
    if hit:
        return hit

    # Strip all characters except [a-zA-Z0-9_.] and try again (still must match known list).
    cleaned = re.sub(r"[^a-zA-Z0-9_.]", "", normalized)
    if not cleaned:
        return None
    if cleaned.lower() in _KNOWN_COLUMNS_LOWER:
        return _KNOWN_COLUMNS_LOWER[cleaned.lower()]
    return None


def _validate_and_repair_column_name(column: str) -> Tuple[bool, Optional[str]]:
    """
    Validate a SQL column identifier (optionally with table alias), and best-effort
    repair common user/legacy mistakes without weakening injection protections.

    Returns:
        (is_valid, safe_column_or_none)
    """
    if not column or not isinstance(column, str):
        return False, None

    stripped = column.strip()
    if not stripped:
        return False, None

    # Fast path: already valid after trimming.
    if _COLUMN_NAME_PATTERN.match(stripped):
        return True, stripped

    repaired = _try_repair_column_name(stripped)
    if repaired and _COLUMN_NAME_PATTERN.match(repaired):
        return True, repaired

    return False, None


class _AsyncLoopThread:
    def __init__(self):
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._thread: Optional[threading.Thread] = None
        self._ready = threading.Event()

    def start(self) -> asyncio.AbstractEventLoop:
        if self._loop and self._thread and self._thread.is_alive():
            return self._loop

        self._ready.clear()

        def _run():
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            self._loop = loop
            self._ready.set()
            try:
                loop.run_forever()
            finally:
                try:
                    pending = asyncio.all_tasks(loop)
                    for task in pending:
                        task.cancel()
                    if pending:
                        loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
                except Exception:
                    pass
                try:
                    loop.close()
                except Exception:
                    pass

        self._thread = threading.Thread(target=_run, daemon=True)
        self._thread.start()
        self._ready.wait(timeout=10.0)
        if not self._loop:
            raise RuntimeError("Failed to start DB async loop thread")
        return self._loop

    def run(self, coro):
        loop = self.start()
        fut = asyncio.run_coroutine_threadsafe(coro, loop)
        return fut.result()

    def submit(self, coro):
        loop = self.start()
        return asyncio.run_coroutine_threadsafe(coro, loop)

    def stop(self):
        loop = self._loop
        if not loop:
            return
        try:
            loop.call_soon_threadsafe(loop.stop)
        except Exception:
            pass


class Sqlite:
    """
    Connection pool manager for SQLite (aiosqlite-backed).

    Synchronous API, async execution on a dedicated loop thread.
    """

    def __init__(self, db_path: str, max_connections: Optional[int] = None, timeout: float = 30.0):
        self.db_path = Path(db_path)
        max_conn = int(max_connections) if max_connections is not None else int(DB_MAX_CONNECTIONS or 8)
        max_conn = max(1, max_conn)
        self._pool: "Queue[aiosqlite.Connection]" = Queue(maxsize=max_conn)
        self._initialized = False
        self._lock = threading.Lock()
        self._sem = threading.BoundedSemaphore(max_conn)
        self._timeout = float(timeout)
        self._query_timeout = float(DB_QUERY_TIMEOUT) if DB_QUERY_TIMEOUT is not None else 0.0
        self._lock_retry_attempts = 6
        self._lock_retry_base_seconds = 0.05
        self._lock_retry_max_seconds = 0.75

        # Transaction connections live on the loop thread; keyed by token.
        self._tx_conns: Dict[str, aiosqlite.Connection] = {}

        self._loop_thread = _AsyncLoopThread()
        self._write_lock: Optional[asyncio.Lock] = None
        self._tx_write_lock_tokens: set[str] = set()
        # Thread-local storage for sync transactions (caller thread).
        self._tx_local = threading.local()

        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _is_locked_error(self, exc: Exception) -> bool:
        try:
            msg = str(exc).lower()
        except Exception:
            return False
        return (
            "database is locked" in msg
            or "database table is locked" in msg
            or "database schema is locked" in msg
            or "busy" in msg
            or "locked" in msg
        )

    def _sleep_backoff(self, attempt: int):
        base = float(self._lock_retry_base_seconds)
        max_s = float(self._lock_retry_max_seconds)
        delay = min(max_s, base * (2 ** max(0, attempt)))
        delay = delay + (random.random() * 0.03)
        time.sleep(delay)

    async def _apply_connection_pragmas(self, conn: aiosqlite.Connection):
        await conn.execute("PRAGMA journal_mode=WAL")
        await conn.execute("PRAGMA synchronous=NORMAL")
        await conn.execute("PRAGMA cache_size=-64000")
        await conn.execute("PRAGMA temp_store=MEMORY")
        await conn.execute("PRAGMA busy_timeout = 5000")
        await conn.execute("PRAGMA foreign_keys=ON")

    async def _create_connection(self) -> aiosqlite.Connection:
        # Use autocommit mode; we manage transactions explicitly (BEGIN/COMMIT) when needed.
        conn = await aiosqlite.connect(str(self.db_path), timeout=self._timeout, isolation_level=None)
        conn.row_factory = sqlite3.Row
        await self._apply_connection_pragmas(conn)
        return conn

    async def _acquire_connection_async(self) -> aiosqlite.Connection:
        # Semaphore is sync; acquire here is safe since we're on the loop thread.
        self._sem.acquire()
        try:
            try:
                conn = self._pool.get_nowait()
            except Empty:
                conn = await self._create_connection()
            return conn
        except Exception:
            self._sem.release()
            raise

    async def _release_connection_async(self, conn: aiosqlite.Connection):
        try:
            if not conn:
                return
            if not self._pool.full():
                self._pool.put(conn)
            else:
                try:
                    await conn.close()
                except Exception:
                    pass
        finally:
            self._sem.release()

    async def _ensure_initialized_async(self):
        if self._initialized:
            return
        # Only one caller initializes; lock is sync, but init runs once and quickly.
        with self._lock:
            if self._initialized:
                return
            # mark initialized *after* successful probe
        conn = await self._acquire_connection_async()
        try:
            await self._apply_connection_pragmas(conn)
            await conn.commit()
        finally:
            await self._release_connection_async(conn)
        with self._lock:
            self._initialized = True
        if self._write_lock is None:
            self._write_lock = asyncio.Lock()
        logger.info("Database initialized: %s", self.db_path)

    def _init_db(self):
        try:
            self._loop_thread.run(self._ensure_initialized_async())
        except Exception as exc:
            logger.error("Failed to initialize database: %s", exc)
            raise

    def _tx_token(self) -> Optional[str]:
        # Sync callers (rare) may still use thread-local token set by transaction().
        return getattr(self._tx_local, "token", None) if hasattr(self, "_tx_local") else None

    @staticmethod
    def _rows_to_dicts(rows: Any) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        for r in rows or []:
            try:
                out.append(dict(r))
            except Exception:
                # best-effort; should not happen with sqlite3.Row
                pass
        return out

    async def _execute_async(
        self,
        query: str,
        params: Optional[tuple],
        fetch: bool,
        *,
        tx_token: Optional[str] = None,
    ) -> Result[Any]:
        await self._ensure_initialized_async()

        token = tx_token or self._tx_token()
        if token:
            conn = self._tx_conns.get(token)
            if not conn:
                return Result.Err(ErrorCode.DB_ERROR, "Transaction connection missing")
            return await self._execute_on_conn_async(conn, query, params, fetch, commit=False, tx_token=token)

        conn = await self._acquire_connection_async()
        try:
            res = await self._execute_on_conn_async(conn, query, params, fetch, commit=True, tx_token=None)
            return res
        finally:
            await self._release_connection_async(conn)

    @staticmethod
    def _is_write_sql(query: str) -> bool:
        q = str(query or "").lstrip()
        if not q:
            return False
        head = q.split(None, 1)[0].upper()
        # Treat CTEs as reads by default (they can still write, but rare in our codebase).
        if head in ("SELECT", "PRAGMA", "WITH", "EXPLAIN"):
            return False
        return True

    async def _execute_on_conn_async(
        self,
        conn: aiosqlite.Connection,
        query: str,
        params: Optional[tuple],
        fetch: bool,
        *,
        commit: bool,
        tx_token: Optional[str] = None,
    ) -> Result[Any]:
        try:
            lock = self._write_lock
            is_write = self._is_write_sql(query)
            if is_write and lock is not None:
                # BEGIN acquires the write lock already; avoid deadlocking by reacquiring it
                # for statements executed within the same transaction.
                if tx_token and tx_token in self._tx_write_lock_tokens:
                    return await self._execute_on_conn_locked_async(conn, query, params, fetch, commit=commit)
                async with lock:
                    return await self._execute_on_conn_locked_async(conn, query, params, fetch, commit=commit)
            return await self._execute_on_conn_locked_async(conn, query, params, fetch, commit=commit)
        except sqlite3.IntegrityError as exc:
            logger.warning("Integrity error: %s", exc)
            return Result.Err(ErrorCode.DB_ERROR, f"Integrity error: {exc}")
        except sqlite3.OperationalError as exc:
            if "interrupted" in str(exc).lower():
                return Result.Err(ErrorCode.TIMEOUT, "Database operation interrupted (query timeout)")
            logger.error("Operational error: %s", exc)
            return Result.Err(ErrorCode.DB_ERROR, f"Operational error: {exc}")
        except Exception as exc:
            logger.error("Unexpected database error: %s", exc)
            return Result.Err(ErrorCode.DB_ERROR, str(exc))

    async def _execute_on_conn_locked_async(
        self,
        conn: aiosqlite.Connection,
        query: str,
        params: Optional[tuple],
        fetch: bool,
        *,
        commit: bool,
    ) -> Result[Any]:
        try:
            for attempt in range(self._lock_retry_attempts + 1):
                try:
                    cursor = await conn.execute(query, params or ())
                    try:
                        if fetch:
                            rows = await cursor.fetchall()
                            return Result.Ok(self._rows_to_dicts(rows))
                        if commit:
                            await conn.commit()
                        # aiosqlite cursor has lastrowid/rowcount, but may be None.
                        last_id = getattr(cursor, "lastrowid", None)
                        rowcount = getattr(cursor, "rowcount", None)
                        if last_id:
                            return Result.Ok(last_id)
                        return Result.Ok(rowcount if rowcount is not None else 0)
                    finally:
                        try:
                            await cursor.close()
                        except Exception:
                            pass
                except sqlite3.OperationalError as exc:
                    if self._is_locked_error(exc) and attempt < self._lock_retry_attempts:
                        self._sleep_backoff(attempt)
                        continue
                    raise
        except Exception:
            raise

    def execute(self, query: str, params: Optional[tuple] = None, fetch: bool = False) -> Result[Any]:
        try:
            # Sync callers may be inside `transaction()` (token lives on the caller thread).
            # Pass it explicitly because DB work runs on the loop thread.
            token = self._tx_token()
            return self._loop_thread.run(self._execute_async(query, params, fetch, tx_token=token))
        except Exception as exc:
            return Result.Err(ErrorCode.DB_ERROR, str(exc))

    def query(self, sql: str, params: Optional[tuple] = None) -> Result[List[Dict[str, Any]]]:
        return self.execute(sql, params, fetch=True)

    async def aexecute(self, query: str, params: Optional[tuple] = None, fetch: bool = False) -> Result[Any]:
        token = _TX_TOKEN.get()
        fut = self._loop_thread.submit(self._execute_async(query, params, fetch, tx_token=token))
        return await asyncio.wrap_future(fut)

    async def aquery(self, sql: str, params: Optional[tuple] = None) -> Result[List[Dict[str, Any]]]:
        return await self.aexecute(sql, params, fetch=True)

    def query_in(
        self,
        base_query: str,
        column: str,
        values: List[Any],
        additional_params: Optional[tuple] = None,
    ) -> Result[List[Dict[str, Any]]]:
        """
        Execute a query with an IN clause safely.

        `base_query` must contain the `{IN_CLAUSE}` placeholder, which will be replaced
        with `<column> IN (?, ?, ...)` using parameter binding for values.
        """
        if not values:
            return Result.Ok([])

        if not isinstance(values, (list, tuple)):
            return Result.Err(ErrorCode.INVALID_INPUT, "values must be a list or tuple")

        ok_col, safe_col = _validate_and_repair_column_name(column)
        if not ok_col or not safe_col:
            return Result.Err(ErrorCode.INVALID_INPUT, f"Invalid column name: {column}")

        ok_tpl, why = _validate_in_base_query(base_query)
        if not ok_tpl:
            return Result.Err(ErrorCode.INVALID_INPUT, why or "Invalid base_query template")

        placeholders = ",".join(["?"] * len(values))
        in_clause = f"{safe_col} IN ({placeholders})"
        query = str(base_query).replace("{IN_CLAUSE}", in_clause)

        params = tuple(values)
        if additional_params:
            params = params + tuple(additional_params)

        return self.query(query, params)

    async def aquery_in(
        self,
        base_query: str,
        column: str,
        values: List[Any],
        additional_params: Optional[tuple] = None,
    ) -> Result[List[Dict[str, Any]]]:
        if not values:
            return Result.Ok([])
        if not isinstance(values, (list, tuple)):
            return Result.Err(ErrorCode.INVALID_INPUT, "values must be a list or tuple")
        ok_col, safe_col = _validate_and_repair_column_name(column)
        if not ok_col or not safe_col:
            return Result.Err(ErrorCode.INVALID_INPUT, f"Invalid column name: {column}")
        ok_tpl, why = _validate_in_base_query(base_query)
        if not ok_tpl:
            return Result.Err(ErrorCode.INVALID_INPUT, why or "Invalid base_query template")

        placeholders = ",".join(["?"] * len(values))
        in_clause = f"{safe_col} IN ({placeholders})"
        query = str(base_query).replace("{IN_CLAUSE}", in_clause)

        params = tuple(values)
        if additional_params:
            params = params + tuple(additional_params)
        return await self.aquery(query, params)

    async def _executemany_async(
        self,
        query: str,
        params_list: List[Tuple],
        *,
        tx_token: Optional[str] = None,
    ) -> Result[int]:
        await self._ensure_initialized_async()
        token = tx_token or self._tx_token()
        if token:
            conn = self._tx_conns.get(token)
            if not conn:
                return Result.Err(ErrorCode.DB_ERROR, "Transaction connection missing")
            return await self._executemany_on_conn_async(conn, query, params_list, commit=False, tx_token=token)

        conn = await self._acquire_connection_async()
        try:
            return await self._executemany_on_conn_async(conn, query, params_list, commit=True, tx_token=None)
        finally:
            await self._release_connection_async(conn)

    async def _executemany_on_conn_async(
        self,
        conn: aiosqlite.Connection,
        query: str,
        params_list: List[Tuple],
        *,
        commit: bool,
        tx_token: Optional[str] = None,
    ) -> Result[int]:
        try:
            lock = self._write_lock
            is_write = self._is_write_sql(query)
            if is_write and lock is not None:
                if tx_token and tx_token in self._tx_write_lock_tokens:
                    return await self._executemany_on_conn_locked_async(conn, query, params_list, commit=commit)
                async with lock:
                    return await self._executemany_on_conn_locked_async(conn, query, params_list, commit=commit)
            return await self._executemany_on_conn_locked_async(conn, query, params_list, commit=commit)
        except sqlite3.OperationalError as exc:
            if "interrupted" in str(exc).lower():
                return Result.Err(ErrorCode.TIMEOUT, "Database operation interrupted (query timeout)")
            logger.error("Batch execute error: %s", exc)
            return Result.Err(ErrorCode.DB_ERROR, str(exc))
        except Exception as exc:
            logger.error("Batch execute error: %s", exc)
            return Result.Err(ErrorCode.DB_ERROR, str(exc))

    async def _executemany_on_conn_locked_async(
        self, conn: aiosqlite.Connection, query: str, params_list: List[Tuple], *, commit: bool
    ) -> Result[int]:
        try:
            for attempt in range(self._lock_retry_attempts + 1):
                try:
                    cursor = await conn.executemany(query, params_list)
                    try:
                        if commit:
                            await conn.commit()
                        rowcount = getattr(cursor, "rowcount", None)
                        return Result.Ok(int(rowcount or 0))
                    finally:
                        try:
                            await cursor.close()
                        except Exception:
                            pass
                except sqlite3.OperationalError as exc:
                    if self._is_locked_error(exc) and attempt < self._lock_retry_attempts:
                        self._sleep_backoff(attempt)
                        continue
                    raise
        except Exception:
            raise

    def executemany(self, query: str, params_list: List[Tuple]) -> Result[int]:
        try:
            token = self._tx_token()
            return self._loop_thread.run(self._executemany_async(query, params_list, tx_token=token))
        except Exception as exc:
            return Result.Err(ErrorCode.DB_ERROR, str(exc))

    async def aexecutemany(self, query: str, params_list: List[Tuple]) -> Result[int]:
        token = _TX_TOKEN.get()
        fut = self._loop_thread.submit(self._executemany_async(query, params_list, tx_token=token))
        return await asyncio.wrap_future(fut)

    async def _executescript_async(self, script: str, *, tx_token: Optional[str] = None) -> Result[bool]:
        await self._ensure_initialized_async()
        token = tx_token or self._tx_token()
        if token:
            conn = self._tx_conns.get(token)
            if not conn:
                return Result.Err(ErrorCode.DB_ERROR, "Transaction connection missing")
            return await self._executescript_on_conn_async(conn, script, commit=False)

        conn = await self._acquire_connection_async()
        try:
            lock = self._write_lock
            if lock is not None:
                async with lock:
                    return await self._executescript_on_conn_async(conn, script, commit=True)
            return await self._executescript_on_conn_async(conn, script, commit=True)
        finally:
            await self._release_connection_async(conn)

    async def _executescript_on_conn_async(self, conn: aiosqlite.Connection, script: str, *, commit: bool) -> Result[bool]:
        try:
            for attempt in range(self._lock_retry_attempts + 1):
                try:
                    await conn.executescript(script)
                    if commit:
                        await conn.commit()
                    return Result.Ok(True)
                except sqlite3.OperationalError as exc:
                    if self._is_locked_error(exc) and attempt < self._lock_retry_attempts:
                        self._sleep_backoff(attempt)
                        continue
                    raise
        except sqlite3.OperationalError as exc:
            if "interrupted" in str(exc).lower():
                return Result.Err(ErrorCode.TIMEOUT, "Database operation interrupted (query timeout)")
            logger.error("Script execution error: %s", exc)
            return Result.Err(ErrorCode.DB_ERROR, str(exc))
        except Exception as exc:
            logger.error("Script execution error: %s", exc)
            return Result.Err(ErrorCode.DB_ERROR, str(exc))

    def executescript(self, script: str) -> Result[bool]:
        try:
            token = self._tx_token()
            return self._loop_thread.run(self._executescript_async(script, tx_token=token))
        except Exception as exc:
            return Result.Err(ErrorCode.DB_ERROR, str(exc))

    async def aexecutescript(self, script: str) -> Result[bool]:
        token = _TX_TOKEN.get()
        fut = self._loop_thread.submit(self._executescript_async(script, tx_token=token))
        return await asyncio.wrap_future(fut)

    async def _vacuum_async(self) -> Result[bool]:
        await self._ensure_initialized_async()
        conn = await self._acquire_connection_async()
        try:
            await conn.execute("VACUUM")
            await conn.commit()
            logger.info("Database vacuumed successfully")
            return Result.Ok(True)
        except Exception as exc:
            logger.error("Vacuum error: %s", exc)
            return Result.Err(ErrorCode.DB_ERROR, str(exc))
        finally:
            await self._release_connection_async(conn)

    def vacuum(self) -> Result[bool]:
        try:
            return self._loop_thread.run(self._vacuum_async())
        except Exception as exc:
            return Result.Err(ErrorCode.DB_ERROR, str(exc))

    async def avacuum(self) -> Result[bool]:
        fut = self._loop_thread.submit(self._vacuum_async())
        return await asyncio.wrap_future(fut)

    def has_table(self, table_name: str) -> bool:
        result = self.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
            (table_name,),
            fetch=True,
        )
        return bool(result.ok and result.data and len(result.data) > 0)

    def get_schema_version(self) -> int:
        if not self.has_table("metadata"):
            return 0

        result = self.execute(
            "SELECT value FROM metadata WHERE key = 'schema_version'",
            fetch=True,
        )
        if result.ok and result.data and len(result.data) > 0:
            try:
                return int(result.data[0]["value"])
            except (ValueError, KeyError, TypeError):
                logger.warning("Invalid schema_version value in database")
                return 0
        return 0

    def set_schema_version(self, version: int) -> Result[bool]:
        return self.execute(
            "INSERT OR REPLACE INTO metadata (key, value) VALUES ('schema_version', ?)",
            (str(version),),
        )

    async def _begin_tx_async(self, mode: str) -> Result[str]:
        await self._ensure_initialized_async()
        lock = self._write_lock
        if lock is not None:
            await lock.acquire()
        conn = await self._acquire_connection_async()
        token = f"tx_{uuid.uuid4().hex}"

        begin_stmt = "BEGIN IMMEDIATE"
        if isinstance(mode, str) and mode.lower() in ("deferred", "immediate", "exclusive"):
            begin_stmt = f"BEGIN {mode.upper()}"
        elif isinstance(mode, str) and mode.strip() == "":
            begin_stmt = "BEGIN"

        try:
            for attempt in range(self._lock_retry_attempts + 1):
                try:
                    await conn.execute(begin_stmt)
                    break
                except sqlite3.OperationalError as exc:
                    if self._is_locked_error(exc) and attempt < self._lock_retry_attempts:
                        self._sleep_backoff(attempt)
                        continue
                    raise
            self._tx_conns[token] = conn
            if lock is not None:
                self._tx_write_lock_tokens.add(token)
            return Result.Ok(token)
        except Exception as exc:
            try:
                await conn.rollback()
            except Exception:
                pass
            await self._release_connection_async(conn)
            if lock is not None:
                try:
                    lock.release()
                except Exception:
                    pass
            return Result.Err(ErrorCode.DB_ERROR, str(exc))

    async def _commit_tx_async(self, token: str) -> Result[bool]:
        lock = self._write_lock
        conn = self._tx_conns.pop(token, None)
        if not conn:
            return Result.Err(ErrorCode.DB_ERROR, "Transaction connection missing")
        try:
            for attempt in range(self._lock_retry_attempts + 1):
                try:
                    await conn.commit()
                    break
                except sqlite3.OperationalError as exc:
                    if self._is_locked_error(exc) and attempt < self._lock_retry_attempts:
                        self._sleep_backoff(attempt)
                        continue
                    raise
            return Result.Ok(True)
        except Exception as exc:
            return Result.Err(ErrorCode.DB_ERROR, str(exc))
        finally:
            await self._release_connection_async(conn)
            if lock is not None and token in self._tx_write_lock_tokens:
                self._tx_write_lock_tokens.discard(token)
                try:
                    lock.release()
                except Exception:
                    pass

    async def _rollback_tx_async(self, token: str) -> Result[bool]:
        lock = self._write_lock
        conn = self._tx_conns.pop(token, None)
        if not conn:
            return Result.Err(ErrorCode.DB_ERROR, "Transaction connection missing")
        try:
            try:
                await conn.rollback()
            except Exception:
                pass
            return Result.Ok(True)
        finally:
            await self._release_connection_async(conn)
            if lock is not None and token in self._tx_write_lock_tokens:
                self._tx_write_lock_tokens.discard(token)
                try:
                    lock.release()
                except Exception:
                    pass

    # NOTE: `transaction()` is defined later (sync back-compat). Keeping a single
    # implementation avoids subtle bugs (e.g. missing `_tx_local`).

    async def _close_all_async(self):
        # Close transaction connections first.
        tokens = list(self._tx_conns.keys())
        for token in tokens:
            conn = self._tx_conns.pop(token, None)
            if not conn:
                continue
            try:
                await conn.close()
            except Exception:
                pass

        while True:
            try:
                conn = self._pool.get_nowait()
            except Empty:
                break
            try:
                await conn.close()
            except Exception:
                pass

    def close(self):
        try:
            self._loop_thread.run(self._close_all_async())
        except Exception as exc:
            logger.debug("DB close failed: %s", exc)
        finally:
            self._loop_thread.stop()

    async def aclose(self):
        fut = self._loop_thread.submit(self._close_all_async())
        try:
            await asyncio.wrap_future(fut)
        finally:
            self._loop_thread.stop()

    async def _begin_tx_for_async(self, mode: str) -> Result[str]:
        fut = self._loop_thread.submit(self._begin_tx_async(mode))
        return await asyncio.wrap_future(fut)

    async def _commit_tx_for_async(self, token: str) -> Result[bool]:
        fut = self._loop_thread.submit(self._commit_tx_async(token))
        return await asyncio.wrap_future(fut)

    async def _rollback_tx_for_async(self, token: str) -> Result[bool]:
        fut = self._loop_thread.submit(self._rollback_tx_async(token))
        return await asyncio.wrap_future(fut)

    @contextmanager
    def transaction(self, mode: str = "immediate"):
        # Back-compat sync transaction: routes token via thread-local.
        begin_res = self._loop_thread.run(self._begin_tx_async(mode))
        if not begin_res.ok or not begin_res.data:
            raise RuntimeError(str(begin_res.error or "Failed to begin transaction"))

        token = str(begin_res.data)
        self._tx_local.token = token
        try:
            yield
            commit_res = self._loop_thread.run(self._commit_tx_async(token))
            if not commit_res.ok:
                raise RuntimeError(str(commit_res.error or "Commit failed"))
        except Exception:
            try:
                self._loop_thread.run(self._rollback_tx_async(token))
            except Exception:
                pass
            raise
        finally:
            try:
                if hasattr(self._tx_local, "token"):
                    del self._tx_local.token
            except Exception:
                pass

    @asynccontextmanager
    async def atransaction(self, mode: str = "immediate"):
        begin_res = await self._begin_tx_for_async(mode)
        if not begin_res.ok or not begin_res.data:
            raise RuntimeError(str(begin_res.error or "Failed to begin transaction"))

        token = str(begin_res.data)
        token_handle = _TX_TOKEN.set(token)
        try:
            yield
            commit_res = await self._commit_tx_for_async(token)
            if not commit_res.ok:
                raise RuntimeError(str(commit_res.error or "Commit failed"))
        except Exception:
            try:
                await self._rollback_tx_for_async(token)
            except Exception:
                pass
            raise
        finally:
            _TX_TOKEN.reset(token_handle)
