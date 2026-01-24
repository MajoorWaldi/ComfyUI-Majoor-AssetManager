"""
Configuration for Majoor Assets Manager.
"""
import os
import sys
import logging
from pathlib import Path

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
    return TOOL_LOCATIONS.copy()

# Media probe backend setting
# Options: "auto" (recommended), "exiftool", "ffprobe", "both"
MEDIA_PROBE_BACKEND = os.getenv("MAJOOR_MEDIA_PROBE_BACKEND", "auto")

# Performance tuning defaults
def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.lower() in ("1", "true", "yes", "on")

def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except (TypeError, ValueError):
        return default

def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except (TypeError, ValueError):
        return default

ENABLE_FILE_WATCHER = _env_bool("MAJOOR_ENABLE_FILE_WATCHER", False)
WATCHER_INTERVAL_SECONDS = _env_float("MAJOOR_WATCHER_INTERVAL", 15.0)
WATCHER_JOIN_TIMEOUT = _env_float("MAJOOR_WATCHER_JOIN_TIMEOUT", 5.0)
WATCHER_PATHS = []
for raw_path in os.getenv("MAJOOR_WATCHER_PATHS", OUTPUT_ROOT).split(os.pathsep):
    cleaned = raw_path.strip()
    if not cleaned:
        continue
    try:
        WATCHER_PATHS.append(Path(cleaned).resolve())
    except (OSError, RuntimeError, ValueError):
        logger.warning("Invalid path in MAJOOR_WATCHER_PATHS: %r", raw_path)
        continue

if not WATCHER_PATHS:
    WATCHER_PATHS = [OUTPUT_ROOT_PATH]

# Tool timeouts
EXIFTOOL_TIMEOUT = _env_int("MAJOOR_EXIFTOOL_TIMEOUT", 15)
FFPROBE_TIMEOUT = _env_int("MAJOOR_FFPROBE_TIMEOUT", 10)

# Database tuning
DB_TIMEOUT = _env_float("MAJOOR_DB_TIMEOUT", 30.0)
DB_MAX_CONNECTIONS = _env_int("MAJOOR_DB_MAX_CONNECTIONS", 8)
DB_QUERY_TIMEOUT = _env_float("MAJOOR_DB_QUERY_TIMEOUT", 30.0)
TO_THREAD_TIMEOUT_S = _env_float("MAJOOR_TO_THREAD_TIMEOUT", 30.0)
MAX_METADATA_JSON_BYTES = _env_int("MAJOOR_MAX_METADATA_JSON_BYTES", 2 * 1024 * 1024)  # 2MB

# Background scan / filesystem listing tuning
BG_SCAN_FAILURE_HISTORY_MAX = _env_int("MAJOOR_BG_SCAN_FAILURE_HISTORY_MAX", 50)
SCAN_PENDING_MAX = _env_int("MAJOOR_SCAN_PENDING_MAX", 64)

# Filesystem listing cache (used by filesystem fallback search/list)
FS_LIST_CACHE_MAX = _env_int("MAJOOR_FS_LIST_CACHE_MAX", 32)
FS_LIST_CACHE_TTL_SECONDS = _env_float("MAJOOR_FS_LIST_CACHE_TTL_SECONDS", 1.5)
FS_LIST_CACHE_WATCHDOG = _env_bool("MAJOOR_FS_LIST_CACHE_WATCHDOG", True)

# Scanner batching (bounded transactions)
# Tweak only if you know your workload; larger batches reduce transaction overhead but increase lock time.
SCAN_BATCH_SMALL_THRESHOLD = _env_int("MAJOOR_SCAN_BATCH_SMALL_THRESHOLD", 100)
SCAN_BATCH_MED_THRESHOLD = _env_int("MAJOOR_SCAN_BATCH_MED_THRESHOLD", 1000)
SCAN_BATCH_LARGE_THRESHOLD = _env_int("MAJOOR_SCAN_BATCH_LARGE_THRESHOLD", 10000)
# Default to fewer DB transactions for typical directories (~100-500 files).
SCAN_BATCH_SMALL = _env_int("MAJOOR_SCAN_BATCH_SMALL", 50)
SCAN_BATCH_MED = _env_int("MAJOOR_SCAN_BATCH_MED", 50)
SCAN_BATCH_LARGE = _env_int("MAJOOR_SCAN_BATCH_LARGE", 100)
SCAN_BATCH_XL = _env_int("MAJOOR_SCAN_BATCH_XL", 200)
