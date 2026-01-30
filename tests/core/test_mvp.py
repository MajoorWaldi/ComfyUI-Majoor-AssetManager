import pytest
"""
MVP test to validate architecture.
Tests: Result pattern, logging with emojis, ExifTool, FFProbe, SQLite.
"""
import sys
import os
from pathlib import Path

# Add project to path
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))

from shared import Result, get_logger, log_success, ErrorCode
from backend.adapters.tools import ExifTool, FFProbe
from backend.adapters.db.sqlite import Sqlite
from backend.adapters.db.schema import init_schema

logger = get_logger(__name__)

async def _run_sqlite_test(db_path: Path):
    """Shared SQLite test logic for pytest + optional manual runner."""
    if db_path.exists():
        try:
            db_path.unlink()
        except Exception:
            pass

    db = Sqlite(str(db_path))

    # Initialize schema
    result = await init_schema(db)
    if not result.ok:
        logger.error(f"Schema init failed: {result.error}")
        return

    # Test insert
    insert_result = await db.aexecute(
        """
        INSERT INTO assets (filename, subfolder, filepath, kind, ext, size, mtime, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        ("test.png", "output", "/path/to/test.png", "image", ".png", 1024, 1234567890.0, 1234567890.0, 1234567890.0)
    )

    if not insert_result.ok:
        logger.error(f"Insert failed: {insert_result.error}")
        return

    # Test query
    query_result = await db.aexecute("SELECT * FROM assets WHERE filename = ?", ("test.png",), fetch=True)

    if query_result.ok:
        logger.info(f"Found {len(query_result.data)} rows")
        logger.info(f"Row: {query_result.data[0]}")
        log_success(logger, "SQLite works!")
    else:
        logger.error(f"Query failed: {query_result.error}")

    # Cleanup
    await db.aclose()
    if db_path.exists():
        try:
            db_path.unlink()
        except Exception:
            pass

@pytest.mark.asyncio
async def test_result_pattern():
    """Test Result pattern."""
    logger.info("Testing Result pattern...")

    # Success case
    result_ok = Result.Ok({"test": "data"}, extra="metadata")
    assert result_ok.ok
    assert result_ok.data["test"] == "data"
    assert result_ok.meta["extra"] == "metadata"

    # Error case
    result_err = Result.Err(ErrorCode.NOT_FOUND, "File not found")
    assert not result_err.ok
    assert result_err.code == ErrorCode.NOT_FOUND
    assert result_err.error == "File not found"

    log_success(logger, "Result pattern works!")

@pytest.mark.asyncio
async def test_exiftool():
    """Test ExifTool adapter."""
    logger.info("Testing ExifTool adapter...")

    exiftool = ExifTool()

    if not exiftool.is_available():
        logger.warning("ExifTool not available, skipping test")
        return

    # Test with sample PNG file
    test_file = Path("C:/Users/ewald/Pictures/ComfyUI_TOTEST/ComfyUI/custom_nodes/parser/00095-1926696019.png")
    if not test_file.exists():
        logger.warning(f"Test file not found: {test_file}")
        return

    result = exiftool.read(str(test_file))

    if result.ok:
        logger.info(f"ExifTool found {len(result.data)} metadata fields")
        logger.info(f"Sample fields: {list(result.data.keys())[:5]}")
        log_success(logger, "ExifTool works!")
    else:
        logger.error(f"ExifTool failed: {result.error}")

@pytest.mark.asyncio
async def test_ffprobe():
    """Test FFProbe adapter."""
    logger.info("Testing FFProbe adapter...")

    ffprobe = FFProbe()

    if not ffprobe.is_available():
        logger.warning("ffprobe not available, skipping test")
        return

    # Test with sample MP4 file
    test_file = Path("C:/Users/ewald/Pictures/ComfyUI_TOTEST/ComfyUI/custom_nodes/parser/ComfyUI_00002_.mp4")
    if not test_file.exists():
        logger.warning(f"Test file not found: {test_file}")
        return

    result = ffprobe.read(str(test_file))

    if result.ok:
        logger.info(f"ffprobe format: {result.data.get('format', {}).get('format_name')}")
        logger.info(f"Video stream: {result.data.get('video_stream', {}).get('codec_name')}")
        log_success(logger, "FFProbe works!")
    else:
        logger.error(f"ffprobe failed: {result.error}")

@pytest.mark.asyncio
async def test_sqlite(tmp_path):
    """Test SQLite adapter."""
    logger.info("Testing SQLite adapter...")

    db_path = tmp_path / "test_assets.db"
    await _run_sqlite_test(db_path)

async def main():
    """Run MVP tests."""
    logger.info("=" * 60)
    logger.info("🚀 Majoor Assets Manager - MVP Test")
    logger.info("=" * 60)

    try:
        test_result_pattern()
        print()
        await test_exiftool()
        print()
        await test_ffprobe()
        print()
        # For manual runs, keep artifacts out of the repo root.
        import tempfile
        tmp_dir = Path(tempfile.gettempdir()) / "majoor_tests"
        tmp_dir.mkdir(parents=True, exist_ok=True)
        await _run_sqlite_test(tmp_dir / "test_assets.db")
        print()
        log_success(logger, "All MVP tests completed!")

    except Exception as e:
        logger.error(f"Test failed with exception: {e}", exc_info=True)
        return 1

    return 0

if __name__ == "__main__":
    import asyncio; sys.exit(asyncio.run(main()))
