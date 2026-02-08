"""
Rating/Tags feature module.

This module contains best-effort syncing of rating/tags to the filesystem
(sidecar JSON / ExifTool) without breaking the Result pattern.
"""

from .sync import RatingTagsSyncWorker

__all__ = ["RatingTagsSyncWorker"]

