from pathlib import Path

import pytest

from mjr_am_backend.features.index.scanner import IndexScanner


class _NoopDb:
    pass


class _NoopMetadata:
    pass


def _make_scanner() -> IndexScanner:
    import asyncio

    return IndexScanner(_NoopDb(), _NoopMetadata(), asyncio.Lock())


@pytest.mark.skipif(not hasattr(Path, "symlink_to"), reason="Symlink API unavailable on this platform")
def test_iter_files_recursive_includes_symlinked_files(tmp_path: Path):
    scanner = _make_scanner()
    src = tmp_path / "real.png"
    src.write_bytes(b"x")

    link = tmp_path / "link.png"
    try:
        link.symlink_to(src)
    except OSError:
        pytest.skip("Symlink creation is not permitted in this environment")

    files = list(scanner._iter_files(tmp_path, recursive=True))
    names = {p.name for p in files}
    assert "real.png" in names
    assert "link.png" in names
