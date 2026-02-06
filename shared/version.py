from __future__ import annotations

import os
import re
from pathlib import Path
from typing import TypedDict


class VersionInfo(TypedDict):
    version: str
    branch: str


def _find_pyproject_version() -> str:
    try:
        root = Path(__file__).resolve().parent.parent
        pyproject_path = root / "pyproject.toml"
        if not pyproject_path.exists():
            return "0.0.0"
        raw = pyproject_path.read_text(encoding="utf-8")
        match = re.search(r'^version\s*=\s*"(.*?)"', raw, flags=re.MULTILINE)
        if match:
            return match.group(1).strip()
    except Exception:
        pass
    return "0.0.0"


def _resolve_branch_from_env() -> str:
    for key in ("MAJOR_ASSETS_MANAGER_BRANCH", "MAJOOR_ASSETS_MANAGER_BRANCH"):
        value = os.environ.get(key)
        if value:
            return value.strip()
    return "main"


def get_version_info() -> VersionInfo:
    return {
        "version": _find_pyproject_version(),
        "branch": _resolve_branch_from_env(),
    }

