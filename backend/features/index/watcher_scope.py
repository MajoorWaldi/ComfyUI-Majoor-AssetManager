"""
Watcher scope persistence and watch path resolution.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

try:
    import folder_paths  # type: ignore
except Exception:
    class _FolderPathsStub:
        @staticmethod
        def get_input_directory() -> str:
            return str((Path(__file__).resolve().parents[4] / "input").resolve())

    folder_paths = _FolderPathsStub()  # type: ignore

from ...config import OUTPUT_ROOT
from ...custom_roots import resolve_custom_root, list_custom_roots

WATCHER_SCOPE_KEY = "watcher_scope"
WATCHER_CUSTOM_ROOT_ID_KEY = "watcher_custom_root_id"


def normalize_scope(scope: Optional[str]) -> str:
    s = str(scope or "").strip().lower() or "output"
    if s in ("outputs",):
        return "output"
    if s in ("inputs",):
        return "input"
    allowed = {"output", "input", "all", "custom"}
    return s if s in allowed else "output"


def build_watch_paths(scope: str, custom_root_id: Optional[str]) -> list[dict]:
    watch_paths: list[dict] = []
    s = normalize_scope(scope)

    if s == "output":
        if OUTPUT_ROOT and os.path.isdir(OUTPUT_ROOT):
            watch_paths.append({"path": OUTPUT_ROOT, "source": "output", "root_id": None})
        return watch_paths

    if s == "input":
        try:
            input_root = folder_paths.get_input_directory()
        except Exception:
            input_root = None
        if input_root and os.path.isdir(input_root):
            watch_paths.append({"path": input_root, "source": "input", "root_id": None})
        return watch_paths

    if s == "custom":
        root_result = resolve_custom_root(str(custom_root_id or ""))
        if root_result.ok:
            path = str(root_result.data)
            if path and os.path.isdir(path):
                watch_paths.append({"path": path, "source": "custom", "root_id": str(custom_root_id or "")})
        return watch_paths

    if s == "all":
        if OUTPUT_ROOT and os.path.isdir(OUTPUT_ROOT):
            watch_paths.append({"path": OUTPUT_ROOT, "source": "output", "root_id": None})
        try:
            input_root = folder_paths.get_input_directory()
            if input_root and os.path.isdir(input_root):
                watch_paths.append({"path": input_root, "source": "input", "root_id": None})
        except Exception:
            pass
        try:
            roots_result = list_custom_roots()
            if roots_result.ok:
                for root in (roots_result.data or []):
                    path = root.get("path")
                    if path and os.path.isdir(path):
                        watch_paths.append({"path": path, "source": "custom", "root_id": root.get("id")})
        except Exception:
            pass
        return watch_paths

    return watch_paths


async def load_watcher_scope(db) -> dict:
    scope = "output"
    custom_root_id = ""
    try:
        res = await db.aquery(
            "SELECT key, value FROM metadata WHERE key IN (?, ?)",
            (WATCHER_SCOPE_KEY, WATCHER_CUSTOM_ROOT_ID_KEY),
        )
        if res.ok and res.data:
            for row in res.data:
                key = str(row.get("key") or "")
                val = str(row.get("value") or "")
                if key == WATCHER_SCOPE_KEY and val:
                    scope = val
                elif key == WATCHER_CUSTOM_ROOT_ID_KEY:
                    custom_root_id = val
    except Exception:
        pass
    return {
        "scope": normalize_scope(scope),
        "custom_root_id": str(custom_root_id or "").strip(),
    }
