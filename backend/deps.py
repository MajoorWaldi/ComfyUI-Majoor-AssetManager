"""
Dependency injection - builds services.
Simple, debug-friendly DI without framework magic.
"""

import asyncio
from pathlib import Path

from .shared import Result, get_logger, log_success
from .adapters.db.sqlite import Sqlite
from .adapters.db.schema import migrate_schema, table_has_column
from .adapters.tools import ExifTool, FFProbe
from .features.metadata import MetadataService
from .features.health import HealthService
from .features.index import IndexService
from .features.index.watcher import OutputWatcher
from .features.index.watcher_scope import load_watcher_scope, build_watch_paths
from .features.tags import RatingTagsSyncWorker
from .features.duplicates import DuplicatesService
from .settings import AppSettings
from .config import (
    INDEX_DB,
    EXIFTOOL_BIN,
    EXIFTOOL_TIMEOUT,
    FFPROBE_BIN,
    FFPROBE_TIMEOUT,
    DB_TIMEOUT,
    DB_MAX_CONNECTIONS,
    WATCHER_ENABLED,
)

logger = get_logger(__name__)

async def build_services(db_path: str = None) -> Result[dict]:
    """
    Build all services (DI container).

    Args:
        db_path: Path to SQLite database (default: from config.INDEX_DB)

    Returns:
        Result[dict] of service instances
    """
    logger.info("Building services...")

    # Default database path from config
    if db_path is None:
        db_path = INDEX_DB

    # Initialize database
    logger.info(f"Initializing database: {db_path}")
    try:
        db = Sqlite(db_path, max_connections=DB_MAX_CONNECTIONS, timeout=DB_TIMEOUT)
    except Exception as exc:
        logger.error("Failed to initialize database: %s", exc)
        return Result.Err("DB_ERROR", f"Failed to initialize database: {exc}")

    # Run migrations
    migrate_result = await migrate_schema(db)
    if not migrate_result.ok:
        logger.error(f"Schema migration failed: {migrate_result.error}")
        return Result.Err(migrate_result.code or "DB_ERROR", f"Failed to initialize database: {migrate_result.error}")

    # Initialize adapters
    exiftool = ExifTool(bin_name=EXIFTOOL_BIN, timeout=EXIFTOOL_TIMEOUT)
    ffprobe = FFProbe(bin_name=FFPROBE_BIN, timeout=FFPROBE_TIMEOUT)
    settings_service = AppSettings(db)

    # Log tool availability
    if exiftool.is_available():
        log_success(logger, "ExifTool is available")
    else:
        logger.warning("ExifTool not found - metadata extraction will be limited")

    if ffprobe.is_available():
        log_success(logger, "ffprobe is available")
    else:
        logger.warning("ffprobe not found - video metadata will be limited")

    # Build services
    metadata_service = MetadataService(
        exiftool=exiftool,
        ffprobe=ffprobe,
        settings=settings_service,
    )

    health_service = HealthService(
        db=db,
        exiftool=exiftool,
        ffprobe=ffprobe
    )

    # Check for optional columns
    matches = await table_has_column(db, "asset_metadata", "tags_text")
    
    index_service = IndexService(
        db=db,
        metadata_service=metadata_service,
        has_tags_text_column=matches
    )

    services = {
        "db": db,
        "exiftool": exiftool,
        "ffprobe": ffprobe,
        "metadata": metadata_service,
        "health": health_service,
        "index": index_service,
        "settings": settings_service,
        "duplicates": DuplicatesService(db),
    }
    try:
        services["watcher_scope"] = await load_watcher_scope(db)
    except Exception:
        services["watcher_scope"] = {"scope": "output", "custom_root_id": ""}

    # Best-effort filesystem sync for rating/tags (sidecar / ExifTool).
    try:
        services["rating_tags_sync"] = RatingTagsSyncWorker(exiftool)
    except Exception as exc:
        logger.debug("RatingTagsSyncWorker disabled: %s", exc)

    # File watcher for manual additions (disabled by default, enable with MJR_ENABLE_WATCHER=1)
    if WATCHER_ENABLED:
        try:
            watcher = await _create_watcher(index_service)
            services["watcher"] = watcher
            log_success(logger, "File watcher enabled")
        except Exception as exc:
            logger.warning("File watcher disabled: %s", exc)

    log_success(logger, "All services initialized")
    return Result.Ok(services)


async def _create_watcher(index_service: IndexService) -> OutputWatcher:
    """Create and start the file watcher for output directories."""

    async def index_callback(filepaths: list, base_dir: str, source: str | None = None, root_id: str | None = None):
        """Called by watcher when files are ready to index."""
        if not filepaths:
            return
        paths = [Path(f) for f in filepaths if f]
        if paths:
            await index_service.index_paths(
                paths=paths,
                base_dir=base_dir,
                incremental=True,
                source=source or "watcher",
                root_id=root_id,
            )

    watcher = OutputWatcher(index_callback)

    # Collect directories to watch
    try:
        scope_cfg = await load_watcher_scope(index_service.db)
    except Exception:
        scope_cfg = {"scope": "output", "custom_root_id": ""}

    watch_paths = build_watch_paths(scope_cfg.get("scope"), scope_cfg.get("custom_root_id"))

    if watch_paths:
        loop = asyncio.get_event_loop()
        await watcher.start(watch_paths, loop)

    return watcher
