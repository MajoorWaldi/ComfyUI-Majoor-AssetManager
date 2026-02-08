import { createWorkflowDot } from "../../../components/Badges.js";
import { post, getAssetMetadata } from "../../../api/client.js";
import { ENDPOINTS } from "../../../api/endpoints.js";
import { pickRootId } from "../../../utils/ids.js";
import { safeClosest } from "../../../utils/dom.js";
import { comfyToast } from "../../../app/toast.js";

const RESCAN_FLAG = "_mjrRescanning";
const RESCAN_TTL_MS = 1500;

async function rescanSingleAsset({ card, asset, sidebar, onAssetUpdated }) {
    if (!card || !asset) return;

    try {
        const now = Date.now();
        const last = Number(card[RESCAN_FLAG] || 0) || 0;
        if (now - last < RESCAN_TTL_MS) return;
        card[RESCAN_FLAG] = now;
    } catch {}

    const dot = card.querySelector(".mjr-workflow-dot");
    try {
        if (dot) {
            dot.style.color = "var(--mjr-status-info, #64B5F6)";
            dot.style.cursor = "progress";
            dot.title = "Rescanning…";
        }
    } catch {}

    try { comfyToast("Rescanning file…", "info", 2000); } catch {}

    const fileEntry = {
        filename: asset.filename,
        subfolder: asset.subfolder || "",
        type: String(asset.type || "output").toLowerCase(),
        root_id: pickRootId(asset) || undefined,
    };

    let updated = null;
    try {
        await post(ENDPOINTS.INDEX_FILES, { files: [fileEntry], incremental: false });

        if (asset.id != null) {
            const fresh = await getAssetMetadata(asset.id);
            if (fresh?.ok && fresh.data) {
                updated = { ...asset, ...fresh.data };
            }
        }
    } catch {}

    try {
        if (updated) {
            card._mjrAsset = updated;
            if (typeof onAssetUpdated === "function") onAssetUpdated(updated);

            // If sidebar is open on this asset, refresh it without changing selection.
            try {
                if (sidebar?.classList?.contains?.("is-open")) {
                    const curId = sidebar?._currentAsset?.id ?? sidebar?._currentFullAsset?.id ?? null;
                    if (curId != null && String(curId) === String(updated.id)) {
                        // The caller owns showAssetInSidebar; handled externally.
                        sidebar._mjrNeedsRefresh = true;
                    }
                }
            } catch {}
        }
    } finally {
        try {
            // If the dot is still in the DOM (scan failed, dot not replaced by onAssetUpdated),
            // restore it to its original state so it doesn't stay stuck on blue/pending.
            if (dot && dot.isConnected) {
                const restored = createWorkflowDot(asset);
                if (restored) dot.replaceWith(restored);
            }
        } catch {
            try { if (dot) dot.style.cursor = ""; } catch {}
        }
    }

    return updated;
}

function setSelectedCard(gridContainer, selectedCard) {
    if (!gridContainer) return;
    try {
        const prev = gridContainer.querySelector(".mjr-asset-card.is-selected");
        if (prev && prev !== selectedCard) {
            prev.classList.remove("is-selected");
            prev.setAttribute?.("aria-selected", "false");
        }
    } catch {}
    if (selectedCard) {
        selectedCard.classList.add("is-selected");
        selectedCard.setAttribute?.("aria-selected", "true");
        try {
            const id = selectedCard.dataset?.mjrAssetId;
            if (id) gridContainer.dataset.mjrSelectedAssetId = String(id);
        } catch {}
        try {
            selectedCard.focus?.({ preventScroll: true });
        } catch {
            try {
                selectedCard.focus?.();
            } catch {}
        }
        try {
            selectedCard.scrollIntoView?.({ block: "nearest", inline: "nearest" });
        } catch {}
    }
}

const escapeAttributeValue = (value) => {
    if (value == null) return "";
    try {
        if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
            return CSS.escape(String(value));
        }
    } catch {}
    return String(value).replace(/["\\]/g, "\\$&");
};

function queryCardById(gridContainer, assetId) {
    if (!gridContainer || !assetId) return null;
    try {
        return gridContainer.querySelector(`.mjr-asset-card[data-mjr-asset-id="${escapeAttributeValue(assetId)}"]`);
    } catch {}
    try {
        return gridContainer.querySelector(`.mjr-asset-card[data-mjr-asset-id="${String(assetId).replace(/["\\]/g, "\\$&")}"]`);
    } catch {}
    return null;
}

function getActiveCardElement(gridContainer) {
    if (!gridContainer) return null;
    const activeId = gridContainer.dataset?.mjrSelectedAssetId;
    if (activeId) {
        const card = queryCardById(gridContainer, activeId);
        if (card) return card;
    }
    const selectedIds = gridContainer.dataset?.mjrSelectedAssetIds;
    if (selectedIds) {
        try {
            const parsed = JSON.parse(selectedIds);
            if (Array.isArray(parsed) && parsed.length) {
                const card = queryCardById(gridContainer, parsed[0]);
                if (card) return card;
            }
        } catch {}
    }
    return gridContainer.querySelector(".mjr-asset-card.is-selected");
}

function focusCardElement(card, { preventScroll = true } = {}) {
    if (!card) return;
    try {
        card.focus?.({ preventScroll });
    } catch {
        try {
            card.focus?.();
        } catch {}
    }
}

function focusActiveCard(gridContainer, { force = false } = {}) {
    if (!gridContainer) return;
    if (!force && !gridContainer._mjrFocusWithin) return;
    const card = getActiveCardElement(gridContainer);
    if (!card) return;
    focusCardElement(card);
    gridContainer._mjrFocusWithin = true;
}

function ensureSelectionVisible(gridContainer) {
    if (!gridContainer) return;

    try {
        const selected = getActiveCardElement(gridContainer);
        if (!selected) return;
        const root = gridContainer.parentElement;
        if (root && typeof root.getBoundingClientRect === "function" && typeof selected.getBoundingClientRect === "function") {
            const rootRect = root.getBoundingClientRect();
            const selRect = selected.getBoundingClientRect();
            const fullyVisible = selRect.top >= rootRect.top && selRect.bottom <= rootRect.bottom;
            if (fullyVisible) return;
        }
        selected.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    } catch {}
}

function scheduleEnsureSelectionVisible(gridContainer) {
    const runOnce = () => {
        try {
            ensureSelectionVisible(gridContainer);
        } catch {}
        try {
            focusActiveCard(gridContainer);
        } catch {}
    };
    try {
        requestAnimationFrame(() => {
            runOnce();
            // Second pass after layout settles (sidebar open/close).
            setTimeout(() => {
                runOnce();
            }, 50);
        });
    } catch {
        runOnce();
    }
}

function setCardSelected(card, selected) {
    if (!card) return;
    if (selected) {
        card.classList.add("is-selected");
        card.setAttribute?.("aria-selected", "true");
    } else {
        card.classList.remove("is-selected");
        card.setAttribute?.("aria-selected", "false");
    }
}

function getAllCards(gridContainer) {
    try {
        return Array.from(gridContainer.querySelectorAll(".mjr-asset-card"));
    } catch {
        return [];
    }
}

function updateSelectedIdsDataset(gridContainer) {
    if (!gridContainer) return;
    try {
        const ids = Array.from(gridContainer.querySelectorAll(".mjr-asset-card.is-selected"))
            .map((c) => c?.dataset?.mjrAssetId)
            .filter(Boolean);
        if (ids.length) {
            gridContainer.dataset.mjrSelectedAssetIds = JSON.stringify(ids);
            if (!gridContainer.dataset.mjrSelectedAssetId && ids[0]) {
                gridContainer.dataset.mjrSelectedAssetId = String(ids[0]);
            }
        } else {
            delete gridContainer.dataset.mjrSelectedAssetIds;
            delete gridContainer.dataset.mjrSelectedAssetId;
        }
    } catch {}
}

function applySelection(gridContainer, ids, activeId = "") {
    if (!gridContainer) return [];
    const list = Array.from(ids || []).map(String).filter(Boolean);
    try {
        if (typeof gridContainer?._mjrSetSelection === "function") {
            gridContainer._mjrSetSelection(list, activeId || list[0] || "");
            return list;
        }
    } catch {}
    try {
        gridContainer.dataset.mjrSelectedAssetIds = list.length ? JSON.stringify(list) : "";
        if (list.length) gridContainer.dataset.mjrSelectedAssetId = String(activeId || list[0] || "");
        else {
            delete gridContainer.dataset.mjrSelectedAssetIds;
            delete gridContainer.dataset.mjrSelectedAssetId;
        }
    } catch {}
    try {
        for (const card of gridContainer.querySelectorAll(".mjr-asset-card")) {
            const id = card?.dataset?.mjrAssetId;
            const selected = id && list.includes(String(id));
            setCardSelected(card, !!selected);
        }
    } catch {}
    try {
        gridContainer.dispatchEvent?.(
            new CustomEvent("mjr:selection-changed", { detail: { selectedIds: list, activeId: activeId || list[0] || "" } })
        );
    } catch {}
    return list;
}

function syncSelectionState({ gridContainer, state, activeId } = {}) {
    if (!state || !gridContainer) return;
    try {
        let selected = [];
        if (gridContainer.dataset?.mjrSelectedAssetIds) {
            try {
                const parsed = JSON.parse(gridContainer.dataset.mjrSelectedAssetIds);
                if (Array.isArray(parsed)) selected = parsed.map(String).filter(Boolean);
            } catch {}
        } else if (gridContainer.dataset?.mjrSelectedAssetId) {
            selected = [String(gridContainer.dataset.mjrSelectedAssetId)].filter(Boolean);
        } else {
            selected = Array.from(gridContainer.querySelectorAll(".mjr-asset-card.is-selected"))
                .map((c) => c?.dataset?.mjrAssetId)
                .filter(Boolean)
                .map(String);
        }

        state.selectedAssetIds = selected;
        if (activeId != null) state.activeAssetId = String(activeId);
        else if (state.activeAssetId && selected.includes(String(state.activeAssetId))) {
            // keep existing active
        } else {
            state.activeAssetId = selected[0] || "";
        }
    } catch {}
}

export function bindSidebarOpen({
      gridContainer,
      sidebar,
      createRatingBadge,
      createTagsBadge,
      showAssetInSidebar,
      closeSidebar,
      state
  }) {
      if (!gridContainer) return { dispose: () => {} };
      if (gridContainer._mjrSidebarOpenBound) {
          return { dispose: gridContainer._mjrSidebarOpenDispose || (() => {}) };
      }
      gridContainer._mjrSidebarOpenBound = true;

    const onGridFocusIn = (event) => {
        gridContainer._mjrFocusWithin = true;
        const card = safeClosest(event.target, ".mjr-asset-card");
        if (card) {
            try {
                gridContainer._mjrLastFocusedCardId = card.dataset?.mjrAssetId || "";
            } catch {}
        }
    };

    const onGridFocusOut = (event) => {
        const related = event?.relatedTarget;
        if (related && gridContainer.contains(related)) return;
        gridContainer._mjrFocusWithin = false;
    };

    try {
        gridContainer.addEventListener("focusin", onGridFocusIn);
        gridContainer.addEventListener("focusout", onGridFocusOut);
    } catch {}

    // Keep selection visible when the panel/grid resizes (column wrap changes can move the selected card).
    // The VirtualGrid repositions cards after a 100ms debounce, so we need multiple passes
    // to ensure we scroll after the grid has finished re-laying out.
    try {
        if (!gridContainer._mjrSelectionResizeObserver) {
            const scrollRoot = gridContainer.parentElement;
            let raf = null;
            let timer = null;
            const schedule = () => {
                if (raf) cancelAnimationFrame(raf);
                if (timer) clearTimeout(timer);
                // First pass: immediate after layout
                raf = requestAnimationFrame(() => {
                    raf = null;
                    ensureSelectionVisible(gridContainer);
                });
                // Second pass: after VirtualGrid debounce (100ms) + render
                timer = setTimeout(() => {
                    timer = null;
                    ensureSelectionVisible(gridContainer);
                }, 160);
            };

            const ro = new ResizeObserver(() => schedule());
            if (scrollRoot) ro.observe(scrollRoot);
            ro.observe(gridContainer);
            gridContainer._mjrSelectionResizeObserver = ro;
        }
    } catch {}

    const applyAssetUpdateToCard = (card, asset, updatedAsset) => {
        // Keep workflow/gen flags (and dot) in sync when backend self-heals metadata.
        try {
            const nextHasWorkflow = updatedAsset?.has_workflow ?? updatedAsset?.hasWorkflow ?? asset.has_workflow;
            const nextHasGen =
                updatedAsset?.has_generation_data ??
                updatedAsset?.hasGenerationData ??
                asset.has_generation_data;

            if (nextHasWorkflow !== undefined) asset.has_workflow = nextHasWorkflow;
            if (nextHasGen !== undefined) asset.has_generation_data = nextHasGen;

            const oldDot = card.querySelector(".mjr-workflow-dot");
            const newDot = createWorkflowDot(asset);
            if (oldDot && newDot) oldDot.replaceWith(newDot);
        } catch {}

        if (updatedAsset?.rating !== undefined && updatedAsset.rating !== asset.rating) {
            asset.rating = updatedAsset.rating;
            const thumb = card.querySelector(".mjr-thumb");
            const oldRatingBadge = card.querySelector(".mjr-rating-badge");
            const newBadge = createRatingBadge(updatedAsset.rating || 0);

            if (oldRatingBadge && newBadge) {
                oldRatingBadge.replaceWith(newBadge);
            } else if (oldRatingBadge && !newBadge) {
                oldRatingBadge.remove();
            } else if (!oldRatingBadge && newBadge && thumb) {
                thumb.appendChild(newBadge);
            }
        }
        if (updatedAsset?.tags && JSON.stringify(updatedAsset.tags) !== JSON.stringify(asset.tags)) {
            asset.tags = updatedAsset.tags;
            const oldTagsBadge = card.querySelector(".mjr-tags-badge");
            if (oldTagsBadge) {
                const newBadge = createTagsBadge(updatedAsset.tags || []);
                oldTagsBadge.replaceWith(newBadge);
            }
        }
    };

    const onClick = async (e) => {
        if (e.defaultPrevented) return;

        const card = safeClosest(e.target, ".mjr-asset-card");
        if (!card) return;

        // Click on workflow dot triggers a forced re-index of this one file (no directory scan).
        const dot = safeClosest(e.target, ".mjr-workflow-dot");
        if (dot && card.contains(dot)) {
            const asset = card._mjrAsset;
            if (!asset) return;

            e.preventDefault();
            e.stopPropagation();

            // Ensure this card is selected, but do not open the sidebar from dot clicks.
            const id = card?.dataset?.mjrAssetId || "";
            applySelection(gridContainer, id ? [id] : [], id);
            syncSelectionState({ gridContainer, state, activeId: id });

            const updated = await rescanSingleAsset({
                card,
                asset,
                sidebar,
                onAssetUpdated: (u) => applyAssetUpdateToCard(card, asset, u),
            });

            // Refresh sidebar only if it is already open on this asset.
            try {
                const curId = sidebar?._currentAsset?.id ?? sidebar?._currentFullAsset?.id ?? null;
                if (updated && sidebar?.classList?.contains?.("is-open") && curId != null && String(curId) === String(updated.id)) {
                    await showAssetInSidebar(sidebar, updated, (u) => applyAssetUpdateToCard(card, asset, u));
                }
            } catch {}

            return;
        }

        const interactive = safeClosest(e.target, "a, button, input, textarea, select, label");
        if (interactive && card.contains(interactive)) return;

        const asset = card._mjrAsset;
        if (!asset) return;

        e.preventDefault();
        e.stopPropagation();

        const isMulti = !!(e.ctrlKey || e.metaKey || e.shiftKey);
        if (!isMulti) {
            const alreadySelected = card.classList.contains("is-selected");
            if (alreadySelected) {
                applySelection(gridContainer, [], "");
                syncSelectionState({ gridContainer, state, activeId: "" });
                return;
            }

            const id = card?.dataset?.mjrAssetId;
            applySelection(gridContainer, id ? [id] : [], id || "");
            syncSelectionState({ gridContainer, state, activeId: id || "" });

            // When the sidebar is already open, clicking a different card navigates details.
            try {
                if (sidebar?.classList?.contains?.("is-open")) {
                    showAssetInSidebar(sidebar, asset, (updatedAsset) => applyAssetUpdateToCard(card, asset, updatedAsset));
                }
            } catch {}
        } else {
            const cards = getAllCards(gridContainer);
            const idx = cards.indexOf(card);

            if (e.shiftKey) {
                let allAssets = [];
                try {
                    if (typeof gridContainer?._mjrGetAssets === "function") {
                        allAssets = gridContainer._mjrGetAssets() || [];
                    }
                } catch {}
                if (Array.isArray(allAssets) && allAssets.length) {
                    const id = card?.dataset?.mjrAssetId || "";
                    const targetIndex = allAssets.findIndex(a => String(a?.id || "") === String(id));
                    const last = Number(gridContainer._mjrLastSelectedIndex);
                    const anchor = Number.isFinite(last) ? last : targetIndex;
                    if (targetIndex >= 0 && anchor >= 0) {
                        const start = Math.min(anchor, targetIndex);
                        const end = Math.max(anchor, targetIndex);
                        const rangeIds = allAssets.slice(start, end + 1).map(a => String(a?.id || "")).filter(Boolean);
                        applySelection(gridContainer, rangeIds, id || rangeIds[0] || "");
                        gridContainer._mjrLastSelectedIndex = targetIndex;
                        syncSelectionState({ gridContainer, state, activeId: id || "" });
                        return;
                    }
                }
            }

            if (idx >= 0) {
                const nextSelected = !card.classList.contains("is-selected");
                setCardSelected(card, nextSelected);
                gridContainer._mjrLastSelectedIndex = idx;
            }
            updateSelectedIdsDataset(gridContainer);
            syncSelectionState({ gridContainer, state, activeId: card?.dataset?.mjrAssetId });
            return;
        }
        // Click only selects the asset (sidebar opens via hotkey/context menu).
        try {
            ensureSelectionVisible(gridContainer);
            card?.focus?.({ preventScroll: true });
        } catch {}
    };

    gridContainer.addEventListener("click", onClick);

    const openDetailsForSelection = async () => {
        const activeId = state?.activeAssetId ? String(state.activeAssetId) : "";
        let card = null;
        if (activeId) {
            try {
                card = gridContainer.querySelector(`.mjr-asset-card[data-mjr-asset-id="${CSS?.escape ? CSS.escape(activeId) : activeId}"]`);
            } catch {
                try {
                    card = gridContainer.querySelector(`.mjr-asset-card[data-mjr-asset-id="${activeId.replace(/["\\]/g, "\\$&")}"]`);
                } catch {}
            }
        }
        if (!card) {
            card = gridContainer.querySelector(".mjr-asset-card.is-selected");
        }
        const asset = card?._mjrAsset;
        if (!asset) return;

        // Ensure the card keeps selection and focus when the sidebar opens
        // (needed when triggered from the global hotkey which bypasses the grid keydown handler)
        setSelectedCard(gridContainer, card);
        updateSelectedIdsDataset(gridContainer);
        syncSelectionState({ gridContainer, state, activeId: card?.dataset?.mjrAssetId });

        try {
            const isOpen = !!sidebar?.classList?.contains?.("is-open");
            const curId = sidebar?._currentAsset?.id ?? sidebar?._currentFullAsset?.id ?? null;
            if (isOpen && curId != null && String(curId) === String(asset.id) && typeof closeSidebar === "function") {
                closeSidebar(sidebar);
                // Persist sidebar closed state
                try { state.sidebarOpen = false; } catch {}
                focusActiveCard(gridContainer, { force: true });
                scheduleEnsureSelectionVisible(gridContainer);
                return;
            }
        } catch {}

        try {
            await showAssetInSidebar(sidebar, asset, (updatedAsset) => applyAssetUpdateToCard(card, asset, updatedAsset));
            // Persist sidebar open state
            try { state.sidebarOpen = true; } catch {}
            scheduleEnsureSelectionVisible(gridContainer);
            card?.focus?.({ preventScroll: true });
        } catch {}
    };

    // Keyboard accessibility: toggle details from focused card.
    const onKeyDown = (e) => {
        if (e.defaultPrevented) return;
        const lower = e.key?.toLowerCase?.() || "";
        if (lower !== "d") return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const isTypingTarget =
            e.target?.isContentEditable ||
            e.target?.closest?.("input, textarea, select, [contenteditable='true']");
        if (isTypingTarget) return;
        const card = safeClosest(e.target, ".mjr-asset-card");
        if (!card) return;
        const asset = card._mjrAsset;
        if (!asset) return;
        e.preventDefault();
        e.stopPropagation();
        setSelectedCard(gridContainer, card);
        updateSelectedIdsDataset(gridContainer);
        syncSelectionState({ gridContainer, state, activeId: card?.dataset?.mjrAssetId });
        openDetailsForSelection();
    };
    gridContainer.addEventListener("keydown", onKeyDown);

    // Listen for sidebar close events (e.g. from the close button in sidebar header)
    const onSidebarClosed = () => {
        try { state.sidebarOpen = false; } catch {}
    };
    sidebar?.addEventListener?.("mjr:sidebar-closed", onSidebarClosed);

    try {
        gridContainer._mjrOpenDetails = openDetailsForSelection;
    } catch {}

    const dispose = () => {
        try {
            gridContainer.removeEventListener("click", onClick);
        } catch {}
        try {
            gridContainer.removeEventListener("focusin", onGridFocusIn);
        } catch {}
        try {
            gridContainer.removeEventListener("focusout", onGridFocusOut);
        } catch {}
        try {
            gridContainer.removeEventListener("keydown", onKeyDown);
        } catch {}
        try {
            sidebar?.removeEventListener?.("mjr:sidebar-closed", onSidebarClosed);
        } catch {}
        try {
            if (gridContainer._mjrOpenDetails === openDetailsForSelection) {
                delete gridContainer._mjrOpenDetails;
            }
        } catch {}
        try {
            gridContainer._mjrSelectionResizeObserver?.disconnect?.();
        } catch {}
        try {
            delete gridContainer._mjrSelectionResizeObserver;
        } catch {}
        try {
            delete gridContainer._mjrSidebarOpenBound;
        } catch {}
        try {
            delete gridContainer._mjrSidebarOpenDispose;
        } catch {}
    };

    gridContainer._mjrSidebarOpenDispose = dispose;
    return { dispose, toggleDetails: openDetailsForSelection };
}
