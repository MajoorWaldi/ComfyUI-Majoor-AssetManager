
import { comfyConfirm, comfyPrompt } from "../../app/dialogs.js";
import { comfyToast } from "../../app/toast.js";
import { createStatusIndicator, setupStatusPolling, triggerScan } from "../status/StatusDot.js";
import { createGridContainer, loadAssets, loadAssetsFromList, disposeGrid, refreshGrid } from "../grid/GridView.js";
import { get, post, getCollectionAssets, toggleWatcher, setWatcherScope } from "../../api/client.js";
import { ENDPOINTS } from "../../api/endpoints.js";
import { createSidebar, showAssetInSidebar, closeSidebar } from "../../components/SidebarView.js";
import { createRatingBadge, createTagsBadge } from "../../components/Badges.js";
import { loadMajoorSettings } from "../../app/settings.js";
import { createPopoverManager } from "./views/popoverManager.js";
import { createCollectionsPopoverView } from "../collections/views/collectionsPopoverView.js";
import { createCollectionsController } from "../collections/controllers/collectionsController.js";

import { createPanelState } from "./state/panelState.js";
import { createHeaderView } from "./views/headerView.js";
import { createCustomPopoverView } from "./views/customPopoverView.js";
import { createFilterPopoverView } from "./views/filterPopoverView.js";
import { createSortPopoverView } from "./views/sortPopoverView.js";
import { createSearchView } from "./views/searchView.js";
import { createSummaryBarView } from "./views/summaryBarView.js";
import { createAgendaCalendar } from "../filters/calendar/AgendaCalendar.js";

import { normalizeQuery } from "./controllers/query.js";
import { createGridController } from "./controllers/gridController.js";
import { createScopeController } from "./controllers/scopeController.js";
import { createContextController } from "./controllers/contextController.js";
import { createCustomRootsController } from "./controllers/customRootsController.js";
import { bindFilters } from "./controllers/filtersController.js";
import { createSortController } from "./controllers/sortController.js";
import { bindSidebarOpen } from "./controllers/sidebarController.js";
import { createPanelHotkeysController } from "./controllers/panelHotkeysController.js";
import { createRatingHotkeysController } from "./controllers/ratingHotkeysController.js";
import { bindGridContextMenu } from "../contextmenu/GridContextMenu.js";

let _activeGridContainer = null;

export function getActiveGridContainer() {
    // First try the cached reference
    if (_activeGridContainer && _activeGridContainer.isConnected) {
        return _activeGridContainer;
    }
    // Fallback: try to find it in the DOM by ID or class
    try {
        const grid = document.getElementById("mjr-assets-grid") || document.querySelector(".mjr-grid");
        if (grid && grid.isConnected) {
            return grid;
        }
    } catch {}
    return null;
}

export async function renderAssetsManager(container, { useComfyThemeUI = true } = {}) {
    if (useComfyThemeUI) {
        container.classList.add("mjr-assets-manager");
    } else {
        container.classList.remove("mjr-assets-manager");
    }

    // Cleanup previous instance before re-render to prevent listener leaks
    try {
        container._eventCleanup?.();
    } catch {}
    try {
        container._mjrPanelState?._mjrDispose?.();
    } catch {}
    try {
        container._mjrPopoverManager?.dispose?.();
    } catch {}
    try {
        container._mjrHotkeys?.dispose?.();
    } catch {}
    try {
        container._mjrRatingHotkeys?.dispose?.();
    } catch {}
    try {
        container._mjrSidebarController?.dispose?.();
    } catch {}
    try {
        container._mjrGridContextMenuUnbind?.();
    } catch {}

    container.innerHTML = "";
    container.classList.add("mjr-am-container");

    const popovers = createPopoverManager(container);
    try {
        container._mjrPopoverManager = popovers;
    } catch {}
    const state = createPanelState();
    try {
        container._mjrPanelState = state;
    } catch {}

    const headerView = createHeaderView();
    const { header, headerActions, tabButtons, customMenuBtn, filterBtn, sortBtn, collectionsBtn } = headerView;

    const { customPopover, customSelect, customAddBtn, customRemoveBtn } = createCustomPopoverView();
    const { filterPopover, kindSelect, wfCheckbox, ratingSelect, dateRangeSelect, dateExactInput, agendaContainer } = createFilterPopoverView();
    const { sortPopover, sortMenu } = createSortPopoverView();
    const { collectionsPopover, collectionsMenu } = createCollectionsPopoverView();

    headerActions.appendChild(customPopover);

    const { searchSection, searchInputEl } = createSearchView({
        filterBtn,
        sortBtn,
        collectionsBtn,
        filterPopover,
        sortPopover,
        collectionsPopover
    });
    
    // Restore persistent search query
    if (state.searchQuery) {
        searchInputEl.value = state.searchQuery;
    }
    searchInputEl.addEventListener("input", (e) => {
        state.searchQuery = e.target.value;
    });

    const { bar: summaryBar, update: updateSummaryBar } = createSummaryBarView();

    const content = document.createElement("div");
    content.classList.add("mjr-am-content");
    let gridContainer = null;

    container.tabIndex = -1;

    const statusSection = createStatusIndicator();
    const statusDot = statusSection.querySelector("#mjr-status-dot");
    const statusText = statusSection.querySelector("#mjr-status-text");
    const capabilitiesSection = statusSection.querySelector("#mjr-status-capabilities");

    const browseSection = document.createElement("div");
    browseSection.classList.add("mjr-am-browse");
    browseSection.style.cssText = `
        flex: 1;
        display: flex;
        flex-direction: row;
        overflow: hidden;
    `;

    const gridWrapper = document.createElement("div");
    gridWrapper.style.cssText = `
        flex: 1;
        overflow: auto;
        position: relative;
    `;

    // NOTE: Scroll restoration is done AFTER grid loads (see initialLoadPromise below).
    // Restoring scroll on an empty grid would be useless.
    
    let _scrollTimer = null;
    gridWrapper.addEventListener("scroll", () => {
        if (_scrollTimer) clearTimeout(_scrollTimer);
        _scrollTimer = setTimeout(() => {
            try {
                state.scrollTop = gridWrapper.scrollTop;
            } catch {}
        }, 100);
    }, { passive: true });

    gridContainer = createGridContainer();
    gridWrapper.appendChild(gridContainer);
    _activeGridContainer = gridContainer;

    // Bind grid context menu
    bindGridContextMenu({
        gridContainer,
        getState: () => state,
        onRequestOpenViewer: (asset) => {
            gridContainer?.dispatchEvent?.(new CustomEvent("mjr:open-viewer", { detail: { asset } }));
        },
    });

    const settings = loadMajoorSettings();
    const sidebar = createSidebar(settings.sidebar?.position || "right");

    let _sidebarPosition = "right";
    const applySidebarPosition = (nextPosition) => {
        const pos = String(nextPosition || "right").toLowerCase() === "left" ? "left" : "right";
        if (_sidebarPosition === pos) return;
        _sidebarPosition = pos;

        // Preserve grid scroll where possible.
        let scrollTop = 0;
        let scrollLeft = 0;
        try {
            scrollTop = Number(gridWrapper?.scrollTop || 0) || 0;
            scrollLeft = Number(gridWrapper?.scrollLeft || 0) || 0;
        } catch {}

        try {
            sidebar.dataset.position = pos;
        } catch {}

        try {
            if (pos === "left") {
                browseSection.appendChild(sidebar);
                browseSection.appendChild(gridWrapper);
                browseSection.insertBefore(sidebar, browseSection.firstChild);
            } else {
                browseSection.appendChild(gridWrapper);
                browseSection.appendChild(sidebar);
            }
        } catch {}

        try {
            requestAnimationFrame(() => {
                try {
                    gridWrapper.scrollTop = scrollTop;
                    gridWrapper.scrollLeft = scrollLeft;
                } catch {}
            });
        } catch {
            try {
                gridWrapper.scrollTop = scrollTop;
                gridWrapper.scrollLeft = scrollLeft;
            } catch {}
        }
    };

    const applyWatcherForScope = async (nextScope) => {
        const scope = String(nextScope || state.scope || "output").toLowerCase();
        const settings = loadMajoorSettings();
        const wantsEnabled = !!settings?.watcher?.enabled;
        const shouldEnable = wantsEnabled && scope === "output";
        try {
            await toggleWatcher(shouldEnable);
        } catch {}
        if (shouldEnable) {
            try {
                await setWatcherScope({ scope: "output" });
            } catch {}
        }
    };

    // Initial position (no reload needed).
    try {
        _sidebarPosition = ""; // force apply
        applySidebarPosition(settings.sidebar?.position || "right");
    } catch {}

    // Live updates when ComfyUI settings change.
    const onSettingsChanged = (e) => {
        try {
            const s = loadMajoorSettings();
            
            // 1. Sidebar position
            applySidebarPosition(s.sidebar?.position || "right");
            
            // 2. Grid visuals (badges, details, sizes)
            // Use key from event to optimize? For now, refresh is cheap (VirtualGrid).
            refreshGrid(gridWrapper);
        } catch {}
        try {
            applyWatcherForScope(state.scope);
        } catch {}
    };
    try {
        window.addEventListener?.("mjr-settings-changed", onSettingsChanged);
    } catch {}

    content.appendChild(statusSection);
    content.appendChild(searchSection);
    content.appendChild(summaryBar);
    content.appendChild(browseSection);
    container.appendChild(header);
    try {
        container._mjrVersionUpdateCleanup?.();
    } catch {}
    container._mjrVersionUpdateCleanup = header._mjrVersionUpdateCleanup;
    container.appendChild(content);

    const getQuery = () => normalizeQuery(searchInputEl);
    const gridController = createGridController({
        gridContainer,
        loadAssets,
        loadAssetsFromList,
        getCollectionAssets,
        disposeGrid,
        getQuery,
        state
    });

    let scopeController = null;
    let sortController = null;
    let contextController = null;
    const notifyContextChanged = () => {
        try {
            contextController?.update?.();
        } catch {}
    };

    // Allow context menus to request a refresh (e.g. after "Remove from collection").
    try {
        gridContainer.addEventListener("mjr:reload-grid", () => {
            try {
                gridController.reloadGrid();
            } catch {}
        });
    } catch {}

    const customRootsController = createCustomRootsController({
        state,
        customSelect,
        customRemoveBtn,
        comfyConfirm,
        comfyPrompt,
        comfyToast,
        get,
        post,
        ENDPOINTS,
        reloadGrid: gridController.reloadGrid
    });
    customRootsController.bind({ customAddBtn, customRemoveBtn });

    scopeController = createScopeController({
        state,
        tabButtons,
        customMenuBtn,
        customPopover,
        popovers,
        refreshCustomRoots: customRootsController.refreshCustomRoots,
        reloadGrid: gridController.reloadGrid,
        onChanged: () => {
            notifyContextChanged();
        },
        onScopeChanged: async () => {
            try {
                await applyWatcherForScope(state.scope);
            } catch {}
        }
    });

    if (!header._mjrTabListenersBound) {
        Object.values(tabButtons).forEach((btn) => {
            btn.addEventListener("click", () => scopeController.setScope(btn.dataset.scope));
        });
        header._mjrTabListenersBound = true;
    }

    popovers.setDismissWhitelist([
        customPopover,
        filterPopover,
        sortPopover,
        collectionsPopover,
        customMenuBtn,
        filterBtn,
        sortBtn,
        collectionsBtn
    ]);

    customMenuBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        popovers.close(filterPopover);
        popovers.close(sortPopover);
        popovers.toggle(customPopover, customMenuBtn);
    });

    filterBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        popovers.close(customPopover);
        popovers.close(sortPopover);
        popovers.toggle(filterPopover, filterBtn);
    });

    sortController = createSortController({
        state,
        sortBtn,
        sortMenu,
        sortPopover,
        popovers,
        reloadGrid: gridController.reloadGrid,
        onChanged: () => {
            notifyContextChanged();
        }
    });
    sortController.bind({
        onBeforeToggle: () => {
            popovers.close(customPopover);
            popovers.close(filterPopover);
        }
    });

    const collectionsController = createCollectionsController({
        state,
        collectionsBtn,
        collectionsMenu,
        collectionsPopover,
        popovers,
        reloadGrid: gridController.reloadGrid,
        onChanged: () => {
            notifyContextChanged();
        }
    });
    collectionsController.bind();

    // Calendar UI (separate module) for day indicators.
    let agendaCalendar = null;
    try {
        agendaCalendar = createAgendaCalendar({
            container: agendaContainer,
            hiddenInput: dateExactInput,
            state,
            onRequestReloadGrid: () => gridController.reloadGrid()
        });
    } catch {}

    bindFilters({
        state,
        kindSelect,
        wfCheckbox,
        ratingSelect,
        dateRangeSelect,
        dateExactInput,
        reloadGrid: gridController.reloadGrid,
        onFiltersChanged: () => {
            try {
                agendaCalendar?.refresh?.();
            } catch {}
            notifyContextChanged();
        }
    });

    // Context controller: pills + button highlighting.
    try {
        contextController = createContextController({
            state,
            gridContainer,
            filterBtn,
            sortBtn,
            collectionsBtn,
            searchInputEl,
            kindSelect,
            wfCheckbox,
            ratingSelect,
            dateRangeSelect,
            dateExactInput,
            scopeController,
            sortController,
            updateSummaryBar,
            reloadGrid: () => gridController.reloadGrid()
        });
    } catch {}

    // Summary bar updates: selection changes, load changes, scope/collection changes.
    try {
        notifyContextChanged();
        const onStats = () => notifyContextChanged();
        const onSelectionChanged = (e) => {
            try {
                const detail = e?.detail || {};
                const ids = Array.isArray(detail.selectedIds) ? detail.selectedIds.map(String).filter(Boolean) : [];
                state.selectedAssetIds = ids;
                state.activeAssetId = String(detail.activeId || ids[0] || "");
            } catch {}
            notifyContextChanged();
        };
        gridContainer.addEventListener("mjr:grid-stats", onStats);
        gridContainer.addEventListener("mjr:selection-changed", onSelectionChanged);
        document.addEventListener?.("mjr-settings-changed", onStats);

        // Observe DOM changes for card count / selection class changes.
        let raf = null;
        const schedule = () => {
            if (raf) cancelAnimationFrame(raf);
            raf = requestAnimationFrame(() => {
                raf = null;
                notifyContextChanged();
            });
        };
        const mo = new MutationObserver(() => schedule());
        mo.observe(gridContainer, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
        gridContainer._mjrSummaryBarObserver = mo;
        gridContainer._mjrSummaryBarDispose = () => {
            try {
                gridContainer.removeEventListener("mjr:grid-stats", onStats);
            } catch {}
            try {
                gridContainer.removeEventListener("mjr:selection-changed", onSelectionChanged);
            } catch {}
            try {
                document.removeEventListener?.("mjr-settings-changed", onStats);
            } catch {}
            try {
                mo.disconnect();
            } catch {}
        };
    } catch {}

    const sidebarController = bindSidebarOpen({
        gridContainer,
        sidebar,
        createRatingBadge,
        createTagsBadge,
        showAssetInSidebar,
        closeSidebar,
        state
    });

    const hotkeys = createPanelHotkeysController({
        onTriggerScan: (ctx) => {
            triggerScan(statusDot, statusText, capabilitiesSection, ctx || {});
        },
        onToggleDetails: () => {
            sidebarController?.toggleDetails?.();
        },
        onFocusSearch: () => {
            try {
                searchInputEl?.focus?.();
                // Move cursor to end for immediate typing.
                const len = searchInputEl?.value?.length || 0;
                searchInputEl?.setSelectionRange?.(len, len);
            } catch {}
        },
        onClearSearch: () => {
            try {
                if (!searchInputEl) return;
                searchInputEl.value = "";
                searchInputEl.dispatchEvent?.(new Event("input", { bubbles: true }));
            } catch {}
        },
        getScanContext: () => ({
            scope: state.scope,
            customRootId: state.customRootId
        })
    });

    const ratingHotkeys = createRatingHotkeysController({
        gridContainer,
        createRatingBadge
    });

    let searchTimeout = null;
    let lastSearchValue = "";

    if (container._eventCleanup) {
        try {
            container._eventCleanup();
        } catch {}
    }

    hotkeys.bind(content);
    ratingHotkeys.bind();
    
    // Attach controllers to container for cleanup on re-render
    try {
        container._mjrHotkeys = hotkeys;
        container._mjrRatingHotkeys = ratingHotkeys;
        container._mjrSidebarController = sidebarController;
    } catch {}

    container._eventCleanup = () => {
        try {
            container._mjrVersionUpdateCleanup?.();
        } catch {}
        container._mjrVersionUpdateCleanup = null;
        try {
            hotkeys.dispose();
        } catch {}
        try {
            ratingHotkeys.dispose();
        } catch {}
        try {
            agendaCalendar?.dispose?.();
        } catch {}
        try {
            if (searchTimeout) clearTimeout(searchTimeout);
            searchTimeout = null;
        } catch {}
        try {
            sidebar?._dispose?.();
        } catch {}
        try {
            sidebarController?.dispose?.();
        } catch {}
        try {
            window.removeEventListener?.("mjr-settings-changed", onSettingsChanged);
        } catch {}
        try {
            if (gridContainer) disposeGrid(gridContainer);
        } catch {}
        if (_activeGridContainer === gridContainer) {
            _activeGridContainer = null;
        }
        try {
            popovers.dispose();
        } catch {}
        try {
            if (container._mjrPopoverManager === popovers) {
                container._mjrPopoverManager = null;
            }
        } catch {}
    };

    let lastKnownScan = null;
    let lastKnownTotalAssets = null;
    let hasSeenFirstCounters = false;
    let pendingReloadCount = 0;
    let isReloading = false;

    const queuedReload = async () => {
        if (!gridContainer) return;
        pendingReloadCount++;
        if (isReloading) return;

        isReloading = true;
        try {
            while (pendingReloadCount > 0) {
                pendingReloadCount = 0;
                await gridController.reloadGrid();
            }
        } finally {
            isReloading = false;
        }
    };

    const handleCountersUpdate = async (counters) => {
        if (!hasSeenFirstCounters) {
            hasSeenFirstCounters = true;
            lastKnownScan = counters.last_scan_end;
            lastKnownTotalAssets = Number(counters.total_assets ?? null);
            return;
        }

        const hasNewScan = counters.last_scan_end && counters.last_scan_end !== lastKnownScan;
        const totalAssets = Number(counters.total_assets ?? null);

        // Fallback for "new files appeared" without a full scan end update (e.g. incremental indexing).
        // Only auto-refresh when browsing output with default filters to avoid disrupting searches.
        const isDefaultBrowse =
            state.scope === "output" &&
            !state.collectionId &&
            String(getQuery?.() ?? "*").trim() === "*" &&
            !state.kindFilter &&
            !state.workflowOnly &&
            !(Number(state.minRating || 0) > 0) &&
            !state.dateRangeFilter &&
            !state.dateExactFilter;

        const hasNewTotal = Number.isFinite(totalAssets) && Number.isFinite(lastKnownTotalAssets) && totalAssets > lastKnownTotalAssets;

        if (!hasNewScan && !(isDefaultBrowse && hasNewTotal)) return;

        lastKnownScan = counters.last_scan_end;
        lastKnownTotalAssets = Number.isFinite(totalAssets) ? totalAssets : lastKnownTotalAssets;
        await queuedReload();
    };

    setupStatusPolling(
        statusDot,
        statusText,
        statusSection,
        capabilitiesSection,
        handleCountersUpdate,
        () => ({ scope: state.scope, customRootId: state.customRootId })
    );

    scopeController.setActiveTabStyles();
    
    // Initial loading of custom roots (restores selection from state if applicable)
    customRootsController.refreshCustomRoots().catch(() => {});

    searchInputEl.addEventListener("input", (e) => {
        const value = e?.target?.value ?? "";
        if (value === lastSearchValue) return;
        lastSearchValue = value;
        notifyContextChanged();

        if (searchTimeout) clearTimeout(searchTimeout);

        // Immediate search for empty / browse-all queries.
        if (value.length === 0 || value === "*") {
            gridController.reloadGrid();
            return;
        }

        // Debounce for normal searches.
        searchTimeout = setTimeout(() => {
            searchTimeout = null;
            gridController.reloadGrid();
        }, 200);
    });
    searchInputEl.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
            gridController.reloadGrid();
            notifyContextChanged();
        }
    });

    const initialLoadPromise = gridController.reloadGrid();
    
    // Restore scroll, selection visuals, and sidebar AFTER grid loads.
    const restoreUIState = async () => {
        try {
            await initialLoadPromise;
        } catch {}

        // Wait one frame for DOM to settle before restoring.
        requestAnimationFrame(() => {
            // 1. Restore scroll position
            if (state.scrollTop > 0) {
                try {
                    gridWrapper.scrollTop = state.scrollTop;
                } catch {}
            }

            // 2. Restore selection visuals on cards
            if (state.selectedAssetIds?.length || state.activeAssetId) {
                try {
                    const selected = (state.selectedAssetIds || []).map(String);
                    const activeId = String(state.activeAssetId || selected[0] || "");

                    selected.forEach(id => {
                        const card = gridContainer.querySelector(`.mjr-asset-card[data-mjr-asset-id="${CSS?.escape ? CSS.escape(id) : id}"]`);
                        if (card) {
                            card.classList.add("is-selected");
                            card.setAttribute?.("aria-selected", "true");
                        }
                    });

                    if (activeId) {
                        const activeCard = gridContainer.querySelector(`.mjr-asset-card[data-mjr-asset-id="${CSS?.escape ? CSS.escape(activeId) : activeId}"]`);
                        if (activeCard) {
                            activeCard.classList.add("is-active");
                            activeCard.setAttribute?.("aria-selected", "true");
                            // Scroll selection into view if not visible after scroll restore
                            if (state.scrollTop === 0) {
                                activeCard.scrollIntoView?.({ block: "nearest", behavior: "instant" });
                            }
                        }
                    }
                } catch {}
            }

            // 3. Restore sidebar if it was open
            if (state.sidebarOpen && state.activeAssetId) {
                try {
                    sidebarController?.toggleDetails?.();
                } catch {}
            }
        });
    };
    restoreUIState();

    const checkAndAutoLoad = async () => {
        try {
            await initialLoadPromise;
        } catch {}

        const hasCards = gridContainer.querySelector(".mjr-card") != null;
        if (hasCards) return;
        if (state.scope !== "output") return;
        if (getQuery() !== "*") return;

        try {
            const statusData = await get(`${ENDPOINTS.HEALTH_COUNTERS}?scope=output`);
            if (statusData?.ok && (statusData.data?.total_assets || 0) > 0) {
                await loadAssets(gridContainer);
            }
        } catch {}
    };
    setTimeout(checkAndAutoLoad, 2000);

    return { gridContainer };
}
