"""
Modular route system for ComfyUI Majoor Assets Manager.

This package provides a clean separation of concerns:
- core/: Shared utilities (response, paths, security, services)
- handlers/: Feature-based route handlers
- registry.py: Route registration coordination

Auto-registers all routes on import via PromptServer decorators.
"""
from backend.config import OUTPUT_ROOT
from backend.shared import get_logger

logger = get_logger(__name__)

# Expose COMFY_OUTPUT_DIR for backward compatibility
COMFY_OUTPUT_DIR = OUTPUT_ROOT

# Initialize and register all routes
logger.info("=" * 60)
logger.info("Initializing Majoor Assets Manager...")
logger.info("=" * 60)
logger.info("Services will be lazily initialized")

from .registry import (
    register_all_routes,
    register_routes,
    _install_observability_on_prompt_server,
)

# Auto-register routes on import
register_all_routes()
_install_observability_on_prompt_server()

logger.info(f"ComfyUI output directory: {COMFY_OUTPUT_DIR}")

# Export for backward compatibility and external use
__all__ = [
    "register_routes",
    "register_all_routes",
    "COMFY_OUTPUT_DIR",
]
