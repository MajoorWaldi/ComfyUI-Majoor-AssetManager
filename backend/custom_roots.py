"""
Custom roots persistence and resolution.

Custom roots allow browsing/staging files from arbitrary folders on disk.
Persistence is stored under the Majoor index directory so it survives restarts
without relying on ComfyUI internal userdata routes.
"""

from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import uuid4

from .shared import Result, get_logger
from .config import INDEX_DIR, OUTPUT_ROOT

logger = get_logger(__name__)

_LOCK = threading.Lock()
_STORE_PATH = Path(INDEX_DIR) / "custom_roots.json"
_DEFAULT_MAX_STORE_BYTES = 1024 * 1024  # 1MB
_MAX_STORE_BYTES = int(os.environ.get("MJR_CUSTOM_ROOTS_MAX_BYTES", str(_DEFAULT_MAX_STORE_BYTES)))


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def _is_symlink_like(path: Path) -> bool:
    """
    Best-effort detection for symlinks/junctions/reparse points.
    """
    try:
        if path.is_symlink():
            return True
    except Exception:
        pass
    try:
        st = path.lstat()
        # Windows: reparse points cover symlinks/junctions.
        if hasattr(st, "st_file_attributes"):
            return bool(int(getattr(st, "st_file_attributes") or 0) & 0x400)
    except Exception:
        pass
    return False


def _path_is_relative_to(path: Path, root: Path) -> bool:
    try:
        if hasattr(path, "is_relative_to"):
            return path.is_relative_to(root)  # type: ignore[attr-defined]
        path.relative_to(root)
        return True
    except Exception:
        return False


def _normalize_dir_path(path: str) -> Optional[Path]:
    if not path or "\x00" in path:
        return None
    try:
        p = Path(path).expanduser()
        allow_symlinks = os.environ.get("MJR_ALLOW_SYMLINKS", "").strip().lower() in ("1", "true", "yes", "on")
        if not allow_symlinks and _is_symlink_like(p):
            return None
        resolved = p.resolve(strict=False)
        return resolved
    except (OSError, RuntimeError, ValueError):
        return None


def _read_store() -> Dict[str, Any]:
    if not _STORE_PATH.exists():
        return {"version": 1, "roots": []}
    try:
        try:
            if _STORE_PATH.stat().st_size > _MAX_STORE_BYTES:
                logger.warning("Custom roots store too large, ignoring: %s", _STORE_PATH)
                return {"version": 1, "roots": []}
        except Exception:
            pass
        raw = _STORE_PATH.read_text(encoding="utf-8")
        data = json.loads(raw) if raw else {}
        if not isinstance(data, dict):
            return {"version": 1, "roots": []}
        roots = data.get("roots")
        if not isinstance(roots, list):
            roots = []
        return {"version": int(data.get("version") or 1), "roots": roots}
    except Exception as exc:
        logger.warning("Failed to read custom roots store: %s", exc)
        return {"version": 1, "roots": []}


def _write_store(data: dict) -> Result[bool]:
    try:
        _STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
        # Atomic write to prevent corruption on crash/interruption.
        payload = json.dumps(data, ensure_ascii=False, indent=2)
        tmp = _STORE_PATH.with_name(_STORE_PATH.name + f".tmp_{uuid4().hex}")
        tmp.write_text(payload, encoding="utf-8")
        tmp.replace(_STORE_PATH)
        return Result.Ok(True)
    except Exception as exc:
        logger.warning("Failed to persist custom roots store: %s", exc)
        return Result.Err("STORE_WRITE_FAILED", f"Failed to persist custom roots: {exc}")


def list_custom_roots() -> Result[List[Dict[str, Any]]]:
    """List configured custom root directories (id/path/label/created_at)."""
    with _LOCK:
        store = _read_store()
        roots = store.get("roots") or []
        cleaned: List[Dict[str, Any]] = []
        for r in roots:
            if not isinstance(r, dict):
                continue
            rid = str(r.get("id") or "").strip()
            path = str(r.get("path") or "").strip()
            if not rid or not path:
                continue
            normalized = _normalize_dir_path(path)
            if not normalized:
                continue
            cleaned.append(
                {
                    "id": rid,
                    "path": str(normalized),
                    "label": str(r.get("label") or "").strip() or normalized.name or str(normalized),
                    "created_at": r.get("created_at"),
                }
            )
        return Result.Ok(cleaned)


def add_custom_root(path: str, label: Optional[str] = None) -> Result[Dict[str, Any]]:
    """Add a custom root directory, or return the existing one if present."""
    normalized = _normalize_dir_path(path)
    if not normalized:
        return Result.Err("INVALID_INPUT", "Invalid path")
    if not normalized.exists():
        return Result.Err("DIR_NOT_FOUND", f"Directory not found: {normalized}")
    if not normalized.is_dir():
        return Result.Err("NOT_A_DIRECTORY", f"Not a directory: {normalized}")

    resolved = str(normalized)
    root_id = str(uuid4())
    created_at = _utc_now_iso()
    safe_label = (label or "").strip() or normalized.name or resolved

    output_root = None
    input_root = None
    try:
        if OUTPUT_ROOT:
            output_root = Path(OUTPUT_ROOT).resolve()
    except Exception:
        output_root = None
    try:
        import folder_paths
        input_root = Path(folder_paths.get_input_directory()).resolve()
    except Exception:
        input_root = None

    if output_root:
        if _path_is_relative_to(normalized, output_root) or _path_is_relative_to(output_root, normalized):
            return Result.Err("OVERLAP", f"Root overlaps with output: {output_root}")
    if input_root:
        if _path_is_relative_to(normalized, input_root) or _path_is_relative_to(input_root, normalized):
            return Result.Err("OVERLAP", f"Root overlaps with input: {input_root}")

    with _LOCK:
        store = _read_store()
        roots = store.get("roots") or []
        for r in roots:
            if not isinstance(r, dict):
                continue
            existing_path = r.get("path")
            if existing_path and str(existing_path) == resolved:
                existing_id = str(r.get("id") or "")
                return Result.Ok(
                    {
                        "id": existing_id or root_id,
                        "path": resolved,
                        "label": str(r.get("label") or safe_label),
                        "created_at": r.get("created_at") or created_at,
                        "already_exists": True,
                    }
                )
            if existing_path:
                try:
                    existing_resolved = Path(str(existing_path)).expanduser().resolve(strict=False)
                    if _path_is_relative_to(normalized, existing_resolved) or _path_is_relative_to(existing_resolved, normalized):
                        return Result.Err("OVERLAP", f"Root overlaps with existing: {existing_resolved}")
                except Exception:
                    continue

        roots.append({"id": root_id, "path": resolved, "label": safe_label, "created_at": created_at})
        store["roots"] = roots
        write_result = _write_store(store)
        if not write_result.ok:
            return write_result  # type: ignore[return-value]

    return Result.Ok({"id": root_id, "path": resolved, "label": safe_label, "created_at": created_at})


def remove_custom_root(root_id: str) -> Result[bool]:
    """Remove a custom root by id."""
    rid = str(root_id or "").strip()
    if not rid:
        return Result.Err("INVALID_INPUT", "Missing root_id")

    with _LOCK:
        store = _read_store()
        roots = store.get("roots") or []
        kept = [r for r in roots if not (isinstance(r, dict) and str(r.get("id") or "") == rid)]
        if len(kept) == len(roots):
            return Result.Err("NOT_FOUND", f"Custom root not found: {rid}")
        store["roots"] = kept
        write_result = _write_store(store)
        if not write_result.ok:
            return write_result

    return Result.Ok(True)


def resolve_custom_root(root_id: str) -> Result[Path]:
    """Resolve a custom root id to a validated directory path."""
    rid = str(root_id or "").strip()
    if not rid:
        return Result.Err("INVALID_INPUT", "Missing root_id")

    roots_result = list_custom_roots()
    if not roots_result.ok:
        return Result.Err(roots_result.code, roots_result.error)
    for r in roots_result.data or []:
        if str(r.get("id") or "") == rid:
            normalized = _normalize_dir_path(str(r.get("path") or ""))
            if not normalized:
                return Result.Err("INVALID_INPUT", "Invalid stored path")
            return Result.Ok(normalized)
    return Result.Err("NOT_FOUND", f"Custom root not found: {rid}")
