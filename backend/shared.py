"""Backend-facing alias for shared utilities.

This file exists because ComfyUI can load custom nodes either:
- as a pseudo-package via file paths under `custom_nodes/`, or
- as top-level modules when running tests/scripts.

All imports here are therefore best-effort and must not crash the UI.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import shared as _root_shared
else:
    try:
        # When loaded by ComfyUI as a package (e.g. <extension>.backend.*)
        from .. import shared as _root_shared  # type: ignore
    except Exception:
        # When running tests or scripts that import `backend.*` as a top-level module
        import shared as _root_shared  # type: ignore

Result = _root_shared.Result
ErrorCode = _root_shared.ErrorCode
get_logger = _root_shared.get_logger
log_success = _root_shared.log_success
log_structured = _root_shared.log_structured
request_id_var = getattr(_root_shared, "request_id_var", None)
classify_file = _root_shared.classify_file
sanitize_error_message = _root_shared.sanitize_error_message
FileKind = _root_shared.FileKind
MetadataQuality = _root_shared.MetadataQuality
IndexMode = _root_shared.IndexMode
MetadataMode = _root_shared.MetadataMode

if TYPE_CHECKING:
    from shared.types import EXTENSIONS as EXTENSIONS
else:
    try:
        from ..shared.types import EXTENSIONS as EXTENSIONS  # type: ignore
    except Exception:
        try:
            from shared.types import EXTENSIONS as EXTENSIONS  # type: ignore
        except Exception:
            EXTENSIONS: dict[str, Any] = {}

__all__ = _root_shared.__all__ + [
    "Result",
    "ErrorCode",
    "get_logger",
    "log_success",
    "log_structured",
    "request_id_var",
    "classify_file",
    "FileKind",
    "MetadataQuality",
    "IndexMode",
    "MetadataMode",
    "EXTENSIONS",
    "sanitize_error_message",
]
