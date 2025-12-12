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

export function updateCardVisuals(card, file) {
  const rating = Number(file.rating ?? (file.meta && file.meta.rating) ?? 0);
  const tags =
    (Array.isArray(file.tags) && file.tags) ||
    (Array.isArray(file.meta && file.meta.tags) && file.meta.tags) ||
    [];

  const newRatingText = rating > 0 ? "★".repeat(rating) : "";
  let ratingBadge = card.querySelector(".mjr-fm-rating-badge");

  if (mjrSettings.grid.showRating && rating > 0) {
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

export function renderBadges(card, rating, tags) {
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

export function handleDragStart(file, ev) {
  const kind = file.kind || detectKindFromExt(file.ext || getExt(file.filename || file.name));
  const isSiblingTarget =
    kind === "video" || kind === "audio" || kind === "model3d" || kind === "3d" || kind === "other3d";
  if (!isSiblingTarget) return;

  ev.dataTransfer.effectAllowed = "copy";
  ev.dataTransfer.setData(
    "application/x-mjr-sibling-file",
    JSON.stringify({ filename: file.filename || file.name, subfolder: file.subfolder || "" })
  );
}

export function createFileThumb(kind, ext, file, card) {
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

  // Clear any previous cleanup function
  if (card.__cleanupVideoListeners) {
    card.__cleanupVideoListeners();
    card.__cleanupVideoListeners = null;
  }

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

    const onMouseEnter = () => {
      if (mjrSettings.viewer.autoplayVideos) {
        video.play().catch(() => {});
      }
    };
    const onMouseLeave = () => {
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
    };

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
