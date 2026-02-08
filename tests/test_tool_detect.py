from backend.tool_detect import parse_tool_version, version_satisfies_minimum


def test_parse_tool_version_extracts_digits() -> None:
    assert parse_tool_version("ExifTool Version Number : 12.40") == (12, 40)
    assert parse_tool_version("ffprobe version 6.0.0") == (6, 0, 0)
    assert parse_tool_version("") == ()


def test_version_satisfies_minimum_logic() -> None:
    assert version_satisfies_minimum("12.40", "12.20")
    assert not version_satisfies_minimum("12.15", "12.20")
    assert not version_satisfies_minimum(None, "1.0")
    assert version_satisfies_minimum("6.0.0", "")
