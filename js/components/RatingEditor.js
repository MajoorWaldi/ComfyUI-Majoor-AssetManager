/**
 * Rating Editor Component - Interactive star rating
 */

import { updateAssetRating } from "../api/client.js";
import { ASSET_RATING_CHANGED_EVENT } from "../app/events.js";
import { comfyToast } from "../app/toast.js";
import { t } from "../app/i18n.js";
import { getPopoverManagerForElement } from "../features/panel/views/popoverManager.js";
import { safeDispatchCustomEvent } from "../utils/events.js";
import { MENU_Z_INDEX } from "./contextmenu/MenuCore.js";

/**
 * Create interactive star rating editor
 * @param {Object} asset - Asset object with id and current rating
 * @param {Function} onUpdate - Callback when rating changes
 * @returns {HTMLElement}
 */
export function createRatingEditor(asset, onUpdate) {
    const container = document.createElement("div");
    container.className = "mjr-rating-editor";

    let currentRating = Math.max(0, Math.min(5, Number(asset.rating) || 0));
    let hoveredStar = 0;
    let savedRating = currentRating;
    let desiredRating = currentRating;
    let saving = false;
    let saveAC = null;

    try {
        container.setAttribute("role", "slider");
        container.setAttribute("aria-label", "Rating");
        container.setAttribute("aria-valuemin", "0");
        container.setAttribute("aria-valuemax", "5");
        container.setAttribute("aria-valuenow", String(currentRating));
        container.setAttribute("tabindex", "0");
    } catch {}

    const setDisabled = (disabled) => {
        try {
            for (const btn of container.querySelectorAll?.("button.mjr-rating-star") || []) {
                try {
                    btn.disabled = Boolean(disabled);
                } catch {}
            }
        } catch {}
    };

    const flushSaves = async () => {
        if (saving) return;
        saving = true;
        setDisabled(true);
        try {
            while (true) {
                const toSave = Math.max(0, Math.min(5, Number(desiredRating) || 0));
                const ac = typeof AbortController !== "undefined" ? new AbortController() : null;
                saveAC = ac;

                let result = null;
                try {
                    result = await updateAssetRating(asset, toSave, ac ? { signal: ac.signal } : {});
                } catch (err) {
                    console.error("Failed to update rating:", err);
                }

                if (!result?.ok) {
                    if (result?.code === "ABORTED" && desiredRating !== toSave) {
                        continue;
                    }
                    asset.rating = savedRating;
                    currentRating = savedRating;
                    desiredRating = savedRating;
                    updateStarColors(container, savedRating);
                    comfyToast(result?.error || t("toast.ratingUpdateFailed"), "error");
                    break;
                }

                try {
                    const newId = result?.data?.asset_id ?? null;
                    if (asset.id == null && newId != null) asset.id = newId;
                } catch {}

                savedRating = toSave;
                currentRating = toSave;
                asset.rating = toSave;

                try {
                    onUpdate?.(toSave);
                } catch {}
                safeDispatchCustomEvent(
                    ASSET_RATING_CHANGED_EVENT,
                    { assetId: String(asset.id), rating: toSave },
                    { warnPrefix: "[RatingEditor]" }
                );

                if (desiredRating === toSave) {
                    comfyToast(t("toast.ratingSetN", { n: toSave }), "success", 1000);
                    break;
                }
            }
        } catch {}

        try {
            saveAC = null;
        } catch {}
        saving = false;
        setDisabled(false);
    };

    // Create 5 stars
    for (let i = 1; i <= 5; i++) {
        const star = document.createElement("button");
        star.type = "button";
        star.className = "mjr-rating-star";
        star.textContent = "★";
        star.dataset.rating = String(i);
        try {
            star.setAttribute("aria-label", `Set rating ${i}`);
        } catch {}
        star.style.color = i <= currentRating ? "#FFD45A" : "#555";

        // Hover effects
        star.addEventListener("mouseenter", () => {
            hoveredStar = i;
            updateStarColors(container, hoveredStar);
        });

        star.addEventListener("mouseleave", () => {
            hoveredStar = 0;
            updateStarColors(container, currentRating);
        });

        // Click to set rating (coalesced + abortable)
        star.addEventListener("click", (e) => {
            e.stopPropagation();
            e.preventDefault();

            desiredRating = i;

            // Optimistic UI update.
            asset.rating = i;
            currentRating = i;
            updateStarColors(container, i);

            // Cancel in-flight request (best-effort) and save latest.
            try {
                saveAC?.abort?.();
            } catch {}
            flushSaves();
        });

        container.appendChild(star);
    }

    // Keyboard navigation for accessibility
    container.addEventListener("keydown", (e) => {
        if (saving) return;
        let newRating = currentRating;

        if (e.key === "ArrowRight" || e.key === "ArrowUp") {
            e.preventDefault();
            newRating = Math.min(5, currentRating + 1);
        } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
            e.preventDefault();
            newRating = Math.max(0, currentRating - 1);
        } else if (e.key === "Home") {
            e.preventDefault();
            newRating = 0;
        } else if (e.key === "End") {
            e.preventDefault();
            newRating = 5;
        } else if (e.key >= "0" && e.key <= "5") {
            e.preventDefault();
            newRating = parseInt(e.key, 10);
        } else {
            return;
        }

        if (newRating !== currentRating) {
            desiredRating = newRating;
            asset.rating = newRating;
            currentRating = newRating;
            updateStarColors(container, newRating);
            try {
                container.setAttribute("aria-valuenow", String(newRating));
            } catch {}
            try {
                saveAC?.abort?.();
            } catch {}
            flushSaves();
        }
    });

    // Allow external updates (e.g. hotkeys) to refresh the editor UI while keeping behavior consistent.
    try {
        container._mjrSetRating = (rating) => {
            const next = Math.max(0, Math.min(5, Number(rating) || 0));
            asset.rating = next;
            currentRating = next;
            updateStarColors(container, next);
            try {
                container.setAttribute("aria-valuenow", String(next));
            } catch {}
        };
    } catch {}

    return container;
}

/**
 * Update star colors based on rating
 */
function updateStarColors(container, rating) {
    const stars = container.querySelectorAll(".mjr-rating-star");
    stars.forEach((star, index) => {
        const starValue = index + 1;
        star.style.color = starValue <= rating ? "#FFD45A" : "#555";
        star.style.transform = starValue <= rating ? "scale(1.1)" : "scale(1)";
        try {
            star.setAttribute("aria-pressed", starValue <= rating ? "true" : "false");
        } catch {}
    });
}

/**
 * Show rating editor in a popover
 * @param {HTMLElement} anchor - Element to anchor popover to
 * @param {Object} asset - Asset object
 * @param {Function} onUpdate - Callback when rating changes
 */
export function showRatingPopover(anchor, asset, onUpdate) {
    const existing = document.querySelector(".mjr-rating-popover");
    if (existing) {
        try {
            existing.remove();
        } catch {}
    }

    const popover = document.createElement("div");
    popover.className = "mjr-popover mjr-rating-popover";

    const popovers = getPopoverManagerForElement(anchor);
    const host = anchor?.closest?.(".mjr-am-container") || null;

    const editor = createRatingEditor(asset, (newRating) => {
        try {
            onUpdate?.(newRating);
        } catch {}
        try {
            if (popover._mjrCloseTimer) clearTimeout(popover._mjrCloseTimer);
        } catch {}
        popover._mjrCloseTimer = setTimeout(() => {
            try {
                popovers?.close?.(popover);
            } catch {}
            try {
                popover.remove();
            } catch {}
            try {
                if (popover._mjrCloseTimer) clearTimeout(popover._mjrCloseTimer);
            } catch {}
            popover._mjrCloseTimer = null;
        }, 150);
    });

    popover.appendChild(editor);
    (host || document.body).appendChild(popover);
    popover.style.display = "block";

    if (popovers) {
        popovers.open(popover, anchor);
        return popover;
    }

    // Fallback positioning when used outside the Assets Manager panel.
    const rect = anchor.getBoundingClientRect();
    popover.style.position = "fixed";
    popover.style.top = `${rect.bottom + 8}px`;
    popover.style.left = `${rect.left}px`;
    popover.style.zIndex = String(MENU_Z_INDEX?.POPOVER ?? 10003);

    const closeOnClickOutside = (e) => {
        if (!popover.contains(e.target) && !anchor.contains(e.target)) {
            try {
                if (popover._mjrCloseTimer) clearTimeout(popover._mjrCloseTimer);
            } catch {}
            popover._mjrCloseTimer = null;
            try {
                popover.remove();
            } catch {}
            try {
                popover?._mjrDocClickAC?.abort?.();
            } catch {}
            popover._mjrDocClickAC = null;
            try {
                if (popover._mjrDocClickRAF != null) cancelAnimationFrame(popover._mjrDocClickRAF);
            } catch {}
            try {
                if (popover._mjrDocClickRAF2 != null) cancelAnimationFrame(popover._mjrDocClickRAF2);
            } catch {}
            popover._mjrDocClickRAF = null;
            popover._mjrDocClickRAF2 = null;
        }
    };
    try {
        const ac = typeof AbortController !== "undefined" ? new AbortController() : null;
        popover._mjrDocClickAC = ac;
        popover._mjrDocClickRAF = requestAnimationFrame(() => {
            popover._mjrDocClickRAF2 = requestAnimationFrame(() => {
                try {
                    popover._mjrDocClickRAF = null;
                    popover._mjrDocClickRAF2 = null;
                } catch {}
                try {
                    if (!popover.isConnected) {
                        ac?.abort?.();
                        return;
                    }
                    if (ac) document.addEventListener("click", closeOnClickOutside, { signal: ac.signal, capture: true });
                    else document.addEventListener("click", closeOnClickOutside, { capture: true });
                } catch {}
            });
        });
    } catch {
        try {
            document.addEventListener("click", closeOnClickOutside, { capture: true });
        } catch {}
    }
    return popover;
}
