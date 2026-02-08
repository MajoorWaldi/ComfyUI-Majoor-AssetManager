import { updateAssetRating } from "../../../api/client.js";
import { ASSET_RATING_CHANGED_EVENT } from "../../../app/events.js";
import { comfyToast } from "../../../app/toast.js";
import { t } from "../../../app/i18n.js";

const EVENT_NAME = ASSET_RATING_CHANGED_EVENT;

function getSelectedCards(gridContainer, fallbackEventTarget = null) {
    if (!gridContainer) return [];
    try {
        const selected = Array.from(gridContainer.querySelectorAll(".mjr-asset-card.is-selected"));
        if (selected.length) return selected;
    } catch {}

    try {
        const card = fallbackEventTarget?.closest?.(".mjr-asset-card");
        if (card && gridContainer.contains(card)) return [card];
    } catch {}

    return [];
}

function updateCardRatingBadge(card, createRatingBadge, rating) {
    if (!card) return;
    const asset = card._mjrAsset;
    if (asset) asset.rating = rating;

    try {
        const thumb = card.querySelector(".mjr-thumb");
        if (!thumb) return;
        const oldRatingBadge = card.querySelector(".mjr-rating-badge");
        const newBadge = createRatingBadge ? createRatingBadge(rating || 0) : null;

        if (oldRatingBadge && newBadge) {
            oldRatingBadge.replaceWith(newBadge);
        } else if (oldRatingBadge && !newBadge) {
            oldRatingBadge.remove();
        } else if (!oldRatingBadge && newBadge) {
            thumb.appendChild(newBadge);
        }
    } catch {}
}

export function createRatingHotkeysController({ gridContainer, createRatingBadge } = {}) {
    let bound = false;
    let onKeyDown = null;
    let onRatingEvent = null;

    const applyRatingToCard = async (card, rating) => {
        const asset = card?._mjrAsset;
        const assetId = asset?.id;
        if (assetId == null) return;

        try {
            const result = await updateAssetRating(assetId, rating);
            if (!result?.ok) {
                comfyToast(result?.error || t("toast.ratingUpdateFailed"), "error");
                return;
            }
            comfyToast(t("toast.ratingSetN", { n: rating }), "success", 1500);
        } catch {
            comfyToast(t("toast.ratingUpdateError"), "error");
            return;
        }

        updateCardRatingBadge(card, createRatingBadge, rating);
    };

    const bind = () => {
        if (bound || !gridContainer) return;
        bound = true;

        onKeyDown = async (e) => {
            // Check if hotkeys are suspended (e.g. when dialogs/popovers are open)
            if (window._mjrHotkeysState?.suspended) return;

            // Check if viewer has hotkey priority
            if (window._mjrHotkeysState?.scope === "viewer") return;

            if (e.defaultPrevented) return;
            const k = String(e.key || "");

            if (k !== "0" && k !== "1" && k !== "2" && k !== "3" && k !== "4" && k !== "5") return;

            // Check if viewer is open - let it handle rating keys
            const viewerOverlay = document.querySelector('.mjr-viewer-overlay');
            if (viewerOverlay && viewerOverlay.style.display !== 'none') return;

            // Check if the event target is within our grid container or if the grid container itself has focus/hover
            // This ensures rating hotkeys only work when interacting with the assets manager
            const isTargetInGrid = gridContainer.contains(e.target) || gridContainer === e.target;
            if (!isTargetInGrid) return; // Only handle rating keys when interacting with our grid

            const rating = k === "0" ? 0 : Number(k);
            if (!Number.isFinite(rating)) return;

            const cards = getSelectedCards(gridContainer, e.target);
            if (!cards.length) return;

            // Only prevent default and stop propagation if we're actually handling the key
            if (cards.length > 0) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation?.();
            }

            // Apply sequentially to avoid hammering the backend on large multi-select.
            for (const card of cards) {
                await applyRatingToCard(card, rating);
            }
        };

        onRatingEvent = (ev) => {
            const detail = ev?.detail || {};
            const assetId = detail.assetId ?? detail.id ?? null;
            const rating = Number(detail.rating);
            if (!assetId || !Number.isFinite(rating)) return;
            try {
                const card = gridContainer.querySelector(
                    `.mjr-asset-card[data-mjr-asset-id="${CSS?.escape ? CSS.escape(String(assetId)) : String(assetId)}"]`
                );
                if (card) updateCardRatingBadge(card, createRatingBadge, rating);
            } catch {}
        };

        try {
            // Use window-level listener with capture phase to ensure it works regardless of focus
            window.addEventListener("keydown", onKeyDown, { capture: true });
        } catch {}
        try {
            window.addEventListener(EVENT_NAME, onRatingEvent);
        } catch {}
    };

    const dispose = () => {
        if (!bound) return;
        bound = false;
        try {
            // Remove window-level listener
            window.removeEventListener("keydown", onKeyDown, { capture: true });
        } catch {}
        try {
            window.removeEventListener(EVENT_NAME, onRatingEvent);
        } catch {}
        onKeyDown = null;
        onRatingEvent = null;
    };

    return { bind, dispose };
}

export const RATING_EVENT_NAME = EVENT_NAME;
