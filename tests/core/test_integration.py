"""
Integration test - validates full service stack.
Tests: DI, services, metadata extraction on real files.
"""
import sys
from pathlib import Path
import pytest

# Fix Windows console encoding
if sys.platform == "win32":
    import os
    os.system("")
    sys.stdout.reconfigure(encoding='utf-8')

from shared import get_logger, log_success

logger = get_logger(__name__)

@pytest.mark.asyncio
async def test_services_build(services):
    """Test service container builds successfully."""
    logger.info("Testing service container...")

    # Verify all services present
    assert "db" in services
    assert "exiftool" in services
    assert "ffprobe" in services
    assert "metadata" in services
    assert "health" in services

    log_success(logger, "Service container built successfully!")

@pytest.mark.asyncio
async def test_health_service(services):
    """Test health service."""
    logger.info("Testing health service...")

    health = services["health"]

    # Get status
    status_result = await health.status()
    assert status_result.ok

    logger.info(f"Health status: {status_result.data['overall']}")
    logger.info(f"ExifTool available: {status_result.data['tools']['exiftool']['available']}")
    logger.info(f"ffprobe available: {status_result.data['tools']['ffprobe']['available']}")

    # Get counters
    counters_result = await health.get_counters()
    assert counters_result.ok

    logger.info(f"Total assets: {counters_result.data.get('total')}")

    log_success(logger, "Health service works!")

@pytest.mark.asyncio
async def test_metadata_service(services):
    """Test metadata extraction on real files."""
    logger.info("Testing metadata service...")

    metadata_service = services["metadata"]

    parser_root = Path(__file__).resolve().parents[1] / "parser"

    png_files = sorted([p for p in parser_root.rglob("*.png") if p.is_file()])
    webp_files = sorted([p for p in parser_root.rglob("*.webp") if p.is_file()])
    mp4_files = sorted([p for p in parser_root.rglob("*.mp4") if p.is_file()])

    # Test PNG file
    if png_files:
        png_file = png_files[0]
        logger.info(f"Testing PNG: {png_file.name}")
        result = metadata_service.get_metadata(str(png_file))

        if result.ok:
            logger.info(f"  Quality: {result.meta.get('quality')}")
            logger.info(f"  Has workflow: {result.data.get('workflow') is not None}")
            logger.info(f"  Has parameters: {result.data.get('parameters') is not None}")
            log_success(logger, "PNG metadata extracted!")
        else:
            logger.warning(f"  Failed: {result.error}")

    # Test WEBP file
    if webp_files:
        webp_file = webp_files[0]
        logger.info(f"Testing WEBP: {webp_file.name}")
        result = metadata_service.get_metadata(str(webp_file))

        if result.ok:
            logger.info(f"  Quality: {result.meta.get('quality')}")
            logger.info(f"  Has workflow: {result.data.get('workflow') is not None}")
            log_success(logger, "WEBP metadata extracted!")
        else:
            logger.warning(f"  Failed: {result.error}")

    # Test MP4 file
    if mp4_files:
        mp4_file = mp4_files[0]
        logger.info(f"Testing MP4: {mp4_file.name}")
        result = metadata_service.get_metadata(str(mp4_file))

        if result.ok:
            logger.info(f"  Quality: {result.meta.get('quality')}")
            logger.info(f"  Has workflow: {result.data.get('workflow') is not None}")
            logger.info(f"  Duration: {result.data.get('duration')}")
            logger.info(f"  Resolution: {result.data.get('resolution')}")
            log_success(logger, "MP4 metadata extracted!")
        else:
            logger.warning(f"  Failed: {result.error}")

def main():
    """Run integration tests."""
    logger.info("=" * 60)
    logger.info("🚀 Majoor Assets Manager - Integration Test")
    logger.info("=" * 60)
    print()

    try:
        # Build services (manual run uses direct build)
        from backend.deps import build_services
        import asyncio
        services_res = asyncio.run(build_services("test_integration.db"))
        if not services_res.ok:
            raise RuntimeError(services_res.error or "Failed to build services")
        services = services_res.data
        print()

        # Test health
        test_health_service(services)
        print()

        # Test metadata extraction
        test_metadata_service(services)
        print()

        log_success(logger, "All integration tests passed!")
        logger.info("=" * 60)

        # Cleanup
        services["db"].close()
        test_db = Path("test_integration.db")
        if test_db.exists():
            test_db.unlink()
            Path("test_integration.db-shm").unlink(missing_ok=True)
            Path("test_integration.db-wal").unlink(missing_ok=True)

        return 0

    except Exception as e:
        logger.error(f"Integration test failed: {e}", exc_info=True)
        return 1

if __name__ == "__main__":
    sys.exit(main())
