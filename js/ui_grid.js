import { app } from "../../../../scripts/app.js";
import { api } from "../../../../scripts/api.js";
import { createEl, mjrAttachHoverFeedback, mjrCardBasePx, mjrDeepMerge, mjrSaveSettings, mjrSettings, mjrSettingsDefaults, mjrShowToast, setMjrSettings, detectKindFromExt } from "./ui_settings.js";
import { mjrGlobalState } from "./mjr_global.js";
import { fileKey } from "./am_state.js";
import { SMART_FILTERS } from "./am_filters.js";
import { mjrCreateContextMenu } from "./am_context_menu.js";
import {
  mjrOpenABViewer,
  mjrOpenViewerForFiles,
  mjrStepVideos,
  mjrUpdateNavVisibility,
} from "./ui_viewer.js";
import { createMetadataSidebar } from "./ui_sidebar.js";
import { createGridView } from "./am_gridview.js";
import {
  ensureGlobalAutoRefresh,
  ensureNewFilesListener,
  ensureQueueListener,
  ensureWorkflowDropHandler,
  mjrStartAutoRefreshTimer,
} from "./grid/events.js";
import { createMetadataFetcher } from "./grid/fetch.js";
import { initManagerState, populateCollectionsOptions } from "./grid/state.js";
import { createApplyFilterAndRender } from "./grid/render.js";
import { createRefreshController } from "./grid/load.js";

// ---------------------------------------------------------------------------
// Majoor Assets Manager globals + hotkeys
// ---------------------------------------------------------------------------

let mjrMetaVisible = !!mjrSettings.metaPanel.showByDefault;
let refreshAllInstances = () => Promise.resolve();

function mjrApplySettings(newSettings) {
  setMjrSettings(mjrDeepMerge(mjrSettingsDefaults, newSettings || {}));
  mjrSaveSettings(mjrSettings);
  mjrMetaVisible = !!mjrSettings.metaPanel.showByDefault;
  mjrStartAutoRefreshTimer(refreshAllInstances);
  mjrUpdateNavVisibility();

  // Re-render grids with new sizing/badges/filters
  mjrGlobalState.instances.forEach((inst) => {
    try {
      if (typeof inst.setMetadataPanelVisibility === "function") {
        inst.setMetadataPanelVisibility(mjrMetaVisible);
      }
      // Force grid re-render to pick up card size/badge changes
      if (typeof inst.applyFilterAndRender === "function") {
        inst.applyFilterAndRender();
      }
    } catch (err) {
      console.warn("[Majoor.AssetsManager] apply settings refresh failed", err);
    }
  });
  refreshAllInstances({ silent: true, forceFiles: false });
}

function renderAssetsManager(root) {
  const cleanups = [];
  const cleanupsExternal = [];

  root.innerHTML = "";
  Object.assign(root.style, {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    userSelect: "text", // allow copying any text in the manager UI
  });
  
  // --- TOOLBAR ---
  const toolbar = createEl("div", "mjr-fm-toolbar");
  Object.assign(toolbar.style, { display: "flex", flexDirection: "column", gap: "6px", padding: "8px 12px 6px 12px", borderBottom: "1px solid var(--border-color, #444)", background: "var(--comfy-menu-bg, #111)" });

  const headerRow = createEl("div", "mjr-fm-header-row");
  Object.assign(headerRow.style, { display: "flex", alignItems: "center", justifyContent: "flex-start" });

  const title = createEl("div", "mjr-fm-title", "Majoor Assets Manager");
  Object.assign(title.style, { fontWeight: "600", fontSize: "0.85rem", opacity: "0.9" });
  headerRow.append(title);

  const searchRow = createEl("div", "mjr-fm-search-row");
  Object.assign(searchRow.style, { display: "flex", alignItems: "center", gap: "6px" });

  const search = createEl("input", "mjr-fm-search");
  search.type = "search";
  search.placeholder = "Search outputs...";
  Object.assign(search.style, { flex: "1", minWidth: "0", borderRadius: "6px", border: "1px solid var(--border-color, #333)", background: "var(--comfy-input-bg, #1b1b1b)", padding: "6px 8px", fontSize: "0.8rem", color: "var(--input-fg, #eee)" });

  const refreshBtn = createEl("button", "comfy-btn mjr-fm-refresh");
  Object.assign(refreshBtn.style, { padding: "4px 6px", borderRadius: "6px", minWidth: "32px", display: "flex", alignItems: "center", justifyContent: "center" });
  const refreshIcon = createEl("i", "pi pi-refresh", null, { fontSize: "0.9rem" });
  refreshBtn.appendChild(refreshIcon);

  searchRow.append(search, refreshBtn);
  mjrAttachHoverFeedback(search, "Type to filter files by name or text.", 3000);
  mjrAttachHoverFeedback(refreshBtn, "Force an immediate refresh of outputs.", 3000);

  const filterRow = createEl("div", "mjr-fm-filter-row");
  Object.assign(filterRow.style, { display: "flex", alignItems: "center", gap: "6px" });

  const ratingFilter = createEl("select", "mjr-fm-filter-rating");
  [["0", "All"], ["1", "*+"], ["2", "**+"], ["3", "***+"], ["4", "****+"], ["5", "*****"]].forEach(([value, label]) => {
    ratingFilter.add(new Option(label, value));
  });

  const tagFilterInput = createEl("input", "mjr-fm-filter-tag");
  tagFilterInput.type = "text";
  tagFilterInput.placeholder = "Filter by tag...";
  Object.assign(tagFilterInput.style, { flex: "1", minWidth: "0", borderRadius: "6px", border: "1px solid var(--border-color, #333)", background: "var(--comfy-input-bg, #1b1b1b)", padding: "4px 6px", fontSize: "0.8rem", color: "var(--input-fg, #eee)" });

  filterRow.append(
    createEl("div", "", "Min *", { fontSize: "0.75rem", opacity: "0.75" }),
    ratingFilter,
    tagFilterInput
  );
  mjrAttachHoverFeedback(ratingFilter, "Filter by minimum rating (*).", 3000);
  mjrAttachHoverFeedback(tagFilterInput, "Filter by tag (separate with commas).", 3000);

  const collectionFilterSelect = createEl("select", "mjr-fm-filter-collection");
  collectionFilterSelect.style.maxWidth = "140px";
  
  filterRow.appendChild(collectionFilterSelect);

  const status = createEl("div", "mjr-fm-status");
  Object.assign(status.style, { marginTop: "2px", fontSize: "0.7rem", opacity: "0.65" });

  toolbar.append(headerRow, searchRow, filterRow, status);

  // --- BODY (Grid + Meta) ---
  const body = createEl("div", "mjr-fm-body");
  Object.assign(body.style, { flex: "1", display: "flex", flexDirection: "row", overflow: "hidden", background: "var(--comfy-bg-color, #080808)" });

  const gridWrapper = createEl("div", "mjr-fm-grid-wrapper");
  Object.assign(gridWrapper.style, { flex: "1.8", overflow: "auto", position: "relative" });

  const grid = createEl("div", "mjr-fm-grid");
  const basePx = mjrCardBasePx();
  Object.assign(grid.style, { display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${basePx}px, 1fr))`, gap: "8px", padding: "10px 12px", alignItems: "start", gridAutoRows: "auto" });
  gridWrapper.appendChild(grid);

  const metaPanel = createEl("div", "mjr-fm-meta-panel");
  Object.assign(metaPanel.style, { flex: "1.4", borderLeft: "1px solid var(--border-color, #333)", maxWidth: "480px", minWidth: "260px", display: mjrMetaVisible ? "flex" : "none", flexDirection: "column", padding: "10px 12px", gap: "8px", overflow: "auto" });

  const metaTitle = createEl("div", "mjr-fm-meta-title", "Metadata");
  Object.assign(metaTitle.style, { fontWeight: "600", fontSize: "0.8rem", opacity: "0.9" });

  const metaContent = createEl("div", "mjr-fm-meta-content");
  Object.assign(metaContent.style, { flex: "1", display: "flex", flexDirection: "column", gap: "8px" });
  metaContent.innerHTML = '<div style="opacity:.6;font-size:0.8rem;">Click a file to inspect prompts, workflow, rating, and tags.</div>';
  metaPanel.append(metaTitle, metaContent);

  body.append(gridWrapper, metaPanel);
  root.append(toolbar, body);
  
  // ---------------------------------------------------------------------------
  // STATE & LOGIC
  // ---------------------------------------------------------------------------

  const state = initManagerState();
  populateCollectionsOptions(state, collectionFilterSelect);

  let openContextMenuEl = null;
  const {
    fetchMetadataForVisible,
    onRequestMetadata,
    cleanup: cleanupMetadataFetcher,
    setGridView: setGridViewForMetadata,
  } = createMetadataFetcher(state, null);
  const {
    applyFilterAndRender,
    setGridView: setGridViewForRender,
  } = createApplyFilterAndRender(state, fetchMetadataForVisible);
  const {
    refreshInstance,
    refreshAllInstances: refreshAllInstancesFn,
    loadFilesWrapper,
    loadFiles,
    lastSignatureRef,
  } = createRefreshController(state, grid, applyFilterAndRender, fetchMetadataForVisible);
  refreshAllInstances = refreshAllInstancesFn;
  const refreshCollections = () => populateCollectionsOptions(state, collectionFilterSelect);

  // Workflow drops are handled in events.js (sibling payload drop on graph)
  cleanups.push(ensureWorkflowDropHandler());
  cleanups.push(ensureQueueListener(refreshAllInstances));
  cleanups.push(ensureNewFilesListener());
  cleanups.push(ensureGlobalAutoRefresh(refreshAllInstances));

  // --- ACTIONS ---

  const closeContextMenu = () => {
    if (openContextMenuEl?.parentNode) {
      openContextMenuEl.parentNode.removeChild(openContextMenuEl);
    }
    openContextMenuEl = null;
  };

  const updateStatus = () => {
    if (gridView) gridView.updateStatus();
  };

  const removeFileFromState = (file) => {
    const key = fileKey(file);
    const removeFrom = (arr) => {
      const idx = arr.findIndex((f) => fileKey(f) === key);
      if (idx > -1) arr.splice(idx, 1);
    };
    removeFrom(state.files);
    removeFrom(state.filtered);
    state.selected.delete(key);
    if (state.currentFile && fileKey(state.currentFile) === key) {
      state.currentFile = null;
      state.currentMeta = null;
    }
    applyFilterAndRender();
    updateStatus();
  };

  const openContextMenu = (ev, file) => {
    closeContextMenu();
    const contextMenu = mjrCreateContextMenu(file, { 
      state, 
      fileKey, 
      removeFileFromState, 
      refreshCollections, 
      closeContextMenu, 
      updateStatus 
    });
    Object.assign(contextMenu.style, { left: `${ev.clientX}px`, top: `${ev.clientY}px` });
    document.body.appendChild(contextMenu);
    openContextMenuEl = contextMenu;

    setTimeout(() => {
      const handler = (evt) => {
        if (openContextMenuEl && !openContextMenuEl.contains(evt.target)) {
          closeContextMenu();
        }
      };
      document.addEventListener("click", handler, { once: true });
    }, 0);
  };

  const sidebar = createMetadataSidebar({
    state,
    metaPanel,
    metaContent,
    applyFilterAndRender,
    refreshAllInstances,
    fileKey,
    onVisibilityChange: (visible) => { 
        mjrMetaVisible = visible; 
        gridDeps.mjrMetaVisible = visible; // Pass dynamic visibility to GridView
    },
  });

  const { loadMetadataForFile, setMetadataPanelVisibility, updateFileMetadata, setRating } = sidebar;

  // --- GRID VIEW INTEGRATION ---
  
  const gridDeps = {
    state,
    grid,
    gridWrapper,
    statusEl: status,
    loadMetadataForFile: sidebar.loadMetadataForFile,
    openContextMenu,
    onRequestMetadata,
    isMetaVisible: () => mjrMetaVisible,
  };
  const gridView = createGridView(gridDeps);
  setGridViewForMetadata(gridView);
  setGridViewForRender(gridView);
  const handleScroll = () => gridView.renderGrid();
  const handleResize = () => gridView.renderGrid();
  gridWrapper.addEventListener("scroll", handleScroll);
  window.addEventListener("resize", handleResize);
  cleanups.push(() => gridWrapper.removeEventListener("scroll", handleScroll));
  cleanups.push(() => window.removeEventListener("resize", handleResize));
  cleanups.push(() => cleanupMetadataFetcher());

  // --- EVENTS ---
  const onSearchInput = () => { state.search = search.value; applyFilterAndRender(); };
  const onRatingFilterChange = () => { state.minRating = parseInt(ratingFilter.value, 10) || 0; applyFilterAndRender(); };
  const onTagFilterInput = () => { state.tagFilter = tagFilterInput.value; applyFilterAndRender(); };
  const onRefreshClick = () => { refreshAllInstances({ silent: false, forceFiles: true }); };
  const onCollectionChange = async () => {
    const val = collectionFilterSelect.value;
    state.activeCollection = val;
    state.collectionSet = null;
    state.smartFilter = null;
    if (val) {
      if (val.startsWith("smart:")) {
        state.smartFilter = SMART_FILTERS[val]?.filter;
      } else {
        const res = await api.fetchApi(`/mjr/collections/${val}`);
        const data = await res.json();
        state.collectionSet = new Set(data.files || []);
      }
    }
    applyFilterAndRender();
  };

  search.addEventListener("input", onSearchInput);
  ratingFilter.addEventListener("change", onRatingFilterChange);
  tagFilterInput.addEventListener("input", onTagFilterInput);
  refreshBtn.addEventListener("click", onRefreshClick);
  collectionFilterSelect.addEventListener("change", onCollectionChange);
  cleanups.push(() => search.removeEventListener("input", onSearchInput));
  cleanups.push(() => ratingFilter.removeEventListener("change", onRatingFilterChange));
  cleanups.push(() => tagFilterInput.removeEventListener("input", onTagFilterInput));
  cleanups.push(() => refreshBtn.removeEventListener("click", onRefreshClick));
  cleanups.push(() => collectionFilterSelect.removeEventListener("change", onCollectionChange));

  // Initial Load
  refreshInstance({ silent: false, forceFiles: true });

  // Register Instance
  const instance = { root, state, loadMetadataForFile, setMetadataPanelVisibility, setRating, updateFileMetadata, refresh: refreshInstance, loadFiles, applyFilterAndRender };
  mjrGlobalState.instances.add(instance);
  
  root.__mjrCleanup = () => {
    root.__mjrCleanup = null;
    mjrGlobalState.instances.delete(instance);
    cleanups.forEach(c => c());
    cleanupsExternal.forEach((c) => c());
  };
}

app.registerExtension({
  name: "Majoor.AssetsManager",
  bottomPanelTabs: [{
    id: "majoorAssetsManagerBottom",
    title: "Assets Manager",
    type: "custom",
    render: (el) => renderAssetsManager(el),
    destroy: (el) => el?.__mjrCleanup?.(),
  }],
  async setup() {
    const SETTINGS_PREFIX = "MajoorAM";

    const warnIfNoExiftool = async () => {
      const warnKey = "mjrExiftoolWarned";
      try {
        if (typeof localStorage !== "undefined" && localStorage.getItem(warnKey)) return;
      } catch (_) {}
      try {
        const res = await api.fetchApi("/mjr/filemanager/capabilities");
        if (!res.ok) return;
        const data = await res.json();
        if (!data || !data.ok) return;
        const exiftoolAvailable = !!data.exiftool_available;
        if (!exiftoolAvailable) {
          mjrShowToast(
            "warn",
            "ExifTool missing: Video metadata parsing will be limited. Please install ExifTool on your system.",
            "Metadata"
          );
          try { localStorage.setItem(warnKey, "1"); } catch (_) {}
        }
      } catch (_) {
        /* ignore */
      }
    };

    // --- GRID SETTINGS ---
    app.ui.settings.addSetting({
      id: `${SETTINGS_PREFIX}.Grid.CardSize`,
      name: "Majoor: Card Size",
      type: "combo",
      options: ["compact", "medium", "large"],
      defaultValue: mjrSettingsDefaults.grid.cardSize,
      onChange: (val) => {
        mjrSettings.grid.cardSize = val;
        mjrSaveSettings(mjrSettings);
        mjrGlobalState.instances.forEach((i) => i.applyFilterAndRender?.());
      },
    });

    app.ui.settings.addSetting({
      id: `${SETTINGS_PREFIX}.Grid.ShowTags`,
      name: "Majoor: Show Tags on Cards",
      type: "boolean",
      defaultValue: mjrSettingsDefaults.grid.showTags,
      onChange: (val) => {
        mjrSettings.grid.showTags = val;
        mjrSaveSettings(mjrSettings);
        mjrGlobalState.instances.forEach((i) => i.applyFilterAndRender?.());
      },
    });

    app.ui.settings.addSetting({
      id: `${SETTINGS_PREFIX}.Grid.ShowRating`,
      name: "Majoor: Show Ratings on Cards",
      type: "boolean",
      defaultValue: mjrSettingsDefaults.grid.showRating,
      onChange: (val) => {
        mjrSettings.grid.showRating = val;
        mjrSaveSettings(mjrSettings);
        mjrGlobalState.instances.forEach((i) => i.applyFilterAndRender?.());
      },
    });

    // --- AUTO REFRESH ---
    app.ui.settings.addSetting({
      id: `${SETTINGS_PREFIX}.Refresh.Enabled`,
      name: "Majoor: Auto-Refresh Enabled",
      type: "boolean",
      defaultValue: mjrSettingsDefaults.autoRefresh.enabled,
      onChange: (val) => {
        mjrSettings.autoRefresh.enabled = val;
        mjrSaveSettings(mjrSettings);
        mjrStartAutoRefreshTimer(refreshAllInstances);
      },
    });

    app.ui.settings.addSetting({
      id: `${SETTINGS_PREFIX}.Refresh.Interval`,
      name: "Majoor: Refresh Interval (ms)",
      type: "number",
      defaultValue: mjrSettingsDefaults.autoRefresh.interval,
      attrs: { min: 1000, step: 500 },
      onChange: (val) => {
        mjrSettings.autoRefresh.interval = val;
        mjrSaveSettings(mjrSettings);
        mjrStartAutoRefreshTimer(refreshAllInstances);
      },
    });

    // --- VIEWER SETTINGS ---
    app.ui.settings.addSetting({
      id: `${SETTINGS_PREFIX}.Viewer.Autoplay`,
      name: "Majoor Viewer: Autoplay Videos",
      type: "boolean",
      defaultValue: mjrSettingsDefaults.viewer.autoplayVideos,
      onChange: (val) => {
        mjrSettings.viewer.autoplayVideos = val;
        mjrSaveSettings(mjrSettings);
      },
    });

    app.ui.settings.addSetting({
      id: `${SETTINGS_PREFIX}.Viewer.Loop`,
      name: "Majoor Viewer: Loop Videos",
      type: "boolean",
      defaultValue: mjrSettingsDefaults.viewer.loopVideos,
      onChange: (val) => {
        mjrSettings.viewer.loopVideos = val;
        mjrSaveSettings(mjrSettings);
      },
    });

    app.ui.settings.addSetting({
      id: `${SETTINGS_PREFIX}.Viewer.Checkerboard`,
      name: "Majoor Viewer: Checkerboard Background",
      type: "boolean",
      defaultValue: mjrSettingsDefaults.viewer.useCheckerboard,
      onChange: (val) => {
        mjrSettings.viewer.useCheckerboard = val;
        mjrSaveSettings(mjrSettings);
      },
    });

    // --- GENERAL ---
    app.ui.settings.addSetting({
      id: `${SETTINGS_PREFIX}.General.HideSiblings`,
      name: "Majoor: Hide PNG Siblings (Video previews)",
      tooltip: "If a video has a matching .png, hide the .png from the grid",
      type: "boolean",
      defaultValue: mjrSettingsDefaults.siblings.hidePngSiblings,
      onChange: (val) => {
        mjrSettings.siblings.hidePngSiblings = val;
        mjrSaveSettings(mjrSettings);
        mjrGlobalState.instances.forEach((i) => i.applyFilterAndRender?.());
      },
    });
    
    warnIfNoExiftool();

    try {
      app.extensionManager.registerSidebarTab({
        id: "majoorAssetsManagerSidebar",
        icon: "pi pi-folder-open",
        title: "Assets Manager",
        tooltip: "Majoor Assets Manager",
        type: "custom",
        render: (el) => renderAssetsManager(el),
        destroy: (el) => el?.__mjrCleanup?.(),
      });
    } catch (err) { console.error("[Majoor.AssetsManager] sidebar registration failed", err); }
  },
});

if (!window.__MajoorAssetsManagerHotkeysInitialized) {
  window.__MajoorAssetsManagerHotkeysInitialized = true;
  const onKeyDown = (ev) => {
    if (!mjrSettings.hotkeys.enabled) return;
    const target = ev.target;
    const isTyping = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
    if (isTyping && !(ev.key === "<" && !ev.ctrlKey && !ev.altKey && !ev.metaKey)) return;

    let handled = false;
    if (ev.key === "Tab" && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
      const sidebarBtn = document.querySelector('[data-sidebar-tab-id="majoorAssetsManagerSidebar"]');
      if (sidebarBtn) { sidebarBtn.click(); handled = true; }
    } else if (/^[0-5]$/.test(ev.key) && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
      mjrGlobalState.instances.forEach(inst => {
        if (inst.state.currentFile) { inst.setRating(inst.state.currentFile, parseInt(ev.key, 10)); handled = true; }
      });
    } else if (ev.key === "Enter" && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
      mjrGlobalState.instances.forEach(inst => {
        if (inst.state.selected.size > 0) {
          const files = Array.from(inst.state.selected).map(k => inst.state.filtered.find(f => fileKey(f) === k)).filter(Boolean);
          if (files.length > 0) {
            mjrOpenViewerForFiles(files.length >= 2 ? [files[0], files[1]] : [files[0]], inst.state.filtered);
            handled = true;
          }
        }
      });
    }
    if (handled) ev.preventDefault();
  };
  window.addEventListener("keydown", onKeyDown);
}
