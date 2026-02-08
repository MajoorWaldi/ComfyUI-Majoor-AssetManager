"""
Metadata service - coordinates metadata extraction from multiple sources.
"""
import asyncio
import logging
import os
import time
import functools
from typing import Dict, Any, Optional

from ...shared import Result, ErrorCode, get_logger, classify_file, log_structured
from ...config import METADATA_EXTRACT_CONCURRENCY
from ...adapters.tools import ExifTool, FFProbe
from ...settings import AppSettings
from ...probe_router import pick_probe_backend
from .extractors import (
    extract_png_metadata,
    extract_webp_metadata,
    extract_video_metadata,
    extract_rating_tags_from_exif,
)
from ..audio import extract_audio_metadata
from ..geninfo.parser import parse_geninfo_from_prompt
from .parsing_utils import parse_auto1111_params

logger = get_logger(__name__)


def _clean_model_name(value: Any) -> Optional[str]:
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    s = s.replace("\\", "/").split("/")[-1]
    lower = s.lower()
    for ext in (".safetensors", ".ckpt", ".pt", ".pth", ".bin", ".gguf", ".json"):
        if lower.endswith(ext):
            return s[: -len(ext)]
    return s


def _build_geninfo_from_parameters(meta: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Build a backend `geninfo` object from explicit A1111/Forge-style parameters data.

    Accuracy-first (no guessing): only uses fields already parsed by the extractor.
    """
    if not isinstance(meta, dict):
        return None

    parsed_meta = dict(meta)
    params_text = parsed_meta.get("parameters")
    if isinstance(params_text, str) and params_text.strip():
        parsed_params = parse_auto1111_params(params_text)
        if parsed_params:
            if logger.isEnabledFor(logging.DEBUG):
                logger.debug(
                    "Parsed PNG:Parameters for geninfo fallback (%s keys)",
                    ", ".join(sorted(parsed_params.keys())),
                )
            for key, value in parsed_params.items():
                if value is None:
                    continue
                parsed_meta[key] = value
        elif logger.isEnabledFor(logging.DEBUG):
            logger.debug("Auto1111 parameter parser returned no fields for provided PNG:Parameters text.")

    pos = parsed_meta.get("prompt")
    neg = parsed_meta.get("negative_prompt")
    steps = parsed_meta.get("steps")
    sampler = parsed_meta.get("sampler")
    scheduler = parsed_meta.get("scheduler")
    cfg = parsed_meta.get("cfg")
    seed = parsed_meta.get("seed")
    w = parsed_meta.get("width")
    h = parsed_meta.get("height")
    model = parsed_meta.get("model")

    has_any = any(v is not None and v != "" for v in (pos, neg, steps, sampler, cfg, seed, w, h, model))
    if not has_any:
        # Return an empty dict instead of None to ensure geninfo is always a dict
        return {}

    out: Dict[str, Any] = {"engine": {"parser_version": "geninfo-params-v1", "source": "parameters"}}

    if isinstance(pos, str) and pos.strip():
        out["positive"] = {"value": pos.strip(), "confidence": "high", "source": "parameters"}
    if isinstance(neg, str) and neg.strip():
        out["negative"] = {"value": neg.strip(), "confidence": "high", "source": "parameters"}

    if sampler is not None:
        out["sampler"] = {"name": str(sampler), "confidence": "high", "source": "parameters"}
    if scheduler is not None:
        out["scheduler"] = {"name": str(scheduler), "confidence": "high", "source": "parameters"}

    if steps is not None:
        try:
            out["steps"] = {"value": int(steps), "confidence": "high", "source": "parameters"}
        except Exception:
            pass
    if cfg is not None:
        try:
            out["cfg"] = {"value": float(cfg), "confidence": "high", "source": "parameters"}
        except Exception:
            pass
    if seed is not None:
        try:
            out["seed"] = {"value": int(seed), "confidence": "high", "source": "parameters"}
        except Exception:
            pass

    if w is not None and h is not None:
        try:
            out["size"] = {"width": int(w), "height": int(h), "confidence": "high", "source": "parameters"}
        except Exception:
            pass

    ckpt = _clean_model_name(model)
    if ckpt:
        out["checkpoint"] = {"name": ckpt, "confidence": "high", "source": "parameters"}
        out["models"] = {"checkpoint": out["checkpoint"]}

    return out if len(out.keys()) > 1 else None


def _looks_like_media_pipeline(prompt_graph: Any) -> bool:
    """
    Detect "media-only" graphs (load video -> combine/save) that do not represent generation.

    Used to avoid marking such assets as having generation data.
    """
    if not isinstance(prompt_graph, dict) or not prompt_graph:
        return False
    try:
        types = []
        for node in prompt_graph.values():
            if not isinstance(node, dict):
                continue
            ct = str(node.get("class_type") or node.get("type") or "").lower()
            if ct:
                types.append(ct)
        if not types:
            return False

        # If any sampler-like node exists, it's not media-only.
        if any(("ksampler" in t and "select" not in t) or ("samplercustom" in t) for t in types):
            return False
        if any("sampler" in t and "select" not in t for t in types):
            return False

        has_load = any("loadvideo" in t or "vhs_loadvideo" in t for t in types)
        has_combine = any("videocombine" in t or "video_combine" in t or "vhs_videocombine" in t for t in types)
        has_save = any(t.startswith("save") or "savevideo" in t or "savegif" in t or "saveanimatedwebp" in t for t in types)
        return has_load and (has_combine or has_save)
    except Exception:
        return False

class MetadataService:
    """
    Metadata extraction service.

    Orchestrates extraction from multiple tools (ExifTool, FFProbe)
    and file-specific extractors.
    """

    def __init__(self, exiftool: ExifTool, ffprobe: FFProbe, settings: AppSettings):
        """
        Initialize metadata service.

        Args:
            exiftool: ExifTool adapter instance
            ffprobe: FFProbe adapter instance
            settings: Application settings service
        """
        self.exiftool = exiftool
        self.ffprobe = ffprobe
        self._settings = settings
        try:
            max_concurrency = int(METADATA_EXTRACT_CONCURRENCY or 1)
        except Exception:
            max_concurrency = 1
        if max_concurrency <= 0:
            max_concurrency = 1
        self._extract_sem = asyncio.Semaphore(max_concurrency)

    async def _enrich_with_geninfo_async(self, combined: Dict[str, Any]) -> None:
        """Helper to parse geninfo from prompt/workflow in combined metadata (Worker Thread)."""
        prompt_graph = combined.get("prompt")
        workflow = combined.get("workflow")
        loop = asyncio.get_running_loop()
        geninfo_res = None

        try:
            # Offload heavy parsing to thread pool to prevent blocking the event loop
            geninfo_res = await loop.run_in_executor(
                None,
                functools.partial(parse_geninfo_from_prompt, prompt_graph, workflow=workflow)
            )
        except Exception as exc:
            logger.debug(f"GenInfo parse skipped: {exc}")

        if geninfo_res and geninfo_res.ok and geninfo_res.data:
            combined["geninfo"] = geninfo_res.data
        elif "geninfo" not in combined:
            gi = _build_geninfo_from_parameters(combined)
            # Always set geninfo to a dict (empty if nothing parsed)
            combined["geninfo"] = gi if gi is not None else {}
            if not gi and _looks_like_media_pipeline(prompt_graph):
                combined["geninfo_status"] = {"kind": "media_pipeline", "reason": "no_sampler"}

    async def _resolve_probe_mode(self, override: Optional[str]) -> str:
        if isinstance(override, str):
            normalized = override.strip().lower()
            if normalized in ("auto", "exiftool", "ffprobe", "both"):
                return normalized
        return await self._settings.get_probe_backend()

    async def _probe_backends(self, file_path: str, override: Optional[str]) -> tuple[str, list[str]]:
        mode = await self._resolve_probe_mode(override)
        return mode, pick_probe_backend(file_path, settings_override=mode)

    async def get_metadata(
        self,
        file_path: str,
        scan_id: Optional[str] = None,
        probe_mode_override: Optional[str] = None
    ) -> Result[Dict[str, Any]]:
        """
        Extract metadata from file.

        Args:
            file_path: Path to file

        Returns:
            Result with metadata dict including:
                - file_info: Basic file information
                - exif: Raw EXIF data
                - workflow: ComfyUI workflow (if present)
                - prompt: Generation parameters
                - quality: Metadata quality (full, partial, degraded, none)
        """
        if not os.path.exists(file_path):
            return Result.Err(ErrorCode.NOT_FOUND, f"File not found: {file_path}")

        async with self._extract_sem:
            return await self._get_metadata_impl(file_path, scan_id=scan_id, probe_mode_override=probe_mode_override)

    async def _get_metadata_impl(
        self,
        file_path: str,
        scan_id: Optional[str] = None,
        probe_mode_override: Optional[str] = None
    ) -> Result[Dict[str, Any]]:
        # Get file kind
        kind = classify_file(file_path)
        if kind == "unknown":
            return Result.Err(
                ErrorCode.UNSUPPORTED,
                f"Unsupported file type: {file_path}",
                quality="none"
            )

        logger.debug(f"Extracting metadata from {kind} file: {file_path} (scan_id={scan_id})")

        try:
            # Dispatch to appropriate handler
            _, backends = await self._probe_backends(file_path, probe_mode_override)
            allow_exif = "exiftool" in backends
            allow_ffprobe = "ffprobe" in backends

            if kind == "image":
                return await self._extract_image_metadata(file_path, scan_id=scan_id, allow_exif=allow_exif)
            elif kind == "video":
                return await self._extract_video_metadata(
                    file_path,
                    scan_id=scan_id,
                    allow_exif=allow_exif,
                    allow_ffprobe=allow_ffprobe,
                )
            elif kind == "audio":
                return await self._extract_audio_metadata(
                    file_path,
                    scan_id=scan_id,
                    allow_exif=allow_exif,
                    allow_ffprobe=allow_ffprobe,
                )
            else:
                return Result.Ok({
                    "file_info": self._get_file_info(file_path),
                    "quality": "none"
                }, quality="none")

        except Exception as e:
            logger.error(f"Metadata extraction failed: {e}")
            return Result.Err(
                ErrorCode.PARSE_ERROR,
                f"Metadata extraction failed: {e}",
                quality="degraded"
            )

    async def get_workflow_only(self, file_path: str, scan_id: Optional[str] = None) -> Result[Dict[str, Any]]:
        """
        Fast path for extracting only embedded ComfyUI workflow/prompt (no ffprobe, no geninfo).

        Used for "drop on canvas" UX where we only need the workflow to load it into the graph.
        """
        if not os.path.exists(file_path):
            return Result.Err(ErrorCode.NOT_FOUND, f"File not found: {file_path}", quality="none")

        kind = classify_file(file_path)
        if kind not in ("image", "video"):
            return Result.Ok({"workflow": None, "prompt": None, "quality": "none"}, quality="none")

        ext = os.path.splitext(file_path)[1].lower()

        exif_start = time.perf_counter()
        exif_result = await asyncio.to_thread(self.exiftool.read, file_path)
        exif_duration = time.perf_counter() - exif_start
        exif_data = exif_result.data if exif_result.ok else None
        if not exif_result.ok:
            self._log_metadata_issue(
                logging.DEBUG,
                "ExifTool failed while reading workflow-only metadata",
                file_path,
                scan_id=scan_id,
                tool="exiftool",
                error=exif_result.error,
                duration_seconds=exif_duration,
            )
            return Result.Ok({"workflow": None, "prompt": None, "quality": "none"}, quality="none")

        if kind == "image":
            if ext == ".png":
                res = extract_png_metadata(file_path, exif_data)
            elif ext == ".webp":
                res = extract_webp_metadata(file_path, exif_data)
            else:
                res = Result.Ok({"workflow": None, "prompt": None, "quality": "none"}, quality="none")
        else:
            # No ffprobe here (can be slow); extractor supports workflow/prompt from ExifTool tags.
            res = extract_video_metadata(file_path, exif_data, ffprobe_data=None)

        if not res.ok:
            return res

        data = res.data or {}
        payload = {
            "workflow": data.get("workflow"),
            "prompt": data.get("prompt"),
            "quality": data.get("quality", res.meta.get("quality", "none")),
        }
        return Result.Ok(payload, quality=payload.get("quality", "none"))

    async def _extract_image_metadata(
        self,
        file_path: str,
        scan_id: Optional[str] = None,
        allow_exif: bool = True
    ) -> Result[Dict[str, Any]]:
        """Extract metadata from image file."""
        ext = os.path.splitext(file_path)[1].lower()

        if not allow_exif:
            return Result.Ok({
                "file_info": self._get_file_info(file_path),
                "exif": None,
                "quality": "none"
            }, quality="none")

        exif_start = time.perf_counter()
        exif_result = await asyncio.to_thread(self.exiftool.read, file_path)
        exif_duration = time.perf_counter() - exif_start
        exif_data = exif_result.data if exif_result.ok else None
        if not exif_result.ok:
            self._log_metadata_issue(
                logging.WARNING,
                "ExifTool failed while reading image metadata",
                file_path,
                scan_id=scan_id,
                tool="exiftool",
                error=exif_result.error,
                duration_seconds=exif_duration
            )
            return Result.Ok({
                "file_info": self._get_file_info(file_path),
                "exif": None,
                "quality": "none"
            }, quality="none")

        # Extract based on format
        if ext == ".png":
            metadata_result = extract_png_metadata(file_path, exif_data)
        elif ext == ".webp":
            metadata_result = extract_webp_metadata(file_path, exif_data)
        else:
            # Generic image
            metadata_result = Result.Ok({
                "workflow": None,
                "prompt": None,
                "quality": "partial" if exif_data else "none"
            })
            
        if not metadata_result.ok:
            self._log_metadata_issue(
                logging.WARNING,
                "Image extractor failed",
                file_path,
                scan_id=scan_id,
                tool="extractor",
                error=metadata_result.error,
                duration_seconds=exif_duration
            )
            return metadata_result

        # Combine results
        combined = {
            "file_info": self._get_file_info(file_path),
            "exif": exif_data,
            **metadata_result.data
        }

        # Optional: parse deterministic generation info from ComfyUI prompt graph (backend-first).
        # Uses worker thread to avoid blocking loop.
        await self._enrich_with_geninfo_async(combined)

        quality = metadata_result.meta.get("quality", "none")
        return Result.Ok(combined, quality=quality)

    async def _extract_video_metadata(
        self,
        file_path: str,
        scan_id: Optional[str] = None,
        allow_exif: bool = True,
        allow_ffprobe: bool = True,
    ) -> Result[Dict[str, Any]]:
        """Extract metadata from video file."""
        exif_data = {}
        exif_duration = 0.0
        if allow_exif:
            exif_start = time.perf_counter()
            exif_result = await asyncio.to_thread(self.exiftool.read, file_path)
            exif_duration = time.perf_counter() - exif_start
            exif_data = exif_result.data if exif_result.ok else None
            if not exif_result.ok:
                self._log_metadata_issue(
                    logging.WARNING,
                    "ExifTool failed while reading video metadata",
                    file_path,
                    scan_id=scan_id,
                    tool="exiftool",
                    error=exif_result.error,
                    duration_seconds=exif_duration
                )
                exif_data = None
        else:
            exif_data = {}

        ffprobe_data = {}
        ffprobe_duration = 0.0
        if allow_ffprobe:
            ffprobe_start = time.perf_counter()
            ffprobe_result = await asyncio.to_thread(self.ffprobe.read, file_path)
            ffprobe_duration = time.perf_counter() - ffprobe_start
            if not ffprobe_result.ok:
                self._log_metadata_issue(
                    logging.WARNING,
                    "FFprobe failed while reading video metadata",
                    file_path,
                    scan_id=scan_id,
                    tool="ffprobe",
                    error=ffprobe_result.error,
                    duration_seconds=ffprobe_duration
                )
                ffprobe_data = None
            else:
                ffprobe_data = ffprobe_result.data

        # Extract video-specific metadata
        metadata_result = extract_video_metadata(file_path, exif_data, ffprobe_data)

        if not metadata_result.ok:
            self._log_metadata_issue(
                logging.WARNING,
                "Video extractor failed",
                file_path,
                scan_id=scan_id,
                tool="extractor",
                error=metadata_result.error,
                duration_seconds=(exif_duration + ffprobe_duration)
            )
            return metadata_result

        # Unpack resolution tuple to width/height for DB compatibility
        data = metadata_result.data or {}
        if data.get("resolution"):
            try:
                w, h = data["resolution"]
                data["width"] = w
                data["height"] = h
            except (ValueError, TypeError):
                pass

        # Combine results
        combined = {
            "file_info": self._get_file_info(file_path),
            "exif": exif_data,
            "ffprobe": ffprobe_data,
            **metadata_result.data
        }

        try:
            await self._enrich_with_geninfo_async(combined)
        except Exception as exc:
            logger.debug(f"GenInfo parse skipped: {exc}")

        quality = metadata_result.meta.get("quality", "none")
        return Result.Ok(combined, quality=quality)

    async def _extract_audio_metadata(
        self,
        file_path: str,
        scan_id: Optional[str] = None,
        allow_exif: bool = True,
        allow_ffprobe: bool = True,
    ) -> Result[Dict[str, Any]]:
        """Extract metadata from audio file."""
        if not allow_exif and not allow_ffprobe:
            return Result.Ok(
                {
                    "file_info": self._get_file_info(file_path),
                    "exif": None,
                    "ffprobe": None,
                    "quality": "none",
                },
                quality="none",
            )

        exif_data = None
        ffprobe_data = None
        exif_duration = 0.0
        ffprobe_duration = 0.0

        if allow_exif:
            exif_start = time.perf_counter()
            exif_result = await asyncio.to_thread(self.exiftool.read, file_path)
            exif_duration = time.perf_counter() - exif_start
            exif_data = exif_result.data if exif_result.ok else None
            if not exif_result.ok:
                self._log_metadata_issue(
                    logging.WARNING,
                    "ExifTool failed while reading audio metadata",
                    file_path,
                    scan_id=scan_id,
                    tool="exiftool",
                    error=exif_result.error,
                    duration_seconds=exif_duration,
                )

        if allow_ffprobe:
            ffprobe_start = time.perf_counter()
            ffprobe_result = await asyncio.to_thread(self.ffprobe.read, file_path)
            ffprobe_duration = time.perf_counter() - ffprobe_start
            ffprobe_data = ffprobe_result.data if ffprobe_result.ok else None
            if not ffprobe_result.ok:
                self._log_metadata_issue(
                    logging.WARNING,
                    "FFprobe failed while reading audio metadata",
                    file_path,
                    scan_id=scan_id,
                    tool="ffprobe",
                    error=ffprobe_result.error,
                    duration_seconds=ffprobe_duration,
                )

        metadata_result = extract_audio_metadata(file_path, exif_data=exif_data, ffprobe_data=ffprobe_data)
        if not metadata_result.ok:
            self._log_metadata_issue(
                logging.WARNING,
                "Audio extractor failed",
                file_path,
                scan_id=scan_id,
                tool="extractor",
                error=metadata_result.error,
                duration_seconds=(exif_duration + ffprobe_duration),
            )
            return metadata_result

        combined = {
            "file_info": self._get_file_info(file_path),
            "exif": exif_data,
            "ffprobe": ffprobe_data,
            **(metadata_result.data or {}),
        }
        try:
            await self._enrich_with_geninfo_async(combined)
        except Exception:
            pass
        quality = metadata_result.meta.get("quality", "none")
        return Result.Ok(combined, quality=quality)

    async def get_metadata_batch(
        self,
        file_paths: list[str],
        scan_id: Optional[str] = None,
        probe_mode_override: Optional[str] = None,
    ) -> Dict[str, Result[Dict[str, Any]]]:
        """
        Extract metadata from multiple files in batch (much faster than individual calls).

        This uses batch ExifTool/FFProbe execution and native Python extractors (PNG)
        to dramatically reduce subprocess overhead.

        Args:
            file_paths: List of file paths to process
            scan_id: Optional scan ID for logging

        Returns:
            Dict mapping file path to Result with metadata
        """
        if not file_paths:
            return {}

        async with self._extract_sem:
            return await self._get_metadata_batch_impl(
                file_paths,
                scan_id=scan_id,
                probe_mode_override=probe_mode_override,
            )

    async def _get_metadata_batch_impl(
        self,
        file_paths: list[str],
        scan_id: Optional[str] = None,
        probe_mode_override: Optional[str] = None,
    ) -> Dict[str, Result[Dict[str, Any]]]:
        if not file_paths:
            return {}

        from ...shared import classify_file

        def _group_existing_paths(paths: list[str]):
            images: list[str] = []
            videos: list[str] = []
            audios: list[str] = []
            others: list[str] = []
            for path in paths:
                if not os.path.exists(path):
                    continue
                kind = classify_file(path)
                if kind == "image":
                    images.append(path)
                elif kind == "video":
                    videos.append(path)
                elif kind == "audio":
                    audios.append(path)
                else:
                    others.append(path)
            return images, videos, audios, others

        images, videos, audios, others = _group_existing_paths(file_paths)

        results: Dict[str, Result[Dict[str, Any]]] = {}
        probe_mode = await self._resolve_probe_mode(probe_mode_override)

        # Schedule tool targets (dedupe to avoid duplicate subprocess work).
        exif_targets: list[str] = []
        ffprobe_targets: list[str] = []
        seen_exif: set[str] = set()
        seen_ffprobe: set[str] = set()

        for path in [*images, *videos, *audios]:
            backends = pick_probe_backend(path, settings_override=probe_mode)
            if "exiftool" in backends and path not in seen_exif:
                seen_exif.add(path)
                exif_targets.append(path)
            if "ffprobe" in backends and path not in seen_ffprobe:
                seen_ffprobe.add(path)
                ffprobe_targets.append(path)

        exif_results: Dict[str, Result[Dict[str, Any]]] = self.exiftool.read_batch(exif_targets) if exif_targets else {}
        ffprobe_results: Dict[str, Result[Dict[str, Any]]] = self.ffprobe.read_batch(ffprobe_targets) if ffprobe_targets else {}

        def _exif_for(path: str) -> Optional[Dict[str, Any]]:
            ex_res = exif_results.get(path)
            return ex_res.data if ex_res and ex_res.ok else None

        def _ffprobe_for(path: str) -> Optional[Dict[str, Any]]:
            ff_res = ffprobe_results.get(path)
            return ff_res.data if ff_res and ff_res.ok else None

        async def _finalize_ok(path: str, combined: Dict[str, Any], metadata_result: Result[Dict[str, Any]]):
            await self._enrich_with_geninfo_async(combined)
            quality = metadata_result.meta.get("quality", "none")
            results[path] = Result.Ok(combined, quality=quality)

        # Images
        for path in images:
            if path in results:
                continue
            ext = os.path.splitext(path)[1].lower()
            exif_data = _exif_for(path)

            if ext == ".png":
                metadata_result = extract_png_metadata(path, exif_data)
            elif ext == ".webp":
                metadata_result = extract_webp_metadata(path, exif_data)
            else:
                metadata_result = Result.Ok({
                    "workflow": None,
                    "prompt": None,
                    "quality": "partial" if exif_data else "none",
                })

            if metadata_result.ok:
                combined = {
                    "file_info": self._get_file_info(path),
                    "exif": exif_data,
                    **metadata_result.data,
                }
                await _finalize_ok(path, combined, metadata_result)
            else:
                results[path] = metadata_result

        # Videos
        for path in videos:
            if path in results:
                continue
            exif_data = _exif_for(path)
            ffprobe_data = _ffprobe_for(path)

            metadata_result = extract_video_metadata(path, exif_data, ffprobe_data)
            if metadata_result.ok:
                combined = {
                    "file_info": self._get_file_info(path),
                    "exif": exif_data,
                    "ffprobe": ffprobe_data,
                    **metadata_result.data,
                }
                await _finalize_ok(path, combined, metadata_result)
            else:
                results[path] = metadata_result

        # Audio
        for path in audios:
            if path in results:
                continue
            exif_data = _exif_for(path)
            ffprobe_data = _ffprobe_for(path)
            metadata_result = extract_audio_metadata(path, exif_data=exif_data, ffprobe_data=ffprobe_data)
            if metadata_result.ok:
                combined = {
                    "file_info": self._get_file_info(path),
                    "exif": exif_data,
                    "ffprobe": ffprobe_data,
                    **(metadata_result.data or {}),
                }
                await _finalize_ok(path, combined, metadata_result)
            else:
                results[path] = metadata_result

        # Other
        for path in others:
            if path in results:
                continue
            results[path] = Result.Ok({"file_info": self._get_file_info(path), "quality": "none"}, quality="none")

        return results

    def extract_rating_tags_only(self, file_path: str, scan_id: Optional[str] = None) -> Result[Dict[str, Any]]:
        """
        Lightweight extraction for rating/tags only (no workflow/geninfo parsing).

        Used to "hydrate" missing rating/tags from existing OS/file metadata without running a full scan.
        """
        if not os.path.exists(file_path):
            return Result.Err(ErrorCode.NOT_FOUND, f"File not found: {file_path}", quality="none")

        exif_start = time.perf_counter()
        # Read a narrow tag set for performance; extractor normalizes grouped keys.
        tags = [
            # Ratings (XMP + Windows)
            "XMP-xmp:Rating",
            "XMP-microsoft:RatingPercent",
            "Microsoft:SharedUserRating",
            "Rating",
            "RatingPercent",
            # Tags/keywords
            "XMP-dc:Subject",
            "XMP:Subject",
            "IPTC:Keywords",
            "Keywords",
            "XPKeywords",
            "Microsoft:Category",
            "Subject",
        ]
        exif_result = self.exiftool.read(file_path, tags=tags)
        exif_duration = time.perf_counter() - exif_start
        exif_data = exif_result.data if exif_result.ok else None

        if not exif_result.ok:
            self._log_metadata_issue(
                logging.DEBUG,
                "ExifTool failed while reading rating/tags",
                file_path,
                scan_id=scan_id,
                tool="exiftool",
                error=exif_result.error,
                duration_seconds=exif_duration,
            )
            return Result.Ok({"rating": None, "tags": []}, quality="none")

        rating, tags_list = extract_rating_tags_from_exif(exif_data)
        return Result.Ok({"rating": rating, "tags": tags_list}, quality="partial")

    def _log_metadata_issue(
        self,
        level: int,
        message: str,
        file_path: str,
        scan_id: Optional[str] = None,
        tool: Optional[str] = None,
        error: Optional[str] = None,
        duration_seconds: Optional[float] = None
    ):
        context = {"file_path": file_path}
        if scan_id:
            context["scan_id"] = scan_id
        if tool:
            context["tool"] = tool
        if error:
            context["error"] = error
        if duration_seconds is not None:
            try:
                context["duration_seconds"] = round(float(duration_seconds), 3)
            except Exception:
                context["duration_seconds"] = duration_seconds
        log_structured(logger, level, message, **context)

    def _get_file_info(self, file_path: str) -> Dict[str, Any]:
        """Get basic file information."""
        stat = os.stat(file_path)
        info = {
            "filename": os.path.basename(file_path),
            "filepath": file_path,
            "size": stat.st_size,
            "mtime": stat.st_mtime,
            "ctime": stat.st_ctime,
            "kind": classify_file(file_path),
            "ext": os.path.splitext(file_path)[1].lower()
        }
        # Try to get birthtime (Unix/Mac)
        if hasattr(stat, "st_birthtime"):
            info["birthtime"] = stat.st_birthtime
        return info
