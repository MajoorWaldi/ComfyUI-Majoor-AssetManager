/**
 * API Client - Safe fetch wrapper (never throws)
 */

const SETTINGS_KEY = "mjrSettings";
let _obsEnabledCache = null;
let _obsCacheAt = 0;
let _rtSyncEnabledCache = null;
let _rtSyncCacheAt = 0;
let _tagsCache = null;
let _tagsCacheAt = 0;
const TAGS_CACHE_TTL_MS = 30_000;
const CLIENT_GLOBAL_KEY = "__MJR_API_CLIENT__";

export function invalidateObsCache() {
    _obsEnabledCache = null;
    _obsCacheAt = 0;
}

export function invalidateRatingTagsSyncCache() {
    _rtSyncEnabledCache = null;
    _rtSyncCacheAt = 0;
}

export function invalidateTagsCache() {
    _tagsCache = null;
    _tagsCacheAt = 0;
}

// Best-effort cache invalidation when settings change (ComfyUI settings, dev tools, etc.).
try {
    const w = typeof window !== "undefined" ? window : null;
    if (w && !w[CLIENT_GLOBAL_KEY]) {
        w[CLIENT_GLOBAL_KEY] = { initialized: true };

        w.addEventListener?.("storage", (event) => {
            try {
                if (event?.key === SETTINGS_KEY) {
                    invalidateObsCache();
                    invalidateRatingTagsSyncCache();
                    invalidateTagsCache();
                }
            } catch {}
        });

        w.addEventListener?.("mjr-settings-changed", () => {
            invalidateObsCache();
            invalidateRatingTagsSyncCache();
            invalidateTagsCache();
        });
    }
} catch {}

const _readObsEnabled = () => {
    const now = Date.now();
    if (_obsEnabledCache !== null && now - _obsCacheAt < 2000) {
        return _obsEnabledCache;
    }
    _obsCacheAt = now;
    try {
        const raw = localStorage?.getItem?.(SETTINGS_KEY);
        if (!raw) {
            _obsEnabledCache = false;
            return _obsEnabledCache;
        }
        const parsed = JSON.parse(raw);
        _obsEnabledCache = !!parsed?.observability?.enabled;
        return _obsEnabledCache;
    } catch {
        _obsEnabledCache = false;
        return _obsEnabledCache;
    }
};

const _readRatingTagsSyncEnabled = () => {
    const now = Date.now();
    if (_rtSyncEnabledCache !== null && now - _rtSyncCacheAt < 2000) {
        return _rtSyncEnabledCache;
    }
    _rtSyncCacheAt = now;
    try {
        const raw = localStorage?.getItem?.(SETTINGS_KEY);
        if (!raw) {
            _rtSyncEnabledCache = false;
            return _rtSyncEnabledCache;
        }
        const parsed = JSON.parse(raw);
        _rtSyncEnabledCache = !!parsed?.ratingTagsSync?.enabled;
        return _rtSyncEnabledCache;
    } catch {
        _rtSyncEnabledCache = false;
        return _rtSyncEnabledCache;
    }
};

/**
 * Fetch wrapper that always returns {ok, data, error}
 * Never throws - returns error object instead
 */
export async function fetchAPI(url, options = {}) {
    try {
        const headers = typeof Headers !== "undefined" ? new Headers(options.headers || {}) : { ...(options.headers || {}) };

        // Add anti-CSRF header for state-changing requests
        const method = (options.method || "GET").toUpperCase();
        if (["POST", "PUT", "DELETE", "PATCH"].includes(method)) {
            try {
                if (headers instanceof Headers) {
                    if (!headers.has("X-Requested-With")) headers.set("X-Requested-With", "XMLHttpRequest");
                } else if (!headers["X-Requested-With"]) {
                    headers["X-Requested-With"] = "XMLHttpRequest";
                }
            } catch {}
        }

        // Per-client switch: control backend observability logs.
        // Explicitly send on/off so backend doesn't have to guess.
        const obsEnabled = _readObsEnabled();
        try {
            if (headers instanceof Headers) {
                if (!headers.has("X-MJR-OBS")) headers.set("X-MJR-OBS", obsEnabled ? "on" : "off");
            } else if (!("X-MJR-OBS" in headers)) {
                headers["X-MJR-OBS"] = obsEnabled ? "on" : "off";
            }
        } catch {}

        const response = await fetch(url, { ...options, headers });
        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) {
            return {
                ok: false,
                error: `Server returned non-JSON response (${response.status})`,
                code: "INVALID_RESPONSE",
                status: response.status,
                content_type: contentType,
                data: null
            };
        }

        const result = await response.json().catch(() => null);
        if (typeof result !== "object" || result === null) {
            return {
                ok: false,
                error: "Invalid response structure",
                code: "INVALID_RESPONSE",
                status: response.status,
                data: null
            };
        }

        // Preserve HTTP status for callers that want to treat 401/403/404 specially.
        if (!("status" in result)) {
            try {
                result.status = response.status;
            } catch {}
        }
        return result; // Backend returns {ok, data, error, code, meta}
    } catch (error) {
        return {
            ok: false,
            error: error.message,
            code: "NETWORK_ERROR",
            data: null
        };
    }
}

/**
 * GET request helper
 */
export async function get(url) {
    return fetchAPI(url, { method: "GET" });
}

/**
 * POST request helper
 */
export async function post(url, body) {
    return fetchAPI(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });
}

/**
 * Update asset rating (0-5 stars)
 */
export async function updateAssetRating(assetId, rating) {
    const enabled = _readRatingTagsSyncEnabled();
    const asset = assetId && typeof assetId === "object" ? assetId : null;
    const resolvedId = asset ? asset.id : assetId;
    const payload = {
        rating: Math.max(0, Math.min(5, Number(rating) || 0))
    };
    if (resolvedId != null) {
        payload.asset_id = resolvedId;
    } else if (asset) {
        payload.filepath = asset.filepath || asset.path || asset?.file_info?.filepath || "";
        payload.type = asset.type || "output";
        payload.root_id = asset.root_id || asset.rootId || asset.custom_root_id || "";
    } else {
        payload.asset_id = resolvedId;
    }
    return fetchAPI("/mjr/am/asset/rating", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(enabled ? { "X-MJR-RTSYNC": "on" } : {})
        },
        body: JSON.stringify(payload)
    });
}

/**
 * Update asset tags
 */
export async function updateAssetTags(assetId, tags) {
    const enabled = _readRatingTagsSyncEnabled();
    const asset = assetId && typeof assetId === "object" ? assetId : null;
    const resolvedId = asset ? asset.id : assetId;
    const payload = {
        tags: Array.isArray(tags) ? tags : []
    };
    if (resolvedId != null) {
        payload.asset_id = resolvedId;
    } else if (asset) {
        payload.filepath = asset.filepath || asset.path || asset?.file_info?.filepath || "";
        payload.type = asset.type || "output";
        payload.root_id = asset.root_id || asset.rootId || asset.custom_root_id || "";
    } else {
        payload.asset_id = resolvedId;
    }
    const result = await fetchAPI("/mjr/am/asset/tags", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(enabled ? { "X-MJR-RTSYNC": "on" } : {})
        },
        body: JSON.stringify(payload)
    });
    if (result?.ok) {
        try {
            if (Array.isArray(_tagsCache)) {
                const next = new Set(_tagsCache);
                for (const t of Array.isArray(tags) ? tags : []) next.add(t);
                _tagsCache = Array.from(next);
            } else {
                invalidateTagsCache();
            }
        } catch {
            invalidateTagsCache();
        }
    }
    return result;
}

/**
 * Get all available tags from the database
 */
export async function getAvailableTags() {
    const now = Date.now();
    if (Array.isArray(_tagsCache) && now - _tagsCacheAt < TAGS_CACHE_TTL_MS) {
        return { ok: true, data: _tagsCache, error: null, code: "OK", meta: { cached: true } };
    }

    const result = await get("/mjr/am/tags");
    if (result?.ok && Array.isArray(result.data)) {
        _tagsCache = result.data;
        _tagsCacheAt = now;
    }
    return result;
}

/**
 * Get full asset metadata by ID
 */
export async function getAssetMetadata(assetId) {
    return get(`/mjr/am/asset/${assetId}`);
}

/**
 * Batch fetch assets by ID (no per-asset tool invocations / self-heal).
 */
export async function getAssetsBatch(assetIds) {
    const ids = Array.isArray(assetIds) ? assetIds : [];
    const cleaned = [];
    for (const id of ids) {
        const n = Number(id);
        if (!Number.isFinite(n)) continue;
        cleaned.push(Math.trunc(n));
        if (cleaned.length >= 200) break;
    }
    if (!cleaned.length) return { ok: true, data: [], error: null, code: "OK" };
    return post("/mjr/am/assets/batch", { asset_ids: cleaned });
}

export async function hydrateAssetRatingTags(assetId) {
    const id = String(assetId ?? "").trim();
    if (!id) return { ok: false, error: "Missing assetId" };
    return get(`/mjr/am/asset/${encodeURIComponent(id)}?hydrate=rating_tags`);
}

/**
 * Get metadata for a file path (works even when file is not indexed in DB).
 */
export async function getFileMetadata(filePath) {
    if (!filePath || typeof filePath !== "string") {
        return { ok: false, data: null, error: "Missing file path", code: "INVALID_INPUT" };
    }
    return get(`/mjr/am/metadata?path=${encodeURIComponent(filePath)}`);
}

export async function setProbeBackendMode(mode) {
    if (!mode || typeof mode !== "string") {
        return { ok: false, error: "Missing mode", code: "INVALID_INPUT" };
    }
    return post("/mjr/am/settings/probe-backend", { mode });
}

export async function openInFolder(assetId) {
    return post("/mjr/am/open-in-folder", { asset_id: assetId });
}

export async function deleteAsset(assetId) {
    return post("/mjr/am/asset/delete", { asset_id: assetId });
}

export async function deleteAssets(assetIds) {
    return post("/mjr/am/assets/delete", { ids: assetIds });
}

export async function renameAsset(assetId, newName) {
    return post("/mjr/am/asset/rename", { asset_id: assetId, new_name: newName });
}

// -----------------------------
// Collections
// -----------------------------

export async function listCollections() {
    return get("/mjr/am/collections");
}

export async function createCollection(name) {
    return post("/mjr/am/collections", { name: String(name || "").trim() });
}

export async function getCollection(collectionId) {
    const id = String(collectionId || "").trim();
    return get(`/mjr/am/collections/${encodeURIComponent(id)}`);
}

export async function deleteCollection(collectionId) {
    const id = String(collectionId || "").trim();
    return post(`/mjr/am/collections/${encodeURIComponent(id)}/delete`, {});
}

export async function addAssetsToCollection(collectionId, assets) {
    const id = String(collectionId || "").trim();
    const list = Array.isArray(assets) ? assets : [];
    return post(`/mjr/am/collections/${encodeURIComponent(id)}/add`, { assets: list });
}

export async function removeFilepathsFromCollection(collectionId, filepaths) {
    const id = String(collectionId || "").trim();
    const list = Array.isArray(filepaths) ? filepaths : [];
    return post(`/mjr/am/collections/${encodeURIComponent(id)}/remove`, { filepaths: list });
}

export async function getCollectionAssets(collectionId) {
    const id = String(collectionId || "").trim();
    return get(`/mjr/am/collections/${encodeURIComponent(id)}/assets`);
}
