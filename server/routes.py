import os
import subprocess
import asyncio
import time
import threading
import shutil
import platform
import concurrent.futures
import json
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    from send2trash import send2trash  # type: ignore
except Exception:
    send2trash = None

from aiohttp import web

import folder_paths
from server import PromptServer
from .utils import (
    IMAGE_EXTS,
    VIDEO_EXTS,
    AUDIO_EXTS,
    MODEL3D_EXTS,
    classify_ext,
    get_system_metadata,
    load_metadata,
    save_metadata,
    metadata_path,
    _get_exiftool_path,
)
from .metadata import update_metadata_with_windows, deep_merge_metadata
from .generation_metadata import extract_generation_params_from_png, has_generation_workflow
from .config import OUTPUT_ROOT, THUMB_SIZE, ENABLE_JSON_SIDECAR, METADATA_EXT
from .mjr_collections import (
    get_collections,
    load_collection,
    add_to_collection,
    remove_from_collection,
)

# ---------------------------------------------------------------------------
# In-memory cache for output listing
# Avoids redoing a full os.scandir on every auto-refresh.
# ---------------------------------------------------------------------------

_FILE_CACHE: List[Dict[str, Any]] = []
_LAST_SCAN_TS: float = 0.0
_LAST_FOLDER_MTIME: float = 0.0
_LAST_FOLDER_SIGNATURE: Optional[tuple] = None

try:
    _SCAN_MIN_INTERVAL = float(os.environ.get("MJR_SCAN_MIN_INTERVAL", "5.0"))
except Exception:
    _SCAN_MIN_INTERVAL = 5.0

try:
    _META_PREFETCH_COUNT = int(os.environ.get("MJR_META_PREFETCH_COUNT", "80"))
    if _META_PREFETCH_COUNT < 0:
        _META_PREFETCH_COUNT = 0
except Exception:
    _META_PREFETCH_COUNT = 80

_CACHE_LOCK = threading.Lock()


def _folder_changed(root_path: Path) -> bool:
    """Quick check if folder changed (file added/modified)."""
    global _LAST_FOLDER_MTIME, _LAST_FOLDER_SIGNATURE
    try:
        current_mtime = root_path.stat().st_mtime
        if current_mtime != _LAST_FOLDER_MTIME:
            _LAST_FOLDER_MTIME = current_mtime
            _LAST_FOLDER_SIGNATURE = None  # force recompute
            return True

        # Fallback signature (top-level dirs/files count + max mtime)
        def _signature():
            total = 0
            max_m = current_mtime
            sub_sig = []
            try:
                with os.scandir(root_path) as it:
                    for entry in it:
                        try:
                            st = entry.stat()
                            max_m = max(max_m, st.st_mtime)
                        except Exception:
                            continue
                        total += 1
                        if entry.is_dir():
                            try:
                                with os.scandir(entry.path) as sub:
                                    sub_count = sum(1 for _ in sub)
                                sub_sig.append((entry.name, st.st_mtime, sub_count))
                            except Exception:
                                sub_sig.append((entry.name, st.st_mtime, None))
                        else:
                            sub_sig.append((entry.name, st.st_mtime, None))
            except Exception:
                return None
            sub_sig.sort()
            return (total, max_m, tuple(sub_sig))

        sig = _signature()
        if sig is None:
            return True
        if sig != _LAST_FOLDER_SIGNATURE:
            _LAST_FOLDER_SIGNATURE = sig
            return True
        return False
    except Exception:
        return True


def _get_output_root() -> Path:
    """Use the ComfyUI output folder (respects --output-directory)."""
    return Path(folder_paths.get_output_directory()).resolve()


def _safe_target(root: Path, subfolder: str, filename: str) -> Path:
    """
    Build a path under root while rejecting traversal/absolute components.
    - filename must be a plain name (no separators)
    - subfolder must be relative and free of '..'
    """
    if not filename:
        raise ValueError("Missing filename")
    if Path(filename).name != filename:
        raise ValueError("Invalid filename")

    sub = Path(subfolder) if subfolder else Path()
    if sub.is_absolute() or any(part == ".." for part in sub.parts):
        raise ValueError("Invalid subfolder")

    candidate = (root / sub / filename).resolve()
    candidate.relative_to(root)  # will raise if outside
    return candidate


def _metadata_target(path: Path, kind: str) -> Path:
    """
    Direct metadata target; no sidecar PNG fallback.
    """
    return path


def _rating_tags_with_fallback(meta_target: Path, kind: str) -> tuple[int, List[str]]:
    """
    Read rating/tags for a file, and for videos optionally fall back to a PNG sibling sidecar
    when both rating and tags are missing.
    """
    sys_meta = get_system_metadata(str(meta_target)) or {}
    json_meta = load_metadata(str(meta_target)) or {}

    rating = sys_meta["rating"] if "rating" in sys_meta else json_meta.get("rating")
    tags = sys_meta["tags"] if "tags" in sys_meta else json_meta.get("tags")

    sys_empty = not sys_meta
    json_empty = not json_meta
    emptyish_rating = rating is None or rating == 0
    emptyish_tags = tags is None or tags == []

    if kind == "video" and sys_empty and json_empty and emptyish_rating and emptyish_tags:
        try:
            sib_png = meta_target.with_suffix(".png")
            sib_json = load_metadata(str(sib_png)) or {}
            if rating is None:
                r = sib_json.get("rating")
                if isinstance(r, int):
                    rating = r
            if tags is None:
                t = sib_json.get("tags")
                if isinstance(t, list):
                    tags = t
        except Exception:
            pass

    if rating is None:
        rating = 0
    if tags is None:
        tags = []
    return rating, tags if isinstance(tags, list) else []


def _open_in_explorer(path: Path) -> bool:
    """Open Windows Explorer selecting the given file."""
    try:
        start_cmd = f'start "" explorer.exe /select,"{str(path)}"'
        res_start = subprocess.run(
            start_cmd,
            shell=True,
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=15,
        )
        if res_start.returncode in (0, 1):
            return True

        cmd = f'explorer.exe /select,"{str(path)}"'
        res = subprocess.run(
            cmd,
            shell=True,
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=15,
        )
        if res.returncode in (0, 1):
            return True

        res2 = subprocess.run(
            ["explorer.exe", "/select,", str(path)],
            shell=False,
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=15,
        )
        return res2.returncode in (0, 1)
    except Exception:
        return False


def _open_in_file_manager(path: Path) -> tuple[bool, Optional[str]]:
    """
    Open the OS file manager for a given path.
    - Windows: Explorer with selection when possible.
    - macOS: Finder with selection via `open -R`.
    - Linux: open the containing folder via xdg-open/gio/kde-open.
    Returns: (ok, warning_message)
    """
    try:
        system = platform.system()
        is_file = path.is_file()
        folder = path.parent if is_file else path

        def _run(cmd: List[str]) -> int:
            return subprocess.run(
                cmd,
                shell=False,
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=15,
            ).returncode

        if system == "Windows":
            if is_file and _open_in_explorer(path):
                return True, None
            rc = _run(["explorer.exe", str(folder)])
            if rc in (0, 1):
                return True, ("Opened folder (selection may not be highlighted)" if is_file else None)
            return False, f"explorer.exe failed (code {rc})"

        if system == "Darwin":
            if is_file:
                rc = _run(["open", "-R", str(path)])
                if rc == 0:
                    return True, None
                rc2 = _run(["open", str(folder)])
                if rc2 == 0:
                    return True, "Opened folder (selection may not be highlighted)"
                return False, f"open failed (code {rc2})"
            rc = _run(["open", str(folder)])
            return (rc == 0), (None if rc == 0 else f"open failed (code {rc})")

        # Linux / other
        opener = None
        for candidate in ("xdg-open", "gio", "kde-open5", "kde-open", "gnome-open", "exo-open"):
            if shutil.which(candidate):
                opener = candidate
                break
        if not opener:
            return False, "No supported opener found (xdg-open/gio/kde-open/gnome-open)"

        if opener == "gio":
            rc = _run([opener, "open", str(folder)])
        else:
            rc = _run([opener, str(folder)])
        if rc == 0:
            return True, ("Opened folder (selection may not be supported on this OS)" if is_file else None)
        return False, f"{opener} failed (code {rc})"
    except Exception as exc:
        return False, str(exc)


def _format_size(num_bytes: int) -> str:
    if not isinstance(num_bytes, (int, float)) or num_bytes < 0:
        return ""
    units = ["B", "KB", "MB", "GB", "TB"]
    value = float(num_bytes)
    i = 0
    while value >= 1024.0 and i < len(units) - 1:
        value /= 1024.0
        i += 1
    if value >= 10:
        return f"{value:.1f} {units[i]}"
    return f"{value:.2f} {units[i]}"


def _format_date(ts: float) -> str:
    from datetime import datetime

    try:
        return datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M")
    except Exception:
        return ""


def _build_view_url(filename: str, subfolder: str) -> str:
    from urllib.parse import urlencode

    params = {"filename": filename, "type": "output"}
    if subfolder:
        params["subfolder"] = subfolder
    return f"/view?{urlencode(params)}"


# ---------------------------------------------------------------------------
# OPTIMIZED SCANNING LOGIC (os.scandir)
# ---------------------------------------------------------------------------

def _scan_folder_recursive(base_path: str, subfolder: str, results: List[Dict[str, Any]]):
    """
    Recursive scanner using os.scandir for performance.
    - Avoids Path object creation in the hot loop.
    - Uses entry.stat() which is cached on Windows.
    """
    try:
        with os.scandir(base_path) as it:
            for entry in it:
                if entry.is_dir():
                    if not entry.name.startswith("."):
                        new_sub = os.path.join(subfolder, entry.name) if subfolder else entry.name
                        _scan_folder_recursive(entry.path, new_sub, results)
                elif entry.is_file():
                    try:
                        name = entry.name
                        lower = name.lower()
                        kind = classify_ext(lower)
                        if kind == "other":
                            continue

                        stat = entry.stat()
                        mtime = stat.st_mtime
                        size = stat.st_size

                        ext = (os.path.splitext(name)[1][1:] or "").upper()

                        rel_path = f"{subfolder}/{name}" if subfolder else name
                        rel_path = rel_path.replace("\\", "/")
                        sub_clean = subfolder.replace("\\", "/")

                        results.append({
                            "filename": name,
                            "name": name,
                            "subfolder": sub_clean,
                            "relpath": rel_path,
                            "mtime": mtime,
                            "date": _format_date(mtime),
                            "size": size,
                            "size_readable": _format_size(size),
                            "kind": kind,
                            "ext": ext,
                            "url": _build_view_url(name, sub_clean),
                        })
                    except OSError:
                        continue
    except OSError:
        pass


def _scan_outputs() -> List[Dict[str, Any]]:
    """
    Entry point for the optimized scanner.
    """
    root = _get_output_root()
    files: List[Dict[str, Any]] = []

    if not root.exists():
        return files

    _scan_folder_recursive(str(root), "", files)

    files.sort(key=lambda f: f["mtime"], reverse=True)
    return files


def _scan_outputs_cached(force: bool = False) -> List[Dict[str, Any]]:
    """
    Wrapper around _scan_outputs with in-memory cache.
    """
    global _FILE_CACHE, _LAST_SCAN_TS

    now = time.time()
    if not force and _FILE_CACHE and (now - _LAST_SCAN_TS) < _SCAN_MIN_INTERVAL:
        return list(_FILE_CACHE)

    with _CACHE_LOCK:
        now = time.time()
        if not force and _FILE_CACHE and (now - _LAST_SCAN_TS) < _SCAN_MIN_INTERVAL:
            return list(_FILE_CACHE)

        root = _get_output_root()
        if not force and _FILE_CACHE and not _folder_changed(root):
            return list(_FILE_CACHE)

        files = _scan_outputs()
        _FILE_CACHE = files
        _LAST_SCAN_TS = now
        return list(_FILE_CACHE)


async def _scan_outputs_async(force: bool = False) -> List[Dict[str, Any]]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _scan_outputs_cached, force)


@PromptServer.instance.routes.get("/mjr/filemanager/files")
async def list_files(request: web.Request) -> web.Response:
    force_param = (request.query.get("force") or "").lower()
    force = force_param in ("1", "true", "yes", "force")

    files = await _scan_outputs_async(force=force)

    # Prefetch metadata for the first N items without delaying the response
    prefetch_count = min(len(files), _META_PREFETCH_COUNT)
    if prefetch_count > 0:
        root = _get_output_root()

        def _prefetch():
            for f in files[:prefetch_count]:
                try:
                    filename = f.get("filename") or f.get("name")
                    subfolder = f.get("subfolder", "")
                    if not filename:
                        continue
                    target = (root / subfolder / filename).resolve()
                    try:
                        target.relative_to(root)
                    except ValueError:
                        continue
                    kind = f.get("kind") or classify_ext(filename.lower())
                    meta_target = _metadata_target(target, kind)
                    if not meta_target.exists():
                        continue
                    rating, tags = _rating_tags_with_fallback(meta_target, kind)
                    f["rating"] = rating
                    f["tags"] = tags
                    # Keep workflow dot accurate even when we mark __metaLoaded.
                    has_wf = False
                    if kind in ("image", "video"):
                        try:
                            has_wf = has_generation_workflow(meta_target)
                        except Exception:
                            has_wf = False
                    f["has_workflow"] = has_wf
                    f["__metaLoaded"] = True
                except Exception:
                    continue

        loop = asyncio.get_running_loop()
        loop.run_in_executor(None, _prefetch)

    return web.json_response({"files": files})


@PromptServer.instance.routes.post("/mjr/filemanager/metadata/batch")
async def batch_metadata(request: web.Request) -> web.Response:
    root = _get_output_root()
    try:
        payload = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": "Invalid JSON"}, status=400)

    items = payload.get("items") or []
    loop = asyncio.get_running_loop()

    def _fetch_one(item: Dict[str, Any]) -> Dict[str, Any]:
        filename = (item or {}).get("filename")
        subfolder = (item or {}).get("subfolder", "")
        result: Dict[str, Any] = {"filename": filename, "subfolder": subfolder}

        if not filename:
            result["error"] = "Missing filename"
            return result

        try:
            target = _safe_target(root, subfolder, filename)
        except ValueError:
            result["error"] = "Outside output directory"
            return result

        if not target.exists():
            result["error"] = "Not found"
            return result

        kind = classify_ext(filename.lower())
        meta_target = _metadata_target(target, kind)
        rating, tags = _rating_tags_with_fallback(meta_target, kind)

        has_wf = False
        if kind in ("image", "video"):
            try:
                has_wf = has_generation_workflow(meta_target)
            except Exception:
                has_wf = False

        result.update(
            {
                "rating": rating,
                "tags": tags,
                "has_workflow": has_wf,
            }
        )
        return result

    # Parallelize within the executor to avoid long serial batches
    results: List[Dict[str, Any]] = []
    errors: List[Dict[str, Any]] = []
    max_workers_env = os.environ.get("MJR_META_BATCH_WORKERS")
    try:
        max_workers_cfg = int(max_workers_env) if max_workers_env is not None else None
    except Exception:
        max_workers_cfg = None
    max_workers = max(1, max_workers_cfg) if max_workers_cfg else 4

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = [pool.submit(_fetch_one, itm) for itm in items]
        for fut in concurrent.futures.as_completed(futures):
            try:
                res = fut.result()
                if res.get("error"):
                    errors.append({"filename": res.get("filename"), "error": res.get("error")})
                elif res.get("filename"):
                    results.append(res)
            except Exception:
                continue

    return web.json_response({"ok": True, "metadatas": results, "errors": errors})


@PromptServer.instance.routes.post("/mjr/filemanager/delete")
async def delete_files(request: web.Request) -> web.Response:
    root = _get_output_root()

    try:
        payload = await request.json()
    except Exception:
        return web.json_response(
            {"ok": False, "error": "Invalid JSON body"}, status=400
        )

    items = payload.get("items") or []
    deleted = []
    errors = []

    for item in items:
        filename = (item or {}).get("filename")
        subfolder = (item or {}).get("subfolder", "")

        if not filename:
            continue

        try:
            candidate = _safe_target(root, subfolder, filename)
        except ValueError:
            errors.append(
                {
                    "filename": filename,
                    "subfolder": subfolder,
                    "error": "Outside output directory",
                }
            )
            continue

        if not candidate.exists():
            errors.append(
                {"filename": filename, "subfolder": subfolder, "error": "Not found"}
            )
            continue

        try:
            if send2trash:
                send2trash(str(candidate))
            else:
                print(f"[Majoor.AssetsManager] send2trash unavailable; deleting permanently: {candidate}")
                candidate.unlink()
            deleted.append({"filename": filename, "subfolder": subfolder})
        except Exception as exc:
            errors.append(
                {"filename": filename, "subfolder": subfolder, "error": str(exc)}
            )

    return web.json_response({"ok": True, "deleted": deleted, "errors": errors})


@PromptServer.instance.routes.post("/mjr/filemanager/open_explorer")
async def open_explorer(request: web.Request) -> web.Response:
    return await open_folder(request)


@PromptServer.instance.routes.post("/mjr/filemanager/open_folder")
async def open_folder(request: web.Request) -> web.Response:
    root = _get_output_root()
    try:
        payload = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": "Invalid JSON body"}, status=400)

    filename = payload.get("filename")
    subfolder = payload.get("subfolder", "")
    if not filename:
        return web.json_response({"ok": False, "error": "Missing filename"}, status=400)

    try:
        target = _safe_target(root, subfolder, filename)
    except ValueError:
        return web.json_response({"ok": False, "error": "File is outside output directory"}, status=400)

    if not target.exists():
        return web.json_response({"ok": False, "error": "File not found"}, status=404)

    ok, warning = _open_in_file_manager(target)
    if ok:
        resp = {"ok": True}
        if warning:
            resp["warning"] = warning
        return web.json_response(resp, status=200)
    return web.json_response({"ok": False, "error": warning or "Failed to open folder"}, status=500)


# ---------------------------------------------------------------------------
# METADATA / WORKFLOW EXTRACTION
# ---------------------------------------------------------------------------

@PromptServer.instance.routes.get("/mjr/filemanager/metadata")
async def get_metadata(request: web.Request) -> web.Response:
    root = _get_output_root()
    filename = request.query.get("filename")
    subfolder = request.query.get("subfolder", "")

    if not filename:
        return web.json_response(
            {"ok": False, "error": "missing filename"}, status=400
        )

    try:
        target = _safe_target(root, subfolder, filename)
    except ValueError:
        return web.json_response(
            {"ok": False, "error": "File is outside output directory"}, status=400
        )

    if not target.exists():
        return web.json_response(
            {"ok": False, "error": "File not found"}, status=404
        )

    def _extract(path: Path) -> Dict[str, Any]:
        try:
            return extract_generation_params_from_png(path) or {}
        except Exception as e:
            print(f"[Majoor.AssetsManager] metadata parsing error for {path.name}: {e}")
            return {}

    ext_lower = target.suffix.lower()
    params: Dict[str, Any] = _extract(target)

    def _has_wf(p: Dict[str, Any]) -> bool:
        return bool(
            p.get("has_workflow")
            or p.get("workflow")
            or p.get("prompt")
            or p.get("positive_prompt")
            or p.get("negative_prompt")
            or p.get("sampler_name")
            or p.get("model")
            or p.get("loras")
        )

    if ext_lower in {".mp4", ".mov", ".m4v", ".webm", ".mkv"} and not _has_wf(params):
        stem = target.stem
        candidates = []
        try:
            for entry in target.parent.iterdir():
                if not entry.is_file():
                    continue
                if entry.suffix.lower() != ".png":
                    continue
                if entry.stem == stem or entry.stem.startswith(f"{stem}_") or entry.stem.startswith(f"{stem}-"):
                    candidates.append(entry)
        except Exception:
            candidates = []

        if candidates:
            candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
            for png in candidates:
                sib_params = _extract(png)
                if _has_wf(sib_params):
                    params = sib_params
                    params["generation_source"] = "sibling_png"
                    break

    if isinstance(params, dict):
        if "has_workflow" not in params:
            params["has_workflow"] = bool(
                params.get("has_workflow")
                or params.get("workflow")
                or params.get("prompt")
                or params.get("positive_prompt")
                or params.get("negative_prompt")
                or params.get("sampler_name")
                or params.get("model")
                or params.get("loras")
            )

    kind = classify_ext(filename.lower())
    rating, tags = _rating_tags_with_fallback(target, kind)

    return web.json_response({"ok": True, "generation": params, "rating": rating, "tags": tags})


@PromptServer.instance.routes.get("/mjr/filemanager/capabilities")
async def get_capabilities(request: web.Request) -> web.Response:
    os_name = platform.system().lower()
    exiftool_available = _get_exiftool_path() is not None
    return web.json_response(
        {
            "ok": True,
            "os": os_name,
            "exiftool_available": exiftool_available,
            "sidecar_enabled": ENABLE_JSON_SIDECAR,
        }
    )


@PromptServer.instance.routes.post("/mjr/filemanager/metadata/update")
async def update_metadata(request: web.Request) -> web.Response:
    root = _get_output_root()

    try:
        payload = await request.json()
    except Exception:
        return web.json_response(
            {"ok": False, "error": "Invalid JSON body"}, status=400
        )

    filename = payload.get("filename")
    subfolder = payload.get("subfolder", "")
    rating_provided = "rating" in payload
    tags_provided = "tags" in payload
    rating = payload.get("rating") if rating_provided else None
    tags = payload.get("tags") if tags_provided else None

    if not filename:
        return web.json_response(
            {"ok": False, "error": "Missing filename"}, status=400
        )

    try:
        target = _safe_target(root, subfolder, filename)
    except ValueError:
        return web.json_response(
            {"ok": False, "error": "File is outside output directory"}, status=400
        )

    kind = classify_ext(filename.lower())
    if not target.exists():
        return web.json_response(
            {"ok": False, "error": "File not found"}, status=404
        )

    updates = {}
    if rating_provided:
        updates["rating"] = rating
    if tags_provided:
        updates["tags"] = tags if tags is not None else []

    try:
        meta = update_metadata_with_windows(str(target), updates)
    except Exception as exc:
        return web.json_response(
            {
                "ok": False,
                "file": {"filename": filename, "subfolder": subfolder},
                "error": str(exc),
            },
            status=500,
        )

    return web.json_response({"ok": True, "rating": meta.get("rating", 0), "tags": meta.get("tags", [])})


@PromptServer.instance.routes.post("/mjr/filemanager/generation/update")
async def update_generation_sidecar(request: web.Request) -> web.Response:
    """
    Persist prompt/workflow into sidecar JSON for generated videos.
    Payload:
      {
        "files": [{"filename": "...", "subfolder": "..."}],
        "prompt": {...},      # optional prompt graph (id -> node)
        "workflow": {...}     # optional raw workflow
      }
    """
    root = _get_output_root()
    try:
        payload = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": "Invalid JSON body"}, status=400)

    files = payload.get("files") or []
    prompt = payload.get("prompt")
    workflow = payload.get("workflow")

    if not isinstance(files, list) or not files:
        return web.json_response({"ok": False, "error": "No files provided"}, status=400)

    updated: List[Dict[str, Any]] = []
    errors: List[Dict[str, Any]] = []

    for item in files:
        filename = (item or {}).get("filename") or (item or {}).get("name")
        subfolder = (item or {}).get("subfolder", "")
        if not filename:
            errors.append({"file": item, "error": "Missing filename"})
            continue
        try:
            target = _safe_target(root, subfolder, filename)
        except ValueError:
            errors.append({"file": {"filename": filename, "subfolder": subfolder}, "error": "Outside output directory"})
            continue
        if not target.exists():
            errors.append({"file": {"filename": filename, "subfolder": subfolder}, "error": "File not found"})
            continue
        if classify_ext(filename.lower()) != "video":
            continue

        meta_path = metadata_path(str(target))
        if not meta_path:
            errors.append({"file": {"filename": filename, "subfolder": subfolder}, "error": "Sidecar disabled"})
            continue

        meta = load_metadata(str(target)) or {}
        if "rating" not in meta:
            meta["rating"] = 0
        if not isinstance(meta.get("tags"), list):
            meta["tags"] = []
        if prompt is not None:
            meta["prompt"] = prompt
        if workflow is not None:
            meta["workflow"] = workflow
        if workflow is not None or prompt is not None:
            meta["has_workflow"] = bool(workflow or prompt)

        try:
            save_metadata(str(target), meta)
            updated.append({"filename": filename, "subfolder": subfolder})
        except Exception as exc:
            errors.append({"file": {"filename": filename, "subfolder": subfolder}, "error": str(exc)})

    return web.json_response({"ok": True, "updated": updated, "errors": errors})


@PromptServer.instance.routes.post("/mjr/filemanager/sidecar/update")
async def update_sidecar(request: web.Request) -> web.Response:
    """
    Deep-merge arbitrary meta (rating/tags/prompt/workflow/...) into a file sidecar.
    """
    root = _get_output_root()
    try:
        payload = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": "Invalid JSON body"}, status=400)

    filename = payload.get("filename")
    subfolder = payload.get("subfolder", "")
    meta_updates = payload.get("meta")

    if not filename or not isinstance(meta_updates, dict):
        return web.json_response({"ok": False, "error": "Missing filename or invalid meta"}, status=400)

    try:
        target = _safe_target(root, subfolder, filename)
    except ValueError:
        return web.json_response({"ok": False, "error": "File is outside output directory"}, status=400)

    if not target.exists():
        return web.json_response({"ok": False, "error": "File not found"}, status=404)

    meta_path = metadata_path(str(target))
    if not meta_path:
        return web.json_response({"ok": False, "error": "Sidecar disabled"}, status=400)

    try:
        merged = deep_merge_metadata(str(target), meta_updates)
        return web.json_response({"ok": True, "meta": merged})
    except Exception as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=500)


# ---------------------------------------------------------------------------
# Collections endpoints
# ---------------------------------------------------------------------------

@PromptServer.instance.routes.get("/mjr/collections/list")
async def list_collections_route(request: web.Request) -> web.Response:
    names = await asyncio.to_thread(get_collections)
    return web.json_response({"collections": names})


@PromptServer.instance.routes.get("/mjr/collections/{name}")
async def get_collection_route(request: web.Request) -> web.Response:
    name = request.match_info["name"]
    files = await asyncio.to_thread(load_collection, name)
    return web.json_response({"files": files})


@PromptServer.instance.routes.post("/mjr/collections/add")
async def add_to_collection_route(request: web.Request) -> web.Response:
    try:
        data = await request.json()
        await asyncio.to_thread(add_to_collection, data["name"], data["path"])
        return web.json_response({"ok": True})
    except Exception as e:
        return web.json_response({"ok": False, "error": str(e)}, status=500)


@PromptServer.instance.routes.post("/mjr/collections/remove")
async def remove_from_collection_route(request: web.Request) -> web.Response:
    try:
        data = await request.json()
        await asyncio.to_thread(remove_from_collection, data["name"], data["path"])
        return web.json_response({"ok": True})
    except Exception as e:
        return web.json_response({"ok": False, "error": str(e)}, status=500)
