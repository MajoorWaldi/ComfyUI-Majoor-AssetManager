from pathlib import Path


def test_files_equal_content(tmp_path: Path):
    from backend.routes.handlers.scan import _files_equal_content

    a = tmp_path / "a.bin"
    b = tmp_path / "b.bin"
    c = tmp_path / "c.bin"

    a.write_bytes(b"hello world")
    b.write_bytes(b"hello world")
    c.write_bytes(b"hello wor1d")

    assert _files_equal_content(a, b) is True
    assert _files_equal_content(a, c) is False


def test_resolve_stage_destination_reuses_identical_file(tmp_path: Path):
    from backend.routes.handlers.scan import _resolve_stage_destination

    src = tmp_path / "src.bin"
    src.write_bytes(b"x" * 1024)

    dest_dir = tmp_path / "dest"
    dest_dir.mkdir()

    existing = dest_dir / "file.bin"
    existing.write_bytes(b"x" * 1024)

    resolved = _resolve_stage_destination(dest_dir, "file.bin", src)
    assert resolved.reused_existing is True
    assert resolved.path == existing


def test_resolve_stage_destination_increments_on_conflict(tmp_path: Path):
    from backend.routes.handlers.scan import _resolve_stage_destination

    src = tmp_path / "src.bin"
    src.write_bytes(b"aaa")

    dest_dir = tmp_path / "dest"
    dest_dir.mkdir()

    existing = dest_dir / "file.bin"
    existing.write_bytes(b"bbb")

    resolved = _resolve_stage_destination(dest_dir, "file.bin", src)
    assert resolved.reused_existing is False
    assert resolved.path.name == "file_1.bin"

