import { parseA1111Parameters } from "./a1111ParamsParser.js";
import { looksLikeComfyPromptGraph, parseComfyUIWorkflow } from "./comfyWorkflowParser.js";

export function normalizeGenerationMetadata(raw) {
    if (!raw) return null;

        if (typeof raw === "object") {
            const geninfo = raw.geninfo || raw.GenInfo || raw.generation || null;
            if (geninfo && typeof geninfo === "object") {
                const mapped = {};
                const pos = geninfo.positive?.value ?? geninfo.positive?.text ?? null;
                const neg = geninfo.negative?.value ?? geninfo.negative?.text ?? null;
                if (typeof pos === "string" && pos.trim()) mapped.prompt = pos;
                if (typeof neg === "string" && neg.trim()) mapped.negative_prompt = neg;

                const ckpt = geninfo.checkpoint?.name ?? geninfo.checkpoint ?? null;
                if (typeof ckpt === "string" && ckpt.trim()) mapped.model = ckpt;

                const clip = geninfo.clip?.name ?? geninfo.clip ?? null;
                if (typeof clip === "string" && clip.trim()) mapped.clip = clip;
                const vae = geninfo.vae?.name ?? geninfo.vae ?? null;
                if (typeof vae === "string" && vae.trim()) mapped.vae = vae;

                const models = geninfo.models;
                if (models && typeof models === "object") {
                    mapped.models = models;
                }

                const loras = Array.isArray(geninfo.loras) ? geninfo.loras : null;
                if (loras) mapped.loras = loras;

            const sampler = geninfo.sampler?.name ?? geninfo.sampler ?? null;
            if (typeof sampler === "string" && sampler.trim()) mapped.sampler = sampler;
            const scheduler = geninfo.scheduler?.name ?? geninfo.scheduler ?? null;
            if (typeof scheduler === "string" && scheduler.trim()) mapped.scheduler = scheduler;

            const steps = geninfo.steps?.value ?? geninfo.steps ?? null;
            if (steps !== null && steps !== undefined) mapped.steps = steps;
            const cfg = geninfo.cfg?.value ?? geninfo.cfg ?? null;
            if (cfg !== null && cfg !== undefined) mapped.cfg = cfg;
            const seed = geninfo.seed?.value ?? geninfo.seed ?? null;
            if (seed !== null && seed !== undefined) mapped.seed = seed;
            const denoise = geninfo.denoise?.value ?? geninfo.denoise ?? null;
            if (denoise !== null && denoise !== undefined) mapped.denoise = denoise;
            const clipSkip = geninfo.clip_skip?.value ?? geninfo.clip_skip ?? geninfo.clipSkip ?? null;
            if (clipSkip !== null && clipSkip !== undefined) mapped.clip_skip = clipSkip;

            const inputs = geninfo.inputs;
            if (Array.isArray(inputs)) {
                mapped.inputs = inputs;
            }
            const lyrics = geninfo.lyrics?.value ?? geninfo.lyrics ?? null;
            if (typeof lyrics === "string" && lyrics.trim()) mapped.lyrics = lyrics;
            const lyricsStrength = geninfo.lyrics_strength?.value ?? geninfo.lyrics_strength ?? null;
            if (lyricsStrength !== null && lyricsStrength !== undefined) mapped.lyrics_strength = lyricsStrength;

            // Multi-output workflow prompts
            if (Array.isArray(geninfo.all_positive_prompts) && geninfo.all_positive_prompts.length > 1) {
                mapped.all_positive_prompts = geninfo.all_positive_prompts;
            }
            if (Array.isArray(geninfo.all_negative_prompts) && geninfo.all_negative_prompts.length > 1) {
                mapped.all_negative_prompts = geninfo.all_negative_prompts;
            }

            const size = geninfo.size || null;
            if (size && typeof size === "object") {
                if (size.width !== undefined) mapped.width = size.width;
                if (size.height !== undefined) mapped.height = size.height;
            }

            if (geninfo.engine && typeof geninfo.engine === "object") {
                mapped.engine = geninfo.engine;
            }

            if (Object.keys(mapped).length) return mapped;
        }

        const flatKeys = ["prompt", "negative_prompt", "negativePrompt", "steps", "sampler", "sampler_name", "cfg", "cfg_scale", "seed", "width", "height"];
        const hasFlatKey = flatKeys.some((k) => Object.prototype.hasOwnProperty.call(raw, k));
        if (hasFlatKey) return raw;

        const parsedFromWorkflow = parseComfyUIWorkflow(raw);
        if (parsedFromWorkflow) return parsedFromWorkflow;

        if (looksLikeComfyPromptGraph(raw)) {
            const parsed = parseComfyUIWorkflow({ prompt: raw });
            if (parsed) return parsed;
        }

        const maybeParams =
            raw["parameters"] ||
            raw["PNG:Parameters"] ||
            raw["EXIF:UserComment"] ||
            raw["UserComment"] ||
            raw["ImageDescription"] ||
            null;
        if (typeof maybeParams === "string") {
            const parsed = parseA1111Parameters(maybeParams);
            if (parsed) return parsed;
        }

        const innerWorkflow = raw.workflow || raw.Workflow || raw.comfy || raw.comfyui || raw.ComfyUI || null;
        if (innerWorkflow && typeof innerWorkflow === "object") {
            const parsed = parseComfyUIWorkflow(innerWorkflow);
            if (parsed) return parsed;
        }

        return raw;
    }

    if (typeof raw === "string") {
        const text = raw.trim();
        if (!text) return null;
        const parsedParams = parseA1111Parameters(text);
        if (parsedParams) return parsedParams;

        if ((text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"))) {
            try {
                const obj = JSON.parse(text);
                return normalizeGenerationMetadata(obj);
            } catch {
                return null;
            }
        }
        return { prompt: text };
    }

    return null;
}

export function normalizePromptsForDisplay(positive, negative) {
    let pos = typeof positive === "string" ? positive : "";
    let neg = typeof negative === "string" ? negative : "";

    // Always check if positive contains a negative block, even if negative is already provided.
    // This prevents the "pos/neg concatenation" bug where both sources appear.
    if (pos) {
        const marker = /(?:^|\n)\s*Negative prompt:\s*/i;
        if (marker.test(pos)) {
            const parts = pos.split(marker);
            const extractedPos = (parts[0] || "").trim();
            const tail = parts.slice(1).join("Negative prompt:").trim();
            const maybeParamsIdx = tail.search(/\n\s*Steps:\s*\d+/i);
            const extractedNeg = (maybeParamsIdx >= 0 ? tail.slice(0, maybeParamsIdx) : tail).trim();

            if (extractedPos) pos = extractedPos;
            // Only use extractedNeg if we don't already have an explicit negative
            if (!neg && extractedNeg) neg = extractedNeg;
        }
    }

    if (pos && neg && pos.trim() === neg.trim()) {
        neg = "";
    }

    return { positive: pos, negative: neg };
}

export function formatModelLabel(value) {
    if (!value) return "";
    const s = String(value).trim().replace(/\\/g, "/");
    const base = s.split("/").pop() || s;
    return base.replace(/\.(safetensors|ckpt|pt|pth|bin|gguf|json)$/i, "");
}

export function formatLoRAItem(lora) {
    if (!lora) return "";
    if (typeof lora === "string") return formatModelLabel(lora);

    const name = formatModelLabel(lora.name || lora.lora_name || "");
    if (!name) return "";

    const w = lora.weight ?? lora.strength ?? null;
    const sm = lora.strength_model ?? null;
    const sc = lora.strength_clip ?? null;

    if (sm !== null || sc !== null) {
        const parts = [];
        if (sm !== null && sm !== undefined) parts.push(`m=${sm}`);
        if (sc !== null && sc !== undefined) parts.push(`c=${sc}`);
        return parts.length ? `${name} (${parts.join(", ")})` : name;
    }

    if (w !== null && w !== undefined) return `${name} (${w})`;
    return name;
}
