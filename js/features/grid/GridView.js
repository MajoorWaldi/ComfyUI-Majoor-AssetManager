/**
 * Grid View Feature - Asset grid display
 */

import { get, hydrateAssetRatingTags } from "../../api/client.js";
import { buildListURL } from "../../api/endpoints.js";
import { createAssetCard } from "../../components/Card.js";
import { createRatingBadge, createTagsBadge } from "../../components/Badges.js";
import { APP_CONFIG } from "../../app/config.js";
import { getViewerInstance } from "../../components/Viewer.js";
// Context menus are bound by the panel (GridContextMenu) to avoid duplicate handlers.
import { ASSET_RATING_CHANGED_EVENT, ASSET_TAGS_CHANGED_EVENT } from "../../app/events.js";
import { safeDispatchCustomEvent } from "../../utils/events.js";
import { bindAssetDragStart } from "../dnd/DragDrop.js";

const GRID_STATE = new WeakMap();

const RT_HYDRATE_CONCURRENCY = APP_CONFIG.RT_HYDRATE_CONCURRENCY ?? 2;
const RT_HYDRATE_SEEN = new Set();
const RT_HYDRATE_SEEN_MAX = APP_CONFIG.RT_HYDRATE_SEEN_MAX ?? 20000;
const RT_HYDRATE_SEEN_TTL_MS = APP_CONFIG.RT_HYDRATE_SEEN_TTL_MS ?? (10 * 60 * 1000);
let rtHydrateSeenPruneBudget = 0;
let rtHydrateSeenLastPruneAt = 0;
const RT_HYDRATE_QUEUE = [];
let rtHydrateInflight = 0;

function pruneRatingTagsHydrateSeen() {
    // Avoid unbounded growth on large libraries; prune occasionally to keep perf predictable.
    const now = Date.now();
    const needsSizePrune = RT_HYDRATE_SEEN.size > RT_HYDRATE_SEEN_MAX;
    const needsTimePrune =
        rtHydrateSeenLastPruneAt > 0
        && (now - rtHydrateSeenLastPruneAt) > RT_HYDRATE_SEEN_TTL_MS
        && RT_HYDRATE_SEEN.size > Math.max(1000, Math.floor(RT_HYDRATE_SEEN_MAX / 4));

    if (!needsSizePrune && !needsTimePrune) return;
    if (rtHydrateSeenPruneBudget > 0) {
        rtHydrateSeenPruneBudget -= 1;
        return;
    }
    rtHydrateSeenPruneBudget = APP_CONFIG.RT_HYDRATE_PRUNE_BUDGET ?? 250;
    rtHydrateSeenLastPruneAt = now;

    try {
        const keep = new Set();
        // Keep items that are still queued/in-flight first.
        for (const job of RT_HYDRATE_QUEUE) {
            if (job?.id) keep.add(String(job.id));
        }
        // Keep up to half of the max from the existing set (in insertion order).
        const target = Math.max(1000, Math.floor(RT_HYDRATE_SEEN_MAX / 2));
        if (keep.size < target) {
            for (const id of RT_HYDRATE_SEEN) {
                keep.add(id);
                if (keep.size >= target) break;
            }
        }
        RT_HYDRATE_SEEN.clear();
        for (const id of keep) RT_HYDRATE_SEEN.add(id);
    } catch {}
}

function _updateCardRatingTagsBadges(card, rating, tags) {
    if (!card) return;
    const thumb = card.querySelector?.(".mjr-thumb");
    if (!thumb) return;

    const nextRatingBadge = createRatingBadge(rating || 0);
    const oldRatingBadge = thumb.querySelector?.(".mjr-rating-badge");
    if (oldRatingBadge && nextRatingBadge) {
        oldRatingBadge.replaceWith(nextRatingBadge);
    } else if (oldRatingBadge && !nextRatingBadge) {
        oldRatingBadge.remove();
    } else if (!oldRatingBadge && nextRatingBadge) {
        thumb.appendChild(nextRatingBadge);
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

function _pumpRatingTagsHydration() {
    while (rtHydrateInflight < RT_HYDRATE_CONCURRENCY && RT_HYDRATE_QUEUE.length) {
        const job = RT_HYDRATE_QUEUE.shift();
        if (!job) break;
        rtHydrateInflight += 1;
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
                rtHydrateInflight -= 1;
                _pumpRatingTagsHydration();
            });
    }
}

function enqueueRatingTagsHydration(card, asset) {
    const id = asset?.id != null ? String(asset.id) : "";
    if (!id) return;
    if (RT_HYDRATE_SEEN.has(id)) return;

    const rating = Number(asset?.rating || 0) || 0;
    const tags = asset?.tags;
    const tagsEmpty = !(Array.isArray(tags) && tags.length);
    if (rating > 0 && !tagsEmpty) {
        RT_HYDRATE_SEEN.add(id);
        return;
    }

    // Hydrate only when both are missing in DB (avoid extra IO).
    if (rating > 0 || !tagsEmpty) {
        RT_HYDRATE_SEEN.add(id);
        return;
    }

    RT_HYDRATE_SEEN.add(id);
    pruneRatingTagsHydrateSeen();
    RT_HYDRATE_QUEUE.push({ id, card, asset });
    _pumpRatingTagsHydration();
}

/**
 * Create grid container
 */
export function createGridContainer() {
    const container = document.createElement("div");
    container.id = "mjr-assets-grid";
    container.classList.add("mjr-grid");
    container.style.setProperty("--mjr-grid-min-size", `${APP_CONFIG.GRID_MIN_SIZE}px`);
    container.style.setProperty("--mjr-grid-gap", `${APP_CONFIG.GRID_GAP}px`);

    // Bind delegated dragstart once (avoid per-card listeners; improves load perf on large grids).
    try {
        bindAssetDragStart(container);
    } catch {}

    // Bind double-click to open viewer
    container.addEventListener('dblclick', (e) => {
        const card = e.target.closest('.mjr-asset-card');
        if (!card) return;

        const asset = card._mjrAsset;
        if (!asset) return;

        // Get all assets in current grid for navigation
        const allCards = Array.from(container.querySelectorAll('.mjr-asset-card'));
        const allAssets = allCards.map(c => c._mjrAsset).filter(Boolean);
        const currentIndex = allAssets.findIndex(a => a.id === asset.id);

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
            sentinel: null,
            observer: null,
            scrollRoot: null,
            scrollHandler: null,
            ignoreNextScroll: false,
            userScrolled: false,
            allowUntilFilled: true
        };
        GRID_STATE.set(gridContainer, state);
    }
    return state;
}

function assetKey(asset) {
    if (!asset || typeof asset !== "object") return "";
    if (asset.id != null) return `id:${asset.id}`;
    const fp = asset.filepath || "";
    const t = asset.type || "";
    const rid = asset.root_id || asset.rootId || asset.custom_root_id || "";
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

function appendAssets(gridContainer, assets, state) {
    const selectedIds = getSelectedIdSet(gridContainer);
    const frag = document.createDocumentFragment();
    const newAssets = [];
    let added = 0;
    for (const asset of assets || []) {
        const key = assetKey(asset);
        if (!key) continue;
        if (state.seenKeys.has(key)) continue;
        state.seenKeys.add(key);
        newAssets.push(asset);
        const card = createAssetCard(asset);
        try {
            const id = asset?.id != null ? String(asset.id) : "";
            if (id && selectedIds.has(id)) {
                card.classList.add("is-selected");
                card.setAttribute?.("aria-selected", "true");
            }
        } catch {}
        frag.appendChild(card);
        // Best-effort: hydrate existing OS rating/tags (if DB empty) without requiring a full rescan.
        enqueueRatingTagsHydration(card, asset);
        added += 1;
    }
    if (added > 0) {
        try {
            state.assets.push(...newAssets);
        } catch {}
        gridContainer.appendChild(frag);
        // Update context menu asset list (bind is idempotent).
        // Context menus are bound by the panel.
    }
    return added;
}

function ensureSentinel(gridContainer, state) {
    let sentinel = state.sentinel;
    if (sentinel && sentinel.isConnected) return sentinel;
    sentinel = document.createElement("div");
    sentinel.className = SENTINEL_CLASS;
    // Ensure it's always placed at the end of the grid and spans all columns.
    // This stabilizes IntersectionObserver triggering as the panel resizes.
    sentinel.style.cssText = "height: 1px; width: 100%; grid-column: 1 / -1;";
    state.sentinel = sentinel;
    gridContainer.appendChild(sentinel);
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
        if (state.scrollRoot && state.scrollHandler) {
            state.scrollRoot.removeEventListener("scroll", state.scrollHandler, { passive: true });
        }
    } catch {}
    state.scrollRoot = null;
    state.scrollHandler = null;
    state.ignoreNextScroll = false;
    state.userScrolled = false;
    state.allowUntilFilled = true;
}

function captureScrollMetrics(state) {
    const root = state?.scrollRoot;
    if (!root) return null;
    const clientHeight = Number(root.clientHeight) || 0;
    const scrollHeight = Number(root.scrollHeight) || 0;
    const scrollTop = Number(root.scrollTop) || 0;
    const bottomGap = scrollHeight - (scrollTop + clientHeight);
    return { clientHeight, scrollHeight, scrollTop, bottomGap };
}

function maybeKeepPinnedToBottom(state, before) {
    const root = state?.scrollRoot;
    if (!root || !before) return;

    // If the user was effectively at the bottom before we appended, keep them pinned
    // to avoid the scrollbar "jumping up" when new content increases scrollHeight.
    if (before.bottomGap <= 2) {
        try {
            state.ignoreNextScroll = true;
            root.scrollTop = root.scrollHeight - root.clientHeight;
        } catch {}
    }
}

async function fetchPage(gridContainer, query, limit, offset) {
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
        const result = await get(url);

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
            return { ok: false, error: result.error };
        }
    } catch (error) {
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
    try {
        const page = await fetchPage(gridContainer, state.query, limit, state.offset);
        const dateExact = String(gridContainer?.dataset?.mjrFilterDateExact || "").trim();
        emitAgendaStatus(dateExact, page.ok && Array.isArray(page.assets) && page.assets.length > 0);
        if (!page.ok) {
            state.done = true;
            stopObserver(state);
            const p = document.createElement("p");
            p.className = "mjr-muted";
            p.style.color = "var(--error-text, #f44336)";
            p.textContent = `Error: ${page.error}`;
            gridContainer.appendChild(p);
            return;
        }

        if (page.total != null) {
            state.total = page.total;
        }
        const added = appendAssets(gridContainer, page.assets || [], state);
        state.offset += (page.count || 0);

        maybeKeepPinnedToBottom(state, before);

        const hasTotal = state.total != null && Number(state.total) > 0;
        if ((page.count || 0) === 0 || added === 0 || (hasTotal && state.offset >= Number(state.total))) {
            state.done = true;
            stopObserver(state);
        }
    } finally {
        state.loading = false;
    }
}

function startInfiniteScroll(gridContainer, state) {
    if (!APP_CONFIG.INFINITE_SCROLL_ENABLED) return;
    stopObserver(state);
    const sentinel = ensureSentinel(gridContainer, state);
    const rootEl = gridContainer.closest(".mjr-am-browse") || gridContainer.parentElement || null;

    state.scrollRoot = rootEl;
    state.userScrolled = false;
    state.allowUntilFilled = true;
    state.ignoreNextScroll = false;

    if (rootEl && !state.scrollHandler) {
        state.scrollHandler = () => {
            if (state.ignoreNextScroll) {
                state.ignoreNextScroll = false;
                return;
            }
            state.userScrolled = true;
        };
        try {
            rootEl.addEventListener("scroll", state.scrollHandler, { passive: true });
        } catch {}
    }

    state.observer = new IntersectionObserver(
        (entries) => {
            for (const entry of entries || []) {
                if (!entry.isIntersecting) continue;
                if (state.loading || state.done) return;

                // Prevent repeated auto-loads when new content is appended while the user
                // stays pinned at the bottom. Require a user scroll between loads unless
                // the grid doesn't fill the viewport yet (initial fill).
                const metrics = captureScrollMetrics(state);
                const fillsViewport = metrics ? metrics.scrollHeight > metrics.clientHeight + 40 : true;
                if (!state.userScrolled && fillsViewport && !state.allowUntilFilled) {
                    return;
                }
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
            root: rootEl,
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
        stopObserver(state);
        state.offset = 0;
        state.total = null;
        state.done = false;
        state.loading = false;
        state.seenKeys = new Set();
        state.assets = [];
        gridContainer.innerHTML = "";
        showLoadingOverlay(gridContainer, state.query === "*" ? "Loading assets..." : `Searching for "${state.query}"...`);
    }

    try {
        await loadNextPage(gridContainer, state);

        if (reset) {
            hideLoadingOverlay(gridContainer);
            const hasCards = gridContainer.querySelector(".mjr-card") != null;
            if (!hasCards && state.offset === 0) {
                gridContainer.innerHTML = "";
                const p = document.createElement("p");
                p.className = "mjr-muted";
                p.textContent = "No assets found";
                gridContainer.appendChild(p);
            } else {
                startInfiniteScroll(gridContainer, state);
            }
        }
        return { ok: true, count: state.offset, total: state.total || 0 };
    } catch (err) {
        stopObserver(state);
        if (reset) hideLoadingOverlay(gridContainer);
        gridContainer.innerHTML = "";
        const p = document.createElement("p");
        p.className = "mjr-muted";
        p.style.color = "var(--error-text, #f44336)";
        p.textContent = `Failed to load assets: ${err?.message || err}`;
        gridContainer.appendChild(p);
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
        gridContainer.innerHTML = "";
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
            const hasCards = gridContainer.querySelector(".mjr-card") != null;
            if (!hasCards) {
                gridContainer.innerHTML = "";
                const p = document.createElement("p");
                p.className = "mjr-muted";
                p.textContent = "No assets found";
                gridContainer.appendChild(p);
            }
        }

        return { ok: true, count: sorted.length, total: sorted.length };
    } catch (err) {
        stopObserver(state);
        if (reset) hideLoadingOverlay(gridContainer);
        gridContainer.innerHTML = "";
        const p = document.createElement("p");
        p.className = "mjr-muted";
        p.style.color = "var(--error-text, #f44336)";
        p.textContent = `Failed to load collection: ${err?.message || err}`;
        gridContainer.appendChild(p);
        return { ok: false, error: err?.message || String(err) };
    } finally {
        if (reset) hideLoadingOverlay(gridContainer);
    }
}

export function disposeGrid(gridContainer) {
    const state = GRID_STATE.get(gridContainer);
    if (!state) return;
    stopObserver(state);
    try {
        state.seenKeys?.clear?.();
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
 * Update or insert a single asset in the grid
 */
export function upsertAsset(gridContainer, asset) {
    if (!asset || !asset.id) return false;

    const state = getOrCreateState(gridContainer);
    const assetId = String(asset.id);
    const key = assetKey(asset);

    // Check if asset already exists in the grid
    const existingElement = findAssetElement(gridContainer, assetId);

    if (existingElement) {
        // Update existing asset
        const existingAsset = existingElement._mjrAsset;
        if (existingAsset) {
            // Check if the existing element was selected before replacement
            const wasSelected = existingElement.classList.contains("is-selected");
            const wasAriaSelected = existingElement.getAttribute("aria-selected");

            // Update the asset data
            Object.assign(existingAsset, asset);
            // Update the card display
            const card = createAssetCard(asset);

            // Preserve selection state after replacement
            if (wasSelected) {
                card.classList.add("is-selected");
            }
            if (wasAriaSelected) {
                card.setAttribute("aria-selected", wasAriaSelected);
            }

            existingElement.replaceWith(card);
            return true;
        }
    } else {
        // Check if asset key is already in seen keys
        if (!state.seenKeys.has(key)) {
            // Insert new asset
            const selectedIds = getSelectedIdSet(gridContainer);
            const card = createAssetCard(asset);
            try {
                if (selectedIds.has(assetId)) {
                    card.classList.add("is-selected");
                    card.setAttribute?.("aria-selected", "true");
                }
            } catch {}

            // Determine sort order from grid container
            const sortKey = gridContainer.dataset.mjrSort || "mtime_desc";

            // Insert at the appropriate position based on sort order
            const allCards = Array.from(gridContainer.querySelectorAll('.mjr-asset-card'));
            let insertIndex = -1;

            // Find the correct position based on sort order
            const assetValue = getSortValue(asset, sortKey);
            for (let i = 0; i < allCards.length; i++) {
                const cardAsset = allCards[i]._mjrAsset;
                const cardValue = getSortValue(cardAsset, sortKey);

                if (shouldInsertBefore(assetValue, cardValue, sortKey)) {
                    insertIndex = i;
                    break;
                }
            }

            if (insertIndex === -1) {
                // Append to end if no earlier asset found
                gridContainer.appendChild(card);
            } else {
                // Insert at the calculated position
                gridContainer.insertBefore(card, allCards[insertIndex]);
            }

            // Add to seen keys and assets array in correct sort position
            state.seenKeys.add(key);
            const insertPos = findInsertPosition(state.assets, asset, sortKey);
            if (insertPos === -1) {
                state.assets.push(asset);
            } else {
                state.assets.splice(insertPos, 0, asset);
            }

            // Bind context menu and drag start
            // Context menus are bound by the panel.
            bindAssetDragStart(gridContainer);

            // Hydrate rating/tags if needed
            enqueueRatingTagsHydration(card, asset);

            return true;
        }
    }

    return false;
}

/**
 * Capture scroll anchor before making changes
 */
export function captureAnchor(gridContainer) {
    const state = getOrCreateState(gridContainer);
    const selectedElement = gridContainer.querySelector('.mjr-asset-card.is-selected');
    const firstVisibleElement = getFirstVisibleAssetElement(gridContainer);

    const el = selectedElement || firstVisibleElement;
    if (!el) return null;

    const rect = el.getBoundingClientRect();
    const containerRect = gridContainer.getBoundingClientRect();

    return {
        id: el.dataset.mjrAssetId,
        top: rect.top - containerRect.top,
        scrollTop: gridContainer.parentElement?.scrollTop || 0
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

    // Wait for layout to complete
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    const el = findAssetElement(gridContainer, anchor.id);
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const containerRect = gridContainer.getBoundingClientRect();
    const delta = (rect.top - containerRect.top) - anchor.top;

    const parent = gridContainer.parentElement;
    if (parent) {
        parent.scrollTop = (parent.scrollTop || 0) + delta;
    }
}

/**
 * Check if user is at bottom of grid (within threshold)
 */
export function isAtBottom(gridContainer, threshold = 80) {
    const parent = gridContainer.parentElement;
    if (!parent) return false;

    const atBottom = (parent.scrollHeight - (parent.scrollTop + parent.clientHeight)) < threshold;
    return atBottom;
}

/**
 * Scroll to bottom of grid
 */
export function scrollToBottom(gridContainer) {
    const parent = gridContainer.parentElement;
    if (parent) {
        parent.scrollTop = parent.scrollHeight;
    }
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
    gridContainer.innerHTML = "";
    const p = document.createElement("p");
    p.className = "mjr-muted";
    p.textContent = "Type to search or wait for the scan to finish";
    gridContainer.appendChild(p);
}
