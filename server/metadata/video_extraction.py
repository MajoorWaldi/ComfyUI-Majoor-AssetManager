import copy
import json
import os
import shutil
import subprocess
import threading
import time
from collections import OrderedDict
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from .workflow_normalize import _normalize_workflow_to_prompt_graph, _ensure_dict_from_json, _json_loads_relaxed
from .workflow_reconstruct import prompt_graph_to_workflow
from ..logger import get_logger
from ..utils import _get_exiftool_path

log = get_logger(__name__)

_VIDEO_META_CACHE_LOCK = threading.Lock()
_VIDEO_META_CACHE: "OrderedDict[str, Dict[str, Any]]" = OrderedDict()


def _video_meta_cache_cfg() -> tuple[int, float, bool]:
    """
    Returns (max_entries, ttl_seconds, debug).
    - max_entries: 0 disables caching
    - ttl_seconds: 0 disables TTL expiry (cache lives until eviction)
    """
    try:
        max_entries = int(os.environ.get("MJR_VIDEO_META_CACHE_SIZE", "256"))
    except Exception:
        max_entries = 256
    max_entries = max(0, min(max_entries, 10_000))

    try:
        ttl = float(os.environ.get("MJR_VIDEO_META_CACHE_TTL", "0"))
    except Exception:
        ttl = 0.0
    ttl = max(0.0, min(ttl, 24 * 60 * 60))

    dbg = (os.environ.get("MJR_VIDEO_META_CACHE_DEBUG", "") or "").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )
    return max_entries, ttl, dbg


def _video_meta_cache_key(path: Path) -> str:
    try:
        return os.path.normcase(os.path.abspath(str(path)))
    except Exception:
        return str(path)


def _video_meta_signature(path: Path) -> Optional[tuple[int, int]]:
    try:
        st = path.stat()
        mtime_ns = getattr(st, "st_mtime_ns", int(st.st_mtime * 1_000_000_000))
        size = int(st.st_size)
        return int(mtime_ns), size
    except Exception:
        return None


def _video_meta_cache_get(path: Path) -> Optional[Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]]:
    max_entries, ttl, dbg = _video_meta_cache_cfg()
    if max_entries <= 0:
        return None

    key = _video_meta_cache_key(path)
    sig = _video_meta_signature(path)
    if sig is None:
        return None

    now = time.time()
    with _VIDEO_META_CACHE_LOCK:
        entry = _VIDEO_META_CACHE.get(key)
        if not entry:
            return None
        if entry.get("sig") != sig:
            _VIDEO_META_CACHE.pop(key, None)
            return None
        if ttl > 0 and (now - float(entry.get("ts", 0.0))) > ttl:
            _VIDEO_META_CACHE.pop(key, None)
            return None
        _VIDEO_META_CACHE.move_to_end(key)
        if dbg:
            log.debug("[Majoor] video meta cache hit: %s", path.name)
        return copy.deepcopy(entry.get("prompt")), copy.deepcopy(entry.get("workflow"))


def _video_meta_cache_put(
    path: Path,
    prompt: Optional[Dict[str, Any]],
    workflow: Optional[Dict[str, Any]],
) -> None:
    max_entries, ttl, dbg = _video_meta_cache_cfg()
    if max_entries <= 0:
        return

    key = _video_meta_cache_key(path)
    sig = _video_meta_signature(path)
    if sig is None:
        return

    with _VIDEO_META_CACHE_LOCK:
        _VIDEO_META_CACHE[key] = {
            "sig": sig,
            "ts": time.time(),
            "prompt": copy.deepcopy(prompt),
            "workflow": copy.deepcopy(workflow),
        }
        _VIDEO_META_CACHE.move_to_end(key)

        evicted = 0
        while len(_VIDEO_META_CACHE) > max_entries:
            _VIDEO_META_CACHE.popitem(last=False)
            evicted += 1
        if dbg:
            msg = f"[Majoor] video meta cache store: {path.name}"
            if evicted:
                msg += f" (evicted {evicted})"
            log.debug("%s", msg)


def _balanced_json_from_text(text: str, start_idx: int, max_chars: int = 2_000_000) -> Optional[str]:
    """
    Simple balanced-brace scanner starting at `start_idx` (expected to be '{').
    Stops when depth returns to zero or when exceeding `max_chars`.
    Ignores braces inside quoted strings.
    """
    if start_idx < 0 or start_idx >= len(text) or text[start_idx] != "{":
        return None

    depth = 0
    in_str = False
    escape = False
    limit = min(len(text), start_idx + max_chars)

    for i in range(start_idx, limit):
        ch = text[i]
        if in_str:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_str = False
            continue

        if ch == '"':
            in_str = True
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start_idx : i + 1]
    return None


def _extract_json_from_video(path: Path) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    """
    Extract prompt/workflow JSON from a video container using exiftool.
    Returns (prompt_graph, raw_workflow).
    """
    cached = _video_meta_cache_get(path)
    if cached is not None:
        return cached

    exe = _get_exiftool_path() if callable(_get_exiftool_path) else None
    found_prompt = None
    found_workflow = None

    try:
        exif_timeout = float(os.environ.get("MJR_META_EXIFTOOL_TIMEOUT", "12"))
    except Exception:
        exif_timeout = 12.0
    exif_timeout = max(1.0, min(exif_timeout, 60.0))

    try:
        ffprobe_timeout = float(os.environ.get("MJR_META_FFPROBE_TIMEOUT", "8"))
    except Exception:
        ffprobe_timeout = 8.0
    ffprobe_timeout = max(1.0, min(ffprobe_timeout, 30.0))

    def parse_vhs_json(json_str: str):
        nonlocal found_prompt, found_workflow
        try:
            payload = _json_loads_relaxed(json_str)
            if not isinstance(payload, dict):
                return
            if "workflow" in payload:
                wf = payload["workflow"]
                if isinstance(wf, str):
                    wf = _ensure_dict_from_json(wf)
                if isinstance(wf, dict) and wf.get("nodes"):
                    found_workflow = wf
            if "prompt" in payload:
                pr = payload["prompt"]
                if isinstance(pr, str):
                    pr = _ensure_dict_from_json(pr)
                if isinstance(pr, dict):
                    first = next(iter(pr.values()), None)
                    if isinstance(first, dict) and "inputs" in first:
                        found_prompt = pr
            if found_workflow is None and isinstance(payload.get("nodes"), list):
                found_workflow = payload
                if found_prompt is None:
                    found_prompt = _normalize_workflow_to_prompt_graph(payload)
            if found_prompt is None:
                if any(isinstance(v, dict) and "inputs" in v for v in payload.values() if isinstance(v, dict)):
                    found_prompt = payload
        except Exception:
            pass

    def recursive_scan(obj):
        nonlocal found_prompt, found_workflow
        if found_prompt and found_workflow:
            return
        if isinstance(obj, dict):
            for k, v in obj.items():
                key_norm = str(k).lower()

                # QuickTime Keys tags contain workflow/prompt directly
                if key_norm == "keys:workflow" and isinstance(v, str):
                    s = v.strip()
                    if s.startswith("{"):
                        try:
                            wf = _json_loads_relaxed(s)
                            if isinstance(wf, dict) and wf.get("nodes"):
                                found_workflow = wf
                        except Exception:
                            pass
                    continue

                if key_norm == "keys:prompt" and isinstance(v, str):
                    s = v.strip()
                    if s.startswith("{"):
                        try:
                            pr = _json_loads_relaxed(s)
                            if isinstance(pr, dict):
                                first = next(iter(pr.values()), None)
                                if isinstance(first, dict) and "inputs" in first:
                                    found_prompt = pr
                        except Exception:
                            pass
                    continue

                key_interesting = key_norm in (
                    "comment",
                    "usercomment",
                    "description",
                    "parameters",
                    "xpcomment",
                    "userdata",
                    "user_data",
                    "xmp:comment",
                    "xmp:description",
                    "xmp:usercomment",
                    "itemlist:comment",
                    "itemlist:description",
                    "itemlist:usercomment",
                )
                if isinstance(v, str):
                    s = v.strip()
                    if s.startswith("{"):
                        parse_vhs_json(s)
                    elif any(tok in s for tok in ('"prompt"', '"workflow"', '"nodes"', '"extra_pnginfo"', '"class_type"', '"inputs"')):
                        start = s.find("{")
                        if start != -1:
                            candidate = _balanced_json_from_text(s, start)
                            if candidate:
                                parse_vhs_json(candidate)
                    elif key_interesting:
                        # If the value is not obvious JSON but comes from a comment-like field, try to locate balanced JSON anyway
                        start = s.find("{")
                        if start != -1:
                            candidate = _balanced_json_from_text(s, start)
                            if candidate:
                                parse_vhs_json(candidate)
                elif isinstance(v, (dict, list)):
                    recursive_scan(v)
            return
        if isinstance(obj, list):
            for v in obj:
                recursive_scan(v)
            return
        if isinstance(obj, str):
            s = obj.strip()
            if s.startswith("{"):
                parse_vhs_json(s)
            elif any(tok in s for tok in ('"prompt"', '"workflow"', '"nodes"')):
                start = s.find("{")
                if start != -1:
                    candidate = _balanced_json_from_text(s, start)
                    if candidate:
                        parse_vhs_json(candidate)

    # Preferred order for video metadata extraction:
    # 1) ExifTool (best coverage for container/user metadata)
    # 2) ffprobe (format/stream tags)
    # 3) Windows Property System (Explorer properties like Comment)
    # FIX: Use subprocess.run with proper cleanup instead of check_output
    if exe and not (found_prompt and found_workflow):
        proc = None
        try:
            cmd = [
                exe,
                "-j",
                "-Comment",
                "-UserComment",
                "-Description",
                "-XPComment",
                "-Parameters",
                "-XMP:Comment",
                "-XMP:Description",
                "-XMP:UserComment",
                "-ItemList:Comment",
                "-ItemList:Description",
                "-ItemList:UserComment",
                "-Keys:Workflow",
                "-Keys:Prompt",
                str(path),
            ]
            proc = subprocess.run(
                cmd,
                capture_output=True,
                timeout=exif_timeout,
                check=False
            )
            if proc.returncode == 0 and proc.stdout:
                data_list = json.loads(proc.stdout)
                if data_list:
                    recursive_scan(data_list[0])
        except subprocess.TimeoutExpired:
            if proc:
                proc.kill()
                proc.wait()
            log.warning(
                "[Majoor] ExifTool (light) timeout on %s after %ss",
                path.name,
                exif_timeout,
            )
        except Exception:
            pass
        finally:
            if proc and proc.returncode is None:
                try:
                    proc.kill()
                    proc.wait()
                except Exception:
                    pass

    if exe and not (found_prompt and found_workflow):
        proc = None
        try:
            cmd = [exe, "-j", "-g", "-ee", str(path)]
            proc = subprocess.run(
                cmd,
                capture_output=True,
                timeout=exif_timeout,
                check=False
            )
            if proc.returncode == 0 and proc.stdout:
                data_list = json.loads(proc.stdout)
                if data_list:
                    recursive_scan(data_list[0])
        except subprocess.TimeoutExpired:
            if proc:
                proc.kill()
                proc.wait()
            log.warning(
                "[Majoor] ExifTool timeout on %s after %ss",
                path.name,
                exif_timeout,
            )
        except (json.JSONDecodeError, OSError) as e:
            log.warning("[Majoor] ExifTool error on %s: %s", path.name, e)
        except Exception as e:
            log.warning("[Majoor] ExifTool unexpected error on %s: %s", path.name, e)
        finally:
            if proc and proc.returncode is None:
                try:
                    proc.kill()
                    proc.wait()
                except Exception:
                    pass

    if not found_prompt and not found_workflow:
        ffprobe = shutil.which("ffprobe")
        if ffprobe:
            proc = None
            try:
                cmd = [
                    ffprobe,
                    "-v",
                    "error",
                    "-print_format",
                    "json",
                    "-show_entries",
                    "format_tags:stream_tags",
                    str(path),
                ]
                proc = subprocess.run(
                    cmd,
                    capture_output=True,
                    timeout=ffprobe_timeout,
                    check=False
                )
                if proc.returncode == 0 and proc.stdout:
                    data = json.loads(proc.stdout)
                    tags = (data.get("format") or {}).get("tags") or {}
                    recursive_scan(tags)
                    for stream in data.get("streams") or []:
                        recursive_scan(stream.get("tags") or {})
            except subprocess.TimeoutExpired:
                if proc:
                    proc.kill()
                    proc.wait()
                log.warning(
                    "[Majoor] ffprobe timeout on %s after %ss",
                    path.name,
                    ffprobe_timeout,
                )
            except (json.JSONDecodeError, OSError) as e:
                log.warning("[Majoor] ffprobe error on %s: %s", path.name, e)
            except Exception as e:
                log.warning("[Majoor] ffprobe unexpected error on %s: %s", path.name, e)
            finally:
                if proc and proc.returncode is None:
                    try:
                        proc.kill()
                        proc.wait()
                    except Exception:
                        pass

    if not found_prompt and not found_workflow and os.name == "nt":
        try:
            import pythoncom  # type: ignore
            from win32com.propsys import propsys, pscon  # type: ignore

            pythoncom.CoInitialize()
            store = propsys.SHGetPropertyStoreFromParsingName(str(path), None, pscon.GPS_BESTEFFORT)
            props = {}
            for kname in ("PKEY_Comment", "PKEY_Title", "PKEY_Subject", "PKEY_Keywords", "PKEY_Category"):
                key = getattr(pscon, kname, None)
                if key is None:
                    continue
                try:
                    val = store.GetValue(key).GetValue()
                except Exception:
                    continue
                if val is None:
                    continue
                if isinstance(val, tuple):
                    val = list(val)
                props[kname[5:].lower()] = val
            if props:
                recursive_scan(props)
        except Exception:
            pass

    if not found_prompt and not found_workflow:
        try:
            size = path.stat().st_size
        except Exception:
            size = 0

        try:
            scan_budget = int(os.environ.get("MJR_META_SCAN_BYTES", str(1 * 1024 * 1024)))
        except Exception:
            scan_budget = 1 * 1024 * 1024
        scan_budget = max(512 * 1024, min(scan_budget, 16 * 1024 * 1024))
        blob = b""
        try:
            with open(path, "rb") as f:
                head = f.read(scan_budget)
                blob += head
                if size > scan_budget:
                    try:
                        f.seek(max(0, size - scan_budget))
                        tail = f.read(scan_budget)
                        blob += tail
                    except Exception:
                        pass
        except Exception as e:
            log.warning("[Majoor] raw scan failed for %s: %s", path.name, e)
            blob = b""

        if blob:
            try:
                text_blob = blob.decode("utf-8", errors="ignore")
            except Exception:
                text_blob = ""

            if text_blob:
                keywords = ['"prompt"', '"workflow"', '"nodes"']
                for kw in keywords:
                    pos = text_blob.find(kw)
                    while pos != -1 and not (found_prompt and found_workflow):
                        start = text_blob.rfind("{", 0, pos)
                        if start == -1:
                            pos = text_blob.find(kw, pos + len(kw))
                            continue
                        candidate = _balanced_json_from_text(text_blob, start)
                        if candidate:
                            parse_vhs_json(candidate)
                            if found_prompt and found_workflow:
                                break
                        pos = text_blob.find(kw, pos + len(kw))

    if found_workflow and not found_prompt:
        found_prompt = _normalize_workflow_to_prompt_graph(found_workflow)
    # Fallback: if only a prompt graph was found, reconstruct a minimal workflow
    if found_workflow is None and isinstance(found_prompt, dict):
        found_workflow = prompt_graph_to_workflow(found_prompt)

    _video_meta_cache_put(path, found_prompt, found_workflow)
    return found_prompt, found_workflow


__all__ = ["_extract_json_from_video"]
