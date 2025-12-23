"""
Backend entry for Majoor Assets Manager.
Just importing this module will register our HTTP routes on PromptServer.
"""
import os

if str(os.environ.get("MJR_SKIP_ROUTES", "")).strip().lower() not in ("1", "true", "yes", "on"):
    from . import routes  # noqa: F401
