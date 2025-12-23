"""
Lossless PNG Metadata Injector

Injects metadata into PNG files using chunk manipulation (no re-encoding).

Features:
- Read/write PNG chunks without re-encoding image data
- CRC32 validation for chunk integrity
- Namespaced keys (mjr:tags, mjr:rating, mjr:notes, mjr:workflow_hash)
- Uses iTXt (international text) for UTF-8 support
- Never corrupts existing PNG data

PNG Structure:
    [Signature: 8 bytes]
    [IHDR chunk]
    [... other chunks ...]
    [IDAT chunks - actual image data]
    [... optional chunks ...]
    [IEND chunk]

We inject metadata chunks BEFORE IEND to preserve file integrity.

Usage:
    from server.metadata.png_inject import inject_metadata, read_metadata

    # Read existing metadata
    metadata = read_metadata("output/image.png")
    print(metadata.get("mjr:rating"))

    # Inject new metadata
    inject_metadata("output/image.png", {
        "mjr:rating": "5",
        "mjr:tags": '["portrait", "photorealistic"]',
        "mjr:workflow_hash": "abc123..."
    })
"""

import struct
import zlib
import logging
from typing import Dict, List, Optional, Tuple
from pathlib import Path

log = logging.getLogger(__name__)


# PNG file signature
PNG_SIGNATURE = b'\x89PNG\r\n\x1a\n'

# Chunk types
CHUNK_IEND = b'IEND'
CHUNK_ITXT = b'iTXt'  # International text (UTF-8)
CHUNK_TEXT = b'tEXt'  # Latin-1 text
CHUNK_ZTXT = b'zTXt'  # Compressed Latin-1 text

# Namespace for our metadata
METADATA_NAMESPACE = "mjr:"


class PNGChunk:
    """Represents a PNG chunk."""

    def __init__(self, chunk_type: bytes, data: bytes):
        """
        Create PNG chunk.

        Args:
            chunk_type: 4-byte chunk type (e.g., b'IEND', b'iTXt')
            data: Chunk data
        """
        self.chunk_type = chunk_type
        self.data = data

    def to_bytes(self) -> bytes:
        """
        Serialize chunk to bytes with length and CRC32.

        PNG chunk format:
            [Length: 4 bytes] [Type: 4 bytes] [Data: N bytes] [CRC: 4 bytes]
        """
        length = len(self.data)
        crc = zlib.crc32(self.chunk_type + self.data) & 0xffffffff

        return struct.pack('>I', length) + self.chunk_type + self.data + struct.pack('>I', crc)

    @staticmethod
    def from_bytes(data: bytes, offset: int) -> Tuple['PNGChunk', int]:
        """
        Parse chunk from bytes.

        Args:
            data: PNG file bytes
            offset: Starting position

        Returns:
            (chunk, new_offset)
        """
        # Read length (4 bytes, big-endian)
        length = struct.unpack('>I', data[offset:offset+4])[0]

        # Read chunk type (4 bytes)
        chunk_type = data[offset+4:offset+8]

        # Read chunk data
        chunk_data = data[offset+8:offset+8+length]

        # Read CRC (4 bytes)
        stored_crc = struct.unpack('>I', data[offset+8+length:offset+12+length])[0]

        # Validate CRC
        calculated_crc = zlib.crc32(chunk_type + chunk_data) & 0xffffffff
        if calculated_crc != stored_crc:
            log.warning(f"[Majoor] CRC mismatch in {chunk_type.decode('latin-1', errors='ignore')} chunk")

        new_offset = offset + 12 + length
        return PNGChunk(chunk_type, chunk_data), new_offset

    def __repr__(self):
        return f"PNGChunk(type={self.chunk_type}, data_len={len(self.data)})"


def read_png_chunks(file_path: str) -> Optional[List[PNGChunk]]:
    """
    Read all chunks from PNG file.

    Args:
        file_path: Path to PNG file

    Returns:
        List of PNGChunk objects or None if not a valid PNG
    """
    try:
        with open(file_path, 'rb') as f:
            data = f.read()

        # Validate PNG signature
        if not data.startswith(PNG_SIGNATURE):
            log.debug(f"[Majoor] Not a PNG file: {file_path}")
            return None

        chunks = []
        offset = len(PNG_SIGNATURE)

        # Parse all chunks
        while offset < len(data):
            try:
                chunk, offset = PNGChunk.from_bytes(data, offset)
                chunks.append(chunk)

                # Stop after IEND
                if chunk.chunk_type == CHUNK_IEND:
                    break

            except Exception as e:
                log.debug(f"[Majoor] Error parsing chunk at offset {offset}: {e}")
                break

        return chunks

    except Exception as e:
        log.debug(f"[Majoor] Error reading PNG file {file_path}: {e}")
        return None


def create_itxt_chunk(key: str, value: str) -> PNGChunk:
    """
    Create iTXt chunk with UTF-8 text.

    iTXt chunk format:
        Keyword: null-terminated string (Latin-1)
        Compression flag: 1 byte (0 = uncompressed)
        Compression method: 1 byte (0)
        Language tag: null-terminated string (empty for us)
        Translated keyword: null-terminated string (empty for us)
        Text: UTF-8 string (not null-terminated)

    Args:
        key: Metadata key (e.g., "mjr:rating")
        value: Metadata value (UTF-8 string)

    Returns:
        iTXt chunk
    """
    # Build chunk data
    keyword = key.encode('latin-1', errors='ignore') + b'\x00'
    compression_flag = b'\x00'  # Uncompressed
    compression_method = b'\x00'
    language_tag = b'\x00'  # Empty
    translated_keyword = b'\x00'  # Empty
    text = value.encode('utf-8', errors='ignore')

    data = keyword + compression_flag + compression_method + language_tag + translated_keyword + text

    return PNGChunk(CHUNK_ITXT, data)


def parse_itxt_chunk(chunk: PNGChunk) -> Optional[Tuple[str, str]]:
    """
    Parse iTXt chunk.

    Returns:
        (key, value) or None if invalid
    """
    if chunk.chunk_type != CHUNK_ITXT:
        return None

    try:
        data = chunk.data

        # Find null terminator for keyword
        null_idx = data.find(b'\x00')
        if null_idx == -1:
            return None

        keyword = data[:null_idx].decode('latin-1', errors='ignore')

        # Skip: compression flag (1), compression method (1)
        offset = null_idx + 1 + 2

        # Find null terminator for language tag
        null_idx = data.find(b'\x00', offset)
        if null_idx == -1:
            return None

        # Skip language tag
        offset = null_idx + 1

        # Find null terminator for translated keyword
        null_idx = data.find(b'\x00', offset)
        if null_idx == -1:
            return None

        # Skip translated keyword
        offset = null_idx + 1

        # Remaining data is the text (UTF-8)
        text = data[offset:].decode('utf-8', errors='ignore')

        return keyword, text

    except Exception as e:
        log.debug(f"[Majoor] Error parsing iTXt chunk: {e}")
        return None


def read_metadata(file_path: str) -> Dict[str, str]:
    """
    Read metadata from PNG file.

    Only returns keys in our namespace (mjr:*).

    Args:
        file_path: Path to PNG file

    Returns:
        Dictionary of metadata (e.g., {"mjr:rating": "5", ...})
    """
    chunks = read_png_chunks(file_path)
    if not chunks:
        return {}

    metadata = {}

    for chunk in chunks:
        if chunk.chunk_type == CHUNK_ITXT:
            result = parse_itxt_chunk(chunk)
            if result:
                key, value = result
                # Only return our namespaced keys
                if key.startswith(METADATA_NAMESPACE):
                    metadata[key] = value

    return metadata


def inject_metadata(
    file_path: str,
    metadata: Dict[str, str],
    backup: bool = True
) -> bool:
    """
    Inject metadata into PNG file (lossless).

    Creates new iTXt chunks and inserts them before IEND.
    Removes old chunks with same keys first.

    Args:
        file_path: Path to PNG file
        metadata: Dictionary of metadata to inject
        backup: Create backup file (.png.backup) before modifying

    Returns:
        True if successful, False otherwise

    Example:
        >>> inject_metadata("output/image.png", {
        ...     "mjr:rating": "5",
        ...     "mjr:tags": '["portrait", "photorealistic"]'
        ... })
        True
    """
    try:
        # Read existing chunks
        chunks = read_png_chunks(file_path)
        if not chunks:
            log.warning(f"[Majoor] Cannot inject metadata: not a valid PNG file: {file_path}")
            return False

        # Create backup if requested (or force on Windows for safety)
        try:
            from ..config import IS_WINDOWS
        except Exception:
            try:
                from config import IS_WINDOWS  # type: ignore
            except Exception:
                IS_WINDOWS = False
        if IS_WINDOWS and not backup:
            log.debug("[Majoor] Forcing backup on Windows for data safety")
            backup = True

        backup_path = None
        if backup:
            backup_path = Path(file_path).with_suffix('.png.backup')
            try:
                import shutil
                shutil.copy2(file_path, backup_path)

                # Verify backup
                if not backup_path.exists():
                    log.error(f"[Majoor] Backup file not created: {backup_path}")
                    return False

                # Verify backup size matches original
                import os
                if os.path.getsize(backup_path) != os.path.getsize(file_path):
                    log.error(f"[Majoor] Backup size mismatch for {file_path}")
                    return False

                log.debug(f"[Majoor] Created and verified backup: {backup_path}")
            except Exception as e:
                log.error(f"[Majoor] Failed to create backup: {e}")
                return False

        # Remove existing metadata chunks with same keys
        keys_to_inject = set(metadata.keys())
        filtered_chunks = []

        for chunk in chunks:
            # Keep chunk if it's not our metadata
            if chunk.chunk_type != CHUNK_ITXT:
                filtered_chunks.append(chunk)
            else:
                result = parse_itxt_chunk(chunk)
                if result:
                    key, _ = result
                    # Keep if not in keys we're injecting
                    if key not in keys_to_inject:
                        filtered_chunks.append(chunk)

        # Create new metadata chunks
        new_chunks = []
        for key, value in metadata.items():
            # Ensure key is namespaced
            if not key.startswith(METADATA_NAMESPACE):
                key = METADATA_NAMESPACE + key

            new_chunks.append(create_itxt_chunk(key, value))

        # Build new PNG file
        # Structure: [signature] [existing chunks except IEND] [new chunks] [IEND]
        output = bytearray(PNG_SIGNATURE)

        iend_chunk = None
        for chunk in filtered_chunks:
            if chunk.chunk_type == CHUNK_IEND:
                iend_chunk = chunk
            else:
                output.extend(chunk.to_bytes())

        # Add new metadata chunks
        for chunk in new_chunks:
            output.extend(chunk.to_bytes())

        # Add IEND at the end
        if iend_chunk:
            output.extend(iend_chunk.to_bytes())
        else:
            # Create new IEND if missing
            output.extend(PNGChunk(CHUNK_IEND, b'').to_bytes())

        # Write to file (with rollback on failure)
        try:
            with open(file_path, 'wb') as f:
                f.write(output)

            # Verify write succeeded by checking file size
            import os
            if not os.path.exists(file_path) or os.path.getsize(file_path) < len(output):
                raise IOError("PNG write verification failed (file size mismatch)")

            log.debug(f"[Majoor] Injected {len(metadata)} metadata keys into {file_path}")
            return True

        except Exception as write_error:
            # Rollback: restore from backup if available
            if backup_path and backup_path.exists():
                log.error(f"[Majoor] PNG write failed, restoring from backup: {write_error}")
                try:
                    import shutil
                    shutil.copy2(backup_path, file_path)
                    log.info(f"[Majoor] Successfully restored {file_path} from backup")
                except Exception as rollback_error:
                    log.critical(f"[Majoor] CRITICAL: Failed to restore from backup: {rollback_error}")
            raise write_error

    except Exception as e:
        log.error(f"[Majoor] Error injecting metadata into {file_path}: {e}")
        return False


def remove_metadata(file_path: str, keys: Optional[List[str]] = None, backup: bool = True) -> bool:
    """
    Remove metadata from PNG file.

    Args:
        file_path: Path to PNG file
        keys: List of keys to remove (None = remove all mjr:* keys)
        backup: Create backup before modifying

    Returns:
        True if successful
    """
    try:
        chunks = read_png_chunks(file_path)
        if not chunks:
            return False

        # Create backup
        if backup:
            backup_path = Path(file_path).with_suffix('.png.backup')
            import shutil
            shutil.copy2(file_path, backup_path)

        # Filter chunks
        keys_to_remove = set(keys) if keys else None
        filtered_chunks = []

        for chunk in chunks:
            keep = True

            if chunk.chunk_type == CHUNK_ITXT:
                result = parse_itxt_chunk(chunk)
                if result:
                    key, _ = result

                    # Remove if:
                    # - No specific keys given and key is namespaced
                    # - Specific keys given and key is in list
                    if keys_to_remove is None:
                        if key.startswith(METADATA_NAMESPACE):
                            keep = False
                    else:
                        if key in keys_to_remove:
                            keep = False

            if keep:
                filtered_chunks.append(chunk)

        # Rebuild PNG
        output = bytearray(PNG_SIGNATURE)
        for chunk in filtered_chunks:
            output.extend(chunk.to_bytes())

        with open(file_path, 'wb') as f:
            f.write(output)

        return True

    except Exception as e:
        log.error(f"[Majoor] Error removing metadata from {file_path}: {e}")
        return False


# Self-test
if __name__ == "__main__":
    import tempfile
    import os

    print("Running PNG metadata injector self-tests...\n")

    # Create a minimal valid PNG (1x1 white pixel)
    minimal_png = (
        PNG_SIGNATURE +
        # IHDR chunk
        b'\x00\x00\x00\x0d' +  # Length: 13
        b'IHDR' +
        b'\x00\x00\x00\x01' +  # Width: 1
        b'\x00\x00\x00\x01' +  # Height: 1
        b'\x08\x06\x00\x00\x00' +  # Bit depth: 8, Color type: 6 (RGBA), Compression: 0, Filter: 0, Interlace: 0
        b'\x1f\x15\xc4\x89' +  # CRC
        # IDAT chunk (compressed image data)
        b'\x00\x00\x00\x0a' +  # Length: 10
        b'IDAT' +
        b'\x78\x9c\x62\x00\x01\x00\x00\x05\x00\x01' +  # Compressed data (white pixel)
        b'\x0d\x0a\x2d\xb4' +  # CRC
        # IEND chunk
        b'\x00\x00\x00\x00' +  # Length: 0
        b'IEND' +
        b'\xae\x42\x60\x82'  # CRC
    )

    # Create temporary file
    with tempfile.NamedTemporaryFile(mode='wb', suffix='.png', delete=False) as f:
        temp_file = f.name
        f.write(minimal_png)

    try:
        # Test 1: Read chunks
        print("TEST 1: Read PNG chunks")
        chunks = read_png_chunks(temp_file)
        assert chunks is not None
        assert len(chunks) == 3  # IHDR, IDAT, IEND
        print(f"[PASS] Read {len(chunks)} chunks")

        # Test 2: Inject metadata
        print("\nTEST 2: Inject metadata")
        metadata = {
            "mjr:rating": "5",
            "mjr:tags": '["test", "automated"]',
            "mjr:workflow_hash": "abc123def456"
        }
        result = inject_metadata(temp_file, metadata, backup=False)
        assert result is True
        print("[PASS] Metadata injected")

        # Test 3: Read back metadata
        print("\nTEST 3: Read back metadata")
        read_back = read_metadata(temp_file)
        assert read_back["mjr:rating"] == "5"
        assert read_back["mjr:tags"] == '["test", "automated"]'
        assert read_back["mjr:workflow_hash"] == "abc123def456"
        print(f"[PASS] Read back: {read_back}")

        # Test 4: Update metadata (replace existing)
        print("\nTEST 4: Update metadata")
        updated_metadata = {
            "mjr:rating": "4",  # Changed
            "mjr:notes": "Test note"  # New
        }
        inject_metadata(temp_file, updated_metadata, backup=False)
        read_back = read_metadata(temp_file)
        assert read_back["mjr:rating"] == "4"
        assert read_back["mjr:notes"] == "Test note"
        assert read_back["mjr:tags"] == '["test", "automated"]'  # Still exists
        print(f"[PASS] Updated: {read_back}")

        # Test 5: Remove specific keys
        print("\nTEST 5: Remove specific metadata keys")
        remove_metadata(temp_file, keys=["mjr:notes"], backup=False)
        read_back = read_metadata(temp_file)
        assert "mjr:notes" not in read_back
        assert "mjr:rating" in read_back
        print(f"[PASS] Removed mjr:notes: {read_back}")

        # Test 6: Remove all metadata
        print("\nTEST 6: Remove all metadata")
        remove_metadata(temp_file, keys=None, backup=False)
        read_back = read_metadata(temp_file)
        assert len(read_back) == 0
        print("[PASS] All metadata removed")

        # Test 7: Verify PNG still valid
        print("\nTEST 7: Verify PNG integrity")
        chunks = read_png_chunks(temp_file)
        assert chunks is not None
        assert chunks[-1].chunk_type == CHUNK_IEND
        print("[PASS] PNG structure intact")

        print("\n" + "="*50)
        print("All tests passed successfully!")

    finally:
        # Cleanup
        os.unlink(temp_file)
        backup_file = temp_file + '.backup'
        if os.path.exists(backup_file):
            os.unlink(backup_file)
