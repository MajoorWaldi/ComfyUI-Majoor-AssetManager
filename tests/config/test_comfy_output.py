"""
Test scanning ComfyUI's actual output directory.
"""
import os
import sys
from pathlib import Path

import pytest

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent))

from shared import get_logger, log_success
from backend.deps import build_services

logger = get_logger(__name__)

@pytest.mark.asyncio
async def test_comfy_output(tmp_path):
    """Test with ComfyUI's actual output directory."""
    logger.info("=" * 60)
    logger.info("Testing ComfyUI Output Directory Scanning")
    logger.info("=" * 60)

    # Build services
    db_path = tmp_path / "comfy_output_test.db"
    services_res = await build_services(str(db_path))
    assert services_res.ok, services_res.error
    services = services_res.data
    index_service = services["index"]
    # ComfyUI output directory.
    # Prefer explicit env override to avoid depending on local ComfyUI install.
    output_dir_env = os.environ.get("MJR_TEST_COMFY_OUTPUT_DIR") or os.environ.get("COMFYUI_OUTPUT_DIR")

    repo_root = Path(__file__).resolve().parents[2]
    comfy_root = None
    output_dir = None
    try:
        if output_dir_env:
            output_dir = Path(output_dir_env)
        elif repo_root.parent.name.lower() == "custom_nodes":
            comfy_root = repo_root.parent.parent
            output_dir = comfy_root / "output"
    except Exception:
        output_dir = None

    logger.info(f"\nComfyUI root: {comfy_root}")
    logger.info(f"Output directory: {output_dir}")

    if not output_dir or not output_dir.exists():
        pytest.skip("ComfyUI output dir not found (set MJR_TEST_COMFY_OUTPUT_DIR to override).")

    # Test 1: Scan ComfyUI output directory
    logger.info("\nTest 1: Full scan of output directory")

    result = await index_service.scan_directory(
        directory=str(output_dir),
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
        logger.info(f"  Duration: {stats['start_time']} -> {stats['end_time']}")
    else:
        logger.error(f"Scan failed: {result.error}")
        return

    # Test 2: Search for images with workflows
    logger.info("\nTest 2: Search for images with ComfyUI workflows")

    result = await index_service.search(
        query="ComfyUI OR AnimateDiff",
        limit=20,
        filters={"has_workflow": True}
    )

    if result.ok:
        log_success(logger, "Search completed!")
        data = result.data
        logger.info(f"  Total results: {data['total']}")
        logger.info(f"  Returned: {len(data['assets'])} assets")

        for i, asset in enumerate(data['assets'][:5], 1):
            logger.info(f"\n  Asset {i}:")
            logger.info(f"    ID: {asset['id']}")
            logger.info(f"    Filename: {asset['filename']}")
            logger.info(f"    Subfolder: {asset['subfolder']}")
            logger.info(f"    Kind: {asset['kind']}")
            logger.info(f"    Size: {asset.get('width', '?')}x{asset.get('height', '?')}")
            if asset.get('duration'):
                logger.info(f"    Duration: {asset['duration']:.2f}s")
            logger.info(f"    Has workflow: {bool(asset['has_workflow'])}")
            logger.info(f"    Rating: {asset['rating']}")
    else:
        logger.error(f"Search failed: {result.error}")
        return

    # Test 3: Search for videos
    logger.info("\nTest 3: Search for video files")

    result = await index_service.search(
        query="mp4 OR video",
        limit=10,
        filters={"kind": "video"}
    )

    if result.ok:
        log_success(logger, "Video search completed!")
        data = result.data
        logger.info(f"  Found {data['total']} video files")

        for asset in data['assets']:
            duration_str = f"{asset.get('duration', 0):.1f}s" if asset.get('duration') else "unknown"
            size_str = f"{asset.get('width', '?')}x{asset.get('height', '?')}"
            logger.info(f"    - {asset['filename']} ({size_str}, {duration_str})")
    else:
        logger.error(f"Search failed: {result.error}")

    # Test 4: Search by subfolder
    logger.info("\nTest 4: Search files in 'test' subfolder")

    result = await index_service.search(
        query="test",
        limit=50
    )

    if result.ok:
        log_success(logger, "Subfolder search completed!")
        data = result.data
        logger.info(f"  Found {data['total']} files matching 'test'")

        # Group by kind
        by_kind = {}
        for asset in data['assets']:
            kind = asset['kind']
            by_kind[kind] = by_kind.get(kind, 0) + 1

        logger.info("  Breakdown by type:")
        for kind, count in by_kind.items():
            logger.info(f"    {kind}: {count}")
    else:
        logger.error(f"Search failed: {result.error}")

    # Test 5: Get database statistics
    logger.info("\nTest 5: Database statistics")

    health_result = await services["health"].get_counters()

    if health_result.ok:
        log_success(logger, "Database stats retrieved!")
        counters = health_result.data
        logger.info(f"  Total assets: {counters.get('total_assets', 0)}")
        logger.info(f"  With workflows: {counters.get('with_workflows', 0)}")
        logger.info(f"  Images: {counters.get('images', 0)}")
        logger.info(f"  Videos: {counters.get('videos', 0)}")

    logger.info("\n" + "=" * 60)
    log_success(logger, "ComfyUI output directory tests completed!")
    logger.info("=" * 60)

if __name__ == "__main__":
    test_comfy_output()
