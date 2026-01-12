/**
 * Asset Viewer Component
 * Supports Single, A/B Compare, and Side-by-Side modes
 */

import { buildAssetViewURL } from "../api/endpoints.js";
import { updateAssetRating, getAssetMetadata, getAssetsBatch } from "../api/client.js";
import { ASSET_RATING_CHANGED_EVENT, ASSET_TAGS_CHANGED_EVENT } from "../app/events.js";
import { bindViewerContextMenu } from "../features/viewer/ViewerContextMenu.js";
import { createFileBadge, createRatingBadge, createTagsBadge } from "./Badges.js";
import { APP_CONFIG } from "../app/config.js";
import { safeDispatchCustomEvent } from "../utils/events.js";

/**
 * Viewer modes
 */
export const VIEWER_MODES = {
    SINGLE: 'single',
    AB_COMPARE: 'ab',
    SIDE_BY_SIDE: 'sidebyside'
};

/**
 * Create the main viewer overlay
 */
export function createViewer() {
    const overlay = document.createElement("div");
    overlay.className = "mjr-viewer-overlay";
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.95);
        z-index: 10000;
        display: none;
        flex-direction: column;
    `;
    // Ensure the overlay can receive focus so keyboard shortcuts work reliably.
    // (We still install a capture listener on `window` to beat ComfyUI global handlers.)
    overlay.tabIndex = -1;
    overlay.setAttribute("role", "dialog");

    // Header with controls
    const header = document.createElement("div");
    header.className = "mjr-viewer-header";
    header.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 20px;
        background: rgba(0, 0, 0, 0.8);
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        color: white;
    `;

    // Left controls
    const leftControls = document.createElement("div");
    leftControls.style.cssText = "display: flex; gap: 12px; align-items: center;";

    // Filename + badges
    const leftMeta = document.createElement("div");
    leftMeta.style.cssText = "display:flex; align-items:center; gap:10px; min-width:0;";

    const filename = document.createElement("span");
    filename.className = "mjr-viewer-filename";
    filename.style.cssText =
        "font-size: 14px; font-weight: 500; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;";

    const badgesBar = document.createElement("div");
    badgesBar.className = "mjr-viewer-badges";
    badgesBar.style.cssText = "display:flex; gap:8px; align-items:center; flex-wrap:wrap;";

    leftMeta.appendChild(filename);
    leftMeta.appendChild(badgesBar);

    // Mode selector
    const modeButtons = document.createElement("div");
    modeButtons.className = "mjr-viewer-mode-buttons";
    modeButtons.style.cssText = "display: flex; gap: 6px;";

    const singleBtn = createModeButton("Single", VIEWER_MODES.SINGLE);
    const abBtn = createModeButton("A/B", VIEWER_MODES.AB_COMPARE);
    const sideBtn = createModeButton("Side", VIEWER_MODES.SIDE_BY_SIDE);

    modeButtons.appendChild(singleBtn);
    modeButtons.appendChild(abBtn);
    modeButtons.appendChild(sideBtn);

    leftControls.appendChild(leftMeta);
    leftControls.appendChild(modeButtons);

    // Right controls
    const rightControls = document.createElement("div");
    rightControls.style.cssText = "display: flex; gap: 12px; align-items: center;";

    // Zoom controls
    const zoomOut = createIconButton("−", "Zoom Out");
    const zoomReset = createIconButton("100%", "Reset Zoom");
    const zoomIn = createIconButton("+", "Zoom In");

    // Zoom HUD (shows current zoom percentage)
    const zoomHUD = document.createElement("div");
    zoomHUD.className = "mjr-viewer-zoom-hud";
    zoomHUD.style.cssText = `
        position: absolute;
        top: 20px;
        right: 20px;
        padding: 6px 12px;
        background: rgba(0, 0, 0, 0.7);
        color: white;
        border-radius: 4px;
        font-size: 14px;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.3s ease;
        z-index: 1000;
    `;

    // Close button
    const closeBtn = createIconButton("✕", "Close (Esc)");
    closeBtn.style.fontSize = "20px";

    rightControls.appendChild(zoomOut);
    rightControls.appendChild(zoomReset);
    rightControls.appendChild(zoomIn);
    rightControls.appendChild(closeBtn);

    // Add zoom HUD to header
    header.appendChild(zoomHUD);

    header.appendChild(leftControls);
    header.appendChild(rightControls);

    // Content area
    const content = document.createElement("div");
    content.className = "mjr-viewer-content";
    content.style.cssText = `
        flex: 1;
        position: relative;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
    `;

    // Single view container
    const singleView = document.createElement("div");
    singleView.className = "mjr-viewer-single";
    singleView.style.cssText = `
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
    `;

    // A/B compare container
    const abView = document.createElement("div");
    abView.className = "mjr-viewer-ab";
    abView.style.cssText = `
        width: 100%;
        height: 100%;
        display: none;
        position: relative;
    `;

    // Side-by-side container
    const sideView = document.createElement("div");
    sideView.className = "mjr-viewer-sidebyside";
    sideView.style.cssText = `
        width: 100%;
        height: 100%;
        display: none;
        flex-direction: row;
        gap: 2px;
    `;

    content.appendChild(singleView);
    content.appendChild(abView);
    content.appendChild(sideView);

    // Footer with navigation
    const footer = document.createElement("div");
    footer.className = "mjr-viewer-footer";
    footer.style.cssText = `
        display: flex;
        justify-content: center;
        align-items: center;
        padding: 12px 20px;
        background: rgba(0, 0, 0, 0.8);
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        color: white;
        gap: 20px;
    `;

    const prevBtn = createIconButton("‹", "Previous (←)");
    prevBtn.style.fontSize = "24px";
    const indexInfo = document.createElement("span");
    indexInfo.className = "mjr-viewer-index";
    indexInfo.style.cssText = "font-size: 14px;";
    const nextBtn = createIconButton("›", "Next (→)");
    nextBtn.style.fontSize = "24px";

    footer.appendChild(prevBtn);
    footer.appendChild(indexInfo);
    footer.appendChild(nextBtn);

    overlay.appendChild(header);
    overlay.appendChild(content);
    overlay.appendChild(footer);

    // Viewer state
    const state = {
        mode: VIEWER_MODES.SINGLE,
        assets: [],
        currentIndex: 0,
        zoom: 1,
        panX: 0,
        panY: 0,
        // Direct transform (no animation targets)
        _lastPointerX: null,
        _lastPointerY: null,
        _mediaW: 0,
        _mediaH: 0,
        compareAsset: null,
        targetZoom: 1
    };

    // Metadata hydration cache for viewer-visible assets (so rating/tags show even if the grid
    // passed a lightweight asset object).
    const _metaCache = new Map(); // id -> { at:number, data:any }
    const META_TTL_MS = APP_CONFIG.VIEWER_META_TTL_MS ?? 30_000;
    const META_MAX_ENTRIES = APP_CONFIG.VIEWER_META_MAX_ENTRIES ?? 500;

    // Track hydration requests to prevent race conditions
    let hydrationRequestId = 0;

    const cleanupMetaCache = () => {
        if (_metaCache.size <= META_MAX_ENTRIES) return;
        const now = Date.now();

        // Remove expired entries first.
        try {
            for (const [key, value] of _metaCache.entries()) {
                if (!value) continue;
                if (now - (value.at || 0) > META_TTL_MS) {
                    _metaCache.delete(key);
                }
            }
        } catch {}

        if (_metaCache.size <= META_MAX_ENTRIES) return;
        // Still too large: remove oldest by timestamp.
        try {
            const sorted = Array.from(_metaCache.entries()).sort((a, b) => (a?.[1]?.at || 0) - (b?.[1]?.at || 0));
            const excess = _metaCache.size - META_MAX_ENTRIES;
            for (let i = 0; i < excess; i++) {
                const key = sorted[i]?.[0];
                if (key != null) _metaCache.delete(key);
            }
        } catch {}
    };

    const applyMetadata = (asset, meta) => {
        if (!asset || !meta || typeof meta !== "object") return;
        try {
            if (meta.rating !== undefined) asset.rating = meta.rating;
        } catch {}
        try {
            if (meta.tags !== undefined) asset.tags = meta.tags;
        } catch {}
    };

    const hydrateAssetMetadata = async (asset) => {
        const id = asset?.id;
        if (id == null) return;
        const key = String(id);
        const now = Date.now();
        const cached = _metaCache.get(key);
        if (cached && now - (cached.at || 0) < META_TTL_MS) {
            applyMetadata(asset, cached.data);
            return;
        }
        try {
            const res = await getAssetMetadata(id);
            if (res?.ok && res.data) {
                _metaCache.set(key, { at: now, data: res.data });
                cleanupMetaCache();
                applyMetadata(asset, res.data);
            }
        } catch {}
    };

    const hydrateAssetsMetadataBatch = async (assets) => {
        const list = Array.isArray(assets) ? assets : [];
        const now = Date.now();
        const toFetch = [];
        for (const asset of list) {
            const id = asset?.id;
            if (id == null) continue;
            const key = String(id);
            const cached = _metaCache.get(key);
            if (cached && now - (cached.at || 0) < META_TTL_MS) {
                applyMetadata(asset, cached.data);
                continue;
            }
            toFetch.push(id);
        }
        if (!toFetch.length) return;

        try {
            const res = await getAssetsBatch(toFetch);
            const items = Array.isArray(res?.data) ? res.data : [];
            for (const meta of items) {
                const id = meta?.id;
                if (id == null) continue;
                const key = String(id);
                _metaCache.set(key, { at: now, data: meta });
            }
            cleanupMetaCache();
            // Apply to local asset objects
            for (const asset of list) {
                const id = asset?.id;
                if (id == null) continue;
                const cached = _metaCache.get(String(id));
                if (cached && cached.data) applyMetadata(asset, cached.data);
            }
        } catch {}
    };

    const hydrateVisibleMetadata = async () => {
        // Increment request ID to invalidate previous requests
        const currentRequestId = ++hydrationRequestId;

        try {
            if (state.mode === VIEWER_MODES.SINGLE) {
                const current = state.assets[state.currentIndex];
                if (current) {
                    await hydrateAssetsMetadataBatch([current]);
                    // Check if this request is still valid before rendering
                    if (currentRequestId !== hydrationRequestId) return;
                }
                renderBadges();
                return;
            }
            const visible = Array.isArray(state.assets) ? state.assets.slice(0, 4) : [];
            const batch = visible.slice();
            if (state.compareAsset) batch.push(state.compareAsset);
            await hydrateAssetsMetadataBatch(batch);

            // Check if this request is still valid before rendering
            if (currentRequestId === hydrationRequestId) {
                renderBadges();
            }
        } catch {}
    };

    const updateMediaNaturalSize = () => {
        try {
            let root = singleView;
            if (state.mode === VIEWER_MODES.AB_COMPARE) root = abView;
            else if (state.mode === VIEWER_MODES.SIDE_BY_SIDE) root = sideView;
            const el = root?.querySelector?.(".mjr-viewer-media");
            if (!el) return;
            if (el.tagName === "IMG") {
                const w = Number(el.naturalWidth) || 0;
                const h = Number(el.naturalHeight) || 0;
                if (w > 0 && h > 0) {
                    state._mediaW = w;
                    state._mediaH = h;
                }
                return;
            }
            if (el.tagName === "VIDEO") {
                const w = Number(el.videoWidth) || 0;
                const h = Number(el.videoHeight) || 0;
                if (w > 0 && h > 0) {
                    state._mediaW = w;
                    state._mediaH = h;
                }
            }
        } catch {}
    };

    const attachMediaLoadHandlers = (mediaEl) => {
        if (!mediaEl || mediaEl._mjrMediaSizeBound) return;
        mediaEl._mjrMediaSizeBound = true;
        const sync = () => {
            updateMediaNaturalSize();
            clampPanToBounds();
            applyTransform();
        };
        try {
            if (mediaEl.tagName === "IMG") {
                mediaEl.addEventListener("load", () => requestAnimationFrame(sync), { once: true });
            } else if (mediaEl.tagName === "VIDEO") {
                mediaEl.addEventListener("loadedmetadata", () => requestAnimationFrame(sync), { once: true });
            }
        } catch {}
    };

    const clampPanToBounds = () => {
        try {
            // FIX: Verify overlay is visible before calculating bounds
            if (overlay.style.display === 'none') return;

            const MIN_ZOOM = 0.1;
            const MAX_ZOOM = 16;
            const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number(state.zoom) || 1));
            if (!(zoom > 1.001)) {
                state.panX = 0;
                state.panY = 0;
                return;
            }

            const current = state.assets[state.currentIndex];
            let aw = Number(current?.width) || 0;
            let ah = Number(current?.height) || 0;
            if (!(aw > 0 && ah > 0)) {
                updateMediaNaturalSize();
                aw = Number(state._mediaW) || 0;
                ah = Number(state._mediaH) || 0;
            }
            if (!(aw > 0 && ah > 0)) return;
            const aspect = aw / ah;
            if (!Number.isFinite(aspect) || aspect <= 0) return;

            const getViewportSize = () => {
                const fallbackW = Math.max(Number(content?.clientWidth) || 0, Number(overlay?.clientWidth) || 0);
                const fallbackH = Math.max(Number(content?.clientHeight) || 0, Number(overlay?.clientHeight) || 0);
                const clampToFallback = (w, h) => ({
                    w: Math.max(Number(w) || 0, fallbackW),
                    h: Math.max(Number(h) || 0, fallbackH),
                });
                if (state.mode === VIEWER_MODES.SINGLE) {
                    return clampToFallback(singleView.clientWidth, singleView.clientHeight);
                }
                if (state.mode === VIEWER_MODES.AB_COMPARE) {
                    return clampToFallback(abView.clientWidth, abView.clientHeight);
                }
                const children = Array.from(sideView.children || []).filter((el) => el && el.nodeType === 1);
                if (children.length) {
                    let minW = Infinity;
                    let minH = Infinity;
                    for (const child of children) {
                        const w = Number(child.clientWidth) || 0;
                        const h = Number(child.clientHeight) || 0;
                        if (w > 0) minW = Math.min(minW, w);
                        if (h > 0) minH = Math.min(minH, h);
                    }
                    if (Number.isFinite(minW) && Number.isFinite(minH)) {
                        return clampToFallback(minW, minH);
                    }
                }
                return clampToFallback(sideView.clientWidth, sideView.clientHeight);
            };

            const { w: vw, h: vh } = getViewportSize();
            if (!(vw > 0 && vh > 0)) {
                // FIX: If dimensions are zero (e.g., just after display:block but before paint),
                // defer the calculation to the next animation frame
                if (overlay.style.display !== 'none') {
                    requestAnimationFrame(clampPanToBounds);
                }
                return;
            }

            // Compute the "contain" base size inside the viewport.
            const viewportAspect = vw / vh;
            let baseW = vw;
            let baseH = vh;
            if (aspect >= viewportAspect) {
                baseW = vw;
                baseH = vw / aspect;
            } else {
                baseH = vh;
                baseW = vh * aspect;
            }

            const scaledW = baseW * zoom;
            const scaledH = baseH * zoom;

            const overflowVH = Math.max(0, scaledW - vw);
            const overflowVV = Math.max(0, scaledH - vh);
            const overflowImageW = Math.max(0, scaledW - baseW);
            const overflowImageH = Math.max(0, scaledH - baseH);
            const overscrollW = Math.max(0, baseW - vw);
            const overscrollH = Math.max(0, baseH - vh);
            const maxPanX =
                Math.max(overflowVH, overflowImageW, overscrollW) / 2 * zoom;
            const maxPanY =
                Math.max(overflowVV, overflowImageH, overscrollH) / 2 * zoom;

            // Clamp pan values directly (no animation targets)
            state.panX = Math.max(-maxPanX, Math.min(maxPanX, state.panX));
            state.panY = Math.max(-maxPanY, Math.min(maxPanY, state.panY));
        } catch {}
    };

    const mediaTransform = () => {
        const zoom = Math.max(0.1, Math.min(16, Number(state.zoom) || 1));
        const x = Number(state.panX) || 0;
        const y = Number(state.panY) || 0;
        // Use translate3d for GPU acceleration and scale together for better performance
        // Use translate-before-scale but normalize by zoom so panning is in screen pixels
        // (otherwise translate gets scaled and clamping becomes incorrect at high zoom).
        const nx = x / zoom;
        const ny = y / zoom;
        return `translate3d(${nx}px, ${ny}px, 0) scale(${zoom})`;
    };

    const setZoom = (next, { clientX = null, clientY = null } = {}) => {
        // Clamp zoom to reasonable limits (0.1x to 16x)
        const MIN_ZOOM = 0.1;
        const MAX_ZOOM = 16;
        const prevZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number(state.zoom) || 1));
        const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number(next) || 1));
        const nextZoom = Math.round(clamped * 100) / 100;

        // Calculate new pan values (direct, no animation)
        let newPanX = state.panX;
        let newPanY = state.panY;

        // Zoom towards pointer when available (keep the point under cursor stable).
        if (clientX != null && clientY != null && Number.isFinite(prevZoom) && prevZoom > 0 && nextZoom !== prevZoom) {
            try {
                const rect = content.getBoundingClientRect();
                const cx = rect.left + rect.width / 2;
                const cy = rect.top + rect.height / 2;
                const uX = (Number(clientX) || 0) - cx;
                const uY = (Number(clientY) || 0) - cy;
                const r = nextZoom / prevZoom;
                newPanX = Math.round(((Number(state.panX) || 0) * r + (1 - r) * uX) * 10) / 10;
                newPanY = Math.round(((Number(state.panY) || 0) * r + (1 - r) * uY) * 10) / 10;
            } catch {}
        } else if (nextZoom !== prevZoom) {
            // When zooming without a pointer, preserve relative pan.
            const r = nextZoom / prevZoom;
            newPanX = Math.round(((Number(state.panX) || 0) * r) * 10) / 10;
            newPanY = Math.round(((Number(state.panY) || 0) * r) * 10) / 10;
        }

        state.zoom = nextZoom;
        state.panX = newPanX;
        state.panY = newPanY;

        if (Math.abs(state.zoom - 1) < 0.001) {
            state.zoom = 1;
            state.panX = 0;
            state.panY = 0;
        }

        state.targetZoom = state.zoom;

        // Apply transform directly (no animation)
        applyTransform();
        updatePanCursor();
        showZoomHUD();
    };

    const applyTransform = () => {
        try {
            clampPanToBounds();
            const t = mediaTransform();
            for (const el of overlay.querySelectorAll(".mjr-viewer-media")) {
                try {
                    el.style.transform = t;
                } catch {}
            }
        } catch {}
    };

    // Zoom HUD functionality
    let zoomHUDElement = null;
    let zoomHUDTimeout = null;

    // Find the zoom HUD element
    zoomHUDElement = overlay.querySelector('.mjr-viewer-zoom-hud');

    const showZoomHUD = () => {
        if (!zoomHUDElement) return;

        // Clear any pending hide timeout
        if (zoomHUDTimeout) {
            clearTimeout(zoomHUDTimeout);
            zoomHUDTimeout = null;
        }

        // Calculate zoom percentage
        const fitScale = 1; // Assuming 1 is the "fit to screen" scale
        const zoomPercentage = Math.round((state.zoom / fitScale) * 100);

        // Update HUD text
        zoomHUDElement.textContent = `${zoomPercentage}%`;

        // Show HUD with fade-in effect
        zoomHUDElement.style.opacity = '1';

        // Set timeout to hide HUD after delay
        zoomHUDTimeout = setTimeout(() => {
            if (zoomHUDElement) {
                zoomHUDElement.style.opacity = '0';
            }
            zoomHUDTimeout = null;
        }, 800); // Hide after 800ms
    };

    // Smooth animation loop using requestAnimationFrame (only when needed)
    // REMOVED: Animation loop (requestAnimationFrame) for performance
    // Direct transform updates only

    const updatePanCursor = () => {
        try {
            if (overlay.style.display === "none") {
                content.style.cursor = "";
                return;
            }
            const zoomed = (Number(state.zoom) || 1) > 1.01;
            if (!zoomed) {
                content.style.cursor = "";
                return;
            }
            content.style.cursor = "grab";
        } catch {}
    };

    const renderBadges = () => {
        try {
            badgesBar.innerHTML = "";
        } catch {}

        const isSingle = state.mode === VIEWER_MODES.SINGLE;
        const items = isSingle
            ? [state.assets[state.currentIndex]].filter(Boolean)
            : Array.isArray(state.assets)
              ? state.assets.slice(0, 4)
              : [];

        for (const a of items) {
            if (!a) continue;
            const pill = document.createElement("div");
            pill.className = "mjr-viewer-asset-pill";
            pill.style.cssText = `
                display: inline-flex;
                align-items: center;
                gap: 8px;
                padding: 2px 8px;
                border-radius: 999px;
                border: 1px solid rgba(255,255,255,0.14);
                background: rgba(255,255,255,0.08);
                font-size: 12px;
                max-width: 360px;
                overflow: hidden;
            `;

            // In Single mode the filename is already displayed as the main title.
            // Only show per-asset names in compare modes (A/B, side-by-side) where multiple assets are visible.
            const name = document.createElement("span");
            name.textContent = String(a.filename || "");
            name.style.cssText =
                "max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; opacity:0.95;";

            const extBadge = createFileBadge(a.filename, a.kind);
            try {
                extBadge.style.position = "static";
                extBadge.style.top = "";
                extBadge.style.left = "";
                extBadge.style.padding = "2px 6px";
                extBadge.style.fontSize = "10px";
                extBadge.style.borderRadius = "6px";
                extBadge.style.pointerEvents = "none";
            } catch {}

            const stars = createRatingBadge(a.rating || 0);
            if (stars) {
                try {
                    stars.style.position = "static";
                    stars.style.top = "";
                    stars.style.right = "";
                    stars.style.padding = "2px 6px";
                    stars.style.fontSize = "12px";
                } catch {}
            }

            const tags = createTagsBadge(Array.isArray(a.tags) ? a.tags : []);
            if (tags) {
                try {
                    tags.style.position = "static";
                    tags.style.bottom = "";
                    tags.style.left = "";
                    tags.style.maxWidth = "220px";
                    tags.style.pointerEvents = "none";
                } catch {}
            }

            pill.appendChild(extBadge);
            if (!isSingle) pill.appendChild(name);
            if (stars) pill.appendChild(stars);
            if (tags && tags.style.display !== "none") pill.appendChild(tags);

            try {
                if (a.filepath) pill.title = String(a.filepath);
            } catch {}

            badgesBar.appendChild(pill);
        }
    };

    function canAB() {
        return state.assets.length === 2;
    }

    function canSide() {
        const n = state.assets.length;
        return n >= 2 && n <= 4;
    }

    // Update UI based on state
    function updateUI() {
        // FORCE RESET: Always reset zoom/pan when changing images
        state.zoom = 1;
        state.panX = 0;
        state.panY = 0;
        state.targetZoom = 1;

        // Update filename
        const current = state.assets[state.currentIndex];
        if (state.mode === VIEWER_MODES.AB_COMPARE && canAB()) {
            filename.textContent = "A/B Compare";
        } else if (state.mode === VIEWER_MODES.SIDE_BY_SIDE && canSide()) {
            filename.textContent = state.assets.length > 2 ? "Side-by-side (2×2)" : "Side-by-side";
        } else if (current) {
            filename.textContent = current.filename || '';
        }

        // Update index
        if (state.mode === VIEWER_MODES.AB_COMPARE && canAB()) {
            indexInfo.textContent = "2 selected";
        } else if (state.mode === VIEWER_MODES.SIDE_BY_SIDE && canSide()) {
            indexInfo.textContent = `${state.assets.length} selected`;
        } else {
            indexInfo.textContent = `${state.currentIndex + 1} / ${state.assets.length}`;
        }

        // Update mode buttons
        try {
            abBtn.disabled = !canAB();
            sideBtn.disabled = !canSide();
            abBtn.style.opacity = abBtn.disabled ? "0.35" : (abBtn.dataset.mode === state.mode ? "1" : "0.6");
            sideBtn.style.opacity = sideBtn.disabled ? "0.35" : (sideBtn.dataset.mode === state.mode ? "1" : "0.6");
        } catch {}
        [singleBtn, abBtn, sideBtn].forEach(btn => {
            if (btn === abBtn || btn === sideBtn) return;
            btn.style.opacity = btn.dataset.mode === state.mode ? "1" : "0.6";
            btn.style.fontWeight = btn.dataset.mode === state.mode ? "600" : "400";
        });

        if (state.mode === VIEWER_MODES.AB_COMPARE && !canAB()) {
            state.mode = VIEWER_MODES.SINGLE;
        }
        if (state.mode === VIEWER_MODES.SIDE_BY_SIDE && !canSide()) {
            state.mode = VIEWER_MODES.SINGLE;
        }

        // Show/hide views
        singleView.style.display = state.mode === VIEWER_MODES.SINGLE ? 'flex' : 'none';
        abView.style.display = state.mode === VIEWER_MODES.AB_COMPARE ? 'block' : 'none';
        sideView.style.display = state.mode === VIEWER_MODES.SIDE_BY_SIDE ? 'flex' : 'none';

        renderBadges();

        // Hide navigation for compare modes (selected-set compare).
        const hideNav =
            (state.mode === VIEWER_MODES.AB_COMPARE && canAB()) ||
            (state.mode === VIEWER_MODES.SIDE_BY_SIDE && canSide());
        try {
            prevBtn.style.display = hideNav ? "none" : "";
            nextBtn.style.display = hideNav ? "none" : "";
        } catch {}

        // Render current asset
        renderAsset();

        // Hydrate rating/tags for visible assets and refresh the badge bar.
        try {
            void hydrateVisibleMetadata().then(() => {
                try {
                    renderBadges();
                } catch {}
            });
        } catch {}
    }

    // Render the current asset based on mode
    function renderAsset() {
        const current = state.assets[state.currentIndex];
        if (!current) return;

        const viewUrl = buildAssetViewURL(current);

        if (state.mode === VIEWER_MODES.SINGLE) {
            singleView.innerHTML = '';
            state._mediaW = 0;
            state._mediaH = 0;
            const media = createMediaElement(current, viewUrl);
            singleView.appendChild(media);
        } else if (state.mode === VIEWER_MODES.AB_COMPARE) {
            if (canAB()) renderABCompare(current, viewUrl);
        } else if (state.mode === VIEWER_MODES.SIDE_BY_SIDE) {
            if (canSide()) renderSideBySide(current, viewUrl);
        }
        applyTransform();
        updatePanCursor();
    }

    // Create image or video element
    function createMediaElement(asset, url) {
        const container = document.createElement("div");
        container.style.cssText = `
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
        `;

        if (asset.kind === 'video') {
            const video = document.createElement("video");
            video.className = "mjr-viewer-media";
            video.src = url;
            video.controls = true;
            video.autoplay = true;
            video.loop = true;
            video.playsInline = true;
            video.style.cssText = `
                max-width: 100%;
                max-height: 100%;
                object-fit: contain;
                transform: ${mediaTransform()};
                transform-origin: center center;
            `;
            attachMediaLoadHandlers(video);
            try {
                video.addEventListener(
                    "canplay",
                    () => {
                        try {
                            const p = video.play?.();
                            if (p && typeof p.catch === "function") p.catch(() => {});
                        } catch {}
                    },
                    { once: true }
                );
            } catch {}
            container.appendChild(video);
        } else {
            const img = document.createElement("img");
            img.className = "mjr-viewer-media";
            img.src = url;
            img.style.cssText = `
                max-width: 100%;
                max-height: 100%;
                object-fit: contain;
                transform: ${mediaTransform()};
                transform-origin: center center;
            `;
            attachMediaLoadHandlers(img);
            container.appendChild(img);
        }

        return container;
    }

    // Create media element for compare modes (A/B and side-by-side).
    // Important: the returned element fills the container so both layers share identical sizing/centering,
    // which avoids "half-width re-centering" and other overlay drift.
    function createCompareMediaElement(asset, url) {
        if (asset.kind === "video") {
            const video = document.createElement("video");
            video.className = "mjr-viewer-media";
            video.src = url;
            video.controls = false;
            video.loop = true;
            video.muted = true;
            video.playsInline = true;
            video.autoplay = true;
            video.style.cssText = `
                width: 100%;
                height: 100%;
                object-fit: contain;
                transform: ${mediaTransform()};
                transform-origin: center center;
            `;
            attachMediaLoadHandlers(video);
            return video;
        }

        const img = document.createElement("img");
        img.className = "mjr-viewer-media";
        img.src = url;
        img.style.cssText = `
            width: 100%;
            height: 100%;
            object-fit: contain;
            transform: ${mediaTransform()};
            transform-origin: center center;
        `;
        attachMediaLoadHandlers(img);
        return img;
    }

    // Render A/B compare view
    function renderABCompare(current, viewUrl) {
        abView.innerHTML = '';

        const other =
            state.compareAsset ||
            (state.assets.length === 2 ? state.assets[1 - state.currentIndex] : null) ||
            current;
        const compareUrl = buildAssetViewURL(other);

        // Base layer (B)
        const baseLayer = document.createElement("div");
        baseLayer.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
        `;
        const baseMedia = createCompareMediaElement(other, compareUrl);
        baseLayer.appendChild(baseMedia);

        // Top layer (A) with slider
        const topLayer = document.createElement("div");
        topLayer.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
        `;
        // IMPORTANT: keep A aligned to B by keeping the top layer full-size and clipping it,
        // instead of shrinking the layer width (which would re-center A differently).
        const supportsClipPath = (() => {
            try {
                return !!window.CSS?.supports?.("clip-path: inset(0 50% 0 0)");
            } catch {
                return false;
            }
        })();
        const setClipPercent = (percent) => {
            const clamped = Math.max(0, Math.min(100, percent));
            const right = 100 - clamped;
            if (supportsClipPath) {
                const value = `inset(0 ${right}% 0 0)`;
                topLayer.style.clipPath = value;
                topLayer.style.webkitClipPath = value;
                return;
            }
            // Fallback for older browsers: use deprecated `clip` (works only with absolute positioning)
            // Clip rectangle: show left `percent%` of the layer.
            const rect = abView.getBoundingClientRect();
            const w = rect.width || 1;
            const h = rect.height || 1;
            const px = Math.round((w * clamped) / 100);
            topLayer.style.clip = `rect(0px, ${px}px, ${h}px, 0px)`;
        };
        setClipPercent(50);
        const topMedia = createCompareMediaElement(current, viewUrl);
        topLayer.appendChild(topMedia);

        // Slider handle
        const slider = document.createElement("div");
        slider.style.cssText = `
            position: absolute;
            top: 0;
            left: 50%;
            width: 3px;
            height: 100%;
            background: white;
            cursor: ew-resize;
            z-index: 10;
        `;

        const handle = document.createElement("div");
        handle.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 40px;
            height: 40px;
            background: white;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 16px;
            color: black;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
        `;
        handle.textContent = "\u2194";
        slider.appendChild(handle);

        // Drag functionality (pointer-capture; avoids leaking document-level listeners on re-render)
        let isDragging = false;
        const onPointerMove = (e) => {
            if (!isDragging) return;
            const rect = abView.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const percent = (x / rect.width) * 100;
            const clamped = Math.max(0, Math.min(100, percent));
            setClipPercent(clamped);
            slider.style.left = `${clamped}%`;
        };
        const stopDrag = () => {
            isDragging = false;
        };
        slider.addEventListener("pointerdown", (e) => {
            isDragging = true;
            try {
                slider.setPointerCapture(e.pointerId);
            } catch {}
            onPointerMove(e);
        });
        slider.addEventListener("pointermove", onPointerMove);
        slider.addEventListener("pointerup", stopDrag);
        slider.addEventListener("pointercancel", stopDrag);

        abView.appendChild(baseLayer);
        abView.appendChild(topLayer);
        abView.appendChild(slider);

        // FIX: Synchronize videos in A/B comparison mode
        if (baseMedia.tagName === 'VIDEO' && topMedia.tagName === 'VIDEO') {
            let syncing = false;

            const bindSync = (leader, follower) => {
                leader.addEventListener('play', () => {
                    if (syncing) return;
                    follower.play().catch(() => {});
                });
                leader.addEventListener('pause', () => {
                    if (syncing) return;
                    follower.pause();
                });
                leader.addEventListener('timeupdate', () => {
                    if (syncing) return;
                    // Use a threshold to avoid jitter and infinite loops
                    if (Math.abs(leader.currentTime - follower.currentTime) > 0.15) {
                        syncing = true;
                        follower.currentTime = leader.currentTime;
                        syncing = false;
                    }
                });
                leader.addEventListener('seeking', () => {
                    if (syncing) return;
                    syncing = true;
                    follower.currentTime = leader.currentTime;
                    syncing = false;
                });
            };

            // Bidirectional sync
            bindSync(baseMedia, topMedia);
            bindSync(topMedia, baseMedia);

            // Mute one video to avoid audio echo
            topMedia.muted = true;
            baseMedia.muted = false;
        }
    }

    // Render side-by-side view
    function renderSideBySide(current, viewUrl) {
        sideView.innerHTML = '';

        const items = state.assets.slice(0, 4);
        const count = items.length;
        if (count > 2) {
            // 2x2 grid (3 or 4 items). Do not wrap in another container: theme CSS targets direct children.
            sideView.style.display = "grid";
            sideView.style.gridTemplateColumns = "1fr 1fr";
            sideView.style.gridTemplateRows = "1fr 1fr";
            sideView.style.gap = "2px";
            sideView.style.padding = "2px";

            for (let i = 0; i < 4; i++) {
                const cell = document.createElement("div");
                cell.style.cssText = `
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: rgba(255,255,255,0.05);
                    overflow: hidden;
                `;
                const a = items[i];
                if (a) {
                    const u = buildAssetViewURL(a);
                    cell.appendChild(createMediaElement(a, u));
                }
                sideView.appendChild(cell);
            }
            return;
        }

        const other =
            state.compareAsset ||
            (state.assets.length === 2 ? state.assets[1 - state.currentIndex] : null) ||
            current;
        const compareUrl = buildAssetViewURL(other);

        const leftPanel = document.createElement("div");
        leftPanel.style.cssText = `
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(255,255,255,0.05);
            overflow: hidden;
        `;
        const leftMedia = createMediaElement(current, viewUrl);
        leftPanel.appendChild(leftMedia);

        const rightPanel = document.createElement("div");
        rightPanel.style.cssText = `
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(255,255,255,0.05);
            overflow: hidden;
        `;
        const rightMedia = createMediaElement(other, compareUrl);
        rightPanel.appendChild(rightMedia);

        sideView.style.display = "flex";
        sideView.style.flexDirection = "row";
        sideView.style.gap = "2px";
        sideView.style.padding = "0";
        sideView.appendChild(leftPanel);
        sideView.appendChild(rightPanel);

        // FIX: Synchronize videos in side-by-side mode
        if (leftMedia.tagName === 'VIDEO' && rightMedia.tagName === 'VIDEO') {
            let syncing = false;

            const bindSync = (leader, follower) => {
                leader.addEventListener('play', () => {
                    if (syncing) return;
                    follower.play().catch(() => {});
                });
                leader.addEventListener('pause', () => {
                    if (syncing) return;
                    follower.pause();
                });
                leader.addEventListener('timeupdate', () => {
                    if (syncing) return;
                    if (Math.abs(leader.currentTime - follower.currentTime) > 0.15) {
                        syncing = true;
                        follower.currentTime = leader.currentTime;
                        syncing = false;
                    }
                });
                leader.addEventListener('seeking', () => {
                    if (syncing) return;
                    syncing = true;
                    follower.currentTime = leader.currentTime;
                    syncing = false;
                });
            };

            // Bidirectional sync
            bindSync(leftMedia, rightMedia);
            bindSync(rightMedia, leftMedia);

            // Mute right video to avoid audio echo
            rightMedia.muted = true;
            leftMedia.muted = false;
        }
    }

    // Mode switchers
    singleBtn.addEventListener('click', () => {
        state.mode = VIEWER_MODES.SINGLE;
        updateUI();
    });
    abBtn.addEventListener('click', () => {
        if (!canAB()) return;
        state.mode = VIEWER_MODES.AB_COMPARE;
        updateUI();
    });
    sideBtn.addEventListener('click', () => {
        if (!canSide()) return;
        state.mode = VIEWER_MODES.SIDE_BY_SIDE;
        updateUI();
    });

    // Navigation
    prevBtn.addEventListener('click', () => {
        if (state.currentIndex > 0) {
            state.currentIndex--;
            updateUI();
        }
    });

    nextBtn.addEventListener('click', () => {
        if (state.currentIndex < state.assets.length - 1) {
            state.currentIndex++;
            updateUI();
        }
    });

    // Zoom controls
    zoomIn.addEventListener('click', () => {
        setZoom((Number(state.zoom) || 1) + 0.25, { clientX: state._lastPointerX, clientY: state._lastPointerY });
        // setZoom now handles transform application directly
    });

    zoomOut.addEventListener('click', () => {
        setZoom((Number(state.zoom) || 1) - 0.25, { clientX: state._lastPointerX, clientY: state._lastPointerY });
        // setZoom now handles transform application directly
    });

    zoomReset.addEventListener('click', () => {
        setZoom(1);
        // setZoom now handles transform application directly
    });

    // Close
    closeBtn.addEventListener('click', () => {
        closeViewer();
    });

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            closeViewer();
        }
    });

    // Mouse wheel zoom (trackpad-friendly). Capture + preventDefault so ComfyUI canvas doesn't zoom underneath.
    const navigateViewerAssets = (direction) => {
        if (!Array.isArray(state.assets) || state.assets.length === 0) {
            return false;
        }
        const nextIndex = state.currentIndex + direction;
        if (nextIndex < 0 || nextIndex >= state.assets.length) {
            return false;
        }
        state.currentIndex = nextIndex;
        updateUI();
        return true;
    };

    const onWheelZoom = (e) => {
        if (overlay.style.display === "none") return;
        try {
            const t = e.target;
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) {
                return;
            }
        } catch {}

        // Only zoom when hovering the viewer content area.
        try {
            if (!content.contains(e.target)) return;
        } catch {}

        try {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation?.();
        } catch {}

        if (e.shiftKey) {
            const delta = Number(e.deltaY) || 0;
            if (delta) {
                const direction = delta > 0 ? 1 : -1;
                if (navigateViewerAssets(direction)) {
                    return;
                }
            }
        }

        const dy = Number(e.deltaY) || 0;
        if (!dy) return;

        // Smooth scaling: wheel down -> zoom out, wheel up -> zoom in.
        const factor = Math.exp(-dy * 0.0015);
        const next = (Number(state.zoom) || 1) * factor;
        setZoom(next, { clientX: e.clientX, clientY: e.clientY });
        // setZoom now handles transform application directly
    };

    try {
        if (!content._mjrWheelZoomBound) {
            content.addEventListener("wheel", onWheelZoom, { passive: false, capture: true });
            content._mjrWheelZoomBound = true;
        }
    } catch {}

    // Track pointer position to zoom towards cursor for button/keyboard zoom.
    try {
        if (!content._mjrPointerTrackBound) {
            content.addEventListener(
                "mousemove",
                (e) => {
                    state._lastPointerX = e.clientX;
                    state._lastPointerY = e.clientY;
                },
                { passive: true, capture: true }
            );
            content._mjrPointerTrackBound = true;
        }
    } catch {}

    // Pan (middle-mouse-like click+drag) when zoomed in.
    // When zoomed, left-dragging over the viewer content immediately pans (no threshold).
    const pan = { active: false, pointerId: null, startX: 0, startY: 0, startPanX: 0, startPanY: 0 };

    const onPanPointerDown = (e) => {
        if (overlay.style.display === "none") return;
        if (!((Number(state.zoom) || 1) > 1.01)) return;
        const isLeft = e.button === 0;
        const isMiddle = e.button === 1;
        if (!isLeft && !isMiddle) return;
        try {
            const t = e.target;
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
        } catch {}

        // Only start panning inside the viewer content area (avoid header/footer buttons).
        try {
            if (!content.contains(e.target)) return;
        } catch {
            return;
        }

        pan.active = true;
        pan.pointerId = e.pointerId;
        try {
            state._lastPointerX = e.clientX;
            state._lastPointerY = e.clientY;
        } catch {}
        pan.startX = e.clientX;
        pan.startY = e.clientY;
        pan.startPanX = Number(state.panX) || 0;
        pan.startPanY = Number(state.panY) || 0;
        try {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation?.();
        } catch {}
        try {
            content.setPointerCapture?.(e.pointerId);
        } catch {}
        try {
            content.style.cursor = "grabbing";
        } catch {}
    };

    const onPanPointerMove = (e) => {
        if (!pan.active) return;
        try {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation?.();
        } catch {}
        const dx = (Number(e.clientX) || 0) - pan.startX;
        const dy = (Number(e.clientY) || 0) - pan.startY;
        const zoom = Math.max(0.1, Math.min(16, Number(state.zoom) || 1));
        const panMultiplier = Math.max(1, zoom);
        state.panX = pan.startPanX + dx * panMultiplier;
        state.panY = pan.startPanY + dy * panMultiplier;
        try {
            state._lastPointerX = e.clientX;
            state._lastPointerY = e.clientY;
        } catch {}
        // Apply transform directly (no animation)
        applyTransform();
        updatePanCursor();
    };

    const onPanPointerUp = (e) => {
        if (!pan.active) return;
        pan.active = false;
        pan.pointerId = null;
        try {
            content.releasePointerCapture?.(e.pointerId);
        } catch {}
        updatePanCursor();
    };

    try {
        if (!content._mjrPanBound) {
            content.addEventListener("pointerdown", onPanPointerDown, { passive: false, capture: true });
            content.addEventListener("pointermove", onPanPointerMove, { passive: false, capture: true });
            content.addEventListener("pointerup", onPanPointerUp, { passive: true, capture: true });
            content.addEventListener("pointercancel", onPanPointerUp, { passive: true, capture: true });
            content._mjrPanBound = true;
        }
    } catch {}

    // Double-click anywhere in the viewer content resets zoom + pan.
    try {
        if (!content._mjrDblClickResetBound) {
            content.addEventListener(
                "dblclick",
                (e) => {
                    if (overlay.style.display === "none") return;
                    try {
                        if (!content.contains(e.target)) return;
                    } catch {}
                    try {
                        e.preventDefault();
                        e.stopPropagation();
                        e.stopImmediatePropagation?.();
                    } catch {}
                    // Toggle between fit and max zoom on double-click
                    const isNearFit = Math.abs(state.targetZoom - 1) < 0.01;
                    if (isNearFit) {
                        // If near fit, go to max zoom (8x)
                        setZoom(Math.min(8, state.targetZoom * 4), { clientX: e.clientX, clientY: e.clientY });
                    } else {
                        // If zoomed in, return to fit
                        setZoom(1, { clientX: e.clientX, clientY: e.clientY });
                    }
                    showZoomHUD(); // Show zoom HUD when toggling
                },
                { passive: false, capture: true }
            );
            content._mjrDblClickResetBound = true;
        }
    } catch {}

    // Keyboard shortcuts (installed on capture phase to avoid ComfyUI/global handlers eating events).
    function handleKeyboard(e) {
        // Check if hotkeys are suspended (e.g. when dialogs/popovers are open)
        if (window._mjrHotkeysState?.suspended) return;

        if (overlay.style.display === 'none') return;

        // If an input-like element is focused inside the viewer, avoid hijacking typing.
        try {
            const t = e.target;
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
                if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation?.();
                    closeViewer();
                }
                return;
            }
        } catch {}

        const isSingle = state.mode === VIEWER_MODES.SINGLE;
        const current = state.assets[state.currentIndex];

        const setRatingFromKey = async (key) => {
            if (!isSingle) return false;
            if (!current?.id) return false;
            if (key !== "0" && key !== "1" && key !== "2" && key !== "3" && key !== "4" && key !== "5") return false;
            const rating = key === "0" ? 0 : Number(key);
            if (!Number.isFinite(rating)) return false;

            try {
                const result = await updateAssetRating(current.id, rating);
                if (!result?.ok) {
                    console.warn("[Viewer] Rating update failed:", result?.error || result);
                    return true;
                }
                current.rating = rating;
                safeDispatchCustomEvent(
                    ASSET_RATING_CHANGED_EVENT,
                    { assetId: String(current.id), rating },
                    { warnPrefix: "[Viewer]" }
                );
                return true;
            } catch (e) {
                console.error("[Viewer] Rating update exception:", e);
                return true;
            }
        };

        const stepFrame = async (direction) => {
            if (!isSingle) return false;
            if (current?.kind !== "video") return false;
            const video = singleView.querySelector("video");
            if (!video) return false;

            try {
                // Pause so arrows behave deterministically.
                video.pause?.();
            } catch {}

            const fpsGuess = 30;
            const step = 1 / fpsGuess;
            const delta = direction * step;

            try {
                const duration = Number(video.duration);
                const next = Math.max(0, Math.min(Number.isFinite(duration) ? duration : Infinity, (video.currentTime || 0) + delta));
                video.currentTime = next;
                return true;
            } catch {
                return true;
            }
        };

        // Rating shortcuts (viewer single only)
        if (isSingle && (e.key === "0" || e.key === "1" || e.key === "2" || e.key === "3" || e.key === "4" || e.key === "5")) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation?.();
            void setRatingFromKey(e.key);
            return;
        }

        // Frame-by-frame (viewer single + video only)
        // Shift+Arrow keys for frame stepping when viewing a single video
        if (isSingle && e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight")) {
            const videoEl = overlay.querySelector('video');
            if (videoEl) {
                // Video exists - use Shift+arrows for frame stepping
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation?.();
                const direction = (e.key === "ArrowUp" || e.key === "ArrowLeft") ? -1 : 1;
                void stepFrame(direction);
                return;
            }
        }

        switch (e.key) {
            case 'Tab':
                // FIX: Focus trap - prevent tabbing to elements outside the viewer
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation?.();
                // Keep focus within the viewer overlay
                if (!overlay.contains(document.activeElement)) {
                    overlay.focus();
                }
                break;
            case 'Escape':
                closeViewer();
                break;
            case 'ArrowLeft':
                // Plain arrows navigate between assets
                navigateViewerAssets(-1);
                break;
            case 'ArrowRight':
                // Plain arrows navigate between assets
                navigateViewerAssets(1);
                break;
            case '+':
            case '=':
                setZoom((Number(state.zoom) || 1) + 0.25, { clientX: state._lastPointerX, clientY: state._lastPointerY });
                showZoomHUD(); // Show zoom HUD when zooming with keyboard
                break;
            case '-':
            case '_':
                setZoom((Number(state.zoom) || 1) - 0.25, { clientX: state._lastPointerX, clientY: state._lastPointerY });
                showZoomHUD(); // Show zoom HUD when zooming with keyboard
                break;
        }
    }

    // Bind once per overlay instance.
    try {
        if (!overlay._mjrKeyboardBound) {
            window.addEventListener("keydown", handleKeyboard, true);
            overlay._mjrKeyboardBound = true;
        }
    } catch {
        try {
            document.addEventListener("keydown", handleKeyboard, true);
        } catch {}
    }

    // Keep viewer badges in sync when tags/ratings change elsewhere (sidebar, panel hotkeys, etc.).
    try {
        if (!overlay._mjrBadgeSyncBound) {
            window.addEventListener(
                ASSET_RATING_CHANGED_EVENT,
                (e) => {
                    const id = e?.detail?.assetId;
                    const rating = e?.detail?.rating;
                    if (id == null) return;
                    for (const a of state.assets || []) {
                        if (a?.id != null && String(a.id) === String(id)) {
                            a.rating = rating;
                        }
                    }
                    try {
                        _metaCache.delete(String(id));
                    } catch {}
                    renderBadges();
                },
                { passive: true }
            );
            window.addEventListener(
                ASSET_TAGS_CHANGED_EVENT,
                (e) => {
                    const id = e?.detail?.assetId;
                    const tags = e?.detail?.tags;
                    if (id == null) return;
                    for (const a of state.assets || []) {
                        if (a?.id != null && String(a.id) === String(id)) {
                            a.tags = tags;
                        }
                    }
                    try {
                        _metaCache.delete(String(id));
                    } catch {}
                    renderBadges();
                },
                { passive: true }
            );
            overlay._mjrBadgeSyncBound = true;
        }
    } catch {}

    function closeViewer() {
        // Ensure media playback is fully stopped when closing the overlay.
        // Hiding the overlay alone does not stop HTMLMediaElement audio in all browsers.
        try {
            const mediaEls = overlay.querySelectorAll?.("video, audio");
            if (mediaEls && mediaEls.length) {
                for (const el of mediaEls) {
                    try {
                        el.muted = true;
                    } catch {}
                    try {
                        el.pause?.();
                    } catch {}
                    try {
                        el.currentTime = 0;
                    } catch {}
                    try {
                        // Remove all <source> children (if any) and unload the element.
                        const sources = el.querySelectorAll?.("source");
                        if (sources && sources.length) {
                            for (const s of sources) {
                                try {
                                    s.remove();
                                } catch {}
                            }
                        }
                    } catch {}
                    try {
                        el.removeAttribute?.("src");
                    } catch {}
                    try {
                        // Some browsers keep playing unless we force a reload after removing src.
                        el.load?.();
                    } catch {}
                }
            }
        } catch {}

        // Free DOM resources (and ensure playback stops even if `pause()` was ignored).
        try {
            singleView.innerHTML = "";
        } catch {}
        try {
            abView.innerHTML = "";
        } catch {}
        try {
            sideView.innerHTML = "";
        } catch {}

        overlay.style.display = 'none';
        try {
            document.body.style.overflow = state._prevBodyOverflow ?? '';
        } catch {
            document.body.style.overflow = '';
        }

        // FIX: Restore focus to previously focused element for accessibility
        try {
            if (state._prevFocusedElement && typeof state._prevFocusedElement.focus === 'function') {
                state._prevFocusedElement.focus();
            }
            state._prevFocusedElement = null;
        } catch {}

        // Return hotkeys scope to panel
        if (window._mjrHotkeysState) {
            window._mjrHotkeysState.scope = "panel";
        }
    }

    // Public API
    const api = {
        open(assets, startIndex = 0, compareAsset = null) {
            state.assets = Array.isArray(assets) ? assets : [assets];
            state.currentIndex = Math.max(0, Math.min(startIndex, state.assets.length - 1));
            state.zoom = 1;
            state.panX = 0;
            state.panY = 0;
            state.targetZoom = 1;
            state._lastPointerX = null;
            state._lastPointerY = null;
            state._mediaW = 0;
            state._mediaH = 0;
            state.compareAsset = compareAsset;

            overlay.style.display = 'flex';

            // FIX: Store previously focused element and set focus to overlay for accessibility
            try {
                state._prevFocusedElement = document.activeElement;
            } catch {
                state._prevFocusedElement = null;
            }

            // Focus the overlay so screen readers announce it as a dialog
            overlay.focus();

            try {
                state._prevBodyOverflow = document.body.style.overflow;
            } catch {
                state._prevBodyOverflow = '';
            }
            document.body.style.overflow = 'hidden';

            // Set hotkeys scope to viewer (takes priority over panel)
            if (!window._mjrHotkeysState) window._mjrHotkeysState = {};
            window._mjrHotkeysState.scope = "viewer";

            updateUI();
            // No animation loop needed - transforms are applied directly
        },

        close() {
            closeViewer();
            // No animation loop to stop
        },

        setMode(mode) {
            if (Object.values(VIEWER_MODES).includes(mode)) {
                state.mode = mode;
                updateUI();
            }
        },

        setCompareAsset(asset) {
            state.compareAsset = asset;
            updateUI();
        },

        dispose() {
            try {
                window.removeEventListener("keydown", handleKeyboard, true);
                overlay._mjrKeyboardBound = false;
            } catch {}
            try {
                document.removeEventListener("keydown", handleKeyboard, true);
            } catch {}
        }
    };

    overlay._mjrViewerAPI = api;

    // Right-click context menu (viewer): tags/rating/open-in-folder/copy path.
    try {
        bindViewerContextMenu({
            overlayEl: overlay,
            getCurrentAsset: () => state.assets[state.currentIndex],
            getCurrentViewUrl: (asset) => buildAssetViewURL(asset),
            onAssetChanged: () => {
                try {
                    renderBadges();
                } catch {}
            },
        });
    } catch {}

    return overlay;
}

/**
 * Helper to create mode button
 */
function createModeButton(label, mode) {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.dataset.mode = mode;
    btn.style.cssText = `
        padding: 4px 12px;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: white;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        transition: all 0.2s;
    `;
    btn.addEventListener('mouseenter', () => {
        btn.style.background = 'rgba(255, 255, 255, 0.2)';
    });
    btn.addEventListener('mouseleave', () => {
        btn.style.background = 'rgba(255, 255, 255, 0.1)';
    });
    return btn;
}

/**
 * Helper to create icon button
 */
function createIconButton(label, title) {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.title = title;
    btn.style.cssText = `
        padding: 6px 12px;
        background: transparent;
        border: 1px solid rgba(255, 255, 255, 0.3);
        color: white;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        transition: all 0.2s;
    `;
    btn.addEventListener('mouseenter', () => {
        btn.style.background = 'rgba(255, 255, 255, 0.1)';
    });
    btn.addEventListener('mouseleave', () => {
        btn.style.background = 'transparent';
    });
    return btn;
}

/**
 * Get or create global viewer instance
 */
export function getViewerInstance() {
    const existing = document.querySelector('.mjr-viewer-overlay');
    if (existing && existing._mjrViewerAPI) {
        return existing._mjrViewerAPI;
    }

    const viewer = createViewer();
    document.body.appendChild(viewer);
    return viewer._mjrViewerAPI;
}
