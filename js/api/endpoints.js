/**
 * API Endpoints - Centralized URL constants
 */

import { pickRootId } from "../utils/ids.js";

const DEFAULT_QUERY_LIMIT = 100;
const DEFAULT_QUERY_OFFSET = 0;

export const ENDPOINTS = {
    // Health & Config
    HEALTH: "/mjr/am/health",
    HEALTH_COUNTERS: "/mjr/am/health/counters",
    CONFIG: "/mjr/am/config",

    // Index & Search
    SCAN: "/mjr/am/scan",
    INDEX_FILES: "/mjr/am/index-files",
    INDEX_RESET: "/mjr/am/index/reset",
    DB_RESET: "/mjr/am/db/reset",
    SEARCH: "/mjr/am/search",
    LIST: "/mjr/am/list",
    ROOTS: "/mjr/am/roots",
    CUSTOM_ROOTS: "/mjr/am/custom-roots",
    CUSTOM_ROOTS_REMOVE: "/mjr/am/custom-roots/remove",

    // Metadata
    METADATA: "/mjr/am/metadata",
    WORKFLOW_QUICK: "/mjr/am/workflow-quick",
    RETRY_SERVICES: "/mjr/am/retry-services",
    STAGE_TO_INPUT: "/mjr/am/stage-to-input",
    OPEN_IN_FOLDER: "/mjr/am/open-in-folder",
    TOOLS_STATUS: "/mjr/am/tools/status",

    // View (ComfyUI native)
    VIEW: "/view",

    // Custom roots view (Majoor)
    CUSTOM_VIEW: "/mjr/am/custom-view",

    // Viewer helpers (Majoor)
    VIEWER_INFO: "/mjr/am/viewer/info",

    // File upload
    UPLOAD_INPUT: "/mjr/am/upload_input",

    // File download
    DOWNLOAD: "/mjr/am/download",

    // Drag-out (OS) helpers
    BATCH_ZIP_CREATE: "/mjr/am/batch-zip",

    // Calendar helpers
    DATE_HISTOGRAM: "/mjr/am/date-histogram",

    // Asset operations
    ASSET_DELETE: "/mjr/am/asset/delete",
    ASSET_RENAME: "/mjr/am/asset/rename",

    // Watcher
    WATCHER_STATUS: "/mjr/am/watcher/status",
    WATCHER_TOGGLE: "/mjr/am/watcher/toggle",
    WATCHER_SCOPE: "/mjr/am/watcher/scope",

    // Collections
    COLLECTIONS: "/mjr/am/collections"
};

/**
 * Build view URL for asset
 */
export function buildViewURL(filename, subfolder = null, type = "output") {
    let url = `${ENDPOINTS.VIEW}?filename=${encodeURIComponent(filename)}`;
    if (subfolder) {
        url += `&subfolder=${encodeURIComponent(subfolder)}`;
    }
    url += `&type=${encodeURIComponent(type)}`;
    return url;
}

/**
 * Build list URL with scope support.
 */
export function buildListURL(params = {}) {
    const {
        q = "*",
        limit = DEFAULT_QUERY_LIMIT,
        offset = DEFAULT_QUERY_OFFSET,
        scope = "output",
        subfolder = "",
        customRootId = null,
        kind = null,
        hasWorkflow = null,
        minRating = null,
        dateRange = null,
        dateExact = null,
        includeTotal = true
    } = params;

    let url = `${ENDPOINTS.LIST}?q=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}&scope=${encodeURIComponent(scope)}`;
    if (subfolder) {
        url += `&subfolder=${encodeURIComponent(subfolder)}`;
    }
    if (customRootId) {
        url += `&custom_root_id=${encodeURIComponent(customRootId)}`;
    }
    if (kind) {
        url += `&kind=${encodeURIComponent(kind)}`;
    }
    if (hasWorkflow !== null && hasWorkflow !== undefined) {
        url += `&has_workflow=${encodeURIComponent(hasWorkflow ? "true" : "false")}`;
    }
    if (minRating !== null && minRating !== undefined && Number(minRating) > 0) {
        url += `&min_rating=${encodeURIComponent(String(minRating))}`;
    }
    if (dateRange) {
        url += `&date_range=${encodeURIComponent(dateRange)}`;
    }
    if (dateExact) {
        url += `&date_exact=${encodeURIComponent(dateExact)}`;
    }
    if (includeTotal === false) {
        url += `&include_total=0`;
    }
    return url;
}

export function buildCustomViewURL(filename, subfolder = "", rootId = "") {
    let url = `${ENDPOINTS.CUSTOM_VIEW}?root_id=${encodeURIComponent(rootId)}&filename=${encodeURIComponent(filename)}`;
    if (subfolder) {
        url += `&subfolder=${encodeURIComponent(subfolder)}`;
    }
    return url;
}

export function buildBatchZipDownloadURL(token) {
    return `${ENDPOINTS.BATCH_ZIP_CREATE}/${encodeURIComponent(String(token || ""))}`;
}

export function buildDateHistogramURL(params = {}) {
    const {
        scope = "output",
        customRootId = null,
        month = "",
        kind = null,
        hasWorkflow = null,
        minRating = null
    } = params;

    let url = `${ENDPOINTS.DATE_HISTOGRAM}?scope=${encodeURIComponent(scope)}&month=${encodeURIComponent(String(month || ""))}`;
    if (customRootId) {
        url += `&custom_root_id=${encodeURIComponent(customRootId)}`;
    }
    if (kind) {
        url += `&kind=${encodeURIComponent(kind)}`;
    }
    if (hasWorkflow !== null && hasWorkflow !== undefined) {
        url += `&has_workflow=${encodeURIComponent(hasWorkflow ? "true" : "false")}`;
    }
    if (minRating !== null && minRating !== undefined && Number(minRating) > 0) {
        url += `&min_rating=${encodeURIComponent(String(minRating))}`;
    }
    return url;
}

export function buildAssetViewURL(asset) {
    const type = (asset?.type || "output").toLowerCase();
    if (type === "custom") {
        return buildCustomViewURL(asset?.filename || "", asset?.subfolder || "", pickRootId(asset));
    }
    if (type === "input") {
        return buildViewURL(asset?.filename || "", asset?.subfolder || "", "input");
    }
    return buildViewURL(asset?.filename || "", asset?.subfolder || "", "output");
}

/**
 * Build search URL with query params
 */
export function buildSearchURL(params = {}) {
    const { q = "*", limit = DEFAULT_QUERY_LIMIT, offset = DEFAULT_QUERY_OFFSET } = params;
    return `${ENDPOINTS.SEARCH}?q=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}`;
}

/**
 * Build download URL for asset
 */
export function buildDownloadURL(filepath) {
    if (!filepath) return "";
    return `${ENDPOINTS.DOWNLOAD}?filepath=${encodeURIComponent(filepath)}`;
}
