from __future__ import annotations
import pytest

from pathlib import Path

from backend.routes.core.paths import _guess_content_type_for_file


@pytest.mark.asyncio
async def test_guess_content_type_has_explicit_modern_media_mappings() -> None:
    assert _guess_content_type_for_file(Path("x.webp")) == "image/webp"
    assert _guess_content_type_for_file(Path("x.gif")) == "image/gif"
    assert _guess_content_type_for_file(Path("x.webm")) == "video/webm"
    assert _guess_content_type_for_file(Path("x.avif")) == "image/avif"
    assert _guess_content_type_for_file(Path("x.wav")) == "audio/wav"
    assert _guess_content_type_for_file(Path("x.aiff")) == "audio/aiff"

