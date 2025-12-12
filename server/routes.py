import os
import subprocess
import asyncio
import time
import threading
from pathlib import Path
from typing import Any, Dict, List

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
)
from .metadata import update_metadata_with_windows
from .generation_metadata import extract_generation_params_from_png
from .config import OUTPUT_ROOT
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
    try:
        # On Linux/Mac, folder mtime changes when adding/removing a file.
        # On Windows it's less reliable for subfolders, but still helps.
        current_mtime = root_path.stat().st_mtime
        global _LAST_FOLDER_MTIME
        if current_mtime != _LAST_FOLDER_MTIME:
            _LAST_FOLDER_MTIME = current_mtime
            return True
        return False
    except Exception:
        return True


def _get_output_root() -> Path:
    """Use the ComfyUI output folder (respects --output-directory)."""
    return Path(folder_paths.get_output_directory()).resolve()


def _metadata_target(path: Path, kind: str) -> Path:
    """
    For video/audio/3D, try a sibling PNG to retrieve metadata.
    """
    if kind != "image":
        sibling = path.with_suffix(".png")
        if sibling.exists():
            try:
                sibling.relative_to(_get_output_root())
                return sibling
            except ValueError:
                pass
    return path


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
        )
        if res.returncode in (0, 1):
            return True

        res2 = subprocess.run(
            ["explorer.exe", "/select,", str(path)],
            shell=False,
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return res2.returncode in (0, 1)
    except Exception:
        return False


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
                    sys_meta = get_system_metadata(str(meta_target))
                    json_meta = load_metadata(str(meta_target))
                    f["rating"] = sys_meta.get("rating") or json_meta.get("rating", 0)
                    f["tags"] = sys_meta.get("tags") or json_meta.get("tags", [])
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

    def _fetch_batch():
        results: List[Dict[str, Any]] = []
        errors: List[Dict[str, Any]] = []
        for item in items:
            filename = (item or {}).get("filename")
            subfolder = (item or {}).get("subfolder", "")

            if not filename:
                errors.append({"filename": filename, "error": "Missing filename"})
                continue

            target = (root / subfolder / filename).resolve()
            try:
                target.relative_to(root)
            except ValueError:
                continue

            if not target.exists():
                continue

            kind = classify_ext(filename.lower())
            meta_target = _metadata_target(target, kind)
            sys_meta = get_system_metadata(str(meta_target))
            json_meta = load_metadata(str(meta_target))

            results.append(
                {
                    "filename": filename,
                    "subfolder": subfolder,
                    "rating": sys_meta.get("rating") or json_meta.get("rating", 0),
                    "tags": sys_meta.get("tags") or json_meta.get("tags", []),
                }
            )
        return results, errors

    results, errors = await loop.run_in_executor(None, _fetch_batch)
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

        candidate = (root / subfolder / filename).resolve()

        try:
            candidate.relative_to(root)
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
                candidate.unlink()
            deleted.append({"filename": filename, "subfolder": subfolder})
        except Exception as exc:
            errors.append(
                {"filename": filename, "subfolder": subfolder, "error": str(exc)}
            )

    return web.json_response({"ok": True, "deleted": deleted, "errors": errors})


@PromptServer.instance.routes.post("/mjr/filemanager/open_explorer")
async def open_explorer(request: web.Request) -> web.Response:
    root = _get_output_root()
    try:
        payload = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": "Invalid JSON body"}, status=400)

    filename = payload.get("filename")
    subfolder = payload.get("subfolder", "")
    if not filename:
        return web.json_response({"ok": False, "error": "Missing filename"}, status=400)

    target = (root / subfolder / filename).resolve()
    try:
        target.relative_to(root)
    except ValueError:
        return web.json_response({"ok": False, "error": "File is outside output directory"}, status=400)

    if not target.exists():
        return web.json_response({"ok": False, "error": "File not found"}, status=404)

    if _open_in_explorer(target):
        return web.json_response({"ok": True})

    try:
        subprocess.run(
            ["explorer.exe", str(target.parent)],
            shell=False,
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return web.json_response(
            {"ok": True, "warning": "Opened folder (selection may not be highlighted)"},
            status=200,
        )
    except Exception as exc:
        return web.json_response(
            {"ok": False, "error": f"Failed to open explorer: {exc}"},
            status=500,
        )


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

    target = (root / subfolder / filename).resolve()

    kind = classify_ext(filename.lower())

    try:
        target.relative_to(root)
    except ValueError:
        return web.json_response(
            {"ok": False, "error": "File is outside output directory"}, status=400
        )

    if not target.exists():
        return web.json_response(
            {"ok": False, "error": "File not found"}, status=404
        )

    meta_target = _metadata_target(target, kind)
    if kind != "image":
        if not meta_target.exists() or meta_target.suffix.lower() != ".png":
            return web.json_response(
                {"ok": False, "error": "PNG sibling not found for this file"}, status=404
            )

    try:
        params = extract_generation_params_from_png(meta_target)
    except Exception as e:
        return web.json_response(
            {"ok": False, "error": f"metadata parsing failed: {e}"}, status=500
        )

    return web.json_response({"ok": True, "generation": params})


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

    target = (root / subfolder / filename).resolve()
    kind = classify_ext(filename.lower())
    try:
        target.relative_to(root)
    except ValueError:
        return web.json_response(
            {"ok": False, "error": "File is outside output directory"}, status=400
        )

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
        if kind != "image":
            sibling = (target.parent / (target.stem + ".png")).resolve()
            if sibling.exists():
                try:
                    sibling.relative_to(root)
                    update_metadata_with_windows(str(sibling), updates)
                except Exception:
                    pass
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
