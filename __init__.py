"""
ComfyUI-Majoor-AssetsManager
Advanced asset browser for ComfyUI with ratings, tags, and metadata management.
"""

from __future__ import annotations

import importlib
import os
import shutil
import subprocess
import sys
from typing import Optional
from pathlib import Path

# ComfyUI extension metadata
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
WEB_DIRECTORY = "./js"

# ---- Windows safety guard -------------------------------------------------
# ComfyUI loads every entry under `custom_nodes/`. On Windows, reserved device
# filenames like `NUL` can appear (accidentally created by tooling) and cause
# noisy import failures. We best-effort delete them when our extension loads so
# it can't break subsequent restarts.


def _windows_extended_path(path: str) -> str:
    if path.startswith("\\\\?\\"):
        return path
    if path.startswith("\\\\"):
        # UNC path: \\server\share\... -> \\?\UNC\server\share\...
        return "\\\\?\\UNC\\" + path.lstrip("\\")
    return "\\\\?\\" + path


def _try_delete_windows_path(path: str) -> None:
    nt_path = _windows_extended_path(path)
    try:
        os.unlink(nt_path)
        return
    except IsADirectoryError:
        pass
    except FileNotFoundError:
        return
    except OSError:
        # Fall through to directory removal / cmd fallback.
        pass

    try:
        shutil.rmtree(nt_path)
        return
    except FileNotFoundError:
        return
    except OSError:
        pass

    # Last-resort fallback via cmd builtins (kept best-effort and silent).
    try:
        subprocess.run(["cmd", "/c", f'del /f /q "{nt_path}"'], check=False, capture_output=True)
        subprocess.run(["cmd", "/c", f'rd /s /q "{nt_path}"'], check=False, capture_output=True)
    except Exception:
        pass


def _cleanup_windows_reserved_custom_nodes() -> Optional[str]:
    try:
        if os.name != "nt":
            return None
        custom_nodes_dir = Path(__file__).resolve().parent.parent
        if not custom_nodes_dir.exists():
            return None

        try:
            entries = os.listdir(str(custom_nodes_dir))
        except OSError:
            return None

        reserved = {"CON", "PRN", "AUX", "NUL"}
        reserved.update({f"COM{i}" for i in range(1, 10)})
        reserved.update({f"LPT{i}" for i in range(1, 10)})

        for name in entries:
            # Windows device names are reserved even with extensions and trailing dots/spaces.
            cleaned = str(name or "").strip().rstrip(". ")
            base = cleaned.split(".", 1)[0].strip().upper()
            if base not in reserved:
                continue
            try:
                victim = str((custom_nodes_dir / name).resolve())
            except Exception:
                victim = str(custom_nodes_dir / name)
            _try_delete_windows_path(victim)
            return victim
    except Exception:
        return None
    return None


try:
    removed = _cleanup_windows_reserved_custom_nodes()
    if removed:
        print(f"Majoor Assets Manager: removed Windows reserved custom node entry: {removed}")
except Exception:
    pass

# Register API routes (importing `backend.routes` auto-registers via PromptServer decorators)
# NOTE: In "Legacy Mode", ComfyUI may import this file as a module (not a package). Also,
# importing as a subpackage (`from .backend import ...`) breaks when backend uses absolute imports
# like `from backend.config import ...`. To keep imports stable, we always expose our node root on
# sys.path and import `backend.routes` as a top-level package.
try:
    root = Path(__file__).resolve().parent
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))

    expected_backend_dir = (root / "backend").resolve()
    existing_backend = sys.modules.get("backend")
    if existing_backend is not None:
        try:
            existing_file = Path(getattr(existing_backend, "__file__", "")).resolve()
        except Exception:
            existing_file = None

        if not existing_file or expected_backend_dir not in existing_file.parents:
            for name in list(sys.modules.keys()):
                if name == "backend" or name.startswith("backend."):
                    sys.modules.pop(name, None)

    # Helpful hint (and optional auto-install) when ComfyUI-Manager didn't install deps yet (embedded Python).
    # Can be disabled with env var `MJR_AM_NO_AUTO_PIP=1`.
    try:
        import importlib.util as _ilu

        def _spec_ok(module_name: str) -> bool:
            try:
                return _ilu.find_spec(module_name) is not None
            except Exception:
                return False

        def _has_pip() -> bool:
            try:
                r = subprocess.run(
                    [sys.executable, "-m", "pip", "--version"],
                    check=False,
                    capture_output=True,
                    timeout=30,
                )
                return r.returncode == 0
            except Exception:
                return False

        def _ensure_pip_best_effort() -> None:
            if _has_pip():
                return
            try:
                subprocess.run(
                    [sys.executable, "-m", "ensurepip", "--upgrade"],
                    check=False,
                    capture_output=True,
                    timeout=120,
                )
            except Exception:
                return

        def _install_requirements_best_effort(req_path: Path) -> None:
            try:
                _ensure_pip_best_effort()
                if not _has_pip():
                    return
                subprocess.run(
                    [sys.executable, "-m", "pip", "install", "-r", str(req_path)],
                    check=False,
                    capture_output=True,
                    timeout=300,
                )
            except Exception:
                return

        no_auto = str(os.environ.get("MJR_AM_NO_AUTO_PIP") or "").strip().lower() in ("1", "true", "yes", "on")
        in_pytest = bool(os.environ.get("PYTEST_CURRENT_TEST")) or ("pytest" in sys.modules) or any("pytest" in str(a).lower() for a in (sys.argv or []))

        # Minimal import-based detection (fast). If any are missing, attempt `pip install -r requirements.txt`.
        # Mapping: package -> import module name.
        required_modules = [
            "aiohttp",
            "PIL",  # pillow
            "send2trash",
            "aiosqlite",
        ]
        if os.name == "nt":
            # pywin32
            required_modules.append("win32api")

        missing = [m for m in required_modules if not _spec_ok(m)]
        if missing:
            req_txt = root / "requirements.txt"
            hint = f"Majoor Assets Manager: missing dependencies: {', '.join(missing)}"
            if req_txt.exists():
                hint += f" (auto-install from {req_txt})"
            else:
                hint += " (requirements.txt not found)"
            print(hint)

            if (not no_auto) and (not in_pytest) and req_txt.exists():
                _install_requirements_best_effort(req_txt)

                # Re-check and print a final message if still missing.
                still_missing = [m for m in required_modules if not _spec_ok(m)]
                if still_missing:
                    print(
                        "Majoor Assets Manager: dependency install incomplete. "
                        f"Try: \"{sys.executable}\" -m pip install -r \"{req_txt}\""
                    )
    except Exception:
        pass

    routes = importlib.import_module("backend.routes")  # type: ignore  # noqa: F401
except Exception:
    # Keep import side-effect-free when ComfyUI environment isn't available.
    try:
        import traceback

        print("Majoor Assets Manager: failed to import backend routes (API endpoints will be unavailable).")
        traceback.print_exc()
    except Exception:
        pass
    routes = None  # type: ignore

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
