import { app } from "../../../../scripts/app.js";
import { api } from "../../../../scripts/api.js";
import { buildViewUrl, detectKindFromExt, getExt, mjrSettings, mjrShowToast } from "../ui_settings.js";
import { mjrGlobalState } from "../mjr_global.js";
import { sortFilesDeterministically } from "../am_data.js";

let mjrGlobalRefreshTimer = null;
let mjrFocusListenerAttached = false;
let mjrWorkflowDropBound = false;
let mjrQueueListenerBound = false;
let mjrNewFilesListenerBound = false;
let mjrCapabilitiesCache = null;
const mjrDbg = (...args) => {
  try {
    if (mjrSettings && mjrSettings.debugDnD) {
      console.debug("[Majoor.DnD]", ...args);
    }
  } catch (_) {}
};

export const mjrIsOurDrag = (ev) => {
  const types = Array.from(ev?.dataTransfer?.types || []);
  return types.includes("application/x-mjr-sibling-file");
};
let mjrGraphCanvas = null;
let mjrCanvasObserver = null;

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

export async function mjrFetchFileAsDataTransferFile(info) {
  const url = buildViewUrl(info);
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const name = info.filename || info.name || "file";
    return new File([blob], name, { type: blob.type || "application/octet-stream" });
  } catch {
    return null;
  }
}

export function mjrDispatchSyntheticDrop(target, file) {
  if (!target || !file) return;
  try {
    const dt = new DataTransfer();
    dt.items.add(file);
    const evt = new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      dataTransfer: dt,
    });
    target.dispatchEvent(evt);
  } catch (err) {
    console.warn("[Majoor.AssetsManager] synthetic drop failed", err);
  }
}

export function mjrStartAutoRefreshTimer(refreshAllInstances) {
  if (mjrGlobalRefreshTimer) {
    clearInterval(mjrGlobalRefreshTimer);
    mjrGlobalRefreshTimer = null;
  }
  if (!mjrSettings.autoRefresh.enabled) return;

  const intervalMs = Math.max(3000, Number(mjrSettings.autoRefresh.interval) || 5000);

  mjrGlobalRefreshTimer = setInterval(() => {
    if (mjrSettings.autoRefresh.focusOnly && !document.hasFocus()) return;
    refreshAllInstances({ silent: true, metaOnly: true });
  }, intervalMs);
}

export function ensureGlobalAutoRefresh(refreshAllInstances) {
  mjrStartAutoRefreshTimer(refreshAllInstances);
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

async function persistGenerationMetadata(videoFiles, history) {
  if (!Array.isArray(videoFiles) || !videoFiles.length) return;
  if (!history) return;
  const promptGraph =
    history.prompt ||
    history.prompt_json ||
    history.promptGraph ||
    null;
  const workflow =
    history.workflow ||
    (history.extra_data && history.extra_data.workflow) ||
    (history.extra && history.extra.workflow) ||
    null;
  if (!promptGraph && !workflow) return;

  const payload = {
    files: videoFiles.map((f) => ({
      filename: f.filename || f.name,
      subfolder: f.subfolder || "",
    })),
    prompt: promptGraph,
    workflow,
  };

  try {
    if (mjrCapabilitiesCache === null) {
      const resCap = await fetch("/mjr/filemanager/capabilities");
      if (resCap.ok) {
        mjrCapabilitiesCache = await resCap.json().catch(() => null);
      } else {
        mjrCapabilitiesCache = null;
      }
    }
    const sidecarEnabled = !!(mjrCapabilitiesCache && mjrCapabilitiesCache.sidecar_enabled);
    if (!sidecarEnabled) return;
    await fetch("/mjr/filemanager/generation/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.warn("[Majoor.AssetsManager] generation sidecar update failed", err);
  }
}

export async function refreshAssetsForPrompt(promptId) {
  const history = await fetchHistory(promptId);
  if (!history) return 0;

  const outputs = history.outputs || {};
  const newFiles = [];
  const videoFiles = [];
  Object.entries(outputs).forEach(([nodeId, data]) => {
    if (!data) return;
    if (Array.isArray(data.images)) {
      data.images.forEach((img) => {
        if (!img || img.type !== "output") return;
        const filename = img.filename;
        const subfolder = img.subfolder;
        const ext = getExt(filename);
        const kind = detectKindFromExt(ext);
        newFiles.push({
          filename,
          subfolder,
          type: img.type,
          promptId,
          nodeId,
        });
        if (kind === "video") {
          videoFiles.push({ filename, subfolder });
        }
      });
    }
  });

  if (videoFiles.length) {
    persistGenerationMetadata(videoFiles, history);
  }

  if (newFiles.length > 0) {
    fileManagerStore.addNewGeneratedFiles(newFiles);
    mjrShowToast("success", `${newFiles.length} new file(s)`, "Generated");
    return newFiles.length;
  }
  return 0;
}

export function ensureWorkflowDropHandler() {
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

export function ensureQueueListener(refreshAllInstances) {
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

export function ensureNewFilesListener() {
  if (mjrNewFilesListenerBound) return () => {};
  const onNewFiles = (ev) => {
    const files = ev?.detail?.files || ev?.data?.files || [];
    if (!Array.isArray(files) || !files.length) return;
    const mapped = files
      .map((f) => {
        const filename = f.filename || f.name;
        if (!filename) return null;
        const subfolder = f.subfolder || "";
        const ext = getExt(filename) || "";
        const kind = detectKindFromExt(ext);
        return {
          filename,
          name: filename,
          subfolder,
          ext,
          kind,
          mtime: f.mtime || Date.now(),
          size: 0,
          url: buildViewUrl({ filename, subfolder }),
          type: "output",
        };
      })
      .filter(Boolean);
    if (mapped.length) {
      fileManagerStore.addNewGeneratedFiles(mapped);
    }
  };
  api.addEventListener("mjr_new_files", onNewFiles);
  mjrNewFilesListenerBound = true;
  return () => {
    api.removeEventListener("mjr_new_files", onNewFiles);
    mjrNewFilesListenerBound = false;
  };
}
