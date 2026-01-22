import { APP_CONFIG } from "../../app/config.js";

export function createViewerPanZoom({
    overlay,
    content,
    singleView,
    abView,
    sideView,
    state,
    VIEWER_MODES,
    scheduleOverlayRedraw,
    lifecycle,
} = {}) {
    const safeCall = lifecycle?.safeCall || ((fn) => {
        try {
            return fn?.();
        } catch {
            return undefined;
        }
    });
    const safeAddListener = lifecycle?.safeAddListener || ((target, event, handler, options) => {
        try {
            target?.addEventListener?.(event, handler, options);
            return () => {
                try {
                    target?.removeEventListener?.(event, handler, options);
                } catch {}
            };
        } catch {
            return () => {};
        }
    });

    const unsubs = lifecycle?.unsubs || [];

    const getPrimaryMedia = () => {
        try {
            if (state?.mode !== VIEWER_MODES?.SINGLE) return null;
            return singleView?.querySelector?.(".mjr-viewer-media") || null;
        } catch {
            return null;
        }
    };

    const getMediaNaturalSize = (mediaEl) => {
        try {
            if (!mediaEl) return { w: 0, h: 0 };
            if (mediaEl.tagName === "IMG") {
                return { w: Number(mediaEl.naturalWidth) || 0, h: Number(mediaEl.naturalHeight) || 0 };
            }
            if (mediaEl.tagName === "VIDEO") {
                return { w: Number(mediaEl.videoWidth) || 0, h: Number(mediaEl.videoHeight) || 0 };
            }
            if (mediaEl.tagName === "CANVAS") {
                const w = Number(mediaEl._mjrNaturalW) || Number(mediaEl.width) || 0;
                const h = Number(mediaEl._mjrNaturalH) || Number(mediaEl.height) || 0;
                return { w, h };
            }
        } catch {}
        return { w: 0, h: 0 };
    };

    const getViewportRect = () => {
        try {
            const rect = content?.getBoundingClientRect?.();
            return rect && rect.width > 0 && rect.height > 0 ? rect : null;
        } catch {
            return null;
        }
    };

    const updateMediaNaturalSize = () => {
        try {
            let root = singleView;
            if (state?.mode === VIEWER_MODES?.AB_COMPARE) root = abView;
            else if (state?.mode === VIEWER_MODES?.SIDE_BY_SIDE) root = sideView;
            const el = root?.querySelector?.(".mjr-viewer-media");
            if (!el) return;
            const { w, h } = getMediaNaturalSize(el);
            if (w > 0 && h > 0) {
                state._mediaW = w;
                state._mediaH = h;
            }
        } catch {}
    };

    const attachMediaLoadHandlers = (mediaEl, { clampPanToBounds, applyTransform } = {}) => {
        if (!mediaEl || mediaEl._mjrMediaSizeBound) return;
        mediaEl._mjrMediaSizeBound = true;
        const sync = () => {
            updateMediaNaturalSize();
            try {
                clampPanToBounds?.();
            } catch {}
            try {
                applyTransform?.();
            } catch {}
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
            if (!overlay || overlay.style.display === "none") return;

            const MIN_ZOOM = 0.1;
            const MAX_ZOOM = 16;
            const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number(state?.zoom) || 1));
            if (!(zoom > 1.001)) {
                state.panX = 0;
                state.panY = 0;
                return;
            }

            const current = state?.assets?.[state?.currentIndex];
            let aw = Number(current?.width) || 0;
            let ah = Number(current?.height) || 0;
            if (!(aw > 0 && ah > 0)) {
                updateMediaNaturalSize();
                aw = Number(state?._mediaW) || 0;
                ah = Number(state?._mediaH) || 0;
            }
            if (!(aw > 0 && ah > 0)) return;
            const aspect = aw / ah;
            if (!Number.isFinite(aspect) || aspect <= 0) return;

            const getViewportSize = () => {
                const now = Date.now();
                try {
                    const cached = state?._viewportCache;
                    if (cached && cached.mode === state?.mode && now - (cached.at || 0) < 250) {
                        const w = Number(cached.w) || 0;
                        const h = Number(cached.h) || 0;
                        if (w > 0 && h > 0) return { w, h };
                    }
                } catch {}

                const fallbackW = Math.max(Number(content?.clientWidth) || 0, Number(overlay?.clientWidth) || 0);
                const fallbackH = Math.max(Number(content?.clientHeight) || 0, Number(overlay?.clientHeight) || 0);
                const clampToFallback = (w, h) => ({
                    w: Math.max(Number(w) || 0, fallbackW),
                    h: Math.max(Number(h) || 0, fallbackH),
                });

                let res = null;
                if (state?.mode === VIEWER_MODES?.SINGLE) {
                    res = clampToFallback(singleView?.clientWidth, singleView?.clientHeight);
                } else if (state?.mode === VIEWER_MODES?.AB_COMPARE) {
                    res = clampToFallback(abView?.clientWidth, abView?.clientHeight);
                } else {
                    const children = Array.from(sideView?.children || []).filter((el) => el && el.nodeType === 1);
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
                            res = clampToFallback(minW, minH);
                        }
                    }
                    if (!res) res = clampToFallback(sideView?.clientWidth, sideView?.clientHeight);
                }

                try {
                    state._viewportCache = { mode: state?.mode, w: res.w, h: res.h, at: now };
                } catch {}
                return res;
            };

            const { w: vw, h: vh } = getViewportSize();
            if (!(vw > 0 && vh > 0)) {
                if (overlay?.style?.display !== "none") {
                    requestAnimationFrame(clampPanToBounds);
                }
                return;
            }

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
            const maxPanX = (Math.max(overflowVH, overflowImageW, overscrollW) / 2) * zoom;
            const maxPanY = (Math.max(overflowVV, overflowImageH, overscrollH) / 2) * zoom;

            state.panX = Math.max(-maxPanX, Math.min(maxPanX, Number(state?.panX) || 0));
            state.panY = Math.max(-maxPanY, Math.min(maxPanY, Number(state?.panY) || 0));
        } catch {}
    };

    const mediaTransform = () => {
        const zoom = Math.max(0.1, Math.min(16, Number(state?.zoom) || 1));
        const x = Number(state?.panX) || 0;
        const y = Number(state?.panY) || 0;
        const nx = x / zoom;
        const ny = y / zoom;
        return `translate3d(${nx}px, ${ny}px, 0) scale(${zoom})`;
    };

    const updatePanCursor = () => {
        try {
            if (!content) return;
            if (!overlay || overlay.style.display === "none") {
                content.style.cursor = "";
                return;
            }
            const zoomed = (Number(state?.zoom) || 1) > 1.01;
            if (!zoomed) {
                content.style.cursor = "";
                return;
            }
            content.style.cursor = "grab";
        } catch {}
    };

    const applyTransform = () => {
        try {
            clampPanToBounds();
            const t = mediaTransform();
            const els = overlay?.querySelectorAll?.(".mjr-viewer-media") || [];
            for (const el of els) {
                try {
                    el.style.transform = t;
                } catch {}
            }
            try {
                scheduleOverlayRedraw?.();
            } catch {}
        } catch {}
    };

    const setZoom = (next, { clientX = null, clientY = null } = {}) => {
        try {
            const MIN_ZOOM = 0.1;
            const MAX_ZOOM = 16;
            const prevZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number(state?.zoom) || 1));
            const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number(next) || prevZoom));
            try {
                state._userInteracted = true;
            } catch {}

            let newPanX = Number(state?.panX) || 0;
            let newPanY = Number(state?.panY) || 0;

            const hasPointer = clientX != null && clientY != null && Number.isFinite(Number(clientX)) && Number.isFinite(Number(clientY));
            if (hasPointer) {
                try {
                    const rect = content?.getBoundingClientRect?.();
                    if (rect && rect.width > 0 && rect.height > 0) {
                        const cx = rect.left + rect.width / 2;
                        const cy = rect.top + rect.height / 2;
                        const uX = (Number(clientX) || 0) - cx;
                        const uY = (Number(clientY) || 0) - cy;
                        const r = nextZoom / prevZoom;
                        newPanX = Math.round(((Number(state?.panX) || 0) * r + (1 - r) * uX) * 10) / 10;
                        newPanY = Math.round(((Number(state?.panY) || 0) * r + (1 - r) * uY) * 10) / 10;
                    }
                } catch {}
            } else if (nextZoom !== prevZoom) {
                const r = nextZoom / prevZoom;
                newPanX = Math.round(((Number(state?.panX) || 0) * r) * 10) / 10;
                newPanY = Math.round(((Number(state?.panY) || 0) * r) * 10) / 10;
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
            applyTransform();
            updatePanCursor();
        } catch {}
    };

    const computeContainBaseSize = (aw, ah, vw, vh) => {
        try {
            const w = Number(aw) || 0;
            const h = Number(ah) || 0;
            const Vw = Number(vw) || 0;
            const Vh = Number(vh) || 0;
            if (!(w > 0 && h > 0 && Vw > 0 && Vh > 0)) return { w: 0, h: 0 };
            const aspect = w / h;
            const viewportAspect = Vw / Vh;
            if (!Number.isFinite(aspect) || !Number.isFinite(viewportAspect) || aspect <= 0 || viewportAspect <= 0) {
                return { w: 0, h: 0 };
            }
            if (aspect >= viewportAspect) {
                return { w: Vw, h: Vw / aspect };
            }
            return { w: Vh * aspect, h: Vh };
        } catch {
            return { w: 0, h: 0 };
        }
    };

    const computeOneToOneZoom = () => {
        try {
            const mediaEl = getPrimaryMedia();
            if (!mediaEl) return null;
            const { w: aw, h: ah } = getMediaNaturalSize(mediaEl);
            if (!(aw > 0 && ah > 0)) return null;
            const viewport = getViewportRect();
            if (!viewport) return null;
            const base = computeContainBaseSize(aw, ah, viewport.width, viewport.height);
            if (!(base.w > 0 && base.h > 0)) return null;
            const z = aw / base.w;
            if (!Number.isFinite(z) || z <= 0) return null;
            return Math.max(0.1, Math.min(16, z));
        } catch {
            return null;
        }
    };

    // Pan (middle-mouse-like click+drag) when zoomed in.
    const pan = { active: false, pointerId: null, startX: 0, startY: 0, startPanX: 0, startPanY: 0 };

    const onPanPointerDown = (e) => {
        if (!overlay || overlay.style.display === "none") return;
        const zoom = Number(state?.zoom) || 1;
        const allowAt1 = (() => {
            try {
                return Boolean(APP_CONFIG?.VIEWER_ALLOW_PAN_AT_ZOOM_1);
            } catch {
                return false;
            }
        })();
        if (!(zoom > 1.01) && !allowAt1) {
            try {
                state._panHintAt = Date.now();
                state._panHintX = e?.clientX ?? null;
                state._panHintY = e?.clientY ?? null;
            } catch {}
            try {
                if (state._panHintTimer) clearTimeout(state._panHintTimer);
            } catch {}
            try {
                state._panHintTimer = setTimeout(() => {
                    try {
                        state._panHintAt = 0;
                    } catch {}
                    safeCall(scheduleOverlayRedraw);
                }, 950);
            } catch {}
            safeCall(scheduleOverlayRedraw);
            return;
        }
        const isLeft = e.button === 0;
        const isMiddle = e.button === 1;
        if (!isLeft && !isMiddle) return;
        try {
            const t = e.target;
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
        } catch {}
        // Do not start panning when interacting with viewer controls (player bar, buttons, seek handles, menus).
        try {
            if (e?.target?.closest?.(".mjr-video-controls")) return;
            if (e?.target?.closest?.(".mjr-context-menu")) return;
        } catch {}
        try {
            if (!content?.contains?.(e.target)) return;
        } catch {
            return;
        }

        pan.active = true;
        try {
            state._userInteracted = true;
        } catch {}
        pan.pointerId = e.pointerId;
        try {
            state._lastPointerX = e.clientX;
            state._lastPointerY = e.clientY;
        } catch {}
        pan.startX = e.clientX;
        pan.startY = e.clientY;
        pan.startPanX = Number(state?.panX) || 0;
        pan.startPanY = Number(state?.panY) || 0;
        try {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation?.();
        } catch {}
        try {
            content?.setPointerCapture?.(e.pointerId);
        } catch {}
        try {
            if (content) content.style.cursor = "grabbing";
        } catch {}
    };

    const onPanPointerMove = (e) => {
        if (!pan.active) return;
        // If the user started interacting with video controls, never treat it as a pan gesture.
        try {
            if (e?.target?.closest?.(".mjr-video-controls")) return;
        } catch {}
        try {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation?.();
        } catch {}
        const dx = (Number(e.clientX) || 0) - pan.startX;
        const dy = (Number(e.clientY) || 0) - pan.startY;
        const zoom = Math.max(0.1, Math.min(16, Number(state?.zoom) || 1));
        const panMultiplier = Math.max(1, zoom);
        state.panX = pan.startPanX + dx * panMultiplier;
        state.panY = pan.startPanY + dy * panMultiplier;
        try {
            state._lastPointerX = e.clientX;
            state._lastPointerY = e.clientY;
        } catch {}
        applyTransform();
        updatePanCursor();
    };

    const onPanPointerUp = (e) => {
        if (!pan.active) return;
        pan.active = false;
        pan.pointerId = null;
        try {
            content?.releasePointerCapture?.(e.pointerId);
        } catch {}
        updatePanCursor();
    };

    const onDblClickReset = (e) => {
        if (!overlay || overlay.style.display === "none") return;
        try {
            if (!content?.contains?.(e.target)) return;
        } catch {}
        try {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation?.();
        } catch {}
        const isNearFit = Math.abs((Number(state?.targetZoom) || 1) - 1) < 0.01;
        if (isNearFit) {
            setZoom(Math.min(8, (Number(state?.targetZoom) || 1) * 4), { clientX: e.clientX, clientY: e.clientY });
        } else {
            setZoom(1, { clientX: e.clientX, clientY: e.clientY });
        }
    };

    try {
        if (content && !content._mjrPanBound) {
            unsubs.push(safeAddListener(content, "pointerdown", onPanPointerDown, { passive: false, capture: true }));
            unsubs.push(safeAddListener(content, "pointermove", onPanPointerMove, { passive: false, capture: true }));
            unsubs.push(safeAddListener(content, "pointerup", onPanPointerUp, { passive: true, capture: true }));
            unsubs.push(safeAddListener(content, "pointercancel", onPanPointerUp, { passive: true, capture: true }));
            content._mjrPanBound = true;
        }
    } catch {}

    try {
        if (content && !content._mjrDblClickResetBound) {
            unsubs.push(safeAddListener(content, "dblclick", onDblClickReset, { passive: false, capture: true }));
            content._mjrDblClickResetBound = true;
        }
    } catch {}

    return {
        getPrimaryMedia,
        getMediaNaturalSize,
        getViewportRect,
        updateMediaNaturalSize,
        attachMediaLoadHandlers,
        clampPanToBounds,
        mediaTransform,
        applyTransform,
        setZoom,
        computeOneToOneZoom,
        updatePanCursor,
        dispose: () => {
            safeCall(() => {
                pan.active = false;
                pan.pointerId = null;
            });
        },
    };
}
