import {
  applyStyles,
  BADGE_STYLES,
  buildViewUrl,
  createEl,
  detectKindFromExt,
  getBaseName,
  getExt,
  mjrSettings,
} from "./ui_settings.js";

function formatCardHoverTitle(file) {
  const rawName = file?.name || file?.filename || "(unnamed)";
  const ext = String(file?.ext || getExt(rawName) || "").toUpperCase();
  const kind = file?.kind || detectKindFromExt(ext);
  const subfolder = file?.subfolder ? String(file.subfolder) : "(root)";
  const sizeReadable = file?.size_readable ? String(file.size_readable) : null;
  const sizeBytes = Number.isFinite(file?.size) ? `${file.size} B` : null;
  const size = sizeReadable || sizeBytes || null;
  const date = file?.date ? String(file.date) : null;

  const rating = Math.max(0, Math.min(5, Number(file?.rating ?? (file?.meta && file.meta.rating) ?? 0) || 0));
  const tags =
    (Array.isArray(file?.tags) && file.tags) ||
    (Array.isArray(file?.meta && file.meta.tags) && file.meta.tags) ||
    [];

  const wfState = resolveWorkflowState(file);

  const lines = [];
  lines.push(rawName);
  lines.push(`Folder: ${subfolder}`);
  lines.push(`Type: ${kind}${ext ? ` (${ext})` : ""}`);
  if (date) lines.push(`Date: ${date}`);
  if (size) lines.push(`Size: ${size}`);
  lines.push(`Rating: ${rating}/5`);
  if (tags.length) {
    const maxTags = 20;
    const shown = tags.slice(0, maxTags).map((t) => String(t)).join(", ");
    const more = tags.length > maxTags ? ` (+${tags.length - maxTags} more)` : "";
    lines.push(`Tags: ${shown}${more}`);
  } else {
    lines.push("Tags: (none)");
  }
  lines.push(`Workflow: ${wfState}`);
  return lines.join("\n");
}

export function resolveWorkflowState(file) {
  const toState = (val) => {
    if (val === true || val === 1 || val === "true") return "yes";
    if (val === false || val === 0 || val === "false") return "no";
    return null;
  };

  const candidates = [
    file?.hasWorkflow,
    file?.has_workflow,
    file?.workflow ? true : null,
    file?.meta?.has_workflow,
    file?.meta?.workflow ? true : null,
  ];

  for (const c of candidates) {
    const s = toState(c);
    if (s) return s;
  }
  return "unknown";
}

export function handleDragStart(file, ev) {
  if (!ev?.dataTransfer) return;
  const filename = file.filename || file.name;
  if (!filename) return;

  const extGuess = file.ext || getExt(filename) || "";
  const kind = file.kind || detectKindFromExt(extGuess);
  const rawUrl = file.url || buildViewUrl(file);
  const url = new URL(rawUrl, window.location.href).href;

  const extLower = String(extGuess).toLowerCase().replace(/^\./, "");
  const mime =
    extLower === "mp4"
      ? "video/mp4"
      : extLower === "mp3"
      ? "audio/mpeg"
      : "application/octet-stream";

  ev.dataTransfer.effectAllowed = "copy";
  ev.dataTransfer.setData("text/uri-list", url);
  ev.dataTransfer.setData("DownloadURL", `${mime}:${filename}:${url}`);

  if (kind === "video") {
    ev.dataTransfer.setData(
      "application/x-mjr-asset",
      JSON.stringify({ filename, subfolder: file.subfolder || "", kind: "video" })
    );
  }
}

export function updateWorkflowDot(card, workflowState) {
  const host = card.querySelector(".mjr-fm-thumb") || card;
  const existingDots = Array.from(card.querySelectorAll(".mjr-fm-workflow-dot"));
  let dot = existingDots.shift() || null;
  // Remove extras
  existingDots.forEach((d) => d.remove());
  // If the kept dot is not under the host, discard it and recreate
  if (dot && dot.parentElement !== host) {
    dot.remove();
    dot = null;
  }

  if (!dot) {
    dot = document.createElement("div");
    dot.className = "mjr-fm-workflow-dot";
    dot.style.position = "absolute";
    dot.style.bottom = "6px";
    dot.style.right = "6px";
    dot.style.width = "10px";
    dot.style.height = "10px";
    dot.style.borderRadius = "50%";
    dot.style.border = "1px solid rgba(0,0,0,0.6)";
    dot.style.pointerEvents = "none";
    // Ensure the card anchors the dot at bottom-right of the card
    if (!card.style.position) card.style.position = "relative";
    card.appendChild(dot);
  }

  const state =
    workflowState === "yes" || workflowState === true
      ? "yes"
      : workflowState === "no" || workflowState === false
      ? "no"
      : "unknown";

  if (state === "yes") {
    dot.style.background = "#65d174";
    dot.style.boxShadow = "0 0 6px rgba(101,209,116,0.9)";
    dot.style.opacity = "1";
  } else if (state === "no") {
    dot.style.background = "#d45a5a";
    dot.style.boxShadow = "0 0 6px rgba(212,90,90,0.8)";
    dot.style.opacity = "0.85";
  } else {
    dot.style.background = "#aaaaaa";
    dot.style.boxShadow = "0 0 6px rgba(170,170,170,0.6)";
    dot.style.opacity = "0.6";
  }
}

export function updateCardVisuals(card, file) {
  const rating = Number(file.rating ?? (file.meta && file.meta.rating) ?? 0);
  const tags =
    (Array.isArray(file.tags) && file.tags) ||
    (Array.isArray(file.meta && file.meta.tags) && file.meta.tags) ||
    [];

  if (mjrSettings.grid.hoverInfo) {
    try {
      card.title = formatCardHoverTitle(file);
    } catch (_) {
      card.title = "";
    }
  } else {
    card.title = "";
  }

  const wfState = resolveWorkflowState(file);
  updateWorkflowDot(card, wfState);

  const applyStars = (badge, r) => {
    badge.textContent = "";
    const val = Math.max(0, Math.min(5, Number(r) || 0));
    for (let i = 1; i <= 5; i++) {
      const span = document.createElement("span");
      const filled = i <= val;
      span.textContent = "★";
      span.style.color = filled ? "#ffd45a" : "#777";
      span.style.marginRight = i < 5 ? "2px" : "0";
      badge.appendChild(span);
    }
    badge.dataset.mjrRating = String(val);
  };

  let ratingBadge = card.querySelector(".mjr-fm-rating-badge");

  if (mjrSettings.grid.showRating && rating > 0) {
    if (!ratingBadge) {
      ratingBadge = createEl("div", "mjr-fm-rating-badge");
      applyStyles(ratingBadge, BADGE_STYLES.rating);
      ratingBadge.style.filter = "drop-shadow(0 0 2px rgba(255, 212, 90, 0.7))";
      ratingBadge.style.fontSize = "10px";
      ratingBadge.style.padding = "4px 6px";
      ratingBadge.style.letterSpacing = "1px";
      ratingBadge.style.display = "inline-flex";
      ratingBadge.style.alignItems = "center";
      ratingBadge.style.justifyContent = "center";
      ratingBadge.style.textAlign = "center";
      applyStars(ratingBadge, rating);
      card.appendChild(ratingBadge);
    } else if (ratingBadge.dataset.mjrRating !== String(rating)) {
      applyStars(ratingBadge, rating);
    }
  } else if (ratingBadge) {
    ratingBadge.remove();
  }

  const newTagsText = mjrSettings.grid.showTags && tags.length > 0 ? tags.join(", ") : "";
  let tagsBadge = card.querySelector(".mjr-fm-tags-badge");

  if (newTagsText) {
    if (!tagsBadge) {
      tagsBadge = createEl("div", "mjr-fm-tags-badge");
      applyStyles(tagsBadge, BADGE_STYLES.tags);
      tagsBadge.style.fontSize = "0.65rem";
      tagsBadge.textContent = newTagsText;
      card.appendChild(tagsBadge);
    } else if (tagsBadge.textContent !== newTagsText) {
      tagsBadge.textContent = newTagsText;
    }
  } else if (tagsBadge) {
    tagsBadge.remove();
  }
}

export function renderBadges(card, rating, tags) {
  if (mjrSettings.grid.showRating && rating > 0) {
    const ratingBadge = createEl("div", "mjr-fm-rating-badge");
    applyStyles(ratingBadge, BADGE_STYLES.rating);
    ratingBadge.style.filter = "drop-shadow(0 0 2px rgba(255, 212, 90, 0.7))";
    ratingBadge.style.fontSize = "10px";
    ratingBadge.style.padding = "4px 6px";
    ratingBadge.style.letterSpacing = "1px";
    ratingBadge.style.display = "inline-flex";
    ratingBadge.style.alignItems = "center";
    ratingBadge.style.justifyContent = "center";
    ratingBadge.style.textAlign = "center";
    ratingBadge.dataset.mjrRating = String(rating);
    for (let i = 1; i <= 5; i++) {
      const span = document.createElement("span");
      const filled = i <= rating;
      span.textContent = "★";
      span.style.color = filled ? "#ffd45a" : "#777";
      span.style.marginRight = i < 5 ? "2px" : "0";
      ratingBadge.appendChild(span);
    }
    card.appendChild(ratingBadge);
  }

  if (mjrSettings.grid.showTags && tags && tags.length > 0) {
    const tagsBadge = createEl("div", "mjr-fm-tags-badge", tags.join(", "));
    applyStyles(tagsBadge, BADGE_STYLES.tags);
    tagsBadge.style.fontSize = "0.65rem";
    card.appendChild(tagsBadge);
  }
}

export function createFileThumb(kind, ext, file, card) {
  const thumb = createEl("div", "mjr-fm-thumb");
  thumb.style.position = "relative";
  thumb.style.aspectRatio = "1 / 1";
  thumb.style.overflow = "hidden";
  thumb.style.background = "#111";
  thumb.__mjrHoverTimer = null;

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

  // Clear any previous cleanup function
  if (card.__cleanupVideoListeners) {
    card.__cleanupVideoListeners();
    card.__cleanupVideoListeners = null;
  }

  const attachVideoPreview = () => {
    if (thumb.__mjrVideoPreviewAttached) return;
    thumb.__mjrVideoPreviewAttached = true;
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

    const onMouseEnter = () => {
      if (thumb.__mjrHoverTimer) clearTimeout(thumb.__mjrHoverTimer);
      thumb.__mjrHoverTimer = setTimeout(() => {
        if (mjrSettings.viewer.autoplayVideos) {
          video.play().catch(() => {});
        }
      }, 200);
    };
    const onMouseLeave = () => {
      if (thumb.__mjrHoverTimer) {
        clearTimeout(thumb.__mjrHoverTimer);
        thumb.__mjrHoverTimer = null;
      }
      video.pause();
      try {
        video.currentTime = 0;
      } catch (_) {}
    };

    card.addEventListener("mouseenter", onMouseEnter);
    card.addEventListener("mouseleave", onMouseLeave);

    card.__cleanupVideoListeners = () => {
      card.removeEventListener("mouseenter", onMouseEnter);
      card.removeEventListener("mouseleave", onMouseLeave);
      if (thumb.__mjrHoverTimer) {
        clearTimeout(thumb.__mjrHoverTimer);
        thumb.__mjrHoverTimer = null;
      }
    };
  };

  if (kind === "image") {
    const img = document.createElement("img");
    img.loading = "lazy";
    img.src = file.url || buildViewUrl(file);
    img.style.width = "100%";
    img.style.height = "100%";
    img.style.objectFit = "cover";
    thumb.appendChild(img);
  } else if (kind === "video") {
    // No server-side thumbs: use inline video preview with hover debounce
    attachVideoPreview();

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
    audioBg.style.background = "linear-gradient(135deg, #1b2735 0%, #090a0f 100%)";

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
    modelBg.style.background = "radial-gradient(circle at 20% 20%, #3b82f6, #0f172a)";

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

export function updateCardSelectionStyle(card, selected) {
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
