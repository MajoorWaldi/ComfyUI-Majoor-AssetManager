"""
FFprobe adapter for video metadata extraction.
"""
import subprocess
import json
import shutil
import os
from pathlib import Path
from typing import Optional, List, Dict

from ...config import FFPROBE_TIMEOUT
from ...shared import Result, ErrorCode, get_logger

logger = get_logger(__name__)

class FFProbe:
    """
    FFprobe wrapper for video metadata extraction.

    Never raises exceptions - always returns Result.
    """

    def __init__(self, bin_name: str = "ffprobe", timeout: Optional[float] = None):
        """
        Initialize FFprobe adapter.

        Args:
            bin_name: FFprobe binary name or path
            timeout: Command timeout in seconds
        """
        self.bin = bin_name
        self.timeout = float(timeout) if timeout is not None else float(FFPROBE_TIMEOUT)
        self._resolved_bin: Optional[str] = None
        self._available = self._check_available()

    def _resolve_executable(self, bin_name: str) -> Optional[str]:
        """
        Resolve and validate the ffprobe executable.

        Defends against untrusted configuration values and ensures we're invoking an
        actual ffprobe binary (not an arbitrary command string).
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

        if not name.startswith("ffprobe"):
            return None

        return resolved

    def _check_available(self) -> bool:
        """Check if ffprobe is available in PATH."""
        resolved = self._resolve_executable(self.bin)
        if not resolved:
            return False
        self._resolved_bin = resolved
        return True

    def is_available(self) -> bool:
        """Check if ffprobe is available."""
        return self._available

    def read(self, path: str) -> Result[dict]:
        """
        Read video metadata using ffprobe.

        Args:
            path: Video file path

        Returns:
            Result with metadata dict containing 'format' and 'streams'
        """
        if not self._available:
            return Result.Err(
                ErrorCode.TOOL_MISSING,
                "ffprobe not found in PATH",
                quality="none"
            )

        try:
            # Build command
            cmd = [
                self._resolved_bin or self.bin,
                "-v", "error",              # Hide verbose output
                "-print_format", "json",     # JSON output
                "-show_format",              # Show container format
                "-show_streams",             # Show stream info
                path
            ]

            # Run command
            process = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                check=False,
                timeout=self.timeout,
                shell=False,
                close_fds=os.name != "nt",
            )

            if process.returncode != 0:
                stderr = process.stderr.strip()
                logger.warning(f"ffprobe error for {path}: {stderr}")
                return Result.Err(
                    ErrorCode.FFPROBE_ERROR,
                    stderr or "ffprobe command failed",
                    quality="degraded"
                )

            # Parse JSON output
            if not process.stdout or not process.stdout.strip():
                logger.warning(f"ffprobe returned empty output for {path}")
                return Result.Err(
                    ErrorCode.FFPROBE_ERROR,
                    "No ffprobe output",
                    quality="degraded"
                )

            data = json.loads(process.stdout)

            if not isinstance(data, dict):
                return Result.Err(
                    ErrorCode.PARSE_ERROR,
                    "Invalid ffprobe output format",
                    quality="degraded"
                )

            # Extract useful metadata
            result = {
                "format": data.get("format", {}),
                "streams": data.get("streams", []),
                "video_stream": self._find_video_stream(data.get("streams", [])),
                "audio_stream": self._find_audio_stream(data.get("streams", [])),
            }

            return Result.Ok(result, quality="full")

        except subprocess.TimeoutExpired:
            logger.error(f"ffprobe timeout for {path}")
            return Result.Err(
                ErrorCode.TIMEOUT,
                f"ffprobe timeout after {self.timeout}s",
                quality="degraded"
            )
        except json.JSONDecodeError as e:
            logger.error(f"ffprobe JSON parse error: {e}")
            return Result.Err(
                ErrorCode.PARSE_ERROR,
                f"Failed to parse ffprobe output: {e}",
                quality="degraded"
            )
        except Exception as e:
            logger.error(f"ffprobe unexpected error: {e}")
            return Result.Err(
                ErrorCode.FFPROBE_ERROR,
                str(e),
                quality="degraded"
            )

    def read_batch(self, paths: List[str]) -> Dict[str, Result[dict]]:
        """
        Read metadata from multiple video files.

        Note: FFProbe doesn't have native batch mode, so we use concurrent.futures
        for parallel execution to avoid sequential subprocess overhead.

        Args:
            paths: List of video file paths

        Returns:
            Dict mapping file path to Result with metadata
        """
        if not self._available:
            err = Result.Err(ErrorCode.TOOL_MISSING, "ffprobe not found in PATH", quality="none")
            return {str(p): err for p in paths}

        if not paths:
            return {}

        from concurrent.futures import ThreadPoolExecutor, as_completed
        results = {}

        # Use thread pool for parallel execution (I/O bound)
        max_workers = min(4, len(paths))  # Limit to 4 concurrent ffprobe processes

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_path = {executor.submit(self.read, path): path for path in paths}

            for future in as_completed(future_to_path):
                path = future_to_path[future]
                try:
                    results[str(path)] = future.result()
                except Exception as e:
                    logger.error(f"FFProbe batch error for {path}: {e}")
                    results[str(path)] = Result.Err(ErrorCode.FFPROBE_ERROR, str(e), quality="degraded")

        return results

    def _find_video_stream(self, streams: list) -> dict:
        """Find first video stream in streams list."""
        for stream in streams:
            if stream.get("codec_type") == "video":
                return stream
        return {}

    def _find_audio_stream(self, streams: list) -> dict:
        """Find first audio stream in streams list."""
        for stream in streams:
            if stream.get("codec_type") == "audio":
                return stream
        return {}

    def get_duration(self, path: str) -> Result[float]:
        """
        Get video duration in seconds.

        Args:
            path: Video file path

        Returns:
            Result with duration as float
        """
        result = self.read(path)
        if not result.ok:
            return result

        # Try format duration first
        format_info = result.data.get("format", {})
        duration_str = format_info.get("duration")

        if duration_str:
            try:
                return Result.Ok(float(duration_str))
            except ValueError:
                pass

        # Try video stream duration
        video_stream = result.data.get("video_stream", {})
        duration_str = video_stream.get("duration")

        if duration_str:
            try:
                return Result.Ok(float(duration_str))
            except ValueError:
                pass

        return Result.Err(
            ErrorCode.PARSE_ERROR,
            "Duration not found in video metadata"
        )

    def get_resolution(self, path: str) -> Result[tuple[int, int]]:
        """
        Get video resolution (width, height).

        Args:
            path: Video file path

        Returns:
            Result with (width, height) tuple
        """
        result = self.read(path)
        if not result.ok:
            return result

        video_stream = result.data.get("video_stream", {})
        width = video_stream.get("width")
        height = video_stream.get("height")

        if width and height:
            return Result.Ok((int(width), int(height)))

        return Result.Err(
            ErrorCode.PARSE_ERROR,
            "Resolution not found in video metadata"
        )
