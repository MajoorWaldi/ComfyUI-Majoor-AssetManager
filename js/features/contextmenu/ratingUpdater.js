import { updateAssetRating } from "../../api/client.js";
import { comfyToast } from "../../app/toast.js";
import { reportError } from "../../utils/logging.js";

const RATING_DELAY_MS = 350;
const _pending = new Map();

function _clearPending(assetId) {
    const entry = _pending.get(assetId);
    if (!entry) return;
    try {
        clearTimeout(entry.timer);
    } catch {}
    try {
        entry.controller?.abort?.();
    } catch {}
    _pending.delete(assetId);
}

export function cancelRatingUpdate(assetId) {
    if (!assetId) return;
    _clearPending(String(assetId));
}

export function cancelAllRatingUpdates() {
    for (const assetId of Array.from(_pending.keys())) {
        cancelRatingUpdate(assetId);
    }
}

export function scheduleRatingUpdate(assetId, rating, { onSuccess, onFailure, successMessage = null, errorMessage = null, warnPrefix = "[RatingUpdater]" } = {}) {
    if (!assetId) return;
    cancelRatingUpdate(assetId);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
        _pending.delete(String(assetId));
        try {
            const result = await updateAssetRating(assetId, rating, { signal: controller.signal });
            if (!result?.ok) {
                comfyToast(result?.error || errorMessage || "Failed to update rating", "error");
                onFailure?.(result);
                return;
            }
            if (successMessage) {
                comfyToast(successMessage, "success", 1500);
            }
            onSuccess?.(result);
        } catch (err) {
            reportError(err, warnPrefix, { showToast: true });
            onFailure?.(err);
        }
    }, RATING_DELAY_MS);
    _pending.set(String(assetId), { timer, controller });
}
