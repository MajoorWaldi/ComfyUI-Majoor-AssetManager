"""Shared utilities for Majoor Assets Manager."""
from .result import Result
from .errors import sanitize_error_message
from .log import get_logger, log_success, log_structured, request_id_var
from .time import now, ms, format_timestamp, timer
from .types import FileKind, MetadataQuality, ErrorCode, classify_file, IndexMode, MetadataMode

__all__ = [
    "Result",
    "get_logger",
    "log_success",
    "now",
    "ms",
    "format_timestamp",
    "timer",
    "FileKind",
    "MetadataQuality",
    "ErrorCode",
    "classify_file",
    "IndexMode",
    "MetadataMode",
    "log_structured",
    "request_id_var",
    "sanitize_error_message",
]
