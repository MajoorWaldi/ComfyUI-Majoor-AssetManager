import { createGenerationSection } from "../../components/sidebar/sections/GenerationSection.js";
import { createWorkflowMinimapSection } from "../../components/sidebar/sections/WorkflowMinimapSection.js";
import { createFileInfoSection } from "../../components/sidebar/sections/FileInfoSection.js";
import { createInfoBox } from "../../components/sidebar/utils/dom.js";
import { safeCall as baseSafeCall } from "../../utils/safeCall.js";
import { APP_CONFIG } from "../../app/config.js";

const safeCall = (fn, fallback = null) => {
    const res = baseSafeCall(fn);
    return res === undefined ? fallback : res;
};

const GENINFO_CACHE_TTL_MS = APP_CONFIG?.VIEWER_GENINFO_TTL_MS ?? 30_000;
const GENINFO_ERROR_TTL_MS = APP_CONFIG?.VIEWER_GENINFO_ERROR_TTL_MS ?? 8_000;
const GENINFO_CACHE_MAX = APP_CONFIG?.VIEWER_GENINFO_MAX_ENTRIES ?? 300;

const GENINFO_CACHE = new Map(); // key -> { at, data }
const GENINFO_ERROR_CACHE = new Map(); // key -> { at, error }
const GENINFO_INFLIGHT = new Map(); // key -> Promise

const _pruneCache = (cache, ttl, maxEntries) => {
    try {
        const now = Date.now();
        for (const [key, value] of cache.entries()) {
            if (!value) {
                cache.delete(key);
                continue;
            }
            if (now - (value.at || 0) > ttl) {
                cache.delete(key);
            }
        }
        if (cache.size <= maxEntries) return;
        const sorted = Array.from(cache.entries()).sort((a, b) => (a?.[1]?.at || 0) - (b?.[1]?.at || 0));
        const excess = cache.size - maxEntries;
        for (let i = 0; i < excess; i++) {
            const key = sorted[i]?.[0];
            if (key != null) cache.delete(key);
        }
    } catch {}
};

const _cacheGet = (cache, key, ttl) => {
    try {
        const v = cache.get(key);
        if (!v) return null;
        if (Date.now() - (v.at || 0) > ttl) {
            cache.delete(key);
            return null;
        }
        return v.data ?? null;
    } catch {
        return null;
    }
};

const _cacheSet = (cache, key, data, ttl, maxEntries) => {
    try {
        cache.set(key, { at: Date.now(), data });
        _pruneCache(cache, ttl, maxEntries);
    } catch {}
};

const _getCacheKey = (asset) => {
    try {
        const id = asset?.id;
        if (id != null) return `id:${id}`;
        const fp = getFilePath(asset);
        if (fp) return `fp:${fp}`;
        const name = String(asset?.filename || asset?.name || "").trim();
        const sub = String(asset?.subfolder || "").trim();
        const type = String(asset?.source || asset?.type || "output").trim().toLowerCase();
        if (name) return `name:${type}:${sub}:${name}`;
    } catch {}
    return null;
};

const getGenInfoStatus = (asset) => {
    try {
        if (!asset || typeof asset !== "object") return null;
        const raw = asset?.metadata_raw;
        if (raw && typeof raw === "object" && raw.geninfo_status && typeof raw.geninfo_status === "object") return raw.geninfo_status;
        if (asset?.geninfo_status && typeof asset.geninfo_status === "object") return asset.geninfo_status;
        return null;
    } catch {
        return null;
    }
};

const setGenInfoStatus = (asset, status) => {
    try {
        if (!asset || typeof asset !== "object") return;
        if (!status || typeof status !== "object") return;
        // Keep a flat copy for legacy consumers.
        try {
            asset.geninfo_status = status;
        } catch {}

        // Prefer embedding under metadata_raw to survive merges.
        try {
            const raw = asset.metadata_raw;
            if (raw && typeof raw === "object") {
                raw.geninfo_status = status;
                asset.metadata_raw = raw;
                return;
            }
            // If `metadata_raw` is a string (raw JSON/text), preserve it.
            if (typeof raw === "string") return;
        } catch {}
        try {
            asset.metadata_raw = { geninfo_status: status };
        } catch {}
    } catch {}
};

const _hasUsefulGenOrWorkflowPayload = (asset) => {
    try {
        if (!asset || typeof asset !== "object") return false;
        if (asset.geninfo && typeof asset.geninfo === "object" && Object.keys(asset.geninfo).length) return true;
        if (asset.prompt != null) return true;
        if (asset.workflow != null) return true;
        if (asset.metadata != null) return true;
        if (asset.exif != null) return true;

        const raw = asset.metadata_raw;
        if (raw && typeof raw === "object") {
            const keys = [
                "geninfo",
                "GenInfo",
                "generation",
                "prompt",
                "Prompt",
                "negative_prompt",
                "workflow",
                "Workflow",
                "comfy_workflow",
                "geninfo_status",
            ];
            for (const k of keys) {
                if (raw[k] != null) return true;
            }
            return false;
        }

        if (typeof raw === "string") {
            const t = raw.trim();
            if (!t) return false;
            if (t === "{}" || t === "null" || t === "[]" || t === "{{}}") return false;
            const needle = [
                "Negative prompt:",
                "\"prompt\"",
                "\"negative_prompt\"",
                "\"geninfo\"",
                "\"workflow\"",
                "\"comfy_workflow\"",
            ];
            for (const n of needle) {
                if (t.includes(n)) return true;
            }
            return false;
        }

        return false;
    } catch {
        return false;
    }
};

const getFilePath = (asset) => {
    const candidate =
        asset?.filepath ||
        asset?.path ||
        asset?.file_info?.filepath ||
        asset?.file_info?.path ||
        asset?.filePath ||
        null;
    if (typeof candidate !== "string") return null;
    const trimmed = candidate.trim();
    return trimmed ? trimmed : null;
};

const isLikelyVideo = (asset) => {
    try {
        const mime = String(asset?.mime || asset?.mimetype || asset?.type || "").toLowerCase();
        if (mime.startsWith("video/")) return true;
        const p = getFilePath(asset) || String(asset?.filename || asset?.name || "");
        const ext = p.split(".").pop()?.toLowerCase?.() || "";
        return ["mp4", "webm", "mov", "mkv", "avi", "m4v", "gif"].includes(ext);
    } catch {
        return false;
    }
};

const coerceRawObject = (raw) => {
    if (!raw) return null;
    if (typeof raw === "object") return raw;
    if (typeof raw !== "string") return null;
    const t = raw.trim();
    if (!t) return null;
    return safeCall(() => {
        const parsed = JSON.parse(t);
        return parsed && typeof parsed === "object" ? parsed : null;
    }, null);
};

const ensureMediaPipelineStatus = (asset) => {
    try {
        if (!isLikelyVideo(asset)) return;
        if (asset?.geninfo || asset?.prompt || asset?.workflow || asset?.metadata) return;
        const rawObj = coerceRawObject(asset?.metadata_raw) || {};
        if (rawObj.geninfo_status) return;
        if (asset?.geninfo_status) {
            rawObj.geninfo_status = asset.geninfo_status;
            asset.metadata_raw = rawObj;
            return;
        }
        rawObj.geninfo_status = { kind: "media_pipeline" };
        asset.metadata_raw = rawObj;
    } catch {}
};

const mergeFileMetadata = (asset, fileMeta) => {
    const md = fileMeta && typeof fileMeta === "object" ? fileMeta : null;
    if (!md) return asset;
    try {
        asset.prompt = asset.prompt ?? md.prompt;
    } catch {}
    try {
        asset.workflow = asset.workflow ?? md.workflow;
    } catch {}
    try {
        asset.geninfo = asset.geninfo ?? md.geninfo;
    } catch {}
    try {
        asset.geninfo_status = asset.geninfo_status ?? md.geninfo_status;
    } catch {}
    try {
        asset.exif = asset.exif ?? md.exif;
    } catch {}
    try {
        asset.ffprobe = asset.ffprobe ?? md.ffprobe;
    } catch {}
    try {
        if (asset.metadata_raw == null) {
            asset.metadata_raw = md;
        } else {
            const rawObj = coerceRawObject(asset.metadata_raw);
            if (rawObj && typeof rawObj === "object") {
                const keys = ["geninfo_status", "workflow", "prompt", "geninfo"];
                for (const k of keys) {
                    if (rawObj[k] == null && md[k] != null) rawObj[k] = md[k];
                }
                asset.metadata_raw = rawObj;
            }
        }
    } catch {}
    return asset;
};

export async function ensureViewerMetadataAsset(
    asset,
    { getAssetMetadata, getFileMetadataScoped, metadataCache, signal } = {}
) {
    if (!asset || typeof asset !== "object") return asset;
    const id = asset?.id ?? null;
    const cacheKey = _getCacheKey(asset);

    let full = asset;
    const cachedGen = cacheKey ? _cacheGet(GENINFO_CACHE, cacheKey, GENINFO_CACHE_TTL_MS) : null;
    if (cachedGen && typeof cachedGen === "object") {
        return { ...asset, ...cachedGen };
    }

    const cachedError = cacheKey ? _cacheGet(GENINFO_ERROR_CACHE, cacheKey, GENINFO_ERROR_TTL_MS) : null;
    if (cachedError) {
        try { setGenInfoStatus(full, cachedError); } catch {}
        return full;
    }

    if (cacheKey && GENINFO_INFLIGHT.has(cacheKey)) {
        try {
            const inflight = GENINFO_INFLIGHT.get(cacheKey);
            if (inflight && typeof inflight.then === "function") {
                return await inflight;
            }
        } catch {}
    }

    const run = async () => {
    const cached = id != null ? safeCall(() => metadataCache?.getCached?.(id)?.data || null, null) : null;
    if (cached && typeof cached === "object") full = { ...asset, ...cached };

    const flagsSuggestMore = Boolean(full?.has_generation_data || full?.has_workflow || full?.has_generation || full?.has_generation_info);
    const alreadyHasCore = Boolean(full?.geninfo || full?.prompt || full?.workflow || full?.metadata);
    let lastError = null;
    if (id != null && (!_hasUsefulGenOrWorkflowPayload(full) || (flagsSuggestMore && !alreadyHasCore))) {
        const res = await safeCall(() => getAssetMetadata?.(id, signal ? { signal } : {}), null);
        if (res?.ok && res.data && typeof res.data === "object") {
            full = { ...full, ...res.data };
            safeCall(() => metadataCache?.setCached?.(id, res.data));
        } else if (res && res?.code !== "ABORTED") {
            lastError = {
                kind: "fetch_error",
                stage: "asset",
                code: res?.code || "FETCH_ERROR",
                message: res?.error || "Failed to load asset metadata",
            };
        }
    }

    if (!_hasUsefulGenOrWorkflowPayload(full)) {
        // Preferred: scoped file reference (works for custom roots and `/view`).
        try {
            const type = String(full?.source || full?.type || "output").trim().toLowerCase() || "output";
            const filename = String(full?.filename || full?.name || full?.file_info?.filename || "").trim();
            const subfolder = String(full?.subfolder || full?.file_info?.subfolder || "").trim();
            const root_id = String(full?.root_id || full?.rootId || full?.file_info?.root_id || "").trim();
            if (filename) {
                const res = await safeCall(
                    () =>
                        getFileMetadataScoped?.(
                            {
                                type,
                                filename,
                                subfolder,
                                root_id,
                            },
                            signal ? { signal } : {}
                        ),
                    null
                );
                if (res?.ok && res.data) {
                    full = mergeFileMetadata({ ...full }, res.data);
                } else if (res && res?.code !== "ABORTED") {
                    lastError = {
                        kind: "fetch_error",
                        stage: "file_scoped",
                        code: res?.code || "FETCH_ERROR",
                        message: res?.error || "Failed to extract file metadata",
                    };
                }
            }
        } catch {}
    }

    ensureMediaPipelineStatus(full);
    if (!_hasUsefulGenOrWorkflowPayload(full) && lastError) {
        // Avoid clobbering media-only detection if we already set it.
        const existing = getGenInfoStatus(full);
        if (!(existing && existing.kind === "media_pipeline")) {
            setGenInfoStatus(full, lastError);
        }
    }
        if (_hasUsefulGenOrWorkflowPayload(full) && cacheKey) {
            _cacheSet(GENINFO_CACHE, cacheKey, full, GENINFO_CACHE_TTL_MS, GENINFO_CACHE_MAX);
        } else if (lastError && cacheKey) {
            _cacheSet(GENINFO_ERROR_CACHE, cacheKey, lastError, GENINFO_ERROR_TTL_MS, GENINFO_CACHE_MAX);
        }
    return full;
    };

    if (cacheKey) {
        const p = run().finally(() => {
            try { GENINFO_INFLIGHT.delete(cacheKey); } catch {}
        });
        GENINFO_INFLIGHT.set(cacheKey, p);
        return await p;
    }
    return await run();
}

export function buildViewerMetadataBlocks({ title, asset, ui } = {}) {
    const block = document.createElement("div");
    block.style.cssText = "display:flex; flex-direction:column; gap:10px; margin-bottom: 14px;";

    if (title) {
        const h = document.createElement("div");
        h.textContent = title;
        h.style.cssText = "font-size: 12px; font-weight: 600; letter-spacing: 0.02em; color: rgba(255,255,255,0.86);";
        block.appendChild(h);
    }

    const status = getGenInfoStatus(asset);
    if (ui?.loading) {
        safeCall(() => {
            block.appendChild(createInfoBox("Loading", "Loading generation data\u2026", "var(--mjr-status-info, #2196F3)"));
        });
    }

    if (status && typeof status === "object" && status.kind === "fetch_error") {
        const msg = String(status.message || status.error || "Failed to load generation data.");
        const code = String(status.code || status.stage || "").trim();
        const content = code ? `${msg}\n\nCode: ${code}\nClick to retry.` : `${msg}\n\nClick to retry.`;
        safeCall(() => {
            const box = createInfoBox("Error Loading Metadata", content, "var(--mjr-status-error, #F44336)");
            try {
                box.style.cursor = "pointer";
            } catch {}
            try {
                if (typeof ui?.onRetry === "function") {
                    box.onclick = () => safeCall(() => ui.onRetry());
                }
            } catch {}
            block.appendChild(box);
        });
    }

    const gen = safeCall(() => createGenerationSection(asset), null);
    const fileInfo = safeCall(() => createFileInfoSection(asset), null);
    
    let wf = null;
    if (APP_CONFIG.WORKFLOW_MINIMAP_ENABLED !== false) {
        wf = safeCall(() => createWorkflowMinimapSection(asset), null);
    }

    if (fileInfo) block.appendChild(fileInfo);
    if (gen) block.appendChild(gen);
    if (wf) block.appendChild(wf);

    if (!gen && !wf && !fileInfo) {
        // Avoid showing "no data" when we have an explicit status box.
        if (!(status && typeof status === "object" && (status.kind === "fetch_error" || status.kind === "media_pipeline")) && !ui?.loading) {
            const empty = document.createElement("div");
            empty.style.cssText =
                "padding: 10px 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.72);";
            empty.textContent = "No generation data found for this file.";
            block.appendChild(empty);
        }
    }

    safeCall(() => {
        const raw = asset?.metadata_raw;
        if (raw == null) return;
        const details = document.createElement("details");
        details.style.cssText =
            "border: 1px solid rgba(255,255,255,0.10); border-radius: 10px; background: rgba(255,255,255,0.04); overflow: hidden;";
        const summary = document.createElement("summary");
        summary.textContent = "Raw metadata";
        summary.style.cssText = "cursor: pointer; padding: 10px 12px; color: rgba(255,255,255,0.78); user-select: none;";
        const pre = document.createElement("pre");
        pre.style.cssText =
            "margin:0; padding: 10px 12px; max-height: 280px; overflow:auto; font-size: 11px; line-height: 1.35; color: rgba(255,255,255,0.86);";
        let txt = "";
        if (typeof raw === "string") txt = raw;
        else txt = JSON.stringify(raw, null, 2);
        if (txt.length > 40_000) txt = `${txt.slice(0, 40_000)}\n…(truncated)`;
        pre.textContent = txt;
        details.appendChild(summary);
        details.appendChild(pre);
        block.appendChild(details);
    });

    return block;
}
