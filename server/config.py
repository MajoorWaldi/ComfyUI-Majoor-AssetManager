import os
import sys
from folder_paths import get_output_directory

OUTPUT_ROOT = get_output_directory()

# FIX: Standardize platform detection using sys.platform consistently
# sys.platform returns "win32" for all Windows versions (including 64-bit)
IS_WINDOWS = sys.platform == "win32"

# Sidecar JSON files are optional; default to Windows metadata on Windows
_DEFAULT_SIDECAR = not IS_WINDOWS
_SIDECAR_ENV = os.environ.get("MJR_ENABLE_SIDECAR")
if _SIDECAR_ENV is None:
    ENABLE_JSON_SIDECAR = _DEFAULT_SIDECAR
else:
    ENABLE_JSON_SIDECAR = str(_SIDECAR_ENV).strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    )

METADATA_EXT = ".mjr.json"
COLLECTIONS_DIR = os.path.join(OUTPUT_ROOT, "_mjr_collections")
os.makedirs(COLLECTIONS_DIR, exist_ok=True)

# SQLite index configuration
INDEX_DIR = os.path.join(OUTPUT_ROOT, "_mjr_index")
INDEX_DB = os.path.join(INDEX_DIR, "assets.sqlite")

# ===== Metadata Extraction Configuration (New) =====

# Metadata extraction mode
# - "legacy": Use existing Windows Property Store / ExifTool / sidecar only
# - "hybrid": Try new parsers first, fallback to legacy if they fail
# - "native": Use only new parsers (EXIF UserComment, ComfyUI tracer, PNG inject)
_METADATA_MODE_ENV = os.environ.get("MJR_METADATA_MODE", "hybrid").lower()
if _METADATA_MODE_ENV not in ("legacy", "hybrid", "native"):
    _METADATA_MODE_ENV = "hybrid"
METADATA_MODE = _METADATA_MODE_ENV

# Feature flags for new metadata parsers
# Enable native EXIF UserComment decoder (multi-encoding support)
METADATA_EXIF_NATIVE = os.environ.get("MJR_METADATA_EXIF_NATIVE", "1").strip() not in ("0", "false", "no", "off")

# Enable recursive ComfyUI node tracer v2 (vs simple prompt extraction)
METADATA_COMFY_TRACE_V2 = os.environ.get("MJR_COMFY_TRACE_V2", "1").strip() not in ("0", "false", "no", "off")

# Enable lossless PNG metadata injection (vs ExifTool/sidecar only)
METADATA_PNG_INJECT = os.environ.get("MJR_METADATA_PNG_INJECT", "1").strip() not in ("0", "false", "no", "off")

# Enable workflow fingerprinting (stable hash)
METADATA_WORKFLOW_HASH = os.environ.get("MJR_METADATA_WORKFLOW_HASH", "1").strip() not in ("0", "false", "no", "off")

# Debug logging for metadata extraction
METADATA_DEBUG = os.environ.get("MJR_DEBUG_METADATA", "0").strip() not in ("0", "false", "no", "off")

# Fallback behavior on extraction errors
# If True, silently fallback to legacy parsers on error
# If False, log errors but continue (don't crash)
METADATA_SAFE_FALLBACK = os.environ.get("MJR_METADATA_SAFE_FALLBACK", "1").strip() not in ("0", "false", "no", "off")

# Indexing mode: 'auto' runs the SQLite index/watchdog,
# 'index' forces reindex even if filesystem-first UI is configured,
# 'filesystem' disables the index entirely and relies on filesystem scans (default).
_INDEX_MODE_ENV = os.environ.get("MJR_INDEX_MODE", "filesystem").strip().lower()
if _INDEX_MODE_ENV not in ("auto", "index", "filesystem"):
    _INDEX_MODE_ENV = "filesystem"
INDEX_MODE = _INDEX_MODE_ENV
