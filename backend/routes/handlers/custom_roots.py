"""
Custom roots management endpoints.
"""
import os
import errno
from pathlib import Path
from aiohttp import web
from backend.custom_roots import (
    add_custom_root,
    list_custom_roots,
    remove_custom_root,
    resolve_custom_root,
)
from backend.shared import Result, get_logger, sanitize_error_message
from ..core import (
    _json_response,
    _csrf_error,
    _safe_rel_path,
    _is_within_root,
    _read_json,
    _guess_content_type_for_file,
    _is_allowed_view_media_file,
    _require_services,
)
from ..core.security import _check_rate_limit
from .filesystem import _kickoff_background_scan

# Import tkinter only when needed to avoid startup issues
tk = None
filedialog = None
try:
    import tkinter as tk_module
    from tkinter import filedialog as fd_module
    tk = tk_module
    filedialog = fd_module
except ImportError:
    pass  # tkinter not available, native browser will not work

logger = get_logger(__name__)


def register_custom_roots_routes(routes: web.RouteTableDef) -> None:
    """Register custom root directory routes."""

    @routes.post("/mjr/sys/browse-folder")
    async def browse_folder_dialog(request):
        import os

        allowed, retry_after = _check_rate_limit(request, "browse_folder", max_requests=3, window_seconds=30)
        if not allowed:
            return _json_response(Result.Err("RATE_LIMIT", "Too many browse requests", retry_after=retry_after))

        # Check if tkinter is available
        if tk is None or filedialog is None:
            logger.error("Tkinter is not available in this environment")
            return _json_response(Result.Err("TKINTER_UNAVAILABLE", "Tkinter is not available"))

        # Check if we're in a headless environment (no display)
        if os.getenv('DISPLAY') is None and os.name == 'posix':
            # On Linux systems without a display, tkinter won't work
            logger.info("Running in headless environment, skipping tkinter dialog")
            return _json_response(Result.Err("HEADLESS_ENV", "No display available for folder browser"))

        # Check if tkinter is working properly
        try:
            # For tkinter to work properly in some environments, we may need to ensure it runs in main thread
            def run_tkinter():
                # Initialize tkinter in a way that works better with web servers
                root = tk.Tk()
                root.withdraw()  # Hide the main window
                root.attributes('-topmost', True)  # Bring window to front

                # Open the selector
                directory = filedialog.askdirectory(title="Select Folder for Majoor Assets")

                root.destroy()  # Close the Tkinter instance
                return directory

            # Run tkinter in the current thread (for web server compatibility)
            directory = run_tkinter()

            if directory:
                return _json_response(Result.Ok({"path": directory}))
            else:
                return _json_response(Result.Err("CANCELLED", "Selection cancelled"))
        except Exception as e:
            logger.error(f"Tkinter browse dialog failed: {e}")
            # Return an error that the frontend can handle
            return _json_response(Result.Err("TKINTER_ERROR", f"Browse dialog failed: {str(e)}"))

    @routes.get("/mjr/am/custom-roots")
    async def get_custom_roots(request):
        result = list_custom_roots()
        return _json_response(result)

    @routes.post("/mjr/am/custom-roots")
    async def post_custom_roots(request):
        csrf = _csrf_error(request)
        if csrf:
            return _json_response(Result.Err("CSRF", csrf))

        body_res = await _read_json(request)
        if not body_res.ok:
            return _json_response(body_res)
        body = body_res.data or {}

        path = body.get("path") or body.get("directory") or body.get("root")
        label = body.get("label")
        result = add_custom_root(str(path or ""), label=str(label) if label is not None else None)
        if result.ok and isinstance(result.data, dict):
            root_path = str(result.data.get("path") or "")
            root_id = str(result.data.get("id") or "")
            # Add to watcher if available
            try:
                svc, _ = await _require_services()
                watcher = svc.get("watcher") if svc else None
                if watcher and root_path:
                    watcher.add_path(root_path, source="custom", root_id=root_id)
            except Exception:
                pass
            # Trigger background scan
            try:
                if root_path and root_id:
                    await _kickoff_background_scan(root_path, source="custom", root_id=root_id, recursive=True, incremental=True)
            except Exception as exc:
                logger.debug("Background scan kickoff skipped: %s", exc)
        return _json_response(result)

    @routes.post("/mjr/am/custom-roots/remove")
    async def post_custom_roots_remove(request):
        csrf = _csrf_error(request)
        if csrf:
            return _json_response(Result.Err("CSRF", csrf))

        body_res = await _read_json(request)
        if not body_res.ok:
            return _json_response(body_res)
        body = body_res.data or {}

        rid = body.get("id") or body.get("root_id")
        root_path = None
        try:
            resolved = resolve_custom_root(str(rid or ""))
            if resolved.ok:
                root_path = resolved.data
        except Exception:
            root_path = None

        result = remove_custom_root(str(rid or ""))
        if result.ok and root_path:
            try:
                svc, _ = await _require_services()
                if svc:
                    # Remove from watcher
                    watcher = svc.get("watcher")
                    if watcher:
                        watcher.remove_path(str(root_path))
                    # Clean up database
                    db = svc.get("db")
                    if db:
                        await db.aexecute(
                            "DELETE FROM assets WHERE source = 'custom' AND root_id = ?",
                            (str(rid or ""),),
                        )
            except Exception:
                pass
        return _json_response(result)

    @routes.get("/mjr/am/custom-view")
    async def custom_view(request):
        """
        Serve a file from a registered custom root.

        Query params:
          root_id: custom root id
          filename: file name
          subfolder: optional subfolder under the root
        """
        root_id = request.query.get("root_id", "").strip()
        filename = request.query.get("filename", "").strip()
        subfolder = request.query.get("subfolder", "").strip()

        if not root_id or not filename:
            return _json_response(Result.Err("INVALID_INPUT", "Missing root_id or filename"))

        root_result = resolve_custom_root(root_id)
        if not root_result.ok:
            return _json_response(root_result)

        root_dir = root_result.data
        rel = _safe_rel_path(subfolder)
        if rel is None:
            return _json_response(Result.Err("INVALID_INPUT", "Invalid subfolder"))

        # Ensure filename is a basename (no traversal)
        if Path(filename).name != filename:
            return _json_response(Result.Err("INVALID_INPUT", "Invalid filename"))

        candidate = (root_dir / rel / filename)

        # SECURITY: Validate path is within root before any file operations
        if not _is_within_root(candidate, root_dir):
            return _json_response(Result.Err("INVALID_INPUT", "Path outside root"))

        def _validate_no_symlink_open(path: Path) -> bool:
            try:
                flags = os.O_RDONLY
                if os.name == "nt" and hasattr(os, "O_BINARY"):
                    flags |= os.O_BINARY
                # Best-effort: disallow following symlinks where supported.
                if hasattr(os, "O_NOFOLLOW"):
                    flags |= os.O_NOFOLLOW
                fd = os.open(str(path), flags)
                os.close(fd)
                return True
            except OSError as exc:
                if getattr(exc, "errno", None) in (errno.ELOOP, errno.EACCES, errno.EPERM):
                    return False
                return False
            except Exception:
                return False

        try:
            resolved_path = candidate.resolve(strict=True)
            # Prevent symlink/junction escapes: ensure the resolved target is still under the root.
            if not _is_within_root(resolved_path, root_dir):
                return _json_response(Result.Err("FORBIDDEN", "Path escapes root"))
            if not resolved_path.is_file():
                return _json_response(Result.Err("NOT_FOUND", "File not found or not a regular file"))
            if not _validate_no_symlink_open(resolved_path):
                return _json_response(Result.Err("FORBIDDEN", "Symlinked file not allowed"))

            # Viewer hardening: only serve image/video media files from custom roots.
            if not _is_allowed_view_media_file(resolved_path):
                return _json_response(Result.Err("UNSUPPORTED", "Unsupported file type for viewer"))

            content_type = _guess_content_type_for_file(resolved_path)
            resp = web.FileResponse(path=str(resolved_path))
            try:
                resp.headers["Content-Type"] = content_type
                resp.headers["Cache-Control"] = "no-cache"
                resp.headers["X-Content-Type-Options"] = "nosniff"
                resp.headers["Content-Security-Policy"] = "default-src 'none'"
                resp.headers["X-Frame-Options"] = "DENY"
            except Exception:
                pass
            return resp
        except FileNotFoundError:
            return _json_response(Result.Err("NOT_FOUND", "File not found"))
        except (OSError, RuntimeError, ValueError) as exc:
            return _json_response(
                Result.Err("VIEW_FAILED", sanitize_error_message(exc, "Failed to serve file"))
            )
