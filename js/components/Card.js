/**
 * Asset Card Component
 * @ts-check
 */

import { buildAssetViewURL } from "../api/endpoints.js";
import { createFileBadge, createRatingBadge, createTagsBadge, createWorkflowDot } from "./Badges.js";
import { formatTimestamp, formatDuration, formatDate, formatTime, formatDateTime } from "../utils/format.js";
import { APP_CONFIG } from "../app/config.js";

/**
 * @typedef {Object} Asset
 * @property {number|string} id
 * @property {string} filename
 * @property {string} filepath
 * @property {string} [ext]
 * @property {string} [kind]
 * @property {number} [rating] - 0 to 5
 * @property {Array<string>|string|null} [tags] - Array of strings or JSON string
 * @property {boolean|null} [has_workflow]
 * @property {boolean|null} [has_generation_data]
 * @property {boolean} [has_unknown_nodes]
 * @property {number} [width]
 * @property {number} [height]
 * @property {number} [duration]
 * @property {number} [size]
 * @property {number} [mtime]
 * @property {boolean} [_mjrNameCollision] - Internal flag for visual collision warning
 */

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

export function cleanupCardMediaHandlers(rootEl) {
    try {
        if (!rootEl) return;
        const imgs = rootEl?.querySelectorAll?.("img.mjr-thumb-media") || [];
        for (const img of imgs) {
            try {
                img.onerror = null;
                img.onload = null;
            } catch {}
        }
        const vids = rootEl?.querySelectorAll?.("video.mjr-thumb-media") || [];
        for (const video of vids) {
            try {
                video.onerror = null;
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
    let cleanupTimer = null;
    let removeVisibilityListener = null;

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
        try {
            const overlay = video._mjrPlayOverlay || null;
            if (overlay) overlay.style.opacity = "1";
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
                // Demote to prepared (paused with frame kept)
                pauseVideo(oldest);
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
        removeVisibilityListener = () => {
            try {
                document.removeEventListener("visibilitychange", onVisibility);
            } catch {}
            removeVisibilityListener = null;
        };
        // Periodic cleanup for videos detached from DOM (memory leak prevention)
        cleanupTimer = setInterval(() => {
            // 1. Prune sets
            pruneSets();

            // 2. Extra safety: Check if playing videos are still in DOM
            // If Card was removed by virtual scroll but pause() didn't fire, we catch it here.
            const checkSet = (set, isPlaying) => {
                for (const v of Array.from(set)) {
                    if (!v || !v.isConnected) {
                        set.delete(v);
                        if (isPlaying) stopVideo(v);
                        else {
                            // Just unbind
                            try { observer?.unobserve?.(v); } catch {}
                        }
                    }
                }
            };
            checkSet(playing, true);
            checkSet(prepared, false);
        }, 10_000);
    } catch (e) {
        console.debug("[Majoor] Video cleanup error:", e);
    }

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
                              // Auto play when visible
                              playVideo(video);
                              if (overlay) overlay.style.opacity = "0";
                          } else {
                              // Use pauseVideo to keep the frame ("prepared") until pruneSets evicts it.
                              pauseVideo(video);
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
            
            // Cleanup hover listeners on parent thumb
            try {
                const thumb = video.parentElement;
                if (thumb && thumb._mjrHoverCleanup) {
                     thumb._mjrHoverCleanup();
                }
            } catch {}
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
                
                thumb._mjrHoverCleanup = () => {
                    thumb.removeEventListener("mouseenter", onEnter);
                    thumb.removeEventListener("mouseleave", onLeave);
                    thumb.removeEventListener("focusin", onEnter);
                    thumb.removeEventListener("focusout", onLeave);
                    thumb._mjrHoverBound = false;
                    thumb._mjrHoverCleanup = null;
                };
            } catch {}
        },
        dispose() {
            try {
                if (cleanupTimer) clearInterval(cleanupTimer);
            } catch {}
            cleanupTimer = null;
            try {
                removeVisibilityListener?.();
            } catch {}
            try {
                playing.clear();
                prepared.clear();
            } catch {}
        }
    };

    try {
        window.addEventListener?.("pagehide", () => api.dispose());
        window[VIDEO_THUMBS_KEY] = api;
    } catch {}
    return api;
};

/**
 * Create asset card element
 * @param {Asset} asset
 * @returns {HTMLDivElement}
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

    // --- Badges (Always created, visibility controlled via parent CSS) ---
    const fileBadge = createFileBadge(asset.filename, asset.kind, !!asset?._mjrNameCollision);
    fileBadge.classList.add("mjr-badge-ext"); // Class helper
    thumb.appendChild(fileBadge);

    const ratingBadge = createRatingBadge(asset.rating || 0);
    if (ratingBadge) {
        ratingBadge.classList.add("mjr-badge-rating");
        thumb.appendChild(ratingBadge);
    }

    const tagsBadge = createTagsBadge(asset.tags || []);
    if (tagsBadge) {
        tagsBadge.classList.add("mjr-badge-tags");
        thumb.appendChild(tagsBadge);
    }

    // Store asset reference for sidebar
    card._mjrAsset = asset;
    
    card.appendChild(thumb);

    // --- Info Section (Standard Block) ---
    // We always create the info section structure. 
    // Visibility of children is toggled via CSS classes on the grid container (.mjr-show-filename etc).
    
    const info = document.createElement("div");
    info.classList.add("mjr-card-info");
    info.classList.add("mjr-card-meta"); // Keep old class for any legacy CSS
    // Reset to standard block flow with relative positioning for absolute child (dot)
    info.style.cssText = "position: relative; padding: 6px 8px; min-width: 0;";

    // 1. Filename Row
    const filenameDiv = document.createElement("div");
    filenameDiv.classList.add("mjr-card-filename"); // Helper for settings toggling
    filenameDiv.title = asset.filename;
    filenameDiv.textContent = displayName;
    filenameDiv.style.cssText = "overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-bottom: 4px; padding-right: 12px;";
    
    info.appendChild(filenameDiv);

    // 2. Metadata Row
    const metaRow = document.createElement("div");
    metaRow.classList.add("mjr-card-meta-row");
    // Standard block with inline items
    // Padding right to prevent text overlap with the absolute dot
    metaRow.style.cssText = "font-size: 0.85em; opacity: 0.7; line-height: 1.4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: 16px;";
    
    // Resolution
    if (asset.width && asset.height) {
        const resSpan = document.createElement("span");
        resSpan.classList.add("mjr-meta-res"); // Toggled via .mjr-show-dimensions
        resSpan.textContent = `${asset.width}x${asset.height}`;
        resSpan.title = `Resolution: ${asset.width} × ${asset.height} pixels`;
        metaRow.appendChild(resSpan);
    }

    // Duration
    if (asset.duration) {
        const durSpan = document.createElement("span");
        durSpan.classList.add("mjr-meta-duration"); // Toggled via .mjr-show-dimensions
        durSpan.textContent = formatDuration(asset.duration);
        durSpan.title = `Duration: ${formatDuration(asset.duration)}`;
        metaRow.appendChild(durSpan);
    }
    
    // Date/Time
    const timestamp = asset.generation_time || asset.file_creation_time || asset.mtime || asset.created_at;
    if (timestamp) {
        // Date
        const dateStr = formatDate(timestamp);
        if (dateStr) {
            const dateSpan = document.createElement("span");
            dateSpan.classList.add("mjr-meta-date"); // Toggled via .mjr-show-date
            dateSpan.textContent = dateStr;
            dateSpan.title = `Date: ${dateStr}`;
            metaRow.appendChild(dateSpan);
        }
        
        // Time
        const timeStr = formatTime(timestamp);
        if (timeStr) {
             const timeSpan = document.createElement("span");
             timeSpan.classList.add("mjr-meta-date"); // Reuse date toggle for now logic-wise
             timeSpan.classList.add("mjr-meta-time-val"); 
             timeSpan.textContent = timeStr;
             timeSpan.title = `Time: ${timeStr}`;
             metaRow.appendChild(timeSpan);
        }
    }

    // Generation Time (EXPERIMENTAL)
    // Uses 'generation_time_ms' from entry.js (workflow execution duration in milliseconds)
    // NOTE: Do NOT use 'generation_time' (EXIF date string) for this - that's a different field!
    const rawGenTime = asset.generation_time_ms ?? asset.metadata?.generation_time_ms ?? 0;
    const genTimeMs = Number.isFinite(Number(rawGenTime)) && Number(rawGenTime) > 0 ? Number(rawGenTime) : 0;
    
    // Only show if we have a valid duration in milliseconds (not a date string)
    // Sanity check: generation time should be < 24 hours (86400000 ms) to avoid confusing with timestamps
    if (genTimeMs > 0 && genTimeMs < 86400000) {
        const genTimeSpan = document.createElement("span");
        genTimeSpan.classList.add("mjr-meta-gentime");
        
        // Color based on generation time (green = fast, yellow = medium, orange = slow)
        const secs = genTimeMs / 1000;
        let color = "#4CAF50"; // Green for < 10s
        if (secs >= 60) color = "#FF9800"; // Orange for >= 60s
        else if (secs >= 30) color = "#FFC107"; // Yellow for >= 30s
        else if (secs >= 10) color = "#8BC34A"; // Light green for >= 10s
        
        genTimeSpan.style.color = color;
        genTimeSpan.style.fontWeight = "500";
        
        const secsDisplay = secs.toFixed(1);
        genTimeSpan.textContent = `${secsDisplay}s`;
        genTimeSpan.title = `Generation time: ${secsDisplay} seconds`;
        
        metaRow.appendChild(genTimeSpan);
    }

    // Workflow Dot (Absolute Positioned for stable right-alignment)
    const workflowDot = createWorkflowDot(asset);
    if (workflowDot) {
        const dotWrapper = document.createElement("div");
        dotWrapper.className = "mjr-card-dot-wrapper";
        // Absolute bottom-right corner of the info box
        // Matches padding (6px bottom, 8px right)
        dotWrapper.style.cssText = "position: absolute; right: 8px; bottom: 6px; z-index: 2;";
        
        dotWrapper.appendChild(workflowDot);
        
        // Append to info container (parent), NOT inside the scrolling metaRow
        info.appendChild(dotWrapper);
    }

    info.appendChild(metaRow);
    card.appendChild(info);

    // Store view URL (click handled by panel event delegation)
    card.dataset.mjrViewUrl = viewUrl;

    return card;
}

/**
 * Create thumbnail for asset
 */
/**
 * @param {Asset} asset 
 * @param {string} viewUrl 
 * @returns {HTMLDivElement}
 */
function createThumbnail(asset, viewUrl) {
    const thumb = document.createElement("div");
    thumb.classList.add("mjr-thumb");

    if (asset.kind === "image") {
        const img = document.createElement("img");
        img.src = viewUrl;
        img.alt = asset.filename || "Asset Image";
        img.classList.add("mjr-thumb-media");
        try {
            img.loading = "lazy";
            img.decoding = "async";
        } catch {}
        
        // Critical: Handle broken images
        img.onerror = () => {
             img.style.display = "none";
             const err = document.createElement("div");
             err.className = "mjr-thumb-error";
             err.innerHTML = '<i class="pi pi-image" style="font-size:24px; opacity:0.5;"></i>';
             err.style.cssText = "display:flex; align-items:center; justify-content:center; width:100%; height:100%; background:rgba(255,50,50,0.1);";
             thumb.appendChild(err);
        };

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
        
        video.onerror = () => {
             video.style.display = "none";
             const err = document.createElement("div");
             err.className = "mjr-thumb-error";
             err.innerHTML = '<i class="pi pi-video" style="font-size:24px; opacity:0.5;"></i>';
             err.style.cssText = "display:flex; align-items:center; justify-content:center; width:100%; height:100%; background:rgba(255,50,50,0.1);";
             thumb.appendChild(err);
        };

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
        // Hover binding removed in favor of autoplay-in-grid
        // mgr.bindHover(thumb, video);
    }

    return thumb;
}
