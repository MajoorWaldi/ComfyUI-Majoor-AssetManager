import logging
import os
import threading
from typing import Optional

_CONFIG_LOCK = threading.Lock()
_CONFIGURED = False


def _parse_level(val: Optional[str], default: int) -> int:
    if not val:
        return default
    name = str(val).strip().upper()
    return int(getattr(logging, name, default))


def _configure_once() -> None:
    """
    Configure the Majoor logger without interfering with ComfyUI's global logging.

    By default we rely on ComfyUI/root handlers. If `MJR_LOG_FILE` is set, we add a
    dedicated FileHandler for persistent logs.
    """
    global _CONFIGURED
    if _CONFIGURED:
        return
    with _CONFIG_LOCK:
        if _CONFIGURED:
            return

        base = logging.getLogger("Majoor.AssetsManager")
        base.setLevel(_parse_level(os.environ.get("MJR_LOG_LEVEL"), logging.INFO))

        propagate_raw = (os.environ.get("MJR_LOG_PROPAGATE") or "").strip().lower()
        if propagate_raw in ("0", "false", "no", "off"):
            base.propagate = False

        log_file = (os.environ.get("MJR_LOG_FILE") or "").strip()
        if log_file:
            fmt = os.environ.get(
                "MJR_LOG_FORMAT",
                "%(asctime)s %(levelname)s %(name)s: %(message)s",
            )
            datefmt = os.environ.get("MJR_LOG_DATEFMT", "%Y-%m-%d %H:%M:%S")
            handler = logging.FileHandler(log_file, encoding="utf-8")
            handler.setLevel(base.level)
            handler.setFormatter(logging.Formatter(fmt=fmt, datefmt=datefmt))
            base.addHandler(handler)

        _CONFIGURED = True


def get_logger(name: str) -> logging.Logger:
    _configure_once()
    suffix = (name or "").strip()
    if not suffix:
        return logging.getLogger("Majoor.AssetsManager")
    return logging.getLogger(f"Majoor.AssetsManager.{suffix}")


__all__ = ["get_logger"]

