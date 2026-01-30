import pytest
from backend.features.metadata.extractors import extract_png_metadata


@pytest.mark.asyncio
async def test_extracts_rating_from_exiftool_grouped_xmp_keys(tmp_path):
    f = tmp_path / "rated.png"
    f.write_bytes(b"x")

    # ExifTool with `-G1 -s` yields grouped keys like `XMP-xmp:Rating`.
    exif = {"XMP-xmp:Rating": 2, "XMP-microsoft:RatingPercent": 25}
    res = extract_png_metadata(str(f), exif)
    assert res.ok
    assert res.data.get("rating") == 2


@pytest.mark.asyncio
async def test_extracts_tags_from_exiftool_grouped_xmp_keys(tmp_path):
    f = tmp_path / "tags.png"
    f.write_bytes(b"x")

    exif = {"XMP-dc:Subject": ["foo", "bar; baz"], "XMP-microsoft:Category": "alpha; beta"}
    res = extract_png_metadata(str(f), exif)
    assert res.ok
    assert set(res.data.get("tags") or []) >= {"foo", "bar", "baz", "alpha", "beta"}

