"""
ExifTool adapter for reading and writing metadata.
"""
import os
import subprocess
import json
import shutil
import re
from typing import Optional, List, Dict, Any, Tuple
from pathlib import Path

from ...config import EXIFTOOL_TIMEOUT
from ...shared import Result, ErrorCode, get_logger

logger = get_logger(__name__)

_TAG_SAFE_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_:-]*$")


def _is_safe_exiftool_tag(tag: str) -> bool:
    """
    Return True if a tag/key looks safe to pass to ExifTool as `-TAG` / `-TAG=...`.

    ExifTool tags commonly contain:
      - group separators: `XMP-xmp:Rating`
      - dashes and colons
      - underscores

    We disallow whitespace and other special characters to prevent passing
    unintended options or malformed arguments to ExifTool.
    """
    if not tag or not isinstance(tag, str):
        return False
    s = tag.strip()
    if not s:
        return False
    if "\x00" in s or "\n" in s or "\r" in s or "\t" in s:
        return False
    # Reject leading dash to avoid double-dash option style (- -something).
    if s.startswith("-"):
        return False
    return bool(_TAG_SAFE_PATTERN.match(s))


def _validate_exiftool_tags(tags: Optional[List[str]]) -> Result[List[str]]:
    """
    Validate a tag list and return a cleaned list, or Err on any invalid tags.

    Strict: invalid tags abort to avoid ambiguous or unsafe ExifTool invocations.
    """
    if tags is None:
        return Result.Ok([])
    if not isinstance(tags, list):
        return Result.Err(ErrorCode.INVALID_INPUT, "tags must be a list", quality="none")

    cleaned: List[str] = []
    invalid: List[str] = []
    for t in tags:
        if not isinstance(t, str):
            invalid.append(str(t))
            continue
        s = t.strip()
        if not _is_safe_exiftool_tag(s):
            invalid.append(s)
            continue
        cleaned.append(s)

    if invalid:
        return Result.Err(
            ErrorCode.INVALID_INPUT,
            "Invalid ExifTool tag format",
            invalid_tags=invalid,
            quality="none",
        )
    return Result.Ok(cleaned)


def _normalize_match_path(path_value: str) -> Optional[str]:
    """
    Normalize a filesystem path string for robust equality matching.

    ExifTool's `SourceFile` may differ from input paths by:
    - path separators
    - drive letter / case (Windows)
    - relative vs absolute forms
    """
    if not path_value or "\x00" in str(path_value):
        return None
    try:
        p = Path(str(path_value)).expanduser()
        # Use strict=False so a best-effort normalization still works even if ExifTool
        # returns a path format that isn't directly resolvable in the current context.
        resolved = p.resolve(strict=False)
        return os.path.normcase(os.path.normpath(str(resolved)))
    except Exception:
        try:
            return os.path.normcase(os.path.normpath(str(path_value)))
        except Exception:
            return None


def _build_match_map(valid_paths: List[str]) -> Tuple[Dict[str, List[str]], List[str]]:
    """
    Build:
    - a map from normalized path key -> list of original input paths to fill
    - a de-duplicated list of command paths (first occurrence per key)
    """
    key_to_paths: Dict[str, List[str]] = {}
    cmd_paths: List[str] = []

    for original in valid_paths:
        key = _normalize_match_path(original) or str(original)
        if key not in key_to_paths:
            key_to_paths[key] = []
            cmd_paths.append(original)
        key_to_paths[key].append(original)

    return key_to_paths, cmd_paths


class ExifTool:
    """
    ExifTool wrapper for metadata operations.

    Never raises exceptions - always returns Result.
    """

    def __init__(self, bin_name: str = "exiftool", timeout: Optional[float] = None):
        """
        Initialize ExifTool adapter.

        Args:
            bin_name: ExifTool binary name or path
            timeout: Command timeout in seconds
        """
        self.bin = bin_name
        self.timeout = float(timeout) if timeout is not None else float(EXIFTOOL_TIMEOUT)
        self._available = self._check_available()

    def _resolve_executable(self, bin_name: str) -> Optional[str]:
        """
        Resolve and validate the exiftool executable.

        This defends against untrusted configuration values and ensures we're
        invoking an actual exiftool binary (not an arbitrary command string).
        """
        raw = (bin_name or "").strip()
        if not raw:
            return None
        if "\x00" in raw or "\n" in raw or "\r" in raw:
            return None
        if any(ch in raw for ch in ("&", "|", ";", ">", "<")):
            return None

        resolved = shutil.which(raw)
        if not resolved:
            try:
                candidate = Path(raw)
                if candidate.is_file():
                    resolved = str(candidate.resolve(strict=True))
            except (OSError, RuntimeError, ValueError):
                return None

        if not resolved:
            return None

        try:
            name = Path(resolved).name.lower()
        except Exception:
            name = str(resolved).lower()

        # Allow exiftool.exe, exiftool(-k).exe, etc.
        if not name.startswith("exiftool"):
            return None

        return resolved

    def _check_available(self) -> bool:
        """Check if ExifTool is available in PATH."""
        resolved = self._resolve_executable(self.bin)
        if not resolved:
            return False
        self.bin = resolved
        return True

    def is_available(self) -> bool:
        """Check if ExifTool is available."""
        return self._available

    def read(self, path: str, tags: Optional[List[str]] = None) -> Result[Dict[str, Any]]:
        """
        Read metadata from file using ExifTool.

        Args:
            path: File path
            tags: Optional list of specific tags to read

        Returns:
            Result with metadata dict or error
        """
        if not self._available:
            return Result.Err(
                ErrorCode.TOOL_MISSING,
                "ExifTool not found in PATH",
                quality="none"
            )

        if not path or "\x00" in str(path):
            return Result.Err(ErrorCode.INVALID_INPUT, "Invalid file path", quality="none")
        try:
            p = Path(str(path))
        except Exception:
            return Result.Err(ErrorCode.INVALID_INPUT, "Invalid file path", quality="none")
        if not p.exists() or not p.is_file():
            return Result.Err(ErrorCode.NOT_FOUND, f"File not found: {path}", quality="none")

        tags_res = _validate_exiftool_tags(tags)
        if not tags_res.ok:
            return Result.Err(tags_res.code, tags_res.error or "Invalid tags", **(tags_res.meta or {}))
        safe_tags = tags_res.data or []

        def _run(cmd: List[str], stdin_input: Optional[str]) -> subprocess.CompletedProcess:
            return subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                check=False,
                timeout=self.timeout,
                encoding="utf-8",
                errors="replace",
                input=stdin_input,
                shell=False,
            )

        try:
            # Build command with comprehensive extraction flags
            # -j: JSON output
            # -G1: Group names with family 1
            # -ee: Extract embedded data (critical for ComfyUI workflows)
            # -a: Allow duplicate tags
            # -U: Extract unknown tags
            # -s: Short tag names
            cmd = [self.bin, "-j", "-G1", "-ee", "-a", "-U", "-s"]
            if safe_tags:
                cmd.extend([f"-{tag}" for tag in safe_tags])

            # Windows Unicode compatibility:
            # - Prefer argv (most robust with Win32 wide-char argv).
            # - If ExifTool reports "File not found" (common when filename charset handling
            #   is buggy), retry via stdin argfile with explicit filename charset.
            stdin_input: Optional[str] = None
            if os.name == "nt":
                cmd.extend(["-charset", "filename=utf8", str(path)])
            else:
                cmd.append(path)

            # Run command
            process = _run(cmd, stdin_input)

            if os.name == "nt" and process.returncode != 0:
                stderr_msg = (process.stderr or "").strip()
                # Retry only for the specific "file not found" failure mode; avoid
                # masking other errors (invalid tags, parse errors, etc.).
                if "file not found" in stderr_msg.lower():
                    retry_cmd = [self.bin, "-j", "-G1", "-ee", "-a", "-U", "-s"]
                    if safe_tags:
                        retry_cmd.extend([f"-{tag}" for tag in safe_tags])
                    retry_cmd.extend(["-charset", "filename=utf8", "-@", "-"])
                    # Prefer CRLF on Windows to match typical ExifTool stdin parsing behavior.
                    retry_process = _run(retry_cmd, f"{path}\r\n")
                    if retry_process.returncode == 0:
                        process = retry_process

            stdout = process.stdout or ""
            stderr = process.stderr or ""
            had_replacements = ("\ufffd" in stdout) or ("\ufffd" in stderr)
            if had_replacements:
                logger.warning("ExifTool output contained decoding replacement characters for %s", path)

            if process.returncode != 0:
                stderr_msg = stderr.strip()
                logger.warning(f"ExifTool error for {path}: {stderr_msg}")
                return Result.Err(
                    ErrorCode.EXIFTOOL_ERROR,
                    stderr_msg or "ExifTool command failed",
                    quality="degraded"
                )

            # Parse JSON output
            if not stdout.strip():
                return Result.Err(
                    ErrorCode.PARSE_ERROR,
                    "ExifTool returned empty output",
                    quality="degraded"
                )
            try:
                data = json.loads(stdout)
            except json.JSONDecodeError as e:
                logger.error(f"ExifTool JSON parse error: {e}")
                return Result.Err(
                    ErrorCode.PARSE_ERROR,
                    f"Failed to parse ExifTool output: {e}",
                    quality="degraded"
                )
            if isinstance(data, list) and len(data) > 0:
                return Result.Ok(data[0], quality="full" if not had_replacements else "degraded")

            return Result.Err(
                ErrorCode.PARSE_ERROR,
                "No metadata found",
                quality="none"
            )

        except subprocess.TimeoutExpired:
            logger.error(f"ExifTool timeout for {path}")
            return Result.Err(
                ErrorCode.TIMEOUT,
                f"ExifTool timeout after {self.timeout}s",
                quality="degraded"
            )
        except json.JSONDecodeError as e:
            logger.error(f"ExifTool JSON parse error: {e}")
            return Result.Err(
                ErrorCode.PARSE_ERROR,
                f"Failed to parse ExifTool output: {e}",
                quality="degraded"
            )
        except Exception as e:
            logger.error(f"ExifTool unexpected error: {e}")
            return Result.Err(
                ErrorCode.EXIFTOOL_ERROR,
                str(e),
                quality="degraded"
            )

    def read_batch(self, paths: List[str], tags: Optional[List[str]] = None) -> Dict[str, Result[Dict[str, Any]]]:
        """
        Read metadata from multiple files using a single ExifTool invocation.

        This is dramatically faster than calling read() per file due to subprocess overhead.

        Args:
            paths: List of file paths
            tags: Optional list of specific tags to read

        Returns:
            Dict mapping file path to Result with metadata
        """
        if not self._available:
            err = Result.Err(ErrorCode.TOOL_MISSING, "ExifTool not found in PATH", quality="none")
            return {str(p): err for p in paths}

        if not paths:
            return {}

        # Filter valid paths
        valid_paths = []
        results = {}

        for path in paths:
            if not path or "\x00" in str(path):
                results[str(path)] = Result.Err(ErrorCode.INVALID_INPUT, "Invalid file path", quality="none")
                continue
            try:
                p = Path(str(path))
                if not p.exists() or not p.is_file():
                    results[str(path)] = Result.Err(ErrorCode.NOT_FOUND, f"File not found: {path}", quality="none")
                    continue
                valid_paths.append(str(path))
            except Exception:
                results[str(path)] = Result.Err(ErrorCode.INVALID_INPUT, "Invalid file path", quality="none")

        if not valid_paths:
            return results

        tags_res = _validate_exiftool_tags(tags)
        if not tags_res.ok:
            err = Result.Err(tags_res.code, tags_res.error or "Invalid tags", **(tags_res.meta or {}))
            for path in valid_paths:
                results[path] = err
            return results
        safe_tags = tags_res.data or []

        key_to_paths, cmd_paths = _build_match_map(valid_paths)

        try:
            # Build batch command
            cmd = [self.bin, "-j", "-G1", "-ee", "-a", "-U", "-s"]
            if safe_tags:
                cmd.extend([f"-{tag}" for tag in safe_tags])

            if os.name == "nt":
                cmd.extend(["-charset", "filename=utf8"])

            # Add all paths (de-duplicated by normalized key to avoid repeated work)
            cmd.extend(cmd_paths)

            # Run command
            process = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                check=False,
                timeout=self.timeout * len(cmd_paths),  # Scale timeout with file count
                encoding="utf-8",
                errors="replace",
                shell=False,
            )

            stdout = process.stdout or ""
            stderr = process.stderr or ""
            had_replacements = ("\ufffd" in stdout) or ("\ufffd" in stderr)

            if had_replacements:
                logger.warning("ExifTool batch output contained decoding replacement characters")

            if process.returncode != 0:
                stderr_msg = stderr.strip()
                logger.warning(f"ExifTool batch error: {stderr_msg}")
                # Partial failure - some files may have succeeded

            # Parse JSON output
            if not stdout.strip():
                err = Result.Err(ErrorCode.PARSE_ERROR, "ExifTool returned empty output", quality="degraded")
                for path in valid_paths:
                    results[path] = err
                return results

            try:
                data = json.loads(stdout)
            except json.JSONDecodeError as e:
                logger.error(f"ExifTool batch JSON parse error: {e}")
                err = Result.Err(ErrorCode.PARSE_ERROR, f"Failed to parse ExifTool output: {e}", quality="degraded")
                for path in valid_paths:
                    results[path] = err
                return results

            if not isinstance(data, list):
                err = Result.Err(ErrorCode.PARSE_ERROR, "ExifTool batch returned non-list", quality="degraded")
                for path in valid_paths:
                    results[path] = err
                return results

            # Match results to input paths using SourceFile field.
            # ExifTool may skip corrupted files, so we CANNOT rely on array index matching.
            for file_data in data:
                if not isinstance(file_data, dict):
                    logger.warning(f"ExifTool batch returned non-dict item: {type(file_data)}")
                    continue

                # Get the source file from ExifTool result
                source_file = file_data.get("SourceFile")
                if not source_file:
                    logger.warning("ExifTool result missing SourceFile field")
                    continue

                source_key = _normalize_match_path(str(source_file))
                if not source_key:
                    logger.warning(f"Failed to normalize SourceFile path {source_file}")
                    continue

                matched_paths = key_to_paths.get(source_key)
                if matched_paths:
                    for path in matched_paths:
                        results[path] = Result.Ok(
                            file_data,
                            quality="full" if not had_replacements else "degraded",
                        )
                else:
                    logger.warning(f"ExifTool returned data for unexpected file: {source_file}")

            # Handle files that didn't return results (corrupted, unsupported, etc.)
            for path in valid_paths:
                if path not in results:
                    results[path] = Result.Err(ErrorCode.PARSE_ERROR, "No metadata returned by ExifTool", quality="none")

            return results

        except subprocess.TimeoutExpired:
            logger.error(f"ExifTool batch timeout for {len(valid_paths)} files")
            err = Result.Err(ErrorCode.TIMEOUT, "ExifTool batch timeout", quality="degraded")
            for path in valid_paths:
                if path not in results:
                    results[path] = err
            return results
        except Exception as e:
            logger.error(f"ExifTool batch unexpected error: {e}")
            err = Result.Err(ErrorCode.EXIFTOOL_ERROR, str(e), quality="degraded")
            for path in valid_paths:
                if path not in results:
                    results[path] = err
            return results

    def write(self, path: str, metadata: dict, preserve_workflow: bool = True) -> Result[bool]:
        """
        Write metadata to file using ExifTool.

        Args:
            path: File path
            metadata: Metadata key-value pairs to write
            preserve_workflow: Copy original metadata fields before writing

        Returns:
            Result with success boolean
        """
        if not self._available:
            return Result.Err(
                ErrorCode.TOOL_MISSING,
                "ExifTool not found in PATH"
            )

        if not path or "\x00" in str(path):
            return Result.Err(ErrorCode.INVALID_INPUT, "Invalid file path")
        try:
            p = Path(str(path))
        except Exception:
            return Result.Err(ErrorCode.INVALID_INPUT, "Invalid file path")
        if not p.exists() or not p.is_file():
            return Result.Err(ErrorCode.NOT_FOUND, f"File not found: {path}")

        try:
            # Build command
            cmd = [self.bin]

            # Preserve existing metadata if requested
            if preserve_workflow:
                cmd.extend(["-tagsFromFile", "@"])

            invalid_keys: List[str] = []
            for key in (metadata or {}).keys():
                if not isinstance(key, str):
                    invalid_keys.append(str(key))
                    continue
                if not _is_safe_exiftool_tag(key.strip()):
                    invalid_keys.append(key.strip())
            if invalid_keys:
                return Result.Err(
                    ErrorCode.INVALID_INPUT,
                    "Invalid ExifTool tag format",
                    invalid_tags=invalid_keys,
                )

            # Add metadata tags
            # - Scalars: `-Tag=Value`
            # - Lists: clear then append (`-Tag=` then `-Tag+=Item`)
            # This matches ExifTool's array semantics (XMP arrays, IPTC keyword lists, etc.).
            for key, value in (metadata or {}).items():
                if value is None:
                    cmd.append(f"-{key}=")
                    continue
                if isinstance(value, list):
                    cmd.append(f"-{key}=")
                    for item in value:
                        if item is None:
                            continue
                        text = str(item).strip()
                        if text:
                            cmd.append(f"-{key}+={text}")
                    continue
                cmd.append(f"-{key}={value}")

            stdin_input = None
            if os.name == "nt":
                cmd.extend(["-charset", "filename=utf8", "-@", "-"])
                stdin_input = f"{path}\n"
                cmd.append("-overwrite_original")
            else:
                # Overwrite original file
                cmd.extend(["-overwrite_original", path])

            # Run command
            process = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                check=False,
                timeout=self.timeout,
                encoding="utf-8",
                errors="replace",
                input=stdin_input,
                shell=False,
            )

            stdout = process.stdout or ""
            stderr = process.stderr or ""
            if "\ufffd" in stdout or "\ufffd" in stderr:
                logger.warning("ExifTool write output contained decoding replacement characters for %s", path)

            if process.returncode != 0:
                stderr_msg = stderr.strip()
                logger.warning(f"ExifTool write error for {path}: {stderr_msg}")
                return Result.Err(
                    ErrorCode.EXIFTOOL_ERROR,
                    stderr_msg or "ExifTool write failed"
                )

            logger.debug(f"Metadata written to {path}")
            return Result.Ok(True)

        except subprocess.TimeoutExpired:
            logger.error(f"ExifTool write timeout for {path}")
            return Result.Err(
                ErrorCode.TIMEOUT,
                f"ExifTool write timeout after {self.timeout}s"
            )
        except Exception as e:
            logger.error(f"ExifTool write error: {e}")
            return Result.Err(
                ErrorCode.EXIFTOOL_ERROR,
                str(e)
            )
