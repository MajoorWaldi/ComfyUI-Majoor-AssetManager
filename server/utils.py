import json
import os
import platform
import shutil
import subprocess
import unicodedata
from typing import Dict, List, Optional
from .config import ENABLE_JSON_SIDECAR, METADATA_EXT

# Supported extensions
IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".gif")
VIDEO_EXTS = (".mp4", ".mov", ".webm", ".mkv")
AUDIO_EXTS = (".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac")
MODEL3D_EXTS = (".obj", ".fbx", ".glb", ".gltf", ".stl")
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
TAG_KEYS = ("tag", "mot-cle", "mot cle", "mots cle", "keywords", "keyword")

_WIN32COM: Optional[object] = None
_WIN32COM_CHECKED = False
_CACHED_RATING_INDEX: Optional[int] = None
_CACHED_TAGS_INDEX: Optional[int] = None
_EXIFTOOL_PATH: Optional[str] = None
_EXIFTOOL_CHECKED = False
_META_CACHE: Dict[str, tuple[Optional[float], int, dict]] = {}
_CACHE_EPOCH = 0


def _normalize_label(text) -> str:
    try:
        normalized = unicodedata.normalize("NFKD", str(text or ""))
        normalized = "".join(ch for ch in normalized if not unicodedata.combining(ch))
        return normalized.lower().strip()
    except Exception:
        return str(text or "").lower().strip()


def _get_mtime_safe(path: str) -> Optional[float]:
    try:
        return os.path.getmtime(path)
    except Exception:
        return None


def safe_import_win32com():
    global _WIN32COM, _WIN32COM_CHECKED
    if _WIN32COM_CHECKED:
        return _WIN32COM
    _WIN32COM_CHECKED = True
    if platform.system().lower() == "windows":
        try:
            import win32com.client  # type: ignore

            _WIN32COM = win32com.client
        except ImportError:
            print("pywin32 is not installed. Windows-specific metadata will not be available.")
            _WIN32COM = None
    return _WIN32COM


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


def get_windows_metadata(file_path: str) -> dict:
    """Fetch file metadata via the Windows Shell API."""
    try:
        win32com = safe_import_win32com()
        if not win32com:
            return {"rating": 0, "tags": []}

        shell = win32com.Dispatch("Shell.Application")
        folder = shell.Namespace(os.path.dirname(file_path))
        file = folder.ParseName(os.path.basename(file_path))

        rating_idx, tags_idx = _resolve_shell_indices(folder)

        rating_raw = folder.GetDetailsOf(file, rating_idx)
        tags_raw = folder.GetDetailsOf(file, tags_idx)

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
    except Exception as e:
        print(f"Error reading metadata for {file_path}: {e}")
        return {"rating": 0, "tags": []}


def get_exif_metadata(file_path: str) -> dict:
    """
    Fast read via exiftool when available.
    Returns {"rating": int, "tags": List[str]} or {} on fallback.
    """
    exe = _get_exiftool_path()
    if not exe:
        return {}
    try:
        cmd = [
            exe,
            "-n",
            "-json",
            "-Rating",
            "-RatingPercent",
            "-Subject",
            "-Keywords",
            "-XPKeywords",
            file_path,
        ]
        out = subprocess.check_output(cmd, timeout=2)
        data = json.loads(out)[0]
        rating_raw = data.get("Rating") or data.get("RatingPercent")
        rating = _parse_rating_value(rating_raw)

        tags: List[str] = []
        for key in ("Subject", "Keywords", "XPKeywords"):
            val = data.get(key)
            if isinstance(val, list):
                tags.extend([str(v).strip() for v in val if str(v).strip()])
            elif isinstance(val, str):
                tags.extend([t.strip() for t in val.split(",") if t.strip()])

        if tags:
            tags = sorted(set(tags))

        return {"rating": rating, "tags": tags}
    except Exception:
        return {}


def set_exif_metadata(file_path: str, rating: int, tags: list) -> bool:
    """
    Write Rating/Keywords via exiftool when available. Returns True on success.
    """
    exe = _get_exiftool_path()
    if not exe:
        return False

    global _CACHE_EPOCH
    _CACHE_EPOCH += 1
    epoch = _CACHE_EPOCH
    original_mtime = _get_mtime_safe(file_path)

    try:
        r = max(0, min(int(rating), 5))
        win_r = {1: 1, 2: 25, 3: 50, 4: 75, 5: 99}.get(r, r if r <= 5 else 99)

        cmd = [
            exe,
            "-overwrite_original",
            f"-xmp:rating={r}",
            f"-rating={r}",
            f"-ratingpercent={win_r}",
            "-Subject=",
            "-Keywords=",
            "-XPKeywords=",
        ]

        clean_tags = [str(t).strip() for t in tags if str(t).strip()]
        if clean_tags:
            for t in clean_tags:
                cmd.append(f"-xmp:subject+={t}")
                cmd.append(f"-iptc:keywords+={t}")
            # XPKeywords expects a semicolon-separated string on Windows
            cmd.append(f"-xpkeywords={'; '.join(clean_tags)}")

        cmd.append(file_path)
        subprocess.run(cmd, check=True, capture_output=True, timeout=3)

        # Restore mtime to avoid reordering the grid after rating/tag updates
        if original_mtime is not None:
            try:
                os.utime(file_path, (original_mtime, original_mtime))
            except Exception:
                pass

        # Update cache with current epoch
        _META_CACHE[file_path] = (
            original_mtime if original_mtime is not None else _get_mtime_safe(file_path),
            epoch,
            {"rating": rating, "tags": tags},
        )
        return True
    except Exception:
        return False


def set_windows_metadata(file_path: str, rating: int, tags: list) -> bool:
    """Write metadata via the Windows Shell API."""
    try:
        win32com = safe_import_win32com()
        if not win32com:
            return False

        shell = win32com.Dispatch("Shell.Application")
        folder = shell.Namespace(os.path.dirname(file_path))
        file = folder.ParseName(os.path.basename(file_path))

        rating_idx, tags_idx = _resolve_shell_indices(folder)

        # Rating (scale 1-99); Windows 5-star uses 1-5, but accepting broader range
        if rating is not None:
            rating_val = max(0, min(99, int(rating)))
            folder.GetDetailsOf(file, rating_idx)  # force index load
            folder.SetDetailsOf(file, rating_idx, str(rating_val))

        if tags:
            folder.GetDetailsOf(file, tags_idx)
            folder.SetDetailsOf(file, tags_idx, "; ".join(tags))
        elif tags == []:
            folder.GetDetailsOf(file, tags_idx)
            folder.SetDetailsOf(file, tags_idx, "")

        return True
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


def update_metadata_with_windows(file_path: str, updates: dict) -> dict:
    """
    Update rating/tags via Windows + sidecar (if enabled).
    Returns final metadata.
    """
    # Load current values (prefer system metadata, fallback to sidecar)
    sys_meta = get_system_metadata(file_path) or {}
    sidecar = load_metadata(file_path) or {}
    current_rating = sys_meta.get("rating", sidecar.get("rating", 0))
    current_tags = sys_meta.get("tags", sidecar.get("tags", []))

    has_rating = "rating" in updates
    has_tags = "tags" in updates

    rating = updates.get("rating", current_rating if has_rating else current_rating)
    tags = updates.get("tags", current_tags if has_tags else current_tags)

    # Only write tags when provided; otherwise preserve existing tags in system metadata
    target_tags = tags if has_tags else current_tags

    ok_win = set_windows_metadata(file_path, rating, target_tags)
    ok_exif = set_exif_metadata(file_path, rating, target_tags)

    if ENABLE_JSON_SIDECAR:
        save_metadata(file_path, {"rating": rating, "tags": target_tags})

    effective_rating = rating if (ok_win or ok_exif) else current_rating
    _META_CACHE[file_path] = (_get_mtime_safe(file_path), _CACHE_EPOCH, {"rating": effective_rating, "tags": target_tags})
    return {"rating": effective_rating, "tags": target_tags}


def apply_system_metadata(file_path: str, rating, tags: list) -> dict:
    """
    Try exiftool first (if installed), otherwise Windows Shell.
    """
    global _CACHE_EPOCH
    _CACHE_EPOCH += 1
    epoch = _CACHE_EPOCH
    try:
        rating_int = int(rating) if rating is not None else 0
    except Exception:
        rating_int = 0
    tags_list: List[str] = []
    if isinstance(tags, list):
        tags_list = [str(t) for t in tags if str(t).strip()]

    # exiftool (meilleure compat Windows + autres OS)
    if set_exif_metadata(file_path, rating_int, tags_list):
        mtime = _get_mtime_safe(file_path)
        _META_CACHE[file_path] = (mtime, epoch, {"rating": rating_int, "tags": tags_list})
        return {"rating": rating_int, "tags": tags_list}

    # fallback shell API
    meta = apply_windows_metadata(file_path, rating_int, tags_list)
    mtime = _get_mtime_safe(file_path)
    _META_CACHE[file_path] = (mtime, epoch, meta)
    return meta


def get_system_metadata(file_path: str) -> dict:
    """
    Prefer ExifTool metadata (Rating/Keywords), otherwise Windows API.
    """
    mtime = _get_mtime_safe(file_path)
    cached = _META_CACHE.get(file_path)
    if cached and cached[0] == mtime and cached[1] == _CACHE_EPOCH:
        return dict(cached[2])

    meta = get_exif_metadata(file_path)
    if meta.get("rating") or meta.get("tags"):
        _META_CACHE[file_path] = (mtime, _CACHE_EPOCH, meta)
        return meta

    meta = get_windows_metadata(file_path)
    _META_CACHE[file_path] = (mtime, _CACHE_EPOCH, meta)
    return meta


def classify_ext(lower_name: str) -> str:
    """Retourne image / video / audio / model3d / other."""
    if lower_name.endswith(IMAGE_EXTS):
        return "image"
    if lower_name.endswith(VIDEO_EXTS):
        return "video"
    if lower_name.endswith(AUDIO_EXTS):
        return "audio"
    if lower_name.endswith(MODEL3D_EXTS):
        return "model3d"
    return "other"

def ensure_dir(path):
    if not os.path.exists(path):
        os.makedirs(path)

def is_image(fname: str):
    f = fname.lower()
    return f.endswith(IMAGE_EXTS)

def metadata_path(image_path: str):
    if not ENABLE_JSON_SIDECAR:
        return None
    return image_path + METADATA_EXT

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

def save_metadata(image_path, meta: dict):
    meta_file = metadata_path(image_path)
    if not meta_file:
        return
    with open(meta_file, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)
