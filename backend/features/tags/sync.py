"""
Best-effort rating/tags sync to the filesystem/OS (ExifTool + Windows Shell).

Design goals:
- Never raise to the UI/request handler.
- Keep routes/payloads stable (sync controlled by request headers).
- Avoid blocking request path: run writes in a background worker.
"""

from __future__ import annotations

import os
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

from ...adapters.tools.exiftool import ExifTool
from ...shared import Result, ErrorCode, get_logger

logger = get_logger(__name__)

MAX_TAG_LENGTH = 100
WIN_SHELL_COL_SCAN_MAX = 256
WIN_SHELL_DEFAULT_RATING_COL_IDX = 14
WIN_SHELL_DEFAULT_TAGS_COL_IDX = 21


# Windows Property System stores ratings as a pseudo-percent (0..99).
# Empirically, Explorer and common handlers map stars roughly like this:
# 0★ -> 0, 1★ -> 1, 2★ -> 25, 3★ -> 50, 4★ -> 75, 5★ -> 99.
WIN_RATING_PERCENT_MAP = {0: 0, 1: 1, 2: 25, 3: 50, 4: 75, 5: 99}


def _windows_rating_percent(stars: int) -> int:
    """Convert 0..5 stars into Windows RatingPercent/SharedUserRating.

    Windows does not consistently use 0..100; many handlers top out at 99 for
    5 stars. We keep this mapping stable for interop with Explorer.
    """
    stars = max(0, min(5, int(stars or 0)))
    return WIN_RATING_PERCENT_MAP[stars]


def _normalize_tags(tags: List[str]) -> List[str]:
    out: List[str] = []
    seen = set()
    for t in tags or []:
        if not isinstance(t, str):
            continue
        tag = t.strip()
        if not tag or len(tag) > MAX_TAG_LENGTH:
            continue
        if tag in seen:
            continue
        seen.add(tag)
        out.append(tag)
    return out


def write_exif_rating_tags(exiftool: ExifTool, file_path: str, rating: int, tags: List[str]) -> Result[bool]:
    """
    Try writing rating/tags into the file metadata via ExifTool.
    """
    try:
        if not exiftool or not exiftool.is_available():
            return Result.Err(ErrorCode.TOOL_MISSING, "ExifTool not available")
    except (AttributeError, TypeError, ValueError) as exc:
        logger.debug("ExifTool availability check failed: %s", exc)
        return Result.Err(ErrorCode.TOOL_MISSING, "ExifTool not available")

    try:
        p = Path(str(file_path))
    except (OSError, TypeError, ValueError) as exc:
        logger.debug("Invalid file path for rating/tags sync: %s", exc)
        return Result.Err(ErrorCode.INVALID_INPUT, "Invalid file path")
    if not p.exists() or not p.is_file():
        return Result.Err(ErrorCode.NOT_FOUND, f"File not found: {file_path}")

    stars = max(0, min(5, int(rating or 0)))
    tags_norm = _normalize_tags(tags)
    joined = "; ".join(tags_norm)

    try:
        original_mtime = None
        try:
            original_mtime = os.path.getmtime(str(p))
        except OSError:
            original_mtime = None

        # Multi-namespace writes to maximize Windows Explorer compatibility.
        # Arrays are written as repeated values by the ExifTool adapter.
        payload: Dict[str, Any] = {
            "XMP:Rating": stars,
            "xmp:rating": stars,
            "rating": stars,
            "ratingpercent": _windows_rating_percent(stars),
            # Windows Property System (best-effort; writable depends on container/handler)
            "Microsoft:SharedUserRating": _windows_rating_percent(stars),
            "Microsoft:Category": joined,
            "XMP:Subject": tags_norm,
            "IPTC:Keywords": tags_norm,
            "XPKeywords": joined,
            "Keywords": joined,
            "Subject": joined,
        }

        # Clear tags when explicitly empty.
        if tags_norm == []:
            payload["XMP:Subject"] = []
            payload["IPTC:Keywords"] = []
            payload["Microsoft:Category"] = ""
            payload["XPKeywords"] = ""
            payload["Keywords"] = ""
            payload["Subject"] = ""

        res = exiftool.write(str(p), payload, preserve_workflow=True)
        if not res.ok:
            return Result.Err(res.code or ErrorCode.EXIFTOOL_ERROR, res.error or "ExifTool write failed")

        if original_mtime is not None:
            try:
                os.utime(str(p), (original_mtime, original_mtime))
            except OSError as exc:
                logger.debug("Failed to restore mtime after ExifTool write: %s", exc)

        return Result.Ok(True)
    except Exception as exc:
        return Result.Err(ErrorCode.EXIFTOOL_ERROR, f"ExifTool write failed: {exc}")


@dataclass(frozen=True)
class RatingTagsSyncTask:
    """Coalesced update request for a single file."""
    file_path: str
    rating: int
    tags: List[str]
    mode: str  # "off" | "on" | "exiftool"


_WIN32COM_CHECKED = False
_WIN32COM = None
_WIN_RATING_IDX: Optional[int] = None
_WIN_TAGS_IDX: Optional[int] = None
_RATING_KEYS = ("rating", "note", "notation", "evaluation", "star", "stars", "etoile", "etoiles")
_TAGS_KEYS = ("tag", "tags", "keywords", "keyword", "category", "categories", "categorie", "catégorie", "catégories")


def _safe_import_win32com():
    global _WIN32COM_CHECKED, _WIN32COM
    if _WIN32COM_CHECKED:
        return _WIN32COM
    _WIN32COM_CHECKED = True
    try:
        import win32com.client  # type: ignore

        _WIN32COM = win32com.client
        return _WIN32COM
    except ImportError:
        _WIN32COM = None
        return None


def _normalize_label(text: Any) -> str:
    try:
        return str(text or "").strip().lower()
    except Exception:
        return ""


def _resolve_shell_indices(folder) -> tuple[int, int]:
    global _WIN_RATING_IDX, _WIN_TAGS_IDX
    if _WIN_RATING_IDX is not None and _WIN_TAGS_IDX is not None:
        return _WIN_RATING_IDX, _WIN_TAGS_IDX

    # Common Windows Explorer column indices; will be replaced by discovery below.
    rating_idx = WIN_SHELL_DEFAULT_RATING_COL_IDX
    tags_idx = WIN_SHELL_DEFAULT_TAGS_COL_IDX
    try:
        for i in range(0, WIN_SHELL_COL_SCAN_MAX):
            name = _normalize_label(folder.GetDetailsOf(None, i))
            if not name:
                continue
            if _WIN_RATING_IDX is None and any(k in name for k in _RATING_KEYS):
                _WIN_RATING_IDX = i
            if _WIN_TAGS_IDX is None and any(k in name for k in _TAGS_KEYS):
                _WIN_TAGS_IDX = i
            if _WIN_RATING_IDX is not None and _WIN_TAGS_IDX is not None:
                break
    except Exception as exc:
        logger.debug("Windows shell column discovery failed (fallback indices will be used): %s", exc)

    if _WIN_RATING_IDX is None:
        _WIN_RATING_IDX = rating_idx
    if _WIN_TAGS_IDX is None:
        _WIN_TAGS_IDX = tags_idx
    return _WIN_RATING_IDX, _WIN_TAGS_IDX


def write_windows_rating_tags(file_path: str, rating: int, tags: List[str]) -> Result[bool]:
    """
    Windows-only fallback using Shell.Application SetDetailsOf.

    This is best-effort and requires pywin32. It is used only when ExifTool is
    unavailable or fails.
    """
    if os.name != "nt":
        return Result.Err(ErrorCode.UNSUPPORTED, "Windows metadata sync not supported on this OS")

    win32com = _safe_import_win32com()
    if not win32com:
        return Result.Err(ErrorCode.TOOL_MISSING, "pywin32 not installed (win32com unavailable)")

    try:
        p = Path(str(file_path))
    except (OSError, TypeError, ValueError) as exc:
        logger.debug("Invalid file path for Windows shell rating/tags sync: %s", exc)
        return Result.Err(ErrorCode.INVALID_INPUT, "Invalid file path")
    if not p.exists() or not p.is_file():
        return Result.Err(ErrorCode.NOT_FOUND, f"File not found: {file_path}")

    stars = max(0, min(5, int(rating or 0)))
    rating_val = _windows_rating_percent(stars)
    tags_norm = _normalize_tags(tags)

    original_mtime = None
    try:
        original_mtime = os.path.getmtime(str(p))
    except OSError:
        original_mtime = None

    try:
        pythoncom = None
        try:
            import pythoncom  # type: ignore

            pythoncom.CoInitialize()
        except Exception:
            pythoncom = None

        try:
            shell = win32com.Dispatch("Shell.Application")
            folder = shell.Namespace(str(p.parent))
            item = folder.ParseName(p.name)
            rating_idx, tags_idx = _resolve_shell_indices(folder)

            try:
                folder.GetDetailsOf(item, rating_idx)
                folder.SetDetailsOf(item, rating_idx, str(rating_val))
            except Exception as exc:
                logger.debug("Windows shell rating write skipped: %s", exc)

            try:
                folder.GetDetailsOf(item, tags_idx)
                folder.SetDetailsOf(item, tags_idx, "; ".join(tags_norm) if tags_norm else "")
            except Exception as exc:
                logger.debug("Windows shell tags write skipped: %s", exc)
        finally:
            if pythoncom is not None:
                try:
                    pythoncom.CoUninitialize()
                except Exception as exc:
                    logger.debug("pythoncom.CoUninitialize failed: %s", exc)

        if original_mtime is not None:
            try:
                os.utime(str(p), (original_mtime, original_mtime))
            except OSError as exc:
                logger.debug("Failed to restore mtime after Windows shell write: %s", exc)

        return Result.Ok(True)
    except Exception as exc:
        return Result.Err(ErrorCode.IO_ERROR, f"Windows metadata sync failed: {exc}")


class RatingTagsSyncWorker:
    """
    A background worker that coalesces rating/tag writes per file path.
    """

    def __init__(self, exiftool: ExifTool):
        self._exiftool = exiftool
        self._lock = threading.Lock()
        self._event = threading.Event()
        self._pending: Dict[str, RatingTagsSyncTask] = {}
        self._stop = False
        self._thread = threading.Thread(target=self._run, name="mjr-rating-tags-sync", daemon=True)
        self._thread.start()

    def stop(self, timeout: float = 2.0) -> None:
        """Stop the background worker thread (best-effort)."""
        try:
            self._stop = True
            self._event.set()
            self._thread.join(timeout=timeout)
        except Exception as exc:
            logger.debug("RatingTagsSyncWorker stop failed: %s", exc)

    def enqueue(self, file_path: str, rating: int, tags: List[str], mode: str) -> None:
        """Queue a rating/tags update (coalesced per filepath)."""
        mode_norm = str(mode or "off").strip().lower()
        # Backward compatible: "sidecar"/"both" now map to "on" (no sidecar writes).
        if mode_norm in ("sidecar", "both", "true", "1", "yes", "enabled", "enable", "on"):
            mode_norm = "on"
        if mode_norm not in ("off", "on", "exiftool"):
            mode_norm = "off"
        try:
            task = RatingTagsSyncTask(str(file_path), int(rating or 0), list(tags or []), mode_norm)
        except (TypeError, ValueError):
            return
        with self._lock:
            self._pending[task.file_path] = task
            self._event.set()

    def _drain_one(self) -> Optional[RatingTagsSyncTask]:
        with self._lock:
            if not self._pending:
                self._event.clear()
                return None
            # pop an arbitrary item (dict is insertion-ordered; popitem() pops last)
            _, task = self._pending.popitem()
            if not self._pending:
                self._event.clear()
            return task

    def _run(self) -> None:
        while not self._stop:
            self._event.wait(timeout=0.5)
            if self._stop:
                break

            task = self._drain_one()
            if not task:
                continue

            try:
                self._process(task)
            except Exception as exc:
                # Never let background errors crash ComfyUI.
                logger.debug("RatingTagsSyncWorker task failed: %s", exc)

    def _process(self, task: RatingTagsSyncTask) -> None:
        mode = task.mode
        if mode == "off":
            return

        tags_norm = _normalize_tags(task.tags)
        rating = max(0, min(5, int(task.rating or 0)))

        # Prefer ExifTool (cross-platform), then Windows Shell fallback (Windows-only).
        if mode in ("on", "exiftool"):
            try:
                ex = write_exif_rating_tags(self._exiftool, task.file_path, rating, tags_norm)
                if ex.ok:
                    time.sleep(0.01)
                    return
                logger.debug("ExifTool rating/tags write skipped: %s", ex.error)
            except Exception as exc:
                logger.debug("ExifTool rating/tags write failed: %s", exc)

        try:
            win = write_windows_rating_tags(task.file_path, rating, tags_norm)
            if not win.ok:
                logger.debug("Windows rating/tags write skipped: %s", win.error)
        except Exception as exc:
            logger.debug("Windows rating/tags write failed: %s", exc)

        # Small delay to prevent hammering exiftool when a batch update happens.
        time.sleep(0.01)
