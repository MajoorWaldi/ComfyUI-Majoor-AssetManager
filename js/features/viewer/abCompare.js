export function renderABCompareView({
    abView,
    state,
    currentAsset,
    viewUrl,
    buildAssetViewURL,
    createCompareMediaElement,
    destroyMediaProcessorsIn,
} = {}) {
    const PERCENT_MIN = 0;
    const PERCENT_MAX = 100;
    const DEFAULT_WIPE_PERCENT = 50;
    const SLIDER_BAR_WIDTH_PX = 1;
    const SLIDER_Z_INDEX = 10;
    const SLIDER_HIT_AREA_PX = 40;

    try {
        destroyMediaProcessorsIn?.(abView);
    } catch {}
    try {
        if (abView) abView.innerHTML = "";
    } catch {}
    try {
        abView?._mjrSyncAbort?.abort?.();
    } catch {}
    try {
        abView?._mjrDiffAbort?.abort?.();
    } catch {}
    try {
        abView?._mjrSliderAbort?.abort?.();
    } catch {}
    try {
        abView._mjrDiffRequest = null;
    } catch {}
    try {
        abView._mjrSliderAbort = null;
    } catch {}

    if (!abView || !state || !currentAsset) return;

    const mode = (() => {
        try {
            const m = String(state.abCompareMode || "wipe");
            return m === "wipeH" ? "wipe" : m;
        } catch {
            return "wipe";
        }
    })();

    const isWipe = mode === "wipe" || mode === "wipeV";
    const wipeAxis = mode === "wipeV" ? "y" : "x"; // x = left/right, y = top/bottom

    const other =
        state.compareAsset ||
        (Array.isArray(state.assets) && state.assets.length === 2 ? state.assets[1 - (state.currentIndex || 0)] : null) ||
        currentAsset;
    const compareUrl = (() => {
        try {
            return buildAssetViewURL?.(other);
        } catch {
            return "";
        }
    })();

    // Base layer (B)
    const baseLayer = document.createElement("div");
    baseLayer.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
    `;
    const baseMedia = createCompareMediaElement?.(other, compareUrl);
    if (baseMedia) baseLayer.appendChild(baseMedia);
    try {
        const baseVideo = baseMedia?.querySelector?.(".mjr-viewer-video-src") || baseMedia?.querySelector?.("video");
        if (baseVideo?.dataset) baseVideo.dataset.mjrCompareRole = "B";
        const baseAudio = baseMedia?.querySelector?.(".mjr-viewer-audio-src") || baseMedia?.querySelector?.("audio");
        if (baseAudio?.dataset) baseAudio.dataset.mjrCompareRole = "B";
    } catch {}
    try {
        const baseCanvas = baseMedia?.querySelector?.("canvas.mjr-viewer-media") || (baseMedia instanceof HTMLCanvasElement ? baseMedia : null);
        if (baseCanvas?.dataset) baseCanvas.dataset.mjrCompareRole = "B";
    } catch {}

    // Top layer (A) with slider
    const topLayer = document.createElement("div");
    topLayer.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
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
        try {
            const clamped = Math.max(PERCENT_MIN, Math.min(PERCENT_MAX, Number(percent) || 0));
            if (supportsClipPath) {
                const value =
                    wipeAxis === "y"
                        ? `inset(0 0 ${PERCENT_MAX - clamped}% 0)`
                        : `inset(0 ${PERCENT_MAX - clamped}% 0 0)`;
                topLayer.style.clipPath = value;
                topLayer.style.webkitClipPath = value;
                return;
            }
            const rect = abView.getBoundingClientRect();
            const w = rect.width || 1;
            const h = rect.height || 1;
            if (wipeAxis === "y") {
                const py = Math.round((h * clamped) / PERCENT_MAX);
                topLayer.style.clip = `rect(0px, ${w}px, ${py}px, 0px)`;
            } else {
                const px = Math.round((w * clamped) / PERCENT_MAX);
                topLayer.style.clip = `rect(0px, ${px}px, ${h}px, 0px)`;
            }
        } catch {}
    };

    const initialWipePercent = (() => {
        if (!isWipe) return 100;
        try {
            const v = Number(state._abWipePercent);
            if (Number.isFinite(v) && v >= PERCENT_MIN && v <= PERCENT_MAX) return v;
        } catch {}
        return DEFAULT_WIPE_PERCENT;
    })();
    setClipPercent(initialWipePercent);
    try {
        if (isWipe) state._abWipePercent = initialWipePercent;
    } catch {}
    const topMedia = createCompareMediaElement?.(currentAsset, viewUrl);
    if (topMedia) topLayer.appendChild(topMedia);
    try {
        const topVideo = topMedia?.querySelector?.(".mjr-viewer-video-src") || topMedia?.querySelector?.("video");
        if (topVideo?.dataset) topVideo.dataset.mjrCompareRole = "A";
        const topAudio = topMedia?.querySelector?.(".mjr-viewer-audio-src") || topMedia?.querySelector?.("audio");
        if (topAudio?.dataset) topAudio.dataset.mjrCompareRole = "A";
    } catch {}
    try {
        const topCanvas = topMedia?.querySelector?.("canvas.mjr-viewer-media") || (topMedia instanceof HTMLCanvasElement ? topMedia : null);
        if (topCanvas?.dataset) topCanvas.dataset.mjrCompareRole = "A";
    } catch {}

    // Slider container (Invisible hit area around the visible line)
    const slider = document.createElement("div");
    slider.className = "mjr-ab-slider";
    slider.style.cssText = `
        position: absolute;
        z-index: ${SLIDER_Z_INDEX};
        touch-action: none;
        user-select: none;
    `;

    // Visual Line (the only visible element - handle is invisible)
    const line = document.createElement("div");
    line.style.cssText = `
        position: absolute;
        background: white;
        pointer-events: none;
        box-shadow: 0 0 4px rgba(0,0,0,0.5);
    `;
    slider.appendChild(line);

    // Video sync is handled centrally by the viewer bar (Viewer.js) so we avoid double-sync here.

    const isCompositeMode = (m) => m === "multiply" || m === "screen" || m === "add";

    // Compare display mode
    try {
        if (!isWipe) {
            // Use a real math difference (canvas composite) instead of CSS mix-blend-mode,
            // which can be inconsistent depending on browser/compositing.
            setClipPercent(100);
            slider.style.display = "none";

            try {
                topLayer.style.opacity = "0";
                baseLayer.style.opacity = "0";
                topLayer.style.pointerEvents = "none";
                baseLayer.style.pointerEvents = "none";
            } catch {}

            const diffLayer = document.createElement("div");
            diffLayer.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                overflow: hidden;
                display: flex;
                align-items: center;
                justify-content: center;
            `;

            const diffCanvas = document.createElement("canvas");
            diffCanvas.className = "mjr-viewer-media";
            try {
                diffCanvas.dataset.mjrCompareRole = "D";
            } catch {}
            diffCanvas.style.cssText = `
                max-width: 100%;
                max-height: 100%;
                display: block;
            `;
            diffLayer.appendChild(diffCanvas);

            const getSrcCanvas = (media) => {
                try {
                    if (!media) return null;
                    if (media instanceof HTMLCanvasElement) return media;
                    return media.querySelector?.("canvas.mjr-viewer-media") || media.querySelector?.("canvas") || null;
                } catch {
                    return null;
                }
            };

            const aCanvas = getSrcCanvas(topMedia);
            const bCanvas = getSrcCanvas(baseMedia);

            const ctx = (() => {
                try {
                    return diffCanvas.getContext("2d", { willReadFrequently: true });
                } catch {
                    return null;
                }
            })();

            const syncSize = () => {
                try {
                    const aw = aCanvas?.width || 0;
                    const ah = aCanvas?.height || 0;
                    const bw = bCanvas?.width || 0;
                    const bh = bCanvas?.height || 0;
                    const w = Math.max(1, Math.min(aw || bw, bw || aw));
                    const h = Math.max(1, Math.min(ah || bh, bh || ah));
                    if (diffCanvas.width !== w) diffCanvas.width = w;
                    if (diffCanvas.height !== h) diffCanvas.height = h;
                    return { w, h };
                } catch {
                    return { w: 0, h: 0 };
                }
            };

            const drawDiffOnce = () => {
                if (!ctx) return false;
                const { w, h } = syncSize();
                if (!(w > 1 && h > 1)) return false;
                try {
                    ctx.save();
                } catch {}
                try {
                    ctx.clearRect(0, 0, w, h);
                } catch {}

                const px = w * h;
                const isVideo = !!(topMedia?.querySelector?.("video") || baseMedia?.querySelector?.("video"));

                const doComposite = (op) => {
                    try {
                        ctx.globalCompositeOperation = "copy";
                        ctx.drawImage(bCanvas, 0, 0, w, h);
                        ctx.globalCompositeOperation = op;
                        ctx.drawImage(aCanvas, 0, 0, w, h);
                        ctx.globalCompositeOperation = "source-over";
                        return true;
                    } catch {
                        return false;
                    }
                };

                const doSubtract = () => {
                    // Subtract is not supported by Canvas2D composite ops; do CPU math for small images.
                    // For video or very large frames, degrade to difference for stability/perf.
                    if (isVideo) return doComposite("difference");
                    if (!(px > 0 && px <= 750_000)) return doComposite("difference");
                    try {
                        const aImg = ctx.getImageData(0, 0, w, h);
                        ctx.clearRect(0, 0, w, h);
                        ctx.globalCompositeOperation = "copy";
                        ctx.drawImage(bCanvas, 0, 0, w, h);
                        const bImg = ctx.getImageData(0, 0, w, h);
                        const da = aImg.data;
                        const db = bImg.data;
                        for (let i = 0; i < db.length; i += 4) {
                            db[i] = Math.max(0, (db[i] || 0) - (da[i] || 0));
                            db[i + 1] = Math.max(0, (db[i + 1] || 0) - (da[i + 1] || 0));
                            db[i + 2] = Math.max(0, (db[i + 2] || 0) - (da[i + 2] || 0));
                            db[i + 3] = 255;
                        }
                        ctx.putImageData(bImg, 0, 0);
                        ctx.globalCompositeOperation = "source-over";
                        return true;
                    } catch {
                        return doComposite("difference");
                    }
                };

                if (isCompositeMode(mode)) {
                    if (mode === "add") return doComposite("lighter");
                    return doComposite(mode);
                }

                if (mode === "subtract") {
                    return doSubtract();
                }

                // Default math modes: difference / absdiff
                const ok = doComposite("difference");
                if (!ok) return false;

                // Boost visibility for subtle changes (bounded; skip when too large).
                if (mode === "difference") {
                    try {
                        if (px > 0 && px <= 1_000_000) {
                            const img = ctx.getImageData(0, 0, w, h);
                            const d = img.data;
                            const gain = 4;
                            for (let i = 0; i < d.length; i += 4) {
                                d[i] = Math.min(255, (d[i] || 0) * gain);
                                d[i + 1] = Math.min(255, (d[i + 1] || 0) * gain);
                                d[i + 2] = Math.min(255, (d[i + 2] || 0) * gain);
                                d[i + 3] = 255;
                            }
                            ctx.putImageData(img, 0, 0);
                        }
                    } catch {}
                }
                try {
                    ctx.restore();
                } catch {}
                return true;
            };

            try {
                abView.appendChild(diffLayer);
            } catch {}

            // Keep updating for video (or while canvases are still initializing).
            try {
                const ac = new AbortController();
                abView._mjrDiffAbort = ac;

                const request = () => {
                    if (ac.signal.aborted) return;
                    try {
                        requestAnimationFrame(() => {
                            if (ac.signal.aborted) return;
                            try {
                                if (aCanvas && bCanvas) drawDiffOnce();
                            } catch {}
                        });
                    } catch {}
                };
                abView._mjrDiffRequest = request;

                const isVideo = !!(topMedia?.querySelector?.("video") || baseMedia?.querySelector?.("video"));
                if (isVideo) {
                    let raf = null;

                    const aVideo = topMedia?.querySelector?.("video") || null;
                    const bVideo = baseMedia?.querySelector?.("video") || null;
                    const anyPlaying = () => {
                        try {
                            const ap = aVideo ? !aVideo.paused : false;
                            const bp = bVideo ? !bVideo.paused : false;
                            return ap || bp;
                        } catch {
                            return true;
                        }
                    };

                    const tick = () => {
                        if (ac.signal.aborted) return;
                        try {
                            if (aCanvas && bCanvas) drawDiffOnce();
                        } catch {}
                        if (!anyPlaying()) {
                            raf = null;
                            return;
                        }
                        try {
                            raf = requestAnimationFrame(tick);
                        } catch {
                            raf = null;
                        }
                    };

                    const ensureRaf = () => {
                        if (ac.signal.aborted) return;
                        if (raf != null) return;
                        try {
                            raf = requestAnimationFrame(tick);
                        } catch {
                            raf = null;
                        }
                    };

                    // While playing: continuous updates. While paused: update on seek/timeupdate (scrub) only.
                    try {
                        if (aVideo) {
                            aVideo.addEventListener("play", ensureRaf, { signal: ac.signal, passive: true });
                            aVideo.addEventListener("seeking", request, { signal: ac.signal, passive: true });
                            aVideo.addEventListener("seeked", request, { signal: ac.signal, passive: true });
                            aVideo.addEventListener("timeupdate", request, { signal: ac.signal, passive: true });
                        }
                    } catch {}
                    try {
                        if (bVideo) {
                            bVideo.addEventListener("play", ensureRaf, { signal: ac.signal, passive: true });
                            bVideo.addEventListener("seeking", request, { signal: ac.signal, passive: true });
                            bVideo.addEventListener("seeked", request, { signal: ac.signal, passive: true });
                            bVideo.addEventListener("timeupdate", request, { signal: ac.signal, passive: true });
                        }
                    } catch {}

                    ensureRaf();
                    ac.signal.addEventListener(
                        "abort",
                        () => {
                            try {
                                if (raf != null) cancelAnimationFrame(raf);
                            } catch {}
                        },
                        { once: true }
                    );
                } else {
                    // Images: draw once now; future redraws are triggered by `_mjrDiffRequest()`.
                    request();
                }
            } catch {}
        } else {
            slider.style.display = "";
            try {
                const blendTarget = topMedia?.querySelector?.(".mjr-viewer-media") || topMedia;
                if (blendTarget) blendTarget.style.mixBlendMode = "";
            } catch {}
        }
    } catch {}

    // Drag functionality
    let isDragging = false;
    let dragRect = null; // Cache rect during drag to avoid thrashing

    const updateSliderPos = (percent) => {
        try {
            const clamped = Math.max(0, Math.min(100, percent));
            setClipPercent(clamped);
            try { state._abWipePercent = clamped; } catch {}
            
            if (wipeAxis === "y") slider.style.top = `${clamped}%`;
            else slider.style.left = `${clamped}%`;
        } catch {}
    };

    const onPointerMove = (e) => {
        if (!isDragging) return;
        try {
            e.preventDefault(); // Stop scrolling
            e.stopPropagation();

            if (!dragRect) dragRect = abView.getBoundingClientRect();
            
            let percent = 50;
            if (wipeAxis === "y") {
                const y = Number(e.clientY) || 0;
                percent = ((y - dragRect.top) / dragRect.height) * 100;
            } else {
                const x = Number(e.clientX) || 0;
                percent = ((x - dragRect.left) / dragRect.width) * 100;
            }
            
            // Use RAF for smooth visual update if needed, but direct update is usually fine for simple sliders
            // to minimize lag feel.
            updateSliderPos(percent);
        } catch {}
    };

    const stopDrag = (e) => {
        if (!isDragging) return;
        isDragging = false;
        dragRect = null;
        try { 
            slider.releasePointerCapture(e.pointerId); 
            slider.style.cursor = wipeAxis === "y" ? "ns-resize" : "ew-resize";
        } catch {}
    };

    try {
        const sliderAC = new AbortController();
        abView._mjrSliderAbort = sliderAC;

        slider.addEventListener(
            "pointerdown",
            (e) => {
                if (e.button !== 0) return; // Left click only
                isDragging = true;
                e.preventDefault();
                e.stopPropagation();
                
                // Cache rect immediately
                try { dragRect = abView.getBoundingClientRect(); } catch {}

                try {
                    slider.setPointerCapture(e.pointerId);
                    slider.style.cursor = "grabbing";
                } catch {}
                
                // Immediate update on click-to-grab
                onPointerMove(e);
            },
            { signal: sliderAC.signal, passive: false }
        );
        
        window.addEventListener("pointermove", onPointerMove, { signal: sliderAC.signal, passive: false }); // passive:false for preventDefault
        window.addEventListener("pointerup", stopDrag, { signal: sliderAC.signal, passive: true });
        window.addEventListener("pointercancel", stopDrag, { signal: sliderAC.signal, passive: true });
    } catch {}

    // Slide Bar Geometry & Orientation
    try {
        if (wipeAxis === "y") {
            // Horizontal bar (Vertical wipe)
            // Hit area: wide horizontally, invisible handle along the line
            slider.style.width = "100%";
            slider.style.height = `${SLIDER_HIT_AREA_PX}px`;
            slider.style.left = "0";
            slider.style.top = `${initialWipePercent}%`;
            slider.style.transform = "translate(0, -50%)";
            slider.style.cursor = "ns-resize";

            // Visual line
            line.style.width = "100%";
            line.style.height = `${SLIDER_BAR_WIDTH_PX}px`;
            line.style.top = "50%";
            line.style.transform = "translate(0, -50%)";
        } else {
            // Vertical bar (Horizontal wipe)
            // Hit area: tall vertically, invisible handle along the line
            slider.style.height = "100%";
            slider.style.width = `${SLIDER_HIT_AREA_PX}px`;
            slider.style.top = "0";
            slider.style.left = `${initialWipePercent}%`;
            slider.style.transform = "translate(-50%, 0)";
            slider.style.cursor = "ew-resize";

            // Visual line
            line.style.height = "100%";
            line.style.width = `${SLIDER_BAR_WIDTH_PX}px`;
            line.style.left = "50%";
            line.style.transform = "translate(-50%, 0)";
        }
    } catch {}

    try {
        abView.appendChild(baseLayer);
        abView.appendChild(topLayer);
        abView.appendChild(slider);
    } catch {}

    // Video sync handled above via shared utility (do not duplicate listeners here).
}
