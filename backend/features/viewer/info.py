from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


def _parse_fps(value: Any) -> Optional[float]:
    """Safely parse FPS from various formats (number, string, fraction)."""
    if value is None:
        return None
        
    try:
        if isinstance(value, (int, float)):
            v = float(value)
            return v if v > 0 else None

        val_str = str(value).strip()
        if not val_str:
            return None

        # Check for fraction format '30000/1001'
        if "/" in val_str:
            num_s, den_s = val_str.split("/", 1)
            num = float(num_s)
            den = float(den_s)
            if den == 0:
                return None
            result = num / den
        else:
            # Direct number check
            result = float(val_str)

        return result if result > 0 else None

    except (ValueError, TypeError, AttributeError):
        # Expected parsing errors for invalid data
        return None
    except Exception:
        # Unexpected errors
        return None


def _pick_ffprobe_video_stream(metadata_raw: Any) -> Dict[str, Any]:
    if not isinstance(metadata_raw, dict):
        return {}
    ff = metadata_raw.get("raw_ffprobe")
    if not isinstance(ff, dict):
        return {}
    vs = ff.get("video_stream")
    return vs if isinstance(vs, dict) else {}


def _pick_ffprobe_audio_stream(metadata_raw: Any) -> Dict[str, Any]:
    if not isinstance(metadata_raw, dict):
        return {}
    ff = metadata_raw.get("raw_ffprobe")
    if not isinstance(ff, dict):
        return {}
    a = ff.get("audio_stream")
    return a if isinstance(a, dict) else {}


def build_viewer_media_info(asset: Dict[str, Any], resolved_path: Optional[Path] = None, refresh: bool = False) -> Dict[str, Any]:
    """
    Build a compact media info payload for the viewer UI.
    Must be safe to call on partially populated assets.
    """
    if not isinstance(asset, dict):
        return {}
    
    info: Dict[str, Any] = {}
    
    # Safe extraction helper
    def _safe_get(key: str, type_cast: type = str) -> Any:
        try:
            val = asset.get(key)
            if val is None:
                return None
            return type_cast(val)
        except Exception:
            return None

    # Basic Info
    info["asset_id"] = asset.get("id")
    
    kind = str(asset.get("kind") or "").lower()
    info["kind"] = kind or None
    
    ext = str(asset.get("ext") or "").lower()
    info["ext"] = ext or None

    info["width"] = _safe_get("width", int)
    info["height"] = _safe_get("height", int)
    info["duration_s"] = _safe_get("duration", float)

    metadata_raw = asset.get("metadata_raw")

    # Video extended info
    if kind == "video":
        vs = _pick_ffprobe_video_stream(metadata_raw)
        
        fps_raw = None
        if isinstance(metadata_raw, dict):
            fps_raw = metadata_raw.get("fps")
        if fps_raw is None:
            fps_raw = vs.get("avg_frame_rate") or vs.get("r_frame_rate")

        fps = _parse_fps(fps_raw)
        info["fps"] = fps
        info["fps_raw"] = str(fps_raw) if fps_raw is not None else None

        frame_count = None
        # Valid frame count sources
        for key in ("nb_frames", "nb_read_frames"):
            try:
                val = int(vs.get(key))
                if val > 0:
                    frame_count = val
                    break
            except (ValueError, TypeError):
                continue
        
        # Fallback: Duration * FPS
        if frame_count is None:
            dur = info.get("duration_s")
            if fps and isinstance(dur, (int, float)) and dur > 0:
                try:
                    frame_count = max(1, int(round(dur * fps)))
                except Exception:
                    pass
        info["frame_count"] = frame_count
    elif kind == "audio":
        astream = _pick_ffprobe_audio_stream(metadata_raw)
        try:
            info["audio_codec"] = str(astream.get("codec_name")) if astream.get("codec_name") else None
        except Exception:
            info["audio_codec"] = None
        try:
            info["sample_rate"] = int(astream.get("sample_rate")) if astream.get("sample_rate") else None
        except Exception:
            info["sample_rate"] = None
        try:
            info["channels"] = int(astream.get("channels")) if astream.get("channels") else None
        except Exception:
            info["channels"] = None
        try:
            info["bitrate"] = int(astream.get("bit_rate")) if astream.get("bit_rate") else None
        except Exception:
            info["bitrate"] = None

    # File stats - prefer DB values initially
    info["size_bytes"] = _safe_get("size", int)
    info["mtime"] = _safe_get("mtime", int)

    # Override with live filesystem stats if path is provided
    if resolved_path is not None:
        try:
            st = resolved_path.stat()
            info["size_bytes"] = st.st_size
            info["mtime"] = int(st.st_mtime)
        except OSError as e:
            # Log failure but allow partial result
            logger.warning(f"Failed to access file stats for {resolved_path}: {e}")
        except Exception as e:
            logger.debug(f"Unexpected error reading stats {resolved_path}: {e}")

    return info

