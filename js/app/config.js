/**
 * App Configuration
 */

import { get } from "../api/client.js";
import { ENDPOINTS } from "../api/endpoints.js";

// Cache for output directory
let outputDirectory = null;
let outputDirectoryAt = 0;
const OUTPUT_DIR_CACHE_TTL_MS = 30_000;

export function invalidateOutputDirectoryCache() {
    outputDirectory = null;
    outputDirectoryAt = 0;
}

/**
 * Get ComfyUI output directory
 * Cached after first fetch
 */
export async function getOutputDirectory() {
    try {
        const now = Date.now();
        if (outputDirectory && now - (outputDirectoryAt || 0) < OUTPUT_DIR_CACHE_TTL_MS) return outputDirectory;
    } catch {}

    const result = await get(ENDPOINTS.CONFIG);
    if (result.ok) {
        outputDirectory = result.data.output_directory;
        try {
            outputDirectoryAt = Date.now();
        } catch {}
        console.log("📂 Majoor [ℹ️]: Output directory:", outputDirectory);
        return outputDirectory;
    }

    console.error("📂 Majoor [❌]: Failed to get output directory");
    return "output"; // fallback
}

// App constants
export const APP_DEFAULTS = Object.freeze({
    // Debug / diagnostics (opt-in)
    DEBUG_SAFE_CALL: false,
    DEBUG_SAFE_LISTENERS: false,
    DEBUG_VIEWER: false,

    // Viewer
    VIEWER_ALLOW_PAN_AT_ZOOM_1: false,
    VIEWER_DISABLE_WEBGL_VIDEO: false,
    VIEWER_DISABLE_WEBGL_AUDIO: false,
    VIEWER_VIDEO_GRADE_THROTTLE_FPS: 15,
    VIEWER_AUDIO_VISUALIZER_MODE: "artistic", // simple|artistic
    VIEWER_AUDIO_VIS_FPS: 24,
    VIEWER_SCOPES_FPS: 10,

    // Grid
    GRID_MIN_SIZE: 120,
    GRID_GAP: 10,
    GRID_SHOW_BADGES_EXTENSION: true,
    GRID_SHOW_BADGES_RATING: true,
    GRID_SHOW_BADGES_TAGS: true,
    GRID_SHOW_DETAILS: true,
    GRID_SHOW_DETAILS_FILENAME: true,
    GRID_SHOW_DETAILS_DATE: true,
    GRID_SHOW_DETAILS_DIMENSIONS: true,
    GRID_SHOW_DETAILS_GENTIME: true,
    GRID_SHOW_WORKFLOW_DOT: true,

    // Badge colors
    BADGE_STAR_COLOR: "#FFD45A",
    BADGE_IMAGE_COLOR: "#2196F3",
    BADGE_VIDEO_COLOR: "#9C27B0",
    BADGE_AUDIO_COLOR: "#FF9800",
    BADGE_MODEL3D_COLOR: "#4CAF50",

    // Pagination
    DEFAULT_PAGE_SIZE: 100,
    // Upper bound for a single list request. The backend allows more, but very large
    // pages can create huge DOM batches; keep this as a safety cap.
    MAX_PAGE_SIZE: 2000,
    INFINITE_SCROLL_ENABLED: true,
    INFINITE_SCROLL_ROOT_MARGIN: "800px",
    INFINITE_SCROLL_THRESHOLD: 0.01,
    // Consider user "at bottom" when within this many pixels of the end.
    BOTTOM_GAP_PX: 80,

    // Polling
    STATUS_POLL_INTERVAL: 5000, // 5 seconds

    // Auto-scan on startup
    AUTO_SCAN_ON_STARTUP: true,

    // Rating/tags hydration (grid)
    RT_HYDRATE_CONCURRENCY: 2,
    RT_HYDRATE_QUEUE_MAX: 100,
    RT_HYDRATE_SEEN_MAX: 20000,
    RT_HYDRATE_PRUNE_BUDGET: 250,
    RT_HYDRATE_SEEN_TTL_MS: 10 * 60 * 1000,

    // Viewer metadata cache
    VIEWER_META_TTL_MS: 30_000,
    VIEWER_META_MAX_ENTRIES: 500,

    // Workflow Minimap
    WORKFLOW_MINIMAP_ENABLED: true,
    WATCHER_DEBOUNCE_MS: 500,
    WATCHER_DEDUPE_TTL_MS: 3000,
    // UI safety knobs
    DELETE_CONFIRMATION: true,
    DEBUG_VERBOSE_ERRORS: false,
});

// Runtime config (some values are user-tunable via settings).
export const APP_CONFIG = {
    ...APP_DEFAULTS,
};
