/**
 * Grid View Feature - Asset grid display
 */

import { get, hydrateAssetRatingTags } from "../../api/client.js";
import { buildListURL } from "../../api/endpoints.js";
import { createAssetCard, cleanupVideoThumbsIn, cleanupCardMediaHandlers } from "../../components/Card.js";
import { createRatingBadge, createTagsBadge, setFileBadgeCollision } from "../../components/Badges.js";
import { APP_CONFIG } from "../../app/config.js";
import { getViewerInstance } from "../../components/Viewer.js";
// Context menus are bound by the panel (GridContextMenu) to avoid duplicate handlers.
import { ASSET_RATING_CHANGED_EVENT, ASSET_TAGS_CHANGED_EVENT } from "../../app/events.js";
import { safeDispatchCustomEvent } from "../../utils/events.js";
import { pickRootId } from "../../utils/ids.js";
import { bindAssetDragStart } from "../dnd/DragDrop.js";
import { loadMajoorSettings } from "../../app/settings.js";
import { VirtualGrid } from "./VirtualGrid.js";
import { installGridKeyboard } from "./GridKeyboard.js";

/** 
 * Strict typing for State management 
 * @typedef {Object} GridState
 * @property {string} query Current search string
 * @property {number} offset Pagination offset
 * @property {number|null} total Total items on server
 * @property {boolean} loading Is fetch in progress
 * @property {boolean} done Is pagination exhausted
 * @property {Set<string>} seenKeys Identifiers to prevent duplicates
 * @property {Array<Object>} assets Array of Asset objects (Data Store)
 * @property {Map<string, number>} filenameCounts Collision detection map
 * @property {Set<string>} nonImageStems Logic for hiding PNG siblings
 * @property {Map<string, Array<Object>>} stemMap Logic for hiding PNG siblings
 * @property {Map<string, Array<HTMLElement>>} renderedFilenameMap Live DOM references
 * @property {VirtualGrid|null} virtualGrid The virtual renderer instance
 * @property {HTMLElement|null} sentinel Infinite scroll trigger
 * @property {IntersectionObserver|null} observer Infinite scroll observer
 */
/** @type {WeakMap<HTMLElement, GridState>} */
const GRID_STATE = new WeakMap();

const RT_HYDRATE_CONCURRENCY = APP_CONFIG.RT_HYDRATE_CONCURRENCY ?? 2;
const RT_HYDRATE_QUEUE_MAX = APP_CONFIG.RT_HYDRATE_QUEUE_MAX ?? 100;
// Globals removed to prevent cross-grid contamination
const RT_HYDRATE_SEEN_MAX = APP_CONFIG.RT_HYDRATE_SEEN_MAX ?? 20000;
const RT_HYDRATE_SEEN_TTL_MS = APP_CONFIG.RT_HYDRATE_SEEN_TTL_MS ?? (10 * 60 * 1000);
let rtHydrateSeenPruneBudget = 0;
// RT_HYDRATE_STATE remains as the per-grid state map
const RT_HYDRATE_STATE = new WeakMap(); // gridContainer -> { queue, inflight, seen, active, lastPruneAt }

// ─────────────────────────────────────────────────────────────────────────────
// Upsert Batching - Accumulate upserts and flush once for performance
// ─────────────────────────────────────────────────────────────────────────────
const UPSERT_BATCH_DEBOUNCE_MS = 50;     // Debounce window for batch flush
const UPSERT_BATCH_MAX_SIZE = 50;        // Max items before forced flush
const UPSERT_BATCH_STATE = new WeakMap(); // gridContainer -> { pending: Map<id, asset>, timer: number|null }

// Temporary debug logging for grid + infinite scroll.
// Enable at runtime from the browser console:
//   globalThis._mjrDebugGrid = true
const _gridDebugEnabled = () => {
    try {
        return !!globalThis?._mjrDebugGrid;
    } catch {
        return false;
    }
};

const gridDebug = (...args) => {
    try {
        if (!_gridDebugEnabled()) return;
        console.log("[Majoor][Grid]", ...args);
    } catch {}
};

/**
 * Get hydration state for a grid.
 * @param {HTMLElement} gridContainer 
 * @returns {{queue: any[], inflight: number, seen: Set<string>, active: Set<string>, lastPruneAt: number}|null}
 */
function _getRtHydrateState(gridContainer) {
    try {
        if (!gridContainer) return null;
        let s = RT_HYDRATE_STATE.get(gridContainer);
        if (!s) {
            s = { 
                queue: [], 
                inflight: 0,
                seen: new Set(),
                active: new Set(),
                lastPruneAt: 0
            };
            RT_HYDRATE_STATE.set(gridContainer, s);
        }
        return s;
    } catch {
        return null;
    }
}

function pruneRatingTagsHydrateSeen(st) {
    if (!st || !st.seen) return;
    const now = Date.now();
    const needsSizePrune = st.seen.size > RT_HYDRATE_SEEN_MAX;
    const needsTimePrune =
        st.lastPruneAt > 0
        && (now - st.lastPruneAt) > RT_HYDRATE_SEEN_TTL_MS
        && st.seen.size > Math.max(1000, Math.floor(RT_HYDRATE_SEEN_MAX / 4));

    if (!needsSizePrune && !needsTimePrune) return;
    if (rtHydrateSeenPruneBudget > 0) {
        rtHydrateSeenPruneBudget -= 1;
        return;
    }
    
    // Simple prune: clear all if oversize (easiest logic for set) -> actually Set doesn't sort by time.
    // If we want LRU we need Map. But here we just clear or we accept unbounded growth until hard reset.
    // Logic: if too big or too old, clear it.
    st.seen.clear();
    st.lastPruneAt = now;
}

function _updateCardRatingTagsBadges(card, rating, tags) {
    if (!card) return;
    try {
        if (!card.isConnected) return;
    } catch {}
    const thumb = card.querySelector?.(".mjr-thumb");
    if (!thumb) return;

    const oldRatingBadge = thumb.querySelector?.(".mjr-rating-badge");
    const ratingValue = Math.max(0, Math.min(5, Number(rating) || 0));
    if (ratingValue <= 0) {
        try {
            oldRatingBadge?.remove?.();
        } catch {}
    } else if (!oldRatingBadge) {
        const nextRatingBadge = createRatingBadge(ratingValue);
        if (nextRatingBadge) thumb.appendChild(nextRatingBadge);
    } else {
        // Update in place to avoid full DOM replacement.
        try {
            const cur = oldRatingBadge.querySelectorAll?.("span")?.length || 0;
            if (cur !== ratingValue) {
                const stars = [];
                for (let i = 0; i < ratingValue; i++) {
                    const star = document.createElement("span");
                    star.textContent = "★";
                    star.style.color = "var(--mjr-star-active, #FFD45A)";
                    star.style.marginRight = i < ratingValue - 1 ? "2px" : "0";
                    stars.push(star);
                }
                oldRatingBadge.replaceChildren(...stars);
            }
        } catch {}
    }

    const oldTagsBadge = thumb.querySelector?.(".mjr-tags-badge");
    if (oldTagsBadge) {
        if (Array.isArray(tags) && tags.length) {
            oldTagsBadge.textContent = tags.join(", ");
            oldTagsBadge.style.display = "";
        } else {
            oldTagsBadge.textContent = "";
            oldTagsBadge.style.display = "none";
        }
    } else {
        const nextTagsBadge = createTagsBadge(Array.isArray(tags) ? tags : []);
        thumb.appendChild(nextTagsBadge);
    }
}

function _pumpRatingTagsHydration(gridContainer) {
    const st = _getRtHydrateState(gridContainer);
    if (!st) return;
    while (st.inflight < RT_HYDRATE_CONCURRENCY && st.queue.length) {
        const job = st.queue.shift();
        if (!job) break;
        st.inflight += 1;
        (async () => {
            const res = await hydrateAssetRatingTags(job.id);
            if (!res || !res.ok || !res.data) return;
            const updated = res.data;
            const rating = Number(updated.rating || 0) || 0;
            const tags = Array.isArray(updated.tags) ? updated.tags : [];

            try {
                if (job.asset) {
                    job.asset.rating = rating;
                    job.asset.tags = tags;
                }
            } catch {}

            _updateCardRatingTagsBadges(job.card, rating, tags);

            safeDispatchCustomEvent(
                ASSET_RATING_CHANGED_EVENT,
                { assetId: String(job.id), rating },
                { warnPrefix: "[GridView]" }
            );
            safeDispatchCustomEvent(
                ASSET_TAGS_CHANGED_EVENT,
                { assetId: String(job.id), tags },
                { warnPrefix: "[GridView]" }
            );
        })()
            .catch(() => null)
            .finally(() => {
                try {
                    st.active.delete(String(job.id));
                } catch {}
                st.inflight -= 1;
                _pumpRatingTagsHydration(gridContainer);
            });
    }
}

function enqueueRatingTagsHydration(gridContainer, card, asset) {
    const id = asset?.id != null ? String(asset.id) : "";
    if (!id) return;
    const st = _getRtHydrateState(gridContainer);
    if (!st) return;

    if (st.seen.has(id)) return;

    const rating = Number(asset?.rating || 0) || 0;
    const tags = asset?.tags;
    const tagsEmpty = !(Array.isArray(tags) && tags.length);
    if (rating > 0 && !tagsEmpty) {
        st.seen.add(id);
        return;
    }

    // Hydrate only when both are missing in DB (avoid extra IO).
    if (rating > 0 || !tagsEmpty) {
        st.seen.add(id);
        return;
    }

    // Keep queue bounded to avoid unbounded memory growth on large libraries.
    try {
        while (st.queue.length >= RT_HYDRATE_QUEUE_MAX) {
            const dropped = st.queue.shift();
            try {
                if (dropped?.id) st.active.delete(String(dropped.id));
            } catch {}
            try {
                if (dropped?.id) st.seen.delete(String(dropped.id));
            } catch {}
        }
    } catch {}

    st.seen.add(id);
    pruneRatingTagsHydrateSeen(st);
    try {
        st.active.add(id);
    } catch {}
    st.queue.push({ id, card, asset });
    _pumpRatingTagsHydration(gridContainer);
}

/**
 * Update grid CSS classes based on current settings.
 * Allows instant toggling of card elements (Filename, Dimensions, etc.) via CSS
 * without rebuilding the DOM.
 */
function _updateGridSettingsClasses(container) {
    if (!container) return;
    
    // Inject dynamic styles if not present (ensures reactivity behaves correctly)
    const styleId = "mjr-grid-settings-styles";
    if (!document.getElementById(styleId)) {
        const style = document.createElement("style");
        style.id = styleId;
        style.textContent = `
            /* Reactive visibility toggles */
            /* Ensure card uses flex column to fill space when info is hidden */
            .mjr-grid .mjr-asset-card, 
            .mjr-grid .mjr-card {
                display: flex;
                flex-direction: column;
            }
            /* Thumb grows to fill available space */
            .mjr-grid .mjr-thumb {
                flex: 1;
                min-height: 0;
                position: relative;
                overflow: hidden;
            }
            /* Ensure media fills the thumb container */
            .mjr-grid .mjr-thumb-media {
                width: 100%;
                height: 100%;
                object-fit: cover;
                display: block;
            }

            .mjr-grid .mjr-card-filename { display: none; }
            .mjr-grid.mjr-show-filename .mjr-card-filename { display: block; }
            
            .mjr-grid .mjr-card-dot-wrapper { display: none; }
            .mjr-grid.mjr-show-dot .mjr-card-dot-wrapper { display: inline-flex; }

            .mjr-grid .mjr-meta-res { display: none; }
            .mjr-grid.mjr-show-dimensions .mjr-meta-res { display: inline; }

            .mjr-grid .mjr-meta-duration { display: none; }
            .mjr-grid.mjr-show-dimensions .mjr-meta-duration { display: inline; }

            .mjr-grid .mjr-meta-date { display: none; }
            .mjr-grid.mjr-show-date .mjr-meta-date { display: inline; }

            .mjr-grid .mjr-meta-gentime { display: none; }
            .mjr-grid.mjr-show-gentime .mjr-meta-gentime { display: inline; }

            .mjr-grid .mjr-badge-ext { display: none !important; }
            .mjr-grid.mjr-show-badges-ext .mjr-badge-ext { display: flex !important; }

            .mjr-grid .mjr-badge-rating { display: none !important; }
            .mjr-grid.mjr-show-badges-rating .mjr-badge-rating { display: flex !important; }

            .mjr-grid .mjr-badge-tags { display: none !important; }
            .mjr-grid.mjr-show-badges-tags .mjr-badge-tags { display: flex !important; }
            
            /* Info container management */
            /* Default to hidden to prevent flash or "black box" if js is slow */
            .mjr-grid .mjr-card-info { display: none !important; }
            /* Only show when explicitly enabled */
            .mjr-grid.mjr-show-details .mjr-card-info { display: block !important; }

            /* Separator management (experimental) */
            /* If we want separators like " • ", we can use CSS pseudo-elements instead of text nodes */
            .mjr-card-meta-row > span + span::before {
                content: " • ";
                opacity: 0.5;
                margin: 0 4px;
            }
            // Hide separator if previous element is hidden
            .mjr-card-meta-row > span[style*="display: none"] + span::before {
                 display: none;
            }
        `;
        document.head.appendChild(style);
    }
    
    // Helper to toggle class based on config bool
    const toggle = (cls, enabled) => {
        if (enabled) container.classList.add(cls);
        else container.classList.remove(cls);
    };

    toggle("mjr-show-filename", APP_CONFIG.GRID_SHOW_DETAILS_FILENAME);
    toggle("mjr-show-dimensions", APP_CONFIG.GRID_SHOW_DETAILS_DIMENSIONS);
    toggle("mjr-show-date", APP_CONFIG.GRID_SHOW_DETAILS_DATE);
    toggle("mjr-show-gentime", APP_CONFIG.GRID_SHOW_DETAILS_GENTIME);
    // toggle("mjr-show-time", APP_CONFIG.GRID_SHOW_DETAILS_TIME); // If we add explicit time setting
    toggle("mjr-show-dot", APP_CONFIG.GRID_SHOW_WORKFLOW_DOT);
    
    toggle("mjr-show-badges-ext", APP_CONFIG.GRID_SHOW_BADGES_EXTENSION);
    toggle("mjr-show-badges-rating", APP_CONFIG.GRID_SHOW_BADGES_RATING);
    toggle("mjr-show-badges-tags", APP_CONFIG.GRID_SHOW_BADGES_TAGS);
    
    // Overall details vs generic show
    toggle("mjr-show-details", APP_CONFIG.GRID_SHOW_DETAILS);
    
    // Helper for CSS vars
    container.style.setProperty("--mjr-grid-min-size", `${APP_CONFIG.GRID_MIN_SIZE}px`);
    container.style.setProperty("--mjr-grid-gap", `${APP_CONFIG.GRID_GAP}px`);
}

/**
 * Create grid container
 * @returns {HTMLElement} The configured grid container
 */
export function createGridContainer() {
    const container = document.createElement("div");
    container.id = "mjr-assets-grid";
    container.classList.add("mjr-grid");

    // Provide a stable accessor for full asset lists (VirtualGrid-safe).
    try {
        container._mjrGetAssets = () => {
            try {
                const state = GRID_STATE.get(container);
                return Array.isArray(state?.assets) ? state.assets : [];
            } catch {
                return [];
            }
        };
    } catch {}
    try {
        container._mjrSetSelection = (ids, activeId = "") => setSelectionIds(container, ids, { activeId });
        container._mjrSyncSelection = (ids) => syncSelectionClasses(container, ids);
    } catch {}
    
    // Initial class application
    _updateGridSettingsClasses(container);

    // Listen for settings changes to update CSS classes reactively
    const onSettingsChanged = () => {
        requestAnimationFrame(() => _updateGridSettingsClasses(container));
    };
    
    // We bind to the custom event dispatched by settings.js
    // Note: The event is dispatched on `window` usually via safeDispatchCustomEvent
    try {
        window.addEventListener("mjr-settings-changed", onSettingsChanged);
        // Store cleanup function on container for disposeGrid
        container._mjrSettingsChangedCleanup = () => {
            try {
                window.removeEventListener("mjr-settings-changed", onSettingsChanged);
            } catch {}
        };
    } catch {}

    // Bind delegated dragstart once (avoid per-card listeners; improves load perf on large grids).
    try {
        bindAssetDragStart(container);
    } catch {}

    // Install grid keyboard shortcuts
    try {
        const kbd = installGridKeyboard({
            gridContainer: container,
            getState: () => GRID_STATE.get(container) || {},
            getSelectedAssets: () => {
                try {
                    const state = GRID_STATE.get(container);
                    if (state?.assets) {
                        const ids = getSelectedIdSet(container);
                        return state.assets.filter(a => ids.has(String(a.id)));
                    }
                    // @ts-ignore
                    return Array.from(container.querySelectorAll('.mjr-asset-card.is-selected')).map(c => c._mjrAsset).filter(Boolean);
                } catch { return []; }
            },
            getActiveAsset: () => {
                // @ts-ignore
                return document.activeElement?.closest?.('.mjr-asset-card')?._mjrAsset || null;
            },
            onAssetChanged: (asset) => {
                 if (!asset?.id) return;
                 const id = String(asset.id);
                 const cards = Array.from(container.querySelectorAll(`.mjr-asset-card`));
                 for (const card of cards) {
                     // @ts-ignore
                     if (String(card?._mjrAsset?.id) === id) {
                         // @ts-ignore
                         _updateCardRatingTagsBadges(card, asset.rating, asset.tags);
                     }
                 }
            },
            onOpenDetails: () => {
                 safeDispatchCustomEvent('mjr:open-sidebar', { tab: 'details' });
            }
        });
        kbd.bind();
        // @ts-ignore
        container._mjrGridKeyboard = kbd;
    } catch (e) {
        console.error("Failed to install grid keyboard", e);
    }

    // Bind double-click to open viewer
    container.addEventListener('dblclick', (e) => {
        /** @type {HTMLElement} */
        // @ts-ignore
        const card = e.target.closest('.mjr-asset-card');
        if (!card) return;

        /** @type {Object} */
        // @ts-ignore
        const asset = card._mjrAsset;
        if (!asset) return;

        // Get all assets in current grid for navigation
        let allAssets, currentIndex;
        
        // Use state.assets if available (VirtualGrid support)
        const state = GRID_STATE.get(container);
        if (state && state.assets && state.assets.length > 0) {
             allAssets = state.assets;
             currentIndex = allAssets.findIndex(a => a.id === asset.id);
        } else {
             // Fallback to DOM (legacy)
             const allCards = Array.from(container.querySelectorAll('.mjr-asset-card'));
             // @ts-ignore
             allAssets = allCards.map(c => c._mjrAsset).filter(Boolean);
             currentIndex = allAssets.findIndex(a => a.id === asset.id);
        }

        // Open viewer
        const viewer = getViewerInstance();
        viewer.open(allAssets, currentIndex);
    });

    return container;
}

const OVERLAY_CLASS = "mjr-grid-loading-overlay";
const SENTINEL_CLASS = "mjr-grid-sentinel";

function showLoadingOverlay(gridContainer, message = "Loading assets...") {
    let overlay = gridContainer.querySelector(`.${OVERLAY_CLASS}`);
    if (!overlay) {
        overlay = document.createElement("div");
        overlay.className = OVERLAY_CLASS;
    }
    overlay.textContent = message;
    if (!gridContainer.contains(overlay)) {
        gridContainer.appendChild(overlay);
    }
    overlay.style.display = "flex";
    // Ensure the overlay is visible even when the grid is empty/collapsed.
    if (!gridContainer.style.minHeight) {
        gridContainer.style.minHeight = "160px";
    }
}

function hideLoadingOverlay(gridContainer) {
    const overlay = gridContainer.querySelector(`.${OVERLAY_CLASS}`);
    if (overlay) {
        overlay.remove();
    }
    try {
        if (gridContainer.style.minHeight === "160px") {
            gridContainer.style.minHeight = "";
        }
    } catch {}
}

const GRID_MESSAGE_CLASS = "mjr-grid-message";

function clearGridMessage(gridContainer) {
    if (!gridContainer) return;
    try {
        const existing = gridContainer.querySelectorAll?.(`.${GRID_MESSAGE_CLASS}`) || [];
        for (const el of existing) {
            try {
                el.remove();
            } catch {}
        }
    } catch {}
}

function setGridMessage(gridContainer, text, { error = false } = {}) {
    if (!gridContainer) return;
    clearGridMessage(gridContainer);
    try {
        const msg = document.createElement("div");
        msg.className = GRID_MESSAGE_CLASS;
        msg.textContent = String(text || "");
        msg.style.cssText = `
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            text-align: center;
            padding: 16px;
            pointer-events: none;
            font-size: 14px;
            line-height: 1.4;
            color: ${error ? "var(--error-text, #f44336)" : "var(--muted-text, #bdbdbd)"};
            background: rgba(0, 0, 0, 0.35);
            z-index: 2;
        `;
        gridContainer.appendChild(msg);
    } catch {}
}

function sanitizeQuery(query) {
    if (!query || query.trim() === "") {
        return query;
    }

    if (query === "*") {
        return "*";
    }

    // Avoid expensive Unicode property regexes on large inputs; fallback for older engines.
    let cleaned = query;
    if (query.length > 256) {
        cleaned = query.replace(/[^a-z0-9\s-]/gi, " ");
    } else {
        try {
            cleaned = query.replace(/[^\p{L}\p{N}\s-]/gu, " ");
        } catch {
            cleaned = query.replace(/[^a-z0-9\s-]/gi, " ");
        }
    }
    return cleaned.trim() || query;
}

/**
 * Retrieve current grid state or initialize default.
 * @param {HTMLElement} gridContainer 
 * @returns {GridState}
 */
function getOrCreateState(gridContainer) {
    let state = GRID_STATE.get(gridContainer);
    if (!state) {
        state = {
            query: "*",
            offset: 0,
            total: null,
            loading: false,
            done: false,
            seenKeys: new Set(),
            assets: [],
            filenameCounts: new Map(),
            nonImageStems: new Set(),
            // Virtual Grid mappings
            stemMap: new Map(), // stem -> [Asset]
            renderedFilenameMap: new Map(), // filenameKey -> [DOMElement] (only currently rendered)
            
            
            sentinel: null,
            observer: null,
            scrollRoot: null,
            scrollHandler: null,
            ignoreNextScroll: false,
            userScrolled: false,
            allowUntilFilled: true,
            requestId: 0,
            abortController: null,
            virtualGrid: null
        };
        GRID_STATE.set(gridContainer, state);
    }
    return state;
}

function _isPotentialScrollContainer(el) {
    if (!el || el === window) return false;
    // In this project we want a dedicated scroll container (not window scrolling).
    if (el === document.body || el === document.documentElement) return false;
    try {
        const style = window.getComputedStyle(el);
        const overflowY = String(style?.overflowY || "");
        if (!/(auto|scroll|overlay)/.test(overflowY)) return false;
        const clientH = Number(el.clientHeight) || 0;
        if (clientH <= 0) return false;

        // IMPORTANT: At initial load the container may not overflow yet.
        // If CSS already declares it scrollable and it has a height, it is a valid scroll root.
        return true;
    } catch {
        return false;
    }
}

function _detectScrollRoot(gridContainer) {
    // Prefer an explicit browse container if present.
    // This is the intended scroll root for the grid UI.
    try {
        const browse = gridContainer?.closest?.(".mjr-am-browse") || null;
        if (browse && _isPotentialScrollContainer(browse)) return browse;
    } catch {}

    // Prefer the nearest *actually usable* scroll container.
    try {
        let cur = gridContainer?.parentElement;
        while (cur && cur !== document.body && cur !== document.documentElement) {
            if (_isPotentialScrollContainer(cur)) return cur;
            cur = cur.parentElement;
        }
    } catch {}

    // Fallback: the immediate parent, even if it isn't scrollable yet.
    // (Still better than silently switching to window scroll.)
    return gridContainer?.parentElement || null;
}

function _getScrollContainer(gridContainer, state) {
    try {
        const cur = state?.scrollRoot;
        if (cur && cur instanceof HTMLElement) return cur;
    } catch {}

    const detected = _detectScrollRoot(gridContainer);
    if (detected && state) state.scrollRoot = detected;
    return detected;
}

/**
 * Initializes the VirtualGrid renderer for this container.
 * @param {HTMLElement} gridContainer 
 * @param {GridState} state 
 * @returns {VirtualGrid}
 */
function ensureVirtualGrid(gridContainer, state) {
    if (state.virtualGrid) return state.virtualGrid;
    
    const scrollRoot = _getScrollContainer(gridContainer, state);

    try {
        gridDebug("virtualGrid:scrollRoot", {
            scrollRoot: scrollRoot === document.body ? "document.body" : scrollRoot === document.documentElement ? "document.documentElement" : scrollRoot?.className || scrollRoot?.tagName || null,
        });
    } catch {}

    state.virtualGrid = new VirtualGrid(gridContainer, scrollRoot, {
        minItemWidth: APP_CONFIG.GRID_MIN_SIZE || 120,
        gap: APP_CONFIG.GRID_GAP || 10,
        bufferRows: 3, 
        createItem: (asset, _index) => {
            const card = createAssetCard(asset);
            const selectedIds = getSelectedIdSet(gridContainer);
            // Handle selection
            if (asset && asset.id != null && selectedIds.has(String(asset.id))) {
                card.classList.add("is-selected");
                card.setAttribute("aria-selected", "true");
            }
            // Handle collision badge if already known
            if (asset?._mjrNameCollision) {
                 const badge = card.querySelector?.(".mjr-file-badge");
                 setFileBadgeCollision(badge, true);
                 _setCollisionTooltip(card, asset?.filename, asset?._mjrNameCollisionCount || 2);
            }
            return card;
        },
        onItemRendered: (asset, card) => {
            // Ensure selection classes are clean before applying any selection logic.
            try {
                card.classList.remove("is-selected");
                card.classList.remove("is-active");
                card.setAttribute("aria-selected", "false");
            } catch {}
            // Re-apply selection if this asset is selected.
            try {
                const selectedIds = getSelectedIdSet(gridContainer);
                if (asset?.id != null && selectedIds.has(String(asset.id))) {
                    card.classList.add("is-selected");
                    card.setAttribute("aria-selected", "true");
                }
            } catch {}

            // Hydrate ratings
            enqueueRatingTagsHydration(gridContainer, card, asset);
            try {
                state.virtualGrid?.scheduleRemeasure?.();
            } catch {}
            
            // Track rendered card for live updates (collisions)
            const fnKey = _getFilenameKey(asset?.filename);
            if (fnKey) {
                let list = state.renderedFilenameMap.get(fnKey);
                if (!list) {
                    list = [];
                    state.renderedFilenameMap.set(fnKey, list);
                }
                list.push(card);
            }
        },
        onItemUpdated: (asset, card) => {
            if (card) {
                card._mjrAsset = asset;
                _updateCardRatingTagsBadges(card, asset.rating, asset.tags);
                try {
                    state.virtualGrid?.scheduleRemeasure?.();
                } catch {}
                // Reset selection classes on reuse to avoid ghost selection
                try {
                    card.classList.remove("is-selected");
                    card.classList.remove("is-active");
                    card.setAttribute("aria-selected", "false");
                } catch {}
                
                const selectedIds = getSelectedIdSet(gridContainer);
                if (selectedIds && asset.id != null) {
                    if (selectedIds.has(String(asset.id))) {
                         card.classList.add("is-selected");
                         card.setAttribute("aria-selected", "true");
                    } else {
                         card.classList.remove("is-selected");
                         card.setAttribute("aria-selected", "false");
                    }
                }
            }
        },
        onItemRecycled: (card) => {
            // Cleanup map
            try {
                const asset = card._mjrAsset;
                const fnKey = _getFilenameKey(asset?.filename);
                if (fnKey) {
                    const list = state.renderedFilenameMap.get(fnKey);
                    if (list) {
                        const idx = list.indexOf(card);
                        if (idx > -1) list.splice(idx, 1);
                    }
                }
            } catch {}
            
              // Cleanup video thumbs
              try {
                   // Use the exported cleanup if available or implement inline
                   cleanupVideoThumbsIn(card);
              } catch {}
              try {
                   cleanupCardMediaHandlers(card);
              } catch {}
              try {
                   card.classList.remove("is-selected");
                   card.classList.remove("is-active");
                   card.setAttribute("aria-selected", "false");
              } catch {}
        }
    });

    if (!state._cardKeydownHandler) {
        const handler = (event) => {
            try {
                if (!event?.key) return;
                if (event.key !== "Enter" && event.key !== " ") return;
                const card = event.target?.closest?.(".mjr-asset-card");
                if (!card) return;
                event.preventDefault();
                card.click();
            } catch {}
        };
        state._cardKeydownHandler = handler;
        gridContainer.addEventListener("keydown", handler, true);
    }
    
    return state.virtualGrid;
}

function assetKey(asset) {
    if (!asset || typeof asset !== "object") return "";
    if (asset.id != null) return `id:${asset.id}`;
    const fp = asset.filepath || "";
    const t = asset.type || "";
    const rid = pickRootId(asset);
    return `${t}|${rid}|${fp}|${asset.subfolder || ""}|${asset.filename || ""}`;
}

function getSelectedIdSet(gridContainer) {
    const selected = new Set();
    if (!gridContainer) return selected;
    try {
        const raw = gridContainer.dataset?.mjrSelectedAssetIds;
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                for (const id of parsed) {
                    if (id == null) continue;
                    selected.add(String(id));
                }
            }
            return selected;
        }
    } catch {}
    try {
        const id = gridContainer.dataset?.mjrSelectedAssetId;
        if (id) selected.add(String(id));
    } catch {}
    return selected;
}

function _setSelectedIdsDataset(gridContainer, selectedSet, activeId = "") {
    const list = Array.from(selectedSet || []);
    const active = activeId ? String(activeId) : (list[0] ? String(list[0]) : "");
    try {
        if (list.length) {
            gridContainer.dataset.mjrSelectedAssetIds = JSON.stringify(list);
            if (active) gridContainer.dataset.mjrSelectedAssetId = String(active);
            else delete gridContainer.dataset.mjrSelectedAssetId;
        } else {
            delete gridContainer.dataset.mjrSelectedAssetIds;
            delete gridContainer.dataset.mjrSelectedAssetId;
        }
    } catch {}
    return list;
}

export function syncSelectionClasses(gridContainer, selectedIds) {
    if (!gridContainer) return;
    const set = selectedIds instanceof Set ? selectedIds : new Set(Array.from(selectedIds || []).map(String));
    try {
        for (const card of gridContainer.querySelectorAll(".mjr-asset-card")) {
            const id = card?.dataset?.mjrAssetId;
            if (id && set.has(String(id))) {
                card.classList.add("is-selected");
                card.setAttribute("aria-selected", "true");
            } else {
                card.classList.remove("is-selected");
                card.setAttribute("aria-selected", "false");
            }
        }
    } catch {}
}

export function setSelectionIds(gridContainer, selectedIds, { activeId = "" } = {}) {
    if (!gridContainer) return [];
    const set = new Set(Array.from(selectedIds || []).map(String).filter(Boolean));
    const list = _setSelectedIdsDataset(gridContainer, set, activeId);
    syncSelectionClasses(gridContainer, set);
    try {
        gridContainer.dispatchEvent?.(
            new CustomEvent("mjr:selection-changed", { detail: { selectedIds: list, activeId: activeId || list[0] || "" } })
        );
    } catch {}
    return list;
}

function _safeEscapeId(value) {
    try {
        return CSS?.escape ? CSS.escape(String(value)) : String(value).replace(/["\\]/g, "\\$&");
    } catch {
        return String(value).replace(/["\\]/g, "\\$&");
    }
}

function _getFilenameKey(filename) {
    try {
        return String(filename || "").trim().toLowerCase();
    } catch {
        return "";
    }
}

function _getExtUpper(filename) {
    try {
        return (String(filename || "").split(".").pop() || "").toUpperCase();
    } catch {
        return "";
    }
}

function _getStemLower(filename) {
    try {
        const s = String(filename || "");
        const idx = s.lastIndexOf(".");
        const stem = idx > 0 ? s.slice(0, idx) : s;
        return String(stem || "").trim().toLowerCase();
    } catch {
        return "";
    }
}

function _detectKind(asset, extUpper) {
    const k = String(asset?.kind || "").toLowerCase();
    if (k) return k;
    const images = new Set(["PNG", "JPG", "JPEG", "WEBP", "GIF", "BMP", "TIF", "TIFF"]);
    const videos = new Set(["MP4", "WEBM", "MOV", "AVI", "MKV"]);
    const audio = new Set(["MP3", "WAV", "OGG", "FLAC"]);
    if (images.has(extUpper)) return "image";
    if (videos.has(extUpper)) return "video";
    if (audio.has(extUpper)) return "audio";
    return "unknown";
}

function _isHidePngSiblingsEnabled() {
    try {
        const s = loadMajoorSettings();
        return !!s?.siblings?.hidePngSiblings;
    } catch {
        return false;
    }
}

function _setCollisionTooltip(card, filename, count) {
    if (!card || count == null) return;
    const n = Number(count) || 0;
    if (n < 2) return;
    try {
        const row = card.querySelector?.(".mjr-card-filename");
        if (row) {
            row.title = `${String(filename || "")}\nDuplicate filename: ${n} items in this view`;
            return;
        }
    } catch {}
    try {
        card.title = `Duplicate filename: ${n} items in this view`;
    } catch {}
}

function appendAssets(gridContainer, assets, state) {
    const hidePngSiblings = _isHidePngSiblingsEnabled();
    const filenameCounts = state.filenameCounts || new Map();
    state.filenameCounts = filenameCounts;
    const nonImageStems = state.nonImageStems || new Set();
    state.nonImageStems = nonImageStems;

    clearGridMessage(gridContainer);

    // Use VirtualGrid
    const vg = ensureVirtualGrid(gridContainer, state);
    if (!vg) return 0;

    if (state.hiddenPngSiblings == null) state.hiddenPngSiblings = 0;
    if (!hidePngSiblings) state.hiddenPngSiblings = 0;

    const stemMap = state.stemMap || new Map();
    state.stemMap = stemMap;
    
    const filenameToAssets = new Map();
    for (const existing of state.assets || []) {
        const key = _getFilenameKey(existing?.filename);
        if (!key) continue;
        let list = filenameToAssets.get(key);
        if (!list) {
            list = [];
            filenameToAssets.set(key, list);
        }
        list.push(existing);
    }
    
    // [ISSUE 3] Memory protection: Page Eviction
    // Prevent unchecked growth of assets array and seenKeys
    const MAX_ASSETS_MEMORY = 3000;
    if (state.assets.length > MAX_ASSETS_MEMORY) {
        const pruneCount = 500; // prune chunk
        const removed = state.assets.splice(0, pruneCount);
        // Also clean up seenKeys to keep Set size manageable,
        // though strictly they shouldn't show up again if paginating forward.
        if (state.seenKeys) {
            for (const a of removed) {
                const key = assetKey(a); 
                if (key) state.seenKeys.delete(key);
            }
        }
    }

    let addedCount = 0;
    let needsUpdate = false;
    const validNewAssets = [];
    
    // [OPTIMIZATION] Single pass removal for PNG siblings
    const assetsToRemoveFromState = new Set();

    const applyFilenameCollisions = () => {
        try {
            for (const [key, bucket] of filenameToAssets.entries()) {
                const count = bucket.length;
                filenameCounts.set(key, count);
                if (count < 2) {
                    for (const asset of bucket) {
                        asset._mjrNameCollision = false;
                        delete asset._mjrNameCollisionCount;
                    }
                    const renderedList = state.renderedFilenameMap.get(key);
                    if (renderedList) {
                        for (const card of renderedList) {
                            const badge = card.querySelector?.(".mjr-file-badge");
                            setFileBadgeCollision(badge, false);
                        }
                    }
                    continue;
                }
                for (const asset of bucket) {
                    asset._mjrNameCollision = true;
                    asset._mjrNameCollisionCount = count;
                }
                const renderedList = state.renderedFilenameMap.get(key);
                if (renderedList) {
                    for (const card of renderedList) {
                        const badge = card.querySelector?.(".mjr-file-badge");
                        setFileBadgeCollision(badge, true);
                        const asset = card._mjrAsset;
                        _setCollisionTooltip(card, asset?.filename, count);
                    }
                }
            }
        } catch {}
    };
    
    // Pre-pass: Identify new non-image stems in this batch to handle same-batch pairs
    if (hidePngSiblings) {
        for (const asset of assets || []) {
            const filename = String(asset?.filename || "");
            const extUpper = _getExtUpper(filename); 
            const kind = _detectKind(asset, extUpper);
            if (kind !== "image") {
                const stem = _getStemLower(filename);
                if (stem) nonImageStems.add(stem);
            }
        }
    }

    for (const asset of assets || []) {
        const filename = String(asset?.filename || "");
        const extUpper = _getExtUpper(filename);
        const stemLower = _getStemLower(filename);
        const kind = _detectKind(asset, extUpper);

        // Hide PNG Siblings Logic
        if (hidePngSiblings && stemLower) {
            if (kind !== "image") {
                // nonImageStems already updated in pre-pass
                
                // Check if we need to hide EXISTING PNG siblings (retroactive hiding)
                const list = stemMap.get(stemLower);
                if (list) {
                    for (let i = list.length - 1; i >= 0; i--) {
                        if (_getExtUpper(list[i].filename) === "PNG") {
                            assetsToRemoveFromState.add(list[i]);
                            // Also remove from stemMap immediately so we don't process it again
                            list.splice(i, 1);
                        }
                    }
                }
            } else if (extUpper === "PNG" && nonImageStems.has(stemLower)) {
                state.hiddenPngSiblings += 1;
                continue; // Skip adding this PNG
            }
        }

        // Name Collisions Logic
        const fnKey = _getFilenameKey(filename);
        if (fnKey) {
            let bucket = filenameToAssets.get(fnKey);
            if (!bucket) {
                bucket = [];
                filenameToAssets.set(fnKey, bucket);
            }
            bucket.push(asset);
        }
        
        const key = assetKey(asset);
        if (!key) continue;
        if (state.seenKeys.has(key)) continue;
        state.seenKeys.add(key);
        
        validNewAssets.push(asset);
        
        // Update stemMap
        if (stemLower) {
            let list = stemMap.get(stemLower);
            if (!list) {
                list = [];
                stemMap.set(stemLower, list);
            }
            list.push(asset);
        }
        
        addedCount++;
    }

    // [OPTIMIZATION] Apply batch removals
    if (assetsToRemoveFromState.size > 0) {
        state.hiddenPngSiblings += assetsToRemoveFromState.size;
        // Single pass removal
        state.assets = state.assets.filter(a => !assetsToRemoveFromState.has(a));
        try {
            for (const removed of assetsToRemoveFromState) {
                const key = _getFilenameKey(removed?.filename);
                if (!key) continue;
                const bucket = filenameToAssets.get(key);
                if (!bucket) continue;
                const idx = bucket.indexOf(removed);
                if (idx > -1) bucket.splice(idx, 1);
                if (!bucket.length) filenameToAssets.delete(key);
            }
        } catch {}
        needsUpdate = true;
    }

    if (validNewAssets.length > 0) {
        state.assets.push(...validNewAssets);
        needsUpdate = true;
    }

    if (needsUpdate) {
        applyFilenameCollisions();
        // Update the virtual grid
        vg.setItems(state.assets);
        
        // Ensure sentinel is at the bottom
        if (state.sentinel) {
            gridContainer.appendChild(state.sentinel);
        }
    }

    try {
        gridContainer.dataset.mjrHidePngSiblingsEnabled = hidePngSiblings ? "1" : "0";
        gridContainer.dataset.mjrHiddenPngSiblings = String(Number(state.hiddenPngSiblings || 0) || 0);
    } catch {}
    
    return addedCount;
}

function ensureSentinel(gridContainer, state) {
    let sentinel = state.sentinel;
    // Fix: Force ensure it is last child
    if (sentinel && sentinel.isConnected && sentinel.parentNode === gridContainer && !sentinel.nextSibling) return sentinel;
    
    if (sentinel) {
        sentinel.remove();
    } else {
        sentinel = document.createElement("div");
        sentinel.className = SENTINEL_CLASS;
        // z-index -10 to prevent interference
        sentinel.style.cssText = "height: 1px; width: 100%; position: absolute; bottom: 0; left: 0; pointer-events: none; z-index: -10;";
        state.sentinel = sentinel;
    }
    gridContainer.appendChild(sentinel);
    
    if (state.observer) {
        try { state.observer.observe(sentinel); } catch {}
    }
    return sentinel;
}
function stopObserver(state) {
    try {
        if (state.observer) state.observer.disconnect();
    } catch {}
    state.observer = null;
    try {
        if (state.sentinel && state.sentinel.isConnected) state.sentinel.remove();
    } catch {}
    state.sentinel = null;

    try {
        if (state.scrollTarget && state.scrollHandler) {
            state.scrollTarget.removeEventListener("scroll", state.scrollHandler);
        }
    } catch {}
    state.scrollRoot = null;
    state.scrollTarget = null;
    state.scrollHandler = null;
    state.ignoreNextScroll = false;
    state.userScrolled = false;
    state.allowUntilFilled = true;
}

function captureScrollMetrics(state) {
    const root = state?.scrollRoot;
    if (!root) return null;
    
    // Dedicated scroll container only
    const clientHeight = Number(root.clientHeight) || 0;
    const scrollHeight = Number(root.scrollHeight) || 0;
    const scrollTop = Number(root.scrollTop) || 0;

    const bottomGap = scrollHeight - (scrollTop + clientHeight);
    return { clientHeight, scrollHeight, scrollTop, bottomGap };
}

function maybeKeepPinnedToBottom(_state, _before) {
    // Disabled: Standard infinite scroll should not force pin to bottom on append.
    // This logic is problematic for grids where we want to seeing new content naturally.
    return; 
}

/**
 * Fetch a page of assets from the backend.
 * @param {HTMLElement} gridContainer 
 * @param {string} query Search query
 * @param {number} limit Page size
 * @param {number} offset Offset
 * @param {Object} options 
 * @param {number} [options.requestId]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ok: boolean, assets?: any[], total?: number, count?: number, error?: string, aborted?: boolean, stale?: boolean, sortKey?: string, safeQuery?: string}>}
 */
async function fetchPage(gridContainer, query, limit, offset, { requestId = 0, signal = null } = {}) {
    const scope = gridContainer?.dataset?.mjrScope || "output";
    const customRootId = gridContainer?.dataset?.mjrCustomRootId || "";
    const subfolder = gridContainer?.dataset?.mjrSubfolder || "";
    const kind = gridContainer?.dataset?.mjrFilterKind || "";
    const workflowOnly = gridContainer?.dataset?.mjrFilterWorkflowOnly === "1";
    const minRating = Number(gridContainer?.dataset?.mjrFilterMinRating || 0) || 0;
    const dateRange = String(gridContainer?.dataset?.mjrFilterDateRange || "").trim().toLowerCase();
    const dateExact = String(gridContainer?.dataset?.mjrFilterDateExact || "").trim();
    const sortKey = gridContainer?.dataset?.mjrSort || "mtime_desc";

    const requestedQuery = query && query.trim() ? query : "*";
    const safeQuery = sanitizeQuery(requestedQuery) || requestedQuery;

    try {
        const includeTotal = !(String(scope || "").toLowerCase() === "output" && Number(offset || 0) > 0);
            const url = buildListURL({
                q: safeQuery,
                limit,
                offset,
                scope,
                subfolder,
                customRootId: customRootId || null,
                kind: kind || null,
                hasWorkflow: workflowOnly ? true : null,
                minRating: minRating > 0 ? minRating : null,
                dateRange: dateRange || null,
                dateExact: dateExact || null,
                includeTotal
            });
        const result = await get(url, signal ? { signal } : undefined);

        // Ignore stale responses (e.g. user changed scope/filters while request was in flight).
        try {
            const state = GRID_STATE.get(gridContainer);
            if (state && Number(state.requestId) !== Number(requestId)) {
                return { ok: false, stale: true, error: "Stale response" };
            }
        } catch {}

        if (result.ok) {
            let assets = (result.data?.assets) || [];
            const rawTotal = result.data?.total;
            const total = rawTotal == null ? null : (Number(rawTotal || 0) || 0);

            // Client-side sorting (applies to current page). Default is already mtime desc from the backend.
            if (sortKey !== "mtime_desc") {
                const safeName = (a) => String(a?.filename || "");
                const safeMtime = (a) => Number(a?.mtime || 0) || 0;
                if (sortKey === "name_asc") {
                    assets.sort((a, b) => safeName(a).localeCompare(safeName(b)));
                } else if (sortKey === "name_desc") {
                    assets.sort((a, b) => safeName(b).localeCompare(safeName(a)));
                } else if (sortKey === "mtime_asc") {
                    assets.sort((a, b) => safeMtime(a) - safeMtime(b));
                }
            }
            return { ok: true, assets, total, count: assets.length, sortKey, safeQuery };
        } else {
            try {
                if (String(result?.code || "") === "ABORTED") return { ok: false, aborted: true, error: "Aborted" };
            } catch {}
            return { ok: false, error: result.error };
        }
    } catch (error) {
        try {
            if (String(error?.name || "") === "AbortError") return { ok: false, aborted: true, error: "Aborted" };
        } catch {}
        return { ok: false, error: error.message };
    }
}

const emitAgendaStatus = (dateExact, hasResults) => {
    if (!dateExact) return;
    try {
        window?.dispatchEvent?.(
            new CustomEvent("MJR:AgendaStatus", {
                detail: { date: dateExact, hasResults: Boolean(hasResults) },
            })
        );
    } catch {}
};

async function loadNextPage(gridContainer, state) {
    if (state.loading || state.done) return;
    const limit = Math.max(1, Math.min(APP_CONFIG.MAX_PAGE_SIZE, APP_CONFIG.DEFAULT_PAGE_SIZE));
    state.loading = true;
    const before = captureScrollMetrics(state);
    gridDebug("loadNextPage:start", {
        q: String(state?.query || ""),
        limit,
        offset: Number(state?.offset || 0) || 0,
        done: !!state?.done,
        loading: !!state?.loading,
        assetsLen: Array.isArray(state?.assets) ? state.assets.length : -1,
        scroll: before,
    });
    try {
        const page = await fetchPage(gridContainer, state.query, limit, state.offset, {
            requestId: Number(state.requestId) || 0,
            signal: state.abortController?.signal || null
        });
        gridDebug("loadNextPage:response", {
            ok: !!page?.ok,
            aborted: !!page?.aborted,
            stale: !!page?.stale,
            error: page?.error || null,
            count: Number(page?.count || 0) || 0,
            total: page?.total ?? null,
            offsetBefore: Number(state?.offset || 0) || 0,
        });
        const dateExact = String(gridContainer?.dataset?.mjrFilterDateExact || "").trim();
        emitAgendaStatus(dateExact, page.ok && Array.isArray(page.assets) && page.assets.length > 0);
        if (!page.ok) {
            if (page.aborted || page.stale) return;
            state.done = true;
            stopObserver(state);
            
            // [ISSUE 5] Error Retry Mechanism
            const errDiv = document.createElement("div");
            errDiv.style.padding = "20px";
            errDiv.style.textAlign = "center";
            errDiv.style.gridColumn = "1 / -1";
            
            const msg = document.createElement("p");
            msg.className = "mjr-muted";
            msg.style.color = "var(--error-text, #f44336)";
            msg.textContent = `Error loading: ${page.error}`;
            
            const retryBtn = document.createElement("button");
            retryBtn.textContent = "Retry";
            retryBtn.className = "mjr-btn mjr-btn-secondary"; // Use existing class if available
            retryBtn.style.marginTop = "10px";
            retryBtn.onclick = () => {
                errDiv.remove();
                state.done = false;
                state.loading = false;
                // Retry immediately
                loadNextPage(gridContainer, state);
            };
            
            errDiv.appendChild(msg);
            errDiv.appendChild(retryBtn);
            gridContainer.appendChild(errDiv);
            return;
        }

        if (page.total != null) {
            state.total = page.total;
        }
        const added = appendAssets(gridContainer, page.assets || [], state);
        state.offset += (page.count || 0);

        try {
            const count = Number(state?.offset || 0) || 0;
            const total = Number(state?.total ?? 0) || 0;
            const evt = new CustomEvent("mjr:grid-stats", { detail: { count, total } });
            gridContainer?.dispatchEvent?.(evt);
            if (gridContainer && typeof gridContainer.dataset === "object") {
                try {
                    gridContainer.dataset.mjrShown = String(count);
                    gridContainer.dataset.mjrTotal = String(total);
                } catch {}
            }
        } catch {}

        gridDebug("loadNextPage:append", {
            added,
            pageCount: Number(page?.count || 0) || 0,
            newOffset: Number(state?.offset || 0) || 0,
            assetsLen: Array.isArray(state?.assets) ? state.assets.length : -1,
            total: state.total ?? null,
        });

        maybeKeepPinnedToBottom(state, before);

        // Fix: Conservative stop condition.
        // We ignore state.total because it might be approximate.
        // We only stop if we received 0 items. 
        // Note: We could also stop if count < limit, but relying on 0 is safer against 
        // backends that might return partial pages due to filtering/timeouts.
        if ((page.count || 0) === 0) {
            state.done = true;
            stopObserver(state);
            gridDebug("loadNextPage:done", { reason: "page.count==0", offset: Number(state?.offset || 0) || 0 });
        }
    } finally {
        state.loading = false;
        gridDebug("loadNextPage:finally", { loading: false, done: !!state?.done });
    }
}

function startInfiniteScroll(gridContainer, state) {
    if (!APP_CONFIG.INFINITE_SCROLL_ENABLED) return;
    stopObserver(state);
    const sentinel = ensureSentinel(gridContainer, state);

    // IMPORTANT: Use the same scroll root as VirtualGrid.
    // If we re-detect incorrectly, the IntersectionObserver never fires on scroll and we
    // remain stuck on the first page (often ~30 items depending on backend caps).
    let rootEl = null;
    try {
        rootEl = state?.virtualGrid?.scrollElement || null;
    } catch {
        rootEl = null;
    }

    // Fallback: detect a scroll root consistently.
    if (!rootEl) rootEl = _getScrollContainer(gridContainer, state);

    // Enforce dedicated scroll container mode.
    if (!rootEl || !(rootEl instanceof HTMLElement)) {
        gridDebug("infiniteScroll:disabled", { reason: "no scroll container" });
        return;
    }

    state.scrollRoot = rootEl;
    state.userScrolled = false;

    const scrollTarget = rootEl;
    state.scrollTarget = scrollTarget;

    gridDebug("infiniteScroll:setup", {
        rootEl: rootEl?.className || rootEl?.tagName || null,
        scrollTarget: scrollTarget?.className || scrollTarget?.tagName || null,
        rootMargin: APP_CONFIG.INFINITE_SCROLL_ROOT_MARGIN || "800px",
        threshold: APP_CONFIG.INFINITE_SCROLL_THRESHOLD ?? 0.01,
        offset: Number(state?.offset || 0) || 0,
        done: !!state?.done,
    });

    if (scrollTarget && !state.scrollHandler) {
        state.scrollHandler = () => {
             if (state.ignoreNextScroll) {
                 state.ignoreNextScroll = false;
                 return;
             }
             state.userScrolled = true;
        };
        try {
            scrollTarget.addEventListener("scroll", state.scrollHandler, { passive: true });
        } catch {}
    }

    const observerRoot = rootEl;

    state.observer = new IntersectionObserver(
        (entries) => {
            for (const entry of entries || []) {
                if (!entry.isIntersecting) continue;
                if (state.loading || state.done) return;

                gridDebug("infiniteScroll:intersect", {
                    offset: Number(state?.offset || 0) || 0,
                    total: state?.total ?? null,
                    loading: !!state?.loading,
                    done: !!state?.done,
                    metrics: captureScrollMetrics(state),
                    targetConnected: !!sentinel?.isConnected,
                });

                // Prevent repeated auto-loads when new content is appended while the user
                // stays pinned at the bottom. Require a user scroll between loads unless
                // the grid doesn't fill the viewport yet (initial fill).
                const metrics = captureScrollMetrics(state);
                const fillsViewport = metrics ? metrics.scrollHeight > metrics.clientHeight + 40 : false;
                
                // Fix: Force load if not filled, regardless of user scroll state.
                // If it fills viewport but userScrolled is false, we might still want to load
                // if the sentinel is stubbornly visible (e.g. big screens).
                // So we relax the check: ONLY block if fillsViewport AND allowUntilFilled is false AND !userScrolled.
                /* 
                   CRITICAL FIX: We cannot block inside the IntersectionObserver callback based on state.userScrolled.
                   Observer only fires on STATE CHANGE. If we block now, and the user scrolls (keeping sentinel intersecting),
                   the observer will NOT fire again, and the user will hit the bottom with no load.
                   
                   We rely on rootMargin ("800px") to naturally stop the loading once we have enough buffer.
                   As long as items are adding height (pushing sentinel down), this will terminate.
                */
                // if (!state.userScrolled && fillsViewport && !state.allowUntilFilled) {
                //    return;
                // }
                try {
                    state.observer?.unobserve?.(sentinel);
                } catch {}

                state.userScrolled = false;
                if (fillsViewport) state.allowUntilFilled = false;

                Promise.resolve(loadNextPage(gridContainer, state))
                    .catch(() => null)
                    .finally(() => {
                        if (state.done) return;
                        if (!sentinel.isConnected) return;
                        try {
                            state.observer?.observe?.(sentinel);
                        } catch {}
                    });
            }
        },
        {
            root: observerRoot,
            rootMargin: APP_CONFIG.INFINITE_SCROLL_ROOT_MARGIN || "800px",
            threshold: APP_CONFIG.INFINITE_SCROLL_THRESHOLD ?? 0.01
        }
    );
    state.observer.observe(sentinel);
}

export async function loadAssets(gridContainer, query = "*", options = {}) {
    const { reset = true } = options || {};
    const state = getOrCreateState(gridContainer);

    const requestedQuery = query && query.trim() ? query : "*";
    state.query = sanitizeQuery(requestedQuery) || requestedQuery;

    if (reset) {
        try {
            state.abortController?.abort?.();
        } catch {}
        try {
            state.abortController = typeof AbortController !== "undefined" ? new AbortController() : null;
        } catch {
            state.abortController = null;
        }
        try {
            state.requestId = (Number(state.requestId) || 0) + 1;
        } catch {
            state.requestId = 1;
        }

        stopObserver(state);
        state.offset = 0;
        state.total = null;
        state.done = false;
        state.loading = false;
        state.allowUntilFilled = true; // Reset: Allow auto-filling the viewport on new search
        state.seenKeys = new Set();
        state.assets = [];
        state.filenameCounts = new Map();
        state.stemMap = new Map();
        state.renderedFilenameMap = new Map();
        state.nonImageStems = new Set();
        state.hiddenPngSiblings = 0;
        try {
            gridContainer.dataset.mjrHiddenPngSiblings = "0";
        } catch {}
        
        // Clear virtual grid items (but keep instance)
        const vg = ensureVirtualGrid(gridContainer, state);
        if (vg) vg.setItems([]);
        // We don't clear innerHTML directly if VirtualGrid is active, as it manages it.
        // But showLoadingOverlay expects to be appended.
        // VirtualGrid sets container to relative. Overlay is absolute inset 0. It works.
        
        showLoadingOverlay(gridContainer, state.query === "*" ? "Loading assets..." : `Searching for "${state.query}"...`);
    }

    try {
        await loadNextPage(gridContainer, state);

        if (reset) {
            hideLoadingOverlay(gridContainer);
            // Check if items present in state, not just DOM (logic shift)
            const hasItems = state.assets && state.assets.length > 0;
              if (!hasItems && state.offset === 0) {
                  // Manually clear to show message
                  if (state.virtualGrid) state.virtualGrid.setItems([]);
                  setGridMessage(gridContainer, "No assets found");
              } else {
                  startInfiniteScroll(gridContainer, state);
              }
        }
        return { ok: true, count: state.offset, total: state.total || 0 };
    } catch (err) {
        try {
            if (String(err?.name || "") === "AbortError") {
                return { ok: false, aborted: true, error: "Aborted" };
            }
        } catch {}
        stopObserver(state);
        if (reset) hideLoadingOverlay(gridContainer);
        clearGridMessage(gridContainer);
        setGridMessage(gridContainer, `Failed to load assets: ${err?.message || err}`, { error: true });
        return { ok: false, error: err?.message || String(err) };
    } finally {
        if (reset) hideLoadingOverlay(gridContainer);
    }
}

/**
 * Load a pre-defined list of assets into the grid (no paging/infinite scroll).
 * Used for "Collections" views.
 */
export async function loadAssetsFromList(gridContainer, assets, options = {}) {
    const { title = "Collection", reset = true } = options || {};
    const state = getOrCreateState(gridContainer);

    const list = Array.isArray(assets) ? assets : [];

    if (reset) {
        stopObserver(state);
        state.offset = 0;
        state.total = list.length;
        state.done = true;
        state.loading = false;
        state.query = String(title || "Collection");
        state.seenKeys = new Set();
        state.assets = [];
        state.filenameCounts = new Map();
        state.stemMap = new Map();
        state.renderedFilenameMap = new Map();
        state.nonImageStems = new Set();
        state.hiddenPngSiblings = 0;
        try {
            gridContainer.dataset.mjrHiddenPngSiblings = "0";
        } catch {}
        
        const vg = ensureVirtualGrid(gridContainer, state);
        if (vg) vg.setItems([]);
        
        showLoadingOverlay(gridContainer, list.length ? `Loading ${title}...` : `${title} is empty`);
    }

    try {
        // Apply the current sort order for consistent UX.
        const sortKey = gridContainer.dataset.mjrSort || "mtime_desc";
        const sorted = list.slice().sort((a, b) => {
            const av = getSortValue(a, sortKey);
            const bv = getSortValue(b, sortKey);
            if (av < bv) return -1;
            if (av > bv) return 1;
            return 0;
        });

        appendAssets(gridContainer, sorted, state);

        if (reset) {
            hideLoadingOverlay(gridContainer);
            const hasItems = state.assets && state.assets.length > 0;
              if (!hasItems) {
                  if (state.virtualGrid) state.virtualGrid.setItems([]);
                  setGridMessage(gridContainer, "No assets found");
              }
        }

        return { ok: true, count: sorted.length, total: sorted.length };
    } catch (err) {
        stopObserver(state);
        if (reset) hideLoadingOverlay(gridContainer);
        clearGridMessage(gridContainer);
        setGridMessage(gridContainer, `Failed to load collection: ${err?.message || err}`, { error: true });
        return { ok: false, error: err?.message || String(err) };
    } finally {
        if (reset) hideLoadingOverlay(gridContainer);
    }
}

/**
 * Remove assets from grid state + UI (used after delete).
 * Keeps selection dataset consistent and avoids UI re-appearance on scroll.
 * @param {HTMLElement} gridContainer
 * @param {Array<string|number|Object>} assetIds
 * @param {Object} [options]
 * @param {boolean} [options.updateSelection=true]
 * @returns {{ok: boolean, removed: number, selectedIds: string[]}}
 */
export function removeAssetsFromGrid(gridContainer, assetIds, { updateSelection = true } = {}) {
    if (!gridContainer) {
        return { ok: false, removed: 0, selectedIds: [] };
    }
    const ids = new Set();
    const list = Array.isArray(assetIds) ? assetIds : [assetIds];
    for (const raw of list) {
        if (raw == null) continue;
        if (typeof raw === "object" && raw?.id != null) {
            ids.add(String(raw.id));
        } else {
            ids.add(String(raw));
        }
    }
    if (!ids.size) {
        return { ok: false, removed: 0, selectedIds: Array.from(getSelectedIdSet(gridContainer)) };
    }

    let selectedIds = getSelectedIdSet(gridContainer);
    if (updateSelection) {
        for (const id of ids) selectedIds.delete(String(id));
        _setSelectedIdsDataset(gridContainer, selectedIds);
    }

    // Best-effort selection class sync for visible cards.
    try {
        for (const card of gridContainer.querySelectorAll(".mjr-asset-card.is-selected")) {
            const id = card?.dataset?.mjrAssetId;
            if (!id || !selectedIds.has(String(id))) {
                card.classList.remove("is-selected");
                card.setAttribute("aria-selected", "false");
            }
        }
    } catch {}

    const state = GRID_STATE.get(gridContainer);
    let removedCount = 0;
    if (state?.assets && state.assets.length) {
        const next = [];
        for (const asset of state.assets) {
            const id = asset?.id != null ? String(asset.id) : "";
            if (id && ids.has(id)) {
                removedCount += 1;
            } else {
                next.push(asset);
            }
        }
        if (removedCount) {
            state.assets = next;
            try {
                if (Number.isFinite(state.total)) state.total = Math.max(0, Number(state.total) - removedCount);
            } catch {}
            try {
                if (Number.isFinite(state.offset)) state.offset = Math.max(0, Number(state.offset) - removedCount);
            } catch {}
            if (state.virtualGrid) {
                state.virtualGrid.setItems(state.assets);
            } else {
                for (const id of ids) {
                    try {
                        const card = gridContainer.querySelector(`[data-mjr-asset-id="${_safeEscapeId(id)}"]`);
                        card?.remove?.();
                    } catch {}
                }
            }
        }
    } else {
        for (const id of ids) {
            try {
                const card = gridContainer.querySelector(`[data-mjr-asset-id="${_safeEscapeId(id)}"]`);
                if (card) {
                    card.remove?.();
                    removedCount += 1;
                }
            } catch {}
        }
    }

    const selectedList = Array.from(selectedIds);
    try {
        gridContainer?.dispatchEvent?.(new CustomEvent("mjr:selection-changed", { detail: { selectedIds: selectedList } }));
    } catch {}
    try {
        const count = Number(state?.assets?.length ?? null);
        const total = Number(state?.total ?? null);
        if (Number.isFinite(count) || Number.isFinite(total)) {
            gridContainer?.dispatchEvent?.(
                new CustomEvent("mjr:grid-stats", { detail: { count, total } })
            );
        }
    } catch {}

    return { ok: true, removed: removedCount, selectedIds: selectedList };
}

export function disposeGrid(gridContainer) {
    const state = GRID_STATE.get(gridContainer);
    if (!state) return;
    stopObserver(state);
    
    // Dispose virtual grid
    if (state.virtualGrid) {
        try {
            state.virtualGrid.dispose();
        } catch {}
        state.virtualGrid = null;
    }

    if (state._cardKeydownHandler) {
        try {
            gridContainer.removeEventListener("keydown", state._cardKeydownHandler, true);
        } catch {}
        state._cardKeydownHandler = null;
    }

    // Cleanup summary bar listeners
    try {
        gridContainer._mjrSummaryBarDispose?.();
    } catch {}

    // Cleanup grid keyboard
    try {
        gridContainer._mjrGridKeyboard?.dispose?.();
    } catch {}

    // Cleanup settings-changed listener
    try {
        gridContainer._mjrSettingsChangedCleanup?.();
    } catch {}

    try {
        cleanupVideoThumbsIn?.(gridContainer);
    } catch {}
    try {
        state.seenKeys?.clear?.();
        state.stemMap?.clear?.();
        state.renderedFilenameMap?.clear?.();
    } catch {}
    // Best-effort callback cleanup
    try {
        const st = _getRtHydrateState(gridContainer);
        if (st) {
             st.queue.length = 0;
             st.active?.clear?.();
             st.seen?.clear?.();
        }
    } catch {}
    try {
        RT_HYDRATE_STATE.delete(gridContainer);
    } catch {}
    GRID_STATE.delete(gridContainer);
}

/**
 * Get sort value for an asset based on sort key
 */
function getSortValue(asset, sortKey) {
    switch (sortKey) {
        case 'mtime_desc':
            return -(Number(asset?.mtime) || 0); // Negative for descending order
        case 'mtime_asc':
            return Number(asset?.mtime) || 0;
        case 'name_asc':
            return String(asset?.filename || '').toLowerCase();
        case 'name_desc':
            return String(asset?.filename || '').toLowerCase(); // Will be handled specially in comparison
        default:
            return -(Number(asset?.mtime) || 0); // Default to mtime_desc
    }
}

/**
 * Determine if an asset should be inserted before another based on sort order
 */
function shouldInsertBefore(assetValue, cardValue, sortKey) {
    if (sortKey === 'name_asc') {
        // For ascending string comparisons
        return String(assetValue) < String(cardValue);
    } else if (sortKey === 'name_desc') {
        // For descending string comparisons
        return String(assetValue) > String(cardValue);
    } else {
        // For numeric comparisons
        return Number(assetValue) < Number(cardValue);
    }
}

/**
 * Find the correct insertion position in an array based on sort order
 */
function findInsertPosition(array, asset, sortKey) {
    const assetValue = getSortValue(asset, sortKey);
    for (let i = 0; i < array.length; i++) {
        const arrValue = getSortValue(array[i], sortKey);
        if (shouldInsertBefore(assetValue, arrValue, sortKey)) {
            return i;
        }
    }
    return array.length; // Append to end
}

/**
 * Find asset element by ID
 */
function findAssetElement(gridContainer, assetId) {
    return gridContainer.querySelector(`[data-mjr-asset-id="${CSS.escape ? CSS.escape(String(assetId)) : String(assetId)}"]`);
}

/**
 * Get or create upsert batch state for a grid
 */
function _getUpsertBatchState(gridContainer) {
    let s = UPSERT_BATCH_STATE.get(gridContainer);
    if (!s) {
        s = { pending: new Map(), timer: null, flushing: false };
        UPSERT_BATCH_STATE.set(gridContainer, s);
    }
    return s;
}

/**
 * Flush all pending upserts in one batch (single setItems call)
 */
function _flushUpsertBatch(gridContainer) {
    const batchState = UPSERT_BATCH_STATE.get(gridContainer);
    if (!batchState || batchState.pending.size === 0) return;
    if (batchState.flushing) return; // Prevent re-entrancy
    
    batchState.flushing = true;
    if (batchState.timer) {
        clearTimeout(batchState.timer);
        batchState.timer = null;
    }

    const state = getOrCreateState(gridContainer);
    const vg = ensureVirtualGrid(gridContainer, state);
    
    try {
        // Process all pending assets
        let modified = false;
        
        for (const [assetId, asset] of batchState.pending.entries()) {
            const key = assetKey(asset);
            const existingIndex = state.assets.findIndex(a => String(a.id) === assetId);

            if (existingIndex > -1) {
                // Update existing
                const existingAsset = state.assets[existingIndex];
                const collision = existingAsset._mjrNameCollision;
                const collisionCount = existingAsset._mjrNameCollisionCount;
                
                Object.assign(existingAsset, asset);
                
                if (collision && !asset._mjrNameCollision) {
                    existingAsset._mjrNameCollision = true;
                    existingAsset._mjrNameCollisionCount = collisionCount;
                }
                state.assets[existingIndex] = { ...existingAsset };
                modified = true;
            } else {
                if (!state.seenKeys.has(key)) {
                    const sortKey = gridContainer.dataset.mjrSort || "mtime_desc";
                    const insertPos = findInsertPosition(state.assets, asset, sortKey);

                    state.seenKeys.add(key);
                    
                    // If insertion is near the top, mark re-sort to avoid large index shifts.
                    const shouldResort = insertPos <= Math.min(10, state.assets.length);
                    if (insertPos === -1) {
                        state.assets.push(asset);
                    } else {
                        state.assets.splice(insertPos, 0, asset);
                    }
                    if (shouldResort) {
                        try {
                            state._mjrResortPending = true;
                        } catch {}
                    }
                    modified = true;
                }
            }
        }

        // Single setItems call for all changes
        if (modified && vg) {
            // If many top inserts occurred, full re-sort to stabilize indices.
            if (state._mjrResortPending) {
                try {
                    const sortKey = gridContainer.dataset.mjrSort || "mtime_desc";
                    state.assets.sort((a, b) => {
                        const av = getSortValue(a, sortKey);
                        const bv = getSortValue(b, sortKey);
                        if (av < bv) return -1;
                        if (av > bv) return 1;
                        return 0;
                    });
                } catch {}
                try { state._mjrResortPending = false; } catch {}
            }
            vg.setItems(state.assets);
        }
    } catch (err) {
        console.warn("📂 Majoor [⚠️] Upsert batch flush error:", err);
    } finally {
        batchState.pending.clear();
        batchState.flushing = false;
    }
}

/**
 * Update or insert a single asset in the grid (Live Update).
 * Uses batching to avoid multiple setItems calls in rapid succession.
 * @param {HTMLElement} gridContainer 
 * @param {Object} asset The new or updated asset data
 * @returns {boolean} True if asset was queued for update
 */
export function upsertAsset(gridContainer, asset) {
    if (!asset || !asset.id) return false;

    const state = getOrCreateState(gridContainer);
    const assetId = String(asset.id);
    
    const vg = ensureVirtualGrid(gridContainer, state);
    if (!vg) return false;

    // Add to batch
    const batchState = _getUpsertBatchState(gridContainer);
    batchState.pending.set(assetId, asset);

    // Schedule flush with debounce, or flush immediately if batch is large
    if (batchState.pending.size >= UPSERT_BATCH_MAX_SIZE) {
        _flushUpsertBatch(gridContainer);
    } else if (!batchState.timer && !batchState.flushing) {
        batchState.timer = setTimeout(() => {
            batchState.timer = null;
            _flushUpsertBatch(gridContainer);
        }, UPSERT_BATCH_DEBOUNCE_MS);
    }

    return true;
}

/**
 * Force flush any pending upsert batch (call before operations that need up-to-date grid)
 * @param {HTMLElement} gridContainer 
 */
export function flushUpsertBatch(gridContainer) {
    _flushUpsertBatch(gridContainer);
}

/**
 * Capture scroll anchor before making changes
 */
export function captureAnchor(gridContainer) {
    const state = getOrCreateState(gridContainer);
    const scrollContainer = _getScrollContainer(gridContainer, state);
    const selectedElement = gridContainer.querySelector('.mjr-asset-card.is-selected');
    const firstVisibleElement = getFirstVisibleAssetElement(gridContainer);

    const el = selectedElement || firstVisibleElement;
    if (!el) return null;

    const rect = el.getBoundingClientRect();
    const containerRect = gridContainer.getBoundingClientRect();

    return {
        id: el.dataset.mjrAssetId,
        top: rect.top - containerRect.top,
        scrollTop: scrollContainer?.scrollTop || 0
    };
}

/**
 * Get first visible asset element
 */
function getFirstVisibleAssetElement(gridContainer) {
    const cards = gridContainer.querySelectorAll('.mjr-asset-card');
    const containerRect = gridContainer.getBoundingClientRect();
    const containerTop = containerRect.top;
    const containerBottom = containerRect.bottom;

    for (const card of cards) {
        const cardRect = card.getBoundingClientRect();
        if (cardRect.bottom >= containerTop && cardRect.top <= containerBottom) {
            return card;
        }
    }

    // If no card is visible, return the first one
    return cards[0] || null;
}

/**
 * Restore scroll position based on anchor
 */
export async function restoreAnchor(gridContainer, anchor) {
    if (!anchor) return;

    const state = getOrCreateState(gridContainer);
    const scrollContainer = _getScrollContainer(gridContainer, state);
    if (!scrollContainer) return;

    // Wait for layout to complete
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    const el = findAssetElement(gridContainer, anchor.id);
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const containerRect = gridContainer.getBoundingClientRect();
    const delta = (rect.top - containerRect.top) - anchor.top;

    scrollContainer.scrollTop = (scrollContainer.scrollTop || 0) + delta;
}

/**
 * Check if user is at bottom of grid (within threshold)
 */
export function isAtBottom(gridContainer, threshold = null) {
    const state = getOrCreateState(gridContainer);
    const scrollContainer = _getScrollContainer(gridContainer, state);
    if (!scrollContainer) return false;

    const effectiveThreshold = Number(threshold) || Number(APP_CONFIG.BOTTOM_GAP_PX) || 80;
    const atBottom = (scrollContainer.scrollHeight - (scrollContainer.scrollTop + scrollContainer.clientHeight)) < effectiveThreshold;
    return atBottom;
}

/**
 * Scroll to bottom of grid
 */
export function scrollToBottom(gridContainer) {
    const state = getOrCreateState(gridContainer);
    const scrollContainer = _getScrollContainer(gridContainer, state);
    if (!scrollContainer) return;
    scrollContainer.scrollTop = scrollContainer.scrollHeight;
}

/**
 * Force specific refresh of the grid visuals (e.g. after settings change).
 */
export function refreshGrid(gridContainer) {
    try {
        const state = GRID_STATE.get(gridContainer);
        if (state && state.virtualGrid && state.assets) {
            // Update VirtualGrid layout config from global settings
            if (state.virtualGrid.updateConfig) {
                 state.virtualGrid.updateConfig({
                     minItemWidth: APP_CONFIG.GRID_MIN_SIZE,
                     gap: APP_CONFIG.GRID_GAP
                 });
            }
            
            // Re-setting items triggers a re-render of the visible range.
            // Pass force=true to ensure Card.js re-reads APP_CONFIG for badges/details updates.
            state.virtualGrid.setItems(state.assets, true);
        }
    } catch {}
}

/**
 * Clear grid placeholder
 */
  export function clearGrid(gridContainer) {
      try {
          const state = GRID_STATE.get(gridContainer);
          if (state) {
              stopObserver(state);
              state.offset = 0;
              state.total = null;
              state.done = false;
              state.loading = false;
              state.seenKeys = new Set();
          }
      } catch {}
      clearGridMessage(gridContainer);
      setGridMessage(gridContainer, "Type to search or wait for the scan to finish");
  }

// [ISSUE 1] Real-time Refresh Implementation
// Manages the global scan-complete handlers so we can teardown on panel unload.
const GRID_SCAN_EVENT_NAMES = ["mjr-scan-complete", "mjr:scan-complete"];
let _gridScanListenersBound = false;

const _onScanComplete = (_e) => {
    try {
        if (typeof document === "undefined" || !document.querySelectorAll) return;
        const grids = document.querySelectorAll(".mjr-grid-container");
        for (const grid of grids) {
            try {
                if (!grid?.isConnected) continue;

                const state = GRID_STATE.get(grid);
                if (!state) continue;

                if (grid._mjrRefreshTimer) clearTimeout(grid._mjrRefreshTimer);

                grid._mjrRefreshTimer = setTimeout(() => {
                    grid._mjrRefreshTimer = null;
                    if (!grid.isConnected) return;
                    loadAssets(grid, state.query, { reset: true });
                }, 500);
            } catch (err) {
                console.warn("[Majoor] Auto-refresh error:", err);
            }
        }
    } catch {
        // swallow to avoid leaking errors into the global listener
    }
};

const _attachGridScanListeners = () => {
    if (_gridScanListenersBound) return;
    if (typeof window === "undefined") return;

    try {
        for (const name of GRID_SCAN_EVENT_NAMES) {
            window.addEventListener(name, _onScanComplete);
        }
        _gridScanListenersBound = true;
    } catch (err) {
        console.warn("Failed to register global scan listener:", err);
    }
};

const _detachGridScanListeners = () => {
    if (!_gridScanListenersBound) return;
    if (typeof window === "undefined") {
        _gridScanListenersBound = false;
        return;
    }

    try {
        for (const name of GRID_SCAN_EVENT_NAMES) {
            window.removeEventListener(name, _onScanComplete);
        }
    } catch (err) {
        console.warn("Failed to unregister global scan listener:", err);
    } finally {
        _gridScanListenersBound = false;
    }
};

export function bindGridScanListeners() {
    _attachGridScanListeners();
}

export function disposeGridScanListeners() {
    _detachGridScanListeners();
}

