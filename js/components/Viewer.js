/**
 * Asset Viewer Component
 * Supports Single, A/B Compare, and Side-by-Side modes
 */

import { buildAssetViewURL } from "../api/endpoints.js";
import { updateAssetRating, getAssetMetadata, getAssetsBatch, getViewerInfo, getFileMetadata, getFileMetadataScoped } from "../api/client.js";
import { ASSET_RATING_CHANGED_EVENT, ASSET_TAGS_CHANGED_EVENT } from "../app/events.js";
import { bindViewerContextMenu } from "../features/viewer/ViewerContextMenu.js";
import { createFileBadge, createRatingBadge, createTagsBadge } from "./Badges.js";
import { APP_CONFIG } from "../app/config.js";
import { safeDispatchCustomEvent } from "../utils/events.js";
import { safeClosest } from "../utils/dom.js";
import { mountVideoControls } from "./VideoControls.js";
import { createDefaultViewerState } from "../features/viewer/state.js";
import { createViewerLifecycle, destroyMediaProcessorsIn, safeAddListener, safeCall } from "../features/viewer/lifecycle.js";
import { createViewerToolbar } from "../features/viewer/toolbar.js";
import { installViewerKeyboard } from "../features/viewer/keyboard.js";
import { installFollowerVideoSync } from "../features/viewer/videoSync.js";
import { createViewerGrid } from "../features/viewer/grid.js";
import { installViewerProbe } from "../features/viewer/probe.js";
import { createViewerLoupe } from "../features/viewer/loupe.js";
import { renderABCompareView } from "../features/viewer/abCompare.js";
import { renderSideBySideView } from "../features/viewer/sideBySide.js";
import { createViewerMetadataHydrator } from "../features/viewer/metadata.js";
import { createViewerPanZoom } from "../features/viewer/panzoom.js";
import { createViewerMediaFactory } from "../features/viewer/mediaFactory.js";
import { drawScopesLight } from "../features/viewer/scopes.js";
import { ensureViewerMetadataAsset, buildViewerMetadataBlocks } from "../features/viewer/genInfo.js";
import { createIconButton } from "./buttons.js";

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
    // mjr-assets-manager class allows access to theme variables (colors, fonts)
    overlay.className = "mjr-viewer-overlay mjr-assets-manager";
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
        box-sizing: border-box;
    `;
    // Ensure the overlay can receive focus so keyboard shortcuts work reliably.
    // (We still install a capture listener on `window` to beat ComfyUI global handlers.)
    overlay.tabIndex = -1;
    overlay.setAttribute("role", "dialog");

    const lifecycle = createViewerLifecycle(overlay);
    const lifecycleUnsubs = lifecycle.unsubs || [];

    const state = createDefaultViewerState();
    state.mode = VIEWER_MODES.SINGLE;

    let panzoom = null;
    let mediaFactory = null;

    function mediaTransform() {
        try {
            return panzoom?.mediaTransform?.() || "";
        } catch {
            return "";
        }
    }

    function clampPanToBounds() {
        try {
            panzoom?.clampPanToBounds?.();
        } catch {}
    }

    function applyTransform() {
        try {
            panzoom?.applyTransform?.();
        } catch {}
    }

    function setZoom(next, opts) {
        try {
            panzoom?.setZoom?.(next, opts);
        } catch {}
    }

    function updatePanCursor() {
        try {
            panzoom?.updatePanCursor?.();
        } catch {}
    }

    function getPrimaryMedia() {
        try {
            return panzoom?.getPrimaryMedia?.() || null;
        } catch {
            return null;
        }
    }

    function getMediaNaturalSize(mediaEl) {
        try {
            return panzoom?.getMediaNaturalSize?.(mediaEl) || { w: 0, h: 0 };
        } catch {
            return { w: 0, h: 0 };
        }
    }

    function getViewportRect() {
        try {
            return panzoom?.getViewportRect?.() || null;
        } catch {
            return null;
        }
    }

    function computeOneToOneZoom() {
        try {
            return panzoom?.computeOneToOneZoom?.() ?? null;
        } catch {
            return null;
        }
    }

    function updateMediaNaturalSize() {
        try {
            panzoom?.updateMediaNaturalSize?.();
        } catch {}
    }

    function attachMediaLoadHandlers(mediaEl) {
        try {
            panzoom?.attachMediaLoadHandlers?.(mediaEl, { clampPanToBounds, applyTransform });
        } catch {}
    }

    function createMediaElement(asset, url) {
        try {
            return mediaFactory?.createMediaElement?.(asset, url) || document.createElement("div");
        } catch {
            return document.createElement("div");
        }
    }

    function createCompareMediaElement(asset, url) {
        try {
            return mediaFactory?.createCompareMediaElement?.(asset, url) || document.createElement("div");
        } catch {
            return document.createElement("div");
        }
    }

    let toolbar = null;
    // Late-bound close handler: default to "soft close" until API exists, then upgrade close button to full dispose.
    let _requestCloseFromButton = () => closeViewer();

    // Header (toolbar)
    let header = document.createElement("div");
    header.className = "mjr-viewer-header";
    header.style.cssText = `
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px 20px;
        background: var(--mjr-surface-0, rgba(0, 0, 0, 0.8));
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        color: white;
        box-sizing: border-box;
    `;
    let filename = document.createElement("span");
    filename.className = "mjr-viewer-filename";
    filename.style.cssText =
        "font-size: 14px; font-weight: 500; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;";
    let badgesBar = document.createElement("div");
    badgesBar.className = "mjr-viewer-badges";
    badgesBar.style.cssText = "display:flex; gap:8px; align-items:center; flex-wrap:wrap;";
    let filenameRight = null;
    let badgesBarRight = null;
    let rightMeta = null;
    try {
        header.appendChild(filename);
        header.appendChild(badgesBar);
    } catch {}

    try {
        toolbar = createViewerToolbar({
            VIEWER_MODES,
            state,
            lifecycle,
            getCanAB: () => canAB(),
            onToggleFullscreen: () => {
                try {
                    if (!document.fullscreenElement) {
                        try {
                            overlay.requestFullscreen();
                        } catch {}
                    } else {
                        try {
                            document.exitFullscreen();
                        } catch {}
                    }
                } catch {}
            },
            // Close button should fully tear down the viewer (remove overlay + listeners) to avoid leaks/ghost UI.
            onClose: () => _requestCloseFromButton?.(),
            onMode: (mode) => {
                try {
                    if (mode === VIEWER_MODES.AB_COMPARE && !canAB()) return;
                    if (mode === VIEWER_MODES.SIDE_BY_SIDE && !canSide()) return;
                    state.mode = mode;
                    updateUI();
                    try {
                        toolbar?.syncToolsUIFromState?.();
                    } catch {}
                } catch {}
            },
            onZoomIn: () => {
                try {
                    setZoom((Number(state.zoom) || 1) + 0.25, { clientX: state._lastPointerX, clientY: state._lastPointerY });
                } catch {}
            },
            onZoomOut: () => {
                try {
                    setZoom((Number(state.zoom) || 1) - 0.25, { clientX: state._lastPointerX, clientY: state._lastPointerY });
                } catch {}
            },
            onZoomReset: () => {
                try {
                    setZoom(1);
                } catch {}
            },
            onZoomOneToOne: () => {
                try {
                    const tryApply = () => {
                        const z = computeOneToOneZoom();
                        if (z == null) return false;
                        const near = Math.abs((Number(state.zoom) || 1) - z) < 0.01;
                        setZoom(near ? 1 : z, { clientX: state._lastPointerX, clientY: state._lastPointerY });
                        return true;
                    };

                    // Sometimes processors haven't set canvas natural size yet; retry once after a frame.
                    if (tryApply()) return;
                    try {
                        requestAnimationFrame(() => {
                            try {
                                updateMediaNaturalSize();
                            } catch {}
                            try {
                                tryApply();
                            } catch {}
                        });
                    } catch {}
                } catch {}
            },
            onCompareModeChanged: () => {
                try {
                    if (state.mode === VIEWER_MODES.AB_COMPARE) {
                        renderAsset();
                        // Rebind the player bar to the newly created video elements (wipe/difference re-renders AB view).
                        syncPlayerBar();
                    }
                } catch {}
            },
            onExportFrame: () => {
                try {
                    void exportCurrentFrame({ toClipboard: false });
                } catch {}
            },
            onCopyFrame: () => {
                try {
                    void exportCurrentFrame({ toClipboard: true });
                } catch {}
            },
            onToolsChanged: () => {
                try {
                    toolbar?.syncToolsUIFromState?.();
                } catch {}
                try {
                    if (state.mode === VIEWER_MODES.AB_COMPARE) {
                        const m = String(state.abCompareMode || "wipe");
                        if (m !== "wipe" && m !== "wipeV") {
                            abView?._mjrDiffRequest?.();
                        }
                    }
                } catch {}
                try {
                    if (!state.probeEnabled) probeTooltip.style.display = "none";
                } catch {}
                try {
                    if (!state.loupeEnabled) loupeWrap.style.display = "none";
                } catch {}
                try {
                    scheduleOverlayRedraw();
                } catch {}
                try {
                    scheduleApplyGrade?.();
                } catch {}
                try {
                    void renderGenInfoPanel();
                } catch {}
            },
        });
        if (toolbar?.headerEl) header = toolbar.headerEl;
        if (toolbar?.filenameEl) filename = toolbar.filenameEl;
        if (toolbar?.badgesBarEl) badgesBar = toolbar.badgesBarEl;
        if (toolbar?.filenameRightEl) filenameRight = toolbar.filenameRightEl;
        if (toolbar?.badgesBarRightEl) badgesBarRight = toolbar.badgesBarRightEl;
        if (toolbar?.rightMetaEl) rightMeta = toolbar.rightMetaEl;
    } catch {}

    // Content area (stage + optional right sidebar)
    const contentRow = document.createElement("div");
    contentRow.className = "mjr-viewer-content-row";
    contentRow.style.cssText = `
        flex: 1;
        display: flex;
        min-height: 0;
        overflow: hidden;
    `;

    const content = document.createElement("div");
    content.className = "mjr-viewer-content";
    content.style.cssText = `
        flex: 1;
        min-width: 0;
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

    // Overlay layer (grid + probe + loupe). Rendered above media, pointer-events disabled to avoid
    // interfering with pan/zoom gestures.
    const overlayLayer = document.createElement("div");
    overlayLayer.className = "mjr-viewer-overlay-layer";
    overlayLayer.style.cssText = `
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 50;
    `;

    const gridCanvas = document.createElement("canvas");
    gridCanvas.className = "mjr-viewer-grid-canvas";
    gridCanvas.style.cssText = `
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        display: none;
    `;

    const probeTooltip = document.createElement("div");
    probeTooltip.className = "mjr-viewer-probe";
    probeTooltip.style.cssText = `
        position: absolute;
        display: none;
        padding: 6px 8px;
        border-radius: 6px;
        background: rgba(0, 0, 0, 0.8);
        border: 1px solid rgba(255, 255, 255, 0.14);
        color: rgba(255, 255, 255, 0.92);
        font-size: 11px;
        line-height: 1.2;
        white-space: pre;
        max-width: 280px;
        transform: translate3d(0,0,0);
    `;

    const loupeWrap = document.createElement("div");
    loupeWrap.className = "mjr-viewer-loupe";
    loupeWrap.style.cssText = `
        position: absolute;
        display: none;
        width: 120px;
        height: 120px;
        border-radius: 8px;
        overflow: hidden;
        border: 1px solid rgba(255,255,255,0.16);
        box-shadow: 0 8px 18px rgba(0,0,0,0.45);
        background: rgba(0,0,0,0.65);
        transform: translate3d(0,0,0);
    `;

    const loupeCanvas = document.createElement("canvas");
    loupeCanvas.width = 120;
    loupeCanvas.height = 120;
    loupeCanvas.style.cssText = "width:100%; height:100%; display:block; image-rendering: pixelated;";
    loupeWrap.appendChild(loupeCanvas);

    overlayLayer.appendChild(gridCanvas);
    overlayLayer.appendChild(probeTooltip);
    overlayLayer.appendChild(loupeWrap);
    content.appendChild(overlayLayer);

    // Sidebar: generation info (Right).
    const genInfoOverlay = document.createElement("div");
    genInfoOverlay.className = "mjr-viewer-geninfo mjr-viewer-geninfo--right";
    genInfoOverlay.style.cssText = `
        position: absolute;
        top: 0;
        right: 0;
        bottom: 0;
        width: min(420px, 48vw);
        display: none;
        flex-direction: column;
        overflow: hidden;
        background: rgba(0, 0, 0, 0.88);
        border-left: 1px solid rgba(255,255,255,0.12);
        pointer-events: auto;
        backdrop-filter: blur(10px);
        z-index: 10001;
    `;
    const genInfoHeader = document.createElement("div");
    genInfoHeader.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 10px 12px;
        border-bottom: 1px solid rgba(255,255,255,0.10);
        color: rgba(255,255,255,0.92);
    `;
    const genInfoTitle = document.createElement("div");
    genInfoTitle.textContent = "Generation Info";
    genInfoTitle.style.cssText = "font-size: 13px; font-weight: 600;";
    genInfoHeader.appendChild(genInfoTitle);
    const genInfoBody = document.createElement("div");
    genInfoBody.style.cssText = `
        flex: 1;
        overflow: auto;
        padding: 12px;
        color: rgba(255,255,255,0.92);
    `;
    genInfoOverlay.appendChild(genInfoHeader);
    genInfoOverlay.appendChild(genInfoBody);

    // Sidebar: generation info (Left).
    const genInfoOverlayLeft = document.createElement("div");
    genInfoOverlayLeft.className = "mjr-viewer-geninfo mjr-viewer-geninfo--left";
    genInfoOverlayLeft.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        bottom: 0;
        width: min(420px, 48vw);
        display: none;
        flex-direction: column;
        overflow: hidden;
        background: rgba(0, 0, 0, 0.88);
        border-right: 1px solid rgba(255,255,255,0.12);
        pointer-events: auto;
        backdrop-filter: blur(10px);
        z-index: 10001;
    `;
    const genInfoHeaderLeft = genInfoHeader.cloneNode(true); // Shallow clone structure
    genInfoHeaderLeft.innerHTML = ""; // Clear content
    const genInfoTitleLeft = document.createElement("div");
    genInfoTitleLeft.textContent = "Generation Info (A)";
    genInfoTitleLeft.style.cssText = "font-size: 13px; font-weight: 600;";
    genInfoHeaderLeft.appendChild(genInfoTitleLeft);
    const genInfoBodyLeft = document.createElement("div");
    genInfoBodyLeft.style.cssText = `
        flex: 1;
        overflow: auto;
        padding: 12px;
        color: rgba(255,255,255,0.92);
    `;
    genInfoOverlayLeft.appendChild(genInfoHeaderLeft);
    genInfoOverlayLeft.appendChild(genInfoBodyLeft);

    // Mount the row (stage)
    try {
        contentRow.appendChild(content);
    } catch {}

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

    const navBar = document.createElement("div");
    navBar.className = "mjr-viewer-nav";
    navBar.style.cssText = "display:flex; align-items:center; gap:20px;";

    navBar.appendChild(prevBtn);
    navBar.appendChild(indexInfo);
    navBar.appendChild(nextBtn);

    const playerBarHost = document.createElement("div");
    playerBarHost.className = "mjr-viewer-playerbar";
    playerBarHost.style.cssText = "display:none; width: 100%;";

    footer.appendChild(navBar);
    footer.appendChild(playerBarHost);

    overlay.appendChild(header);
    overlay.appendChild(contentRow);
    overlay.appendChild(footer);
    overlay.appendChild(genInfoOverlay);
    overlay.appendChild(genInfoOverlayLeft);

    // Light Dismiss: Close on background click (smart drag detection)
    try {
        let _ptrDown = null;
        // Capture pointerdown to track start pos, even if children stop propagation
        overlay.addEventListener("pointerdown", (e) => {
            if (e.isPrimary === false) return;
            _ptrDown = { x: e.clientX, y: e.clientY, t: Date.now() };
        }, { capture: true, passive: true });

        overlay.addEventListener("click", (e) => {
            try {
                if (e.defaultPrevented || e.button !== 0) return;

                // Drag/Selection check
                if (_ptrDown) {
                    const dx = e.clientX - _ptrDown.x;
                    const dy = e.clientY - _ptrDown.y;
                    const dist = Math.hypot(dx, dy);
                    // If moved more than 6px or held longer than 600ms (selection/drag), ignore.
                    if (dist > 6 || (Date.now() - _ptrDown.t > 600)) return;
                }

                const t = e.target;
                if (safeClosest(t, ".mjr-viewer-header") ||
                    safeClosest(t, ".mjr-viewer-footer") ||
                    safeClosest(t, ".mjr-viewer-geninfo") ||
                    safeClosest(t, ".mjr-video-controls") ||
                    safeClosest(t, ".mjr-context-menu") ||
                    safeClosest(t, ".mjr-ab-slider") ||
                    safeClosest(t, ".mjr-viewer-loupe") ||
                    safeClosest(t, ".mjr-viewer-probe") ||
                    safeClosest(t, ".mjr-viewer-media") ||
                    (t && (t.tagName === "IMG" || t.tagName === "VIDEO" || t.tagName === "CANVAS"))) {
                    return;
                }
                _requestCloseFromButton();
            } catch {}
        });
    } catch {}

    const metadataHydrator = createViewerMetadataHydrator({
        state,
        VIEWER_MODES,
        APP_CONFIG,
        getAssetMetadata,
        getAssetsBatch,
    });
    const _viewerInfoCache = new Map();

    const hydrateVisibleMetadata = async () => {
        try {
            await metadataHydrator?.hydrateVisibleMetadata?.();
        } catch {}
    };

    try {
        panzoom = createViewerPanZoom({
            overlay,
            content,
            singleView,
            abView,
            sideView,
            state,
            VIEWER_MODES,
            scheduleOverlayRedraw,
            lifecycle,
        });
    } catch {
        panzoom = null;
    }

    const clearCanvas = (ctx, w, h) => {
        try {
            ctx.clearRect(0, 0, w, h);
        } catch {}
    };

    // Overlay drawing (grid + probe + loupe)
    let _overlayRAF = null;
    function scheduleOverlayRedraw(immediate) {
        try {
            if (overlay.style.display === "none") return;
            if (immediate === true) {
                if (_overlayRAF != null) {
                    cancelAnimationFrame(_overlayRAF);
                    _overlayRAF = null;
                }
                try {
                    redrawOverlays();
                } catch {}
                return;
            }
            if (_overlayRAF != null) return;
            _overlayRAF = requestAnimationFrame(() => {
                _overlayRAF = null;
                try {
                    redrawOverlays();
                } catch {}
            });
        } catch {}
    }

    const getOverlayMedia = () => {
        try {
            if (state?.mode === VIEWER_MODES.SINGLE) {
                return singleView?.querySelector?.(".mjr-viewer-media") || null;
            }
            if (state?.mode === VIEWER_MODES.AB_COMPARE) {
                return abView?.querySelector?.(".mjr-viewer-media") || null;
            }
            if (state?.mode === VIEWER_MODES.SIDE_BY_SIDE) {
                return sideView?.querySelector?.(".mjr-viewer-media") || null;
            }
        } catch {}
        return null;
    };

    const grid = createViewerGrid({
        gridCanvas,
        content,
        state,
        VIEWER_MODES,
        getPrimaryMedia: getOverlayMedia,
        getViewportRect,
        clearCanvas,
    });

    const redrawOverlays = () => {
        const hasPanHint = (() => {
            try {
                const at = Number(state?._panHintAt) || 0;
                return at > 0 && Date.now() - at < 900;
            } catch {
                return false;
            }
        })();
        try {
            const showHud = state?.mode === VIEWER_MODES.SINGLE && Boolean(state?.hudEnabled);
            const showScopes = String(state?.scopesMode || "off") !== "off";
            const showMask = Boolean(state?.overlayMaskEnabled);
            gridCanvas.style.display =
                state.gridMode === 0 && !showMask && !hasPanHint && !showHud && !showScopes ? "none" : "";
        } catch {}

        const size = grid.ensureCanvasSize();
        if (!(size.w > 0 && size.h > 0)) return;
        const wantGridOrMask = (() => {
            const showHud = state?.mode === VIEWER_MODES.SINGLE && Boolean(state?.hudEnabled);
            return (Number(state.gridMode) || 0) !== 0 || Boolean(state?.overlayMaskEnabled) || showHud;
        })();
        if (wantGridOrMask) {
            grid.redrawGrid(size);
        } else {
            try {
                const ctx = gridCanvas.getContext("2d");
                if (ctx) clearCanvas(ctx, size.w, size.h);
            } catch {}
        }

        if (hasPanHint) {
            try {
                const ctx = gridCanvas.getContext("2d");
                if (ctx) {
                    const rect = content?.getBoundingClientRect?.();
                    const x0 = Number(state?._panHintX);
                    const y0 = Number(state?._panHintY);
                    const x = rect && Number.isFinite(x0) ? x0 - rect.left : size.w / 2;
                    const y = rect && Number.isFinite(y0) ? y0 - rect.top : size.h * 0.78;
                    const pad = 10;
                    const tx = Math.max(pad, Math.min(size.w - pad, x));
                    const ty = Math.max(pad, Math.min(size.h - pad, y));
                    ctx.save();
                    ctx.font = "12px var(--comfy-font, ui-sans-serif, system-ui)";
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    const msg = "Zoom in to pan";
                    const metrics = ctx.measureText(msg);
                    const w = Math.min(size.w - 2 * pad, Math.max(140, metrics.width + 26));
                    const h = 26;
                    ctx.fillStyle = "rgba(0,0,0,0.65)";
                    ctx.strokeStyle = "rgba(255,255,255,0.18)";
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    const rx = tx - w / 2;
                    const ry = ty - h / 2;
                    const r = 10;
                    ctx.moveTo(rx + r, ry);
                    ctx.arcTo(rx + w, ry, rx + w, ry + h, r);
                    ctx.arcTo(rx + w, ry + h, rx, ry + h, r);
                    ctx.arcTo(rx, ry + h, rx, ry, r);
                    ctx.arcTo(rx, ry, rx + w, ry, r);
                    ctx.closePath();
                    ctx.fill();
                    ctx.stroke();
                    ctx.fillStyle = "rgba(255,255,255,0.92)";
                    ctx.fillText(msg, tx, ty);
                    ctx.restore();
                }
            } catch {}
        }

        // HUD: bbox + image WxH label (drawn in `grid.js`). No filename overlay here.

        // Scopes (optional): RGB histogram + luma waveform (downscaled, best-effort).
        try {
            const scopesMode = String(state?.scopesMode || "off");
            if (scopesMode !== "off") {
                const ctx = gridCanvas.getContext("2d");
                if (ctx) {
                    let root = singleView;
                    if (state?.mode === VIEWER_MODES.AB_COMPARE) root = abView;
                    else if (state?.mode === VIEWER_MODES.SIDE_BY_SIDE) root = sideView;
                    const any = root?.querySelector?.("canvas.mjr-viewer-media") || overlay?.querySelector?.("canvas.mjr-viewer-media");
                    if (any && any instanceof HTMLCanvasElement) {
                        drawScopesLight(ctx, { w: size.w, h: size.h }, any, { mode: scopesMode, channel: state?.channel });
                    }
                }
            }
        } catch {}

        if (state.mode !== VIEWER_MODES.SINGLE) {
            try {
                probeTooltip.style.display = "none";
            } catch {}
            try {
                loupeWrap.style.display = "none";
            } catch {}
        }
    };

    // ----------------------------------------------------------------------------
    // Generation Info side panel (prompt/model/etc)
    // ----------------------------------------------------------------------------

    const stopGenInfoFetch = () => {
        try {
            state._genInfoAbort?.abort?.();
        } catch {}
        state._genInfoAbort = null;
        try {
            state._genInfoReqId = (Number(state._genInfoReqId) || 0) + 1;
        } catch {}
    };

    const ensureGenInfoAsset = async (asset, { signal } = {}) => {
        try {
            return await ensureViewerMetadataAsset(asset, {
                getAssetMetadata,
                getFileMetadata,
                getFileMetadataScoped,
                metadataCache: metadataHydrator,
                signal,
            });
        } catch {
            return asset;
        }
    };

    const shouldShowGenInfoLoading = (asset) => {
        try {
            if (!asset || typeof asset !== "object") return false;
            if (asset?.geninfo || asset?.prompt || asset?.workflow || asset?.metadata) return false;
            const mime = String(asset?.mime || asset?.mimetype || asset?.type || "").toLowerCase();
            if (mime.startsWith("video/")) return true;
            const p = String(asset?.filepath || asset?.path || asset?.filename || asset?.name || "").toLowerCase();
            const ext = p.split(".").pop() || "";
            if (["mp4", "webm", "mov", "mkv", "avi", "m4v", "gif"].includes(ext)) return true;
            // If we have nothing at all, show a loading hint while hydration runs.
            return true;
        } catch {
            return false;
        }
    };

    const renderGenInfoPanel = async () => {
        const canAB = state.assets.length === 2;
        const canSide = state.assets.length >= 2;
        const mode = state.mode;
        const open = Boolean(state?.genInfoOpen);

        // Determine if we should show split panels
        const isDual = open && (
            (mode === VIEWER_MODES.AB_COMPARE && canAB) ||
            (mode === VIEWER_MODES.SIDE_BY_SIDE && canSide)
        );

        try {
            genInfoOverlay.style.display = open ? "flex" : "none";
            genInfoOverlayLeft.style.display = isDual ? "flex" : "none";
            // Reserve space so the viewer shrinks.
            overlay.style.paddingRight = open ? "min(420px, 48vw)" : "0px";
            overlay.style.paddingLeft = isDual ? "min(420px, 48vw)" : "0px";

            if (!open) {
                stopGenInfoFetch();
                try { genInfoBody.innerHTML = ""; } catch {}
                try { genInfoBodyLeft.innerHTML = ""; } catch {}
                return;
            }
        } catch {
            return;
        }

        stopGenInfoFetch();
        const reqId = (Number(state?._genInfoReqId) || 0) + 1;
        try { state._genInfoReqId = reqId; } catch {}
        const ac = new AbortController();
        state._genInfoAbort = ac;

        const renderNow = ({ left, right, single }) => {
            try { genInfoBody.innerHTML = ""; } catch {}
            try { genInfoBodyLeft.innerHTML = ""; } catch {}

            const onRetry = () => {
                try {
                    if (!state?.genInfoOpen) state.genInfoOpen = true;
                    void renderGenInfoPanel();
                } catch {}
            };

            const addBlockTo = (targetBody, title, assetObj, loading) => {
                if (!targetBody) return;
                try {
                    try {
                        targetBody.appendChild(
                            buildViewerMetadataBlocks({
                                title,
                                asset: assetObj,
                                ui: { loading: Boolean(loading), onRetry },
                            })
                        );
                        return;
                    } catch {}
                    
                    // Fallback manual rendering
                    const block = document.createElement("div");
                    block.style.cssText = "display:flex; flex-direction:column; gap:10px; margin-bottom: 14px;";
                    
                    if (title) {
                        const h = document.createElement("div");
                        h.textContent = title;
                        h.style.cssText = "font-size: 12px; font-weight: 600; letter-spacing: 0.02em; color: rgba(255,255,255,0.86);";
                        block.appendChild(h);
                    }

                    const section = (() => {
                        try { return createGenerationSection(assetObj); } catch { return null; }
                    })();
                    if (section) {
                        block.appendChild(section);
                    } else {
                        const empty = document.createElement("div");
                        empty.style.cssText = "padding: 10px 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.72);";
                        empty.textContent = "No generation data found for this file.";
                        block.appendChild(empty);
                    }
                    
                    try {
                        const raw = assetObj?.metadata_raw;
                        if (raw != null) {
                            const details = document.createElement("details");
                            details.style.cssText = "border: 1px solid rgba(255,255,255,0.10); border-radius: 10px; background: rgba(255,255,255,0.04); overflow: hidden;";
                            const summary = document.createElement("summary");
                            summary.textContent = "Raw metadata";
                            summary.style.cssText = "cursor: pointer; padding: 10px 12px; color: rgba(255,255,255,0.78); user-select: none;";
                            const pre = document.createElement("pre");
                            pre.style.cssText = "margin:0; padding: 10px 12px; max-height: 280px; overflow:auto; font-size: 11px; line-height: 1.35; color: rgba(255,255,255,0.86);";
                            let txt = "";
                            try {
                                if (typeof raw === "string") txt = raw;
                                else txt = JSON.stringify(raw, null, 2);
                            } catch {
                                txt = String(raw);
                            }
                            if (txt.length > 40_000) txt = `${txt.slice(0, 40_000)}\n…(truncated)…`;
                            pre.textContent = txt;
                            details.appendChild(summary);
                            details.appendChild(pre);
                            block.appendChild(details);
                        }
                    } catch {}
                    targetBody.appendChild(block);
                } catch {}
            };

            if (isDual) {
                 if (left) {
                     genInfoTitleLeft.textContent = left.title || "Asset A";
                     addBlockTo(genInfoBodyLeft, "", left.asset, left.loading);
                 }
                 if (right) {
                     genInfoTitle.textContent = right.title || "Asset B";
                     addBlockTo(genInfoBody, "", right.asset, right.loading);
                 }
            } else {
                 // Single mode
                 if (single) {
                     genInfoTitle.textContent = single.title || "Generation Info";
                     addBlockTo(genInfoBody, "", single.asset, single.loading);
                 }
            }
        };

        // Resolve assets and perform initial render
        try {
            const current = state?.assets?.[state?.currentIndex] || null;
            if (!current) {
                renderNow({});
                return;
            }

            let assetLeft = null;
            let assetRight = null;
            let assetSingle = null;

            if (isDual) {
                // Determine A and B
                if (mode === VIEWER_MODES.SIDE_BY_SIDE) {
                    // Fixed order: Left=[0], Right=[1] 
                    // (Assuming 2 items for text comparison logic, or just first two)
                    assetLeft = state.assets[0];
                    assetRight = state.assets[1];
                } else {
                    // AB_COMPARE: Swappable roles (Current vs Other)
                    assetLeft = current;
                    const other = state?.compareAsset || 
                        (state.assets.length === 2 ? state.assets[1 - state.currentIndex] : null);
                    assetRight = other;
                }
            } else {
                assetSingle = current;
            }

            // Initial render (cache)
            const getCached = (a) => a ? (metadataHydrator?.getCached?.(a.id)?.data || a) : null;
            
            renderNow({
                left: isDual ? {
                    title: "Asset A",
                    asset: getCached(assetLeft),
                    loading: shouldShowGenInfoLoading(getCached(assetLeft))
                } : null,
                right: isDual ? {
                    title: "Asset B",
                    asset: getCached(assetRight),
                    loading: shouldShowGenInfoLoading(getCached(assetRight))
                } : null,
                single: !isDual ? {
                    title: "Generation Info",
                    asset: getCached(assetSingle),
                    loading: shouldShowGenInfoLoading(getCached(assetSingle))
                } : null
            });

            // Hydrate logic
            if (state._genInfoReqId !== reqId) return;
            
            if (isDual) {
                const lFull = assetLeft ? await ensureGenInfoAsset(assetLeft, { signal: ac.signal }) : null;
                const rFull = assetRight ? await ensureGenInfoAsset(assetRight, { signal: ac.signal }) : null;
                if (state._genInfoReqId !== reqId) return;
                
                renderNow({
                    left: {
                        title: "Asset A",
                        asset: lFull,
                        loading: false
                    },
                    right: {
                         title: "Asset B",
                         asset: rFull,
                         loading: false
                    }
                });
            } else {
                const sFull = assetSingle ? await ensureGenInfoAsset(assetSingle, { signal: ac.signal }) : null;
                if (state._genInfoReqId !== reqId) return;
                
                renderNow({
                    single: {
                        title: "Generation Info",
                        asset: sFull,
                        loading: false
                    }
                });
            }

        } catch {}
    };

    // No close button in panel (toggle via toolbar / shortcut).

    // ----------------------------------------------------------------------------
    // Export frame (PNG download + clipboard copy)
    // ----------------------------------------------------------------------------

    const _getExportSourceCanvas = () => {
        try {
            if (state?.mode === VIEWER_MODES.SINGLE) {
                const c = singleView?.querySelector?.("canvas.mjr-viewer-media");
                return c instanceof HTMLCanvasElement ? c : null;
            }
            if (state?.mode === VIEWER_MODES.AB_COMPARE) {
                const m = String(state?.abCompareMode || "wipe");
                if (m === "wipe" || m === "wipeV") {
                    const a = abView?.querySelector?.('canvas.mjr-viewer-media[data-mjr-compare-role="A"]');
                    const b = abView?.querySelector?.('canvas.mjr-viewer-media[data-mjr-compare-role="B"]');
                    if (a instanceof HTMLCanvasElement && b instanceof HTMLCanvasElement) return { a, b, mode: m };
                }
                const d = abView?.querySelector?.('canvas.mjr-viewer-media[data-mjr-compare-role="D"]');
                if (d instanceof HTMLCanvasElement) return d;
                const any = abView?.querySelector?.("canvas.mjr-viewer-media");
                return any instanceof HTMLCanvasElement ? any : null;
            }
            if (state?.mode === VIEWER_MODES.SIDE_BY_SIDE) {
                const any = sideView?.querySelector?.("canvas.mjr-viewer-media");
                return any instanceof HTMLCanvasElement ? any : null;
            }
            return null;
        } catch {
            return null;
        }
    };

    const _canvasToBlob = (canvas, mime = "image/png", quality = 0.92) =>
        new Promise((resolve) => {
            try {
                if (canvas?.toBlob) {
                    canvas.toBlob((b) => resolve(b), mime, quality);
                    return;
                }
            } catch {}
            try {
                const dataUrl = canvas?.toDataURL?.(mime, quality);
                if (!dataUrl || typeof dataUrl !== "string") return resolve(null);
                const parts = dataUrl.split(",");
                const b64 = parts[1] || "";
                const bin = atob(b64);
                const arr = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
                resolve(new Blob([arr], { type: mime }));
            } catch {
                resolve(null);
            }
        });

    async function exportCurrentFrame({ toClipboard = false } = {}) {
        try {
            const src = _getExportSourceCanvas();
            if (!src) return false;

            let canvas = null;
            if (src instanceof HTMLCanvasElement) {
                canvas = src;
            } else if (src?.a && src?.b) {
                const a = src.a;
                const b = src.b;
                const w = Math.max(1, Math.min(Number(a.width) || 0, Number(b.width) || 0));
                const h = Math.max(1, Math.min(Number(a.height) || 0, Number(b.height) || 0));
                if (!(w > 1 && h > 1)) return false;
                const out = document.createElement("canvas");
                out.width = w;
                out.height = h;
                const ctx = out.getContext("2d");
                if (!ctx) return false;
                try {
                    ctx.drawImage(b, 0, 0, w, h);
                } catch {}
                const p = Math.max(0, Math.min(100, Number(state?._abWipePercent) || 50)) / 100;
                try {
                    ctx.save();
                    ctx.beginPath();
                    if (src.mode === "wipeV") {
                        ctx.rect(0, 0, w, h * p);
                    } else {
                        ctx.rect(0, 0, w * p, h);
                    }
                    ctx.clip();
                    ctx.drawImage(a, 0, 0, w, h);
                    ctx.restore();
                } catch {}
                canvas = out;
            }

            if (!canvas) return false;
            const blob = await _canvasToBlob(canvas, "image/png");
            if (!blob) return false;

            if (toClipboard) {
                try {
                    const ClipboardItemCtor = globalThis?.ClipboardItem;
                    const clip = navigator?.clipboard;
                    if (!ClipboardItemCtor || !clip?.write) return false;
                    await clip.write([new ClipboardItemCtor({ "image/png": blob })]);
                    return true;
                } catch {
                    return false;
                }
            }

            // Download (best-effort)
            try {
                const current = state?.assets?.[state?.currentIndex] || null;
                const base = String(current?.filename || "frame").replace(/[\\\\/:*?\"<>|]+/g, "_");
                const name = `${base.replace(/\\.[^.]+$/, "") || "frame"}_export.png`;
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = name;
                a.rel = "noopener";
                a.click();
                try {
                    setTimeout(() => URL.revokeObjectURL(url), 2000);
                } catch {}
                return true;
            } catch {
                return false;
            }
        } catch {
            return false;
        }
    }

    // Smooth animation loop using requestAnimationFrame (only when needed)
    // REMOVED: Animation loop (requestAnimationFrame) for performance
    // Direct transform updates only

    const renderBadges = () => {
        const clear = (el) => {
            try {
                if (el) el.innerHTML = "";
            } catch {}
        };
        clear(badgesBar);
        clear(badgesBarRight);

        const makePill = (asset, { showName } = {}) => {
            if (!asset) return null;
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

            const name = document.createElement("span");
            name.textContent = String(asset.filename || "");
            name.style.cssText =
                "max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; opacity:0.95;";

            const extBadge = createFileBadge(asset.filename, asset.kind, !!asset?._mjrNameCollision);
            try {
                extBadge.style.position = "static";
                extBadge.style.top = "";
                extBadge.style.left = "";
                extBadge.style.padding = "2px 6px";
                extBadge.style.fontSize = "10px";
                extBadge.style.borderRadius = "6px";
                extBadge.style.pointerEvents = "none";
            } catch {}

            const stars = createRatingBadge(asset.rating || 0);
            if (stars) {
                try {
                    stars.style.position = "static";
                    stars.style.top = "";
                    stars.style.right = "";
                    stars.style.padding = "2px 6px";
                    stars.style.fontSize = "12px";
                } catch {}
            }

            const tags = createTagsBadge(Array.isArray(asset.tags) ? asset.tags : []);
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
            if (showName) pill.appendChild(name);
            if (stars) pill.appendChild(stars);
            if (tags && tags.style.display !== "none") pill.appendChild(tags);

            try {
                if (asset.filepath) pill.title = String(asset.filepath);
            } catch {}
            return pill;
        };

        const isSingle = state.mode === VIEWER_MODES.SINGLE;
        const isAB = state.mode === VIEWER_MODES.AB_COMPARE && canAB();
        const isSide = state.mode === VIEWER_MODES.SIDE_BY_SIDE && canSide();

        // A/B and Side-by-side: when we have a right badge bar, split per side to keep the header readable.
        if ((isAB || isSide) && badgesBarRight) {
            const a0 = state.assets?.[0] || null;
            const a1 = isAB
                ? state.assets?.[1] || null
                : state.assets?.[Math.max(0, (state.assets?.length || 1) - 1)] || null;
            const leftPill = makePill(a0, { showName: false });
            const rightPill = makePill(a1, { showName: false });
            try {
                if (leftPill) badgesBar.appendChild(leftPill);
            } catch {}
            try {
                if (rightPill) badgesBarRight.appendChild(rightPill);
            } catch {}
            return;
        }

        const items = isSingle
            ? [state.assets[state.currentIndex]].filter(Boolean)
            : Array.isArray(state.assets)
              ? state.assets.slice(0, 4)
              : [];

        for (const a of items) {
            const pill = makePill(a, { showName: !isSingle });
            if (!pill) continue;
            try {
                badgesBar.appendChild(pill);
            } catch {}
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
        const isAB = state.mode === VIEWER_MODES.AB_COMPARE && canAB();
        const isSide = state.mode === VIEWER_MODES.SIDE_BY_SIDE && canSide();
        const leftAsset = isAB || isSide ? state.assets?.[0] || null : current || null;
        const rightAsset = isAB
            ? state.assets?.[1] || null
            : isSide && Array.isArray(state.assets) && state.assets.length >= 2
              ? state.assets[state.assets.length - 1]
              : null;
        try {
            filename.textContent = leftAsset?.filename || "";
        } catch {}
        try {
            if (rightMeta && filenameRight && rightAsset && rightAsset !== leftAsset) {
                rightMeta.style.display = "flex";
                filenameRight.textContent = rightAsset?.filename || "";
            } else if (rightMeta && filenameRight) {
                rightMeta.style.display = "none";
                filenameRight.textContent = "";
            }
        } catch {}
        // Update index
        if (state.mode === VIEWER_MODES.AB_COMPARE && canAB()) {
            indexInfo.textContent = "2 selected";
        } else if (state.mode === VIEWER_MODES.SIDE_BY_SIDE && canSide()) {
            indexInfo.textContent = `${state.assets.length} selected`;
        } else {
            indexInfo.textContent = `${state.currentIndex + 1} / ${state.assets.length}`;
        }

        if (state.mode === VIEWER_MODES.AB_COMPARE && !canAB()) state.mode = VIEWER_MODES.SINGLE;
        if (state.mode === VIEWER_MODES.SIDE_BY_SIDE && !canSide()) state.mode = VIEWER_MODES.SINGLE;
        try {
            toolbar?.syncModeButtons?.({ canAB, canSide });
        } catch {}

        // Show/hide views
        singleView.style.display = state.mode === VIEWER_MODES.SINGLE ? 'flex' : 'none';
        abView.style.display = state.mode === VIEWER_MODES.AB_COMPARE ? 'block' : 'none';
        sideView.style.display = state.mode === VIEWER_MODES.SIDE_BY_SIDE ? 'flex' : 'none';

        // Cleanup hidden views to prevent processor loops and listener buildup.
        try {
            if (state.mode !== VIEWER_MODES.SINGLE) {
                destroyMediaProcessorsIn(singleView);
                singleView.innerHTML = "";
            }
        } catch {}
        try {
            if (state.mode !== VIEWER_MODES.AB_COMPARE) {
                destroyMediaProcessorsIn(abView);
                abView.innerHTML = "";
            }
        } catch {}
        try {
            if (state.mode !== VIEWER_MODES.SIDE_BY_SIDE) {
                destroyMediaProcessorsIn(sideView);
                sideView.innerHTML = "";
            }
        } catch {}

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
        // Mount/unmount the video player bar depending on current media.
        syncPlayerBar();
        try {
            toolbar?.syncToolsUIFromState?.();
        } catch {}
        try {
            scheduleApplyGrade?.();
        } catch {}
        scheduleOverlayRedraw();
        try {
            void renderGenInfoPanel();
        } catch {}

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
            try {
                destroyMediaProcessorsIn(singleView);
            } catch {}
            singleView.innerHTML = '';
            state._mediaW = 0;
            state._mediaH = 0;
            const media = createMediaElement(current, viewUrl);
            singleView.appendChild(media);
        } else if (state.mode === VIEWER_MODES.AB_COMPARE) {
            if (canAB()) {
                renderABCompareView({
                    abView,
                    state,
                    currentAsset: current,
                    viewUrl,
                    buildAssetViewURL,
                    createCompareMediaElement,
                    destroyMediaProcessorsIn,
                });
            }
        } else if (state.mode === VIEWER_MODES.SIDE_BY_SIDE) {
            if (canSide()) {
                renderSideBySideView({
                    sideView,
                    state,
                    currentAsset: current,
                    viewUrl,
                    buildAssetViewURL,
                    createMediaElement,
                    destroyMediaProcessorsIn,
                });
            }
        }
        applyTransform();
        updatePanCursor();
    }

    const destroyPlayerBar = () => {
        try {
            if (state._videoControlsDestroy) state._videoControlsDestroy();
        } catch {}
        state._videoControlsDestroy = null;
        state._videoControlsMounted = null;
        state._activeVideoEl = null;
        try {
            state._videoSyncAbort?.abort?.();
        } catch {}
        state._videoSyncAbort = null;
        try {
            state._videoMetaAbort?.abort?.();
        } catch {}
        state._videoMetaAbort = null;
        try {
            state._scopesVideoAbort?.abort?.();
        } catch {}
        state._scopesVideoAbort = null;
        try {
            playerBarHost.innerHTML = "";
        } catch {}
        try {
            playerBarHost.style.display = "none";
        } catch {}
        try {
            navBar.style.display = "";
        } catch {}
    };

    const syncPlayerBar = () => {
        try {
            const current = state.assets[state.currentIndex];
            if (current?.kind !== "video") {
                destroyPlayerBar();
                return;
            }

            // Keep the player bar visible for video even in compare modes.
            let videoEl = null;
            let allVideos = [];
            try {
                if (state.mode === VIEWER_MODES.SINGLE) {
                    allVideos = Array.from(singleView.querySelectorAll?.(".mjr-viewer-video-src") || []);
                } else if (state.mode === VIEWER_MODES.AB_COMPARE) {
                    allVideos = Array.from(abView.querySelectorAll?.(".mjr-viewer-video-src") || []);
                } else if (state.mode === VIEWER_MODES.SIDE_BY_SIDE) {
                    allVideos = Array.from(sideView.querySelectorAll?.(".mjr-viewer-video-src") || []);
                }
            } catch {
                allVideos = [];
            }
            try {
                // Prefer the "A" role when available (current asset in compare views).
                videoEl = allVideos.find((v) => String(v?.dataset?.mjrCompareRole || "") === "A") || allVideos[0] || null;
            } catch {
                videoEl = allVideos[0] || null;
            }
            if (!videoEl) {
                destroyPlayerBar();
                return;
            }

            // Re-mount only if the underlying video element changed.
            if (state._activeVideoEl && state._activeVideoEl === videoEl && state._videoControlsDestroy) {
                try {
                    navBar.style.display = "none";
                    playerBarHost.style.display = "";
                } catch {}
                return;
            }

            destroyPlayerBar();

            try {
                navBar.style.display = "none";
            } catch {}
            try {
                playerBarHost.style.display = "";
            } catch {}

            // Try to provide initial FPS/frameCount synchronously so the ruler shows correct values immediately.
            let initialFps = undefined;
            let initialFrameCount = undefined;
            try {
                const parseFps = (v) => {
                    const n = Number(v);
                    if (Number.isFinite(n) && n > 0) return n;
                    const s = String(v || "").trim();
                    if (!s) return null;
                    if (s.includes("/")) {
                        const [a, b] = s.split("/");
                        const na = Number(a);
                        const nb = Number(b);
                        if (Number.isFinite(na) && Number.isFinite(nb) && nb !== 0) return na / nb;
                    }
                    const f = Number.parseFloat(s);
                    if (Number.isFinite(f) && f > 0) return f;
                    return null;
                };
                const parseFrameCount = (v) => {
                    const n = Number(v);
                    if (!Number.isFinite(n) || n <= 0) return null;
                    return Math.floor(n);
                };

                const pickFromMeta = (assetMeta) => {
                    try {
                        const raw = assetMeta?.metadata_raw;
                        if (!raw || typeof raw !== "object") return { fps: null, frameCount: null };
                        const ff = raw?.raw_ffprobe || {};
                        const vs = ff?.video_stream || {};
                        const fpsRaw = raw?.fps ?? vs?.avg_frame_rate ?? vs?.r_frame_rate;
                        const fps = parseFps(fpsRaw);
                        const frameCount = parseFrameCount(vs?.nb_frames ?? vs?.nb_read_frames ?? raw?.frame_count ?? raw?.frames);
                        return { fps, frameCount };
                    } catch {
                        return { fps: null, frameCount: null };
                    }
                };

                // Prefer the current in-memory asset payload (search results may already include metadata_raw).
                const fromCurrent = pickFromMeta(current);
                if (fromCurrent.fps != null) initialFps = fromCurrent.fps;
                if (fromCurrent.frameCount != null) initialFrameCount = fromCurrent.frameCount;

                // Fallback to cached full metadata if present.
                if (initialFps == null || initialFrameCount == null) {
                    const cached = metadataHydrator?.getCached?.(current?.id);
                    const fromCache = cached?.data ? pickFromMeta(cached.data) : { fps: null, frameCount: null };
                    if (initialFps == null && fromCache.fps != null) initialFps = fromCache.fps;
                    if (initialFrameCount == null && fromCache.frameCount != null) initialFrameCount = fromCache.frameCount;
                }
            } catch {}

            const mounted = mountVideoControls(videoEl, {
                variant: "viewerbar",
                hostEl: playerBarHost,
                fullscreenEl: overlay,
                initialFps,
                initialFrameCount,
            });
            state._videoControlsMounted = mounted || null;
            state._videoControlsDestroy = mounted?.destroy || null;
            state._activeVideoEl = videoEl;

            // Keep scopes responsive for video: refresh on seek/play/pause/timeupdate and animate while playing.
            try {
                state._scopesVideoAbort?.abort?.();
            } catch {}
            try {
                const ac = new AbortController();
                state._scopesVideoAbort = ac;
                const refresh = () => {
                    try {
                        if (String(state?.scopesMode || "off") === "off") return;
                    } catch {}
                    scheduleOverlayRedraw();
                };
                videoEl.addEventListener("seeked", refresh, { signal: ac.signal, passive: true });
                videoEl.addEventListener("timeupdate", refresh, { signal: ac.signal, passive: true });
                videoEl.addEventListener("loadeddata", refresh, { signal: ac.signal, passive: true });
                videoEl.addEventListener("play", refresh, { signal: ac.signal, passive: true });
                videoEl.addEventListener("pause", refresh, { signal: ac.signal, passive: true });

                const scopesFps = Math.max(1, Math.min(30, Math.floor(Number(APP_CONFIG.VIEWER_SCOPES_FPS) || 10)));
                const interval = 1000 / scopesFps;
                const tick = () => {
                    if (ac.signal.aborted) return;
                    try {
                        if (overlay.style.display === "none") return;
                    } catch {}
                    try {
                        if (String(state?.scopesMode || "off") !== "off" && !videoEl.paused) {
                            const now = performance.now();
                            const last = Number(state?._scopesLastAt) || 0;
                            if (now - last >= interval) {
                                state._scopesLastAt = now;
                                scheduleOverlayRedraw();
                            }
                        }
                    } catch {}
                    try {
                        requestAnimationFrame(tick);
                    } catch {}
                };
                try {
                    requestAnimationFrame(tick);
                } catch {}
            } catch {}

            // If multiple videos are visible (compare modes), keep them synced to the controlled one.
            try {
                state._videoSyncAbort?.abort?.();
            } catch {}
            try {
                if (allVideos.length > 1) {
                    const followers = allVideos.filter((v) => v && v !== videoEl);
                    state._videoSyncAbort = installFollowerVideoSync(videoEl, followers);
                }
            } catch {}

            // Best-effort: use backend viewer-info to set FPS / frame count for the ruler.
            // Must never throw or block the UI.
            try {
                const parseFps = (v) => {
                    const n = Number(v);
                    if (Number.isFinite(n) && n > 0) return n;
                    const s = String(v || "").trim();
                    if (!s) return null;
                    // Fraction forms like "30000/1001"
                    if (s.includes("/")) {
                        const [a, b] = s.split("/");
                        const na = Number(a);
                        const nb = Number(b);
                        if (Number.isFinite(na) && Number.isFinite(nb) && nb !== 0) return na / nb;
                    }
                    const f = Number.parseFloat(s);
                    if (Number.isFinite(f) && f > 0) return f;
                    return null;
                };
                const parseFrameCount = (v) => {
                    const n = Number(v);
                    if (!Number.isFinite(n) || n <= 0) return null;
                    return Math.floor(n);
                };

                const applyFromViewerInfo = (info) => {
                    try {
                        if (!info || typeof info !== "object") return;
                        const fps = parseFps(info?.fps ?? info?.fps_raw);
                        const frameCount = parseFrameCount(info?.frame_count);
                        if (fps != null || frameCount != null) mounted?.setMediaInfo?.({ fps, frameCount });
                    } catch {}
                };

                // Apply cached viewer info immediately if present.
                try {
                    const cached = _viewerInfoCache.get(String(current?.id ?? ""));
                    if (cached) applyFromViewerInfo(cached);
                } catch {}

                // Fetch fresh in background (cancel if asset changes).
                try {
                    state._videoMetaAbort?.abort?.();
                } catch {}
                const ac = new AbortController();
                state._videoMetaAbort = ac;
                void (async () => {
                    try {
                        const res = await getViewerInfo(current?.id, { signal: ac.signal });
                        if (!res?.ok || !res.data) return;
                        // Still the same active video element?
                        if (state._activeVideoEl !== videoEl) return;
                        try {
                            _viewerInfoCache.set(String(current?.id ?? ""), res.data);
                        } catch {}
                        applyFromViewerInfo(res.data);
                    } catch {}
                })();
            } catch {}
        } catch {
            destroyPlayerBar();
        }
    };

    // ----------------------------------------------------------------------------
    // Image processing (Nuke-like): exposure, gamma, channels, false color, zebra
    // ----------------------------------------------------------------------------

    const MAX_PROC_PIXELS = APP_CONFIG.VIEWER_MAX_PROC_PIXELS ?? 12_000_000;

    const getGradeParams = () => ({
        exposureEV: Number(state.exposureEV) || 0,
        gamma: Math.max(0.1, Math.min(3, Number(state.gamma) || 1)),
        channel: state.channel || "rgb",
        analysisMode: state.analysisMode || "none",
        zebraThreshold: Math.max(0, Math.min(1, Number(state.zebraThreshold) || 0.95)),
    });

    const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));

    const applyGradeToVisibleMedia = () => {
        const params = getGradeParams();
        try {
            const els = overlay.querySelectorAll(".mjr-viewer-media");
            for (const el of els) {
                try {
                    const proc = el?._mjrProc;
                    if (proc?.setParams) proc.setParams(params);
                } catch {}
            }
        } catch {}
        // If A/B compare is showing a computed diff canvas, force a refresh after grade changes.
        try {
            if (state?.mode === VIEWER_MODES.AB_COMPARE) {
                abView?._mjrDiffRequest?.();
            }
        } catch {}
    };

    const isDefaultGrade = (params) => {
        try {
            if (!params) return true;
            const exposureEV = Number(params.exposureEV) || 0;
            const gamma = Number(params.gamma) || 1;
            const channel = String(params.channel || "rgb");
            const analysisMode = String(params.analysisMode || "none");
            return (
                Math.abs(exposureEV) < 0.0001 &&
                Math.abs(gamma - 1) < 0.0001 &&
                channel === "rgb" &&
                analysisMode === "none"
            );
        } catch {
            return true;
        }
    };

    const MAX_PROC_PIXELS_VIDEO = APP_CONFIG.VIEWER_MAX_PROC_PIXELS_VIDEO ?? 3_000_000;
    const VIDEO_GRADE_THROTTLE_FPS = APP_CONFIG.VIEWER_VIDEO_GRADE_THROTTLE_FPS ?? 15;

    try {
        mediaFactory = createViewerMediaFactory({
            overlay,
            state,
            mediaTransform,
            updateMediaNaturalSize,
            clampPanToBounds,
            applyTransform,
            scheduleOverlayRedraw,
            getGradeParams,
            isDefaultGrade,
            tonemap: null,
            maxProcPixels: MAX_PROC_PIXELS,
            maxProcPixelsVideo: MAX_PROC_PIXELS_VIDEO,
            disableWebGL: !!APP_CONFIG.VIEWER_DISABLE_WEBGL_VIDEO,
            videoGradeThrottleFps: VIDEO_GRADE_THROTTLE_FPS,
            safeAddListener,
            safeCall,
        });
    } catch {
        mediaFactory = null;
    }

    // Navigation
    lifecycleUnsubs.push(
        safeAddListener(prevBtn, "click", () => {
            if (state.currentIndex > 0) {
                state.currentIndex--;
                updateUI();
            }
        })
    );

    lifecycleUnsubs.push(
        safeAddListener(nextBtn, "click", () => {
            if (state.currentIndex < state.assets.length - 1) {
                state.currentIndex++;
                updateUI();
            }
        })
    );

    // Nuke-like processing controls (images only): channel/exposure/gamma/analysis.
    let _gradeRAF = null;
    const scheduleApplyGrade = () => {
        try {
            if (_gradeRAF != null) return;
            _gradeRAF = requestAnimationFrame(() => {
                _gradeRAF = null;
                try {
                    applyGradeToVisibleMedia();
                } catch {}
            });
        } catch {}
    };

    const syncToolsUIFromState = () => {
        try {
            toolbar?.syncToolsUIFromState?.();
        } catch {}
    };

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

    // Pixel probe + loupe sampling (Radiance-inspired).

    const positionOverlayBox = (el, clientX, clientY, { offsetX = 16, offsetY = 16 } = {}) => {
        try {
            const v = getViewportRect();
            if (!v) return;
            const vp = content.getBoundingClientRect();
            const x0 = (Number(clientX) || 0) - vp.left;
            const y0 = (Number(clientY) || 0) - vp.top;
            const w = Number(el.offsetWidth) || 0;
            const h = Number(el.offsetHeight) || 0;
            let x = x0 + offsetX;
            let y = y0 + offsetY;
            const pad = 10;
            x = Math.max(pad, Math.min(x, v.width - w - pad));
            y = Math.max(pad, Math.min(y, v.height - h - pad));
            el.style.left = `${Math.round(x)}px`;
            el.style.top = `${Math.round(y)}px`;
        } catch {}
    };

    const loupe = createViewerLoupe({
        state,
        loupeCanvas,
        loupeWrap,
        getMediaNaturalSize,
        positionOverlayBox,
    });

    const probe = installViewerProbe({
        overlay,
        content,
        state,
        VIEWER_MODES,
        getPrimaryMedia,
        getMediaNaturalSize,
        getViewportRect,
        positionOverlayBox,
        probeTooltip,
        loupeWrap,
        onLoupeRedraw: loupe.redraw,
        lifecycle,
    });

    // Resize observer so grid canvas stays crisp and overlays remain aligned.
    try {
        if (!content._mjrOverlayResizeBound && "ResizeObserver" in window) {
            try {
                overlay._mjrResizeObserver?.disconnect?.();
            } catch {}
            const ro = new ResizeObserver(() => {
                try {
                    state._viewportCache = null;
                } catch {}
                scheduleOverlayRedraw();
            });
            try {
                ro.observe(content);
            } catch {}
            overlay._mjrResizeObserver = ro;
            lifecycleUnsubs.push(() => {
                try {
                    ro.disconnect();
                } catch {}
            });
            content._mjrOverlayResizeBound = true;
        }
    } catch {}

    // Keyboard shortcuts (installed on capture phase to avoid ComfyUI/global handlers eating events).
    const keyboard = installViewerKeyboard({
        overlay,
        content,
        singleView,
        state,
        VIEWER_MODES,
        computeOneToOneZoom,
        setZoom,
        scheduleOverlayRedraw,
        scheduleApplyGrade,
        syncToolsUIFromState,
        navigateViewerAssets,
        closeViewer,
        renderBadges,
        updateAssetRating,
        safeDispatchCustomEvent,
        ASSET_RATING_CHANGED_EVENT,
        probeTooltip,
        loupeWrap,
        renderGenInfoPanel,
        getVideoControls: () => {
            try {
                return state?._videoControlsMounted || null;
            } catch {
                return null;
            }
        },
        lifecycle,
    });

    // Bind/unbind global listeners only while the viewer is visible.
    // Prevents hotkeys/scroll from leaking to ComfyUI/browser when the viewer is closed.
    let _openUnsubs = [];
    const disposeOpenListeners = () => {
        try {
            for (const u of _openUnsubs) safeCall(u);
        } catch {}
        _openUnsubs = [];
        try {
            keyboard?.unbind?.();
        } catch {}
    };
    const bindOpenListeners = () => {
        disposeOpenListeners();
        try {
            _openUnsubs.push(
                safeAddListener(overlay, "click", (e) => {
                    try {
                        if (e.target !== overlay) return;
                    } catch {}
                    closeViewer();
                })
            );
        } catch {}
        try {
            _openUnsubs.push(safeAddListener(content, "wheel", onWheelZoom, { passive: false, capture: true }));
        } catch {}
        try {
            _openUnsubs.push(
                safeAddListener(
                    content,
                    "mousemove",
                    (e) => {
                        try {
                            state._lastPointerX = e.clientX;
                            state._lastPointerY = e.clientY;
                        } catch {}
                    },
                    { passive: true, capture: true }
                )
            );
        } catch {}
        try {
            keyboard?.bind?.();
        } catch {}
    };

    // Keep viewer badges in sync when tags/ratings change elsewhere (sidebar, panel hotkeys, etc.).
    try {
        if (!overlay._mjrBadgeSyncBound) {
            const onRatingSync = (e) => {
                try {
                    const id = e?.detail?.assetId;
                    const rating = e?.detail?.rating;
                    if (id == null) return;
                    for (const a of state.assets || []) {
                        if (a?.id != null && String(a.id) === String(id)) {
                            a.rating = rating;
                        }
                    }
                    try {
                        metadataHydrator?.deleteCached?.(id);
                    } catch {}
                    renderBadges();
                } catch {}
            };
            const onTagsSync = (e) => {
                try {
                    const id = e?.detail?.assetId;
                    const tags = e?.detail?.tags;
                    if (id == null) return;
                    for (const a of state.assets || []) {
                        if (a?.id != null && String(a.id) === String(id)) {
                            a.tags = tags;
                        }
                    }
                    try {
                        metadataHydrator?.deleteCached?.(id);
                    } catch {}
                    renderBadges();
                } catch {}
            };
            lifecycleUnsubs.push(safeAddListener(window, ASSET_RATING_CHANGED_EVENT, onRatingSync, { passive: true }));
            lifecycleUnsubs.push(safeAddListener(window, ASSET_TAGS_CHANGED_EVENT, onTagsSync, { passive: true }));
            overlay._mjrBadgeSyncBound = true;
        }
    } catch {}

    function closeViewer() {
        try {
            metadataHydrator?.abort?.();
        } catch {}
        try {
            destroyPlayerBar();
        } catch {}
        try {
            state._scopesVideoAbort?.abort?.();
        } catch {}
        state._scopesVideoAbort = null;
        // Clear any pending hint timers (avoid callbacks after close/dispose).
        try {
            if (state._panHintTimer) clearTimeout(state._panHintTimer);
        } catch {}
        state._panHintTimer = null;
        try {
            state._panHintAt = 0;
        } catch {}

        // Abort compare-mode background work (sync listeners, diff loops).
        try {
            abView?._mjrSyncAbort?.abort?.();
        } catch {}
        try {
            abView?._mjrDiffAbort?.abort?.();
        } catch {}
        try {
            abView._mjrSyncAbort = null;
        } catch {}
        try {
            abView._mjrDiffAbort = null;
        } catch {}
        try {
            sideView?._mjrSyncAbort?.abort?.();
        } catch {}
        try {
            sideView._mjrSyncAbort = null;
        } catch {}
        try {
            abView?._mjrSliderAbort?.abort?.();
        } catch {}
        try {
            abView._mjrSliderAbort = null;
        } catch {}
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
            destroyMediaProcessorsIn(singleView);
            singleView.innerHTML = "";
        } catch {}
        try {
            destroyMediaProcessorsIn(abView);
            abView.innerHTML = "";
        } catch {}
        try {
            destroyMediaProcessorsIn(sideView);
            sideView.innerHTML = "";
        } catch {}

        try {
            state.genInfoOpen = false;
        } catch {}
        try {
            stopGenInfoFetch();
        } catch {}
        try {
            genInfoOverlay.style.display = "none";
            genInfoBody.innerHTML = "";
        } catch {}
        try {
            genInfoOverlayLeft.style.display = "none";
            genInfoBodyLeft.innerHTML = "";
        } catch {}

        overlay.style.display = 'none';
        disposeOpenListeners();
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
            bindOpenListeners();
            state.assets = Array.isArray(assets) ? assets : [assets];
            state.currentIndex = Math.max(0, Math.min(startIndex, state.assets.length - 1));
            state.zoom = 1;
            state.panX = 0;
            state.panY = 0;
            state.targetZoom = 1;
            state._userInteracted = false;
            state._panHintAt = 0;
            try {
                if (state._panHintTimer) clearTimeout(state._panHintTimer);
            } catch {}
            state._panHintTimer = null;
            state._lastPointerX = null;
            state._lastPointerY = null;
            state._mediaW = 0;
            state._mediaH = 0;
            state.compareAsset = compareAsset;
            state.gridMode = 0;
            state.genInfoOpen = true;
            stopGenInfoFetch();
            state._probe = null;
            try {
                probeTooltip.style.display = "none";
            } catch {}
            try {
                loupeWrap.style.display = "none";
            } catch {}

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
            try {
                syncToolsUIFromState();
            } catch {}
            try {
                scheduleApplyGrade();
            } catch {}
            scheduleOverlayRedraw();
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
            // Best-effort: never throw to UI.
            try {
                closeViewer();
            } catch {}

            try {
                destroyMediaProcessorsIn(singleView);
            } catch {}
            try {
                destroyMediaProcessorsIn(abView);
            } catch {}
            try {
                destroyMediaProcessorsIn(sideView);
            } catch {}

            try {
                if (_overlayRAF != null) cancelAnimationFrame(_overlayRAF);
            } catch {}
            try {
                if (_gradeRAF != null) cancelAnimationFrame(_gradeRAF);
            } catch {}
            try {
                probe?.dispose?.();
            } catch {}
            try {
                keyboard?.dispose?.();
            } catch {}

            try {
                overlay._mjrResizeObserver?.disconnect?.();
            } catch {}
            try {
                overlay._mjrResizeObserver = null;
            } catch {}
            try {
                metadataHydrator?.dispose?.();
            } catch {}

            try {
                for (const u of overlay._mjrViewerUnsubs || []) safeCall(u);
            } catch {}
            try {
                overlay._mjrViewerUnsubs = [];
            } catch {}

            try {
                overlay.remove?.();
            } catch {}
        }
    };

    // Upgrade the toolbar close button to a full dispose once API is available.
    try {
        _requestCloseFromButton = () => api.dispose();
    } catch {}

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
 * Helper to create icon button
 */


/**
 * Get or create global viewer instance
 */
export function getViewerInstance() {
    const all = Array.from(document.querySelectorAll?.(".mjr-viewer-overlay") || []);
    if (all.length) {
        const keep = all[all.length - 1];
        for (const el of all) {
            if (el === keep) continue;
            try {
                el?._mjrViewerAPI?.dispose?.();
            } catch {}
            try {
                el.remove?.();
            } catch {}
        }
        if (keep && keep._mjrViewerAPI) return keep._mjrViewerAPI;
        try {
            keep?.remove?.();
        } catch {}
    }

    const viewer = createViewer();
    document.body.appendChild(viewer);
    return viewer._mjrViewerAPI;
}
