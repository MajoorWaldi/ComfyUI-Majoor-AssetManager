"""Metadata extraction feature."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .service import MetadataService

__all__ = ["MetadataService", "extract_png_metadata", "extract_webp_metadata", "extract_video_metadata"]


def __getattr__(name: str):
    if name == "MetadataService":
        from .service import MetadataService as _MetadataService

        return _MetadataService
    if name in ("extract_png_metadata", "extract_webp_metadata", "extract_video_metadata"):
        from .extractors import extract_png_metadata, extract_webp_metadata, extract_video_metadata

        mapping = {
            "extract_png_metadata": extract_png_metadata,
            "extract_webp_metadata": extract_webp_metadata,
            "extract_video_metadata": extract_video_metadata,
        }
        return mapping[name]
    raise AttributeError(name)
