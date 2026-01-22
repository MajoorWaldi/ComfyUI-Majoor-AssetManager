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
        const clip = pickModelName(models.clip);
        const vae = pickModelName(models.vae);
        if (ckpt) modelData.push({ label: "Checkpoint", value: ckpt });
        if (unet) modelData.push({ label: "UNet", value: unet });
        if (diffusion) modelData.push({ label: "Diffusion", value: diffusion });
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

    return container.children.length > 0 ? container : null;
}
