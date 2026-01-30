"""
Dependency injection - builds services.
Simple, debug-friendly DI without framework magic.
"""

import os

from .shared import get_logger, log_success
from .adapters.db.sqlite import Sqlite
from .adapters.db.schema import init_schema, migrate_schema, table_has_column
from .adapters.tools import ExifTool, FFProbe
from .features.metadata import MetadataService
from .features.health import HealthService
from .features.index import IndexService
from .features.index.watcher import DirectoryWatcher
from .features.tags import RatingTagsSyncWorker
from .settings import AppSettings
from .config import (
    INDEX_DB,
    EXIFTOOL_BIN,
    EXIFTOOL_TIMEOUT,
    FFPROBE_BIN,
    FFPROBE_TIMEOUT,
    ENABLE_FILE_WATCHER,
    WATCHER_PATHS,
    WATCHER_INTERVAL_SECONDS,
    WATCHER_JOIN_TIMEOUT,
    DB_TIMEOUT,
    DB_MAX_CONNECTIONS,
)

logger = get_logger(__name__)

async def build_services(db_path: str = None) -> dict:
    """
    Build all services (DI container).

    Args:
        db_path: Path to SQLite database (default: from config.INDEX_DB)

    Returns:
        Dict of service instances
    """
    logger.info("Building services...")

    # Default database path from config
    if db_path is None:
        db_path = INDEX_DB

    # Initialize database
    logger.info(f"Initializing database: {db_path}")
    db = Sqlite(db_path, max_connections=DB_MAX_CONNECTIONS, timeout=DB_TIMEOUT)

    # Run migrations
    migrate_result = await migrate_schema(db)
    if not migrate_result.ok:
        logger.error(f"Schema migration failed: {migrate_result.error}")
        raise RuntimeError(f"Failed to initialize database: {migrate_result.error}")

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
    }

    # Best-effort filesystem sync for rating/tags (sidecar / ExifTool).
    try:
        services["rating_tags_sync"] = RatingTagsSyncWorker(exiftool)
    except Exception as exc:
        logger.debug("RatingTagsSyncWorker disabled: %s", exc)

    if ENABLE_FILE_WATCHER and WATCHER_PATHS:
        watcher = DirectoryWatcher(
            index_service,
            WATCHER_PATHS,
            WATCHER_INTERVAL_SECONDS,
            WATCHER_JOIN_TIMEOUT
        )
        watcher.start()
        services["watcher"] = watcher

    log_success(logger, "All services initialized")
    return services
