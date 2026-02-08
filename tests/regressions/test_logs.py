"""
Test all log levels with emojis.
"""
import sys
from pathlib import Path

# Fix Windows console encoding for emojis
if sys.platform == "win32":
    import os
    os.system("")  # Enable ANSI support
    sys.stdout.reconfigure(encoding='utf-8')

# Add project to path
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))

from shared import get_logger, log_success
import logging

logger = get_logger(__name__, level=logging.DEBUG)

def main():
    """Test all log levels."""
    print("=" * 60)
    print("Majoor Logging Test - All Levels")
    print("=" * 60)
    print()

    logger.debug("This is a DEBUG message")
    logger.info("This is an INFO message")
    log_success(logger, "This is a SUCCESS message")
    logger.warning("This is a WARNING message")
    logger.error("This is an ERROR message")
    logger.critical("This is a CRITICAL message")

    print()
    print("=" * 60)

if __name__ == "__main__":
    main()
