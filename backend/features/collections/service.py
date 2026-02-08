"""
Collections service - persistent user-curated sets of assets.

Collections are stored as JSON files under `config.COLLECTIONS_DIR`.
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4

from ...config import COLLECTIONS_DIR_PATH
from ...shared import Result, ErrorCode, get_logger, classify_file

logger = get_logger(__name__)

MIN_COLLECTION_ID_LEN = 6
MAX_COLLECTION_ID_LEN = 80
MAX_COLLECTION_NAME_LEN = 80

DEFAULT_MAX_COLLECTION_ITEMS = 50_000
MIN_COLLECTION_ITEMS = 100
HARD_MAX_COLLECTION_ITEMS = 500_000

_ID_RE = re.compile(rf"^[a-zA-Z0-9_-]{{{MIN_COLLECTION_ID_LEN},{MAX_COLLECTION_ID_LEN}}}$")
_DEFAULT_MAX_ITEMS = DEFAULT_MAX_COLLECTION_ITEMS
try:
    _MAX_COLLECTION_ITEMS = int(os.environ.get("MJR_COLLECTION_MAX_ITEMS", str(_DEFAULT_MAX_ITEMS)))
except Exception:
    _MAX_COLLECTION_ITEMS = _DEFAULT_MAX_ITEMS
_MAX_COLLECTION_ITEMS = max(MIN_COLLECTION_ITEMS, min(HARD_MAX_COLLECTION_ITEMS, int(_MAX_COLLECTION_ITEMS or _DEFAULT_MAX_ITEMS)))


def _now_iso() -> str:
    try:
        return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    except Exception:
        return ""


def _normalize_fp(fp: str) -> str:
    try:
        p = Path(fp)
        # Prefer strict resolution when the path exists (resolves symlinks/junctions).
        try:
            if p.exists():
                p = p.resolve(strict=True)
            else:
                p = p.resolve(strict=False)
        except Exception:
            p = p.resolve(strict=False)
        normalized = str(p)
        # Windows filesystems are case-insensitive by default; preserve case on POSIX.
        if os.name == "nt":
            return os.path.normcase(normalized)
        return normalized
    except Exception:
        fallback = str(fp or "").strip()
        if os.name == "nt":
            return os.path.normcase(fallback)
        return fallback


def _safe_id(value: str) -> Optional[str]:
    s = str(value or "").strip()
    if not s:
        return None
    if not _ID_RE.match(s):
        return None
    return s


def _safe_name(value: str) -> Optional[str]:
    s = str(value or "").strip()
    if not s:
        return None
    if len(s) > MAX_COLLECTION_NAME_LEN:
        s = s[:MAX_COLLECTION_NAME_LEN].strip()
    return s or None


def _collection_path(collection_id: str) -> Optional[Path]:
    cid = _safe_id(collection_id)
    if not cid:
        return None
    try:
        base = COLLECTIONS_DIR_PATH.resolve(strict=False)
        p = (base / f"{cid}.json").resolve(strict=False)
        if p.parent != base:
            return None
        return p
    except Exception:
        return None


@dataclass(frozen=True)
class CollectionSummary:
    """Lightweight summary row for collection listings."""
    id: str
    name: str
    count: int
    updated_at: str


class CollectionsService:
    """Filesystem-backed collections service (JSON files under `COLLECTIONS_DIR`)."""

    def __init__(self, base_dir: Optional[str | Path] = None):
        self._base = Path(base_dir) if base_dir is not None else Path(COLLECTIONS_DIR_PATH)
        self._lock = threading.Lock()
        try:
            self._base.mkdir(parents=True, exist_ok=True)
        except Exception:
            pass

    def list(self) -> Result[List[Dict[str, Any]]]:
        """List collections with basic metadata and item counts."""
        try:
            base = self._base.resolve(strict=False)
        except Exception as exc:
            return Result.Err(ErrorCode.DB_ERROR, f"Collections dir unavailable: {exc}")

        items: List[CollectionSummary] = []
        with self._lock:
            try:
                for p in base.glob("*.json"):
                    try:
                        data = json.loads(p.read_text(encoding="utf-8"))
                    except Exception:
                        continue
                    cid = str(data.get("id") or p.stem)
                    name = str(data.get("name") or "").strip() or cid
                    count = int(len(data.get("items") or []))
                    updated_at = str(data.get("updated_at") or "")
                    if not _safe_id(cid):
                        continue
                    items.append(CollectionSummary(cid, name, count, updated_at))
            except Exception as exc:
                return Result.Err(ErrorCode.DB_ERROR, f"Failed to list collections: {exc}")

        # Sort newest-ish first (fallback to id)
        items.sort(key=lambda x: (x.updated_at or "", x.id), reverse=True)
        return Result.Ok([i.__dict__ for i in items])

    def create(self, name: str) -> Result[Dict[str, Any]]:
        """Create a new empty collection."""
        cname = _safe_name(name)
        if not cname:
            return Result.Err(ErrorCode.INVALID_INPUT, "Missing collection name")

        cid = uuid4().hex[:12]
        path = _collection_path(cid)
        if not path:
            return Result.Err(ErrorCode.DB_ERROR, "Failed to allocate collection id")

        payload: Dict[str, Any] = {
            "id": cid,
            "name": cname,
            "created_at": _now_iso(),
            "updated_at": _now_iso(),
            "items": [],
        }

        with self._lock:
            try:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            except Exception as exc:
                return Result.Err(ErrorCode.DB_ERROR, f"Failed to create collection: {exc}")

        return Result.Ok({"id": cid, "name": cname})

    def get(self, collection_id: str) -> Result[Dict[str, Any]]:
        """Get a collection by id (including items)."""
        path = _collection_path(collection_id)
        if not path:
            return Result.Err(ErrorCode.INVALID_INPUT, "Invalid collection id")
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return Result.Err(ErrorCode.NOT_FOUND, "Collection not found")
        except Exception as exc:
            return Result.Err(ErrorCode.PARSE_ERROR, f"Failed to read collection: {exc}")

        cid = str(data.get("id") or collection_id)
        if not _safe_id(cid):
            return Result.Err(ErrorCode.PARSE_ERROR, "Collection file is corrupted (bad id)")
        name = str(data.get("name") or "").strip() or cid
        items = data.get("items") if isinstance(data.get("items"), list) else []

        return Result.Ok(
            {
                "id": cid,
                "name": name,
                "created_at": data.get("created_at") or "",
                "updated_at": data.get("updated_at") or "",
                "items": items,
            }
        )

    def delete(self, collection_id: str) -> Result[bool]:
        """Delete a collection file by id."""
        path = _collection_path(collection_id)
        if not path:
            return Result.Err(ErrorCode.INVALID_INPUT, "Invalid collection id")
        with self._lock:
            try:
                path.unlink(missing_ok=True)  # py3.8+; safe on 3.11+
            except TypeError:
                try:
                    if path.exists():
                        path.unlink()
                except Exception as exc:
                    return Result.Err(ErrorCode.DB_ERROR, f"Failed to delete collection: {exc}")
            except Exception as exc:
                return Result.Err(ErrorCode.DB_ERROR, f"Failed to delete collection: {exc}")
        return Result.Ok(True)

    def _load_for_update(self, collection_id: str) -> Tuple[Optional[Path], Optional[Dict[str, Any]], Optional[Result[Any]]]:
        path = _collection_path(collection_id)
        if not path:
            return None, None, Result.Err(ErrorCode.INVALID_INPUT, "Invalid collection id")
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return path, None, Result.Err(ErrorCode.NOT_FOUND, "Collection not found")
        except Exception as exc:
            return path, None, Result.Err(ErrorCode.PARSE_ERROR, f"Failed to read collection: {exc}")
        if not isinstance(data, dict):
            return path, None, Result.Err(ErrorCode.PARSE_ERROR, "Invalid collection format")
        if not _safe_id(str(data.get("id") or collection_id)):
            return path, None, Result.Err(ErrorCode.PARSE_ERROR, "Collection file is corrupted (bad id)")
        if not isinstance(data.get("items"), list):
            data["items"] = []
        return path, data, None

    def add_assets(self, collection_id: str, assets: List[Dict[str, Any]]) -> Result[Dict[str, Any]]:
        """Add assets (by filepath) to a collection (deduplicated, bounded)."""
        if not isinstance(assets, list) or not assets:
            return Result.Err(ErrorCode.INVALID_INPUT, "No assets provided")

        cleaned: List[Dict[str, Any]] = []
        for a in assets:
            if not isinstance(a, dict):
                continue
            fp = str(a.get("filepath") or "").strip()
            if not fp:
                continue
            item = {
                "filepath": fp,
                "filename": str(a.get("filename") or "").strip(),
                "subfolder": str(a.get("subfolder") or "").strip(),
                "type": str(a.get("type") or "output").strip().lower(),
                "root_id": str(a.get("root_id") or a.get("rootId") or a.get("custom_root_id") or "").strip() or None,
                "kind": str(a.get("kind") or classify_file(fp) or "unknown").strip().lower(),
                "added_at": _now_iso(),
            }
            cleaned.append(item)

        if not cleaned:
            return Result.Err(ErrorCode.INVALID_INPUT, "No valid assets provided")

        with self._lock:
            path, data, err = self._load_for_update(collection_id)
            if err:
                return err
            assert path is not None and data is not None

            existing = data.get("items") if isinstance(data.get("items"), list) else []
            seen = set()
            existing_seen = set()
            for it in existing:
                if isinstance(it, dict):
                    fp = it.get("filepath")
                    if fp:
                        k = _normalize_fp(str(fp))
                        seen.add(k)
                        existing_seen.add(k)

            added = 0
            skipped_existing = 0
            skipped_duplicate = 0
            skipped_limit = 0
            for it in cleaned:
                if len(existing) >= _MAX_COLLECTION_ITEMS:
                    skipped_limit += 1
                    continue
                key = _normalize_fp(it["filepath"])
                if key in seen:
                    # Already in collection (or duplicated in the same request); report as skipped.
                    if key in existing_seen:
                        skipped_existing += 1
                    else:
                        skipped_duplicate += 1
                    continue
                existing.append(it)
                seen.add(key)
                added += 1

            data["items"] = existing
            data["updated_at"] = _now_iso()

            try:
                path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            except Exception as exc:
                return Result.Err(ErrorCode.DB_ERROR, f"Failed to update collection: {exc}")

        return Result.Ok(
            {
                "id": str(data.get("id") or collection_id),
                "added": int(added),
                "skipped_existing": int(skipped_existing),
                "skipped_duplicate": int(skipped_duplicate),
                "skipped_limit": int(skipped_limit),
                "max_items": int(_MAX_COLLECTION_ITEMS),
                "count": len(existing),
            }
        )

    def remove_filepaths(self, collection_id: str, filepaths: List[str]) -> Result[Dict[str, Any]]:
        """Remove items from a collection by filepath."""
        if not isinstance(filepaths, list) or not filepaths:
            return Result.Err(ErrorCode.INVALID_INPUT, "No filepaths provided")
        targets = set(_normalize_fp(str(p)) for p in filepaths if str(p or "").strip())
        if not targets:
            return Result.Err(ErrorCode.INVALID_INPUT, "No valid filepaths provided")

        with self._lock:
            path, data, err = self._load_for_update(collection_id)
            if err:
                return err
            assert path is not None and data is not None

            existing = data.get("items") if isinstance(data.get("items"), list) else []
            kept: List[Any] = []
            removed = 0
            for it in existing:
                fp = it.get("filepath") if isinstance(it, dict) else None
                if fp and _normalize_fp(str(fp)) in targets:
                    removed += 1
                    continue
                kept.append(it)

            data["items"] = kept
            data["updated_at"] = _now_iso()

            try:
                path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            except Exception as exc:
                return Result.Err(ErrorCode.DB_ERROR, f"Failed to update collection: {exc}")

        return Result.Ok({"id": str(data.get("id") or collection_id), "removed": int(removed), "count": len(kept)})

