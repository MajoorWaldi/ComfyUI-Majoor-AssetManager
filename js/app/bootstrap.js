/**
 * Bootstrap - Auto-scan and initialization
 */

import { get, post } from "../api/client.js";
import { ENDPOINTS } from "../api/endpoints.js";
import { APP_CONFIG } from "./config.js";

// Auto-scan state (once per session)
let startupScanDone = false;

/**
 * Trigger background scan as soon as the ComfyUI frontend loads (if enabled).
 * This helps warming the DB before the Assets Manager panel is opened.
 */
export async function triggerStartupScan() {
    if (!APP_CONFIG || typeof APP_CONFIG !== "object") return;
    if (!APP_CONFIG.AUTO_SCAN_ON_STARTUP) return;
    if (startupScanDone) return;
    startupScanDone = true;

    try {
        console.log("📂 Majoor [ℹ️]: Starting startup scan of output directory...");

        const result = await post(ENDPOINTS.SCAN, {
            recursive: true,
            incremental: true,
            fast: true,
            background_metadata: true
        });

        if (result.ok) {
            const stats = result.data;
            console.log(`📂 Majoor [✅]: Startup scan complete! Added: ${stats.added}, Updated: ${stats.updated}, Skipped: ${stats.skipped}`);
        } else {
            console.warn("📂 Majoor [⚠️]: Startup scan failed:", result.error);
        }
    } catch (error) {
        console.error("📂 Majoor [❌]: Startup scan error:", error);
    }
}

/**
 * Test API connection
 */
export async function testAPI() {
    try {
        console.log("📂 Majoor: Testing API connection...");
        const data = await get(ENDPOINTS.HEALTH);

        if (data?.ok) {
            console.log("📂 Majoor [✅]: API connection successful!");
            console.log("📂 Majoor [ℹ️]: Health status:", data.data.overall);
        } else {
            console.error("📂 Majoor [❌]: API health check failed:", data?.error);
        }
    } catch (error) {
        console.error("📂 Majoor [❌]: Failed to connect to API:", error);
    }
}
