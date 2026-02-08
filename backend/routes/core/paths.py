"""
Path validation and security utilities.
"""
import os
import threading
from pathlib import Path
from typing import Optional
import mimetypes

try:
    import folder_paths  # type: ignore
except Exception:
    class _FolderPathsStub:
        @staticmethod
        def get_input_directory() -> str:
            return str((Path(__file__).resolve().parents[3] / "input").resolve())

        @staticmethod
        def get_output_directory() -> str:
            return str((Path(__file__).resolve().parents[3] / "output").resolve())

    folder_paths = _FolderPathsStub()  # type: ignore

from backend.config import OUTPUT_ROOT
from backend.custom_roots import list_custom_roots
from backend.shared import get_logger
from backend.features.audio import AUDIO_VIEW_MIME_TYPES

logger = get_logger(__name__)

_ALLOWED_DIRECTORIES = None
_ALLOWED_DIRECTORIES_LOCK = threading.Lock()
_ALLOWED_DIRECTORIES_STATE = {"output": None, "input": None}


def _get_allowed_directories():
    """
    Resolve allowed base directories lazily.

    NOTE: ComfyUI can change input/output directories depending on configuration;
    this keeps the allowed list in sync across requests.
    """
    output_root = str(OUTPUT_ROOT)
    input_root = str(folder_paths.get_input_directory())
    global _ALLOWED_DIRECTORIES
    with _ALLOWED_DIRECTORIES_LOCK:
        if (
            _ALLOWED_DIRECTORIES is None
            or _ALLOWED_DIRECTORIES_STATE.get("output") != output_root
            or _ALLOWED_DIRECTORIES_STATE.get("input") != input_root
        ):
            _ALLOWED_DIRECTORIES_STATE["output"] = output_root
            _ALLOWED_DIRECTORIES_STATE["input"] = input_root
            roots = []
            try:
                roots.append(Path(output_root).resolve(strict=False))
            except Exception as exc:
                logger.warning("Failed to resolve output root for allowlist: %s", exc)
            try:
                roots.append(Path(input_root).resolve(strict=False))
            except Exception as exc:
                logger.warning("Failed to resolve input root for allowlist: %s", exc)
            _ALLOWED_DIRECTORIES = roots
        return list(_ALLOWED_DIRECTORIES or [])


def _normalize_path(value: str) -> Optional[Path]:
    if not value:
        return None
    if "\x00" in value:
        return None
    try:
        candidate = Path(value).expanduser()
        # Resolve without requiring file to exist (strict=False) to support directories pending creation
        return candidate.resolve(strict=False)
    except (OSError, ValueError):
        return None


def _is_path_allowed(candidate: Optional[Path], *, must_exist: bool = False) -> bool:
    if not candidate:
        return False

    # Prefer strict resolution when possible (prevents symlink/junction escapes).
    cand_norm = candidate
    try:
        if must_exist:
            cand_norm = cand_norm.resolve(strict=True)
        elif cand_norm.exists():
            cand_norm = cand_norm.resolve(strict=True)
        else:
            cand_norm = cand_norm.resolve(strict=False)
    except (OSError, RuntimeError, ValueError):
        return False

    for root in _get_allowed_directories():
        try:
            root_resolved = root.resolve(strict=True) if root.exists() else root.resolve(strict=False)
        except OSError:
            continue

        try:
            if cand_norm == root_resolved or cand_norm.is_relative_to(root_resolved):
                return True
        except AttributeError:
            # Fallback when is_relative_to is unavailable
            try:
                if os.path.commonpath([str(cand_norm), str(root_resolved)]) == str(root_resolved):
                    return True
            except ValueError:
                continue

    return False


def _is_path_allowed_custom(candidate: Optional[Path]) -> bool:
    """
    Allow paths within any registered custom root.
    """
    if not candidate:
        return False
    custom = list_custom_roots()
    if not custom.ok:
        return False
    for item in custom.data or []:
        root_path = item.get("path") if isinstance(item, dict) else None
        if not root_path:
            continue
        try:
            root = Path(str(root_path)).resolve(strict=False)
        except OSError:
            continue
        if _is_within_root(candidate, root):
            return True
    return False


def _safe_rel_path(value: str) -> Optional[Path]:
    if value is None:
        return Path("")
    raw = str(value).strip()
    if raw == "":
        return Path("")
    if "\x00" in raw:
        return None
    try:
        rel = Path(raw)
    except (OSError, ValueError):
        return None
    if getattr(rel, "drive", ""):
        return None
    if rel.is_absolute():
        return None
    # Disallow traversal
    if any(part == ".." for part in rel.parts):
        return None
    return rel


def _is_within_root(candidate: Path, root: Path) -> bool:
    try:
        # SECURITY: require strict resolution so symlinks are fully resolved.
        # If we cannot resolve a path to a real filesystem location, treat it as unsafe.
        root_resolved = root.resolve(strict=True)
        cand_resolved = candidate.resolve(strict=True)
    except (OSError, RuntimeError, ValueError):
        return False
    try:
        return cand_resolved == root_resolved or cand_resolved.is_relative_to(root_resolved)
    except AttributeError:
        try:
            return os.path.commonpath([str(cand_resolved), str(root_resolved)]) == str(root_resolved)
        except ValueError:
            return False


# -----------------------------------------------------------------------------
# Media validation helpers (viewer hardening)
# -----------------------------------------------------------------------------

_ALLOWED_VIEW_EXTS = {
    # Images
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
    ".bmp",
    ".tif",
    ".tiff",
    ".avif",
    # Videos
    ".mp4",
    ".webm",
    ".mov",
    ".mkv",
    ".avi",
    ".m4v",
    # Audio
    ".wav",
    ".mp3",
    ".flac",
    ".ogg",
    ".aiff",
    ".aif",
    ".m4a",
    ".aac",
}


def _guess_content_type_for_file(path: Path) -> str:
    """
    Best-effort content-type for media serving.

    Note: On Windows, `mimetypes` may not include modern media types (webp/webm/avif)
    depending on registry state. We keep a small explicit mapping for viewer-critical
    formats to ensure browsers can decode them.
    """
    try:
        ext = str(path.suffix or "").lower()
        if ext:
            known = {
                # Images
                ".png": "image/png",
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".gif": "image/gif",
                ".webp": "image/webp",
                ".bmp": "image/bmp",
                ".tif": "image/tiff",
                ".tiff": "image/tiff",
                ".avif": "image/avif",
                # Videos
                ".mp4": "video/mp4",
                ".m4v": "video/x-m4v",
                ".webm": "video/webm",
                ".mov": "video/quicktime",
                ".mkv": "video/x-matroska",
                ".avi": "video/x-msvideo",
            }
            known.update(AUDIO_VIEW_MIME_TYPES)
            if ext in known:
                return known[ext]
    except Exception:
        pass
    try:
        ct, _ = mimetypes.guess_type(str(path))
        if ct:
            return ct
    except Exception:
        pass
    return "application/octet-stream"


def _is_allowed_view_media_file(path: Path) -> bool:
    """
    Restrict what the viewer-serving endpoints can return.

    This reduces the blast radius of custom roots by preventing the UI from
    fetching arbitrary file types through /mjr/am/custom-view.
    """
    try:
        ext = str(path.suffix or "").lower()
        if ext in _ALLOWED_VIEW_EXTS:
            return True
        # Fallback: allow if mimetype is clearly media.
        ct = _guess_content_type_for_file(path)
        return ct.startswith("image/") or ct.startswith("video/") or ct.startswith("audio/")
    except Exception:
        return False
