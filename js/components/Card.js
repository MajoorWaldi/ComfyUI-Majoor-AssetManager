/**
 * Asset Card Component
 */

import { buildAssetViewURL } from "../api/endpoints.js";
import { createFileBadge, createRatingBadge, createTagsBadge, createWorkflowDot } from "./Badges.js";
import { formatTimestamp, formatDuration, formatDate, formatTime } from "../utils/format.js";

const VIDEO_THUMBS_KEY = "__MJR_VIDEO_THUMBS__";
const VIDEO_THUMB_MAX_AUTOPLAY = 6;
const VIDEO_THUMB_MAX_PREPARED = 48;
const VIDEO_THUMB_LOAD_TIMEOUT_MS = 5000;
const VIDEO_THUMB_FIRST_FRAME_SEEK_S = 0.05;

export function cleanupVideoThumbsIn(rootEl) {
    try {
        const mgr = getVideoThumbManager();
        const vids = rootEl?.querySelectorAll?.("video.mjr-thumb-media") || [];
        for (const v of vids) {
            try {
                mgr?.unobserve?.(v);
            } catch {}
        }
    } catch {}
}

const getVideoThumbManager = () => {
    try {
        if (window?.[VIDEO_THUMBS_KEY]) return window[VIDEO_THUMBS_KEY];
    } catch {}

    const playing = new Set();
    const prepared = new Set();

    const pruneSets = () => {
        try {
            for (const v of Array.from(playing)) {
                try {
                    if (!v || !v.isConnected) playing.delete(v);
                } catch {}
            }
        } catch {}
        try {
            for (const v of Array.from(prepared)) {
                try {
                    if (!v || !v.isConnected) prepared.delete(v);
                } catch {}
            }
        } catch {}
        try {
            while (prepared.size > VIDEO_THUMB_MAX_PREPARED) {
                const oldest = prepared.values().next().value;
                prepared.delete(oldest);
                try {
                    oldest?.pause?.();
                } catch {}
                try {
                    if (oldest?.getAttribute?.("src")) {
                        oldest.removeAttribute("src");
                        oldest.load?.();
                    }
                } catch {}
            }
        } catch {}
    };

    const waitForLoadedData = (video, timeoutMs = VIDEO_THUMB_LOAD_TIMEOUT_MS) =>
        new Promise((resolve) => {
            if (!video) return resolve(false);
            try {
                if (video.readyState >= 2) return resolve(true);
            } catch {}

            let done = false;
            const finish = (ok) => {
                if (done) return;
                done = true;
                try {
                    video.removeEventListener("loadeddata", onLoaded);
                    video.removeEventListener("loadedmetadata", onMetadata);
                    video.removeEventListener("error", onError);
                } catch {}
                resolve(ok);
            };
            const onLoaded = () => finish(true);
            const onMetadata = () => finish(true);
            const onError = () => finish(false);

            try {
                video.addEventListener("loadeddata", onLoaded, { once: true });
                video.addEventListener("loadedmetadata", onMetadata, { once: true });
                video.addEventListener("error", onError, { once: true });
            } catch {
                return resolve(false);
            }

            try {
                setTimeout(() => finish(false), timeoutMs);
            } catch {}
        });

    const ensureFirstFrame = async (video) => {
        if (!video) return;
        try {
            if (video.readyState < 2) return;
        } catch {}
        try {
            // Nudge off 0 to force frame decode on some mp4s.
            video.currentTime = VIDEO_THUMB_FIRST_FRAME_SEEK_S;
        } catch {}
        try {
            video.pause();
        } catch {}
    };

    const stopVideo = (video) => {
        if (!video) return;
        try {
            video.pause();
        } catch {}
        try {
            video.currentTime = 0;
        } catch {}
        try {
            if (video.getAttribute("src")) {
                video.removeAttribute("src");
                video.load();
            }
        } catch {}
        prepared.delete(video);
        try {
            playing.delete(video);
        } catch {}
    };

    const ensurePrepared = async (video) => {
        if (!video) return false;
        const src = video.dataset.src || "";
        if (!src) return false;

        if (!prepared.has(video)) {
            prepared.add(video);
            pruneSets();
            try {
                if (!video.getAttribute("src")) {
                    video.src = src;
                    video.load();
                }
                video.preload = "metadata";
            } catch {}
        }

        const ok = await waitForLoadedData(video);
        if (ok) await ensureFirstFrame(video);
        return ok;
    };

    const playVideo = async (video) => {
        if (!video) return;
        const src = video.dataset.src || "";
        if (!src) return;

        if (!playing.has(video)) {
            playing.add(video);
            while (playing.size > VIDEO_THUMB_MAX_AUTOPLAY) {
                const oldest = playing.values().next().value;
                playing.delete(oldest);
                stopVideo(oldest);
            }
        } else {
            playing.delete(video);
            playing.add(video);
        }

        await ensurePrepared(video);

        try {
            const p = video.play();
            if (p && typeof p.then === "function") {
                p.catch(async () => {
                    await ensurePrepared(video);
                });
            }
        } catch {
            await ensurePrepared(video);
        }
    };

    const pauseVideo = async (video) => {
        if (!video) return;
        playing.delete(video);
        try {
            video.pause();
        } catch {}
        // Keep a decoded frame visible (prevents "grey tiles" after hover ends).
        await ensurePrepared(video);
    };

    const onVisibility = () => {
        if (!document.hidden) return;
        for (const v of Array.from(playing)) {
            playing.delete(v);
            stopVideo(v);
            try {
                const overlay = v._mjrPlayOverlay || null;
                if (overlay) overlay.style.opacity = "1";
            } catch {}
        }
    };
    try {
        document.addEventListener("visibilitychange", onVisibility);
    } catch {}

    const observer =
        typeof IntersectionObserver !== "undefined"
            ? new IntersectionObserver(
                  (entries) => {
                      for (const entry of entries) {
                          const video = entry.target;
                          if (!(video instanceof HTMLVideoElement)) continue;
                          const overlay = video._mjrPlayOverlay || null;

                          if (!video.isConnected || document.hidden) {
                              playing.delete(video);
                              stopVideo(video);
                              try {
                                  observer?.unobserve?.(video);
                              } catch {}
                              if (overlay) overlay.style.opacity = "1";
                              continue;
                          }

                          if (entry.isIntersecting && entry.intersectionRatio >= 0.2) {
                              // Prepare first frame when visible; play only on hover/explicit request.
                              ensurePrepared(video);
                              if (overlay) overlay.style.opacity = "1";
                          } else {
                              playing.delete(video);
                              stopVideo(video);
                              if (overlay) overlay.style.opacity = "1";
                          }
                      }
                  },
                  { threshold: [0, 0.2, 0.6] }
              )
            : null;

    const api = {
        _bindVideo(video) {
            if (!video) return;
            try {
                if (video._mjrThumbBound) return;
                video._mjrThumbBound = true;
            } catch {}

            try {
                video.addEventListener("error", () => {
                    playing.delete(video);
                    stopVideo(video);
                    try {
                        const overlay = video._mjrPlayOverlay || null;
                        if (overlay) overlay.style.opacity = "1";
                    } catch {}
                });
            } catch {}
        },
        observe(video) {
            if (!observer || !video) return;
            try {
                api._bindVideo(video);
                observer.observe(video);
            } catch {}
        },
        unobserve(video) {
            if (!observer || !video) return;
            try {
                observer.unobserve(video);
            } catch {}
            playing.delete(video);
            stopVideo(video);
        },
        bindHover(thumb, video) {
            if (!thumb || !video) return;
            try {
                if (thumb._mjrHoverBound) return;
                thumb._mjrHoverBound = true;
            } catch {}

            const showOverlay = (opacity) => {
                try {
                    const overlay = video._mjrPlayOverlay || null;
                    if (overlay) overlay.style.opacity = opacity;
                } catch {}
            };

            const onEnter = () => {
                showOverlay("0");
                playVideo(video);
            };
            const onLeave = () => {
                showOverlay("1");
                pauseVideo(video);
            };

            try {
                thumb.addEventListener("mouseenter", onEnter);
                thumb.addEventListener("mouseleave", onLeave);
                thumb.addEventListener("focusin", onEnter);
                thumb.addEventListener("focusout", onLeave);
            } catch {}
        }
    };

    try {
        window[VIDEO_THUMBS_KEY] = api;
    } catch {}
    return api;
};

/**
 * Create asset card element
 */
export function createAssetCard(asset) {
    const card = document.createElement("div");
    card.className = "mjr-asset-card";
    card.classList.add("mjr-card");
    // Enable dragging (handled via delegated dragstart handler on the grid container).
    card.draggable = true;
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Asset ${asset?.filename || ""}`);
    card.setAttribute("aria-selected", "false");
    if (asset?.id != null) {
        try {
            card.dataset.mjrAssetId = String(asset.id);
        } catch {}
    }

    // Helpful datasets for cross-card behaviors (selection, siblings hide, name collisions).
    let displayName = asset?.filename || "";
    try {
        const filename = String(asset?.filename || "");
        const ext = (filename.split(".").pop() || "").toUpperCase();
        const stem = filename.includes(".") ? filename.slice(0, filename.lastIndexOf(".")) : filename;
        card.dataset.mjrFilenameKey = filename.trim().toLowerCase();
        card.dataset.mjrExt = ext;
        card.dataset.mjrStem = String(stem || "").trim().toLowerCase();
        
        displayName = stem;
    } catch {}

    const viewUrl = buildAssetViewURL(asset);

    // Thumbnail
    const thumb = createThumbnail(asset, viewUrl);

    // Add file type badge (top left)
    const fileBadge = createFileBadge(asset.filename, asset.kind, !!asset?._mjrNameCollision);
    thumb.appendChild(fileBadge);

    // Add rating badge (top right)
    const ratingBadge = createRatingBadge(asset.rating || 0);
    if (ratingBadge) thumb.appendChild(ratingBadge);

    // Add tags badge (bottom left)
    const tagsBadge = createTagsBadge(asset.tags || []);
    thumb.appendChild(tagsBadge);

    // Store asset reference for sidebar
    card._mjrAsset = asset;

    // Info section
    const info = document.createElement("div");
    info.classList.add("mjr-card-meta");

    const filenameDiv = document.createElement("div");
    filenameDiv.classList.add("mjr-card-filename");
    filenameDiv.title = asset.filename;

    const filenameText = document.createElement("span");
    filenameText.textContent = displayName;
    filenameText.classList.add("mjr-card-filename-text");

    filenameDiv.appendChild(filenameText);

    // Add workflow status dot
    const workflowDot = createWorkflowDot(asset);
    filenameDiv.appendChild(workflowDot);

    info.appendChild(filenameDiv);

    // Add metadata/stats row
    const metaRow = document.createElement("div");
    metaRow.classList.add("mjr-card-details");
    
    // Size / Duration
    const statsSpan = document.createElement("span");
    const parts = [];
    const addPart = (text, className) => {
        const span = document.createElement("span");
        span.textContent = text;
        if (className) span.className = className;
        statsSpan.appendChild(span);
        
        // Add separator if not last (handled by flex gap or pseudo-element in CSS ideally, but here we append text nodes for now)
        // Actually, let's use a flex container for `statsSpan` or just append a separator node.
        // The previous code used parts.join(" • "). Let's replicate that structure but with elements.
    };

    // We will clear statsSpan content first (it's empty by new formatting) but we won't use parts.join anymore.
    // We want styles: Resolution (blue?), Time (green?), Duration (orange?)
    
    const items = [];

    // Resolution / Duration (Video Length)
    if (asset.duration) {
        items.push({ text: `(${formatDuration(asset.duration)})`, class: "mjr-meta-duration" }); // Format: (19s)
    } 
    if (asset.width && asset.height) {
         items.push({ text: `${asset.width}x${asset.height}`, class: "mjr-meta-res" });
    }
    
    // Time
    // Priority: Generation Time (Content) > File Creation (FS) > Modification (FS Mtime) > DB indexed time
    const timestamp = asset.generation_time || asset.file_creation_time || asset.mtime || asset.created_at;
    if (timestamp) {
        // Clear color separation for date and hour
        items.push({ text: formatDate(timestamp), class: "mjr-meta-date" });
        items.push({ text: formatTime(timestamp), class: "mjr-meta-time" });
    }

    items.forEach((item, idx) => {
        const span = document.createElement("span");
        span.textContent = item.text;
        if (item.class) span.classList.add(item.class);
        statsSpan.appendChild(span);
        
        if (idx < items.length - 1) {
            const sep = document.createTextNode(" • ");
            statsSpan.appendChild(sep);
        }
    });
    
    metaRow.appendChild(statsSpan);
    
    info.appendChild(metaRow);

    card.appendChild(thumb);
    card.appendChild(info);

    // Store view URL (click handled by panel event delegation)
    card.dataset.mjrViewUrl = viewUrl;

    return card;
}

/**
 * Create thumbnail for asset
 */
function createThumbnail(asset, viewUrl) {
    const thumb = document.createElement("div");
    thumb.classList.add("mjr-thumb");

    if (asset.kind === "image") {
        const img = document.createElement("img");
        img.src = viewUrl;
        img.classList.add("mjr-thumb-media");
        try {
            img.loading = "lazy";
            img.decoding = "async";
        } catch {}
        thumb.appendChild(img);
    } else if (asset.kind === "video") {
        // Create video element lazily to avoid eager network/decoder cost on large grids
        const video = document.createElement("video");
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.preload = "metadata";
        video.classList.add("mjr-thumb-media");
        video.dataset.src = viewUrl;
        video.controls = false;
        // Avoid capturing clicks (selection is handled at card level); hover is bound on the thumb wrapper.
        video.tabIndex = -1;
        video.style.pointerEvents = "none";
        try {
            video.disablePictureInPicture = true;
        } catch {}

        // Play icon overlay
        const playIcon = document.createElement("div");
        playIcon.textContent = "▶";
        playIcon.classList.add("mjr-thumb-play");

        // Replace the placeholder glyph and autoplay when visible.
        playIcon.textContent = "";
        const playIconEl = document.createElement("i");
        playIconEl.className = "pi pi-play";
        playIcon.appendChild(playIconEl);
        try {
            video._mjrPlayOverlay = playIcon;
        } catch {}
        thumb.appendChild(video);
        thumb.appendChild(playIcon);
        // Observe after insertion for reliable IntersectionObserver behavior.
        const mgr = getVideoThumbManager();
        mgr.observe(video);
        mgr.bindHover(thumb, video);
    }

    return thumb;
}
