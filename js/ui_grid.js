import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import {
  applyStyles,
  BADGE_STYLES,
  buildViewUrl,
  CARD_STYLES,
  CONTEXT_MENU_STYLES,
  createEl,
  detectKindFromExt,
  getBaseName,
  getExt,
  mjrAttachHoverFeedback,
  mjrCardBasePx,
  mjrDeepMerge,
  mjrPrefetchedFiles,
  mjrSaveSettings,
  mjrSettings,
  mjrSettingsDefaults,
  mjrShowToast,
  setMjrSettings,
  mjrGlobalState,
} from "./ui_settings.js";
import { createInitialState, fileKey } from "./am_state.js";
import {
  mjrRefreshDefaults,
  mergeLoadOpts,
  normalizeRefreshOptions,
  mergeRefreshOptions,
  sortFilesDeterministically,
  loadFiles as fmLoadFiles,
  createRefreshInstance,
} from "./am_data.js";
import { SMART_FILTERS, normalizeMtimeValue } from "./am_filters.js";
import { mjrCreateContextMenu } from "./am_context_menu.js";
import {
  mjrOpenABViewer,
  mjrOpenViewerForFiles,
  mjrStepVideos,
  mjrUpdateNavVisibility,
} from "./ui_viewer.js";
import { createMetadataSidebar } from "./ui_sidebar.js";
import { createGridView } from "./am_gridview.js";

// ---------------------------------------------------------------------------
// Majoor Assets Manager globals + hotkeys
// ---------------------------------------------------------------------------

let mjrMetaVisible = !!mjrSettings.metaPanel.showByDefault;
let mjrGlobalRefreshTimer = null;
let mjrFocusListenerAttached = false;
let mjrWorkflowDropBound = false;
let mjrLastDragFile = null;
let mjrRefreshMs = mjrSettings.autoRefresh.interval || 5000;
let mjrQueueListenerBound = false;

const fileManagerStore = {
  addNewGeneratedFiles(newFiles = []) {
    if (!Array.isArray(newFiles) || !newFiles.length) return;
    const now = Date.now();

    mjrGlobalState.instances.forEach((inst) => {
      const state = inst.state;
      if (!state || !Array.isArray(state.files)) return;

      const existingKeys = new Set(
        state.files.map((f) => `${f.subfolder || ""}/${f.filename || f.name || ""}`)
      );

      let added = false;
      newFiles.forEach((nf) => {
        const filename = nf?.filename;
        if (!filename || nf?.type !== "output") return;
        const subfolder = nf.subfolder || "";
        const key = `${subfolder}/${filename}`;
        if (existingKeys.has(key)) return;

        const ext = getExt(filename) || "";
        const kind = detectKindFromExt(ext);
        const fileObj = {
          filename,
          name: filename,
          subfolder,
          ext,
          kind,
          mtime: now,
          size: 0,
          url: buildViewUrl({ filename, subfolder }),
          promptId: nf.promptId,
          nodeId: nf.nodeId,
        };

        state.files.push(fileObj);
        existingKeys.add(key);
        added = true;
      });

      if (added) {
        sortFilesDeterministically(state.files);
        if (typeof inst.applyFilterAndRender === "function") {
          inst.applyFilterAndRender();
        }
      }
    });
  },
};

let mjrGlobalRefreshPromise = null;
let mjrGlobalRefreshPending = null;

function refreshAllInstances(optionsOrSilent = true, force = false) {
  const opts = normalizeRefreshOptions(optionsOrSilent, force);
  if (mjrGlobalRefreshPromise) {
    mjrGlobalRefreshPending = mergeRefreshOptions(mjrGlobalRefreshPending, opts);
    return mjrGlobalRefreshPromise;
  }

  const run = async () => {
    const instances = Array.from(mjrGlobalState.instances);
    for (const inst of instances) {
      try {
        if (typeof inst.refresh === "function") {
          await inst.refresh(opts);
        } else if (typeof inst.loadFiles === "function") {
          await inst.loadFiles(opts.silent, opts.forceFiles, { skipMetadataFetch: false });
        }
      } catch (err) {
        console.warn("[Majoor.AssetsManager] refresh failed for an instance", err);
        if (!opts.silent) mjrShowToast("warn", "Auto refresh failed", "Warning");
      }
    }
  };

  mjrGlobalRefreshPromise = run().finally(() => {
    const pending = mjrGlobalRefreshPending;
    mjrGlobalRefreshPending = null;
    mjrGlobalRefreshPromise = null;
    if (pending) {
      refreshAllInstances(pending);
    }
  });

  return mjrGlobalRefreshPromise;
}

function mjrApplySettings(newSettings) {
  setMjrSettings(mjrDeepMerge(mjrSettingsDefaults, newSettings || {}));
  mjrSaveSettings(mjrSettings);
  mjrMetaVisible = !!mjrSettings.metaPanel.showByDefault;
  mjrStartAutoRefreshTimer();
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

function mjrStartAutoRefreshTimer() {
  if (mjrGlobalRefreshTimer) {
    clearInterval(mjrGlobalRefreshTimer);
    mjrGlobalRefreshTimer = null;
  }
  if (!mjrSettings.autoRefresh.enabled) return;

  const mjrRefreshMs = Math.max(3000, Number(mjrSettings.autoRefresh.interval) || 5000);

  mjrGlobalRefreshTimer = setInterval(() => {
    if (mjrSettings.autoRefresh.focusOnly && !document.hasFocus()) return;
    refreshAllInstances({ silent: true, metaOnly: true });
  }, mjrRefreshMs);
}

function ensureGlobalAutoRefresh() {
  mjrStartAutoRefreshTimer();
  if (!mjrFocusListenerAttached) {
    const onFocus = () => refreshAllInstances({ silent: true, metaOnly: true });
    window.addEventListener("focus", onFocus);
    mjrFocusListenerAttached = true;
    return () => window.removeEventListener("focus", onFocus);
  }
  return () => {};
}

async function fetchHistory(promptId) {
  try {
    const url = `${location.origin}/history/${promptId}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn("[Majoor.AssetsManager] history fetch failed", err);
    return null;
  }
}

async function refreshAssetsForPrompt(promptId) {
  const history = await fetchHistory(promptId);
  if (!history) return 0;

  const outputs = history.outputs || {};
  const newFiles = [];
  Object.entries(outputs).forEach(([nodeId, data]) => {
    if (!data) return;
    if (Array.isArray(data.images)) {
      data.images.forEach((img) => {
        if (!img || img.type !== "output") return;
        newFiles.push({
          filename: img.filename,
          subfolder: img.subfolder,
          type: img.type,
          promptId,
          nodeId,
        });
      });
    }
  });

  if (newFiles.length > 0) {
    fileManagerStore.addNewGeneratedFiles(newFiles);
    mjrShowToast("success", `${newFiles.length} new file(s)`, "Generated");
    return newFiles.length;
  }
  return 0;
}

function ensureWorkflowDropHandler() {
  if (mjrWorkflowDropBound) return () => {};

  const onDragOver = (ev) => {
    const types = Array.from(ev.dataTransfer?.types || []);
    if (types.includes("application/x-mjr-sibling-file")) {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "copy";
    }
  };

  const onDrop = async (ev) => {
    const types = Array.from(ev.dataTransfer?.types || []);
    if (!types.includes("application/x-mjr-sibling-file")) return;
    ev.preventDefault();

    let info = null;
    try {
      const raw = ev.dataTransfer.getData("application/x-mjr-sibling-file");
      if (raw) info = JSON.parse(raw);
    } catch (_) { info = null; }
    if (!info || !info.filename) return;

    try {
      const params = new URLSearchParams();
      params.set("filename", info.filename);
      if (info.subfolder) params.set("subfolder", info.subfolder);
      const res = await api.fetchApi(`/mjr/filemanager/metadata?${params.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.ok && data.generation && data.generation.workflow) {
        app.loadGraphData(data.generation.workflow);
        mjrShowToast("info", "Workflow loaded from sibling PNG.", "Workflow");
      } else {
        mjrShowToast("warn", "No workflow found for this sibling.", "Workflow");
      }
    } catch (err) {
      console.warn("[Majoor.AssetsManager] sibling workflow drop failed", err);
      mjrShowToast("error", "Failed to load sibling workflow", "Workflow");
    }
  };

  window.addEventListener("dragover", onDragOver, true);
  window.addEventListener("drop", onDrop, true);
  mjrWorkflowDropBound = true;

  return () => {
    window.removeEventListener("dragover", onDragOver, true);
    window.removeEventListener("drop", onDrop, true);
    mjrWorkflowDropBound = false;
  };
}

function ensureQueueListener() {
  if (mjrQueueListenerBound) return () => {};

  const onExecutionSuccess = async (ev) => {
    const promptId = ev?.detail?.prompt_id;
    if (promptId) {
      const added = await refreshAssetsForPrompt(promptId);
      if (!added) {
        refreshAllInstances({ silent: true, forceFiles: true });
      }
    }
  };

  api.addEventListener("execution_success", onExecutionSuccess);
  mjrQueueListenerBound = true;

  return () => {
    api.removeEventListener("execution_success", onExecutionSuccess);
    mjrQueueListenerBound = false;
  };
}

function renderAssetsManager(root) {
  const cleanups = [];
  cleanups.push(ensureWorkflowDropHandler());
  cleanups.push(ensureQueueListener());
  cleanups.push(ensureGlobalAutoRefresh());

  root.innerHTML = "";
  Object.assign(root.style, { display: "flex", flexDirection: "column", height: "100%" });
  
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
  search.placeholder = "Search outputs…";
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

  const kindFilterSelect = createEl("select", "mjr-fm-filter-kind");
  [["", "All"], ["image", "Images"], ["video", "Videos"], ["audio", "Audio"], ["model3d", "3D"]].forEach(([value, label]) => {
    kindFilterSelect.add(new Option(label, value));
  });

  const ratingFilter = createEl("select", "mjr-fm-filter-rating");
  [["0", "All"], ["1", "★+"], ["2", "★★+"], ["3", "★★★+"], ["4", "★★★★+"], ["5", "★★★★★"]].forEach(([value, label]) => {
    ratingFilter.add(new Option(label, value));
  });

  const tagFilterInput = createEl("input", "mjr-fm-filter-tag");
  tagFilterInput.type = "text";
  tagFilterInput.placeholder = "Filter by tag…";
  Object.assign(tagFilterInput.style, { flex: "1", minWidth: "0", borderRadius: "6px", border: "1px solid var(--border-color, #333)", background: "var(--comfy-input-bg, #1b1b1b)", padding: "4px 6px", fontSize: "0.8rem", color: "var(--input-fg, #eee)" });

  filterRow.append(
    createEl("div", "", "Type", { fontSize: "0.75rem", opacity: "0.75" }),
    kindFilterSelect,
    createEl("div", "", "Min ★", { fontSize: "0.75rem", opacity: "0.75" }),
    ratingFilter,
    tagFilterInput
  );
  mjrAttachHoverFeedback(kindFilterSelect, "Filter by type: image / video / audio / 3D.", 3000);
  mjrAttachHoverFeedback(ratingFilter, "Filter by minimum rating (★).", 3000);
  mjrAttachHoverFeedback(tagFilterInput, "Filter by tag (separate with commas).", 3000);

  const collectionFilterSelect = createEl("select", "mjr-fm-filter-collection");
  collectionFilterSelect.style.maxWidth = "140px";
  
  const refreshCollections = async () => {
    collectionFilterSelect.innerHTML = '<option value="">(All Files)</option>';
    const smartGroup = createEl("optgroup");
    smartGroup.label = "Smart Views";
    Object.entries(SMART_FILTERS).forEach(([key, def]) => {
      const opt = new Option(def.label, key);
      if (state.activeCollection === key) opt.selected = true;
      smartGroup.appendChild(opt);
    });
    collectionFilterSelect.appendChild(smartGroup);

    const manualGroup = createEl("optgroup");
    manualGroup.label = "Collections";
    try {
      const res = await api.fetchApi("/mjr/collections/list");
      const data = await res.json();
      (data.collections || []).forEach((name) => {
        const opt = new Option(name, name);
        if (state.activeCollection === name) opt.selected = true;
        manualGroup.appendChild(opt);
      });
    } catch (e) { console.error(e); }
    collectionFilterSelect.appendChild(manualGroup);
  };

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

  const state = createInitialState();
  state.visibleStart = 0;
  state.visibleEnd = 50;
  kindFilterSelect.value = state.kindFilter;
  refreshCollections();

  let metadataFetchInFlight = null;
  let metadataDebounceTimer = null;
  const lastSignatureRef = { value: null };
  let openContextMenuEl = null;

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
  
  // Visible Metadata Fetching
  async function fetchMetadataForVisible() {
    if (metadataFetchInFlight) return;
    const fullList = state.filtered || [];
    const { visibleStart: start, visibleEnd: end } = state;
    
    const buffer = 20;
    const effectiveStart = Math.max(0, start - buffer);
    const effectiveEnd = Math.min(fullList.length, end + buffer);
    
    const visibleSlice = fullList.slice(effectiveStart, effectiveEnd);
    const targetFiles = visibleSlice.filter(f => !f.__metaLoaded);

    if (!targetFiles.length) return;
    const batch = targetFiles.slice(0, 30).map(f => ({ filename: f.filename || f.name, subfolder: f.subfolder || "" }));
    
    metadataFetchInFlight = api.fetchApi("/mjr/filemanager/metadata/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: batch }),
    });

    try {
      const res = await metadataFetchInFlight;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      
      const metaByKey = new Map();
      (data.metadatas || []).forEach((m) => metaByKey.set(`${m.subfolder || ""}/${m.filename || ""}`, m));

      state.files.forEach(f => {
        const key = `${f.subfolder || ""}/${f.filename || f.name || ""}`;
        const m = metaByKey.get(key);
        if (m) {
            f.rating = m.rating ?? 0;
            f.tags = m.tags || [];
            f.__metaLoaded = true;
        }
      });
      
      // Tell grid to redraw to show badges
      if (gridView) gridView.renderGrid(); 

    } catch (err) {
      console.warn("[Majoor.AssetsManager] batch metadata load failed", err);
    } finally {
      metadataFetchInFlight = null;
      // Re-check in case user scrolled while fetching
      if (fullList.slice(effectiveStart, effectiveEnd).some(f => !f.__metaLoaded)) {
        fetchMetadataForVisible();
      }
    }
  }

  const onRequestMetadata = (start, end) => {
    state.visibleStart = start;
    state.visibleEnd = end;
    if (metadataDebounceTimer) clearTimeout(metadataDebounceTimer);
    metadataDebounceTimer = setTimeout(() => fetchMetadataForVisible(), 150);
  };
  cleanups.push(() => clearTimeout(metadataDebounceTimer));

  // Instantiate GridView module
  const gridDeps = {
      state, grid, gridWrapper, statusEl: status,
      loadMetadataForFile: sidebar.loadMetadataForFile,
      openContextMenu,
      onRequestMetadata,
      isMetaVisible: () => mjrMetaVisible,
  };
  const gridView = createGridView(gridDeps);
  const handleScroll = () => gridView.renderGrid();
  const handleResize = () => gridView.renderGrid();
  gridWrapper.addEventListener("scroll", handleScroll);
  window.addEventListener("resize", handleResize);
  cleanups.push(() => gridWrapper.removeEventListener("scroll", handleScroll));
  cleanups.push(() => window.removeEventListener("resize", handleResize));

  // --- FILTER & LOAD ---

  function applyFilterAndRender(options = {}) {
    const { skipMetadataFetch = false } = options;
    const q = (state.search || "").trim().toLowerCase();
    const tagFilter = (state.tagFilter || "").trim().toLowerCase();
    const minRating = Number(state.minRating || 0);
    const kindFilter = (state.kindFilter || "").toLowerCase();
    const hidePng = !!mjrSettings.siblings.hidePngSiblings;
    let nonImageStems = null;
    if (hidePng) {
      nonImageStems = new Set();
      for (const f of state.files) {
        const raw = f.name || f.filename || "";
        if ((f.kind || detectKindFromExt(f.ext || getExt(raw) || "")) !== "image") {
          nonImageStems.add(getBaseName(raw));
        }
      }
    }

    state.filtered = state.files.filter((file) => {
      const rawName = file.name || file.filename || "";
      const extUpper = (file.ext || getExt(rawName) || "").toUpperCase();
      const kind = file.kind || detectKindFromExt(extUpper);
      if (hidePng && nonImageStems?.has(getBaseName(rawName)) && extUpper === "PNG") return false;

      const name = rawName.toLowerCase();
      const folder = (file.subfolder || "").toLowerCase();
      if (q && !name.includes(q) && !folder.includes(q)) return false;
      
      file.mtime = normalizeMtimeValue(file.mtime);
      if (state.collectionSet) {
        const fileRelPath = `${file.subfolder ? file.subfolder + "/" : ""}${rawName}`;
        if (!state.collectionSet.has(fileRelPath)) return false;
      } else if (state.smartFilter && !state.smartFilter(file)) {
        return false;
      }

      const fileRating = Number(file.rating ?? 0);
      if (fileRating < minRating) return false;

      const tagsArr = file.tags || [];
      if (tagFilter && !tagsArr.some((tag) => String(tag).toLowerCase().includes(tagFilter))) return false;

      return !kindFilter || kind === kindFilter;
    });

    // Sort by Date Descending
    state.filtered.sort((a, b) => (b.mtime - a.mtime) || a.name.localeCompare(b.name));
    state.renderVersion = (state.renderVersion || 0) + 1;
    
    // Delegate rendering to GridView
    gridView.renderGrid();
    
    if (!skipMetadataFetch) {
      fetchMetadataForVisible(); 
    }
  }

  const loadFiles = (silent = false, force = false, { skipMetadataFetch = false } = {}) =>
    fmLoadFiles(state, grid, applyFilterAndRender, { silent, force, skipMetadataFetch }, { lastSignatureRef, mergeLoadOptsFn: mergeLoadOpts });

  const loadFilesWrapper = (opts = {}) => loadFiles(opts.silent ?? true, opts.forceFiles ?? false, { skipMetadataFetch: opts.skipMetadataFetch ?? true });

  const refreshInstance = createRefreshInstance(state, fetchMetadataForVisible, loadFilesWrapper, {
    mjrRefreshDefaults,
    mergeRefreshOptionsFn: mergeRefreshOptions,
  });

  // --- EVENTS ---
  const onSearchInput = () => { state.search = search.value; applyFilterAndRender(); };
  const onKindFilterChange = () => { state.kindFilter = kindFilterSelect.value || ""; applyFilterAndRender(); };
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
  kindFilterSelect.addEventListener("change", onKindFilterChange);
  ratingFilter.addEventListener("change", onRatingFilterChange);
  tagFilterInput.addEventListener("input", onTagFilterInput);
  refreshBtn.addEventListener("click", onRefreshClick);
  collectionFilterSelect.addEventListener("change", onCollectionChange);
  cleanups.push(() => search.removeEventListener("input", onSearchInput));
  cleanups.push(() => kindFilterSelect.removeEventListener("change", onKindFilterChange));
  cleanups.push(() => ratingFilter.removeEventListener("change", onRatingFilterChange));
  cleanups.push(() => tagFilterInput.removeEventListener("input", onTagFilterInput));
  cleanups.push(() => refreshBtn.removeEventListener("click", onRefreshClick));
  cleanups.push(() => collectionFilterSelect.removeEventListener("change", onCollectionChange));

  // Initial Load
  refreshInstance({ silent: false, forceFiles: true }).finally(() => {
    if (!root.__mjrCleanup) return; 
    cleanups.push(ensureGlobalAutoRefresh());
  });

  // Register Instance
  const instance = { root, state, loadMetadataForFile, setMetadataPanelVisibility, setRating, updateFileMetadata, refresh: refreshInstance, loadFiles, applyFilterAndRender };
  mjrGlobalState.instances.add(instance);
  
  root.__mjrCleanup = () => {
    root.__mjrCleanup = null;
    mjrGlobalState.instances.delete(instance);
    cleanups.forEach(c => c());
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
        mjrStartAutoRefreshTimer();
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
        mjrStartAutoRefreshTimer();
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
