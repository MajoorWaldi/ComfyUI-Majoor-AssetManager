import { triggerAutoScan } from "../../app/bootstrap.js";
import { comfyAlert, comfyConfirm, comfyPrompt } from "../../app/dialogs.js";
import { createStatusIndicator, setupStatusPolling, triggerScan } from "../status/StatusDot.js";
import { createGridContainer, loadAssets, loadAssetsFromList, disposeGrid } from "../grid/GridView.js";
import { get, post, getCollectionAssets } from "../../api/client.js";
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

import { normalizeQuery } from "./controllers/query.js";
import { createGridController } from "./controllers/gridController.js";
import { createScopeController } from "./controllers/scopeController.js";
import { createCustomRootsController } from "./controllers/customRootsController.js";
import { bindFilters } from "./controllers/filtersController.js";
import { createSortController } from "./controllers/sortController.js";
import { bindSidebarOpen } from "./controllers/sidebarController.js";
import { createPanelHotkeysController } from "./controllers/panelHotkeysController.js";
import { createRatingHotkeysController } from "./controllers/ratingHotkeysController.js";
import { bindGridContextMenu } from "../contextmenu/GridContextMenu.js";

let _activeGridContainer = null;

export function getActiveGridContainer() {
    return _activeGridContainer;
}

export async function renderAssetsManager(container, { useComfyThemeUI = true } = {}) {
    if (useComfyThemeUI) {
        container.classList.add("mjr-assets-manager");
    } else {
        container.classList.remove("mjr-assets-manager");
    }

    triggerAutoScan();

    container.innerHTML = "";
    container.classList.add("mjr-am-container");

    const popovers = createPopoverManager(container);
    try {
        container._mjrPopoverManager = popovers;
    } catch {}
    const state = createPanelState();

    const headerView = createHeaderView();
    const { header, headerActions, tabButtons, customMenuBtn, filterBtn, sortBtn, collectionsBtn } = headerView;

    const { customPopover, customSelect, customAddBtn, customRemoveBtn } = createCustomPopoverView();
    const { filterPopover, kindSelect, wfCheckbox, ratingSelect, dateRangeSelect, dateExactInput } = createFilterPopoverView();
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
    const sidebarPosition = settings.sidebar?.position || "right";
    const sidebar = createSidebar(sidebarPosition);

    if (sidebarPosition === "left") {
        browseSection.appendChild(sidebar);
        browseSection.appendChild(gridWrapper);
    } else {
        browseSection.appendChild(gridWrapper);
        browseSection.appendChild(sidebar);
    }

    content.appendChild(statusSection);
    content.appendChild(searchSection);
    content.appendChild(browseSection);
    container.appendChild(header);
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

    const customRootsController = createCustomRootsController({
        state,
        customSelect,
        customRemoveBtn,
        comfyAlert,
        comfyConfirm,
        comfyPrompt,
        get,
        post,
        ENDPOINTS,
        reloadGrid: gridController.reloadGrid
    });
    customRootsController.bind({ customAddBtn, customRemoveBtn });

    const scopeController = createScopeController({
        state,
        tabButtons,
        customMenuBtn,
        customPopover,
        popovers,
        refreshCustomRoots: customRootsController.refreshCustomRoots,
        reloadGrid: gridController.reloadGrid
    });

    Object.values(tabButtons).forEach((btn) => {
        btn.addEventListener("click", () => scopeController.setScope(btn.dataset.scope));
    });

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

    const sortController = createSortController({
        state,
        sortBtn,
        sortMenu,
        sortPopover,
        popovers,
        reloadGrid: gridController.reloadGrid
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
        reloadGrid: gridController.reloadGrid
    });
    collectionsController.bind();

    bindFilters({
        state,
        kindSelect,
        wfCheckbox,
        ratingSelect,
        dateRangeSelect,
        dateExactInput,
        reloadGrid: gridController.reloadGrid
    });

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

    container._eventCleanup = () => {
        try {
            hotkeys.dispose();
        } catch {}
        try {
            ratingHotkeys.dispose();
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
            return;
        }

        const hasNewScan = counters.last_scan_end && counters.last_scan_end !== lastKnownScan;
        if (!hasNewScan) return;

        lastKnownScan = counters.last_scan_end;
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

    searchInputEl.addEventListener("input", (e) => {
        const value = e?.target?.value ?? "";
        if (value === lastSearchValue) return;
        lastSearchValue = value;

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
        }
    });

    const initialLoadPromise = gridController.reloadGrid();
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
