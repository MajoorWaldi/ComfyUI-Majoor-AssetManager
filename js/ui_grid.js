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
import {
  mjrOpenABViewer,
  mjrOpenViewerForFiles,
  mjrStepVideos,
  mjrUpdateNavVisibility,
} from "./ui_viewer.js";
import { createMetadataSidebar } from "./ui_sidebar.js";


// ---------------------------------------------------------------------------
// Majoor File Manager globals + hotkeys
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

const mjrRefreshDefaults = { silent: true, forceFiles: false, metaOnly: false };
let mjrGlobalRefreshPromise = null;
let mjrGlobalRefreshPending = null;

const mergeLoadOpts = (current, next) => {
  if (!current) return next;
  return {
    silent: current.silent && next.silent,
    force: current.force || next.force,
    skipMetadataFetch: current.skipMetadataFetch && next.skipMetadataFetch,
  };
};

const normalizeRefreshOptions = (optionsOrSilent = true, forceFiles = false) => {
  if (typeof optionsOrSilent === "object" && optionsOrSilent !== null) {
    return { ...mjrRefreshDefaults, ...optionsOrSilent };
  }
  return { ...mjrRefreshDefaults, silent: !!optionsOrSilent, forceFiles: !!forceFiles };
};

const mergeRefreshOptions = (current, next) => {
  if (!current) return next;
  return {
    silent: current.silent && next.silent,
    forceFiles: current.forceFiles || next.forceFiles,
    metaOnly: current.metaOnly && next.metaOnly,
  };
};

// Fonction pour mettre à jour visuellement une carte existante sans la recréer
function updateCardVisuals(card, file) {
  // 1. Préparation des nouvelles données
  const rating = Number(file.rating ?? (file.meta && file.meta.rating) ?? 0);
  const tags =
    (Array.isArray(file.tags) && file.tags) ||
    (Array.isArray(file.meta && file.meta.tags) && file.meta.tags) ||
    [];

  // --- GESTION DES ETOILES (RATING) ---
  const newRatingText = rating > 0 ? "★".repeat(rating) : "";
  let ratingBadge = card.querySelector(".mjr-fm-rating-badge");

  if (rating > 0) {
    if (!ratingBadge) {
      ratingBadge = createEl("div", "mjr-fm-rating-badge");
      applyStyles(ratingBadge, BADGE_STYLES.rating);
      ratingBadge.style.color = "#ffd45a";
      ratingBadge.style.filter = "drop-shadow(0 0 2px rgba(255, 212, 90, 0.7))";
      ratingBadge.style.fontWeight = "700";
      ratingBadge.textContent = newRatingText;
      card.appendChild(ratingBadge);
    } else if (ratingBadge.textContent !== newRatingText) {
      ratingBadge.textContent = newRatingText;
    }
  } else if (ratingBadge) {
    ratingBadge.remove();
  }

  // --- GESTION DES TAGS ---
  const newTagsText = mjrSettings.grid.showTags && tags.length > 0 ? tags.join(", ") : "";
  let tagsBadge = card.querySelector(".mjr-fm-tags-badge");

  if (newTagsText) {
    if (!tagsBadge) {
      tagsBadge = createEl("div", "mjr-fm-tags-badge");
      applyStyles(tagsBadge, BADGE_STYLES.tags);
      tagsBadge.textContent = newTagsText;
      card.appendChild(tagsBadge);
    } else if (tagsBadge.textContent !== newTagsText) {
      tagsBadge.textContent = newTagsText;
    }
  } else if (tagsBadge) {
    tagsBadge.remove();
  }
}

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
        console.warn("[Majoor.FileManager] refresh failed for an instance", err);
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
    } catch (err) {
      console.warn("[Majoor.FileManager] apply settings refresh failed", err);
    }
  });
  refreshAllInstances({ silent: true, forceFiles: false });
}

function mjrOpenSettingsDialog() {
  const overlay = document.createElement("div");
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    background: "rgba(0,0,0,0.65)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: "10000",
  });

  const panel = document.createElement("div");
  Object.assign(panel.style, {
    width: "min(520px, 92vw)",
    maxHeight: "90vh",
    overflow: "auto",
    background: "var(--comfy-menu-bg, #111)",
    border: "1px solid var(--border-color, #333)",
    borderRadius: "10px",
    padding: "14px 16px",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    color: "var(--input-fg, #eee)",
  });

  const title = document.createElement("div");
  title.textContent = "Majoor File Manager Settings";
  title.style.fontWeight = "700";
  title.style.fontSize = "1rem";
  panel.appendChild(title);

  const form = document.createElement("div");
  form.style.display = "flex";
  form.style.flexDirection = "column";
  form.style.gap = "10px";

  const makeSection = (label) => {
    const s = document.createElement("div");
    s.style.border = "1px solid var(--border-color, #333)";
    s.style.borderRadius = "8px";
    s.style.padding = "10px";
    s.style.display = "flex";
    s.style.flexDirection = "column";
    s.style.gap = "8px";
    const h = document.createElement("div");
    h.textContent = label;
    h.style.fontWeight = "600";
    h.style.opacity = "0.9";
    h.style.fontSize = "0.85rem";
    s.appendChild(h);
    return s;
  };

  const makeCheckbox = (label, checked) => {
    const row = document.createElement("label");
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.gap = "8px";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !!checked;
    row.appendChild(input);
    const span = document.createElement("span");
    span.textContent = label;
    span.style.fontSize = "0.9rem";
    row.appendChild(span);
    return { row, input };
  };

  const makeNumber = (label, value, min = 0) => {
    const row = document.createElement("label");
    row.style.display = "flex";
    row.style.flexDirection = "column";
    row.style.gap = "4px";
    const span = document.createElement("span");
    span.textContent = label;
    span.style.fontSize = "0.85rem";
    const input = document.createElement("input");
    input.type = "number";
    input.value = value;
    input.min = String(min);
    input.style.width = "140px";
    input.style.background = "var(--comfy-input-bg, #1b1b1b)";
    input.style.color = "var(--input-fg, #eee)";
    input.style.border = "1px solid var(--border-color, #333)";
    input.style.borderRadius = "6px";
    input.style.padding = "4px 6px";
    row.appendChild(span);
    row.appendChild(input);
    return { row, input };
  };

  const makeSelect = (label, value, options) => {
    const row = document.createElement("label");
    row.style.display = "flex";
    row.style.flexDirection = "column";
    row.style.gap = "4px";
    const span = document.createElement("span");
    span.textContent = label;
    span.style.fontSize = "0.85rem";
    const select = document.createElement("select");
    select.style.width = "160px";
    select.style.background = "var(--comfy-input-bg, #1b1b1b)";
    select.style.color = "var(--input-fg, #eee)";
    select.style.border = "1px solid var(--border-color, #333)";
    select.style.borderRadius = "6px";
    select.style.padding = "4px 6px";
    options.forEach(([val, label]) => {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = label;
      if (val === value) opt.selected = true;
      select.appendChild(opt);
    });
    row.appendChild(span);
    row.appendChild(select);
    return { row, select };
  };

  const autoSec = makeSection("Auto-refresh");
  const autoEnabled = makeCheckbox("Enable auto-refresh", mjrSettings.autoRefresh.enabled);
  const autoInterval = makeNumber("Interval (ms)", mjrSettings.autoRefresh.interval, 1000);
  const autoFocus = makeCheckbox("Only when app is focused", mjrSettings.autoRefresh.focusOnly);
  autoSec.appendChild(autoEnabled.row);
  autoSec.appendChild(autoInterval.row);
  autoSec.appendChild(autoFocus.row);
  form.appendChild(autoSec);

  const metaSec = makeSection("Metadata panel");
  const metaShow = makeCheckbox("Show by default", mjrSettings.metaPanel.showByDefault);
  const metaInterval = makeNumber("Refresh interval (ms)", mjrSettings.metaPanel.refreshInterval || 2000, 250);
  metaSec.appendChild(metaShow.row);
  metaSec.appendChild(metaInterval.row);
  form.appendChild(metaSec);

  const gridSec = makeSection("Grid layout");
  const sizeSelect = makeSelect(
    "Card size",
    mjrSettings.grid.cardSize,
    [
      ["compact", "Compact"],
      ["medium", "Medium"],
      ["large", "Large"],
    ]
  );
  const showTags = makeCheckbox("Show tag badges", mjrSettings.grid.showTags);
  const showRating = makeCheckbox("Show rating badges", mjrSettings.grid.showRating);
  gridSec.appendChild(sizeSelect.row);
  gridSec.appendChild(showTags.row);
  gridSec.appendChild(showRating.row);
  form.appendChild(gridSec);

  const viewerSec = makeSection("Viewer");
  const viewerNav = makeCheckbox("Enable nav arrows & hotkeys", mjrSettings.viewer.navEnabled);
  const viewerAuto = makeCheckbox("Autoplay videos", mjrSettings.viewer.autoplayVideos);
  const viewerLoop = makeCheckbox("Loop videos", mjrSettings.viewer.loopVideos);
  const viewerMute = makeCheckbox("Mute videos by default", mjrSettings.viewer.muteVideos);
  const viewerHUD = makeCheckbox("Show rating HUD", mjrSettings.viewer.showRatingHUD);
  const viewerRateKeys = makeCheckbox("Allow rating hotkeys in viewer", mjrSettings.viewer.ratingHotkeys);
  const viewerChecker = makeCheckbox("Checkerboard background for transparent PNGs", mjrSettings.viewer.useCheckerboard);
  viewerSec.appendChild(viewerNav.row);
  viewerSec.appendChild(viewerAuto.row);
  viewerSec.appendChild(viewerLoop.row);
  viewerSec.appendChild(viewerMute.row);
  viewerSec.appendChild(viewerHUD.row);
  viewerSec.appendChild(viewerRateKeys.row);
  viewerSec.appendChild(viewerChecker.row);
  form.appendChild(viewerSec);

  const hotkeySec = makeSection("Hotkeys");
  const hotkeyEnabled = makeCheckbox("Enable global hotkeys", mjrSettings.hotkeys.enabled);
  const hotkeyRating = makeCheckbox("Number keys rate selected (1-5 / 0 clears)", mjrSettings.hotkeys.rating);
  const hotkeyEnterOpen = makeCheckbox("Enter opens viewer (single/AB)", mjrSettings.hotkeys.enterOpen);
  const hotkeyFrameStep = makeCheckbox("Arrow Up/Down frame-step videos in viewer", mjrSettings.hotkeys.frameStep);
  hotkeySec.appendChild(hotkeyEnabled.row);
  hotkeySec.appendChild(hotkeyRating.row);
  hotkeySec.appendChild(hotkeyEnterOpen.row);
  hotkeySec.appendChild(hotkeyFrameStep.row);
  form.appendChild(hotkeySec);

  const siblingSec = makeSection("Siblings");
  const hidePng = makeCheckbox("Hide PNG siblings for non-image files", mjrSettings.siblings.hidePngSiblings);
  siblingSec.appendChild(hidePng.row);
  form.appendChild(siblingSec);

  const toastSec = makeSection("Toasts");
  const toastEnabled = makeCheckbox("Enable toasts", mjrSettings.toasts.enabled);
  const toastVerbosity = makeSelect(
    "Verbosity",
    mjrSettings.toasts.verbosity,
    [
      ["all", "All"],
      ["warn", "Warnings + Errors"],
      ["error", "Errors only"],
    ]
  );
  const toastDuration = makeNumber("Duration (ms)", mjrSettings.toasts.duration, 500);
  toastSec.appendChild(toastEnabled.row);
  toastSec.appendChild(toastVerbosity.row);
  toastSec.appendChild(toastDuration.row);
  form.appendChild(toastSec);

  panel.appendChild(form);

  const actions = document.createElement("div");
  actions.style.display = "flex";
  actions.style.justifyContent = "flex-end";
  actions.style.gap = "8px";
  actions.style.marginTop = "4px";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "comfy-btn";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => {
    document.body.removeChild(overlay);
  });

  const saveBtn = document.createElement("button");
  saveBtn.className = "comfy-btn";
  saveBtn.textContent = "Save";
  saveBtn.style.background = "var(--comfy-accent, #5fb3ff)";
  saveBtn.addEventListener("click", () => {
    const updated = mjrDeepMerge(mjrSettings, {
      autoRefresh: {
        enabled: autoEnabled.input.checked,
        interval: parseInt(autoInterval.input.value, 10) || mjrSettingsDefaults.autoRefresh.interval,
        focusOnly: autoFocus.input.checked,
      },
      metaPanel: { showByDefault: metaShow.input.checked },
      metaPanel: {
        showByDefault: metaShow.input.checked,
        refreshInterval:
          parseInt(metaInterval.input.value, 10) || mjrSettingsDefaults.metaPanel.refreshInterval,
      },
      grid: {
        cardSize: sizeSelect.select.value,
        showTags: showTags.input.checked,
        showRating: showRating.input.checked,
      },
      viewer: {
        navEnabled: viewerNav.input.checked,
        autoplayVideos: viewerAuto.input.checked,
        loopVideos: viewerLoop.input.checked,
        muteVideos: viewerMute.input.checked,
        showRatingHUD: viewerHUD.input.checked,
        ratingHotkeys: viewerRateKeys.input.checked,
        useCheckerboard: viewerChecker.input.checked,
      },
      hotkeys: {
        enabled: hotkeyEnabled.input.checked,
        rating: hotkeyRating.input.checked,
        enterOpen: hotkeyEnterOpen.input.checked,
        frameStep: hotkeyFrameStep.input.checked,
      },
      siblings: { hidePngSiblings: hidePng.input.checked },
      toasts: {
        enabled: toastEnabled.input.checked,
        verbosity: toastVerbosity.select.value,
        duration: parseInt(toastDuration.input.value, 10) || mjrSettingsDefaults.toasts.duration,
      },
    });
    mjrApplySettings(updated);
    document.body.removeChild(overlay);
    mjrShowToast("success", "Settings saved", "Settings");
  });

  actions.appendChild(cancelBtn);
  actions.appendChild(saveBtn);
  panel.appendChild(actions);

  overlay.appendChild(panel);
  document.body.appendChild(overlay);
}

function mjrStartAutoRefreshTimer() {
  if (mjrGlobalRefreshTimer) {
    clearInterval(mjrGlobalRefreshTimer);
    mjrGlobalRefreshTimer = null;
  }
  if (!mjrSettings.autoRefresh.enabled) return;

  // Auto-refresh pas agressif : min 3s
  mjrRefreshMs = Math.max(3000, Number(mjrSettings.autoRefresh.interval) || 5000);

  mjrGlobalRefreshTimer = setInterval(() => {
    if (mjrSettings.autoRefresh.focusOnly && !document.hasFocus()) return;
    // ⚠️ Important : METADATA ONLY → pas de /files → pas de blink
    refreshAllInstances({ silent: true, metaOnly: true });
  }, mjrRefreshMs);
}

function ensureGlobalAutoRefresh() {
  mjrStartAutoRefreshTimer();
  if (!mjrFocusListenerAttached) {
    // Quand tu reviens sur l’onglet, on rafraîchit juste les métadonnées visibles
    window.addEventListener("focus", () =>
      refreshAllInstances({ silent: true, metaOnly: true })
    );
    mjrFocusListenerAttached = true;
  }
}

async function fetchHistory(promptId) {
  try {
    const url = `${location.origin}/history/${promptId}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn("[Majoor.FileManager] history fetch failed", err);
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
    // TODO: extend for videos/audio if needed later
  });

  if (newFiles.length > 0) {
    fileManagerStore.addNewGeneratedFiles(newFiles);
    mjrShowToast("success", `${newFiles.length} new file(s)`, "Generated");
    return newFiles.length;
  }

  return 0;
}

function resetGlobalAutoRefresh() {
  mjrStartAutoRefreshTimer();
}

function ensureWorkflowDropHandler() {
  if (mjrWorkflowDropBound) return;

  window.addEventListener(
    "dragover",
    (ev) => {
      const types = Array.from(ev.dataTransfer?.types || []);
      if (types.includes("application/x-mjr-sibling-file")) {
        ev.preventDefault();
        ev.dataTransfer.dropEffect = "copy";
      }
    },
    true
  );

  window.addEventListener(
    "drop",
    async (ev) => {
      const types = Array.from(ev.dataTransfer?.types || []);
      if (!types.includes("application/x-mjr-sibling-file")) {
        return; // default ComfyUI handling for other drags
      }
      ev.preventDefault();

      let info = null;
      try {
        const raw = ev.dataTransfer.getData("application/x-mjr-sibling-file");
        if (raw) info = JSON.parse(raw);
      } catch (_) {
        info = null;
      }
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
          mjrShowToast("info", "Workflow chargé depuis le sibling PNG.", "Workflow");
        } else {
          mjrShowToast("warn", "Aucun workflow trouvé pour ce sibling.", "Workflow");
        }
      } catch (err) {
        console.warn("[Majoor.FileManager] sibling workflow drop failed", err);
        mjrShowToast("error", "Erreur lors du chargement du workflow sibling", "Workflow");
      }
    },
    true
  );

  mjrWorkflowDropBound = true;
}

// ---------------------------------------------------------------------------
// Queue listener (ComfyUI events) to append new outputs without a full reload
// ---------------------------------------------------------------------------
function ensureQueueListener() {
  if (mjrQueueListenerBound) return;

  // On écoute "execution_success" pour avoir les infos précises (prompt_id)
  const onSuccess = async (ev) => {
    const promptId = ev?.detail?.prompt_id;
    if (promptId) {
      // Cette fonction va chercher l'historique et ajouter les fichiers
      // SANS déclencher de scan disque complet côté serveur
      const added = await refreshAssetsForPrompt(promptId);
      // Filet de sécurité : si rien n'est ajouté via /history, on force un scan
      if (!added) {
        refreshAllInstances({ silent: true, forceFiles: true });
      }
    }
  };

  api.addEventListener("execution_success", onSuccess);
  mjrQueueListenerBound = true;
}

function renderFileManager(root) {
  ensureWorkflowDropHandler();
  ensureQueueListener();
  root.innerHTML = "";
  root.style.display = "flex";
  root.style.flexDirection = "column";
  root.style.height = "100%";

  // ---------------------------------------------------------------------------
  // TOP BAR
  // ---------------------------------------------------------------------------

  const toolbar = createEl("div", "mjr-fm-toolbar");
  toolbar.style.display = "flex";
  toolbar.style.flexDirection = "column";
  toolbar.style.gap = "6px";
  toolbar.style.padding = "8px 12px 6px 12px";
  toolbar.style.borderBottom = "1px solid var(--border-color, #444)";
  toolbar.style.background = "var(--comfy-menu-bg, #111)";

  const headerRow = createEl("div", "mjr-fm-header-row");
  headerRow.style.display = "flex";
  headerRow.style.alignItems = "center";
  headerRow.style.justifyContent = "space-between";

  const title = createEl("div", "mjr-fm-title", "Majoor File Manager");
  title.style.fontWeight = "600";
  title.style.fontSize = "0.85rem";
  title.style.opacity = "0.9";
  const headerActions = createEl("div");
  headerActions.style.display = "flex";
  headerActions.style.gap = "6px";

  const settingsBtn = createEl("button", "comfy-btn");
  settingsBtn.style.padding = "4px 6px";
  settingsBtn.style.borderRadius = "6px";
  settingsBtn.style.display = "flex";
  settingsBtn.style.alignItems = "center";
  settingsBtn.style.gap = "4px";
  const cog = document.createElement("i");
  cog.className = "pi pi-cog";
  settingsBtn.appendChild(cog);
  const settingsLbl = document.createElement("span");
  settingsLbl.textContent = "Settings";
  settingsLbl.style.fontSize = "0.8rem";
  settingsBtn.appendChild(settingsLbl);
  settingsBtn.addEventListener("click", () => mjrOpenSettingsDialog());

  headerActions.appendChild(settingsBtn);

  headerRow.appendChild(title);
  headerRow.appendChild(headerActions);

  const searchRow = createEl("div", "mjr-fm-search-row");
  searchRow.style.display = "flex";
  searchRow.style.alignItems = "center";
  searchRow.style.gap = "6px";

  const search = createEl("input", "mjr-fm-search");
  search.type = "search";
  search.placeholder = "Search outputs…";
  search.style.flex = "1";
  search.style.minWidth = "0";
  search.style.borderRadius = "6px";
  search.style.border = "1px solid var(--border-color, #333)";
  search.style.background = "var(--comfy-input-bg, #1b1b1b)";
  search.style.padding = "6px 8px";
  search.style.fontSize = "0.8rem";
  search.style.color = "var(--input-fg, #eee)";

  const refreshBtn = createEl("button", "mjr-fm-refresh");
  refreshBtn.classList.add("comfy-btn");
  refreshBtn.style.padding = "4px 6px";
  refreshBtn.style.borderRadius = "6px";
  refreshBtn.style.minWidth = "32px";
  refreshBtn.style.display = "flex";
  refreshBtn.style.alignItems = "center";
  refreshBtn.style.justifyContent = "center";

  const refreshIcon = document.createElement("i");
  refreshIcon.className = "pi pi-refresh";
  refreshIcon.style.fontSize = "0.9rem";
  refreshBtn.appendChild(refreshIcon);

  searchRow.appendChild(search);
  searchRow.appendChild(refreshBtn);
  mjrAttachHoverFeedback(search, "Tapez pour filtrer les fichiers par nom ou texte.", 3000);
  mjrAttachHoverFeedback(refreshBtn, "Forcer un rechargement immédiat des outputs.", 3000);

  // --- Filters row: kind + rating + tag ---
  const filterRow = createEl("div", "mjr-fm-filter-row");
  filterRow.style.display = "flex";
  filterRow.style.alignItems = "center";
  filterRow.style.gap = "6px";

  const kindFilterLabel = createEl("div", "", "Type");
  kindFilterLabel.style.fontSize = "0.75rem";
  kindFilterLabel.style.opacity = "0.75";

  const kindFilterSelect = createEl("select", "mjr-fm-filter-kind");
  [
    ["", "All"],
    ["image", "Images"],
    ["video", "Videos"],
    ["audio", "Audio"],
    ["model3d", "3D"],
  ].forEach(([value, label]) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    kindFilterSelect.appendChild(opt);
  });

  const ratingFilterLabel = createEl("div", "", "Min ★");
  ratingFilterLabel.style.fontSize = "0.75rem";
  ratingFilterLabel.style.opacity = "0.75";

  const ratingFilter = createEl("select", "mjr-fm-filter-rating");
  [
    ["0", "All"],
    ["1", "★+"],
    ["2", "★★+"],
    ["3", "★★★+"],
    ["4", "★★★★+"],
    ["5", "★★★★★"],
  ].forEach(([value, label]) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    ratingFilter.appendChild(opt);
  });

  const tagFilterInput = createEl("input", "mjr-fm-filter-tag");
  tagFilterInput.type = "text";
  tagFilterInput.placeholder = "Filter by tag…";
  tagFilterInput.style.flex = "1";
  tagFilterInput.style.minWidth = "0";
  tagFilterInput.style.borderRadius = "6px";
  tagFilterInput.style.border = "1px solid var(--border-color, #333)";
  tagFilterInput.style.background = "var(--comfy-input-bg, #1b1b1b)";
  tagFilterInput.style.padding = "4px 6px";
  tagFilterInput.style.fontSize = "0.8rem";
  tagFilterInput.style.color = "var(--input-fg, #eee)";

  filterRow.appendChild(kindFilterLabel);
  filterRow.appendChild(kindFilterSelect);
  filterRow.appendChild(ratingFilterLabel);
  filterRow.appendChild(ratingFilter);
  filterRow.appendChild(tagFilterInput);
  mjrAttachHoverFeedback(kindFilterSelect, "Filtre par type : image / vidéo / audio / 3D.", 3000);
  mjrAttachHoverFeedback(ratingFilter, "Filtre par note minimum (★).", 3000);
  mjrAttachHoverFeedback(tagFilterInput, "Filtre par tag (séparez avec des virgules).", 3000);

  const status = createEl("div", "mjr-fm-status");
  status.style.marginTop = "2px";
  status.style.fontSize = "0.7rem";
  status.style.opacity = "0.65";

  toolbar.appendChild(headerRow);
  toolbar.appendChild(searchRow);
  toolbar.appendChild(filterRow);
  toolbar.appendChild(status);

  // ---------------------------------------------------------------------------
  // BODY : GRID (gauche) + METADATA PANEL (droite)
  // ---------------------------------------------------------------------------

  const body = createEl("div", "mjr-fm-body");
  body.style.flex = "1";
  body.style.display = "flex";
  body.style.flexDirection = "row";
  body.style.overflow = "hidden";
  body.style.background = "var(--comfy-bg-color, #080808)";

  // LEFT : grid
  const gridWrapper = createEl("div", "mjr-fm-grid-wrapper");
  gridWrapper.style.flex = "1.8";
  gridWrapper.style.overflow = "auto";
  gridWrapper.style.position = "relative";

  const grid = createEl("div", "mjr-fm-grid");
  grid.style.display = "grid";
  const basePx = mjrCardBasePx();
  grid.style.gridTemplateColumns = `repeat(auto-fill, minmax(${basePx}px, 1fr))`;
  grid.style.gap = "8px";
  grid.style.padding = "10px 12px";
  grid.style.alignItems = "start";
  grid.style.gridAutoRows = "auto";
  gridWrapper.appendChild(grid);

  // RIGHT : metadata panel (hidden by default, toggled by "<")
  const metaPanel = createEl("div", "mjr-fm-meta-panel");
  metaPanel.style.flex = "1.4";
  metaPanel.style.borderLeft = "1px solid var(--border-color, #333)";
  metaPanel.style.maxWidth = "480px";
  metaPanel.style.minWidth = "260px";
  metaPanel.style.display = mjrMetaVisible ? "flex" : "none";
  metaPanel.style.flexDirection = "column";
  metaPanel.style.padding = "10px 12px";
  metaPanel.style.gap = "8px";
  metaPanel.style.overflow = "auto";

  const metaTitle = createEl("div", "mjr-fm-meta-title", "Metadata");
  metaTitle.style.fontWeight = "600";
  metaTitle.style.fontSize = "0.8rem";
  metaTitle.style.opacity = "0.9";

  const metaContent = createEl("div", "mjr-fm-meta-content");
  metaContent.style.flex = "1";
  metaContent.style.display = "flex";
  metaContent.style.flexDirection = "column";
  metaContent.style.gap = "8px";

  metaContent.innerHTML =
    '<div style="opacity:.6;font-size:0.8rem;">Click a file to inspect prompts, workflow, rating, and tags.</div>';

  metaPanel.appendChild(metaTitle);
  metaPanel.appendChild(metaContent);

  body.appendChild(gridWrapper);
  body.appendChild(metaPanel);

  let gridRenderScheduled = false;
  const scheduleRender = () => {
    if (gridRenderScheduled) return;
    gridRenderScheduled = true;
    requestAnimationFrame(() => {
      gridRenderScheduled = false;
      renderGrid();
    });
  };

  gridWrapper.addEventListener("scroll", () => {
    scheduleRender();
  });
  window.addEventListener("resize", scheduleRender);

  root.appendChild(toolbar);
  root.appendChild(body);

  // ---------------------------------------------------------------------------
  // STATE
  // ---------------------------------------------------------------------------

  const state = {
    files: [],
    filtered: [],
    search: "",
    minRating: 0,
    kindFilter: "",
    tagFilter: "",
    selected: new Set(), // future multi-select possible
    currentFile: null,
    currentMeta: null,
    loading: false,
    loadingPromise: null,
    metaCache: new Map(),
    metaFetchAt: new Map(),
    nextLoadOpts: null,
    renderVersion: 0,
  };
  kindFilterSelect.value = state.kindFilter;
  let lastSignature = null;
  let metadataFetchInFlight = null;
  let instanceRefreshInFlight = null;
  let instanceRefreshPending = null;

  let openContextMenuEl = null;

  const fileKey = (file) => `${file.subfolder || ""}/${file.filename || file.name || ""}`;

  const sidebar = createMetadataSidebar({
    state,
    metaPanel,
    metaContent,
    applyFilterAndRender,
    refreshAllInstances,
    fileKey,
    onVisibilityChange: (visible) => {
      mjrMetaVisible = visible;
    },
  });

  const { loadMetadataForFile, setMetadataPanelVisibility, updateFileMetadata, setRating } = sidebar;

  const removeFileFromState = (file) => {
    const key = fileKey(file);
    const removeFrom = (arr) => {
      if (!Array.isArray(arr)) return;
      const idx = arr.findIndex((f) => fileKey(f) === key);
      if (idx >= 0) arr.splice(idx, 1);
    };
    removeFrom(state.files);
    removeFrom(state.filtered);
    if (state.selected && state.selected.delete) state.selected.delete(key);
    if (state.currentFile && fileKey(state.currentFile) === key) {
      state.currentFile = null;
      state.currentMeta = null;
    }
    applyFilterAndRender();
    updateStatus();
  };

  function closeContextMenu() {
    if (openContextMenuEl && openContextMenuEl.parentNode) {
      openContextMenuEl.parentNode.removeChild(openContextMenuEl);
    }
    openContextMenuEl = null;
  }

  function createContextMenu(file) {
    const contextMenu = createEl("div", "context-menu");
    applyStyles(contextMenu, CONTEXT_MENU_STYLES);

    const actions = [
      {
        label: "Open in Explorer",
        action: async () => {
          closeContextMenu();
          try {
            const res = await api.fetchApi("/mjr/filemanager/open_explorer", {
              method: "POST",
              body: JSON.stringify({
                filename: file.filename || file.name,
                subfolder: file.subfolder || "",
              }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || data.ok === false) {
              const msg = (data && data.error) || res.statusText || "Request failed";
              throw new Error(msg);
            }
            if (data.warning) {
              mjrShowToast("warn", data.warning, "Explorer");
            } else {
              mjrShowToast("success", "Opened in Explorer", "Explorer");
            }
          } catch (err) {
            console.error("[Majoor.FileManager] open_explorer failed", err);
            mjrShowToast("error", err?.message || "Failed to open in Explorer", "Explorer");
          }
        },
      },
      {
        label: "Compare (selected x2)",
        action: () => {
          closeContextMenu();
          if (state.selected && state.selected.size === 2) {
            const keys = Array.from(state.selected);
            const keyToFile = new Map();
            for (const f of state.filtered) {
              const rawName = f.name || f.filename || "(unnamed)";
              const k = `${f.subfolder || ""}/${rawName}`;
              keyToFile.set(k, f);
            }
            const filesToShow = keys.map((k) => keyToFile.get(k)).filter(Boolean);
            if (filesToShow.length === 2) {
              mjrOpenABViewer(filesToShow[0], filesToShow[1]);
            }
          }
        },
      },
      {
        label: "Delete",
        action: async () => {
          closeContextMenu();
          const filename = file.filename || file.name;
          if (!filename) return;
          const confirmDelete = window.confirm(`Delete "${filename}"?`);
          if (!confirmDelete) return;
          try {
            const res = await api.fetchApi("/mjr/filemanager/delete", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                filename,
                subfolder: file.subfolder || "",
              }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || data.ok === false) {
              const msg = (data && data.error) || res.statusText || "Request failed";
              throw new Error(msg);
            }
            removeFileFromState(file);
            mjrShowToast("success", "File deleted", "Delete");
          } catch (err) {
            console.error("[Majoor.FileManager] delete failed", err);
            mjrShowToast("error", err?.message || "Failed to delete file", "Delete");
          }
        },
      },
    ];

    actions.forEach(({ label, action }) => {
      const item = createEl("div", "", label);
      item.style.padding = "4px 0";
      item.style.cursor = "pointer";
      item.addEventListener("click", () => {
        action();
      });
      contextMenu.appendChild(item);
    });

    return contextMenu;
  }

  function openContextMenu(ev, file) {
    closeContextMenu();

    const contextMenu = createContextMenu(file);
    contextMenu.style.left = `${ev.clientX}px`;
    contextMenu.style.top = `${ev.clientY}px`;

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
  }

  function updateStatus() {
    status.textContent = `${state.filtered.length}/${state.files.length} items - ${state.selected.size} selected`;
  }

  function clearAllSelection() {
    state.selected.forEach((k) => {
      const el = grid.querySelector(`[data-mjr-key="${CSS.escape(k)}"]`);
      if (el) updateCardSelectionStyle(el, false);
    });
    state.selected.clear();
  }

  function renderBadges(card, rating, tags) {
    if (mjrSettings.grid.showRating && rating > 0) {
      const ratingBadge = createEl("div", "mjr-fm-rating-badge", "★".repeat(rating));
      applyStyles(ratingBadge, BADGE_STYLES.rating);
      ratingBadge.style.color = "#ffd45a";
      ratingBadge.style.filter = "drop-shadow(0 0 2px rgba(255, 212, 90, 0.7))";
      ratingBadge.style.fontWeight = "700";
      card.appendChild(ratingBadge);
    }

    if (mjrSettings.grid.showTags && tags && tags.length > 0) {
      const tagsBadge = createEl("div", "mjr-fm-tags-badge", tags.join(", "));
      applyStyles(tagsBadge, BADGE_STYLES.tags);
      card.appendChild(tagsBadge);
    }
  }

  function handleDragStart(file, ev) {
    const kind = file.kind || classifyKind(file);
    const isSiblingTarget =
      kind === "video" || kind === "audio" || kind === "model3d" || kind === "3d" || kind === "other3d";
    if (!isSiblingTarget) {
      return; // default Comfy drag for images/others
    }

    // Provide sibling info so drop can fetch PNG workflow
    ev.dataTransfer.effectAllowed = "copy";
    ev.dataTransfer.setData(
      "application/x-mjr-sibling-file",
      JSON.stringify({ filename: file.filename || file.name, subfolder: file.subfolder || "" })
    );
  }

  function createFileThumb(kind, ext, file, card) {
    const thumb = createEl("div", "mjr-fm-thumb");
    thumb.style.position = "relative";
    thumb.style.aspectRatio = "1 / 1";
    thumb.style.overflow = "hidden";
    thumb.style.background = "#111";

    const badge = createEl("div", "mjr-fm-badge", ext || "FILE");
    badge.style.position = "absolute";
    badge.style.top = "6px";
    badge.style.left = "6px";
    badge.style.padding = "2px 6px";
    badge.style.borderRadius = "4px";
    badge.style.fontSize = "0.65rem";
    badge.style.fontWeight = "600";
    badge.style.background = "rgba(0,0,0,0.7)";
    badge.style.color = "#fff";
    badge.style.textTransform = "uppercase";
    badge.style.pointerEvents = "none";
    thumb.appendChild(badge);

    if (kind === "image") {
      const img = document.createElement("img");
      img.loading = "lazy";
      img.src = file.url || buildViewUrl(file);
      img.style.width = "100%";
      img.style.height = "100%";
      img.style.objectFit = "cover";
      thumb.appendChild(img);
    } else if (kind === "video") {
      const video = document.createElement("video");
      video.src = file.url || buildViewUrl(file);
      video.muted = !!mjrSettings.viewer.muteVideos;
      video.loop = !!mjrSettings.viewer.loopVideos;
      video.playsInline = true;
      video.preload = "metadata";
      video.style.width = "100%";
      video.style.height = "100%";
      video.style.objectFit = "cover";
      thumb.appendChild(video);

      card.addEventListener("mouseenter", () => {
        if (mjrSettings.viewer.autoplayVideos) {
          video.play().catch(() => {});
        }
      });
      card.addEventListener("mouseleave", () => {
        video.pause();
        try {
          video.currentTime = 0;
        } catch (_) {}
      });

      const playIcon = document.createElement("i");
      playIcon.className = "pi pi-play";
      playIcon.style.position = "absolute";
      playIcon.style.right = "8px";
      playIcon.style.bottom = "8px";
      playIcon.style.fontSize = "1rem";
      playIcon.style.padding = "3px 5px";
      playIcon.style.borderRadius = "999px";
      playIcon.style.background = "rgba(0,0,0,0.6)";
      playIcon.style.color = "#fff";
      thumb.appendChild(playIcon);
    } else if (kind === "audio") {
      const audioBg = createEl("div");
      audioBg.style.width = "100%";
      audioBg.style.height = "100%";
      audioBg.style.display = "flex";
      audioBg.style.alignItems = "center";
      audioBg.style.justifyContent = "center";
      audioBg.style.background =
        "linear-gradient(135deg, #1b2735 0%, #090a0f 100%)";

      const icon = document.createElement("i");
      icon.className = "pi pi-volume-up";
      icon.style.fontSize = "1.4rem";
      icon.style.color = "#fff";
      audioBg.appendChild(icon);

      thumb.appendChild(audioBg);
    } else if (kind === "model3d") {
      const modelBg = createEl("div");
      modelBg.style.width = "100%";
      modelBg.style.height = "100%";
      modelBg.style.display = "flex";
      modelBg.style.alignItems = "center";
      modelBg.style.justifyContent = "center";
      modelBg.style.background =
        "radial-gradient(circle at 20% 20%, #3b82f6, #0f172a)";

      const icon = document.createElement("i");
      icon.className = "pi pi-cube";
      icon.style.fontSize = "1.4rem";
      icon.style.color = "#fff";
      modelBg.appendChild(icon);

      thumb.appendChild(modelBg);
    } else {
      const box = createEl("div");
      box.style.width = "100%";
      box.style.height = "100%";
      box.style.display = "flex";
      box.style.alignItems = "center";
      box.style.justifyContent = "center";
      box.style.background = "#111";
      box.textContent = ext || "FILE";
      thumb.appendChild(box);
    }

    return thumb;
  }

  function updateCardSelectionStyle(card, selected) {
    if (selected) {
      card.style.borderColor = "var(--comfy-accent, #5fb3ff)";
      card.style.boxShadow = "0 0 0 1px var(--comfy-accent, #5fb3ff)";
      card.style.background = "rgba(95,179,255,0.10)";
    } else {
      card.style.borderColor = "var(--border-color, #444)";
      card.style.boxShadow = "none";
      card.style.background = "rgba(255,255,255,0.02)";
    }
  }


  // ---------------------------------------------------------------------------
  // GRID RENDER
  // ---------------------------------------------------------------------------

  async function fetchMetadataForVisible() {
    if (metadataFetchInFlight) return metadataFetchInFlight;
    const batch = (state.filtered || [])
      .filter((f) => !f.__metaLoaded)
      .slice(0, 100)
      .map((f) => ({
        filename: f.filename || f.name,
        subfolder: f.subfolder || "",
      }))
      .filter((item) => item.filename);

    if (!batch.length) return;

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
      (data.metadatas || []).forEach((m) => {
        const key = `${m.subfolder || ""}/${m.filename || ""}`;
        metaByKey.set(key, m);
      });

      const applyMeta = (file) => {
        const key = `${file.subfolder || ""}/${file.filename || file.name || ""}`;
        const m = metaByKey.get(key);
        // Si pas de nouvelle donnée pour ce fichier, on ignore
        if (!m) return;

        // Sauvegarde de l'ancien état
        const prevRating = file.rating;
        const prevTagsStr = JSON.stringify(file.tags || []);

        // Mise à jour du modèle de données
        file.rating = m.rating ?? file.rating ?? 0;
        file.tags = Array.isArray(m.tags) ? m.tags : file.tags;
        file.__metaLoaded = true;

        const newTagsStr = JSON.stringify(file.tags || []);

        // Mise à jour DOM uniquement si changement
        if (prevRating !== file.rating || prevTagsStr !== newTagsStr) {
          const card = grid.querySelector(`[data-mjr-key="${CSS.escape(key)}"]`);
          if (card) {
            updateCardVisuals(card, file);
          }
        }
      };

      (state.files || []).forEach(applyMeta);
      // Pas de render complet pour éviter le flicker; badges sont mis à jour ci-dessus
    } catch (err) {
      console.warn("[Majoor.FileManager] batch metadata load failed", err);
    } finally {
      metadataFetchInFlight = null;
    }
  }

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
        const kind = f.kind || detectKindFromExt(f.ext || getExt(raw) || "");
        if (kind && kind !== "image") {
          nonImageStems.add(getBaseName(raw));
        }
      }
    }

    state.filtered = state.files.filter((file) => {
      const rawName = file.name || file.filename || "";
      const extUpper = (file.ext || getExt(rawName) || "").toUpperCase();
      const kind = file.kind || detectKindFromExt(extUpper);
      if (hidePng && nonImageStems && extUpper === "PNG" && nonImageStems.has(getBaseName(rawName))) {
        return false;
      }

      const name = (file.name || file.filename || "").toLowerCase();
      const folder = (file.subfolder || "").toLowerCase();
      const matchesSearch = !q || name.includes(q) || folder.includes(q);

      const fileRating =
        Number(
          file.rating ??
            (file.meta && file.meta.rating) ??
            (file.metadata && file.metadata.rating)
        ) || 0;
      const matchesRating = fileRating >= minRating;

      const tagsArr =
        (Array.isArray(file.tags) && file.tags) ||
        (Array.isArray(file.meta && file.meta.tags) && file.meta.tags) ||
        (Array.isArray(file.metadata && file.metadata.tags) &&
          file.metadata.tags) ||
        [];
      const matchesTags = tagFilter
        ? tagsArr.some((tag) =>
            String(tag).toLowerCase().includes(tagFilter)
          )
        : true;

      const matchesKind = !kindFilter || kind === kindFilter;

      return matchesSearch && matchesRating && matchesTags && matchesKind;
    });
    state.filtered.sort((a, b) => {
      const diff = (b.mtime || 0) - (a.mtime || 0);
      if (diff !== 0) return diff;
      const ak = `${a.subfolder || ""}/${a.name || a.filename || ""}`;
      const bk = `${b.subfolder || ""}/${b.name || b.filename || ""}`;
      return ak.localeCompare(bk);
    });
    state.renderVersion = (state.renderVersion || 0) + 1;
    renderGrid();
    if (!skipMetadataFetch) {
      fetchMetadataForVisible();
    }
  }

  function createFileCard(file, handlers) {
    const rawName = file.name || file.filename || "(unnamed)";
    const baseName = getBaseName(rawName);
    const ext = file.ext || getExt(rawName) || "";
    const kind = file.kind || detectKindFromExt(ext);
    const key = `${file.subfolder || ""}/${rawName}`;
    const cardSize = mjrCardBasePx();

    const rating =
      Number(
        file.rating ??
          (file.meta && file.meta.rating) ??
          (file.metadata && file.metadata.rating)
      ) || 0;
    const tags =
      (Array.isArray(file.tags) && file.tags) ||
      (Array.isArray(file.meta && file.meta.tags) && file.meta.tags) ||
      (Array.isArray(file.metadata && file.metadata.tags) && file.metadata.tags) ||
      [];

    const card = createEl("div", "mjr-fm-card");
    card.dataset.mjrKey = key;
    card.__mjrFile = file; // keep a live pointer to the latest file object
    applyStyles(card, CARD_STYLES);
    card.style.transition =
      "border-color 0.12s ease, box-shadow 0.12s ease, background 0.12s ease";
    card.style.width = "100%";

    renderBadges(card, rating, tags);

    const thumb = createFileThumb(kind, ext, file, card);
    thumb.style.width = "100%";
    thumb.style.aspectRatio = "1 / 1";
    thumb.style.height = "auto";

    const meta = createEl("div", "mjr-fm-meta");
    meta.style.padding = "6px";
    meta.style.display = "flex";
    meta.style.flexDirection = "column";
    meta.style.gap = "2px";
    meta.style.fontSize = "0.75rem";

    const name = createEl("div", "mjr-fm-name", baseName || "(unnamed)");
    name.style.fontWeight = "500";
    name.style.whiteSpace = "nowrap";
    name.style.textOverflow = "ellipsis";
    name.style.overflow = "hidden";

    const folder = createEl(
      "div",
      "mjr-fm-folder",
      file.subfolder || "(root)"
    );
    folder.style.opacity = "0.7";

    meta.appendChild(name);
    meta.appendChild(folder);

    card.appendChild(thumb);
    card.appendChild(meta);

    const currentFile = () => card.__mjrFile || file;

    card.draggable = true;
    card.addEventListener("dragstart", (ev) => handleDragStart(currentFile(), ev));

    // Hover (sans casser la sélection)
    card.addEventListener("mouseenter", () => {
      if (!state.selected.has(key)) {
        card.style.borderColor = "var(--comfy-accent-soft, #888)";
        card.style.background = "rgba(255,255,255,0.04)";
      }
    });
    card.addEventListener("mouseleave", () => {
      updateCardSelectionStyle(card, state.selected.has(key));
    });

    // Click = sélection UNIQUE
    card.addEventListener("click", (ev) => {
      ev.preventDefault();
      handlers?.onSelect?.(currentFile(), card.dataset.mjrKey || key, card, ev);
    });

    card.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      handlers?.onContextMenu?.(ev, currentFile());
    });

    card.addEventListener("dblclick", (ev) => {
      ev.preventDefault();
      handlers?.onOpen?.(currentFile(), card.dataset.mjrKey || key, ev);
    });

    updateCardSelectionStyle(card, state.selected.has(key));
    return card;
  }

  let lastRenderWindow = { startIndex: -1, endIndex: -1, cols: -1, version: -1 };

  function renderGrid() {
    const basePx = mjrCardBasePx();
    grid.style.gridTemplateColumns = `repeat(auto-fill, minmax(${basePx}px, 1fr))`;

    // Remove legacy non-card nodes (e.g., loading messages)
    Array.from(grid.children).forEach((el) => {
      const isSpacer =
        el.classList &&
        (el.classList.contains("mjr-fm-top-spacer") || el.classList.contains("mjr-fm-bottom-spacer"));
      if (!isSpacer && (!el.dataset || !el.dataset.mjrKey)) {
        el.remove();
      }
    });

    const estimateRowHeight = () => basePx + 90; // image + meta + gaps (approx)
    const getCols = () => {
      const containerWidth = gridWrapper.clientWidth || grid.clientWidth || 1;
      const gapPx = 8;
      const colWidth = basePx + gapPx;
      return Math.max(1, Math.floor(containerWidth / colWidth));
    };
    const cols = getCols();
    const rowHeight = estimateRowHeight();
    const viewportHeight = gridWrapper.clientHeight || 0;
    const scrollTop = gridWrapper.scrollTop || 0;
    const overscanRows = 2;
    const startRow = Math.max(0, Math.floor(scrollTop / rowHeight) - overscanRows);
    const endRow = Math.floor((scrollTop + viewportHeight) / rowHeight) + overscanRows;
    const startIndex = startRow * cols;
    const endIndex = Math.min(state.filtered.length, (endRow + 1) * cols);
    const totalRows = Math.ceil(state.filtered.length / cols) || 0;
    const rowsBefore = startRow;
    const rowsAfter = Math.max(0, totalRows - Math.ceil(endIndex / cols));

    // Fast bail-out: if visible window unchanged since last render, skip expensive DOM work
    if (
      lastRenderWindow.version === state.renderVersion &&
      lastRenderWindow.startIndex === startIndex &&
      lastRenderWindow.endIndex === endIndex &&
      lastRenderWindow.cols === cols
    ) {
      return;
    }

    let topSpacer = grid.querySelector(".mjr-fm-top-spacer");
    let bottomSpacer = grid.querySelector(".mjr-fm-bottom-spacer");
    if (!topSpacer) {
      topSpacer = createEl("div", "mjr-fm-top-spacer");
      topSpacer.style.gridColumn = "1 / -1";
      topSpacer.style.height = "0px";
      grid.appendChild(topSpacer);
    }
    if (!bottomSpacer) {
      bottomSpacer = createEl("div", "mjr-fm-bottom-spacer");
      bottomSpacer.style.gridColumn = "1 / -1";
      bottomSpacer.style.height = "0px";
      grid.appendChild(bottomSpacer);
    }
    // ensure spacers are at correct positions (top spacer first)
    if (grid.firstElementChild !== topSpacer) {
      grid.insertBefore(topSpacer, grid.firstElementChild);
    }

    // Handlers utilisés par createFileCard
    const handlers = {
      onSelect: (file, key, card, ev) => {
        const multi = ev && (ev.ctrlKey || ev.metaKey);
        if (!multi) {
          clearAllSelection();
          if (state.selected && state.selected.clear) {
            state.selected.clear();
          }
        }
        if (multi && state.selected.has(key)) {
          state.selected.delete(key);
          updateCardSelectionStyle(card, false);
        } else {
          state.selected.add(key);
          state.currentFile = file;
          updateCardSelectionStyle(card, true);
        }
        updateStatus();
        if (mjrMetaVisible) {
          loadMetadataForFile(file);
        }
      },
      onContextMenu: (ev, file) => {
        openContextMenu(ev, file);
      },
      onOpen: (file, ev) => {
        let filesToShow = [];
        if (state.selected && state.selected.size === 2) {
          const keys = Array.from(state.selected);
          const keyToFile = new Map();
          for (const f of state.filtered) {
            const rawName = f.name || f.filename || "(unnamed)";
            const k = `${f.subfolder || ""}/${rawName}`;
            keyToFile.set(k, f);
          }
          filesToShow = keys.map((k) => keyToFile.get(k)).filter(Boolean);
        }
        if (!filesToShow.length) {
          filesToShow = [file];
        }
        mjrOpenViewerForFiles(filesToShow, state.filtered);
      },
      isSelected: (key) => state.selected.has(key),
    };

    if (!state.filtered.length) {
      grid.innerHTML = "";
      const empty = createEl("div", "", "No outputs found.");
      empty.style.opacity = "0.7";
      empty.style.padding = "10px";
      grid.appendChild(empty);
      updateStatus();
      return;
    }

    // 2. Indexation des cartes actuelles
    const existingCards = new Map();
    Array.from(grid.children).forEach((el) => {
      if (el === topSpacer || el === bottomSpacer) return;
      if (el.dataset && el.dataset.mjrKey) existingCards.set(el.dataset.mjrKey, el);
    });

    const keptKeys = new Set();

    // 3. Préparation des cartes dans l'ordre de state.filtered
    const visibleFiles = state.filtered.slice(startIndex, endIndex);
    const cardVersion = (file) => {
      const rating =
        Number(
          file.rating ??
            (file.meta && file.meta.rating) ??
            (file.metadata && file.metadata.rating)
        ) || 0;
      const tags =
        (Array.isArray(file.tags) && file.tags) ||
        (Array.isArray(file.meta && file.meta.tags) && file.meta.tags) ||
        (Array.isArray(file.metadata && file.metadata.tags) && file.metadata.tags) ||
        [];
      return `${rating}|${tags.length ? tags.join(",") : ""}|${file.mtime || ""}`;
    };
    const orderedElements = visibleFiles.map((file) => {
      const rawName = file.name || file.filename || "";
      const key = `${file.subfolder || ""}/${rawName}`;
      keptKeys.add(key);

      let card = existingCards.get(key);
      if (card) {
        card.__mjrFile = file;
        const nextVersion = cardVersion(file);
        if (card.__mjrVersion !== nextVersion) {
          updateCardVisuals(card, file);
          card.__mjrVersion = nextVersion;
        }
      } else {
        card = createFileCard(file, handlers);
        card.dataset.mjrKey = key;
        updateCardVisuals(card, file);
        card.__mjrVersion = cardVersion(file);
      }
      return card;
    });

    // 4. Suppression des cartes orphelines
    existingCards.forEach((el, key) => {
      if (!keptKeys.has(key)) el.remove();
    });

    // 5. Réorganisation DOM pour correspondre exactement à orderedElements
    const baseIndex = topSpacer ? 1 : 0;
    orderedElements.forEach((card, index) => {
      const desiredIndex = baseIndex + index;
      const currentAtPos = grid.children[desiredIndex];
      if (currentAtPos !== card) {
        if (currentAtPos) {
          grid.insertBefore(card, currentAtPos);
        } else {
          grid.appendChild(card);
        }
      }
    });
    // Spacer heights to preserve scroll area
    topSpacer.style.height = `${rowsBefore * rowHeight}px`;
    bottomSpacer.style.height = `${rowsAfter * rowHeight}px`;
    if (bottomSpacer.parentNode !== grid || grid.lastElementChild !== bottomSpacer) {
      grid.appendChild(bottomSpacer);
    }

    lastRenderWindow = {
      startIndex,
      endIndex,
      cols,
      version: state.renderVersion,
    };

    updateStatus();
  }

  // ---------------------------------------------------------------------------
  // LOAD
  // ---------------------------------------------------------------------------

  function computeSignature(files) {
    try {
      return files
        .map((f) => {
          const path = `${f.subfolder || ""}/${f.filename || f.name || ""}`;
          const rating =
            f.rating ??
            (f.meta && f.meta.rating) ??
            (f.metadata && f.metadata.rating) ??
            0;
          const tags =
            (Array.isArray(f.tags) && f.tags) ||
            (Array.isArray(f.meta && f.meta.tags) && f.meta.tags) ||
            (Array.isArray(f.metadata && f.metadata.tags) && f.metadata.tags) ||
            [];
          return `${path}|${f.mtime || ""}|${f.size || ""}|${rating}|${
            tags.length
          }|${tags.join(",")}`;
        })
        .join(";");
    } catch (err) {
      console.warn("[Majoor.FileManager] signature error", err);
      return null;
    }
  }

  function sortFilesDeterministically(files) {
    files.sort((a, b) => {
      const diff = (b.mtime || 0) - (a.mtime || 0);
      if (diff !== 0) return diff;
      const ak = `${a.subfolder || ""}/${a.filename || a.name || ""}`;
      const bk = `${b.subfolder || ""}/${b.filename || b.name || ""}`;
      return ak.localeCompare(bk);
    });
  }

  async function loadFiles(silent = false, force = false, { skipMetadataFetch = false } = {}) {
    const requested = { silent, force, skipMetadataFetch };
    if (state.loadingPromise) {
      state.nextLoadOpts = mergeLoadOpts(state.nextLoadOpts, requested);
      return state.loadingPromise;
    }

    state.loadingPromise = (async () => {
      state.loading = true;
      if (!silent && grid.children.length === 0) {
        grid.innerHTML = '<div style="opacity:.7;padding:10px;">Loading outputs…</div>';
      }
      try {
        if (!force && Array.isArray(mjrPrefetchedFiles) && mjrPrefetchedFiles.length) {
          const sig = computeSignature(mjrPrefetchedFiles);
          state.files = mjrPrefetchedFiles;
          lastSignature = sig;
          applyFilterAndRender({ skipMetadataFetch });
        }

        const params = new URLSearchParams();
        params.set("t", Date.now().toString()); // anti-cache navigateur
        if (force) params.set("force", "1");

        const res = await api.fetchApi(`/mjr/filemanager/files?${params.toString()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const incoming = data.files || data.items || [];

        // Stabilise ordering so signature matches when content is unchanged
        sortFilesDeterministically(incoming);

        // Préserver rating/tags déjà chargés pour éviter les clignotements de badges
        const prevMap = new Map();
        (state.files || []).forEach((f) => {
          const raw = f.name || f.filename || "";
          const k = `${f.subfolder || ""}/${raw}`;
          prevMap.set(k, f);
        });
        incoming.forEach((f) => {
          const raw = f.name || f.filename || "";
          const k = `${f.subfolder || ""}/${raw}`;
          const prev = prevMap.get(k);
          if (prev) {
            if (prev.rating !== undefined) f.rating = prev.rating;
            if (Array.isArray(prev.tags)) f.tags = prev.tags;
            if (prev.__metaLoaded) f.__metaLoaded = true;
          }
        });

        const sig = computeSignature(incoming);
        if (!force && sig && sig === lastSignature) {
          lastSignature = sig;
          return;
        }
        state.files = incoming;
        lastSignature = sig;
        applyFilterAndRender({ skipMetadataFetch });
      } catch (err) {
        console.error("[Majoor.FileManager] load error", err);
        grid.innerHTML =
          '<div style="color:#e66;padding:10px;">Error loading files (see console).</div>';
        mjrShowToast("error", "Error loading files", "Error");
      } finally {
        state.loading = false;
        const pending = state.nextLoadOpts;
        state.nextLoadOpts = null;
        const prevPromise = state.loadingPromise;
        state.loadingPromise = null;
        if (pending) {
          // Re-run once with the latest requested options (coalesced)
          await loadFiles(pending.silent, pending.force, {
            skipMetadataFetch: pending.skipMetadataFetch,
          });
        }
        return prevPromise;
      }
    })();

    return state.loadingPromise;
  }

  const refreshInstance = async (options = {}) => {
    const opts = { ...mjrRefreshDefaults, ...options };
    if (instanceRefreshInFlight) {
      instanceRefreshPending = mergeRefreshOptions(instanceRefreshPending, opts);
      return instanceRefreshInFlight;
    }

    const run = async () => {
      if (!opts.metaOnly) {
        await loadFiles(opts.silent, opts.forceFiles, { skipMetadataFetch: true });
      }
      await fetchMetadataForVisible();
    };

    instanceRefreshInFlight = run().finally(() => {
      const pending = instanceRefreshPending;
      instanceRefreshPending = null;
      instanceRefreshInFlight = null;
      if (pending) {
        refreshInstance(pending);
      }
    });

    return instanceRefreshInFlight;
  };

  // Events top bar
  search.addEventListener("input", () => {
    state.search = search.value;
    applyFilterAndRender();
  });

  kindFilterSelect.addEventListener("change", () => {
    state.kindFilter = kindFilterSelect.value || "";
    applyFilterAndRender();
  });

  ratingFilter.addEventListener("change", () => {
    state.minRating = parseInt(ratingFilter.value, 10) || 0;
    applyFilterAndRender();
  });

  tagFilterInput.addEventListener("input", () => {
    state.tagFilter = tagFilterInput.value;
    applyFilterAndRender();
  });

  refreshBtn.addEventListener("click", () => {
    refreshAllInstances({ silent: false, forceFiles: true });
    resetGlobalAutoRefresh();
  });

  // First load
  refreshInstance({ silent: false, forceFiles: true }).finally(() => {
    ensureGlobalAutoRefresh();
  });

  // Register this instance so global hotkeys can act
  const instance = {
    root,
    metaPanel,
    state,
    loadMetadataForFile,
    setMetadataPanelVisibility,
    setRating,
    updateFileMetadata,
    refresh: refreshInstance,
    loadFiles,
    applyFilterAndRender,
  };
  mjrGlobalState.instances.add(instance);
  ensureGlobalAutoRefresh();

  // Cleanup on unmount to avoid duplicate instances/refresh loops
  const cleanup = () => {
    try {
      mjrGlobalState.instances.delete(instance);
    } catch (_) {}
  };
  // Expose a destroy hook on the root element
  root.__mjrCleanup = cleanup;
}

 // ---------------------------------------------------------------------------
// Extension registration : sidebar + bottom panel
// ---------------------------------------------------------------------------

app.registerExtension({
  name: "Majoor.FileManager",

  bottomPanelTabs: [
    {
      id: "majoorFileManagerBottom",
      title: "File Manager",
      type: "custom",
      render: (el) => renderFileManager(el),
      // Cleanup hook when the panel is destroyed
      destroy: (el) => {
        if (el && el.__mjrCleanup) {
          try {
            el.__mjrCleanup();
          } catch (_) {}
        }
      },
    },
  ],

  async setup(appInstance = app, apiInstance = api) {
    try {
      app.extensionManager.registerSidebarTab({
        id: "majoorFileManagerSidebar",
        icon: "pi pi-folder-open",
        title: "File Manager",
        tooltip: "Majoor File Manager",
        type: "custom",
        render: (el) => renderFileManager(el),
        destroy: (el) => {
          if (el && el.__mjrCleanup) {
            try {
              el.__mjrCleanup();
            } catch (_) {}
          }
        },
      });
    } catch (err) {
      console.error("[Majoor.FileManager] sidebar registration failed", err);
    }

  },
});
// Hotkeys
if (!window.__MajoorFileManagerHotkeysInitialized) {
  window.__MajoorFileManagerHotkeysInitialized = true;
  window.addEventListener("keydown", (ev) => {
    if (!mjrSettings.hotkeys.enabled) return;
    const tagName = ev.target && ev.target.tagName ? ev.target.tagName.toUpperCase() : "";
    const isTyping =
      tagName === "INPUT" ||
      tagName === "TEXTAREA" ||
      (ev.target && ev.target.isContentEditable);

    // Allow metadata toggle even while typing; keep other hotkeys blocked
    const allowMetaToggle = ev.key === "<" && !ev.ctrlKey && !ev.altKey && !ev.metaKey;
    if (isTyping && !allowMetaToggle) return;

    if (ev.key === "Tab" && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
      const sidebarBtn =
        document.querySelector('[data-sidebar-tab-id="majoorFileManagerSidebar"]') ||
        Array.from(document.querySelectorAll("button, [role=tab]")).find((el) => {
          try {
            if (el.dataset && el.dataset.sidebarTabId === "majoorFileManagerSidebar") return true;
          } catch (_) {}
          const text = (el.textContent || "").trim();
          return text === "File Manager";
        });

      if (sidebarBtn && sidebarBtn instanceof HTMLElement) {
        sidebarBtn.click();
        ev.preventDefault();
      }
      return;
    }

    if (
      mjrSettings.hotkeys.rating &&
      !ev.ctrlKey &&
      !ev.altKey &&
      !ev.metaKey &&
      /^[0-5]$/.test(ev.key)
    ) {
      const ratingValue = parseInt(ev.key, 10);
      let applied = false;

      mjrGlobalState.instances.forEach((inst) => {
        const file = inst.state && inst.state.currentFile;
        if (!file || typeof inst.setRating !== "function") return;
        inst.setRating(file, ratingValue);
        applied = true;
      });

      if (applied) ev.preventDefault();
      return;
    }

    if (
      mjrSettings.hotkeys.enterOpen &&
      ev.key === "Enter" &&
      !ev.ctrlKey &&
      !ev.altKey &&
      !ev.metaKey
    ) {
      let opened = false;
      mjrGlobalState.instances.forEach((inst) => {
        if (opened) return;
        const state = inst.state;
        if (!state || !state.selected || state.selected.size === 0) return;
        const files = [];
        const keyToFile = new Map();
        for (const f of state.filtered || []) {
          const rawName = f.name || f.filename || "(unnamed)";
          const k = `${f.subfolder || ""}/${rawName}`;
          keyToFile.set(k, f);
        }
        const keys = Array.from(state.selected);
        for (const k of keys) {
          const f = keyToFile.get(k);
          if (f) files.push(f);
        }
        if (!files.length) return;
        if (files.length >= 2) {
          mjrOpenViewerForFiles([files[0], files[1]], state.filtered);
        } else {
          mjrOpenViewerForFiles([files[0]], state.filtered);
        }
        opened = true;
      });
      if (opened) ev.preventDefault();
      return;
    }

    // Metadata panel toggle via "<" is disabled per request
  });
}
