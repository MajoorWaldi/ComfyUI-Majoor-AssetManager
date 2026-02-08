"""
Configuration for Majoor Assets Manager.
"""
import os
import sys
import logging
from pathlib import Path

from .utils import env_float

logger = logging.getLogger(__name__)

def _resolve_output_root() -> Path:
    env_path = os.getenv("MAJOOR_OUTPUT_DIRECTORY")
    if env_path:
        return Path(env_path).expanduser().resolve()

    try:
        import folder_paths
        return Path(folder_paths.get_output_directory()).resolve()
    except (ImportError, ModuleNotFoundError, AttributeError):
        # Fallback to ComfyUI root's output directory based on this file's location
        comfy_root = Path(__file__).resolve().parents[3]
        return (comfy_root / "output").resolve()

OUTPUT_ROOT_PATH = _resolve_output_root()
OUTPUT_ROOT = str(OUTPUT_ROOT_PATH)

# Platform detection
IS_WINDOWS = sys.platform == "win32"

# SQLite index configuration
INDEX_DIR_PATH = OUTPUT_ROOT_PATH / "_mjr_index"
INDEX_DIR = str(INDEX_DIR_PATH)
INDEX_DB_PATH = INDEX_DIR_PATH / "assets.sqlite"
INDEX_DB = str(INDEX_DB_PATH)

# Collections (user-curated sets of assets)
COLLECTIONS_DIR_PATH = INDEX_DIR_PATH / "collections"
COLLECTIONS_DIR = str(COLLECTIONS_DIR_PATH)

# Create index directory if it doesn't exist
os.makedirs(INDEX_DIR, exist_ok=True)
os.makedirs(COLLECTIONS_DIR, exist_ok=True)

# External tool overrides (portable vs. system-wide)
EXIFTOOL_BIN = os.getenv("MAJOOR_EXIFTOOL_PATH") or os.getenv("MAJOOR_EXIFTOOL_BIN") or "exiftool"
FFPROBE_BIN = os.getenv("MAJOOR_FFPROBE_PATH") or os.getenv("MAJOOR_FFPROBE_BIN") or "ffprobe"

TOOL_LOCATIONS = {
    "exiftool": EXIFTOOL_BIN,
    "ffprobe": FFPROBE_BIN,
}

def get_tool_paths():
    """Return the resolved external tool executable paths."""
    return TOOL_LOCATIONS.copy()

EXIFTOOL_MIN_VERSION = os.getenv("MAJOOR_EXIFTOOL_MIN_VERSION", "").strip()
FFPROBE_MIN_VERSION = os.getenv("MAJOOR_FFPROBE_MIN_VERSION", "").strip()

# Media probe backend setting
# Options: "auto" (recommended), "exiftool", "ffprobe", "both"
MEDIA_PROBE_BACKEND = os.getenv("MAJOOR_MEDIA_PROBE_BACKEND", "auto")

# Performance tuning defaults
def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except (TypeError, ValueError):
        return default

# Tool timeouts
EXIFTOOL_TIMEOUT = _env_int("MAJOOR_EXIFTOOL_TIMEOUT", 15)
FFPROBE_TIMEOUT = _env_int("MAJOOR_FFPROBE_TIMEOUT", 10)

# Database tuning
DB_TIMEOUT = env_float("MAJOOR_DB_TIMEOUT", 30.0)
DB_MAX_CONNECTIONS = _env_int("MAJOOR_DB_MAX_CONNECTIONS", 8)
DB_QUERY_TIMEOUT = env_float("MAJOOR_DB_QUERY_TIMEOUT", 30.0)
TO_THREAD_TIMEOUT_S = env_float("MAJOOR_TO_THREAD_TIMEOUT", 30.0)
MAX_METADATA_JSON_BYTES = _env_int("MAJOOR_MAX_METADATA_JSON_BYTES", 2 * 1024 * 1024)  # 2MB
METADATA_CACHE_MAX = _env_int("MAJOOR_METADATA_CACHE_MAX", 100_000)
METADATA_CACHE_TTL_SECONDS = env_float("MAJOOR_METADATA_CACHE_TTL_SECONDS", 90.0 * 24.0 * 3600.0)
METADATA_CACHE_CLEANUP_INTERVAL_SECONDS = env_float("MAJOOR_METADATA_CACHE_CLEANUP_INTERVAL_SECONDS", 300.0)
METADATA_EXTRACT_CONCURRENCY = _env_int("MAJOOR_METADATA_EXTRACT_CONCURRENCY", 1)

# Index dedupe (avoid double-indexing bursts from multiple event sources)
INDEX_DEDUPE_TTL_SECONDS = env_float("MAJOOR_INDEX_DEDUPE_TTL_SECONDS", 2.0)
INDEX_DEDUPE_MAX = _env_int("MAJOOR_INDEX_DEDUPE_MAX", 5000)

# File watcher (watches for manual file additions in output/custom directories)
# Disable with MJR_ENABLE_WATCHER=0
WATCHER_ENABLED = os.getenv("MJR_ENABLE_WATCHER", "1").strip().lower() not in ("0", "false", "no", "off")
WATCHER_DEFAULT_DEBOUNCE_MS = _env_int("MJR_WATCHER_DEBOUNCE_MS", 500)
WATCHER_DEFAULT_DEDUPE_TTL_MS = _env_int("MJR_WATCHER_DEDUPE_TTL_MS", 3000)
WATCHER_DEBOUNCE_MS = WATCHER_DEFAULT_DEBOUNCE_MS
WATCHER_DEDUPE_TTL_MS = WATCHER_DEFAULT_DEDUPE_TTL_MS
WATCHER_MAX_FILE_SIZE_BYTES = _env_int("MJR_WATCHER_MAX_FILE_SIZE_BYTES", 512 * 1024 * 1024)
WATCHER_FLUSH_MAX_FILES = _env_int("MJR_WATCHER_FLUSH_MAX_FILES", 256)
WATCHER_STREAM_ALERT_WINDOW_SECONDS = env_float("MJR_WATCHER_STREAM_ALERT_WINDOW_SECONDS", 60.0)
WATCHER_STREAM_ALERT_THRESHOLD = _env_int("MJR_WATCHER_STREAM_ALERT_THRESHOLD", 512)
WATCHER_STREAM_ALERT_COOLDOWN_SECONDS = env_float("MJR_WATCHER_STREAM_ALERT_COOLDOWN_SECONDS", 300.0)
WATCHER_MAX_FLUSH_CONCURRENCY = max(1, _env_int("MJR_WATCHER_MAX_FLUSH_CONCURRENCY", 2))
WATCHER_PENDING_MAX = _env_int("MJR_WATCHER_PENDING_MAX", 5000)

# Background scan / filesystem listing tuning
BG_SCAN_FAILURE_HISTORY_MAX = _env_int("MAJOOR_BG_SCAN_FAILURE_HISTORY_MAX", 50)
SCAN_PENDING_MAX = _env_int("MAJOOR_SCAN_PENDING_MAX", 64)
MANUAL_BG_SCAN_GRACE_SECONDS = env_float("MAJOOR_MANUAL_BG_SCAN_GRACE_SECONDS", 30.0)
BG_SCAN_ON_LIST = os.getenv("MAJOOR_BG_SCAN_ON_LIST", "0").strip().lower() in ("1", "true", "yes", "on")
SEARCH_MAX_LIMIT = _env_int("MAJOOR_SEARCH_MAX_LIMIT", 500)
SEARCH_MAX_OFFSET = _env_int("MAJOOR_SEARCH_MAX_OFFSET", 10_000)

# Filesystem listing cache (used by filesystem fallback search/list)
FS_LIST_CACHE_MAX = _env_int("MAJOOR_FS_LIST_CACHE_MAX", 32)
FS_LIST_CACHE_TTL_SECONDS = env_float("MAJOOR_FS_LIST_CACHE_TTL_SECONDS", 1.5)
# Scanner batching (bounded transactions)
# Tweak only if you know your workload; larger batches reduce transaction overhead but increase lock time.
SCAN_BATCH_SMALL_THRESHOLD = _env_int("MAJOOR_SCAN_BATCH_SMALL_THRESHOLD", 100)
SCAN_BATCH_MED_THRESHOLD = _env_int("MAJOOR_SCAN_BATCH_MED_THRESHOLD", 1000)
SCAN_BATCH_LARGE_THRESHOLD = _env_int("MAJOOR_SCAN_BATCH_LARGE_THRESHOLD", 10000)
# Default to fewer DB transactions for typical directories (~100-500 files).
SCAN_BATCH_SMALL = _env_int("MAJOOR_SCAN_BATCH_SMALL", 50)
SCAN_BATCH_MED = _env_int("MAJOOR_SCAN_BATCH_MED", 50)
SCAN_BATCH_LARGE = _env_int("MAJOOR_SCAN_BATCH_LARGE", 100)

# Search limits
SEARCH_MAX_QUERY_LENGTH = _env_int("MJR_SEARCH_MAX_QUERY_LENGTH", 512)
SEARCH_MAX_TOKENS = _env_int("MJR_SEARCH_MAX_TOKENS", 16)
SEARCH_MAX_TOKEN_LENGTH = _env_int("MJR_SEARCH_MAX_TOKEN_LENGTH", 64)
SEARCH_MAX_BATCH_IDS = _env_int("MJR_SEARCH_MAX_BATCH_IDS", 200)
SEARCH_MAX_FILEPATH_LOOKUP = _env_int("MJR_SEARCH_MAX_FILEPATH_LOOKUP", 5000)
SCAN_BATCH_XL = _env_int("MAJOOR_SCAN_BATCH_XL", 200)

# Scanner limits
MAX_TO_ENRICH_ITEMS = _env_int("MAJOOR_MAX_TO_ENRICH_ITEMS", 10000)

