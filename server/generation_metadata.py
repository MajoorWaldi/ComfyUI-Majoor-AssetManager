from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

try:
    from PIL import Image  # type: ignore
except Exception:  # Pillow non dispo -> pas de parsing PNG
    Image = None
try:
    from .utils import load_metadata  # type: ignore
except Exception:
    load_metadata = None  # sidecar fallback option


# Samplers treated as source of truth (lowercase)
SAMPLER_CLASSES: Set[str] = {
    "ksampler",
    "samplercustom",
    "ksampleradvanced",
    "samplercustomadvanced",
    "samplercustomeadvanced",  # variant typo seen in some nodes
    "flux2scheduler",
    "randomnoise",
    "basicguider",
    # WAN / Kijai wrappers
    "wanvideosampler",
    "wanvideoksampler",
    "wanvideoksampler",
    "wanmoeksampler",
    "wanmoeksampler",  # alias/variant
    "painteri2v",
}

# Model loaders (diffusion / checkpoint)
CHECKPOINT_LOADER_CLASSES: Set[str] = {
    "CheckpointLoaderSimple",
    "CheckpointLoader",
}
UNET_LOADER_CLASSES: Set[str] = {
    "UNETLoader",
    "LoadDiffusionModel",  # certains wrappers utilisent ce label
}
DIFFUSERS_LOADER_CLASSES: Set[str] = {
    "DiffusersLoader",
}

# LoRA
LORA_CLASSES: Set[str] = {
    "LoraLoader",
    "LoraLoaderModelOnly",
}

def _clean_model_name(raw: str) -> str:
    """
    Strip directories and extensions from model names to keep titles clean.
    Example: 'WAN2.2\\foo\\bar.safetensors' -> 'bar'
    """
    try:
        name = raw.replace("\\", "/").split("/")[-1]
        if name.lower().endswith(".safetensors"):
            name = name[: -len(".safetensors")]
        return name
    except Exception:
        return raw


# --------- General helpers ---------


def _ensure_dict_from_json(value: Any) -> Optional[Dict[str, Any]]:
    """
    Accepte soit un dict, soit une string JSON.
    Retourne un dict ou None.
    """
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            data = json.loads(value)
            if isinstance(data, dict):
                return data
        except Exception:
            return None
    return None


def _extract_link_node_id(val: Any) -> Optional[str]:
    """
    Extract a node id from inputs shaped like:
    - ["node_id", output_idx]
    - [[ "node_id", output_idx ], ...]
    - str/int directly (graph stored only the id)
    """
    if isinstance(val, (str, int)):
        return str(val)
    if isinstance(val, tuple) and val and isinstance(val[0], (str, int)):
        return str(val[0])
    # cas ["5", 0]
    if isinstance(val, list) and len(val) >= 2 and isinstance(val[0], (str, int)):
        return str(val[0])

    # cas [[ "5", 0 ], ...]
    if (
        isinstance(val, list)
        and val
        and isinstance(val[0], list)
        and len(val[0]) >= 2
        and isinstance(val[0][0], (str, int))
    ):
        return str(val[0][0])

    return None


# --------- Lecture du graph PROMPT depuis le PNG ---------


def _normalize_workflow_to_prompt_graph(workflow: Any) -> Optional[Dict[str, Any]]:
    """
    Convert a workflow (dict with 'nodes': [...]) into an id->node map for parsing.
    """
    if isinstance(workflow, dict) and isinstance(workflow.get("nodes"), list):
        nodes_map: Dict[str, Any] = {}
        for n in workflow.get("nodes", []):
            if not isinstance(n, dict):
                continue
            nid = n.get("id")
            if nid is None:
                continue
            ctype = n.get("class_type") or n.get("type") or n.get("title")
            nodes_map[str(nid)] = {
                "class_type": ctype,
                "inputs": n.get("inputs", {}) or {},
                "title": n.get("title"),
                "widgets_values": n.get("widgets_values"),
            }
        return nodes_map if nodes_map else None
    if isinstance(workflow, dict):
        # May already be id -> node map
        return {str(k): v for k, v in workflow.items() if isinstance(v, dict)}
    return None


def _prompt_graph_to_workflow(prompt_graph: Dict[str, Any]) -> Dict[str, Any]:
    """
    Rebuild a minimal workflow (nodes: [...]) from the prompt_graph map id->node.
    - Adds numeric version expected by ComfyUI.
    - Normalizes ids to int when possible to avoid "expected number" errors.
    - Always provides last_node_id / last_link_id / links for the loader.
    """
    nodes: List[Dict[str, Any]] = []
    links: List[List[Any]] = []
    max_id: int = -1
    last_link_id: int = 0

    for nid, node in prompt_graph.items():
        if not isinstance(node, dict):
            continue

        # Normalise l'id
        try:
            nid_int: Any = int(nid)
        except Exception:
            nid_int = nid
        if isinstance(nid_int, int):
            max_id = max(max_id, nid_int)

        inputs_dict = node.get("inputs", {}) if isinstance(node.get("inputs"), dict) else {}
        inputs_arr: List[Dict[str, Any]] = []

        for idx, (iname, ival) in enumerate(inputs_dict.items()):
            inp_entry: Dict[str, Any] = {
                "name": iname,
                "type": "ANY",
            }
            # If the input looks like a link ["node_id", slot]
            if isinstance(ival, (list, tuple)) and len(ival) >= 2 and isinstance(ival[0], (str, int)):
                try:
                    src_id = int(ival[0])
                except Exception:
                    src_id = ival[0] if ival[0] is not None else 0
                try:
                    src_slot = int(ival[1])
                except Exception:
                    src_slot = 0
                last_link_id += 1
                link_id = last_link_id
                # lien: [id, fromNode, fromSlot, toNode, toSlot, type]
                dest_id = nid_int if isinstance(nid_int, int) else (nid if nid is not None else 0)
                links.append([link_id, src_id, src_slot, dest_id, idx, "ANY"])
                inp_entry["link"] = link_id
            else:
                inp_entry["value"] = ival
            inputs_arr.append(inp_entry)

        entry: Dict[str, Any] = {
            "id": nid_int,
            "class_type": node.get("class_type"),
            "type": node.get("class_type") or node.get("title") or "Unknown",
            "inputs": inputs_arr,
            "outputs": [],
        }
        if node.get("title"):
            entry["title"] = node.get("title")
        if node.get("widgets_values") is not None:
            entry["widgets_values"] = node.get("widgets_values")

        nodes.append(entry)

    workflow = {
        "last_node_id": max_id if max_id >= 0 else 0,
        "last_link_id": last_link_id,
        "links": links,
        "nodes": nodes,
        "version": 1,
    }
    return workflow


def _normalize_workflow_dict(wf: Dict[str, Any]) -> Dict[str, Any]:
    """
    Normalize a raw workflow to avoid ComfyUI loader errors.
    - force numeric version
    - add last_node_id / last_link_id / links if missing
    - convert node ids to int when possible
    """
    out = dict(wf) if isinstance(wf, dict) else {}

    # version
    try:
        out["version"] = int(out.get("version", 1))
    except Exception:
        out["version"] = 1

    # last_node_id / last_link_id
    try:
        out["last_node_id"] = int(out.get("last_node_id", 0))
    except Exception:
        out["last_node_id"] = 0
    try:
        out["last_link_id"] = int(out.get("last_link_id", 0))
    except Exception:
        out["last_link_id"] = 0

    # links: filtre et assainit
    clean_links: List[List[Any]] = []
    links_val = out.get("links")
    if isinstance(links_val, list):
        for link in links_val:
            if not isinstance(link, (list, tuple)):
                continue
            # pad to length 6
            link_list = list(link) + [None] * (6 - len(link))
            idv, from_node, from_slot, to_node, to_slot, ltype = link_list[:6]
            try:
                idv = int(idv)
            except Exception:
                continue
            try:
                from_node = int(from_node)
            except Exception:
                if from_node is None:
                    from_node = 0
            try:
                from_slot = int(from_slot)
            except Exception:
                from_slot = 0
            try:
                to_node = int(to_node)
            except Exception:
                if to_node is None:
                    to_node = 0
            try:
                to_slot = int(to_slot)
            except Exception:
                to_slot = 0
            ltype = ltype or "ANY"
            clean_links.append([idv, from_node, from_slot, to_node, to_slot, ltype])
    out["links"] = clean_links
    if clean_links:
        try:
            max_link = max(int(l[0]) for l in clean_links)
            out["last_link_id"] = max(out["last_link_id"], max_link)
        except Exception:
            pass

    # nodes
    nodes = out.get("nodes")
    if not isinstance(nodes, list):
        out["nodes"] = []
        return out

    norm_nodes: List[Dict[str, Any]] = []
    max_id = out["last_node_id"]
    for node in nodes:
        if not isinstance(node, dict):
            continue
        n = dict(node)
        nid = n.get("id")
        try:
            nid_int = int(nid)
            n["id"] = nid_int
            max_id = max(max_id, nid_int)
        except Exception:
            pass  # keep as-is
        # inputs: normalise en tableau attendu par le front
        inputs = n.get("inputs")
        if isinstance(inputs, dict):
            inputs_arr = []
            for iname, ival in inputs.items():
                inputs_arr.append({"name": iname, "type": "ANY", "value": ival})
            n["inputs"] = inputs_arr
        elif isinstance(inputs, list):
            n["inputs"] = inputs
        else:
            n["inputs"] = []
        # outputs: assure une liste
        if not isinstance(n.get("outputs"), list):
            n["outputs"] = [] if n.get("outputs") is None else n.get("outputs")
        norm_nodes.append(n)
    out["nodes"] = norm_nodes
    out["last_node_id"] = max_id
    return out


def load_prompt_graph_from_png(path: str | Path) -> Optional[Dict[str, Any]]:
    """
    Load the 'prompt' graph stored in ComfyUI PNG metadata.
    - Assumes ComfyUI wrote a 'prompt' field (backend graph format).
    - No fallback: if 'prompt' is missing, return None.
    """
    if Image is None:
        return None

    p = Path(path)
    if not p.exists():
        return None

    img = Image.open(p)
    info = getattr(img, "info", {}) or {}

    # 1) prompt au top-level
    prompt = _ensure_dict_from_json(info.get("prompt"))
    if prompt is not None:
        # some dumps contain a list of nodes rather than a map
        if isinstance(prompt, list):
            prompt = _normalize_workflow_to_prompt_graph({"nodes": prompt})
        return prompt

    # 1bis) workflow au top-level
    wf_raw = _ensure_dict_from_json(info.get("workflow"))
    if wf_raw is not None:
        pg = _normalize_workflow_to_prompt_graph(wf_raw)
        if pg:
            return pg

    # 2) prompt dans extra_pnginfo (cas courant)
    extra = info.get("extra_pnginfo")
    if isinstance(extra, str):
        try:
            extra = json.loads(extra)
        except Exception:
            extra = None

    if isinstance(extra, dict):
        prompt = _ensure_dict_from_json(extra.get("prompt"))
        if prompt is not None:
            if isinstance(prompt, list):
                prompt = _normalize_workflow_to_prompt_graph({"nodes": prompt})
            return prompt
        wf_raw = _ensure_dict_from_json(extra.get("workflow"))
        if wf_raw is not None:
            pg = _normalize_workflow_to_prompt_graph(wf_raw)
            if pg:
                return pg
    if isinstance(extra, list):
        for item in extra:
            if not isinstance(item, dict):
                continue
            prompt = _ensure_dict_from_json(item.get("prompt"))
            if prompt is not None:
                return prompt
            wf_raw = _ensure_dict_from_json(item.get("workflow"))
            if wf_raw is not None:
                pg = _normalize_workflow_to_prompt_graph(wf_raw)
                if pg:
                    return pg

    # No usable prompt found -> stop here
    return None


def load_raw_workflow_from_png(path: str | Path) -> Optional[Dict[str, Any]]:
    """
    Retrieve the raw workflow (as exported by ComfyUI) if present in PNG metadata.
    No normalization: return as-is so the frontend can load it.
    """
    if Image is None:
        return None

    p = Path(path)
    if not p.exists():
        return None

    img = Image.open(p)
    info = getattr(img, "info", {}) or {}

    def _maybe_workflow(val: Any) -> Optional[Dict[str, Any]]:
        wf = _ensure_dict_from_json(val)
        if isinstance(wf, dict) and wf.get("nodes"):
            return wf
        return None

    # Top-level
    wf = _maybe_workflow(info.get("workflow"))
    if wf:
        return wf

    extra = info.get("extra_pnginfo")
    if isinstance(extra, str):
        try:
            extra = json.loads(extra)
        except Exception:
            extra = None

    if isinstance(extra, dict):
        wf = _maybe_workflow(extra.get("workflow"))
        if wf:
            return wf
    if isinstance(extra, list):
        for item in extra:
            if not isinstance(item, dict):
                continue
            wf = _maybe_workflow(item.get("workflow"))
            if wf:
                return wf
    return None


# --------- Extraction sampler-centric ---------


def _list_sampler_nodes(prompt_graph: Dict[str, Any]) -> Tuple[List[int], List[int]]:
    """
    Returns (wired_samplers, all_samplers) as int ids, sorted descending.
    Wired means the sampler has a positive or negative link.
    """
    sampler_ids: List[int] = []
    wired_ids: List[int] = []

    for node_id, node in prompt_graph.items():
        node_type = (node.get("class_type") or "").lower()
        if node_type in SAMPLER_CLASSES or "sampler" in node_type:
            try:
                nid = int(node_id)
            except Exception:
                continue
            sampler_ids.append(nid)
            inputs = node.get("inputs", {}) or {}
            pos = _extract_link_node_id(inputs.get("positive"))
            neg = _extract_link_node_id(inputs.get("negative"))
            if pos or neg:
                wired_ids.append(nid)

    wired_ids.sort(reverse=True)
    sampler_ids.sort(reverse=True)
    return wired_ids, sampler_ids


def _extract_clip_text(prompt_graph: Dict[str, Any], node_id: Optional[str]) -> Optional[str]:
    """
    Extract text from a text-encoder-like node (CLIP / SDXL / Flux, etc.).
    Keep it generic: look at common fields and widgets ('text', 'text_g', 'text_l', 'string', 'value', etc.).
    """
    if node_id is None:
        return None

    node = prompt_graph.get(str(node_id))
    if not node:
        return None

    inputs: Dict[str, Any] = node.get("inputs", {}) or {}

    texts: List[str] = []
    for key in ("text", "text_g", "text_l", "string", "value", "prompt", "content"):
        v = inputs.get(key)
        if isinstance(v, str) and v.strip():
            texts.append(v.strip())

    # Some text nodes store content in widgets_values
    widgets = node.get("widgets_values")
    if isinstance(widgets, list):
        for w in widgets:
            if isinstance(w, str) and w.strip():
                texts.append(w.strip())

    if not texts:
        return None

    # simple join; keep separator consistent
    return " | ".join(texts)


def _collect_all_texts(prompt_graph: Dict[str, Any]) -> Dict[str, List[str]]:
    """
    Collect all text present in potential nodes (encoders, various prompts).
    Try to separate positive/negative based on class_type/title.
    """
    pos_list: List[str] = []
    neg_list: List[str] = []

    for node_id, node in prompt_graph.items():
        if not isinstance(node, dict):
            continue
        ctype = str(node.get("class_type") or "").lower()
        title = str(node.get("title") or "").lower()
        inputs = node.get("inputs") or {}
        if not isinstance(inputs, dict):
            continue

        text_keywords = [
            "cliptextencode",
            "clip_text_encode",
            "textencode",
            "prompt",
            "t5textencode",
            "llama",
            "qwen",
            "gpt",
            "textencoder",
            "customtext",
            "text_node",
            "text",  # generic text node name
        ]
        is_text_node = any(kw in ctype for kw in text_keywords)
        if not is_text_node:
            continue

        texts = []
        for key in ("text", "text_g", "text_l", "prompt", "positive", "negative"):
            v = inputs.get(key)
            if isinstance(v, str) and v.strip():
                texts.append(v.strip())

        if not texts:
            continue

        is_neg = "negative" in title or "neg" in title or "negative" in ctype
        if is_neg:
            neg_list.extend(texts)
        else:
            pos_list.extend(texts)

    def _dedup(seq: List[str]) -> List[str]:
        out: List[str] = []
        seen = set()
        for x in seq:
            if x in seen:
                continue
            seen.add(x)
            out.append(x)
        return out

    return {"positive": _dedup(pos_list), "negative": _dedup(neg_list)}


def _walk_model_chain(
    prompt_graph: Dict[str, Any],
    start_id: Optional[str],
) -> Tuple[Optional[str], Optional[str], List[Dict[str, Any]]]:
    """
    Walk the 'model' chain from the sampler to collect:
    - model_name  : ckpt / diffusion model / unet
    - vae_name    : if present (CheckpointLoaderSimple)
    - loras       : list [{name, strength_model, strength_clip}, ...]

    Only follows the 'model' branch.
    """
    model_name: Optional[str] = None
    vae_name: Optional[str] = None
    loras: List[Dict[str, Any]] = []
    visited: Set[str] = set()

    current_id = str(start_id) if start_id is not None else None

    while current_id and current_id not in visited:
        visited.add(current_id)
        node = prompt_graph.get(current_id)
        if not node:
            break

        node_type = node.get("class_type")
        inputs: Dict[str, Any] = node.get("inputs", {}) or {}

        # --- Checkpoints ---
        if node_type in CHECKPOINT_LOADER_CLASSES:
            ckpt = inputs.get("ckpt_name") or inputs.get("ckpt_file")
            if isinstance(ckpt, str):
                model_name = _clean_model_name(ckpt)
            vae = inputs.get("vae_name")
            if isinstance(vae, str):
                vae_name = vae
            break

        # --- UNET / Diffusion model loaders ---
        if node_type in UNET_LOADER_CLASSES:
            unet = inputs.get("unet_name") or inputs.get("model_name")
            if isinstance(unet, str):
                model_name = _clean_model_name(unet)
            break

        if node_type in DIFFUSERS_LOADER_CLASSES:
            m = inputs.get("model_path") or inputs.get("model_name")
            if isinstance(m, str):
                model_name = _clean_model_name(m)
            break

        # --- LoRA chain ---
        if node_type in LORA_CLASSES:
            lora_name = inputs.get("lora_name")
            if isinstance(lora_name, str):
                l_entry = {
                    "name": _clean_model_name(lora_name),
                    "strength_model": inputs.get("strength_model"),
                    "strength_clip": inputs.get("strength_clip"),
                }
                loras.append(l_entry)

            next_id = _extract_link_node_id(inputs.get("model"))
            if next_id is None:
                break
            current_id = next_id
            continue

        # --- Other links in the 'model' chain ---
        next_id = _extract_link_node_id(inputs.get("model"))
        if next_id is None:
            break
        current_id = next_id

    return model_name, vae_name, loras


def extract_generation_params_from_prompt_graph(
    prompt_graph: Dict[str, Any],
    raw_workflow: Optional[Dict[str, Any]] = None,
    *,
    reconstruct_allowed: bool = False,
) -> Dict[str, Any]:
    """
    Core extraction of generation parameters from a prompt graph (map id -> node).
    - `raw_workflow` can be supplied to return as-is.
    - if `reconstruct_allowed` is True and no workflow is provided, rebuild a minimal workflow.
    """
    if not prompt_graph:
        return {}

    wired_samplers, all_samplers = _list_sampler_nodes(prompt_graph)
    sampler_id = str(wired_samplers[0]) if wired_samplers else (str(all_samplers[0]) if all_samplers else None)

    if sampler_id is None:
        collected = _collect_all_texts(prompt_graph)
        wf_fallback = None
        if isinstance(raw_workflow, dict):
            wf_fallback = raw_workflow
        elif reconstruct_allowed:
            wf_fallback = _prompt_graph_to_workflow(prompt_graph)
        return {
            "positive_prompt": " | ".join(collected.get("positive") or []),
            "negative_prompt": " | ".join(collected.get("negative") or []),
            "seed": None,
            "steps": None,
            "cfg": None,
            "sampler_name": None,
            "scheduler": None,
            "model": None,
            "vae": None,
            "loras": [],
            "workflow": wf_fallback,
        }

    sampler = prompt_graph.get(sampler_id, {})
    inputs: Dict[str, Any] = sampler.get("inputs", {}) or {}

    # seed / cfg / steps / sampler / scheduler
    seed = inputs.get("seed") or inputs.get("noise_seed")
    cfg = (
        inputs.get("cfg")
        or inputs.get("cfg_scale")
        or inputs.get("guidance")
        or inputs.get("guidance_scale")
    )
    steps = inputs.get("steps")
    sampler_name = inputs.get("sampler_name") or inputs.get("sampler")
    scheduler = inputs.get("scheduler")

    # Prompts
    pos_input = inputs.get("positive")
    neg_input = inputs.get("negative")
    pos_id = _extract_link_node_id(pos_input)
    neg_id = _extract_link_node_id(neg_input)
    if pos_id is None and isinstance(pos_input, str):
        positive_prompt = pos_input
    else:
        positive_prompt = _extract_clip_text(prompt_graph, pos_id)
    if neg_id is None and isinstance(neg_input, str):
        negative_prompt = neg_input
    else:
        negative_prompt = _extract_clip_text(prompt_graph, neg_id)

    # If prompts are missing, try other samplers (still only via linked inputs)
    if (not positive_prompt or not negative_prompt) and (wired_samplers or all_samplers):
        for sid in (wired_samplers or all_samplers):
            if str(sid) == sampler_id:
                continue
            node = prompt_graph.get(str(sid), {})
            inputs_alt: Dict[str, Any] = node.get("inputs", {}) or {}
            pos_alt = inputs_alt.get("positive")
            neg_alt = inputs_alt.get("negative")
            pos_alt_id = _extract_link_node_id(pos_alt)
            neg_alt_id = _extract_link_node_id(neg_alt)
            if not positive_prompt:
                if pos_alt_id is None and isinstance(pos_alt, str):
                    positive_prompt = pos_alt
                else:
                    positive_prompt = _extract_clip_text(prompt_graph, pos_alt_id)
            if not negative_prompt:
                if neg_alt_id is None and isinstance(neg_alt, str):
                    negative_prompt = neg_alt
                else:
                    negative_prompt = _extract_clip_text(prompt_graph, neg_alt_id)
            if positive_prompt and negative_prompt:
                break

    # Model chain
    model_link_id = (
        _extract_link_node_id(inputs.get("model"))
        or _extract_link_node_id(inputs.get("guider"))
    )
    model_name, vae_name, loras = _walk_model_chain(prompt_graph, model_link_id)

    if isinstance(raw_workflow, dict):
        workflow = raw_workflow
    elif reconstruct_allowed:
        workflow = _prompt_graph_to_workflow(prompt_graph)
    else:
        workflow = None

    result = {
        "positive_prompt": positive_prompt,
        "negative_prompt": negative_prompt,
        "seed": seed,
        "steps": steps,
        "cfg": cfg,
        "sampler_name": sampler_name,
        "scheduler": scheduler,
        "model": model_name,
        "vae": vae_name,
        "loras": loras,
        "workflow": workflow,
    }
    return result


def extract_generation_params_from_workflow(workflow: Dict[str, Any]) -> Dict[str, Any]:
    """
    Variant that takes a raw ComfyUI workflow (dict with 'nodes': [...]).
    """
    prompt_graph = _normalize_workflow_to_prompt_graph(workflow)
    if prompt_graph is None:
        return {}
    return extract_generation_params_from_prompt_graph(
        prompt_graph, raw_workflow=workflow, reconstruct_allowed=False
    )


def extract_generation_params_from_png(path: str | Path) -> Dict[str, Any]:
    """
    Read all generation info from a ComfyUI output.

    - If path is an MP4, look for the PNG sibling (same name, .png).
    - Read the 'prompt' graph from PNG metadata.
    - Choose a sampler (KSampler / SamplerCustom / WAN...).
    - Walk the 'model' chain and the positive/negative branches.
    """
    p = Path(path)

    original_ext = p.suffix.lower()

    # MP4 -> PNG sibling
    if original_ext == ".mp4":
        png_sibling = p.with_suffix(".png")
        target = png_sibling
    else:
        target = p

    if not target.exists():
        return {}

    raw_workflow = load_raw_workflow_from_png(target)
    prompt_graph = load_prompt_graph_from_png(target)
    if prompt_graph is None and load_metadata is not None:
        try:
            side_meta = load_metadata(str(target))
            if isinstance(side_meta, dict):
                # accepte 'prompt' ou 'workflow' dans le sidecar
                prompt = _ensure_dict_from_json(side_meta.get("prompt"))
                if prompt is not None:
                    prompt_graph = prompt
                else:
                    wf_raw = _ensure_dict_from_json(side_meta.get("workflow"))
                    if wf_raw is not None:
                        prompt_graph = _normalize_workflow_to_prompt_graph(wf_raw)
                        if raw_workflow is None and isinstance(wf_raw, dict):
                            raw_workflow = wf_raw
        except Exception:
            prompt_graph = None
    if not prompt_graph:
        return {}

    reconstruct_allowed = original_ext != ".png"
    return extract_generation_params_from_prompt_graph(
        prompt_graph,
        raw_workflow=raw_workflow,
        reconstruct_allowed=reconstruct_allowed,
    )
