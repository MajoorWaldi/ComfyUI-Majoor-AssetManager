"""
Asset management endpoints: ratings, tags, service retry.
"""
from aiohttp import web
import asyncio
import json
import os
import shutil
import subprocess
import sys
import mimetypes
from pathlib import Path

from backend.shared import Result, get_logger, sanitize_error_message
from backend.config import OUTPUT_ROOT, TO_THREAD_TIMEOUT_S
from backend.custom_roots import list_custom_roots, resolve_custom_root

try:
    import folder_paths  # type: ignore
except Exception:  # pragma: no cover
    class _FolderPathsStub:
        @staticmethod
        def get_input_directory() -> str:
            return str((Path(__file__).resolve().parents[3] / "input").resolve())

    folder_paths = _FolderPathsStub()  # type: ignore

from ..core import (
    _json_response,
    _require_services,
    _check_rate_limit,
    _csrf_error,
    _require_operation_enabled,
    _resolve_security_prefs,
    _require_write_access,
    _read_json,
    _build_services,
    get_services_error,
    _normalize_path,
    _is_path_allowed,
    _is_path_allowed_custom,
    _is_within_root,
)

logger = get_logger(__name__)

MAX_TAGS_PER_ASSET = 50
MAX_TAG_LENGTH = 100
MAX_RENAME_LENGTH = 255

_WINDOWS_RESERVED = {
    'CON', 'PRN', 'AUX', 'NUL',
    'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
    'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
}

def _validate_filename(name: str) -> tuple[bool, str]:
    """Validate a filename for safety."""
    if not name or not name.strip():
        return False, "Filename cannot be empty"
    
    name = name.strip()
    
    # Check for path separators
    if "/" in name or "\\" in name:
        return False, "Filename cannot contain path separators"
    
    # Check for null bytes
    if "\x00" in name:
        return False, "Filename cannot contain null bytes"
        
    # Check for control characters
    for char in name:
        if ord(char) < 32:
            return False, "Filename cannot contain control characters"

    # Check for leading/trailing dots or spaces (Windows)
    if name.startswith('.') or name.startswith(' '):
        return False, "Filename cannot start with dot or space"
    if name.endswith('.') or name.endswith(' '):
        return False, "Filename cannot end with dot or space"
            
    # Check for reserved names (Windows)
    base = name.split('.')[0].upper()
    if base in _WINDOWS_RESERVED:
        return False, "Filename uses a reserved Windows name"
        
    return True, ""



def _delete_file_best_effort(path: Path) -> Result[bool]:
    """
    Prefer moving to recycle bin (send2trash) when available, fallback to permanent delete.

    Never raises: returns Result.
    """
    try:
        if not path.exists() or not path.is_file():
            return Result.Ok(True, method="noop")
    except Exception as exc:
        return Result.Err(
            "DELETE_FAILED", sanitize_error_message(exc, "Failed to stat file")
        )

    # Prefer recycle bin when possible.
    try:
        from send2trash import send2trash  # type: ignore

        try:
            send2trash(str(path))
            return Result.Ok(True, method="send2trash")
        except Exception as exc:
            # Fall back to unlink (still acceptable; better than aborting UX).
            try:
                path.unlink(missing_ok=True)
                return Result.Ok(
                    True,
                    method="unlink_fallback",
                    warning=sanitize_error_message(exc, "send2trash failed"),
                )
            except Exception as exc2:
                return Result.Err(
                    "DELETE_FAILED", sanitize_error_message(exc2, "Failed to delete file")
                )
    except Exception:
        # send2trash not available or failed to import.
        try:
            path.unlink(missing_ok=True)
            return Result.Ok(True, method="unlink")
        except Exception as exc:
            return Result.Err(
                "DELETE_FAILED", sanitize_error_message(exc, "Failed to delete file")
            )


def register_asset_routes(routes: web.RouteTableDef) -> None:
    """Register asset CRUD routes (get, delete, rename)."""
    async def _resolve_or_create_asset_id(
        *,
        services: dict,
        filepath: str,
        file_type: str = "",
        root_id: str = "",
    ) -> Result[int]:
        """
        Resolve an asset_id for a file path, indexing it if needed.

        This allows rating/tags persistence even when a file is shown from the filesystem
        (input/custom) before it exists in the DB.
        """
        if not filepath or not isinstance(filepath, str):
            return Result.Err("INVALID_INPUT", "Missing filepath")

        candidate = _normalize_path(filepath)
        if not candidate:
            return Result.Err("INVALID_INPUT", "Invalid filepath")

        if not (_is_path_allowed(candidate) or _is_path_allowed_custom(candidate)):
            return Result.Err("FORBIDDEN", "Path is not within allowed roots")

        try:
            resolved = candidate.resolve(strict=True)
        except Exception:
            return Result.Err("NOT_FOUND", "File does not exist")

        source = str(file_type or "").strip().lower()
        base_dir: Path | None = None
        resolved_root_id: str | None = None

        out_root = Path(OUTPUT_ROOT).resolve(strict=False)
        in_root = Path(folder_paths.get_input_directory()).resolve(strict=False)

        if source in ("output", "outputs", "") and _is_within_root(resolved, out_root):
            source = "output"
            base_dir = out_root
        elif source in ("input", "inputs", "") and _is_within_root(resolved, in_root):
            source = "input"
            base_dir = in_root
        else:
            # Custom roots must be registered; pick a matching root.
            roots_res = list_custom_roots()
            if roots_res.ok:
                for item in roots_res.data or []:
                    if not isinstance(item, dict):
                        continue
                    rid = str(item.get("id") or "")
                    rpath = item.get("path")
                    if not rpath:
                        continue
                    try:
                        rp = Path(str(rpath)).resolve(strict=False)
                    except Exception:
                        continue
                    if _is_within_root(resolved, rp):
                        base_dir = rp
                        resolved_root_id = rid or None
                        source = "custom"
                        break

            # If caller provided a root_id, validate and prefer it when it matches.
            if root_id:
                root_result = resolve_custom_root(str(root_id))
                if root_result.ok:
                    try:
                        rp = Path(str(root_result.data)).resolve(strict=False)
                    except Exception:
                        rp = None
                    if rp and _is_within_root(resolved, rp):
                        base_dir = rp
                        resolved_root_id = str(root_id)
                        source = "custom"

        if not base_dir:
            return Result.Err("INVALID_INPUT", "Unable to infer asset root for filepath")

        # Index the file (best-effort) so it gets a stable asset_id.
        try:
            await asyncio.wait_for(
                services["index"].index_paths(
                    [Path(resolved)],
                    str(base_dir),
                    True,  # incremental
                    source,
                    (resolved_root_id or None),
                ),
                timeout=TO_THREAD_TIMEOUT_S,
            )
        except asyncio.TimeoutError:
            logger.debug("Index-on-demand timed out for %s", filepath)
        except Exception as exc:
            logger.debug("Index-on-demand skipped for %s: %s", filepath, exc)

        try:
            q = await asyncio.wait_for(
                services["db"].aquery(
                    "SELECT id FROM assets WHERE filepath = ?",
                    (str(resolved),),
                ),
                timeout=TO_THREAD_TIMEOUT_S,
            )
            if not q.ok or not q.data:
                return Result.Err("NOT_FOUND", "Asset not indexed")
            asset_id = (q.data[0] or {}).get("id")
            if asset_id is None:
                return Result.Err("NOT_FOUND", "Asset id not available")
            return Result.Ok(int(asset_id))
        except asyncio.TimeoutError:
            return Result.Err("TIMEOUT", "Asset lookup timed out")
        except Exception as exc:
            return Result.Err(
                "DB_ERROR",
                sanitize_error_message(exc, "Failed to resolve asset id"),
            )

    def _get_rating_tags_sync_mode(request: web.Request) -> str:
        try:
            raw = (request.headers.get("X-MJR-RTSYNC") or "").strip().lower()
        except Exception:
            raw = ""
        if raw in ("", "0", "false", "off", "disable", "disabled", "no"):
            return "off"
        if raw in ("1", "true", "on", "enable", "enabled"):
            return "on"
        # Backward compatible values from previous iterations.
        if raw in ("sidecar", "both", "exiftool", "on", "off"):
            return raw
        return "off"

    async def _enqueue_rating_tags_sync(
        request: web.Request,
        services: dict,
        asset_id: int,
    ) -> None:
        mode = _get_rating_tags_sync_mode(request)
        if mode == "off":
            return

        worker = services.get("rating_tags_sync")
        db = services.get("db")
        if not worker or not db:
            return

        try:
            fp_res = await db.aquery("SELECT filepath FROM assets WHERE id = ?", (asset_id,))
            if not fp_res.ok or not fp_res.data:
                return
            filepath = fp_res.data[0].get("filepath")
            if not filepath or not isinstance(filepath, str):
                return
        except Exception:
            return

        rating = 0
        tags = []
        try:
            meta_res = await db.aquery("SELECT rating, tags FROM asset_metadata WHERE asset_id = ?", (asset_id,))
            if meta_res.ok and meta_res.data:
                row = meta_res.data[0] or {}
                rating = int(row.get("rating") or 0)
                raw_tags = row.get("tags")
                if isinstance(raw_tags, str):
                    try:
                        parsed = json.loads(raw_tags)
                    except Exception:
                        parsed = []
                    tags = parsed if isinstance(parsed, list) else []
                elif isinstance(raw_tags, list):
                    tags = raw_tags
        except Exception:
            rating = 0
            tags = []

        try:
            worker.enqueue(filepath, rating, tags, mode)
        except Exception:
            return

    @routes.post("/mjr/am/retry-services")
    async def retry_services(request):
        """
        Retry initializing the services if they previously failed.
        """
        csrf = _csrf_error(request)
        if csrf:
            return _json_response(Result.Err("CSRF", csrf))

        services = await _build_services(force=True)
        if services:
            return _json_response(Result.Ok({"reinitialized": True}))

        error_message = get_services_error() or "Unknown error"
        return _json_response(Result.Err("SERVICE_UNAVAILABLE", f"Failed to initialize services: {error_message}"))

    @routes.post("/mjr/am/asset/rating")
    async def update_asset_rating(request):
        """
        Update asset rating (0-5 stars).

        Body:
          - {"asset_id": int, "rating": int}
          - OR {"filepath": str, "type": "output|input|custom", "root_id"?: str, "rating": int}
        """
        csrf = _csrf_error(request)
        if csrf:
            return _json_response(Result.Err("CSRF", csrf))

        svc, error_result = await _require_services()
        if error_result:
            return _json_response(error_result)

        prefs = await _resolve_security_prefs(svc)
        op = _require_operation_enabled("asset_rating", prefs=prefs)
        if not op.ok:
            return _json_response(op)

        auth = _require_write_access(request)
        if not auth.ok:
            return _json_response(auth)

        allowed, retry_after = _check_rate_limit(request, "asset_rating", max_requests=30, window_seconds=60)
        if not allowed:
            return _json_response(Result.Err("RATE_LIMITED", "Rate limit exceeded. Please wait before retrying.", retry_after=retry_after))

        body_res = await _read_json(request)
        if not body_res.ok:
            return _json_response(body_res)
        body = body_res.data or {}

        asset_id = body.get("asset_id")
        rating = body.get("rating")

        if asset_id is None:
            fp = body.get("filepath") or body.get("path") or ""
            typ = body.get("type") or ""
            rid = body.get("root_id") or body.get("custom_root_id") or ""
            resolved = await _resolve_or_create_asset_id(services=svc, filepath=str(fp), file_type=str(typ), root_id=str(rid))
            if not resolved.ok:
                return _json_response(resolved)
            asset_id = resolved.data
        else:
            try:
                asset_id = int(asset_id)
            except (ValueError, TypeError):
                return _json_response(Result.Err("INVALID_INPUT", "Invalid asset_id"))

        try:
            rating = max(0, min(5, int(rating or 0)))
        except (ValueError, TypeError):
            return _json_response(Result.Err("INVALID_INPUT", "Invalid rating"))

        try:
            result = await svc["index"].update_asset_rating(asset_id, rating)
        except Exception as exc:
            result = Result.Err(
                "UPDATE_FAILED", sanitize_error_message(exc, "Failed to update rating")
            )
        if result.ok:
            await _enqueue_rating_tags_sync(request, svc, asset_id)
        return _json_response(result)

    @routes.post("/mjr/am/asset/tags")
    async def update_asset_tags(request):
        """
        Update asset tags.

        Body:
          - {"asset_id": int, "tags": list[str]}
          - OR {"filepath": str, "type": "output|input|custom", "root_id"?: str, "tags": list[str]}
        """
        csrf = _csrf_error(request)
        if csrf:
            return _json_response(Result.Err("CSRF", csrf))

        svc, error_result = await _require_services()
        if error_result:
            return _json_response(error_result)

        prefs = await _resolve_security_prefs(svc)
        op = _require_operation_enabled("asset_tags", prefs=prefs)
        if not op.ok:
            return _json_response(op)

        auth = _require_write_access(request)
        if not auth.ok:
            return _json_response(auth)

        allowed, retry_after = _check_rate_limit(request, "asset_tags", max_requests=30, window_seconds=60)
        if not allowed:
            return _json_response(Result.Err("RATE_LIMITED", "Rate limit exceeded. Please wait before retrying.", retry_after=retry_after))

        body_res = await _read_json(request)
        if not body_res.ok:
            return _json_response(body_res)
        body = body_res.data or {}

        asset_id = body.get("asset_id")
        tags = body.get("tags")

        if asset_id is None:
            fp = body.get("filepath") or body.get("path") or ""
            typ = body.get("type") or ""
            rid = body.get("root_id") or body.get("custom_root_id") or ""
            resolved = await _resolve_or_create_asset_id(services=svc, filepath=str(fp), file_type=str(typ), root_id=str(rid))
            if not resolved.ok:
                return _json_response(resolved)
            asset_id = resolved.data
        else:
            try:
                asset_id = int(asset_id)
            except (ValueError, TypeError):
                return _json_response(Result.Err("INVALID_INPUT", "Invalid asset_id"))

        if not isinstance(tags, list):
            return _json_response(Result.Err("INVALID_INPUT", "Tags must be a list"))

        if len(tags) > MAX_TAGS_PER_ASSET:
            return _json_response(Result.Err("INVALID_INPUT", f"Too many tags (max {MAX_TAGS_PER_ASSET}, got {len(tags)})"))

        # Validate and sanitize tags
        sanitized_tags = []
        for tag in tags:
            if not isinstance(tag, str):
                continue
            tag = str(tag).strip()
            if not tag or len(tag) > MAX_TAG_LENGTH:
                continue
            tag_lower = tag.lower()
            if any(existing.lower() == tag_lower for existing in sanitized_tags):
                continue
            sanitized_tags.append(tag)
            if len(sanitized_tags) >= MAX_TAGS_PER_ASSET:
                break

        try:
            result = await svc["index"].update_asset_tags(asset_id, sanitized_tags)
        except Exception as exc:
            result = Result.Err(
                "UPDATE_FAILED", sanitize_error_message(exc, "Failed to update tags")
            )
        if result.ok:
            await _enqueue_rating_tags_sync(request, svc, asset_id)
        return _json_response(result)

    @routes.post("/mjr/am/open-in-folder")
    async def open_in_folder(request):
        """
        Open the asset's folder in the OS file manager and (when supported) select the file.

        Body: {"asset_id": int}
        """
        csrf = _csrf_error(request)
        if csrf:
            return _json_response(Result.Err("CSRF", csrf))

        svc, error_result = await _require_services()
        if error_result:
            return _json_response(error_result)

        prefs = await _resolve_security_prefs(svc)
        op = _require_operation_enabled("open_in_folder", prefs=prefs)
        if not op.ok:
            return _json_response(op)

        auth = _require_write_access(request)
        if not auth.ok:
            return _json_response(auth)

        allowed, retry_after = _check_rate_limit(request, "open_in_folder", max_requests=1, window_seconds=2)
        if not allowed:
            return _json_response(Result.Err("RATE_LIMITED", "Rate limit exceeded. Please wait before retrying.", retry_after=retry_after))

        body_res = await _read_json(request)
        if not body_res.ok:
            return _json_response(body_res)
        body = body_res.data or {}

        asset_id = body.get("asset_id")
        if not asset_id:
            return _json_response(Result.Err("INVALID_INPUT", "Missing asset_id"))

        try:
            asset_id = int(asset_id)
        except (ValueError, TypeError):
            return _json_response(Result.Err("INVALID_INPUT", "Invalid asset_id"))

        db = svc.get("db") if isinstance(svc, dict) else None
        if not db:
            return _json_response(Result.Err("SERVICE_UNAVAILABLE", "Database service unavailable"))

        try:
            res = await db.aquery("SELECT filepath FROM assets WHERE id = ?", (asset_id,))
            if not res.ok or not res.data:
                return _json_response(Result.Err("NOT_FOUND", "Asset not found"))
            raw_path = (res.data[0] or {}).get("filepath")
        except Exception as exc:
            return _json_response(
                Result.Err("DB_ERROR", sanitize_error_message(exc, "Failed to load asset"))
            )

        if not raw_path or not isinstance(raw_path, str):
            return _json_response(Result.Err("NOT_FOUND", "Asset path not available"))

        candidate = _normalize_path(raw_path)
        if not candidate:
            return _json_response(Result.Err("INVALID_INPUT", "Invalid asset path"))

        allowed = _is_path_allowed(candidate) or _is_path_allowed_custom(candidate)
        if not allowed:
            return _json_response(Result.Err("FORBIDDEN", "Path is not within allowed roots"))

        try:
            # Require strict resolution to avoid following symlinks outside allowed roots.
            resolved = candidate.resolve(strict=True)
        except Exception:
            return _json_response(Result.Err("NOT_FOUND", "File does not exist"))

        def _execute_command(command: list[str]) -> None:
            if not shutil.which(command[0]):
                raise FileNotFoundError(command[0])
            subprocess.Popen(
                command,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                shell=False,
            )

        commands: list[list[str]] = []
        fallback_command: list[str] | None = None

        if sys.platform == "darwin":
            commands.append(["open", "-R", str(resolved)])
            fallback_command = ["open", str(resolved.parent)]
            selected = True
        elif os.name == "nt":
            commands.append(["explorer.exe", f"/select,{str(resolved)}"])
            selected = True
        else:
            commands.append(["xdg-open", str(resolved.parent)])
            selected = False

        last_exception: Exception | None = None

        for cmd in commands:
            try:
                _execute_command(cmd)
                payload = {"opened": True, "selected": selected}
                if cmd[0] == "xdg-open":
                    payload["fallback"] = "xdg-open"
                return _json_response(Result.Ok(payload))
            except Exception as exc:
                last_exception = exc

        if fallback_command:
            try:
                _execute_command(fallback_command)
                return _json_response(
                    Result.Ok(
                        {"opened": True, "selected": False, "fallback": "open"}
                    )
                )
            except Exception as exc:
                last_exception = exc

        if os.name == "nt":
            try:
                os.startfile(str(resolved.parent))
                return _json_response(
                    Result.Ok(
                        {"opened": True, "selected": False, "fallback": "startfile"}
                    )
                )
            except Exception as exc:
                last_exception = exc

        return _json_response(
            Result.Err(
                "DEGRADED",
                sanitize_error_message(
                    last_exception or ValueError("Failed to open folder"),
                    "Failed to open folder",
                ),
            )
        )

    @routes.get("/mjr/am/tags")
    async def get_all_tags(request):
        """
        Get all unique tags from the database for autocomplete.

        Returns: {"ok": true, "data": ["tag1", "tag2", ...]}
        """
        svc, error_result = await _require_services()
        if error_result:
            return _json_response(error_result)

        try:
            result = await svc["index"].get_all_tags()
        except Exception as exc:
            result = Result.Err(
                "DB_ERROR", sanitize_error_message(exc, "Failed to load tags")
            )
        return _json_response(result)

    @routes.get("/mjr/am/routes")
    async def list_routes(request):
        """List all available API routes."""
        routes_info = [
            {"method": "GET", "path": "/mjr/am/health", "description": "Get health status"},
            {"method": "GET", "path": "/mjr/am/health/counters", "description": "Get database counters"},
            {"method": "GET", "path": "/mjr/am/health/db", "description": "Get DB lock/corruption/recovery diagnostics"},
            {"method": "GET", "path": "/mjr/am/config", "description": "Get configuration"},
            {"method": "GET", "path": "/mjr/am/roots", "description": "Get core and custom roots"},
            {"method": "GET", "path": "/mjr/am/custom-roots", "description": "List custom roots"},
            {"method": "POST", "path": "/mjr/am/custom-roots", "description": "Add custom root"},
            {"method": "POST", "path": "/mjr/am/custom-roots/remove", "description": "Remove custom root"},
            {"method": "GET", "path": "/mjr/am/custom-view", "description": "Serve file from custom root"},
            {"method": "GET", "path": "/mjr/am/list", "description": "List assets (scoped)"},
            {"method": "POST", "path": "/mjr/am/scan", "description": "Scan a directory for assets"},
            {"method": "POST", "path": "/mjr/am/index-files", "description": "Index specific files"},
            {"method": "GET", "path": "/mjr/am/search", "description": "Search assets using FTS5"},
            {"method": "POST", "path": "/mjr/am/assets/batch", "description": "Batch fetch assets by ID"},
            {"method": "GET", "path": "/mjr/am/metadata", "description": "Get metadata for a file"},
            {"method": "POST", "path": "/mjr/am/stage-to-input", "description": "Copy files to input directory"},
            {"method": "GET", "path": "/mjr/am/asset/{asset_id}", "description": "Get single asset by ID"},
            {"method": "POST", "path": "/mjr/am/asset/rating", "description": "Update asset rating (0-5 stars)"},
            {"method": "POST", "path": "/mjr/am/asset/tags", "description": "Update asset tags"},
            {"method": "POST", "path": "/mjr/am/open-in-folder", "description": "Open asset in OS file manager"},
            {"method": "GET", "path": "/mjr/am/tags", "description": "Get all unique tags for autocomplete"},
            {"method": "POST", "path": "/mjr/am/retry-services", "description": "Retry service initialization"},
            {"method": "GET", "path": "/mjr/am/routes", "description": "List all available routes (this endpoint)"},
        ]
        return _json_response(Result.Ok({"routes": routes_info}))

    @routes.post("/mjr/am/asset/delete")
    async def delete_asset(request):
        """
        Delete a single asset file and its database record.

        Body: {"asset_id": int}
        """
        csrf = _csrf_error(request)
        if csrf:
            return _json_response(Result.Err("CSRF", csrf))

        svc, error_result = await _require_services()
        if error_result:
            return _json_response(error_result)

        prefs = await _resolve_security_prefs(svc)
        op = _require_operation_enabled("asset_delete", prefs=prefs)
        if not op.ok:
            return _json_response(op)

        auth = _require_write_access(request)
        if not auth.ok:
            return _json_response(auth)

        allowed, retry_after = _check_rate_limit(request, "asset_delete", max_requests=20, window_seconds=60)
        if not allowed:
            return _json_response(Result.Err("RATE_LIMITED", "Rate limit exceeded. Please wait before retrying.", retry_after=retry_after))

        body_res = await _read_json(request)
        if not body_res.ok:
            return _json_response(body_res)
        body = body_res.data or {}

        asset_id = body.get("asset_id")
        if not asset_id:
            return _json_response(Result.Err("INVALID_INPUT", "Missing asset_id"))

        try:
            asset_id = int(asset_id)
        except (ValueError, TypeError):
            return _json_response(Result.Err("INVALID_INPUT", "Invalid asset_id"))

        # Get file path from database
        try:
            res = await svc["db"].aquery("SELECT filepath FROM assets WHERE id = ?", (asset_id,))
            if not res.ok or not res.data:
                return _json_response(Result.Err("NOT_FOUND", "Asset not found"))
            raw_path = (res.data[0] or {}).get("filepath")
        except Exception as exc:
            return _json_response(
                Result.Err("DB_ERROR", sanitize_error_message(exc, "Failed to load asset"))
            )

        if not raw_path or not isinstance(raw_path, str):
            return _json_response(Result.Err("NOT_FOUND", "Asset path not available"))

        candidate = _normalize_path(raw_path)
        if not candidate:
            return _json_response(Result.Err("INVALID_INPUT", "Invalid asset path"))

        allowed = _is_path_allowed(candidate) or _is_path_allowed_custom(candidate)
        if not allowed:
            return _json_response(Result.Err("FORBIDDEN", "Path is not within allowed roots"))

        try:
            # Require strict resolution to avoid following symlinks outside allowed roots.
            resolved = candidate.resolve(strict=True)
        except Exception:
            return _json_response(Result.Err("NOT_FOUND", "File does not exist"))

        file_deletion_error = None
        if resolved.exists() and resolved.is_file():
            try:
                del_res = _delete_file_best_effort(resolved)
                if not del_res.ok:
                    file_deletion_error = sanitize_error_message(
                        del_res.error or "delete failed", "File deletion failed"
                    )
            except Exception as exc:
                file_deletion_error = sanitize_error_message(exc, "File deletion failed")

        if file_deletion_error:
            return _json_response(Result.Err(
                "DELETE_FAILED",
                "Failed to delete file",
                errors=[{"asset_id": asset_id, "error": file_deletion_error}],
                aborted=True
            ))

        async def _db_delete_one() -> Result:
            async with svc["db"].atransaction(mode="immediate"):
                del_res = await svc["db"].aexecute("DELETE FROM assets WHERE id = ?", (asset_id,))
                if not del_res.ok:
                    return Result.Err("DB_ERROR", str(del_res.error or "DB delete failed"))

                await svc["db"].aexecute("DELETE FROM scan_journal WHERE filepath = ?", (str(resolved),))
                await svc["db"].aexecute("DELETE FROM metadata_cache WHERE filepath = ?", (str(resolved),))
            return Result.Ok({"deleted": 1})

        try:
            db_res = await _db_delete_one()
            return _json_response(db_res)
        except Exception as exc:
            logger.error("Database deletion failed: %s", exc)
            return _json_response(
                Result.Err(
                    "DB_ERROR",
                    sanitize_error_message(exc, "Failed to delete asset record"),
                )
            )

    @routes.post("/mjr/am/asset/rename")
    async def rename_asset(request):
        """
        Rename an asset file and update its database record.

        Body: {"asset_id": int, "new_name": str}
        """
        csrf = _csrf_error(request)
        if csrf:
            return _json_response(Result.Err("CSRF", csrf))

        svc, error_result = await _require_services()
        if error_result:
            return _json_response(error_result)

        prefs = await _resolve_security_prefs(svc)
        op = _require_operation_enabled("asset_rename", prefs=prefs)
        if not op.ok:
            return _json_response(op)

        auth = _require_write_access(request)
        if not auth.ok:
            return _json_response(auth)

        body_res = await _read_json(request)
        if not body_res.ok:
            return _json_response(body_res)
        body = body_res.data or {}

        asset_id = body.get("asset_id")
        new_name = body.get("new_name")

        if not asset_id:
            return _json_response(Result.Err("INVALID_INPUT", "Missing asset_id"))
        if not new_name:
            return _json_response(Result.Err("INVALID_INPUT", "Missing new_name"))

        try:
            asset_id = int(asset_id)
        except (ValueError, TypeError):
            return _json_response(Result.Err("INVALID_INPUT", "Invalid asset_id"))

        # Sanitize and validate new_name
        new_name = str(new_name).strip()
        valid, msg = _validate_filename(new_name)
        if not valid:
            return _json_response(Result.Err("INVALID_INPUT", msg))

        if len(new_name) > MAX_RENAME_LENGTH:
            return _json_response(Result.Err("INVALID_INPUT", f"New name is too long (max {MAX_RENAME_LENGTH} chars)"))

        # Get current asset info from database
        try:
            res = await svc["db"].aquery("SELECT filepath, filename FROM assets WHERE id = ?", (asset_id,))
            if not res.ok or not res.data:
                return _json_response(Result.Err("NOT_FOUND", "Asset not found"))
            row = res.data[0] or {}
            current_filepath = row.get("filepath")
            current_filename = row.get("filename")
        except Exception as exc:
            return _json_response(
                Result.Err("DB_ERROR", sanitize_error_message(exc, "Failed to load asset"))
            )

        if not current_filepath or not isinstance(current_filepath, str):
            return _json_response(Result.Err("NOT_FOUND", "Asset path not available"))

        current_path = _normalize_path(current_filepath)
        if not current_path:
            return _json_response(Result.Err("INVALID_INPUT", "Invalid current asset path"))

        allowed = _is_path_allowed(current_path) or _is_path_allowed_custom(current_path)
        if not allowed:
            return _json_response(Result.Err("FORBIDDEN", "Current path is not within allowed roots"))

        try:
            # Require strict resolution to avoid following symlinks outside allowed roots.
            current_resolved = current_path.resolve(strict=True)
        except Exception:
            return _json_response(Result.Err("NOT_FOUND", "Current file does not exist"))

        if not current_resolved.exists() or not current_resolved.is_file():
            return _json_response(Result.Err("NOT_FOUND", "Current file does not exist"))

        # Determine the new file path
        new_path = current_resolved.parent / new_name

        # Check if new name already exists
        if new_path.exists():
            return _json_response(Result.Err("CONFLICT", f"File '{new_name}' already exists"))

        # Perform the rename
        try:
            current_resolved.rename(new_path)
        except Exception as exc:
            return _json_response(
                Result.Err(
                    "RENAME_FAILED",
                    sanitize_error_message(exc, "Failed to rename file"),
                )
            )

        # Update database record
        try:
            # Update assets table
            try:
                mtime = int(new_path.stat().st_mtime)
            except FileNotFoundError:
                return _json_response(Result.Err("NOT_FOUND", "Renamed file does not exist"))
            except Exception as exc:
                return _json_response(
                    Result.Err(
                        "FS_ERROR",
                        sanitize_error_message(exc, "Failed to stat renamed file"),
                    )
                )
            update_res = await svc["db"].aexecute(
                "UPDATE assets SET filename = ?, filepath = ?, mtime = ? WHERE id = ?",
                (new_name, str(new_path), mtime, asset_id)
            )
            if not update_res.ok:
                return _json_response(update_res)

            # Update related tables - clean old cache entries
            await svc["db"].aexecute("DELETE FROM scan_journal WHERE filepath = ?", (str(current_path),))
            await svc["db"].aexecute("DELETE FROM metadata_cache WHERE filepath = ?", (str(current_path),))
        except Exception as exc:
            return _json_response(
                Result.Err(
                    "DB_ERROR",
                    sanitize_error_message(exc, "Failed to update asset record"),
                )
            )

        return _json_response(Result.Ok({
            "renamed": 1,
            "old_name": current_filename,
            "new_name": new_name,
            "old_path": str(current_path),
            "new_path": str(new_path)
        }))

    @routes.post("/mjr/am/assets/delete")
    async def delete_assets(request):
        """
        Delete multiple assets by ID.

        Body: {"ids": [int, int, ...]}
        """
        csrf = _csrf_error(request)
        if csrf:
            return _json_response(Result.Err("CSRF", csrf))

        svc, error_result = await _require_services()
        if error_result:
            return _json_response(error_result)

        prefs = await _resolve_security_prefs(svc)
        op = _require_operation_enabled("assets_delete", prefs=prefs)
        if not op.ok:
            return _json_response(op)

        auth = _require_write_access(request)
        if not auth.ok:
            return _json_response(auth)

        allowed, retry_after = _check_rate_limit(request, "assets_delete", max_requests=10, window_seconds=60)
        if not allowed:
            return _json_response(Result.Err("RATE_LIMITED", "Rate limit exceeded. Please wait before retrying.", retry_after=retry_after))

        body_res = await _read_json(request)
        if not body_res.ok:
            return _json_response(body_res)
        body = body_res.data or {}

        asset_ids = body.get("ids")
        if not asset_ids or not isinstance(asset_ids, list):
            return _json_response(Result.Err("INVALID_INPUT", "Missing or invalid 'ids' array"))

        # Validate all IDs are integers
        validated_ids = []
        for aid in asset_ids:
            try:
                validated_ids.append(int(aid))
            except (ValueError, TypeError):
                return _json_response(Result.Err("INVALID_INPUT", f"Invalid asset_id: {aid}"))

        if not validated_ids:
            return _json_response(Result.Err("INVALID_INPUT", "No valid asset IDs provided"))

        # PHASE 1: Validate all assets exist
        try:
            res = await svc["db"].aquery_in(
                "SELECT id, filepath FROM assets WHERE {IN_CLAUSE}",
                "id",
                validated_ids,
            )
            if not res.ok:
                return _json_response(res)

            found_assets = res.data or []
            found_ids = {row["id"] for row in found_assets if isinstance(row, dict) and "id" in row}
            missing_ids = set(validated_ids) - found_ids
            if missing_ids:
                return _json_response(Result.Err("NOT_FOUND", f"Assets not found: {sorted(missing_ids)}"))
        except Exception as exc:
            return _json_response(
                Result.Err(
                    "DB_ERROR",
                    sanitize_error_message(exc, "Failed to validate assets"),
                )
            )

        # PHASE 2: Validate and resolve file paths
        validated_assets = []
        for asset_row in found_assets:
            asset_id = asset_row.get("id")
            raw_path = asset_row.get("filepath")

            if asset_id is None:
                return _json_response(Result.Err("DB_ERROR", "Missing asset id in DB row"))
            if not raw_path or not isinstance(raw_path, str):
                return _json_response(Result.Err("INVALID_INPUT", f"Invalid path for asset ID {asset_id}"))

            candidate = _normalize_path(raw_path)
            if not candidate:
                return _json_response(Result.Err("INVALID_INPUT", f"Invalid asset path for ID {asset_id}"))

            allowed_path = _is_path_allowed(candidate) or _is_path_allowed_custom(candidate)
            if not allowed_path:
                return _json_response(Result.Err("FORBIDDEN", f"Path for asset ID {asset_id} is not within allowed roots"))

            try:
                resolved = candidate.resolve(strict=True)
            except Exception:
                resolved = None

            validated_assets.append({"id": int(asset_id), "filepath": str(raw_path), "resolved": resolved})

        validated_assets.sort(key=lambda x: x["id"])

        # PHASE 3: Delete files first; abort DB deletion if any file deletion fails.
        file_deletion_errors = []
        for asset_info in validated_assets:
            resolved = asset_info["resolved"]
            if resolved and resolved.exists() and resolved.is_file():
                try:
                    del_res = _delete_file_best_effort(resolved)
                    if not del_res.ok:
                        file_deletion_errors.append({"asset_id": asset_info["id"], "error": str(del_res.error or "delete failed")})
                        break
                except Exception as exc:
                    file_deletion_errors.append(
                        {
                            "asset_id": asset_info["id"],
                            "error": sanitize_error_message(exc, "File deletion failed"),
                        }
                    )
                    break

        if file_deletion_errors:
            return _json_response(Result.Err("DELETE_FAILED", "Failed to delete files", errors=file_deletion_errors, aborted=True))

        # PHASE 4: Delete database rows in a single transaction
        async def _db_delete_many() -> Result:
            async with svc["db"].atransaction(mode="immediate"):
                deleted_count = 0
                for asset_info in validated_assets:
                    aid = asset_info["id"]
                    filepath = asset_info["filepath"]

                    del_res = await svc["db"].aexecute("DELETE FROM assets WHERE id = ?", (aid,))
                    if not del_res.ok:
                        return Result.Err("DB_ERROR", f"Failed to delete asset ID {aid}: {del_res.error}")

                    await svc["db"].aexecute("DELETE FROM scan_journal WHERE filepath = ?", (filepath,))
                    await svc["db"].aexecute("DELETE FROM metadata_cache WHERE filepath = ?", (filepath,))
                    deleted_count += 1
            return Result.Ok({"deleted": deleted_count})

        try:
            db_res = await _db_delete_many()
            return _json_response(db_res)
        except Exception as exc:
            logger.error("Database deletion failed: %s", exc)
            return _json_response(
                Result.Err(
                    "DB_ERROR",
                    sanitize_error_message(exc, "Failed to delete asset records"),
                )
            )

    @routes.post("/mjr/am/assets/rename")
    async def rename_asset_endpoint(request):
        """
        Rename a single asset file and update its database record.
        This endpoint is aliased to match the client function name.

        Body: {"asset_id": int, "new_name": str}
        """
        # This is an alias for the existing rename_asset function
        return await rename_asset(request)


async def download_asset(request: web.Request) -> web.StreamResponse:
    """
    Download an asset file by filepath.

    Query param: filepath (absolute path, must be within allowed roots)
    """
    # Rate limiting
    allowed, retry_after = _check_rate_limit(request, "download_asset", max_requests=30, window_seconds=60)
    if not allowed:
        return web.Response(status=429, text=f"Rate limit exceeded. Retry after {retry_after}s")

    filepath = request.query.get("filepath")
    if not filepath:
        return web.Response(status=400, text="Missing 'filepath' parameter")

    # Normalize and validate path
    candidate = _normalize_path(filepath)
    if not candidate:
        return web.Response(status=400, text="Invalid filepath")

    # Check path is within allowed roots
    if not (_is_path_allowed(candidate) or _is_path_allowed_custom(candidate)):
        return web.Response(status=403, text="Path not within allowed directories")

    # Strict resolution to prevent symlink escapes
    try:
        resolved = candidate.resolve(strict=True)
    except (OSError, RuntimeError, ValueError):
        return web.Response(status=404, text="File not found")

    if not resolved.is_file():
        return web.Response(status=404, text="File not found")

    # Re-validate after resolution (symlink could escape)
    if not (_is_path_allowed(resolved) or _is_path_allowed_custom(resolved)):
        return web.Response(status=403, text="Path escapes allowed directories")

    # Determine content type
    mime_type, _ = mimetypes.guess_type(str(resolved))
    if mime_type is None:
        mime_type = "application/octet-stream"

    # Sanitize filename for Content-Disposition header
    filename = resolved.name.replace('"', '').replace('\r', '').replace('\n', '')[:255]

    response = web.StreamResponse()
    response.headers["Content-Type"] = mime_type
    response.headers["Content-Disposition"] = f'attachment; filename="{filename}"'

    try:
        await response.prepare(request)
        with open(resolved, "rb") as f:
            while True:
                chunk = f.read(8192)
                if not chunk:
                    break
                await response.write(chunk)
    except Exception as e:
        logger.error(f"Error streaming file {filepath}: {e}")
        # Cannot return a new response after prepare()
        return response

    return response


def register_download_routes(routes: web.RouteTableDef):
    routes.get("/mjr/am/download")(download_asset)
