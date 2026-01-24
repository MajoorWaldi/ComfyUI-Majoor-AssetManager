import os
from pathlib import Path

from backend.adapters.tools.exiftool import _build_match_map, _normalize_match_path


def test_build_match_map_dedupes_identical_paths(tmp_path: Path):
    f = tmp_path / "a.txt"
    f.write_text("hello", encoding="utf-8")
    p = str(f)

    key_to_paths, cmd_paths = _build_match_map([p, p])

    assert len(cmd_paths) == 1
    assert cmd_paths[0] == p
    assert len(key_to_paths) == 1
    only_key = next(iter(key_to_paths))
    assert key_to_paths[only_key] == [p, p]


def test_normalize_match_path_is_case_insensitive_on_windows(tmp_path: Path):
    f = tmp_path / "MiXeD.txt"
    f.write_text("hello", encoding="utf-8")

    norm1 = _normalize_match_path(str(f))
    assert norm1

    if os.name != "nt":
        return

    upper = str(f).upper()
    norm2 = _normalize_match_path(upper)
    assert norm2
    assert norm1 == norm2

