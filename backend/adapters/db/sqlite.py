"""
SQLite database connection manager.
Thread-safe with WAL mode + lightweight connection pooling for concurrency.
"""
import sqlite3
import threading
import time
import random
import re
from contextlib import contextmanager
from queue import Empty, Queue
from typing import Optional, Any, List, Dict, Tuple
from pathlib import Path

from ...shared import Result, ErrorCode, get_logger
from ...config import DB_QUERY_TIMEOUT, DB_MAX_CONNECTIONS

logger = get_logger(__name__)


class Sqlite:
    """
    Connection pool manager for SQLite.

    Maintains a bounded pool of connections to keep WAL-friendly concurrency without
    over-subscribing file handles.
    """

    def __init__(self, db_path: str, max_connections: Optional[int] = None, timeout: float = 30.0):
        self.db_path = Path(db_path)
        max_conn = int(max_connections) if max_connections is not None else int(DB_MAX_CONNECTIONS or 8)
        max_conn = max(1, max_conn)
        self._pool = Queue(maxsize=max_conn)
        self._initialized = False
        self._lock = threading.Lock()
        self._sem = threading.BoundedSemaphore(max_conn)
        self._timeout = timeout
        self._query_timeout = float(DB_QUERY_TIMEOUT) if DB_QUERY_TIMEOUT is not None else 0.0
        self._local = threading.local()
        self._lock_retry_attempts = 6
        self._lock_retry_base_seconds = 0.05
        self._lock_retry_max_seconds = 0.75

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

    def _apply_connection_pragmas(self, conn: sqlite3.Connection):
        cursor = conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA cache_size=-64000")
        cursor.execute("PRAGMA temp_store=MEMORY")
        cursor.execute("PRAGMA busy_timeout = 5000")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    def _init_db(self):
        if self._initialized:
            return

        with self._lock:
            if self._initialized:
                return

            try:
                with self._connection() as conn:
                    self._apply_connection_pragmas(conn)
                self._initialized = True
                logger.info(f"Database initialized: {self.db_path}")
            except Exception as exc:
                logger.error(f"Failed to initialize database: {exc}")
                raise

    def _create_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(
            str(self.db_path),
            check_same_thread=False,
            timeout=self._timeout
        )
        conn.row_factory = sqlite3.Row
        self._apply_connection_pragmas(conn)
        return conn

    def _acquire_connection(self) -> sqlite3.Connection:
        self._sem.acquire()
        try:
            try:
                conn = self._pool.get_nowait()
            except Empty:
                conn = self._create_connection()
            return conn
        except Exception:
            # Ensure we don't leak the semaphore if creating a new connection fails.
            self._sem.release()
            raise

    def _release_connection(self, conn: sqlite3.Connection):
        try:
            if not conn:
                return
            if not self._pool.full():
                self._pool.put(conn)
            else:
                conn.close()
        finally:
            self._sem.release()

    @contextmanager
    def _connection(self):
        conn = getattr(self._local, "conn", None)
        if conn:
            yield conn
            return
        conn = self._acquire_connection()
        try:
            yield conn
        finally:
            self._release_connection(conn)

    @contextmanager
    def _query_timeout_guard(self, conn: sqlite3.Connection):
        """
        Apply a per-statement timeout using SQLite's progress handler.

        This prevents individual long-running queries from blocking indefinitely.
        """
        timeout = float(self._query_timeout or 0.0)
        if timeout <= 0:
            yield
            return

        start = time.monotonic()

        def _progress_handler() -> int:
            # Return non-zero to interrupt the currently running SQLite operation.
            if (time.monotonic() - start) >= timeout:
                return 1
            return 0

        try:
            conn.set_progress_handler(_progress_handler, 10_000)
            yield
        finally:
            try:
                conn.set_progress_handler(None, 0)
            except Exception:
                pass

    def execute(
        self,
        query: str,
        params: Optional[tuple] = None,
        fetch: bool = False
    ) -> Result[Any]:
        try:
            for attempt in range(self._lock_retry_attempts + 1):
                try:
                    with self._connection() as conn:
                        cursor = conn.cursor()
                        try:
                            with self._query_timeout_guard(conn):
                                if params:
                                    cursor.execute(query, params)
                                else:
                                    cursor.execute(query)

                                if fetch:
                                    rows = cursor.fetchall()
                                    return Result.Ok([dict(row) for row in rows])
                            # Commit unless we are inside the explicit transaction() context.
                            if getattr(self._local, "conn", None) is not conn:
                                conn.commit()
                            return Result.Ok(cursor.lastrowid if cursor.lastrowid else cursor.rowcount)
                        finally:
                            try:
                                cursor.close()
                            except Exception:
                                pass
                except sqlite3.OperationalError as exc:
                    if self._is_locked_error(exc) and attempt < self._lock_retry_attempts:
                        self._sleep_backoff(attempt)
                        continue
                    raise
        except sqlite3.IntegrityError as exc:
            logger.warning(f"Integrity error: {exc}")
            return Result.Err(ErrorCode.DB_ERROR, f"Integrity error: {exc}")
        except sqlite3.OperationalError as exc:
            if "interrupted" in str(exc).lower():
                return Result.Err(ErrorCode.TIMEOUT, "Database operation interrupted (query timeout)")
            logger.error(f"Operational error: {exc}")
            return Result.Err(ErrorCode.DB_ERROR, f"Operational error: {exc}")
        except Exception as exc:
            logger.error(f"Unexpected database error: {exc}")
            return Result.Err(ErrorCode.DB_ERROR, str(exc))

    def query(
        self,
        sql: str,
        params: Optional[tuple] = None
    ) -> Result[List[Dict[str, Any]]]:
        return self.execute(sql, params, fetch=True)

    def query_in(
        self,
        base_query: str,
        column: str,
        values: List[Any],
        additional_params: Optional[tuple] = None
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

        # Allow optional table alias prefix (e.g. "a.filepath").
        # NOTE: this is a Python regex; `\.` matches a literal dot.
        if not isinstance(column, str) or not re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)?$", column):
            return Result.Err(ErrorCode.INVALID_INPUT, f"Invalid column name: {column}")

        if "{IN_CLAUSE}" not in str(base_query or ""):
            return Result.Err(ErrorCode.INVALID_INPUT, "base_query must contain {IN_CLAUSE}")

        placeholders = ",".join(["?"] * len(values))
        in_clause = f"{column} IN ({placeholders})"
        query = str(base_query).replace("{IN_CLAUSE}", in_clause)

        params = tuple(values)
        if additional_params:
            params = params + tuple(additional_params)

        return self.query(query, params)

    def executemany(
        self,
        query: str,
        params_list: List[Tuple]
    ) -> Result[int]:
        try:
            for attempt in range(self._lock_retry_attempts + 1):
                try:
                    with self._connection() as conn:
                        cursor = conn.cursor()
                        try:
                            with self._query_timeout_guard(conn):
                                cursor.executemany(query, params_list)
                            if getattr(self._local, "conn", None) is not conn:
                                conn.commit()
                            return Result.Ok(cursor.rowcount)
                        finally:
                            try:
                                cursor.close()
                            except Exception:
                                pass
                except sqlite3.OperationalError as exc:
                    if self._is_locked_error(exc) and attempt < self._lock_retry_attempts:
                        self._sleep_backoff(attempt)
                        continue
                    raise
        except sqlite3.OperationalError as exc:
            if "interrupted" in str(exc).lower():
                return Result.Err(ErrorCode.TIMEOUT, "Database operation interrupted (query timeout)")
            logger.error(f"Batch execute error: {exc}")
            return Result.Err(ErrorCode.DB_ERROR, str(exc))
        except Exception as exc:
            logger.error(f"Batch execute error: {exc}")
            return Result.Err(ErrorCode.DB_ERROR, str(exc))

    def executescript(self, script: str) -> Result[bool]:
        try:
            for attempt in range(self._lock_retry_attempts + 1):
                try:
                    with self._connection() as conn:
                        cursor = conn.cursor()
                        try:
                            with self._query_timeout_guard(conn):
                                cursor.executescript(script)
                            if getattr(self._local, "conn", None) is not conn:
                                conn.commit()
                            return Result.Ok(True)
                        finally:
                            try:
                                cursor.close()
                            except Exception:
                                pass
                except sqlite3.OperationalError as exc:
                    if self._is_locked_error(exc) and attempt < self._lock_retry_attempts:
                        self._sleep_backoff(attempt)
                        continue
                    raise
        except sqlite3.OperationalError as exc:
            if "interrupted" in str(exc).lower():
                return Result.Err(ErrorCode.TIMEOUT, "Database operation interrupted (query timeout)")
            logger.error(f"Script execution error: {exc}")
            return Result.Err(ErrorCode.DB_ERROR, str(exc))
        except Exception as exc:
            logger.error(f"Script execution error: {exc}")
            return Result.Err(ErrorCode.DB_ERROR, str(exc))

    def close(self):
        while not self._pool.empty():
            conn = self._pool.get_nowait()
            conn.close()

    @contextmanager
    def transaction(self, mode: str = "immediate"):
        conn = self._acquire_connection()
        self._local.conn = conn
        try:
            begin_stmt = "BEGIN IMMEDIATE"
            if isinstance(mode, str) and mode.lower() in ("deferred", "immediate", "exclusive"):
                begin_stmt = f"BEGIN {mode.upper()}"
            elif isinstance(mode, str) and mode.lower() == "":
                begin_stmt = "BEGIN"

            for attempt in range(self._lock_retry_attempts + 1):
                try:
                    conn.execute(begin_stmt)
                    break
                except sqlite3.OperationalError as exc:
                    if self._is_locked_error(exc) and attempt < self._lock_retry_attempts:
                        self._sleep_backoff(attempt)
                        continue
                    raise
            yield
            for attempt in range(self._lock_retry_attempts + 1):
                try:
                    conn.commit()
                    break
                except sqlite3.OperationalError as exc:
                    if self._is_locked_error(exc) and attempt < self._lock_retry_attempts:
                        self._sleep_backoff(attempt)
                        continue
                    raise
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
            raise
        finally:
            try:
                if hasattr(self._local, "conn"):
                    del self._local.conn
            finally:
                self._release_connection(conn)

    def get_schema_version(self) -> int:
        if not self.has_table("metadata"):
            return 0

        result = self.execute(
            "SELECT value FROM metadata WHERE key = 'schema_version'",
            fetch=True
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
            (str(version),)
        )

    def vacuum(self) -> Result[bool]:
        try:
            with self._connection() as conn:
                conn.execute("VACUUM")
                logger.info("Database vacuumed successfully")
                return Result.Ok(True)
        except Exception as exc:
            logger.error(f"Vacuum error: {exc}")
            return Result.Err(ErrorCode.DB_ERROR, str(exc))

    def has_table(self, table_name: str) -> bool:
        result = self.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
            (table_name,),
            fetch=True
        )
        return bool(result.ok and result.data and len(result.data) > 0)
