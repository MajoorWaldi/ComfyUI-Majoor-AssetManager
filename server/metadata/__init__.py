from .core import update_metadata, update_metadata_with_windows, get_metadata, deep_merge_metadata  # noqa: F401

# Enhanced metadata extraction (new)
try:
    from .enhanced_extraction import (  # noqa: F401
        extract_enhanced_metadata,
        write_enhanced_metadata,
        extract_workflow_hash,
        get_metadata_source_info
    )
    _ENHANCED_AVAILABLE = True
except ImportError:
    _ENHANCED_AVAILABLE = False

if _ENHANCED_AVAILABLE:
    __all__ = [
        "update_metadata",
        "update_metadata_with_windows",
        "deep_merge_metadata",
        "get_metadata",
        "extract_enhanced_metadata",
        "write_enhanced_metadata",
        "extract_workflow_hash",
        "get_metadata_source_info"
    ]
else:
    __all__ = ["update_metadata", "update_metadata_with_windows", "deep_merge_metadata", "get_metadata"]
