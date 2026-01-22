from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Optional, Tuple


def _parse_fps(value: Any) -> Optional[float]:
    try:
        if value is None:
            return None
        if isinstance(value, (int, float)):
            v = float(value)
            return v if v > 0 else None
        s = str(value).strip()
        if not s:
            return None
        if "/" in s:
            a, b = s.split("/", 1)
            na = float(a)
            nb = float(b)
            if nb == 0:
                return None
            v = na / nb
            return v if v > 0 else None
        v = float(s)
        return v if v > 0 else None
    except Exception:
        return None


def _pick_ffprobe_video_stream(metadata_raw: Any) -> Dict[str, Any]:
    try:
        if not isinstance(metadata_raw, dict):
            return {}
        ff = metadata_raw.get("raw_ffprobe") or {}
        if not isinstance(ff, dict):
            return {}
        vs = ff.get("video_stream") or {}
        return vs if isinstance(vs, dict) else {}
    except Exception:
        return {}


def build_viewer_media_info(asset: Dict[str, Any], resolved_path: Optional[Path] = None) -> Dict[str, Any]:
    """
    Build a compact media info payload for the viewer UI.
    Must be safe to call on partially populated assets.
    """
    info: Dict[str, Any] = {}
    try:
        info["asset_id"] = asset.get("id")
    except Exception:
        pass

    kind = str(asset.get("kind") or "").lower()
    info["kind"] = kind or None

    try:
        info["ext"] = str(asset.get("ext") or "").lower() or None
    except Exception:
        info["ext"] = None

    try:
        info["width"] = int(asset["width"]) if asset.get("width") is not None else None
    except Exception:
        info["width"] = None
    try:
        info["height"] = int(asset["height"]) if asset.get("height") is not None else None
    except Exception:
        info["height"] = None

    try:
        d = asset.get("duration")
        info["duration_s"] = float(d) if d is not None else None
    except Exception:
        info["duration_s"] = None

    metadata_raw = asset.get("metadata_raw") if isinstance(asset, dict) else None

    # Video extras
    if kind == "video":
        vs = _pick_ffprobe_video_stream(metadata_raw)

        fps_raw = None
        try:
            fps_raw = (metadata_raw or {}).get("fps")
        except Exception:
            fps_raw = None
        try:
            if fps_raw is None:
                fps_raw = vs.get("avg_frame_rate") or vs.get("r_frame_rate")
        except Exception:
            pass

        fps = _parse_fps(fps_raw)
        info["fps"] = fps
        info["fps_raw"] = str(fps_raw) if fps_raw is not None else None

        frame_count = None
        for key in ("nb_frames", "nb_read_frames"):
            try:
                v = vs.get(key)
                n = int(v)
                if n > 0:
                    frame_count = n
                    break
            except Exception:
                continue
        if frame_count is None:
            # Best-effort derive from duration * fps (not exact for VFR, but useful).
            try:
                dur = info.get("duration_s")
                if fps and isinstance(dur, (int, float)) and dur and dur > 0:
                    frame_count = max(1, int(round(float(dur) * fps)))
            except Exception:
                frame_count = None
        info["frame_count"] = frame_count

    # File stats (prefer DB if present, but stat is authoritative when provided).
    try:
        size = asset.get("size")
        info["size_bytes"] = int(size) if size is not None else None
    except Exception:
        info["size_bytes"] = None
    try:
        mtime = asset.get("mtime")
        info["mtime"] = int(mtime) if mtime is not None else None
    except Exception:
        info["mtime"] = None

    if resolved_path is not None:
        try:
            st = resolved_path.stat()
            info["size_bytes"] = int(getattr(st, "st_size", 0) or 0) or info.get("size_bytes")
            info["mtime"] = int(getattr(st, "st_mtime", 0) or 0) or info.get("mtime")
        except Exception:
            pass

    return info

