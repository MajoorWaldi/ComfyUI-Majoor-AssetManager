import json
import os
import sys
import re
import shutil
import subprocess
import time
import unicodedata
import threading
from collections import OrderedDict
from typing import Dict, List, Optional
from .config import ENABLE_JSON_SIDECAR, METADATA_EXT, IS_WINDOWS
from .logger import get_logger

log = get_logger(__name__)

# Supported extensions
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
VIDEO_EXTS = {".mp4", ".mov", ".webm", ".mkv"}
AUDIO_EXTS = {".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac"}
MODEL3D_EXTS = {".obj", ".fbx", ".glb", ".gltf", ".stl"}
WINDOWS_RATING_INDEX = 14  # fallback
WINDOWS_TAGS_INDEX = 21    # fallback
STAR_CHARS = ("\u2605", "\u2606", "\u22c6", "\u272d", "\u272e", "\u2730")
RATING_KEYS = (
    "rating",
    "note",
    "notation",
    "evaluation",
    "evaluations",
    "etoile",
    "etoiles",
    "star",
    "stars",
)
TAG_KEYS = (
    "tag",
    "mot-cle",
    "mot cle",
    "mots cle",
    "keywords",
    "keyword",
    "category",
    "categories",
    "categorie",
    "catégorie",
    "catégories",
)

_WIN32COM: Optional[object] = None
_WIN32COM_CHECKED = False
_CACHED_RATING_INDEX: Optional[int] = None
_CACHED_TAGS_INDEX: Optional[int] = None
_EXIFTOOL_PATH: Optional[str] = None
_EXIFTOOL_CHECKED = False

# LRU cache for metadata (prevents unbounded memory growth)
# Max size configurable via MJR_META_CACHE_SIZE env var (default: 1000 entries)
try:
    _META_CACHE_MAX_SIZE = int(os.environ.get("MJR_META_CACHE_SIZE", "1000"))
    if _META_CACHE_MAX_SIZE <= 0:
        _META_CACHE_MAX_SIZE = 1000
except (ValueError, TypeError) as e:
    log.warning("📁⚠️ [Majoor] Invalid MJR_META_CACHE_SIZE, using default: %s", e)
    _META_CACHE_MAX_SIZE = 1000

_META_CACHE: OrderedDict[str, tuple[Optional[float], int, dict]] = OrderedDict()
_CACHE_EPOCH = 0
_CACHE_LOCK = threading.Lock()


def _get_cache_epoch() -> int:
    with _CACHE_LOCK:
        return _CACHE_EPOCH


def _next_cache_epoch() -> int:
    global _CACHE_EPOCH
    with _CACHE_LOCK:
        _CACHE_EPOCH += 1
        return _CACHE_EPOCH


def _bump_cache_epoch_if(expected: int) -> int:
    global _CACHE_EPOCH
    with _CACHE_LOCK:
        if _CACHE_EPOCH == expected:
            _CACHE_EPOCH += 1
        return _CACHE_EPOCH


def _cache_get(file_path: str, mtime: Optional[float], epoch: int) -> Optional[tuple[Optional[dict], int]]:
    """
    FIX: Return both cached data and the epoch it was cached at to detect invalidation.
    Returns (data_dict, cache_epoch) if valid, or (None, current_epoch) if invalid.
    """
    with _CACHE_LOCK:
        current_epoch = _CACHE_EPOCH
        cached = _META_CACHE.get(file_path)
        if cached and cached[0] == mtime and cached[1] == current_epoch:
            return (dict(cached[2]), current_epoch)
    return (None, current_epoch)


def _cache_set(file_path: str, mtime: Optional[float], epoch: int, meta: dict) -> None:
    """
    Add or update an entry in the LRU metadata cache with automatic eviction.
    """
    with _CACHE_LOCK:
        # Move to end if already exists (LRU update)
        if file_path in _META_CACHE:
            _META_CACHE.move_to_end(file_path)

        _META_CACHE[file_path] = (mtime, epoch, meta)

        # Evict oldest entries if cache exceeds max size
        while len(_META_CACHE) > _META_CACHE_MAX_SIZE:
            _META_CACHE.popitem(last=False)  # Remove oldest (FIFO when not accessed)


def _env_timeout(name: str, default: float, min_s: float = 0.5, max_s: float = 60.0) -> float:
    """
    Parse a timeout value from env and clamp it to a safe range.
    Keeps external metadata tools from hanging the server.
    """
    try:
        raw = os.environ.get(name, None)
        val = float(default) if raw is None else float(raw)
    except (ValueError, TypeError):
        val = float(default)
    try:
        return max(float(min_s), min(float(val), float(max_s)))
    except (ValueError, TypeError, OverflowError):
        return float(default)


def _force_sidecar_enabled() -> bool:
    val = str(os.environ.get("MJR_FORCE_SIDECAR", "0")).lower()
    return val in ("1", "true", "yes", "on")


def _sidecar_allowed_for(path: str) -> bool:
    return ENABLE_JSON_SIDECAR or _force_sidecar_enabled()


def _normalize_label(text) -> str:
    try:
        normalized = unicodedata.normalize("NFKD", str(text or ""))
        normalized = "".join(ch for ch in normalized if not unicodedata.combining(ch))
        return normalized.lower().strip()
    except (ValueError, TypeError, AttributeError):
        # Fallback for non-normalizable text
        return str(text or "").lower().strip()


def _get_mtime_safe(path: str) -> Optional[float]:
    try:
        return os.path.getmtime(path)
    except (OSError, ValueError):
        # File doesn't exist or path is invalid
        return None


def safe_import_win32com():
    global _WIN32COM, _WIN32COM_CHECKED
    if _WIN32COM_CHECKED:
        return _WIN32COM
    _WIN32COM_CHECKED = True
    if IS_WINDOWS:
        try:
            import win32com.client  # type: ignore

            _WIN32COM = win32com.client
        except ImportError:
            log.warning("Windows logic disabled (pywin32 not found)")
            _WIN32COM = None
    else:
        _WIN32COM = None
    return _WIN32COM


def _set_windows_property_store(file_path: str, rating: int, tags, *, clear_tags: bool = False) -> bool:
    """
    Write rating/tags using the Windows Property System (more reliable than Shell column indices).
    Returns True on success.
    """
    if not IS_WINDOWS:
        return False
    try:
        import pythoncom  # type: ignore
        from win32com.propsys import propsys, pscon  # type: ignore

        pythoncom.CoInitialize()
        try:
            store = propsys.SHGetPropertyStoreFromParsingName(file_path, None, pscon.GPS_READWRITE)
            # System.Rating expects 0..99
            percent = rating_to_windows_percent(rating)
            store.SetValue(pscon.PKEY_Rating, percent)
            # Explorer's "Shared User Rating" can map to different property keys depending on handlers.
            media_key = getattr(pscon, "PKEY_ShareUserRating", None) or getattr(pscon, "PKEY_Media_UserRating", None)
            if media_key is not None:
                try:
                    store.SetValue(media_key, percent)
                except (OSError, AttributeError):
                    # Media key not supported on this file type
                    pass

            if tags is not None:
                tags_list = _normalize_tags(tags)
                cat_key = getattr(pscon, "PKEY_Category", None)
                if tags_list:
                    # For videos, Explorer commonly shows tags under "Category/Categories".
                    if cat_key is not None:
                        try:
                            store.SetValue(cat_key, tuple(tags_list))
                        except (OSError, AttributeError):
                            # Category key not supported on this file type
                            pass
                    store.SetValue(pscon.PKEY_Keywords, tuple(tags_list))
                elif clear_tags:
                    if cat_key is not None:
                        try:
                            store.SetValue(cat_key, tuple())
                        except (OSError, AttributeError):
                            # Category key not supported on this file type
                            pass
                    store.SetValue(pscon.PKEY_Keywords, tuple())

            store.Commit()
            return True
        finally:
            try:
                pythoncom.CoUninitialize()
            except (OSError, AttributeError):
                # COM cleanup failed, not critical
                pass
    except (ImportError, OSError, AttributeError) as e:
        log.debug("[Majoor] Failed to set Windows metadata: %s", e)
        return False


def _get_windows_property_store(file_path: str) -> dict:
    """
    Read rating/tags using the Windows Property System.
    Helps when Shell column indices are missing or differ per file type (notably videos).
    """
    if not IS_WINDOWS:
        return {}
    try:
        import pythoncom  # type: ignore
        from win32com.propsys import propsys, pscon  # type: ignore

        pythoncom.CoInitialize()
        try:
            store = propsys.SHGetPropertyStoreFromParsingName(file_path, None, pscon.GPS_BESTEFFORT)

            rating_raw = None
            try:
                rating_raw = store.GetValue(pscon.PKEY_Rating).GetValue()
            except Exception:
                rating_raw = None
            if rating_raw is None:
                media_key = getattr(pscon, "PKEY_ShareUserRating", None) or getattr(pscon, "PKEY_Media_UserRating", None)
                if media_key is not None:
                    try:
                        rating_raw = store.GetValue(media_key).GetValue()
                    except Exception:
                        rating_raw = None

            rating = windows_percent_to_stars(int(rating_raw)) if rating_raw is not None else 0

            tags: List[str] = []
            cat_key = getattr(pscon, "PKEY_Category", None)
            if cat_key is not None:
                try:
                    cat_val = store.GetValue(cat_key).GetValue()
                    if isinstance(cat_val, (list, tuple)):
                        tags = _normalize_tags(list(cat_val))
                    elif isinstance(cat_val, str):
                        tags = _normalize_tags(cat_val)
                except (OSError, AttributeError, TypeError):
                    # Category property not available or invalid
                    tags = []

            if not tags:
                try:
                    kw_val = store.GetValue(pscon.PKEY_Keywords).GetValue()
                    if isinstance(kw_val, (list, tuple)):
                        tags = _normalize_tags(list(kw_val))
                    elif isinstance(kw_val, str):
                        tags = _normalize_tags(kw_val)
                except (OSError, AttributeError, TypeError):
                    # Keywords property not available or invalid
                    tags = []

            return {"rating": rating, "tags": tags}
        finally:
            try:
                pythoncom.CoUninitialize()
            except (OSError, AttributeError):
                # COM cleanup failed, not critical
                pass
    except (ImportError, OSError, AttributeError) as e:
        log.debug("[Majoor] Failed to read Windows metadata: %s", e)
        return {}


def _get_exiftool_path() -> Optional[str]:
    global _EXIFTOOL_PATH, _EXIFTOOL_CHECKED
    if _EXIFTOOL_CHECKED:
        return _EXIFTOOL_PATH
    _EXIFTOOL_CHECKED = True
    _EXIFTOOL_PATH = shutil.which("exiftool") or shutil.which("exiftool.exe")
    return _EXIFTOOL_PATH


def _parse_rating_value(raw) -> int:
    if raw in (None, ""):
        return 0
    s_raw = str(raw).strip()
    if not s_raw:
        return 0

    star_count = sum(s_raw.count(ch) for ch in STAR_CHARS)
    if star_count:
        return max(0, min(star_count, 5))

    try:
        numeric = float(s_raw.replace(",", ".").split()[0])
    except Exception:
        return 0

    if numeric <= 0:
        return 0
    if numeric > 5:
        if numeric <= 25:
            return 2
        if numeric <= 50:
            return 3
        if numeric <= 75:
            return 4
        return 5
    return int(round(min(numeric, 5)))


def _coerce_rating_to_stars(raw) -> int:
    """
    Normalize arbitrary rating inputs to 0..5 stars.
    Accepts:
    - 0..5 stars (int/float/str)
    - Windows percent scale (0..100)
    - star glyphs (e.g. ★★★☆☆)
    """
    if raw in (None, ""):
        return 0
    try:
        num = float(str(raw).strip().replace(",", ".").split()[0])
    except Exception:
        return max(0, min(_parse_rating_value(raw), 5))

    if num <= 0:
        return 0
    if 0 <= num <= 5:
        return max(0, min(int(round(num)), 5))
    if num <= 100:
        return windows_percent_to_stars(int(round(num)))
    return max(0, min(_parse_rating_value(raw), 5))


def _normalize_tags(raw) -> List[str]:
    """
    Normalize tags to a deduplicated, order-preserving list of non-empty strings.
    Accepts list or comma/semicolon-delimited strings.
    """
    if raw is None:
        return []
    if isinstance(raw, list):
        candidates = raw
    elif isinstance(raw, str):
        candidates = [t.strip() for t in re.split(r"[;,]", raw)]
    else:
        return []

    out: List[str] = []
    seen = set()
    for t in candidates:
        s = str(t).strip()
        if not s or s in seen:
            continue
        seen.add(s)
        out.append(s)
    return out


def rating_to_windows_percent(stars: int) -> int:
    """
    Map 0..5 stars to Windows percent scale expected by SharedUserRating.
    """
    try:
        r = int(stars)
    except Exception:
        r = 0
    mapping = {0: 0, 1: 1, 2: 25, 3: 50, 4: 75, 5: 99}
    return max(0, min(99, mapping.get(r, 0 if r < 0 else r)))


def windows_percent_to_stars(percent: int) -> int:
    """
    Convert Windows percent (SharedUserRating) to 0..5 stars using thresholds.
    """
    try:
        p = int(percent)
    except Exception:
        return 0
    if p <= 0:
        return 0
    if p <= 12:
        return 1
    if p <= 37:
        return 2
    if p <= 62:
        return 3
    if p <= 87:
        return 4
    return 5


def tags_to_windows_category(tags: list) -> str:
    """
    Join tags for Microsoft:Category; use '; ' which Explorer parses.
    """
    if not isinstance(tags, list):
        return ""
    cleaned = [str(t).strip() for t in tags if str(t).strip()]
    return "; ".join(cleaned)


def windows_category_to_tags(cat: str) -> list:
    """
    Split Microsoft:Category back into a list; preserve order, drop empties.
    """
    if not cat:
        return []
    parts = [p.strip() for p in str(cat).split(";") if p.strip()]
    return parts


def get_windows_metadata(file_path: str) -> dict:
    """Fetch file metadata via the Windows Shell API."""
    try:
        prop_meta = _get_windows_property_store(file_path)
        if (prop_meta.get("rating") or prop_meta.get("tags")) and not (
            prop_meta.get("rating") == 0 and not prop_meta.get("tags")
        ):
            return prop_meta

        win32com = safe_import_win32com()
        if not win32com:
            return {"rating": 0, "tags": []}

        pythoncom = None
        try:
            import pythoncom  # type: ignore

            pythoncom.CoInitialize()
        except Exception:
            pythoncom = None

        try:
            shell = win32com.Dispatch("Shell.Application")
            folder = shell.Namespace(os.path.dirname(file_path))
            file = folder.ParseName(os.path.basename(file_path))

            rating_idx, tags_idx = _resolve_shell_indices(folder)

            rating_raw = folder.GetDetailsOf(file, rating_idx)
            tags_raw = folder.GetDetailsOf(file, tags_idx)

            rating = 0
            # Windows may expose either stars or SharedUserRating percent; normalize to stars
            try:
                numeric = float(str(rating_raw).strip())
                if 0 <= numeric <= 100 and numeric > 5:
                    rating = windows_percent_to_stars(int(round(numeric)))
                else:
                    rating = _parse_rating_value(numeric)
            except Exception:
                rating = _parse_rating_value(rating_raw)

            tags = []
            if tags_raw:
                tag_text = str(tags_raw)
                for sep in [",", ";"]:
                    if sep in tag_text:
                        tags = [t.strip() for t in tag_text.split(sep) if t.strip()]
                        break
                else:
                    t = tag_text.strip()
                    if t:
                        tags = [t]

            return {
                "rating": rating,
                "tags": tags,
            }
        finally:
            if pythoncom is not None:
                try:
                    pythoncom.CoUninitialize()
                except Exception:
                    pass
    except Exception as e:
        log.warning("Error reading metadata for %s: %s", file_path, e)
        return {"rating": 0, "tags": []}


# Canonical ExifTool reader for rating/tags (avoid duplicate implementations)
def get_exif_metadata(file_path: str) -> dict:
    """
    Fast read via exiftool when available.
    Returns {"rating": int, "tags": List[str]} or {} on fallback.
    """
    exe = _get_exiftool_path()
    if not exe:
        return {}
    try:
        timeout_s = _env_timeout("MJR_EXIFTOOL_READ_TIMEOUT", 2.0, min_s=0.5, max_s=60.0)
        is_video = file_path.lower().endswith(tuple(VIDEO_EXTS))

        # For videos, prefer XMP tags (portable and consistent) then fall back to Microsoft tags.
        # For images/others, keep the existing wide read set (Windows + XMP + common keyword fields).
        if is_video:
            cmd = [
                exe,
                "-n",
                "-json",
                "-XMP:Rating",
                "-XMP:Subject",
                "-Microsoft:SharedUserRating",
                "-Microsoft:Category",
                file_path,
            ]
        else:
            cmd = [
                exe,
                "-n",
                "-json",
                "-Rating",
                "-RatingPercent",
                "-Microsoft:SharedUserRating",
                "-Microsoft:Category",
                "-Subject",
                "-Keywords",
                "-XPKeywords",
                file_path,
            ]
        proc = None
        try:
            proc = subprocess.run(cmd, capture_output=True, timeout=timeout_s, check=False)
            if proc.returncode != 0 or not proc.stdout:
                return {}
            data = json.loads(proc.stdout)[0]
        except subprocess.TimeoutExpired:
            # Ensure process terminated
            if proc and proc.returncode is None:
                try:
                    proc.kill()
                    proc.wait()
                except Exception:
                    pass
            return {}
        except Exception as e:
            log.debug("[Majoor] ExifTool read failed: %s", e)
            return {}

        rating_raw = None
        if is_video:
            rating_raw = data.get("XMP:Rating")
            if rating_raw is None:
                rating_raw = data.get("Microsoft:SharedUserRating") or data.get("SharedUserRating")
        else:
            rating_raw = data.get("Rating")
            if rating_raw is None:
                rating_raw = data.get("RatingPercent")
            if rating_raw is None:
                rating_raw = data.get("Microsoft:SharedUserRating")
        rating = 0
        if rating_raw is not None:
            try:
                num = float(rating_raw)
            except Exception:
                num = None
            if num is not None and 0 <= num <= 5:
                rating = int(round(num))
            elif num is not None and num > 5:
                rating = windows_percent_to_stars(int(round(num)))
            else:
                rating = _parse_rating_value(rating_raw)

        tags: List[str] = []
        if is_video:
            subj = data.get("XMP:Subject")
            if subj:
                if isinstance(subj, list):
                    tags = _normalize_tags(subj)
                elif isinstance(subj, str):
                    tags = _normalize_tags(subj)
            if not tags:
                cat = data.get("Microsoft:Category") or data.get("Category")
                if cat:
                    tags = _normalize_tags(cat)
        else:
            for key in ("Subject", "Keywords", "XPKeywords"):
                val = data.get(key)
                if isinstance(val, list):
                    tags.extend([str(v).strip() for v in val if str(v).strip()])
                elif isinstance(val, str):
                    tags.extend([t.strip() for t in val.split(",") if t.strip()])

        if tags and not is_video:
            tags = sorted(set(tags))

        return {"rating": rating, "tags": tags}
    except subprocess.TimeoutExpired:
        return {}
    except Exception:
        return {}


# Self-check for rating normalization; kept lightweight
def _test_rating_normalization():
    assert windows_percent_to_stars(5) == 1  # percent-like but low
    assert windows_percent_to_stars(99) == 5
    assert windows_percent_to_stars(75) == 4
    assert windows_percent_to_stars(1) == 1
    assert _parse_rating_value(5) == 5
    assert _parse_rating_value(0) == 0

_test_rating_normalization()


# Canonical ExifTool writer for rating/tags (video-aware); do not duplicate
def set_exif_metadata(file_path: str, rating: int, tags: list) -> bool:
    """
    Write Rating/Keywords via exiftool when available. Returns True on success.
    """
    exe = _get_exiftool_path()
    if not exe:
        return False

    epoch = _next_cache_epoch()
    original_mtime = _get_mtime_safe(file_path)
    is_video = file_path.lower().endswith((".mp4", ".mov", ".m4v", ".webm", ".mkv"))

    # Retry loop for "file not ready yet" cases on Windows: right after generation,
    # the encoder can still be finalizing/locking the container. We treat common
    # "cannot open/write" errors as retryable and back off exponentially.
    def _exiftool_is_retryable(stderr: bytes) -> bool:
        msg = (stderr or b"").decode("utf-8", errors="ignore").lower()
        return any(
            s in msg
            for s in (
                "cannot open",
                "can't open",
                "error opening file",
                "permission denied",
                "access is denied",
                "being used by another process",
                "used by another process",
                "sharing violation",
                "file is locked",
                "cannot write",
                "can't write",
                "write error",
            )
        )

    def _exiftool_run_with_retries(cmd: list, timeout_s: float, *, max_tries: int = 5) -> subprocess.CompletedProcess:
        last = None
        for attempt in range(max_tries):
            last = subprocess.run(cmd, check=False, capture_output=True, timeout=timeout_s)
            if last.returncode == 0:
                return last
            if not _exiftool_is_retryable(last.stderr):
                return last
            time.sleep(0.15 * (2**attempt))
        return last  # type: ignore[return-value]

    try:
        write_timeout_s = _env_timeout("MJR_EXIFTOOL_WRITE_TIMEOUT", 3.0, min_s=0.5, max_s=120.0)
        r = _coerce_rating_to_stars(rating)
        win_r = rating_to_windows_percent(r)

        clean_tags = _normalize_tags(tags)
        joined = "; ".join(clean_tags)

        if not is_video:
            # Keep existing behavior for images/other files: write rating + common keyword fields.
            cmd = [exe, "-overwrite_original"]
            cmd += [
                f"-XMP:Rating={r}",
                f"-xmp:rating={r}",
                f"-rating={r}",
                f"-ratingpercent={win_r}",
                "-Subject=",
                "-Keywords=",
                "-XPKeywords=",
                "-XMP:Subject=",
            ]
            if clean_tags:
                cmd.append(f"-XMP:Subject={joined}")
                cmd.append(f"-xpkeywords={joined}")
                for t in clean_tags:
                    cmd.append(f"-iptc:keywords+={t}")
            cmd.append(file_path)
            res = subprocess.run(cmd, check=False, capture_output=True, timeout=write_timeout_s)
            if res.returncode != 0:
                return False

            if original_mtime is not None:
                try:
                    os.utime(file_path, (original_mtime, original_mtime))
                except Exception:
                    pass

            _cache_set(
                file_path,
                original_mtime if original_mtime is not None else _get_mtime_safe(file_path),
                epoch,
                {"rating": rating, "tags": tags},
            )
            return True

        # Preserve embedded ComfyUI workflow JSON stored in Comment-like tags without putting large blobs on the
        # command line: copy those tags from the original file (`@`) onto the rewritten file, then override rating/tags.
        preserve_copy_args = [
            "-tagsFromFile",
            "@",
            "-Comment",
            "-UserComment",
            "-Description",
            "-XPComment",
            "-Parameters",
            "-UserData",
            "-XMP:Comment",
            "-XMP:Description",
            "-XMP:UserComment",
            "-ItemList:Comment",
            "-ItemList:Description",
            "-ItemList:UserComment",
        ]

        # Multi-namespace strategy for videos:
        # - Always write XMP:Rating (0..5) and XMP:Subject (list of tags).
        # - Best-effort write Microsoft:SharedUserRating (0..100-ish) and Microsoft:Category (semicolon list).
        #   If the Microsoft tags are not writable for a given container/handler, we still succeed as long as
        #   the XMP tags were written.
        base_cmd = [exe, "-overwrite_original", "-sep", "; ", *preserve_copy_args]
        base_cmd += [
            f"-XMP:Rating={r}",
            "-XMP:Subject=",
        ]
        if joined:
            base_cmd.append(f"-XMP:Subject={joined}")

        cmd_with_ms = list(base_cmd)
        cat = tags_to_windows_category(clean_tags)
        cmd_with_ms += [
            f"-Microsoft:SharedUserRating={win_r}",
            f"-Microsoft:Category={cat}",
        ]

        # Preflight: wait a bit for the file to become readable after generation (Windows lock/finalization).
        for attempt in range(5):
            try:
                with open(file_path, "rb") as f:
                    f.read(1)
                break
            except Exception:
                time.sleep(0.15 * (2**attempt))

        def _is_ms_write_issue(stderr: bytes) -> bool:
            msg = (stderr or b"").decode("utf-8", errors="ignore").lower()
            return ("microsoft:" in msg) and any(s in msg for s in ("not writable", "unsupported", "warning"))

        res = _exiftool_run_with_retries(cmd_with_ms + [file_path], write_timeout_s)
        if res.returncode != 0 and _is_ms_write_issue(res.stderr):
            # Retry once without Microsoft namespace tags (XMP remains the source of truth).
            res = _exiftool_run_with_retries(base_cmd + [file_path], write_timeout_s)
        if res.returncode != 0:
            return False

        # Restore mtime to avoid reordering the grid after rating/tag updates
        if original_mtime is not None:
            try:
                os.utime(file_path, (original_mtime, original_mtime))
            except Exception:
                pass

        # Update cache with current epoch
        _cache_set(
            file_path,
            original_mtime if original_mtime is not None else _get_mtime_safe(file_path),
            epoch,
            {"rating": rating, "tags": tags},
        )
        return True
    except subprocess.TimeoutExpired:
        return False
    except Exception:
        return False


def set_windows_metadata(file_path: str, rating: int, tags: list) -> bool:
    """Write metadata via the Windows Shell API."""
    try:
        win32com = safe_import_win32com()
        if not win32com:
            return False

        original_mtime = _get_mtime_safe(file_path)

        # Prefer the Windows Property System when possible (works better for media files like MP4)
        tags_list = _normalize_tags(tags)
        clear_tags = tags == []
        if _set_windows_property_store(file_path, _coerce_rating_to_stars(rating), tags_list, clear_tags=clear_tags):
            if original_mtime is not None:
                try:
                    os.utime(file_path, (original_mtime, original_mtime))
                except Exception:
                    pass

            epoch = _next_cache_epoch()
            _cache_set(
                file_path,
                original_mtime if original_mtime is not None else _get_mtime_safe(file_path),
                epoch,
                {"rating": _coerce_rating_to_stars(rating), "tags": tags_list},
            )
            return True

        pythoncom = None
        try:
            import pythoncom  # type: ignore

            pythoncom.CoInitialize()
        except Exception:
            pythoncom = None

        try:
            shell = win32com.Dispatch("Shell.Application")
            folder = shell.Namespace(os.path.dirname(file_path))
            file = folder.ParseName(os.path.basename(file_path))

            rating_idx, tags_idx = _resolve_shell_indices(folder)

            # Rating (SharedUserRating percent 0..99); accept stars or percent and normalize
            if rating is not None:
                stars = _coerce_rating_to_stars(rating)
                rating_val = rating_to_windows_percent(stars)
                folder.GetDetailsOf(file, rating_idx)  # force index load
                folder.SetDetailsOf(file, rating_idx, str(rating_val))

            if tags_list:
                folder.GetDetailsOf(file, tags_idx)
                folder.SetDetailsOf(file, tags_idx, "; ".join(tags_list))
            elif tags == []:
                folder.GetDetailsOf(file, tags_idx)
                folder.SetDetailsOf(file, tags_idx, "")

            # Restore mtime to avoid reordering the grid after rating/tag updates
            if original_mtime is not None:
                try:
                    os.utime(file_path, (original_mtime, original_mtime))
                except Exception:
                    pass

            epoch = _next_cache_epoch()
            _cache_set(
                file_path,
                original_mtime if original_mtime is not None else _get_mtime_safe(file_path),
                epoch,
                {"rating": _coerce_rating_to_stars(rating), "tags": tags_list},
            )
            return True
        finally:
            if pythoncom is not None:
                try:
                    pythoncom.CoUninitialize()
                except Exception:
                    pass
    except Exception:
        return False


def _resolve_shell_indices(folder) -> (int, int):
    """
    Tente de localiser les colonnes "Rating"/"Tags" en fonction de la locale.
    Retourne un tuple (rating_idx, tags_idx) avec fallback sur les constantes.
    """
    global _CACHED_RATING_INDEX, _CACHED_TAGS_INDEX
    if _CACHED_RATING_INDEX is not None and _CACHED_TAGS_INDEX is not None:
        return _CACHED_RATING_INDEX, _CACHED_TAGS_INDEX

    rating_idx = WINDOWS_RATING_INDEX
    tags_idx = WINDOWS_TAGS_INDEX

    try:
        for i in range(0, 256):
            col_name = _normalize_label(folder.GetDetailsOf(None, i))
            if not col_name:
                continue
            if _CACHED_RATING_INDEX is None and any(key in col_name for key in RATING_KEYS):
                _CACHED_RATING_INDEX = i
            if _CACHED_TAGS_INDEX is None and any(key in col_name for key in TAG_KEYS):
                _CACHED_TAGS_INDEX = i
            if _CACHED_RATING_INDEX is not None and _CACHED_TAGS_INDEX is not None:
                break
    except Exception:
        pass

    if _CACHED_RATING_INDEX is None:
        _CACHED_RATING_INDEX = rating_idx
    if _CACHED_TAGS_INDEX is None:
        _CACHED_TAGS_INDEX = tags_idx

    return _CACHED_RATING_INDEX, _CACHED_TAGS_INDEX


def apply_windows_metadata(file_path: str, rating, tags: list) -> dict:
    """
    Apply rating/tags via Windows API while handling defaults.
    Retourne {"rating": int, "tags": List[str]}.
    """
    try:
        rating_int = int(rating) if rating is not None else 0
    except Exception:
        rating_int = 0
    tags_list: List[str] = []
    if isinstance(tags, list):
        tags_list = [str(t) for t in tags if str(t).strip()]
    set_windows_metadata(file_path, rating_int, tags_list)
    return {"rating": rating_int, "tags": tags_list}


# Canonical metadata updater (Windows + ExifTool + optional sidecar); keep single definition
def update_metadata_with_windows(file_path: str, updates: dict) -> dict:
    """
    Update rating/tags via Windows + sidecar (if enabled).
    Returns final metadata.
    """
    start_epoch = _get_cache_epoch()

    # Load current values (prefer system metadata, fallback to sidecar)
    sys_meta = get_system_metadata(file_path) or {}
    sidecar = load_metadata(file_path) or {}
    current_rating = sys_meta.get("rating", sidecar.get("rating", 0))
    current_tags = sys_meta.get("tags", sidecar.get("tags", []))

    has_rating = "rating" in updates
    has_tags = "tags" in updates

    if not has_rating and not has_tags:
        return {"rating": current_rating, "tags": current_tags}

    rating = _coerce_rating_to_stars(updates.get("rating", current_rating))
    tags = _normalize_tags(updates.get("tags", current_tags))

    # Only write tags when provided; otherwise preserve existing tags in system metadata
    target_tags = tags if has_tags else _normalize_tags(current_tags)

    ok_win = False
    ok_exif = False
    if has_rating or has_tags:
        is_video = str(file_path).lower().endswith(tuple(VIDEO_EXTS))
        # For videos, prefer ExifTool writes (more portable; also writes Microsoft:Category/SharedUserRating).
        if is_video and _get_exiftool_path():
            ok_exif = set_exif_metadata(
                file_path,
                rating if has_rating else current_rating,
                target_tags if has_tags else current_tags,
            )
            ok_win = set_windows_metadata(
                file_path,
                rating if has_rating else current_rating,
                target_tags if has_tags else current_tags,
            )
        else:
            ok_win = set_windows_metadata(
                file_path,
                rating if has_rating else current_rating,
                target_tags if has_tags else current_tags,
            )
            ok_exif = set_exif_metadata(
                file_path,
                rating if has_rating else current_rating,
                target_tags if has_tags else current_tags,
            )

    sidecar_saved = False
    if _sidecar_allowed_for(file_path):
        save_metadata(file_path, {"rating": rating if has_rating else current_rating, "tags": target_tags})
        sidecar_saved = True

    # Video robustness: if Windows metadata fields are not supported and ExifTool is unavailable,
    # still persist rating/tags for the manager via a sidecar JSON (even on Windows).
    if (not ok_win and not ok_exif) and str(file_path).lower().endswith(tuple(VIDEO_EXTS)):
        try:
            save_metadata(file_path, {"rating": rating if has_rating else current_rating, "tags": target_tags}, force=True)
            sidecar_saved = True
        except Exception:
            pass

    effective_rating = (rating if has_rating else current_rating) if (ok_win or ok_exif or sidecar_saved) else current_rating
    effective_tags = target_tags

    # Ensure cache invalidates even when mtime is preserved (Windows/ExifTool writes).
    if ok_win or ok_exif or sidecar_saved:
        epoch = _bump_cache_epoch_if(start_epoch)
    else:
        epoch = _get_cache_epoch()
    _cache_set(
        file_path,
        _get_mtime_safe(file_path),
        epoch,
        {"rating": _coerce_rating_to_stars(effective_rating), "tags": _normalize_tags(effective_tags)},
    )
    return {"rating": effective_rating, "tags": effective_tags}


def apply_system_metadata(file_path: str, rating, tags: list) -> dict:
    """
    Try exiftool first (if installed), otherwise Windows Shell.
    """
    start_epoch = _get_cache_epoch()
    rating_int = _coerce_rating_to_stars(rating)
    tags_list = _normalize_tags(tags)

    # exiftool (meilleure compat Windows + autres OS)
    if set_exif_metadata(file_path, rating_int, tags_list):
        return {"rating": rating_int, "tags": tags_list}

    # fallback shell API
    meta = apply_windows_metadata(file_path, rating_int, tags_list)
    epoch = _bump_cache_epoch_if(start_epoch)
    _cache_set(file_path, _get_mtime_safe(file_path), epoch, meta)
    return meta


def get_system_metadata(file_path: str) -> dict:
    """
    Prefer ExifTool metadata (Rating/Keywords), otherwise Windows API.
    FIX: Use improved cache_get that returns epoch for validation.
    """
    mtime = _get_mtime_safe(file_path)
    epoch = _get_cache_epoch()
    cached_data, cache_epoch = _cache_get(file_path, mtime, epoch)
    # Verify epoch hasn't changed since cache fetch
    if cached_data is not None and cache_epoch == _get_cache_epoch():
        return cached_data

    meta = get_exif_metadata(file_path)
    # For videos, ExifTool is the source of truth (Explorer can be inconsistent across handlers).
    if file_path.lower().endswith(tuple(VIDEO_EXTS)) and meta:
        _cache_set(file_path, mtime, _get_cache_epoch(), meta)
        return meta

    if meta.get("rating") or meta.get("tags"):
        _cache_set(file_path, mtime, _get_cache_epoch(), meta)
        return meta

    meta = get_windows_metadata(file_path)
    if (meta.get("rating") or meta.get("tags")) and not (meta.get("rating") == 0 and not meta.get("tags")):
        _cache_set(file_path, mtime, _get_cache_epoch(), meta)
        return meta

    # Sidecar fallback only when enabled/forced
    if _sidecar_allowed_for(file_path):
        sidecar = load_metadata(file_path)
        if sidecar:
            r = sidecar.get("rating", 0)
            t = sidecar.get("tags", [])
            meta = {"rating": r if isinstance(r, int) else 0, "tags": t if isinstance(t, list) else []}
            _cache_set(file_path, mtime, _get_cache_epoch(), meta)
            return meta

    _cache_set(file_path, mtime, _get_cache_epoch(), meta)
    return meta


def classify_ext(lower_name: str) -> str:
    """Retourne image / video / audio / model3d / other."""
    if lower_name.endswith(tuple(IMAGE_EXTS)):
        return "image"
    if lower_name.endswith(tuple(VIDEO_EXTS)):
        return "video"
    if lower_name.endswith(tuple(AUDIO_EXTS)):
        return "audio"
    if lower_name.endswith(tuple(MODEL3D_EXTS)):
        return "model3d"
    return "other"

def ensure_dir(path):
    if not os.path.exists(path):
        os.makedirs(path)

def is_image(fname: str):
    f = fname.lower()
    return f.endswith(tuple(IMAGE_EXTS))

def metadata_path(image_path: str):
    candidate = image_path + METADATA_EXT
    # Always allow reading an existing sidecar (even when disabled by default on Windows)
    if os.path.exists(candidate):
        return candidate
    if not _sidecar_allowed_for(image_path):
        return None
    return candidate

def load_metadata(image_path):
    meta_file = metadata_path(image_path)
    if not meta_file:
        return {}
    if not os.path.exists(meta_file):
        return {}
    try:
        with open(meta_file, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}

def save_metadata(image_path, meta: dict, force: bool = False):
    meta_file = image_path + METADATA_EXT if force else metadata_path(image_path)
    if not meta_file:
        return
    with open(meta_file, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)
