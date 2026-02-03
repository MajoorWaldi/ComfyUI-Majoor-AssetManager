import { createInfoBox, createParametersBox } from "../utils/dom.js";
import {
    formatLoRAItem,
    formatModelLabel,
    normalizeGenerationMetadata,
    normalizePromptsForDisplay,
} from "../parsers/geninfoParser.js";

export function createGenerationSection(asset) {
    let metadata = null;

    // Prefer backend-parsed geninfo when available (most reliable for pos/neg + model chain).
    if (asset?.geninfo && typeof asset.geninfo === "object") {
        metadata = { geninfo: asset.geninfo };
    } else if (asset?.metadata && (typeof asset.metadata === "object" || typeof asset.metadata === "string")) {
        metadata = asset.metadata;
    } else if (asset?.prompt && (typeof asset.prompt === "object" || typeof asset.prompt === "string")) {
        metadata = asset.prompt;
    } else if (asset?.metadata_raw) {
        metadata = asset.metadata_raw;
    } else if (asset?.exif) {
        metadata = asset.exif;
    }

    const normalized = normalizeGenerationMetadata(metadata);
    const hasDisplayableFields = (obj) => {
        try {
            if (!obj || typeof obj !== "object") return false;
            // Workflow Type check
            if (obj.engine && typeof obj.engine === "object" && obj.engine.type) return true;
            if (typeof obj.prompt === "string" && obj.prompt.trim()) return true;
            if (typeof (obj.negative_prompt || obj.negativePrompt) === "string" && (obj.negative_prompt || obj.negativePrompt).trim())
                return true;
            if (obj.models || obj.model || obj.checkpoint || obj.loras) return true;
            if (obj.sampler || obj.sampler_name || obj.steps || obj.cfg || obj.cfg_scale || obj.scheduler) return true;
            if (obj.seed || obj.width || obj.height || obj.denoise || obj.denoising || obj.clip_skip) return true;
            return false;
        } catch {
            return false;
        }
    };

    if (!normalized || (typeof normalized === "object" && Object.keys(normalized).length === 0) || !hasDisplayableFields(normalized)) {
        const status = asset?.metadata_raw?.geninfo_status || asset?.geninfo_status;
        if (status && typeof status === "object" && status.kind === "media_pipeline") {
            const container = document.createElement("div");
            container.appendChild(
                createInfoBox(
                    "Generation Data",
                    "This file looks like a media-only pipeline (e.g. LoadVideo/VideoCombine) and does not contain generation parameters.",
                    "#9E9E9E"
                )
            );
            return container;
        }
        return null;
    }
    metadata = normalized;

    const container = document.createElement("div");
    container.style.cssText = `
        display: flex;
        flex-direction: column;
        gap: 12px;
    `;
    
    // Check for truncated flag (backend sets this if metadata > limit)
    const isTruncated = asset?.geninfo?._truncated || asset?.metadata?._truncated || asset?.prompt?._truncated;

    if (isTruncated) {
         container.appendChild(
            createInfoBox(
                "Metadata Truncated",
                "Generation data is incomplete because it exceeded the size limit.",
                "#FF9800"
            )
        );
    }
    
    // Workflow Type Header
    if (metadata.engine && metadata.engine.type) {
        const typeBox = document.createElement("div");
        typeBox.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 4px 8px;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 4px;
            font-size: 11px;
            color: #ccc;
        `;
        
        const badge = document.createElement("span");
        badge.textContent = metadata.engine.type;
        badge.style.cssText = `
            background: #2196f3;
            color: white;
            padding: 2px 6px;
            border-radius: 3px;
            font-weight: bold;
            font-size: 10px;
        `;
        
        const label = document.createElement("span");
        label.textContent = "Workflow Type";
        label.style.opacity = "0.7";

        typeBox.appendChild(label);
        typeBox.appendChild(badge);
        container.appendChild(typeBox);
    }

    const cleaned = normalizePromptsForDisplay(
        typeof metadata.prompt === "string" ? metadata.prompt : null,
        typeof (metadata.negative_prompt || metadata.negativePrompt) === "string"
            ? metadata.negative_prompt || metadata.negativePrompt
            : null
    );

    if (typeof cleaned.positive === "string" && cleaned.positive.trim()) {
        container.appendChild(createInfoBox("Positive Prompt", cleaned.positive, "#4CAF50"));
    }

    if (typeof cleaned.negative === "string" && cleaned.negative.trim()) {
        container.appendChild(createInfoBox("Negative Prompt", cleaned.negative, "#F44336"));
    }

    const modelData = [];
    const models = metadata.models && typeof metadata.models === "object" ? metadata.models : null;
    const pickModelName = (m) => {
        if (!m) return "";
        if (typeof m === "string") return formatModelLabel(m);
        if (typeof m === "object") return formatModelLabel(m.name || m.value || "");
        return "";
    };

    if (models) {
        const ckpt = pickModelName(models.checkpoint);
        const unet = pickModelName(models.unet);
        const diffusion = pickModelName(models.diffusion);
        const upscaler = pickModelName(models.upscaler);
        const clip = pickModelName(models.clip);
        const vae = pickModelName(models.vae);
        if (ckpt) modelData.push({ label: "Checkpoint", value: ckpt });
        if (unet) modelData.push({ label: "UNet", value: unet });
        if (diffusion) modelData.push({ label: "Diffusion", value: diffusion });
        if (upscaler) modelData.push({ label: "Upscaler", value: upscaler });
        if (clip) modelData.push({ label: "CLIP", value: clip });
        if (vae) modelData.push({ label: "VAE", value: vae });
    } else if (metadata.model || metadata.checkpoint) {
        modelData.push({ label: "Model", value: formatModelLabel(metadata.model || metadata.checkpoint) });
    }

    if (metadata.loras && Array.isArray(metadata.loras) && metadata.loras.length > 0) {
        const loraText = metadata.loras
            .map((lora) => formatLoRAItem(lora))
            .filter(Boolean)
            .join("\n");
        if (loraText) modelData.push({ label: "LoRA", value: loraText });
    }

    if (!models && metadata.clip) {
        modelData.push({ label: "CLIP", value: formatModelLabel(metadata.clip) });
    }
    if (!models && metadata.vae) {
        modelData.push({ label: "VAE", value: formatModelLabel(metadata.vae) });
    }
    if (!models && metadata.unet) {
        modelData.push({ label: "UNet", value: formatModelLabel(metadata.unet) });
    }
    if (!models && metadata.diffusion) {
        modelData.push({ label: "Diffusion", value: formatModelLabel(metadata.diffusion) });
    }
    if (modelData.length > 0) {
        container.appendChild(createParametersBox("Model & LoRA", modelData, "#9C27B0"));
    }

    const samplingData = [];
    if (metadata.sampler || metadata.sampler_name) {
        samplingData.push({ label: "Sampler", value: metadata.sampler || metadata.sampler_name });
    }
    if (metadata.steps) samplingData.push({ label: "Steps", value: metadata.steps });
    if (metadata.cfg || metadata.cfg_scale) samplingData.push({ label: "CFG Scale", value: metadata.cfg || metadata.cfg_scale });
    if (metadata.scheduler) samplingData.push({ label: "Scheduler", value: metadata.scheduler });
    if (samplingData.length > 0) {
        container.appendChild(createParametersBox("Sampling", samplingData, "#FF9800"));
    }

    const imageData = [];
    if (metadata.seed) imageData.push({ label: "Seed", value: metadata.seed });
    if (metadata.width && metadata.height) imageData.push({ label: "Size", value: `${metadata.width}\u00D7${metadata.height}` });
    if (metadata.denoise || metadata.denoising) imageData.push({ label: "Denoise", value: metadata.denoise || metadata.denoising });
    if (metadata.clip_skip) imageData.push({ label: "Clip Skip", value: metadata.clip_skip });
    if (imageData.length > 0) {
        container.appendChild(createParametersBox("Image", imageData, "#2196F3"));
    }

    // Input Files Section
    if (metadata.inputs && Array.isArray(metadata.inputs) && metadata.inputs.length > 0) {
        const inputBox = document.createElement("div");
        inputBox.style.cssText = `
            background: rgba(0,0,0,0.3);
            border-left: 3px solid #4CAF50;
            border-radius: 6px;
            padding: 12px;
            margin-top: 10px;
        `;
        
        const header = document.createElement("div");
        header.textContent = "Source Files";
        header.style.cssText = `
             font-size: 11px;
             font-weight: 600;
             color: #4CAF50;
             text-transform: uppercase;
             letter-spacing: 0.5px;
             margin-bottom: 8px;
        `;
        inputBox.appendChild(header);

        const grid = document.createElement("div");
        grid.style.cssText = "display: flex; gap: 8px; flex-wrap: wrap;";
        
        metadata.inputs.forEach(inp => {
            const thumb = document.createElement("div");
            thumb.style.cssText = "width: 64px; height: 64px; background: #222; border-radius: 4px; overflow: hidden; position: relative; cursor: pointer; display: flex; align-items: center; justify-content: center;";
            thumb.title = inp.filename;
            
            const params = new URLSearchParams({
                filename: inp.filename,
                type: inp.folder_type || "input",
                subfolder: inp.subfolder || ""
            });
            const src = `./view?${params.toString()}`;
            
            const isVideo = inp.type === "video" || inp.filename.match(/\.(mp4|mov|webm)$/i);

            if (isVideo) {
                const vid = document.createElement("video");
                vid.src = src;
                vid.muted = true;
                vid.loop = true;
                vid.autoplay = false; // Hover to play? Or just poster?
                // Auto-play many videos might be heavy. Let's try mouseover.
                vid.onmouseover = () => vid.play().catch(() => {});
                vid.onmouseout = () => vid.pause();
                
                vid.style.cssText = "width: 100%; height: 100%; object-fit: cover;";
                thumb.appendChild(vid);
            } else {
                const img = document.createElement("img");
                img.src = src;
                img.style.cssText = "width: 100%; height: 100%; object-fit: cover;";
                thumb.appendChild(img);
            }

            // Role Badge (New)
            if (inp.role && inp.role !== "secondary") {
                const roleBadge = document.createElement("div");
                roleBadge.textContent = inp.role.replace("_", " ");
                roleBadge.style.cssText = `
                    position: absolute;
                    bottom: 0;
                    left: 0;
                    right: 0;
                    background: rgba(0,0,0,0.7);
                    color: white;
                    font-size: 8px;
                    padding: 2px;
                    text-align: center;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                `;
                thumb.appendChild(roleBadge);
            }

            // Play icon overlay for video if no role badge or just on top
            if (isVideo && !inp.role) {
                const icon = document.createElement("div");
                icon.innerHTML = "▶";
                icon.style.cssText = "position: absolute; color: white; opacity: 0.7; font-size: 16px; pointer-events: none;";
                thumb.appendChild(icon);
            }
            
            thumb.onclick = (e) => {
                e.stopPropagation();
                window.open(src, "_blank");
            };
            
            grid.appendChild(thumb);
        });
        
        inputBox.appendChild(grid);
        container.appendChild(inputBox);
    }

    return container.children.length > 0 ? container : null;
}
