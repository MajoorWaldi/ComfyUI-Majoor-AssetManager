/**
 * App Configuration
 */

import { get } from "../api/client.js";
import { ENDPOINTS } from "../api/endpoints.js";

// Cache for output directory
let outputDirectory = null;

/**
 * Get ComfyUI output directory
 * Cached after first fetch
 */
export async function getOutputDirectory() {
    if (outputDirectory) return outputDirectory;

    const result = await get(ENDPOINTS.CONFIG);
    if (result.ok) {
        outputDirectory = result.data.output_directory;
        console.log("📂 Majoor [ℹ️]: Output directory:", outputDirectory);
        return outputDirectory;
    }

    console.error("📂 Majoor [❌]: Failed to get output directory");
    return "output"; // fallback
}

// App constants
export const APP_CONFIG = {
    // Grid
    GRID_MIN_SIZE: 120,
    GRID_GAP: 10,

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

    // Auto-scan
    AUTO_SCAN_ENABLED: true,
    AUTO_SCAN_ON_STARTUP: false,

    // Rating/tags hydration (grid)
    RT_HYDRATE_CONCURRENCY: 2,
    RT_HYDRATE_SEEN_MAX: 20000,
    RT_HYDRATE_PRUNE_BUDGET: 250,
    RT_HYDRATE_SEEN_TTL_MS: 10 * 60 * 1000,

    // Viewer metadata cache
    VIEWER_META_TTL_MS: 30_000,
    VIEWER_META_MAX_ENTRIES: 500
};
