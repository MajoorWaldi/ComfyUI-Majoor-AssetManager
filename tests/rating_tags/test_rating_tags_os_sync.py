from pathlib import Path

from backend.features.tags.sync import write_exif_rating_tags
from backend.shared import Result


class _ExifToolCapture:
    def __init__(self):
        self.calls = []

    def is_available(self) -> bool:
        return True

    def write(self, path: str, metadata: dict, preserve_workflow: bool = True):
        self.calls.append((path, metadata, preserve_workflow))
        return Result.Ok(True)


def test_exiftool_payload_contains_windows_and_xmp_fields(tmp_path: Path):
    f = tmp_path / "video.mp4"
    f.write_bytes(b"x")

    ex = _ExifToolCapture()
    res = write_exif_rating_tags(ex, str(f), 4, ["foo", "bar"])
    assert res.ok is True
    assert ex.calls

    _, payload, preserve = ex.calls[-1]
    assert preserve is True

    # rating fields
    assert payload["XMP:Rating"] == 4
    assert payload["ratingpercent"] in (75, 99, 50, 25, 1, 0)
    assert payload["Microsoft:SharedUserRating"] == payload["ratingpercent"]

    # tags/keywords fields
    assert payload["XMP:Subject"] == ["foo", "bar"]
    assert payload["IPTC:Keywords"] == ["foo", "bar"]
    assert "foo" in payload["Microsoft:Category"]
    assert "bar" in payload["Microsoft:Category"]


def test_exiftool_payload_clears_tags_when_empty(tmp_path: Path):
    f = tmp_path / "image.png"
    f.write_bytes(b"x")

    ex = _ExifToolCapture()
    res = write_exif_rating_tags(ex, str(f), 0, [])
    assert res.ok is True

    _, payload, _ = ex.calls[-1]
    assert payload["XMP:Subject"] == []
    assert payload["IPTC:Keywords"] == []
    assert payload["Microsoft:Category"] == ""

