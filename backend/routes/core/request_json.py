"""
Safe JSON request parsing with size limits.

Guarantees:
- Never raises to handlers (returns Result)
- Enforces an upper bound on JSON payload size to avoid memory DoS
"""

from __future__ import annotations

import json
import os
from typing import Any, Optional

from aiohttp import web

from backend.shared import Result, ErrorCode

DEFAULT_MAX_JSON_BYTES = 10 * 1024 * 1024  # 10MB
MIN_JSON_BYTES = 1024
REQUEST_STREAM_CHUNK_BYTES = 64 * 1024


def _max_json_bytes() -> int:
    try:
        raw = os.environ.get("MJR_MAX_JSON_SIZE", "")
        if raw:
            n = int(raw)
            if n > 0:
                return n
    except Exception:
        pass
    return DEFAULT_MAX_JSON_BYTES


async def _read_json(request: web.Request, *, max_bytes: Optional[int] = None) -> Result[dict]:
    """
    Read and decode a JSON request body with a strict max size.

    Returns:
        Result.Ok(dict) or Result.Err(code, error, ...)
    """
    limit = int(max_bytes) if max_bytes is not None else _max_json_bytes()
    limit = max(MIN_JSON_BYTES, limit)

    # Fast path: reject obviously too large bodies by Content-Length.
    try:
        cl = request.headers.get("Content-Length")
        if cl:
            size = int(cl)
            if size > limit:
                return Result.Err(ErrorCode.INVALID_INPUT, f"JSON body too large ({size} > {limit})", limit=limit, size=size)
    except Exception:
        pass

    # Stream the body to enforce the limit even when Content-Length is missing/incorrect.
    buf = bytearray()
    try:
        async for chunk in request.content.iter_chunked(REQUEST_STREAM_CHUNK_BYTES):
            if not chunk:
                continue
            buf.extend(chunk)
            if len(buf) > limit:
                return Result.Err(ErrorCode.INVALID_INPUT, f"JSON body too large (> {limit})", limit=limit, size=len(buf))
    except Exception as exc:
        return Result.Err(ErrorCode.INVALID_JSON, f"Failed to read request body: {exc}")

    try:
        text = bytes(buf).decode("utf-8", errors="strict")
    except Exception as exc:
        return Result.Err(ErrorCode.INVALID_JSON, f"Invalid UTF-8 JSON body: {exc}")

    try:
        parsed: Any = json.loads(text) if text else {}
    except Exception as exc:
        return Result.Err(ErrorCode.INVALID_JSON, f"Invalid JSON body: {exc}")

    if not isinstance(parsed, dict):
        return Result.Err(ErrorCode.INVALID_JSON, "JSON body must be an object")
    return Result.Ok(parsed)
