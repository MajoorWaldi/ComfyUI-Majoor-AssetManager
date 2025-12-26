import { api } from "../../../scripts/api.js";
import {
  buildViewUrl,
  createEl,
  detectKindFromExt,
  getBaseName,
  getExt,
  mjrAttachHoverFeedback,
  mjrSettings,
  mjrShowToast,
} from "./ui_settings.js";

export function createMetadataSidebar(options) {
  const {
    state,
    metaPanel,
    metaContent,
    applyFilterAndRender,
    refreshAllInstances,
    fileKey,
    onVisibilityChange,
  } = options;

  let metaRequestSeq = 0;
  const metadataKey = (file) =>
    fileKey
      ? fileKey(file)
      : `${file?.subfolder || ""}/${file?.filename || file?.name || ""}`;

  const cacheAllows = (metaCacheEntry, file, metaSourcePath, metaSourceMtime) => {
    if (!metaCacheEntry) return false;
    const cachedMtime = metaCacheEntry.mtime;
    const fileMtime = file?.mtime;
    if (cachedMtime === fileMtime) return true;
    if (metaCacheEntry.sourceMtime !== undefined) {
      if (metaSourceMtime !== undefined && metaCacheEntry.sourceMtime === metaSourceMtime) {
        return true;
      }
      if (metaSourceMtime === undefined) return true;
    }
    if (!cachedMtime && !metaCacheEntry.sourceMtime) return true;
    return false;
  };

  function createCopyField(label, value, multiline = false) {
    const wrapper = createEl("div", "mjr-fm-meta-field");
    wrapper.style.display = "flex";
    wrapper.style.flexDirection = "column";
    wrapper.style.gap = "4px";

    const lbl = createEl("div", "mjr-fm-meta-label", label);
    lbl.style.fontSize = "0.7rem";
    lbl.style.opacity = "0.8";

    const row = createEl("div", "mjr-fm-meta-row");
    row.style.display = "flex";
    row.style.gap = "4px";

    const field = createEl("div", "mjr-fm-meta-value");
    field.textContent = value || "";
    field.style.padding = "6px 8px";
    field.style.background = "rgba(255,255,255,0.03)";
    field.style.border = "1px solid var(--border-color, #333)";
    field.style.borderRadius = "6px";
    field.style.flex = "1";
    field.style.fontSize = "0.78rem";
    field.style.whiteSpace = multiline ? "pre-wrap" : "nowrap";
    field.style.overflow = "hidden";
    field.style.textOverflow = "ellipsis";

    const copyBtn = createEl("button", "comfy-btn", "Copy");
    copyBtn.style.fontSize = "0.7rem";
    copyBtn.style.padding = "2px 6px";
    copyBtn.style.borderRadius = "6px";
    copyBtn.addEventListener("click", () => {
      const toCopy = value || "";
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard
          .writeText(toCopy)
          .then(() => mjrShowToast("success", "Copied to clipboard", "Copy"))
          .catch(() => mjrShowToast("error", "Unable to copy", "Copy"));
      } else {
        const tmp = document.createElement("textarea");
        tmp.value = toCopy;
        document.body.appendChild(tmp);
        tmp.select();
        try {
          document.execCommand("copy");
          mjrShowToast("success", "Copied to clipboard", "Copy");
        } catch (e) {
          mjrShowToast("error", "Unable to copy", "Copy");
        }
        document.body.removeChild(tmp);
      }
    });

    row.appendChild(field);
    row.appendChild(copyBtn);

    wrapper.appendChild(lbl);
    wrapper.appendChild(row);

    return wrapper;
  }

  function showMetadataPanel(file, meta, errorText = null) {
    const rawName = file.name || file.filename || "(unnamed)";
    const baseName = getBaseName(rawName);
    const ext = file.ext || getExt(rawName) || "";
    const kind = file.kind || detectKindFromExt(ext);

    const url = file.url || buildViewUrl(file);

    // Cleanup video/audio elements before clearing content
    try {
      const videos = metaContent.querySelectorAll("video");
      videos.forEach((video) => {
        video.pause();
        video.src = "";
        video.load(); // Release resources
      });
      const audios = metaContent.querySelectorAll("audio");
      audios.forEach((audio) => {
        audio.pause();
        audio.src = "";
        audio.load(); // Release resources
      });
    } catch (e) {
      console.warn("[Majoor.Sidebar] Error cleaning up media elements", e);
    }

    metaContent.innerHTML = "";
    metaContent.style.userSelect = "text"; // allow copying any text in the sidebar

    const previewShell = createEl("div", "mjr-fm-meta-preview");
    previewShell.style.borderRadius = "8px";
    previewShell.style.overflow = "hidden";
    previewShell.style.border = "1px solid var(--border-color, #333)";
    previewShell.style.background = "#050505";
    previewShell.style.display = "flex";
    previewShell.style.alignItems = "center";
    previewShell.style.justifyContent = "center";
    previewShell.style.minHeight = "180px";
    previewShell.style.maxHeight = "320px";

    if (kind === "image") {
      const img = document.createElement("img");
      img.src = url;
      img.style.maxWidth = "100%";
      img.style.maxHeight = "100%";
      img.style.objectFit = "contain";
      previewShell.appendChild(img);
    } else if (kind === "video") {
      const video = document.createElement("video");
      video.src = url;
      video.controls = true;
      video.loop = true;
      video.playsInline = true;
      video.muted = false;
      video.style.maxWidth = "100%";
      video.style.maxHeight = "100%";
      video.style.objectFit = "contain";
      previewShell.appendChild(video);
    } else if (kind === "audio") {
      const audioBox = createEl("div");
      audioBox.style.display = "flex";
      audioBox.style.flexDirection = "column";
      audioBox.style.alignItems = "center";
      audioBox.style.justifyContent = "center";
      audioBox.style.gap = "8px";
      audioBox.style.padding = "12px";

      const icon = document.createElement("i");
      icon.className = "pi pi-volume-up";
      icon.style.display = "block";
      icon.style.fontSize = "1.6rem";
      icon.style.color = "#fff";

      const audio = document.createElement("audio");
      audio.src = url;
      audio.controls = true;
      audio.style.width = "100%";

      audioBox.appendChild(icon);
      audioBox.appendChild(audio);
      previewShell.appendChild(audioBox);
    } else if (kind === "model3d") {
      const wrap = createEl("div");
      wrap.style.display = "flex";
      wrap.style.flexDirection = "column";
      wrap.style.alignItems = "center";
      wrap.style.justifyContent = "center";
      wrap.style.padding = "10px";

      const icon = document.createElement("i");
      icon.className = "pi pi-cube";
      icon.style.display = "block";
      icon.style.fontSize = "1.6rem";
      icon.style.marginBottom = "6px";
      icon.style.color = "#fff";

      const text = createEl(
        "div",
        "",
        "3D file (preview placeholder). Use an external viewer for full inspection."
      );
      text.style.color = "#eee";
      text.style.opacity = "0.8";
      text.style.fontSize = "0.8rem";
      text.style.textAlign = "center";

      wrap.appendChild(icon);
      wrap.appendChild(text);
      previewShell.appendChild(wrap);
    } else {
      const text = createEl("div", "", "Unsupported preview type. Open in new tab or OS.");
      text.style.color = "#eee";
      text.style.opacity = "0.8";
      text.style.fontSize = "0.8rem";
      previewShell.appendChild(text);
    }

    const metaHeader = createEl("div", "mjr-fm-meta-header");
    metaHeader.style.display = "flex";
    metaHeader.style.flexDirection = "column";
    metaHeader.style.gap = "2px";
    metaHeader.style.fontSize = "0.8rem";

    const infoLine = createEl(
      "div",
      "mjr-fm-meta-info",
      `${ext || ""}${ext && file.kind ? " • " : ""}${file.kind || ""}${
        file.size_readable ? " • " + file.size_readable : ""
      }${file.date ? " • " + file.date : ""}`
    );
    infoLine.style.opacity = "0.75";

    metaHeader.appendChild(infoLine);

    const nameLineTop = createEl("div", "mjr-fm-meta-name", baseName || "(unnamed)");
    nameLineTop.style.fontWeight = "600";
    nameLineTop.style.marginBottom = "6px";
    metaContent.appendChild(nameLineTop);
    metaContent.appendChild(previewShell);
    metaContent.appendChild(metaHeader);

    if (errorText) {
      const errBox = createEl("div", "mjr-fm-meta-error", errorText);
      errBox.style.marginTop = "8px";
      errBox.style.padding = "6px 8px";
      errBox.style.borderRadius = "6px";
      errBox.style.border = "1px solid #b33";
      errBox.style.background = "rgba(180,40,40,0.15)";
      errBox.style.fontSize = "0.75rem";
      metaContent.appendChild(errBox);
      return;
    }

    const m = meta || {};
    // Normalize workflow presence for UI state
    const workflowPresent = !!(m.has_workflow || m.workflow || (file && file.hasWorkflow));
    if (m.has_workflow === undefined) m.has_workflow = workflowPresent;
    if (file && workflowPresent) file.hasWorkflow = true;
    const normStr = (v) => (typeof v === "string" ? v.trim() : "");
    const cleanName = (val) => {
      if (typeof val !== "string") return "";
      let n = val.replace(/\\/g, "/").split("/").pop();
      n = n.replace(/\.(safetensors|ckpt|pth|bin)$/i, "");
      return n.trim();
    };
    const cleanList = (str) =>
      str
        .split(",")
        .map((s) => cleanName(s))
        .filter(Boolean)
        .join(", ");
    const positive = normStr(m.positive_prompt);
    const negative = normStr(m.negative_prompt);
    const seedList =
      Array.isArray(m.seeds) ? m.seeds : m.seed !== undefined && m.seed !== null ? [m.seed] : [];
    const seeds = seedList.join(", ").trim();
    const samplerList = Array.isArray(m.samplers)
      ? m.samplers
      : m.sampler_name
      ? [m.sampler_name]
      : [];
    const samplers = samplerList.join(", ").trim();
    const cfgList = Array.isArray(m.cfg_scales)
      ? m.cfg_scales
      : m.cfg !== undefined && m.cfg !== null
      ? [m.cfg]
      : [];
    const cfg = cfgList.join(", ").trim();
    const modelsRaw = Array.isArray(m.models)
      ? m.models.join(", ").trim()
      : m.model
      ? String(m.model).trim()
      : "";
    const models = modelsRaw ? cleanList(modelsRaw) : "";
    const loras = Array.isArray(m.loras)
      ? m.loras
          .map((l) => {
            if (typeof l === "string") return l.trim();
            if (l && typeof l === "object" && l.name) return String(l.name).trim();
            return null;
          })
          .filter(Boolean)
          .join(", ")
      : "";
    const lorasClean = loras ? cleanList(loras) : "";

    const hasPositive = positive.length > 0;
    const hasNegative = negative.length > 0;
    const hasSeeds = seeds.length > 0;
    const hasCfg = cfg.length > 0;
    const hasSamplers = samplers.length > 0;
    const hasModels = models.length > 0;
    const hasLoras = loras.length > 0;
    const hasWorkflow = workflowPresent;
    // Consider file as having generation data if it has workflow OR traditional generation params
    const hasAnyGen =
      hasPositive || hasNegative || hasSeeds || hasCfg || hasSamplers || hasModels || hasLoras || hasWorkflow;

    const topDivider = createEl("div");
    topDivider.style.borderTop = "1px solid var(--border-color, #333)";
    topDivider.style.margin = "10px 0 8px 0";
    metaContent.appendChild(topDivider);

    const ratingCount = Math.max(0, Math.min(5, parseInt(m.rating, 10) || 0));
    const ratingBlock = createEl("div", "mjr-fm-meta-rating-block");
    ratingBlock.style.display = "flex";
    ratingBlock.style.flexDirection = "column";
    ratingBlock.style.gap = "4px";
    ratingBlock.style.paddingBottom = "8px";
    ratingBlock.style.borderBottom = "1px solid var(--border-color, #333)";

    const ratingLabel = createEl("div", "mjr-fm-meta-label", "RATING");
    ratingLabel.style.fontSize = "0.7rem";
    ratingLabel.style.opacity = "0.8";

    const ratingStars = createEl("div", "mjr-fm-meta-rating");
    ratingStars.style.fontSize = "2rem";
    ratingStars.style.lineHeight = "1.2";
    ratingStars.style.color = "#ffd45a";
    ratingStars.style.letterSpacing = "3px";
    ratingStars.style.display = "flex";
    ratingStars.style.gap = "6px";
    mjrAttachHoverFeedback(ratingStars, "Click to rate 1-5 (0 clears).", 3000);

    for (let i = 1; i <= 5; i++) {
      const star = createEl("span", "mjr-fm-meta-star", i <= ratingCount ? "★" : "☆");
      star.style.cursor = "pointer";
      star.style.userSelect = "none";
      star.style.color = i <= ratingCount ? "#ffd45a" : "#777";
      star.style.transition = "color 0.15s ease";
      star.addEventListener("click", () => {
        file.rating = i;
        setRating(file, i);
      });
      ratingStars.appendChild(star);
    }

    ratingBlock.appendChild(ratingLabel);
    ratingBlock.appendChild(ratingStars);
    metaContent.appendChild(ratingBlock);

    const tagsDivider = createEl("div");
    tagsDivider.style.borderTop = "1px solid var(--border-color, #333)";
    tagsDivider.style.margin = "10px 0 8px 0";
    metaContent.appendChild(tagsDivider);

    const tagsBlock = createEl("div", "mjr-fm-meta-tags-block");
    tagsBlock.style.display = "flex";
    tagsBlock.style.flexDirection = "column";
    tagsBlock.style.gap = "6px";
    tagsBlock.style.paddingTop = "8px";

    const tagsLabel = createEl("div", "mjr-fm-meta-label", "TAGS");
    tagsLabel.style.fontSize = "0.7rem";
    tagsLabel.style.opacity = "0.8";

    const tagsRow = createEl("div", "mjr-fm-meta-row");
    tagsRow.style.display = "flex";
    tagsRow.style.gap = "4px";
    tagsRow.style.alignItems = "stretch";

    const tagsInput = document.createElement("input");
    tagsInput.type = "text";
    tagsInput.value = (m.tags || []).join(", ");
    tagsInput.style.flex = "1";
    tagsInput.style.minWidth = "0";
    tagsInput.style.borderRadius = "6px";
    tagsInput.style.border = "1px solid var(--border-color, #333)";
    tagsInput.style.background = "var(--comfy-input-bg, #1b1b1b)";
    tagsInput.style.color = "var(--input-fg, #eee)";
    tagsInput.style.fontSize = "0.75rem";
    tagsInput.style.padding = "4px 6px";
    mjrAttachHoverFeedback(tagsInput, "Enter tags (comma-separated) then Save.", 3000);

    const saveTagsBtn = createEl("button", "comfy-btn", "Save");
    saveTagsBtn.style.fontSize = "0.7rem";
    saveTagsBtn.style.padding = "2px 8px";
    saveTagsBtn.style.borderRadius = "6px";

	    const persistTags = async () => {
	      const newTags = tagsInput.value
	        .split(",")
	        .map((t) => t.trim())
	        .filter((t) => t.length > 0);
	      file.tags = newTags;
	      await updateFileMetadata(file, { tags: newTags }, "Tags updated");
	    };

    saveTagsBtn.addEventListener("click", () => persistTags());
    tagsInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        persistTags();
      }
    });

    tagsRow.appendChild(tagsInput);
    tagsRow.appendChild(saveTagsBtn);
    tagsBlock.appendChild(tagsLabel);
    tagsBlock.appendChild(tagsRow);
    metaContent.appendChild(tagsBlock);

    const tagsBottomDivider = createEl("div");
    tagsBottomDivider.style.borderTop = "1px solid var(--border-color, #333)";
    tagsBottomDivider.style.margin = "10px 0 10px 0";
    metaContent.appendChild(tagsBottomDivider);

    const fieldsContainer = createEl("div", "mjr-fm-meta-fields");
    fieldsContainer.style.display = "flex";
    fieldsContainer.style.flexDirection = "column";
    fieldsContainer.style.gap = "6px";
    fieldsContainer.style.marginTop = "8px";

    const addColoredField = (label, value, multiline = false, color = "#5fb3ff") => {
      const field = createCopyField(label, value, multiline);
      const lbl = field.querySelector(".mjr-fm-meta-label");
      if (lbl) {
        lbl.style.color = color;
        lbl.style.fontWeight = "700";
      }
      return field;
    };

    if (hasPositive) fieldsContainer.appendChild(addColoredField("POSITIVE PROMPT", positive, true, "#8bd5ff"));
    if (hasNegative) fieldsContainer.appendChild(addColoredField("NEGATIVE PROMPT", negative, true, "#ff9f7f"));
    if (hasSeeds) fieldsContainer.appendChild(addColoredField("SEED(S)", seeds, false, "#d1b3ff"));

    const genLines = [];
    if (models) genLines.push(`Model: ${models}`);
    if (lorasClean) genLines.push(`LoRAs: ${lorasClean}`);
    if (samplers) genLines.push(`Sampler: ${samplers}`);
    if (meta && meta.scheduler) genLines.push(`Scheduler: ${meta.scheduler}`);
    if (cfg) genLines.push(`CFG: ${cfg}`);
    if (meta && meta.steps !== undefined && meta.steps !== null) genLines.push(`Steps: ${meta.steps}`);
    if (meta && meta.denoise !== undefined && meta.denoise !== null) genLines.push(`Denoise: ${meta.denoise}`);

    // Advanced sampler parameters
    if (meta && meta.start_at_step !== undefined && meta.start_at_step !== null) genLines.push(`Start Step: ${meta.start_at_step}`);
    if (meta && meta.end_at_step !== undefined && meta.end_at_step !== null) genLines.push(`End Step: ${meta.end_at_step}`);
    if (meta && meta.add_noise !== undefined && meta.add_noise !== null) genLines.push(`Add Noise: ${meta.add_noise}`);
    if (meta && meta.return_with_leftover_noise !== undefined && meta.return_with_leftover_noise !== null) genLines.push(`Return Leftover Noise: ${meta.return_with_leftover_noise}`);

    if (genLines.length) {
      fieldsContainer.appendChild(addColoredField("MODEL / LORA / SAMPLER", genLines.join("\n"), true, "#5fb3ff"));
    }

    if (hasAnyGen) {
      metaContent.appendChild(fieldsContainer);
    }

    const warnMessages = [];
    if (!hasAnyGen) warnMessages.push("No generation data found.");
    if (!hasWorkflow) warnMessages.push("No workflow present in this file.");
    if (warnMessages.length) {
      const warn = createEl("div", "", warnMessages.join(" "));
      warn.style.marginTop = "8px";
      warn.style.padding = "6px 8px";
      warn.style.borderRadius = "6px";
      warn.style.border = "1px solid var(--border-color, #333)";
      warn.style.background = "rgba(255,255,255,0.03)";
      warn.style.opacity = "0.85";
      metaContent.appendChild(warn);
    }
  }

  async function updateFileMetadata(file, updates, toastLabel = "Metadata updated") {
    const filename = file.filename || file.name;
    if (!filename) {
      console.error("Error updating metadata: missing filename");
      return;
    }
    const subfolder = file.subfolder || "";
    const safeUpdates = updates && typeof updates === "object" ? updates : {};

    try {
      const body = { filename, subfolder };
      if (Object.prototype.hasOwnProperty.call(safeUpdates, "rating")) {
        body.rating = Number(safeUpdates.rating) || 0;
      }
      if (Object.prototype.hasOwnProperty.call(safeUpdates, "tags")) {
        body.tags = Array.isArray(safeUpdates.tags) ? safeUpdates.tags : [];
      }

      const res = await api.fetchApi("/mjr/filemanager/metadata/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...body,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        if (data.rating !== undefined) file.rating = data.rating;
        if (data.tags !== undefined) file.tags = data.tags;
        if (!(state.metaCache instanceof Map)) state.metaCache = new Map();
        const key = metadataKey(file);
        state.metaCache.delete(key);
        if (state.metaFetchAt && typeof state.metaFetchAt.delete === "function") {
          state.metaFetchAt.delete(key);
        }
        applyFilterAndRender();
        if (state.currentFile === file) {
          try {
            loadMetadataForFile(file);
          } catch (err) {
            console.warn("[Majoor.AssetsManager] metadata panel refresh failed", err);
          }
        }
        refreshAllInstances({ silent: true, metaOnly: true });
        mjrShowToast("success", toastLabel, "Saved");
      } else {
        console.error("Error updating metadata:", data.error);
        mjrShowToast("error", data.error || "Metadata update failed", "Error");
      }
    } catch (err) {
      console.error("[Majoor.AssetsManager] metadata update failed", err);
      mjrShowToast("error", "Network error while saving metadata", "Error");
    }
  }

  function setRating(file, rating) {
    file.rating = rating;
    updateFileMetadata(file, { rating }, "Rating updated");
  }

  function setMetadataPanelVisibility(visible) {
    metaPanel.style.display = visible ? "flex" : "none";
    if (onVisibilityChange) onVisibilityChange(visible);
  }

  const showPanel = (file, meta, errorText = null) => {
    state.currentFile = file;
    state.currentMeta = meta || null;
    showMetadataPanel(file, meta, errorText);
  };

  async function loadMetadataForFile(file) {
    if (!file) return;
    const filename = file.filename || file.name;
    if (!filename) {
      showPanel(file, null, "Missing filename for metadata lookup.");
      return;
    }

    if (!(state.metaCache instanceof Map)) state.metaCache = new Map();
    if (!(state.metaFetchAt instanceof Map)) state.metaFetchAt = new Map();

    const now = Date.now();
    const key = metadataKey(file);
    const cachedEntry = key ? state.metaCache.get(key) : null;
    const cachedMeta = cachedEntry && cachedEntry.meta ? cachedEntry.meta : cachedEntry;
    const lastFetch = key ? state.metaFetchAt.get(key) : 0;
    const interval = Math.max(0, Number(mjrSettings.metaPanel.refreshInterval) || 0);
    const fallbackMeta =
      (cachedEntry &&
        cacheAllows(cachedEntry, file, cachedEntry.sourcePath, cachedEntry.sourceMtime) &&
        cachedMeta) ||
      file.meta ||
      file.metadata ||
      (state.currentMeta && state.currentFile === file && state.currentMeta) ||
      null;

    if (cachedMeta && interval > 0 && lastFetch && now - lastFetch < interval) {
      showPanel(file, cachedMeta, null);
      return;
    }

    const seq = ++metaRequestSeq;

    const params = new URLSearchParams();
    params.set("filename", filename);
    if (file.subfolder) params.set("subfolder", file.subfolder);

    showPanel(file, fallbackMeta, cachedEntry ? null : "Loading metadata...");

    try {
      const res = await api.fetchApi(`/mjr/filemanager/metadata?${params.toString()}`);
      if (seq !== metaRequestSeq) return;
      if (!res.ok) {
        let extra = "";
        try {
          const txt = await res.text();
          if (txt) extra = `: ${String(txt).slice(0, 160)}`;
        } catch (_) {}
        showPanel(file, null, `Error while loading metadata (HTTP ${res.status}${extra})`);
        return;
      }

      let data = null;
      try {
        data = await res.json();
      } catch (e) {
        showPanel(file, null, "Error while loading metadata (invalid server response).");
        return;
      }
      if (seq !== metaRequestSeq) return;
      if (data.ok && data.generation) {
        const meta = data.generation || {};
        if (meta.has_workflow === undefined) meta.has_workflow = !!meta.workflow;
        if (meta.has_workflow && file) file.hasWorkflow = true;
        if (meta.rating === undefined && file.rating !== undefined) meta.rating = file.rating;
        if (!meta.tags && file.tags) meta.tags = file.tags;
        const sourceMtime = meta.mtime ?? file.mtime;
        const payload = {
          meta,
          mtime: sourceMtime ?? file.mtime,
          sourceMtime,
          sourcePath: null,
        };
        if (key) {
          state.metaCache.set(key, payload);
          state.metaFetchAt.set(key, Date.now());
        }
        file.hasWorkflow = !!meta.has_workflow;
        showPanel(file, meta);
      } else {
        showPanel(file, null, data.error || "No metadata found for this file.");
      }
    } catch (err) {
      if (seq !== metaRequestSeq) return; // ignore stale request failures
      if (err?.name === "AbortError") return;
      console.error("[Majoor.AssetsManager] metadata error", err);
      showPanel(file, null, "Error while loading metadata (check console).");
    }
  }

  return {
    loadMetadataForFile,
    setMetadataPanelVisibility,
    showMetadataPanel: showPanel,
    updateFileMetadata,
    setRating,
  };
}
