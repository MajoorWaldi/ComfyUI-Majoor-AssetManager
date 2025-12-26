import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import {
  createEl,
  mjrAttachHoverFeedback,
  mjrCardBasePx,
  mjrDeepMerge,
  mjrPrefetchOutputs,
  mjrResetPrefetch,
  mjrSaveSettings,
  mjrSettings,
  mjrSettingsDefaults,
  mjrShowToast,
  setMjrSettings,
  detectKindFromExt,
} from "./ui_settings.js";
import { mjrGlobalState } from "./global_state.js";
import { fileKey } from "./assets_state.js";
import { SMART_FILTERS } from "./assets_filters.js";
import { mjrCreateContextMenu } from "./ui_context_menu.js";
import {
  mjrOpenABViewer,
  mjrOpenViewerForFiles,
  mjrStepVideos,
  mjrApplyOpenViewerSettings,
  mjrUpdateNavVisibility,
  mjrCleanupViewerGlobalListeners,
  mjrViewerState,
} from "./ui_viewer.js";
import { createMetadataSidebar } from "./ui_sidebar.js";
import { createGridView } from "./ui_gridview.js";
import { createStatusDot, injectStatusDotStyles } from "./ui_status_dot.js";
import {
  ensureGlobalAutoRefresh,
  ensureVideoNodeDropBridge,
  ensureNewFilesListener,
  ensureQueueListener,
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

const mjrPanelMode = String(mjrSettings?.integration?.panel || mjrSettingsDefaults?.integration?.panel || "both").toLowerCase();
const mjrUseBottomPanel = mjrPanelMode === "bottom" || mjrPanelMode === "both";
const mjrUseSidebarPanel = mjrPanelMode === "sidebar" || mjrPanelMode === "both";

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

  // Status dot (index health + click to reindex)
  injectStatusDotStyles();
  const statusDot = createStatusDot(api);
  headerRow.appendChild(statusDot.element);
  cleanups.push(() => statusDot.cleanup());

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

  const bulkBtn = createEl("button", "comfy-btn mjr-fm-bulk");
  bulkBtn.textContent = "Bulk";
  Object.assign(bulkBtn.style, { padding: "4px 10px", borderRadius: "6px", fontSize: "0.8rem", display: "none" });

  // Show/hide bulk button based on selection
  const updateBulkButtonVisibility = () => {
    bulkBtn.style.display = state.selected.size > 0 ? "inline-block" : "none";
  };

  searchRow.append(search, bulkBtn, refreshBtn);
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
  gridWrapper.setAttribute("tabindex", "0"); // Keep focusable for selection hotkeys

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
	    fetchMetadataForFilter,
	    onRequestMetadata,
	    cleanup: cleanupMetadataFetcher,
	    setGridView: setGridViewForMetadata,
	    setOnMetadataUpdated,
	  } = createMetadataFetcher(state, null);
	  const {
	    applyFilterAndRender,
	    setGridView: setGridViewForRender,
	  } = createApplyFilterAndRender(state, fetchMetadataForVisible, fetchMetadataForFilter);

	  setOnMetadataUpdated(() => {
	    const tagFilter = (state.tagFilter || "").trim();
	    const minRating = Number(state.minRating || 0);
	    if (tagFilter || minRating > 0) {
	      applyFilterAndRender();
	    }
	  });
	  const {
	    refreshInstance,
	    refreshAllInstances: refreshAllInstancesFn,
	    loadFilesWrapper,
    loadFiles,
    loadMoreFiles,
    lastSignatureRef,
  } = createRefreshController(state, grid, applyFilterAndRender, fetchMetadataForVisible);
  refreshAllInstances = refreshAllInstancesFn;
  const refreshCollections = () => populateCollectionsOptions(state, collectionFilterSelect);

  // Media drops on the ComfyUI canvas are handled natively by ComfyUI (this plugin does not intercept drop events).
  cleanups.push(ensureVideoNodeDropBridge());
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
    updateBulkButtonVisibility();
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

  // --- BULK OPERATIONS ---

  const openBulkOperationsModal = () => {
    const selectedFiles = Array.from(state.selected).map(key => {
      const parts = key.split(":::");
      return state.files.find(f => fileKey(f) === key);
    }).filter(Boolean);

    if (selectedFiles.length === 0) {
      mjrShowToast("info", "No files selected", "Bulk Operations");
      return;
    }

    const overlay = createEl("div", "mjr-bulk-overlay");
    Object.assign(overlay.style, {
      position: "fixed",
      top: "0",
      left: "0",
      right: "0",
      bottom: "0",
      background: "rgba(0, 0, 0, 0.7)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: "10000"
    });

    const modal = createEl("div", "mjr-bulk-modal");
    Object.assign(modal.style, {
      background: "var(--comfy-menu-bg, #1e1e1e)",
      border: "1px solid var(--border-color, #333)",
      borderRadius: "8px",
      padding: "20px",
      minWidth: "400px",
      maxWidth: "500px",
      boxShadow: "0 4px 12px rgba(0, 0, 0, 0.5)"
    });

    const title = createEl("h3", "", `Bulk Operations (${selectedFiles.length} files)`);
    Object.assign(title.style, { marginTop: "0", marginBottom: "16px", fontSize: "1rem" });

    const ratingRow = createEl("div", "");
    Object.assign(ratingRow.style, { marginBottom: "12px", display: "flex", alignItems: "center", gap: "8px" });
    const ratingLabel = createEl("label", "", "Set Rating:");
    Object.assign(ratingLabel.style, { flex: "0 0 100px", fontSize: "0.85rem" });
    const ratingSelect = createEl("select", "");
    Object.assign(ratingSelect.style, {
      flex: "1",
      padding: "6px",
      borderRadius: "4px",
      background: "var(--comfy-input-bg, #2a2a2a)",
      color: "var(--input-fg, #eee)",
      border: "1px solid var(--border-color, #444)"
    });
    [["", "(no change)"], ["0", "0 - Clear"], ["1", "1 ★"], ["2", "2 ★★"], ["3", "3 ★★★"], ["4", "4 ★★★★"], ["5", "5 ★★★★★"]].forEach(([value, label]) => {
      ratingSelect.add(new Option(label, value));
    });
    ratingRow.append(ratingLabel, ratingSelect);

    const tagsRow = createEl("div", "");
    Object.assign(tagsRow.style, { marginBottom: "12px", display: "flex", alignItems: "center", gap: "8px" });
    const tagsLabel = createEl("label", "", "Add Tags:");
    Object.assign(tagsLabel.style, { flex: "0 0 100px", fontSize: "0.85rem" });
    const tagsInput = createEl("input", "");
    tagsInput.type = "text";
    tagsInput.placeholder = "tag1, tag2, tag3";
    Object.assign(tagsInput.style, {
      flex: "1",
      padding: "6px",
      borderRadius: "4px",
      background: "var(--comfy-input-bg, #2a2a2a)",
      color: "var(--input-fg, #eee)",
      border: "1px solid var(--border-color, #444)"
    });
    tagsRow.append(tagsLabel, tagsInput);

    const removeTagsRow = createEl("div", "");
    Object.assign(removeTagsRow.style, { marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" });
    const removeTagsLabel = createEl("label", "", "Remove Tags:");
    Object.assign(removeTagsLabel.style, { flex: "0 0 100px", fontSize: "0.85rem" });
    const removeTagsInput = createEl("input", "");
    removeTagsInput.type = "text";
    removeTagsInput.placeholder = "tag1, tag2";
    Object.assign(removeTagsInput.style, {
      flex: "1",
      padding: "6px",
      borderRadius: "4px",
      background: "var(--comfy-input-bg, #2a2a2a)",
      color: "var(--input-fg, #eee)",
      border: "1px solid var(--border-color, #444)"
    });
    removeTagsRow.append(removeTagsLabel, removeTagsInput);

    const buttonRow = createEl("div", "");
    Object.assign(buttonRow.style, { display: "flex", justifyContent: "flex-end", gap: "8px" });

    const cancelBtn = createEl("button", "comfy-btn", "Cancel");
    Object.assign(cancelBtn.style, {
      padding: "6px 16px",
      borderRadius: "4px",
      fontSize: "0.85rem"
    });

    const applyBtn = createEl("button", "comfy-btn", "Apply");
    Object.assign(applyBtn.style, {
      padding: "6px 16px",
      borderRadius: "4px",
      fontSize: "0.85rem",
      background: "var(--primary-color, #007bff)",
      color: "#fff"
    });

    buttonRow.append(cancelBtn, applyBtn);
    modal.append(title, ratingRow, tagsRow, removeTagsRow, buttonRow);
    overlay.appendChild(modal);

    const closeModal = () => {
      document.body.removeChild(overlay);
    };

    cancelBtn.addEventListener("click", closeModal);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeModal();
    });

    applyBtn.addEventListener("click", async () => {
      const newRating = ratingSelect.value;
      const addTagsStr = tagsInput.value.trim();
      const removeTagsStr = removeTagsInput.value.trim();

      if (!newRating && !addTagsStr && !removeTagsStr) {
        mjrShowToast("info", "No changes specified", "Bulk Operations");
        closeModal();
        return;
      }

      const addTags = addTagsStr ? addTagsStr.split(",").map(t => t.trim()).filter(Boolean) : [];
      const removeTags = removeTagsStr ? removeTagsStr.split(",").map(t => t.trim()).filter(Boolean) : [];

      let processed = 0;
      let errors = 0;

      for (const file of selectedFiles) {
        try {
          const updates = {};

          if (newRating !== "") {
            file.rating = parseInt(newRating);
            updates.rating = parseInt(newRating);
          }

          if (addTags.length > 0 || removeTags.length > 0) {
            const currentTags = Array.isArray(file.tags) ? [...file.tags] : [];
            let newTags = [...currentTags];

            for (const tag of addTags) {
              if (!newTags.includes(tag)) {
                newTags.push(tag);
              }
            }

            newTags = newTags.filter(tag => !removeTags.includes(tag));

            file.tags = newTags;
            updates.tags = newTags;
          }

          if (Object.keys(updates).length > 0) {
            await updateFileMetadata(file, updates, null);
            processed++;
          }
        } catch (err) {
          console.error(`Failed to update ${file.filename || file.name}:`, err);
          errors++;
        }
      }

      closeModal();

      if (errors > 0) {
        mjrShowToast("warning", `Updated ${processed} files, ${errors} failed`, "Bulk Operations");
      } else {
        mjrShowToast("success", `Updated ${processed} files`, "Bulk Operations");
      }

      applyFilterAndRender();
    });

    document.body.appendChild(overlay);
  };

  bulkBtn.addEventListener("click", openBulkOperationsModal);
  mjrAttachHoverFeedback(bulkBtn, "Perform bulk operations on selected files.", 3000);

  // --- GRID VIEW INTEGRATION ---
  
  const gridDeps = {
    state,
    grid,
    gridWrapper,
    statusEl: status,
    loadMetadataForFile: sidebar.loadMetadataForFile,
    openContextMenu,
    onRequestMetadata,
    onNeedMoreFiles: () => loadMoreFiles({ silent: true }),
    isMetaVisible: () => mjrMetaVisible,
  };
  const gridView = createGridView(gridDeps);
  setGridViewForMetadata(gridView);
  setGridViewForRender(gridView);

  // Throttle scroll/resize handlers for better performance
  let scrollRaf = null;
  const handleScroll = () => {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      gridView.renderGrid();
      scrollRaf = null;
    });
  };

  let resizeTimeout = null;
  const handleResize = () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => gridView.renderGrid(), 150);
  };

  gridWrapper.addEventListener("scroll", handleScroll, { passive: true });
  window.addEventListener("resize", handleResize);
  cleanups.push(() => {
    gridWrapper.removeEventListener("scroll", handleScroll);
    if (scrollRaf) cancelAnimationFrame(scrollRaf);
  });
  cleanups.push(() => {
    window.removeEventListener("resize", handleResize);
    if (resizeTimeout) clearTimeout(resizeTimeout);
  });
  cleanups.push(() => cleanupMetadataFetcher());

  // --- GRID HOTKEYS ---

  const onGridSelectAll = (e) => {
    const key = String(e.key || "").toLowerCase();
    if (key !== "a") return;
    if (!(e.ctrlKey || e.metaKey)) return;
    if (mjrViewerState?.overlay && mjrViewerState.overlay.style.display !== "none") return;

    const target = e.target;
    const tagName = target && target.tagName ? String(target.tagName).toUpperCase() : "";
    const isInput =
      tagName === "INPUT" ||
      tagName === "TEXTAREA" ||
      tagName === "SELECT" ||
      !!(target && target.isContentEditable);
    if (isInput) return;

    const active = document.activeElement;
    const inGrid = (active && gridWrapper.contains(active)) || (target && root.contains(target));
    if (!inGrid) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation?.();

    state.selected.clear();
    (state.filtered || []).forEach((f) => state.selected.add(fileKey(f)));
    if (state.filtered && state.filtered.length) {
      state.currentFile = state.filtered[0];
      state.__mjrSelectionAnchorKey = fileKey(state.filtered[0]);
    }
    state.renderVersion = (state.renderVersion || 0) + 1;
    gridView.renderGrid();
    updateStatus();
  };

  document.addEventListener("keydown", onGridSelectAll, true);
  cleanups.push(() => document.removeEventListener("keydown", onGridSelectAll, true));

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
    if (mjrGlobalState.instances.size === 0) {
      try {
        mjrCleanupViewerGlobalListeners?.();
      } catch (err) {
        console.warn("[Majoor.AssetsManager] viewer cleanup failed", err);
      }
    }
    cleanups.forEach(c => c());
    cleanupsExternal.forEach((c) => c());
  };
}

app.registerExtension({
  name: "Majoor.AssetsManager",
  bottomPanelTabs: mjrUseBottomPanel
    ? [
        {
          id: "majoorAssetsManagerBottom",
          title: "Assets Manager",
          type: "custom",
          render: (el) => renderAssetsManager(el),
          destroy: (el) => el?.__mjrCleanup?.(),
        },
      ]
    : [],
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

    // --- INTEGRATION ---
    app.ui.settings.addSetting({
      id: `${SETTINGS_PREFIX}.Integration.Panel`,
      name: "Majoor: Panel Integration (reload to apply)",
      tooltip: "Choose where the Assets Manager appears (reload ComfyUI page after changing).",
      type: "combo",
      options: ["both", "sidebar", "bottom"],
      defaultValue: mjrSettings.integration?.panel || mjrSettingsDefaults.integration.panel,
      onChange: (val) => {
        const next = String(val || "both");
        const current = String(mjrSettings.integration?.panel || "both");
        if (next === current) return;
        mjrSettings.integration = mjrSettings.integration || {};
        mjrSettings.integration.panel = next;
        mjrSaveSettings(mjrSettings);
        mjrShowToast("info", "Reload the ComfyUI page to apply the new panel placement.", "Assets Manager");
      },
    });

    // --- GRID SETTINGS ---
    app.ui.settings.addSetting({
      id: `${SETTINGS_PREFIX}.Grid.CardSize`,
      name: "Majoor: Card Size",
      type: "combo",
      options: ["compact", "medium", "large"],
      defaultValue: mjrSettings.grid.cardSize,
      onChange: (val) => {
        mjrSettings.grid.cardSize = val;
        mjrSaveSettings(mjrSettings);
        mjrGlobalState.instances.forEach((i) => i.applyFilterAndRender?.());
      },
    });

    app.ui.settings.addSetting({
      id: `${SETTINGS_PREFIX}.Grid.PageSize`,
      name: "Majoor: Page Size (files per request)",
      tooltip: "Bigger loads more at once; smaller reduces memory. Applies on next refresh.",
      type: "number",
      defaultValue: Number(mjrSettings.grid.pageSize) || mjrSettingsDefaults.grid.pageSize,
      attrs: { min: 50, max: 2000, step: 50 },
      onChange: (val) => {
        const n = Math.max(50, Math.min(2000, Math.floor(Number(val) || mjrSettingsDefaults.grid.pageSize)));
        mjrSettings.grid.pageSize = n;
        mjrSaveSettings(mjrSettings);
        mjrResetPrefetch();
        mjrPrefetchOutputs();
        refreshAllInstances({ silent: true, forceFiles: true });
      },
    });

    app.ui.settings.addSetting({
      id: `${SETTINGS_PREFIX}.Index.Source`,
      name: "Majoor: File Source",
      tooltip: "auto uses the SQLite index when fresh; filesystem always scans.",
      type: "combo",
      options: ["auto", "index", "filesystem"],
      defaultValue: mjrSettings.index?.source || mjrSettingsDefaults.index.source,
      onChange: (val) => {
        mjrSettings.index = mjrSettings.index || {};
        mjrSettings.index.source = String(val || "auto");
        mjrSaveSettings(mjrSettings);
        refreshAllInstances({ silent: true, forceFiles: true });
      },
    });

    app.ui.settings.addSetting({
      id: `${SETTINGS_PREFIX}.Grid.ShowTags`,
      name: "Majoor: Show Tags on Cards",
      type: "boolean",
      defaultValue: mjrSettings.grid.showTags,
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
      defaultValue: mjrSettings.grid.showRating,
      onChange: (val) => {
        mjrSettings.grid.showRating = val;
        mjrSaveSettings(mjrSettings);
        mjrGlobalState.instances.forEach((i) => i.applyFilterAndRender?.());
      },
    });

    app.ui.settings.addSetting({
      id: `${SETTINGS_PREFIX}.Grid.HoverInfo`,
      name: "Majoor: Hover Info Tooltips",
      tooltip: "Show file info on hover (native tooltip).",
      type: "boolean",
      defaultValue: mjrSettings.grid.hoverInfo,
      onChange: (val) => {
        mjrSettings.grid.hoverInfo = !!val;
        mjrSaveSettings(mjrSettings);
        mjrGlobalState.instances.forEach((i) => i.applyFilterAndRender?.());
      },
    });

    // --- META PANEL ---
    app.ui.settings.addSetting({
      id: `${SETTINGS_PREFIX}.MetaPanel.ShowByDefault`,
      name: "Majoor: Show Metadata Panel",
      type: "boolean",
      defaultValue: mjrSettings.metaPanel.showByDefault,
      onChange: (val) => {
        mjrSettings.metaPanel.showByDefault = !!val;
        mjrSaveSettings(mjrSettings);
        mjrMetaVisible = !!val;
        mjrGlobalState.instances.forEach((i) => i.setMetadataPanelVisibility?.(mjrMetaVisible));
      },
    });

    app.ui.settings.addSetting({
      id: `${SETTINGS_PREFIX}.MetaPanel.RefreshInterval`,
      name: "Majoor: Metadata Refresh Interval (ms)",
      tooltip: "While a file is selected, re-fetch generation metadata at this interval (0 disables).",
      type: "number",
      defaultValue: Number(mjrSettings.metaPanel.refreshInterval) || mjrSettingsDefaults.metaPanel.refreshInterval,
      attrs: { min: 0, step: 250 },
      onChange: (val) => {
        const n = Math.max(0, Math.min(60000, Math.floor(Number(val) || 0)));
        mjrSettings.metaPanel.refreshInterval = n;
        mjrSaveSettings(mjrSettings);
      },
    });

    // --- AUTO REFRESH ---
    app.ui.settings.addSetting({
      id: `${SETTINGS_PREFIX}.Refresh.Enabled`,
      name: "Majoor: Auto-Refresh Enabled",
      type: "boolean",
      defaultValue: mjrSettings.autoRefresh.enabled,
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
      defaultValue: Number(mjrSettings.autoRefresh.interval) || mjrSettingsDefaults.autoRefresh.interval,
      attrs: { min: 1000, step: 500 },
      onChange: (val) => {
        mjrSettings.autoRefresh.interval = Number(val) || mjrSettingsDefaults.autoRefresh.interval;
        mjrSaveSettings(mjrSettings);
        mjrStartAutoRefreshTimer(refreshAllInstances);
      },
    });

    app.ui.settings.addSetting({
      id: `${SETTINGS_PREFIX}.Refresh.FocusOnly`,
      name: "Majoor: Auto-Refresh Only When Focused",
      type: "boolean",
      defaultValue: mjrSettings.autoRefresh.focusOnly,
      onChange: (val) => {
        mjrSettings.autoRefresh.focusOnly = !!val;
        mjrSaveSettings(mjrSettings);
        mjrStartAutoRefreshTimer(refreshAllInstances);
      },
    });

    // --- TOASTS ---
    app.ui.settings.addSetting({
      id: `${SETTINGS_PREFIX}.Toasts.Enabled`,
      name: "Majoor: Toasts Enabled",
      type: "boolean",
      defaultValue: mjrSettings.toasts.enabled,
      onChange: (val) => {
        mjrSettings.toasts.enabled = !!val;
        mjrSaveSettings(mjrSettings);
      },
    });

    app.ui.settings.addSetting({
      id: `${SETTINGS_PREFIX}.Toasts.Verbosity`,
      name: "Majoor: Toast Verbosity",
      type: "combo",
      options: ["all", "warnings", "errors", "none"],
      defaultValue: mjrSettings.toasts.verbosity || mjrSettingsDefaults.toasts.verbosity,
      onChange: (val) => {
        mjrSettings.toasts.verbosity = String(val || "all");
        mjrSaveSettings(mjrSettings);
      },
    });

    app.ui.settings.addSetting({
      id: `${SETTINGS_PREFIX}.Toasts.Duration`,
      name: "Majoor: Toast Duration (ms)",
      type: "number",
      defaultValue: Number(mjrSettings.toasts.duration) || mjrSettingsDefaults.toasts.duration,
      attrs: { min: 500, max: 20000, step: 250 },
      onChange: (val) => {
        const n = Math.max(500, Math.min(20000, Math.floor(Number(val) || mjrSettingsDefaults.toasts.duration)));
        mjrSettings.toasts.duration = n;
        mjrSaveSettings(mjrSettings);
      },
    });

    // --- VIEWER SETTINGS ---
    app.ui.settings.addSetting({
      id: `${SETTINGS_PREFIX}.Viewer.Autoplay`,
      name: "Majoor Viewer: Autoplay Videos",
      type: "boolean",
      defaultValue: mjrSettings.viewer.autoplayVideos,
      onChange: (val) => {
        mjrSettings.viewer.autoplayVideos = val;
        mjrSaveSettings(mjrSettings);
        mjrApplyOpenViewerSettings();
      },
    });

    app.ui.settings.addSetting({
      id: `${SETTINGS_PREFIX}.Viewer.Loop`,
      name: "Majoor Viewer: Loop Videos",
      type: "boolean",
      defaultValue: mjrSettings.viewer.loopVideos,
      onChange: (val) => {
        mjrSettings.viewer.loopVideos = val;
        mjrSaveSettings(mjrSettings);
        mjrApplyOpenViewerSettings();
      },
    });

    app.ui.settings.addSetting({
      id: `${SETTINGS_PREFIX}.Viewer.Mute`,
      name: "Majoor Viewer: Mute Videos",
      type: "boolean",
      defaultValue: mjrSettings.viewer.muteVideos,
      onChange: (val) => {
        mjrSettings.viewer.muteVideos = !!val;
        mjrSaveSettings(mjrSettings);
        mjrApplyOpenViewerSettings();
      },
    });

    app.ui.settings.addSetting({
      id: `${SETTINGS_PREFIX}.Viewer.Navigation`,
      name: "Majoor Viewer: Navigation Enabled",
      type: "boolean",
      defaultValue: mjrSettings.viewer.navEnabled,
      onChange: (val) => {
        mjrSettings.viewer.navEnabled = !!val;
        mjrSaveSettings(mjrSettings);
        mjrApplyOpenViewerSettings();
      },
    });

    app.ui.settings.addSetting({
      id: `${SETTINGS_PREFIX}.Viewer.RatingHUD`,
      name: "Majoor Viewer: Show Rating HUD",
      type: "boolean",
      defaultValue: mjrSettings.viewer.showRatingHUD,
      onChange: (val) => {
        mjrSettings.viewer.showRatingHUD = !!val;
        mjrSaveSettings(mjrSettings);
        mjrApplyOpenViewerSettings();
      },
    });

    app.ui.settings.addSetting({
      id: `${SETTINGS_PREFIX}.Viewer.RatingHotkeys`,
      name: "Majoor Viewer: Rating Hotkeys (0-5)",
      type: "boolean",
      defaultValue: mjrSettings.viewer.ratingHotkeys,
      onChange: (val) => {
        mjrSettings.viewer.ratingHotkeys = !!val;
        mjrSaveSettings(mjrSettings);
      },
    });

    app.ui.settings.addSetting({
      id: `${SETTINGS_PREFIX}.Viewer.Checkerboard`,
      name: "Majoor Viewer: Checkerboard Background",
      type: "boolean",
      defaultValue: mjrSettings.viewer.useCheckerboard,
      onChange: (val) => {
        mjrSettings.viewer.useCheckerboard = val;
        mjrSaveSettings(mjrSettings);
      },
    });

    // --- HOTKEYS ---
    app.ui.settings.addSetting({
      id: `${SETTINGS_PREFIX}.Hotkeys.Enabled`,
      name: "Majoor: Hotkeys Enabled",
      type: "boolean",
      defaultValue: mjrSettings.hotkeys.enabled,
      onChange: (val) => {
        mjrSettings.hotkeys.enabled = !!val;
        mjrSaveSettings(mjrSettings);
      },
    });

    app.ui.settings.addSetting({
      id: `${SETTINGS_PREFIX}.Hotkeys.Rating`,
      name: "Majoor: Rating Hotkeys in Grid (0-5)",
      type: "boolean",
      defaultValue: mjrSettings.hotkeys.rating,
      onChange: (val) => {
        mjrSettings.hotkeys.rating = !!val;
        mjrSaveSettings(mjrSettings);
      },
    });

    app.ui.settings.addSetting({
      id: `${SETTINGS_PREFIX}.Hotkeys.SpaceOpen`,
      name: "Majoor: Open Viewer Hotkey (Space)",
      type: "boolean",
      defaultValue: mjrSettings.hotkeys.enterOpen,
      onChange: (val) => {
        mjrSettings.hotkeys.enterOpen = !!val;
        mjrSaveSettings(mjrSettings);
      },
    });

    app.ui.settings.addSetting({
      id: `${SETTINGS_PREFIX}.Hotkeys.FrameStep`,
      name: "Majoor: Viewer Frame-Step Hotkeys",
      type: "boolean",
      defaultValue: mjrSettings.hotkeys.frameStep,
      onChange: (val) => {
        mjrSettings.hotkeys.frameStep = !!val;
        mjrSaveSettings(mjrSettings);
      },
    });

    // --- GENERAL ---
    app.ui.settings.addSetting({
      id: `${SETTINGS_PREFIX}.General.HideSiblings`,
      name: "Majoor: Hide PNG Siblings (Video previews)",
      tooltip: "If a video has a matching .png, hide the .png from the grid",
      type: "boolean",
      defaultValue: mjrSettings.siblings.hidePngSiblings,
      onChange: (val) => {
        mjrSettings.siblings.hidePngSiblings = val;
        mjrSaveSettings(mjrSettings);
        mjrGlobalState.instances.forEach((i) => i.applyFilterAndRender?.());
      },
    });
    
    warnIfNoExiftool();

    if (mjrUseSidebarPanel && app.extensionManager?.registerSidebarTab) {
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
      } catch (err) {
        console.error("[Majoor.AssetsManager] sidebar registration failed", err);
      }
    }
  },
});

if (!window.__MajoorAssetsManagerHotkeysInitialized) {
  window.__MajoorAssetsManagerHotkeysInitialized = true;

  const onKeyDown = (ev) => {
    if (!mjrSettings.hotkeys.enabled) return;
    if (ev.isComposing) return;
    const target = ev.target;
    const tagName = (target && target.tagName) ? String(target.tagName).toUpperCase() : "";
    const isTyping =
      tagName === "INPUT" ||
      tagName === "TEXTAREA" ||
      tagName === "SELECT" ||
      !!(target && target.isContentEditable);
    if (isTyping) return;

    let handled = false;
    if (mjrSettings.hotkeys.rating && /^[0-5]$/.test(ev.key) && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
      mjrGlobalState.instances.forEach(inst => {
        if (!inst?.state) return;
        const rate = parseInt(ev.key, 10);
        const keys = Array.from(inst.state.selected || []);
        const selectedFiles = keys.map(k => inst.state.filtered.find(f => fileKey(f) === k)).filter(Boolean);
        const targets = selectedFiles.length ? selectedFiles : (inst.state.currentFile ? [inst.state.currentFile] : []);
        targets.forEach(f => inst.setRating?.(f, rate));
        if (targets.length) handled = true;
      });
    } else if (
      mjrSettings.hotkeys.enterOpen &&
      (ev.key === " " || ev.key === "Spacebar" || ev.code === "Space") &&
      !ev.ctrlKey &&
      !ev.altKey &&
      !ev.metaKey
    ) {
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
