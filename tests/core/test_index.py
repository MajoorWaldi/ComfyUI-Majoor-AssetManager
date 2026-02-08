"""
Test the index service with real files.
"""
import pytest
import sys
from pathlib import Path


# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent))

from shared import get_logger, log_success
from backend.deps import build_services

logger = get_logger(__name__)

@pytest.mark.asyncio
async def test_index_service(tmp_path):
    """Test index service with real directories."""
    logger.info("=" * 60)
    logger.info("Testing Index Service")
    logger.info("=" * 60)

    # Build services
    db_path = tmp_path / "test_index.db"

    services_res = await build_services(str(db_path))
    assert services_res.ok, services_res.error
    services = services_res.data
    index_service = services["index"]
    parser_dir = Path(__file__).parent.parent / "parser"
    logger.info(f"\nTest 1: Scanning {parser_dir}")

    result = await index_service.scan_directory(
        directory=str(parser_dir),
        recursive=True,
        incremental=False
    )

    if result.ok:
        log_success(logger, "Scan completed!")
        stats = result.data
        logger.info(f"  Scanned: {stats['scanned']}")
        logger.info(f"  Added: {stats['added']}")
        logger.info(f"  Updated: {stats['updated']}")
        logger.info(f"  Skipped: {stats['skipped']}")
        logger.info(f"  Errors: {stats['errors']}")
    else:
        logger.error(f"Scan failed: {result.error}")
        return

    # Test 2: Search for PNG files
    logger.info("\nTest 2: Search for PNG files")

    result = await index_service.search(
        query="png",
        limit=10,
        filters={"kind": "image"}
    )
    if result.ok:
        data = result.data
        logger.info(f"  Total results: {data['total']}")
        logger.info(f"  Returned: {len(data['assets'])} assets")

        for i, asset in enumerate(data['assets'][:3], 1):
            logger.info(f"\n  Asset {i}:")
            logger.info(f"    ID: {asset['id']}")
            logger.info(f"    Filename: {asset['filename']}")
            logger.info(f"    Kind: {asset['kind']}")
            logger.info(f"    Size: {asset.get('width', '?')}x{asset.get('height', '?')}")
            logger.info(f"    Has workflow: {bool(asset['has_workflow'])}")
    else:
        logger.error(f"Search failed: {result.error}")
        return

    # Test 3: Search by filename
    logger.info("\nTest 3: Search by filename pattern")

    result = await index_service.search(
        query="test",
        limit=10
    )

    if result.ok:
        log_success(logger, "Filename search completed!")
        data = result.data
        logger.info(f"  Found {data['total']} matches for 'test'")

        for asset in data['assets'][:3]:
            logger.info(f"    - {asset['filename']}")
    else:
        logger.error(f"Search failed: {result.error}")

    # Test 4: Get single asset
    logger.info("\nTest 4: Get single asset by ID")

    result = await index_service.get_asset(1)

    if result.ok:
        asset = result.data
        if asset:
            log_success(logger, "Retrieved asset!")
            logger.info(f"  Filename: {asset['filename']}")
            logger.info(f"  Filepath: {asset['filepath']}")
            logger.info(f"  Kind: {asset['kind']}")
            logger.info(f"  Tags: {asset['tags']}")
        else:
            logger.warning("No asset with ID 1")
    else:
        logger.error(f"Get asset failed: {result.error}")

    # Test 5: Incremental scan (should skip unchanged files)
    logger.info("\nTest 5: Incremental scan (should skip unchanged)")

    result = await index_service.scan_directory(
        directory=str(parser_dir),
        recursive=True,
        incremental=True
    )

    if result.ok:
        log_success(logger, "Incremental scan completed!")
        stats = result.data
        logger.info(f"  Scanned: {stats['scanned']}")
        logger.info(f"  Added: {stats['added']}")
        logger.info(f"  Updated: {stats['updated']}")
        logger.info(f"  Skipped: {stats['skipped']} (should be most files)")
    else:
        logger.error(f"Incremental scan failed: {result.error}")

    logger.info("\n" + "=" * 60)
    log_success(logger, "All index tests completed!")
    logger.info("=" * 60)

if __name__ == "__main__":
    test_index_service()
