import { app } from "../../../../scripts/app.js";
import { api } from "../../../../scripts/api.js";
import { buildViewUrl, detectKindFromExt, getExt, mjrSettings, mjrShowToast } from "../ui_settings.js";
import { mjrGlobalState } from "../mjr_global.js";
import { sortFilesDeterministically } from "../am_data.js";

let mjrGlobalRefreshTimer = null;
let mjrFocusListenerAttached = false;
let mjrVideoNodeDropBridgeBound = false;
let mjrQueueListenerBound = false;
let mjrNewFilesListenerBound = false;
let mjrCapabilitiesCache = null;
try {
  if (typeof window !== "undefined" && window.MJR_DND_DEBUG === undefined) {
    window.MJR_DND_DEBUG = true;
  }
} catch (_) {}
const mjrDbg = (...args) => {
  try {
    if ((mjrSettings && mjrSettings.debugDnD) || (typeof window !== "undefined" && window.MJR_DND_DEBUG)) {
      console.debug("[Majoor.DnD]", ...args);
    }
  } catch (_) {}
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

let mjrHighlightedNode = null;
let mjrHighlightedNodePrev = null;

function getNodeUnderClientXY(clientX, clientY) {
  const canvasEl = app?.canvas?.canvas || document.querySelector("canvas");
  const graph = app?.canvas?.graph;
  const ds = app?.canvas?.ds;
  if (!canvasEl || !graph || !ds) return null;

  const rect = canvasEl.getBoundingClientRect();
  if (
    clientX < rect.left ||
    clientX > rect.right ||
    clientY < rect.top ||
    clientY > rect.bottom
  ) {
    return null;
  }

  const scale = Number(ds.scale) || 1;
  const off = ds.offset || [0, 0];
  const offX = Array.isArray(off) ? Number(off[0]) || 0 : Number(off?.x) || 0;
  const offY = Array.isArray(off) ? Number(off[1]) || 0 : Number(off?.y) || 0;
  const x = (clientX - rect.left) / scale - offX;
  const y = (clientY - rect.top) / scale - offY;

  if (typeof graph.getNodeOnPos === "function") return graph.getNodeOnPos(x, y);

  const nodes = graph._nodes || [];
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (!n?.pos || !n?.size) continue;
    if (
      x >= n.pos[0] &&
      y >= n.pos[1] &&
      x <= n.pos[0] + n.size[0] &&
      y <= n.pos[1] + n.size[1]
    ) {
      return n;
    }
  }
  return null;
}

function isVhsVideoNode(node) {
  if (!node) return false;
  const title = String(node.title || "");
  const type = String(node.type || "");
  if (/video/i.test(title)) return true;
  if (type.includes("VHS_LoadVideo")) return true;

  const widgets = node.widgets;
  if (Array.isArray(widgets)) {
    return widgets.some((w) => String(w?.name || "").toLowerCase() === "video");
  }
  return false;
}

function markCanvasDirty() {
  try {
    app?.graph?.setDirtyCanvas?.(true, true);
  } catch (_) {}
  try {
    app?.canvas?.setDirty?.(true, true);
  } catch (_) {}
}

function applyHighlight(node) {
  if (!node) return;
  if (mjrHighlightedNode === node) return;

  clearHighlight();
  mjrHighlightedNode = node;
  mjrHighlightedNodePrev = { color: node.color, bgcolor: node.bgcolor };
  node.bgcolor = "#3355ff";
  node.color = "#a9c4ff";
  markCanvasDirty();
}

function clearHighlight() {
  if (!mjrHighlightedNode) return;
  try {
    if (mjrHighlightedNodePrev) {
      mjrHighlightedNode.color = mjrHighlightedNodePrev.color;
      mjrHighlightedNode.bgcolor = mjrHighlightedNodePrev.bgcolor;
    }
  } catch (_) {}
  mjrHighlightedNode = null;
  mjrHighlightedNodePrev = null;
  markCanvasDirty();
}

function ensureComboHasValue(widget, value) {
  if (!widget || widget.type !== "combo" || !widget.options) return;

  let vals = null;
  let target = null;
  if (Array.isArray(widget.options.values)) {
    vals = widget.options.values;
    target = widget.options;
  } else if (widget.options.values && Array.isArray(widget.options.values.values)) {
    vals = widget.options.values.values;
    target = widget.options.values;
  }
  if (!Array.isArray(vals) || !target) return;

  const has = vals.some((v) => {
    if (typeof v === "string") return v === value;
    return (v?.content ?? v?.value ?? v?.text) === value;
  });
  if (has) return;

  if (vals.length === 0 || typeof vals[0] === "string") vals.unshift(value);
  else vals.unshift({ content: value, text: value, value });
  target.values = vals;
}

function pickVideoWidget(node) {
  const widgets = node?.widgets;
  if (!Array.isArray(widgets) || !widgets.length) return null;
  const exact = widgets.find((w) => String(w?.name || "").toLowerCase() === "video");
  if (exact) return exact;
  return (
    widgets.find((w) => /video|file|path/i.test(String(w?.name || w?.label || ""))) || null
  );
}

function comboHasValue(widget, value) {
  if (!widget || widget.type !== "combo" || !widget.options) return false;
  const vals =
    (Array.isArray(widget.options.values) && widget.options.values) ||
    (widget.options.values && Array.isArray(widget.options.values.values) && widget.options.values.values) ||
    null;
  if (!Array.isArray(vals)) return false;
  return vals.some((v) => {
    if (typeof v === "string") return v === value;
    return (v?.content ?? v?.value ?? v?.text) === value;
  });
}

export function ensureVideoNodeDropBridge() {
  if (mjrVideoNodeDropBridgeBound) return () => {};

  const onDragOver = (e) => {
    const types = Array.from(e?.dataTransfer?.types || []);
    if (!types.includes("application/x-mjr-asset")) return;

    let payload = null;
    try {
      payload = JSON.parse(e.dataTransfer.getData("application/x-mjr-asset"));
    } catch (_) {
      payload = null;
    }
    if (!payload || payload.kind !== "video") return;

    const node = getNodeUnderClientXY(e.clientX, e.clientY);
    if (node && isVhsVideoNode(node)) {
      e.preventDefault();
      e.stopImmediatePropagation?.();
      e.stopPropagation();
      applyHighlight(node);
      e.dataTransfer.dropEffect = "copy";
      mjrDbg("DnD video dragover", { payload, nodeTitle: node?.title, nodeType: node?.type });
      return;
    }

    clearHighlight();
    // Pass-through: let ComfyUI handle canvas-friendly video drop (workflow embed).
  };

  const onDrop = async (e) => {
    const types = Array.from(e?.dataTransfer?.types || []);
    if (!types.includes("application/x-mjr-asset")) return;

    let payload = null;
    try {
      payload = JSON.parse(e.dataTransfer.getData("application/x-mjr-asset"));
    } catch (_) {
      payload = null;
    }
    if (!payload || payload.kind !== "video") return;

    const node = getNodeUnderClientXY(e.clientX, e.clientY);
    if (!node || !isVhsVideoNode(node)) {
      clearHighlight();
      mjrDbg("DnD video drop pass-through", { payload, nodeTitle: node?.title, nodeType: node?.type });
      return; // leave ComfyUI to load workflow from video metadata
    }

    e.preventDefault();
    e.stopImmediatePropagation?.();
    e.stopPropagation();
    clearHighlight();

    const filename = payload.filename;
    const subfolder = payload.subfolder || "";
    if (!filename) return;

    let stageResp = null;
    try {
      const res = await api.fetchApi("/mjr/filemanager/stage_to_input", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename, subfolder, from_type: "output" }),
      });
      stageResp = res.ok ? await res.json().catch(() => null) : null;
    } catch (_) {
      stageResp = null;
    }

    const relativePath = stageResp?.relative_path;
    const stagedName = stageResp?.filename || stageResp?.name || filename;
    mjrDbg("DnD stage_to_input response", stageResp);

    if (!relativePath && !stagedName) {
      mjrShowToast("error", "Failed to stage video to input", "Drag & Drop");
      return;
    }

    const w = pickVideoWidget(node);
    if (!w) {
      mjrShowToast("warn", "No compatible 'video' widget found", "Drag & Drop");
      return;
    }

    const prefer = w.type === "combo" && comboHasValue(w, relativePath) ? relativePath : null;
    const value =
      prefer ||
      (w.type === "combo" && comboHasValue(w, stagedName) ? stagedName : null) ||
      relativePath ||
      stagedName;

    if (w.type === "combo") ensureComboHasValue(w, value);
    w.value = value;
    try {
      w.callback?.(w.value);
    } catch (_) {}

    markCanvasDirty();

    mjrDbg("DnD video injected", {
      payload,
      nodeTitle: node?.title,
      nodeType: node?.type,
      widget: { name: w?.name, type: w?.type },
      value,
    });
  };

  const onDragLeave = (_e) => {
    clearHighlight();
  };

  window.addEventListener("dragover", onDragOver, true);
  window.addEventListener("drop", onDrop, true);
  window.addEventListener("dragleave", onDragLeave, true);
  mjrVideoNodeDropBridgeBound = true;

  return () => {
    window.removeEventListener("dragover", onDragOver, true);
    window.removeEventListener("drop", onDrop, true);
    window.removeEventListener("dragleave", onDragLeave, true);
    mjrVideoNodeDropBridgeBound = false;
    clearHighlight();
  };
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
