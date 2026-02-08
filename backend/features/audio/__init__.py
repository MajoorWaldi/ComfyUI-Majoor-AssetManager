"""
Audio feature module.

Keeps audio-specific format/metadata/geninfo logic isolated from image/video code paths.
"""

from .constants import AUDIO_EXTENSIONS, AUDIO_VIEW_MIME_TYPES
from .metadata import extract_audio_metadata

__all__ = [
    "AUDIO_EXTENSIONS",
    "AUDIO_VIEW_MIME_TYPES",
    "extract_audio_metadata",
]

