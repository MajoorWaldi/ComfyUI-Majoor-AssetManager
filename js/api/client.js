/**
 * API Client - Safe fetch wrapper (never throws)
 */

import { SETTINGS_KEY } from "../app/settingsStore.js";
import { ENDPOINTS } from "./endpoints.js";
import { normalizeAssetId, pickRootId } from "../utils/ids.js";

/**
 * @template T
 * @typedef {{
 *  ok: boolean,
 *  data: (T|null),
 *  error?: (string|null),
 *  code?: string,
 *  meta?: any,
 *  status?: number
 * }} ApiResult
 */

/**
 * Compact viewer-oriented media info returned by `/mjr/am/viewer/info`.
 *
 * @typedef {{
 *  kind?: ('image'|'video'|'unknown'),
 *  mime?: (string|null),
 *  width?: (number|null),
 *  height?: (number|null),
 *  fps?: (number|string|null),
 *  fps_raw?: (string|null),
 *  frame_count?: (number|null),
 *  duration_s?: (number|null)
 * }} ViewerInfo
 */

let _obsCache = { value: null, at: 0 };
let _rtSyncCache = { value: null, at: 0 };
let _tagsCache = { value: null, at: 0 };
const AUTH_TOKEN_CACHE_TTL_MS = 2000;
let _authTokenCache = { value: "", at: 0 };
const TAGS_CACHE_TTL_MS = 30_000;
const DEFAULT_TAGS_CACHE_TTL_MS = TAGS_CACHE_TTL_MS;
const CLIENT_GLOBAL_KEY = "__MJR_API_CLIENT__";
const SETTINGS_FAST_CACHE_TTL_MS = 2000;
const MAX_BATCH_ASSET_IDS = 200;

function _getTagsCacheTTL() {
    try {
        const raw = localStorage?.getItem?.(SETTINGS_KEY) || "{}";
        const parsed = JSON.parse(raw);
        const ttl = parsed?.cache?.tagsTTLms ?? parsed?.cache?.tagsTTL ?? parsed?.cache?.tags_ttl_ms ?? null;
        const n = Number(ttl);
        if (!Number.isFinite(n)) return DEFAULT_TAGS_CACHE_TTL_MS;
        return Math.max(1_000, Math.min(10 * 60_000, Math.floor(n)));
    } catch {
        return DEFAULT_TAGS_CACHE_TTL_MS;
    }
}

function _readAuthToken() {
    const now = Date.now();
    const elapsed = now - (_authTokenCache.at || 0);
    if (elapsed >= 0 && elapsed < AUTH_TOKEN_CACHE_TTL_MS) {
        return _authTokenCache.value;
    }
    try {
        const raw = localStorage?.getItem?.(SETTINGS_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        const token = String(parsed?.security?.apiToken || "").trim();
        _authTokenCache = { value: token, at: now };
        return token;
    } catch {
        _authTokenCache = { value: "", at: now };
        return "";
    }
}

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 400;

function _delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function _isRetryableError(error) {
    try {
        if (!error) return false;
        const name = String(error.name || "");
        if (name === "AbortError") return false;
        const msg = String(error.message || "").toLowerCase();
        // TypeError is often used for network failures ("Failed to fetch"), but can also be real code bugs.
        if (name === "TypeError") {
            return (
                msg.includes("failed to fetch") ||
                msg.includes("networkerror") ||
                msg.includes("load failed") ||
                msg.includes("fetch") ||
                msg.includes("network")
            );
        }
        return msg.includes("fetch") || msg.includes("network") || msg.includes("failed");
    } catch {
        return false;
    }
}

export function invalidateObsCache() {
    _obsCache = { value: null, at: 0 };
}

export function invalidateRatingTagsSyncCache() {
    _rtSyncCache = { value: null, at: 0 };
}

export function invalidateTagsCache() {
    _tagsCache = { value: null, at: 0 };
}

function invalidateAuthTokenCache() {
    _authTokenCache = { value: "", at: 0 };
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
                    invalidateAuthTokenCache();
                }
            } catch {}
        });

        w.addEventListener?.("mjr-settings-changed", () => {
            invalidateObsCache();
            invalidateRatingTagsSyncCache();
            invalidateTagsCache();
            invalidateAuthTokenCache();
        });
    }
} catch {}

const _readObsEnabled = () => {
    const now = Date.now();
    if (_obsCache.value !== null && now - (_obsCache.at || 0) < SETTINGS_FAST_CACHE_TTL_MS) {
        return _obsCache.value;
    }
    try {
        const raw = localStorage?.getItem?.(SETTINGS_KEY);
        if (!raw) {
            _obsCache = { value: false, at: now };
            return _obsCache.value;
        }
        const parsed = JSON.parse(raw);
        _obsCache = { value: !!parsed?.observability?.enabled, at: now };
        return _obsCache.value;
    } catch {
        _obsCache = { value: false, at: now };
        return _obsCache.value;
    }
};

const _readRatingTagsSyncEnabled = () => {
    const now = Date.now();
    if (_rtSyncCache.value !== null && now - (_rtSyncCache.at || 0) < SETTINGS_FAST_CACHE_TTL_MS) {
        return _rtSyncCache.value;
    }
    try {
        const raw = localStorage?.getItem?.(SETTINGS_KEY);
        if (!raw) {
            _rtSyncCache = { value: false, at: now };
            return _rtSyncCache.value;
        }
        const parsed = JSON.parse(raw);
        _rtSyncCache = { value: !!parsed?.ratingTagsSync?.enabled, at: now };
        return _rtSyncCache.value;
    } catch {
        _rtSyncCache = { value: false, at: now };
        return _rtSyncCache.value;
    }
};

/**
 * Fetch wrapper that always returns {ok, data, error}
 * Never throws - returns error object instead
 */
/** @returns {Promise<ApiResult<any>>} */
export async function fetchAPI(url, options = {}, retryCount = 0) {
    try {
        const headers = typeof Headers !== "undefined" ? new Headers(options.headers || {}) : { ...options.headers };

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

        const authToken = _readAuthToken();
        if (authToken) {
            try {
                if (headers instanceof Headers) {
                    if (!headers.has("X-MJR-Token")) headers.set("X-MJR-Token", authToken);
                    if (!headers.has("Authorization")) headers.set("Authorization", `Bearer ${authToken}`);
                } else {
                    if (!("X-MJR-Token" in headers)) headers["X-MJR-Token"] = authToken;
                    if (!("Authorization" in headers)) headers["Authorization"] = `Bearer ${authToken}`;
                }
            } catch {}
        }

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
        try {
            if (String(error?.name || "") === "AbortError") {
                return { ok: false, error: "Aborted", code: "ABORTED", data: null };
            }
        } catch {}
        // Retry network failures a few times (best-effort).
        if (retryCount < MAX_RETRIES && _isRetryableError(error)) {
            try {
                await _delay(RETRY_BASE_DELAY_MS * (retryCount + 1));
            } catch {}
            try {
                return await fetchAPI(url, options, retryCount + 1);
            } catch {}
        }
        return {
            ok: false,
            error: error?.message || String(error || "Network error"),
            code: "NETWORK_ERROR",
            data: null,
            retries: retryCount
        };
    }
}

/**
 * GET request helper
 */
export async function get(url, options = {}) {
    return fetchAPI(url, { ...options, method: "GET" });
}

/**
 * POST request helper
 */
export async function post(url, body, options = {}) {
    return fetchAPI(url, {
        ...options,
        method: "POST",
        headers: { "Content-Type": "application/json", ...options.headers },
        body: JSON.stringify(body)
    });
}

/**
 * Update asset rating (0-5 stars)
 */
export async function updateAssetRating(assetId, rating, options = {}) {
    const enabled = _readRatingTagsSyncEnabled();
    const asset = assetId && typeof assetId === "object" ? assetId : null;
    const resolvedId = asset ? asset.id : assetId;
    const payload = {
        rating: Math.max(0, Math.min(5, Number(rating) || 0))
    };
    if (resolvedId != null) {
        payload.asset_id = normalizeAssetId(resolvedId);
    } else if (asset) {
        payload.filepath = asset.filepath || asset.path || asset?.file_info?.filepath || "";
        payload.type = asset.type || "output";
        payload.root_id = pickRootId(asset);
    } else {
        payload.asset_id = normalizeAssetId(resolvedId);
    }
    return fetchAPI("/mjr/am/asset/rating", {
        ...options,
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
export async function updateAssetTags(assetId, tags, options = {}) {
    const enabled = _readRatingTagsSyncEnabled();
    const asset = assetId && typeof assetId === "object" ? assetId : null;
    const resolvedId = asset ? asset.id : assetId;
    const payload = {
        tags: Array.isArray(tags) ? tags : []
    };
    if (resolvedId != null) {
        payload.asset_id = normalizeAssetId(resolvedId);
    } else if (asset) {
        payload.filepath = asset.filepath || asset.path || asset?.file_info?.filepath || "";
        payload.type = asset.type || "output";
        payload.root_id = pickRootId(asset);
    } else {
        payload.asset_id = normalizeAssetId(resolvedId);
    }
    const result = await fetchAPI("/mjr/am/asset/tags", {
        ...options,
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(enabled ? { "X-MJR-RTSYNC": "on" } : {})
        },
        body: JSON.stringify(payload)
    });
    if (result?.ok) {
        try {
            if (Array.isArray(_tagsCache.value)) {
                const next = new Set(_tagsCache.value);
                for (const t of Array.isArray(tags) ? tags : []) next.add(t);
                _tagsCache = { value: Array.from(next), at: Date.now() };
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
    if (Array.isArray(_tagsCache.value) && now - (_tagsCache.at || 0) < _getTagsCacheTTL()) {
        return { ok: true, data: _tagsCache.value, error: null, code: "OK", meta: { cached: true } };
    }

    const result = await get("/mjr/am/tags");
    if (result?.ok && Array.isArray(result.data)) {
        _tagsCache = { value: result.data, at: now };
    }
    return result;
}

/**
 * Get full asset metadata by ID
 */
export async function getAssetMetadata(assetId, options = {}) {
    return get(`/mjr/am/asset/${encodeURIComponent(normalizeAssetId(assetId))}`, options);
}

/**
 * Get compact viewer media info by asset ID (fps/frame count/dimensions/etc).
 */
/** @returns {Promise<ApiResult<ViewerInfo>>} */
export async function getViewerInfo(assetId, options = {}) {
    const id = normalizeAssetId(assetId);
    if (!id) return { ok: false, data: null, error: "Missing assetId", code: "INVALID_INPUT" };
    let url = `/mjr/am/viewer/info?asset_id=${encodeURIComponent(id)}`;
    if (options.refresh) url += "&refresh=1";
    const { refresh: _ignored, ...fetchOpts } = options;
    return get(url, fetchOpts);
}

/**
 * Batch fetch assets by ID (no per-asset tool invocations / self-heal).
 */
export async function getAssetsBatch(assetIds, options = {}) {
    const ids = Array.isArray(assetIds) ? assetIds : [];
    const cleaned = [];
    for (const id of ids) {
        const n = Number(id);
        if (!Number.isFinite(n)) continue;
        cleaned.push(Math.trunc(n));
        if (cleaned.length >= MAX_BATCH_ASSET_IDS) break;
    }
    if (!cleaned.length) return { ok: true, data: [], error: null, code: "OK" };
    return post("/mjr/am/assets/batch", { asset_ids: cleaned }, options);
}

export async function hydrateAssetRatingTags(assetId) {
    const id = normalizeAssetId(assetId);
    if (!id) return { ok: false, error: "Missing assetId" };
    return get(`/mjr/am/asset/${encodeURIComponent(id)}?hydrate=rating_tags`);
}

/**
 * Get metadata for a file reference (preferred over absolute paths).
 * Works on /view URLs where ComfyUI provides type/filename/subfolder.
 */
export async function getFileMetadataScoped(
    { type = "output", filename = "", subfolder = "", root_id = "", rootId = "" } = {},
    options = {}
) {
    const t = String(type || "output").trim().toLowerCase() || "output";
    const fn = String(filename || "").trim();
    const sub = String(subfolder || "").trim();
    const rid = String(root_id || rootId || "").trim();
    if (!fn) return { ok: false, data: null, error: "Missing filename", code: "INVALID_INPUT" };
    let url = `/mjr/am/metadata?type=${encodeURIComponent(t)}&filename=${encodeURIComponent(fn)}`;
    if (sub) url += `&subfolder=${encodeURIComponent(sub)}`;
    if (rid) url += `&root_id=${encodeURIComponent(rid)}`;
    return get(url, options);
}

export async function setProbeBackendMode(mode) {
    if (!mode || typeof mode !== "string") {
        return { ok: false, error: "Missing mode", code: "INVALID_INPUT" };
    }
    return post("/mjr/am/settings/probe-backend", { mode });
}

export async function getSecuritySettings() {
    return get("/mjr/am/settings/security");
}

export async function setSecuritySettings(prefs) {
    const body = prefs && typeof prefs === "object" ? prefs : {};
    return post("/mjr/am/settings/security", body);
}

export async function openInFolder(assetId) {
    return post("/mjr/am/open-in-folder", { asset_id: normalizeAssetId(assetId) });
}

export async function resetIndex(options = {}) {
    const _bool = (value, fallback) => (value === undefined || value === null ? fallback : Boolean(value));
    const scope = String(options.scope || "output").trim().toLowerCase() || "output";
    const customRootId =
        options.customRootId ??
        options.custom_root_id ??
        options.rootId ??
        options.root_id ??
        options.customRoot ??
        null;
      const body = {
          scope,
          reindex: _bool(options.reindex, true),
          // When scope=all, the backend defaults to a hard DB reset unless explicitly disabled.
          hard_reset_db: _bool(
              options.hardResetDb ??
              options.hard_reset_db ??
              options.deleteDbFiles ??
              options.delete_db_files ??
              options.deleteDb ??
              options.delete_db ??
              undefined,
              scope === "all"
          ),
          clear_scan_journal: _bool(options.clearScanJournal ?? options.clear_scan_journal, true),
          clear_metadata_cache: _bool(options.clearMetadataCache ?? options.clear_metadata_cache, true),
          clear_asset_metadata: _bool(options.clearAssetMetadata ?? options.clear_asset_metadata, true),
          clear_assets: _bool(options.clearAssets ?? options.clear_assets, true),
          rebuild_fts: _bool(options.rebuildFts ?? options.rebuild_fts, true),
        incremental: _bool(options.incremental, false),
        fast: _bool(options.fast, true),
        background_metadata: _bool(options.backgroundMetadata ?? options.background_metadata, true),
    };
    if (customRootId) {
        body.custom_root_id = String(customRootId);
    }
    return post(ENDPOINTS.INDEX_RESET, body);
}

export async function setWatcherScope({ scope = "output", customRootId = "" } = {}) {
    const s = String(scope || "output").trim().toLowerCase() || "output";
    const rid = String(customRootId || "").trim();
    const body = { scope: s };
    if (rid) body.custom_root_id = rid;
    return post(ENDPOINTS.WATCHER_SCOPE, body);
}

export async function getWatcherStatus() {
    return get(ENDPOINTS.WATCHER_STATUS);
}

export async function toggleWatcher(enabled = true) {
    return post(ENDPOINTS.WATCHER_TOGGLE, { enabled: !!enabled });
}

export async function getWatcherSettings() {
    return get(ENDPOINTS.WATCHER_SETTINGS);
}

export async function updateWatcherSettings(payload = {}) {
    return post(ENDPOINTS.WATCHER_SETTINGS, payload);
}

export async function getToolsStatus(options = {}) {
    return get(ENDPOINTS.TOOLS_STATUS, options);
}

/**
 * Best-effort database maintenance (PRAGMA optimize / ANALYZE).
 * Returns 200 even on degraded runs; check `ok/code`.
 */
/** @returns {Promise<ApiResult<{steps?: string[], degraded?: boolean}>>} */
export async function optimizeDb() {
    return post("/mjr/am/db/optimize", {});
}

/**
 * Emergency force-delete the SQLite database and recreate it.
 * Bypasses DB-dependent security checks (works even when DB is corrupted).
 * Closes connections, force-removes DB files from disk, reinitializes, and triggers a rescan.
 */
export async function forceDeleteDb() {
    return post("/mjr/am/db/force-delete", {});
}

export async function startDuplicatesAnalysis(limit = 250) {
    return post("/mjr/am/duplicates/analyze", { limit: Math.max(10, Math.min(5000, Number(limit) || 250)) });
}

export async function getDuplicateAlerts({ scope = "output", customRootId = "", maxGroups = 6, maxPairs = 10 } = {}) {
    let url = `/mjr/am/duplicates/alerts?scope=${encodeURIComponent(String(scope || "output"))}`;
    if (customRootId) {
        url += `&custom_root_id=${encodeURIComponent(String(customRootId))}`;
    }
    url += `&max_groups=${encodeURIComponent(String(Math.max(1, Number(maxGroups) || 6)))}`;
    url += `&max_pairs=${encodeURIComponent(String(Math.max(1, Number(maxPairs) || 10)))}`;
    return get(url);
}

export async function mergeDuplicateTags(keepAssetId, mergeAssetIds = []) {
    return post("/mjr/am/duplicates/merge-tags", {
        keep_asset_id: Number(keepAssetId) || 0,
        merge_asset_ids: Array.isArray(mergeAssetIds) ? mergeAssetIds.map((x) => Number(x) || 0).filter((x) => x > 0) : []
    });
}

export async function deleteAsset(assetId) {
    return post("/mjr/am/asset/delete", { asset_id: normalizeAssetId(assetId) });
}

export async function deleteAssets(assetIds) {
    return post("/mjr/am/assets/delete", { ids: assetIds });
}

export async function renameAsset(assetId, newName) {
    return post("/mjr/am/asset/rename", { asset_id: normalizeAssetId(assetId), new_name: newName });
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
