"""
Native metadata extractors using Python libraries (Pillow) instead of external tools (ExifTool).
Much faster for reading ComfyUI metadata (Step 1).
"""
import asyncio
import json
import logging
from typing import Optional, Dict, Any, List
from pathlib import Path

from ...shared import Result, ErrorCode
from .parsing_utils import (
    parse_json_value,
    looks_like_comfyui_workflow,
    looks_like_comfyui_prompt_graph,
    try_parse_json_text,
    parse_auto1111_params
)

try:
    from PIL import Image, ExifTags
    from PIL.PngImagePlugin import PngImageFile
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

logger = logging.getLogger(__name__)

def _extract_fallback_from_workflow_nodes(nodes: list) -> Dict[str, Any]:
    """
    Fallback heuristic to extract geninfo (seed, prompts) directly from workflow UI graph
    when the execution 'prompt' graph is missing.
    """
    geninfo: Dict[str, Any] = {}
    if not nodes:
        return geninfo

    nodes_by_id = {n['id']: n for n in nodes}
    link_map = {} # link_id -> node_id (source)
    
    for n in nodes:
        for out in n.get('outputs', []):
            if out.get('links'):
                 for link_id in out['links']:
                     link_map[str(link_id)] = n['id']

    def get_source_node(link_id):
        nid = link_map.get(str(link_id))
        return nodes_by_id.get(nid)

    positives = set()
    negatives = set()
    found_seed = None

    def trace_text(node, depth=0):
        if not node: return None
        if depth > 5: return None
        
        ntype = node.get('type', '')
        # Text Node
        if ('TextEncode' in ntype or 'Prompt' in ntype or 'PrimitiveString' in ntype) and 'Note' not in ntype:
            vals = node.get('widgets_values')
            if vals and isinstance(vals[0], str) and len(vals[0].strip()) > 0:
                return vals[0]
        
        # Recurse upstream
        inputs = node.get('inputs', [])
        for inp in inputs:
            name = inp.get('name', '').lower()
            if name in ('positive', 'negative', 'conditioning', 'guider', 'text', 'string'):
                link = inp.get('link')
                if link:
                    src = get_source_node(link)
                    res = trace_text(src, depth+1)
                    if res: return res
        return None

    # 1. Identify Samplers to find Pos/Neg roots
    samplers = [n for n in nodes if "Sampler" in n.get('type', '')]
    for s in samplers:
        for inp in s.get("inputs", []):
            name = inp.get("name", "").lower()
            link = inp.get("link")
            if not link: continue
            
            if name == "positive":
                txt = trace_text(get_source_node(link))
                if txt: positives.add(txt)
            elif name == "negative":
                txt = trace_text(get_source_node(link))
                if txt: negatives.add(txt)
            elif name == "guider":
                 # Flux/Guider inputs
                 gnode = get_source_node(link)
                 if gnode:
                     for ginp in gnode.get("inputs", []):
                         gname = ginp.get("name", "").lower()
                         glink = ginp.get("link")
                         if gname == "positive":
                             txt = trace_text(get_source_node(glink))
                             if txt: positives.add(txt)
                         elif gname == "negative":
                             txt = trace_text(get_source_node(glink))
                             if txt: negatives.add(txt)

    # 2. General scan for seeds (and prompts if graph tracing failed)
    found_prompts_fallback = set()
    for n in nodes:
        ntype = n.get('type', '')
        vals = n.get('widgets_values', [])
        
        # Seeds
        if 'Seed' in ntype or 'Noise' in ntype or 'Sampler' in ntype:
             for v in vals:
                 if isinstance(v, (int, float)):
                     iv = int(v)
                     if iv > 1000000 and found_seed is None:
                         found_seed = iv
        
        # Fallback prompts if structured trace found nothing
        if not positives and not negatives:
            if ('TextEncode' in ntype or 'Prompt' in ntype) and 'Note' not in ntype:
                for v in vals:
                     if isinstance(v, str) and len(v.strip()) > 0:
                         found_prompts_fallback.add(v)

    if positives:
        geninfo["positive"] = list(positives)
    if negatives:
        geninfo["negative"] = list(negatives)
    
    if not positives and found_prompts_fallback:
         geninfo["positive"] = list(found_prompts_fallback)
         
    if found_seed:
        geninfo["seed"] = found_seed
        
    return geninfo

def _scan_text_values_for_metadata(values: List[str]) -> Dict[str, Any]:
    """
    Scans a list of text values (from EXIF, PNG chunks, etc) for
    ComfyUI workflow/prompt and A1111 parameters.
    """
    found: Dict[str, Any] = {}
    workflow = None
    prompt = None

    for val in values:
        if not val or not isinstance(val, str):
            continue

        # 1. Try to parse as JSON (handles prefixes)
        parsed = parse_json_value(val)

        # 2. Check wrappers { "workflow": ..., "prompt": ... }
        if isinstance(parsed, dict):
            wf_wrap = parsed.get("workflow") or parsed.get("Workflow")
            pr_wrap = parsed.get("prompt") or parsed.get("Prompt")

            if wf_wrap and isinstance(wf_wrap, dict):
                if looks_like_comfyui_workflow(wf_wrap):
                    if not workflow: workflow = wf_wrap

            if pr_wrap:
                if isinstance(pr_wrap, dict) and looks_like_comfyui_prompt_graph(pr_wrap):
                    if not prompt: prompt = pr_wrap
                elif isinstance(pr_wrap, str):
                    pr_parsed = try_parse_json_text(pr_wrap)
                    if pr_parsed and looks_like_comfyui_prompt_graph(pr_parsed):
                        if not prompt: prompt = pr_parsed

            # 3. Direct Match (the value itself is the workflow/prompt)
            if looks_like_comfyui_workflow(parsed):
                if not workflow: workflow = parsed
            elif looks_like_comfyui_prompt_graph(parsed):
                if not prompt: prompt = parsed
        
        # 4. A1111 Fallback / Parameters
        if "parameters" not in found:
            params = parse_auto1111_params(val)
            if params:
                found["parameters"] = val
                found.update(params)

    if workflow:
        found["workflow"] = workflow
    if prompt:
        found["prompt"] = prompt

    return found

def _extract_image_metadata_native_sync(path: str) -> Optional[Dict[str, Any]]:
    """
    Sync worker for extracting image metadata using Pillow.
    """
    if not HAS_PIL:
        return None
        
    try:
        with Image.open(path) as img:
            info = img.info or {}
            
            # Dimensions (always available in PIL for valid images)
            width, height = img.size
            result = {
                "width": width,
                "height": height
            }
            
            # --- Format-Generic Text Scan ---
            candidate_texts = []

            # PNG: Gather all text chunks
            if img.format == "PNG":
                for k, v in info.items():
                    if isinstance(v, str):
                        candidate_texts.append(v)
                    elif isinstance(v, bytes):
                        try:
                            candidate_texts.append(v.decode('utf-8', errors='ignore'))
                        except Exception:
                            pass
            
            # WEBP: Gather EXIF / XMP / Info
            elif img.format == "WEBP":
                # Info dictionary (sometimes has keys)
                for k, v in info.items():
                     if isinstance(v, str):
                        candidate_texts.append(v)
                     elif isinstance(v, bytes):
                        try:
                            candidate_texts.append(v.decode('utf-8', errors='ignore'))
                        except Exception:
                            pass
                
                # EXIF Tags
                try:
                    exif = img.getexif()
                    if exif:
                        # 270: ImageDescription, 271: Make, 272: Model, 305: Software, 37510: UserComment
                        candidate_tags = [270, 271, 272, 305, 37510, 0x9286]
                        for tag_id in candidate_tags:
                            val = exif.get(tag_id)
                            if val:
                                if isinstance(val, bytes):
                                    try:
                                        val = val.decode('utf-8', errors='ignore').strip('\x00')
                                    except Exception:
                                        continue
                                if isinstance(val, str) and len(val) > 2:
                                    candidate_texts.append(val)
                except Exception:
                    pass
            
            # --- Perform Scan ---
            if candidate_texts:
                scan_result = _scan_text_values_for_metadata(candidate_texts)
                result.update(scan_result)

            # --- Fallback: GenInfo from Workflow ---
            # We want to run this if we don't have a PROMPT GRAPH (dict). 
            # If "prompt" is just a string (A1111 text), we still might get better info from the workflow.
            has_prompt_graph = isinstance(result.get("prompt"), dict)
            
            if not has_prompt_graph and "workflow" in result:
                try:
                     nodes = result["workflow"].get("nodes")
                     if nodes:
                         fallback_geninfo = _extract_fallback_from_workflow_nodes(nodes)
                         if fallback_geninfo:
                             result["geninfo"] = fallback_geninfo
                except Exception as e:
                    logger.debug(f"Workflow fallback extraction failed for {path}: {e}")
            
            return result
                
    except Exception as e:
        logger.debug(f"Native extraction failed for {path}: {e}")
        
    return None

async def extract_image_metadata_native(path: str) -> Optional[Dict[str, Any]]:
    """
    Fast async extraction of image metadata (dimensions + ComfyUI/A1111 tags) using Pillow.
    Offloads blocking IO to a thread.
    Returns dict if found, None if failed.
    """
    return await asyncio.to_thread(_extract_image_metadata_native_sync, path)

# Legacy alias
extract_png_metadata_native = extract_image_metadata_native
