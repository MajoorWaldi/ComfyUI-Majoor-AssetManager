import { APP_CONFIG } from "../app/config.js";
import { comfyToast } from "../app/toast.js";

export function reportError(err, context = "Majoor", { showToast = false, toastType = "error" } = {}) {
    const message = err?.message || String(err || "Unknown error");
    try {
        if (APP_CONFIG.DEBUG_VERBOSE_ERRORS) {
            console.error(`[Majoor][${context}]`, message, err);
        } else {
            console.debug(`[Majoor][${context}]`, message);
        }
    } catch {}
    if (showToast && APP_CONFIG.DEBUG_VERBOSE_ERRORS) {
        try {
            comfyToast(`${context}: ${message}`, toastType, 4000);
        } catch {}
    }
}
