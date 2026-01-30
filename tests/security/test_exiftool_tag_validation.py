import pytest
from backend.adapters.tools.exiftool import _is_safe_exiftool_tag, _validate_exiftool_tags


@pytest.mark.asyncio
async def test_is_safe_exiftool_tag_accepts_common_groups():
    assert _is_safe_exiftool_tag("XMP-xmp:Rating")
    assert _is_safe_exiftool_tag("XMP-dc:Subject")
    assert _is_safe_exiftool_tag("Microsoft:SharedUserRating")
    assert _is_safe_exiftool_tag("RatingPercent")


@pytest.mark.asyncio
async def test_is_safe_exiftool_tag_rejects_whitespace_and_weird_chars():
    assert not _is_safe_exiftool_tag("")
    assert not _is_safe_exiftool_tag("  ")
    assert not _is_safe_exiftool_tag("XMP:Foo Bar")
    assert not _is_safe_exiftool_tag("XMP:Foo\tBar")
    assert not _is_safe_exiftool_tag("XMP:Foo\nBar")
    assert not _is_safe_exiftool_tag("-execute")
    assert not _is_safe_exiftool_tag("XMP:Foo;rm -rf")


@pytest.mark.asyncio
async def test_validate_exiftool_tags_is_strict():
    res = _validate_exiftool_tags(["XMP-xmp:Rating", "Bad Tag"])
    assert not res.ok
    assert res.code == "INVALID_INPUT"
    assert "invalid_tags" in (res.meta or {})

