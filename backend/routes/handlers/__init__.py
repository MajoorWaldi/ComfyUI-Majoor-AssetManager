"""
Route handlers package.
"""
from .health import register_health_routes
from .metadata import register_metadata_routes
from .custom_roots import register_custom_roots_routes
from .search import register_search_routes
from .scan import register_scan_routes
from .assets import register_asset_routes, register_download_routes
from .collections import register_collections_routes
from .batch_zip import register_batch_zip_routes
from .calendar import register_calendar_routes
from .viewer import register_viewer_routes
from .db_maintenance import register_db_maintenance_routes
from .releases import register_releases_routes
from .version import register_version_routes
from .duplicates import register_duplicates_routes

__all__ = [
    "register_health_routes",
    "register_metadata_routes",
    "register_custom_roots_routes",
    "register_search_routes",
    "register_scan_routes",
    "register_asset_routes",
    "register_collections_routes",
    "register_batch_zip_routes",
    "register_calendar_routes",
    "register_viewer_routes",
    "register_db_maintenance_routes",
    "register_releases_routes",
    "register_version_routes",
    "register_download_routes",
    "register_duplicates_routes",
]
