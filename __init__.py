"""
Majoor File Manager - ComfyUI extension
"""

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
WEB_DIRECTORY = "./js"

# Register API routes
from .server import routes  # noqa: F401

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
