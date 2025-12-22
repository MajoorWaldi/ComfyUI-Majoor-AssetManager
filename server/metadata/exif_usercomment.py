"""
EXIF UserComment Decoder with Multi-Encoding Support

Handles EXIF UserComment field which can contain text in multiple encodings:
- UTF-16 LE/BE (with or without BOM)
- UTF-8
- ASCII/Latin-1
- EXIF-specific headers ("UNICODE\0", "ASCII\0\0\0", "JIS\0\0\0\0\0")

Never raises exceptions - returns None on decode failure.

Usage:
    from server.metadata.exif_usercomment import decode_user_comment

    raw_bytes = exif_data.get(0x9286)  # UserComment tag
    text = decode_user_comment(raw_bytes)
    if text:
        print(f"Decoded: {text}")
"""

import logging
from typing import Optional

log = logging.getLogger(__name__)


# EXIF UserComment character code headers
EXIF_HEADERS = {
    b"ASCII\x00\x00\x00": "ascii",
    b"JIS\x00\x00\x00\x00\x00": "shift_jis",
    b"UNICODE\x00": "utf-16",  # Ambiguous, need BOM detection
    b"\x00\x00\x00\x00\x00\x00\x00\x00": None,  # Undefined (try auto-detect)
}

# BOM (Byte Order Mark) signatures
BOM_UTF16_LE = b"\xff\xfe"
BOM_UTF16_BE = b"\xfe\xff"
BOM_UTF8 = b"\xef\xbb\xbf"


def detect_encoding(raw_bytes: bytes) -> Optional[str]:
    """
    Detect encoding from EXIF UserComment bytes.

    Returns:
        Encoding name ("utf-16le", "utf-16be", "utf-8", "ascii", "shift_jis") or None
    """
    if not raw_bytes or len(raw_bytes) == 0:
        return None

    # Check for EXIF character code headers (first 8 bytes)
    for header, encoding in EXIF_HEADERS.items():
        if raw_bytes.startswith(header):
            if encoding == "utf-16":
                # UNICODE header found, check BOM in remaining bytes
                remaining = raw_bytes[len(header):]
                if remaining.startswith(BOM_UTF16_LE):
                    return "utf-16le"
                elif remaining.startswith(BOM_UTF16_BE):
                    return "utf-16be"
                else:
                    # No BOM, assume LE (Windows default)
                    return "utf-16le"
            return encoding

    # No EXIF header, check for BOM at start
    if raw_bytes.startswith(BOM_UTF16_LE):
        return "utf-16le"
    elif raw_bytes.startswith(BOM_UTF16_BE):
        return "utf-16be"
    elif raw_bytes.startswith(BOM_UTF8):
        return "utf-8"

    # No BOM, try heuristics
    # Check for null bytes pattern (UTF-16 signature)
    if len(raw_bytes) >= 4:
        # UTF-16 LE typically has pattern: char, \x00, char, \x00
        if raw_bytes[1] == 0 and raw_bytes[3] == 0:
            return "utf-16le"
        # UTF-16 BE: \x00, char, \x00, char
        if raw_bytes[0] == 0 and raw_bytes[2] == 0:
            return "utf-16be"

    # Default fallback: try UTF-8 first, then ASCII
    # Return None to trigger fallback chain in decode_user_comment
    return None


def sanitize_text(text: str) -> str:
    """
    Sanitize decoded text.

    - Strip null bytes (\x00)
    - Normalize line endings (\r\n → \n)
    - Strip leading/trailing whitespace

    Returns:
        Cleaned text
    """
    if not text:
        return ""

    # Remove null bytes
    text = text.replace("\x00", "")

    # Normalize line endings
    text = text.replace("\r\n", "\n").replace("\r", "\n")

    # Strip whitespace
    text = text.strip()

    return text


def decode_user_comment(raw_bytes: bytes) -> Optional[str]:
    """
    Decode EXIF UserComment field with multi-encoding support.

    Encoding detection order:
    1. EXIF character code header (ASCII, UNICODE, JIS, Undefined)
    2. BOM detection (UTF-16 LE/BE, UTF-8)
    3. Heuristic detection (null byte patterns for UTF-16)
    4. Fallback chain: UTF-8 → Latin-1/ASCII

    Args:
        raw_bytes: Raw bytes from EXIF UserComment field

    Returns:
        Decoded text string or None if decode fails

    Example:
        >>> decode_user_comment(b"ASCII\\x00\\x00\\x00Hello World")
        'Hello World'
        >>> decode_user_comment(b"\\xff\\xfeH\\x00e\\x00l\\x00l\\x00o\\x00")
        'Hello'
        >>> decode_user_comment(b"Bonjour")
        'Bonjour'
    """
    if not raw_bytes:
        return None

    try:
        # Detect encoding
        encoding = detect_encoding(raw_bytes)

        # Strip EXIF header if present
        data = raw_bytes
        for header in EXIF_HEADERS.keys():
            if raw_bytes.startswith(header):
                data = raw_bytes[len(header):]
                break

        # Strip BOM if present
        if data.startswith(BOM_UTF16_LE):
            data = data[len(BOM_UTF16_LE):]
        elif data.startswith(BOM_UTF16_BE):
            data = data[len(BOM_UTF16_BE):]
        elif data.startswith(BOM_UTF8):
            data = data[len(BOM_UTF8):]

        # If no data left after stripping, return None
        if not data:
            return None

        # Try detected encoding first
        if encoding:
            try:
                text = data.decode(encoding, errors="ignore")
                text = sanitize_text(text)
                if text:  # Only return if non-empty after sanitization
                    return text
            except (UnicodeDecodeError, LookupError) as e:
                log.debug(f"[Majoor] Failed to decode with detected encoding '{encoding}': {e}")

        # Fallback chain: UTF-8 → Latin-1 → ASCII
        for fallback_encoding in ["utf-8", "latin-1", "ascii"]:
            try:
                text = data.decode(fallback_encoding, errors="ignore")
                text = sanitize_text(text)
                if text:  # Only return if non-empty
                    log.debug(f"[Majoor] Decoded UserComment with fallback encoding '{fallback_encoding}'")
                    return text
            except (UnicodeDecodeError, LookupError):
                continue

        # All decoding attempts failed
        log.debug("[Majoor] All encoding attempts failed for UserComment")
        return None

    except Exception as e:
        # Never crash - return None on any unexpected error
        log.debug(f"[Majoor] Unexpected error decoding UserComment: {e}")
        return None


def decode_user_comment_with_metadata(raw_bytes: bytes) -> Optional[dict]:
    """
    Decode UserComment and return metadata about the decoding process.

    Useful for debugging and logging.

    Returns:
        {
            "text": str,
            "encoding": str,
            "had_exif_header": bool,
            "had_bom": bool,
            "original_length": int,
            "decoded_length": int
        }
        or None if decode fails
    """
    if not raw_bytes:
        return None

    try:
        encoding = detect_encoding(raw_bytes)
        had_exif_header = False
        had_bom = False

        # Check for EXIF header
        for header in EXIF_HEADERS.keys():
            if raw_bytes.startswith(header):
                had_exif_header = True
                break

        # Check for BOM
        if raw_bytes.startswith((BOM_UTF16_LE, BOM_UTF16_BE, BOM_UTF8)):
            had_bom = True

        # Decode
        text = decode_user_comment(raw_bytes)

        if text is None:
            return None

        return {
            "text": text,
            "encoding": encoding or "fallback",
            "had_exif_header": had_exif_header,
            "had_bom": had_bom,
            "original_length": len(raw_bytes),
            "decoded_length": len(text)
        }

    except Exception as e:
        log.debug(f"[Majoor] Error in decode_user_comment_with_metadata: {e}")
        return None


# Self-test
if __name__ == "__main__":
    # Test cases
    test_cases = [
        # ASCII with EXIF header
        (b"ASCII\x00\x00\x00Hello World", "Hello World", "ASCII header"),

        # UTF-16 LE with BOM
        (b"\xff\xfeH\x00e\x00l\x00l\x00o\x00", "Hello", "UTF-16 LE with BOM"),

        # UTF-16 BE with BOM
        (b"\xfe\xff\x00H\x00e\x00l\x00l\x00o", "Hello", "UTF-16 BE with BOM"),

        # UTF-8 with BOM
        (b"\xef\xbb\xbfBonjour", "Bonjour", "UTF-8 with BOM"),

        # UNICODE header + UTF-16 LE BOM
        (b"UNICODE\x00\xff\xfeH\x00i\x00", "Hi", "UNICODE header + BOM"),

        # Plain ASCII (no header, no BOM)
        (b"Plain text", "Plain text", "Plain ASCII"),

        # UTF-8 without BOM
        (b"\xc3\xa9cole", "école", "UTF-8 without BOM"),

        # Empty
        (b"", None, "Empty bytes"),

        # Null bytes only
        (b"\x00\x00\x00", None, "Null bytes"),

        # Undefined header (8 null bytes) + text
        (b"\x00\x00\x00\x00\x00\x00\x00\x00Test", "Test", "Undefined header"),
    ]

    print("Running EXIF UserComment decoder self-tests...\n")
    passed = 0
    failed = 0

    for raw_bytes, expected, description in test_cases:
        result = decode_user_comment(raw_bytes)
        status = "[PASS]" if result == expected else "[FAIL]"

        if result == expected:
            passed += 1
        else:
            failed += 1

        print(f"{status} {description}")
        print(f"  Input: {raw_bytes[:50]!r}{'...' if len(raw_bytes) > 50 else ''}")
        print(f"  Expected: {expected!r}")
        print(f"  Got: {result!r}")

        # Show metadata
        if raw_bytes:
            metadata = decode_user_comment_with_metadata(raw_bytes)
            if metadata:
                print(f"  Encoding: {metadata['encoding']}, "
                      f"EXIF header: {metadata['had_exif_header']}, "
                      f"BOM: {metadata['had_bom']}")
        print()

    print(f"\nResults: {passed} passed, {failed} failed")
