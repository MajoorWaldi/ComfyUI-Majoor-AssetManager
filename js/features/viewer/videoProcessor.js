import { clamp01 } from "./state.js";
import { drawMediaError } from "./imageProcessor.js";

export function createVideoProcessor({
    canvas,
    videoEl,
    getGradeParams,
    isDefaultGrade,
    tonemap,
    maxProcPixelsVideo,
    throttleFps,
    safeAddListener,
    safeCall,
    onReady,
} = {}) {
    const ctx = (() => {
        try {
            return canvas.getContext("2d", { willReadFrequently: true, alpha: false });
        } catch {
            return null;
        }
    })();

    const srcCanvas = document.createElement("canvas");
    const srcCtx = (() => {
        try {
            return srcCanvas.getContext("2d", { willReadFrequently: true, alpha: false });
        } catch {
            return null;
        }
    })();

    const sampleCanvas = document.createElement("canvas");
    sampleCanvas.width = 1;
    sampleCanvas.height = 1;
    const sampleCtx = (() => {
        try {
            return sampleCanvas.getContext("2d", { willReadFrequently: true, alpha: false });
        } catch {
            return null;
        }
    })();

    const proc = {
        naturalW: 0,
        naturalH: 0,
        scale: 1,
        lastParams: getGradeParams?.() || null,
        ready: false,
        _rendering: false,
        _destroyed: false,
        _rvfc: null,
        _rafIdLoop: null,
        _rafIdSchedule: null,
        _lastHeavyRenderAt: 0,
        _throttleTimer: null,
        _connectRAF: null,
        _connectTries: 0,
    };

    const unsubs = [];

    const computeScale = (w, h) => {
        try {
            const pixels = (Number(w) || 0) * (Number(h) || 0);
            if (!(pixels > 0)) return 1;
            if (pixels <= maxProcPixelsVideo) return 1;
            return Math.max(0.05, Math.min(1, Math.sqrt(maxProcPixelsVideo / pixels)));
        } catch {
            return 1;
        }
    };

    const ensureSizeFromVideo = () => {
        try {
            const w0 = Number(videoEl?.videoWidth) || 0;
            const h0 = Number(videoEl?.videoHeight) || 0;
            if (!(w0 > 0 && h0 > 0)) return false;
            proc.naturalW = w0;
            proc.naturalH = h0;
            proc.scale = computeScale(w0, h0);

            const w = Math.max(1, Math.round(w0 * proc.scale));
            const h = Math.max(1, Math.round(h0 * proc.scale));
            if (srcCanvas.width !== w) srcCanvas.width = w;
            if (srcCanvas.height !== h) srcCanvas.height = h;
            if (canvas.width !== w) canvas.width = w;
            if (canvas.height !== h) canvas.height = h;

            canvas._mjrNaturalW = w0;
            canvas._mjrNaturalH = h0;
            canvas._mjrPixelScale = proc.scale;

            proc.ready = true;
            return true;
        } catch {
            return false;
        }
    };

    const drawSource = () => {
        if (!srcCtx) return false;
        if (!proc.ready) return false;
        try {
            srcCtx.drawImage(videoEl, 0, 0, srcCanvas.width, srcCanvas.height);
            return true;
        } catch {
            return false;
        }
    };

    const renderProcessedFrame = () => {
        if (!ctx || !srcCtx) return;
        if (!proc.ready) return;
        if (!drawSource()) return;

        const params = proc.lastParams || getGradeParams?.() || {};
        if (isDefaultGrade?.(params)) {
            try {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(srcCanvas, 0, 0);
            } catch {}
            return;
        }

        let src;
        try {
            src = srcCtx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);
        } catch {
            try {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(srcCanvas, 0, 0);
            } catch {}
            return;
        }

        const w = srcCanvas.width;
        const h = srcCanvas.height;
        let dst;
        try {
            dst = ctx.createImageData(w, h);
        } catch {
            try {
                dst = new ImageData(w, h);
            } catch {
                return;
            }
        }

        const exposureEV = Number(params.exposureEV) || 0;
        const gamma = Math.max(0.1, Math.min(3, Number(params.gamma) || 1));
        const invGamma = 1 / gamma;
        const channel = String(params.channel || "rgb");
        const analysisMode = String(params.analysisMode || "none");
        const zebraThreshold = clamp01(params.zebraThreshold ?? 0.95);
        const exposureScale = Math.pow(2, exposureEV);

        const s = src.data;
        const d = dst.data;
        for (let i = 0; i < d.length; i += 4) {
            const r0 = (s[i] ?? 0) / 255;
            const g0 = (s[i + 1] ?? 0) / 255;
            const b0 = (s[i + 2] ?? 0) / 255;
            const a0 = (s[i + 3] ?? 255) / 255;

            let rr = r0 * exposureScale;
            let gg = g0 * exposureScale;
            let bb = b0 * exposureScale;

            const lum = 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;

            if (analysisMode === "zebra") {
                // Input is 8-bit video; avoid tonemapping (it alters baseline contrast/colors).
                const over = clamp01(lum) >= zebraThreshold;
                if (over) {
                    const stripe = (((Math.floor(i / 4) % w) + Math.floor((i / 4) / w)) & 7) < 3;
                    rr = stripe ? 1 : 0;
                    gg = stripe ? 1 : 0;
                    bb = stripe ? 1 : 0;
                } else {
                    rr = Math.pow(clamp01(rr), invGamma);
                    gg = Math.pow(clamp01(gg), invGamma);
                    bb = Math.pow(clamp01(bb), invGamma);
                }
            } else {
                rr = Math.pow(clamp01(rr), invGamma);
                gg = Math.pow(clamp01(gg), invGamma);
                bb = Math.pow(clamp01(bb), invGamma);
            }

            if (channel === "r") {
                gg = rr;
                bb = rr;
            } else if (channel === "g") {
                rr = gg;
                bb = gg;
            } else if (channel === "b") {
                rr = bb;
                gg = bb;
            } else if (channel === "a") {
                rr = a0;
                gg = a0;
                bb = a0;
            } else if (channel === "l") {
                const l = clamp01(lum);
                const lg = Math.pow(l, invGamma);
                rr = lg;
                gg = lg;
                bb = lg;
            }

            d[i] = Math.round(clamp01(rr) * 255);
            d[i + 1] = Math.round(clamp01(gg) * 255);
            d[i + 2] = Math.round(clamp01(bb) * 255);
            d[i + 3] = 255;
        }

        try {
            ctx.putImageData(dst, 0, 0);
        } catch {}
    };

    const renderOnce = () => {
        if (proc._destroyed) return;
        if (!canvas?.isConnected) return;
        if (!proc.ready) ensureSizeFromVideo();
        if (!proc.ready) return;
        renderProcessedFrame();
    };

    const scheduleWhenConnected = () => {
        if (proc._destroyed) return;
        try {
            if (canvas?.isConnected) {
                proc._connectRAF = null;
                proc._connectTries = 0;
                scheduleRender();
                return;
            }
        } catch {}
        if (proc._connectRAF != null) return;
        proc._connectTries = (Number(proc._connectTries) || 0) + 1;
        if (proc._connectTries > 20) {
            proc._connectRAF = null;
            proc._connectTries = 0;
            return;
        }
        try {
            proc._connectRAF = requestAnimationFrame(() => {
                proc._connectRAF = null;
                scheduleWhenConnected();
            });
        } catch {
            proc._connectRAF = null;
        }
    };

    const _getThrottleMs = () => {
        try {
            const fps = Number(throttleFps);
            if (!Number.isFinite(fps) || fps <= 0) return 0;
            return Math.max(0, Math.floor(1000 / Math.max(1, fps)));
        } catch {
            return 0;
        }
    };

    const scheduleRender = () => {
        if (proc._destroyed) return;
        if (proc._rendering) return;
        if (!canvas?.isConnected) {
            scheduleWhenConnected();
            return;
        }

        const params = proc.lastParams || getGradeParams?.() || {};
        const heavy = !isDefaultGrade?.(params);
        const throttleMs = heavy && !videoEl?.paused ? _getThrottleMs() : 0;
        if (throttleMs > 0) {
            const now = Date.now();
            const nextOkAt = (Number(proc._lastHeavyRenderAt) || 0) + throttleMs;
            if (now < nextOkAt) {
                try {
                    if (proc._throttleTimer) clearTimeout(proc._throttleTimer);
                } catch {}
                try {
                    proc._throttleTimer = setTimeout(() => {
                        try {
                            proc._throttleTimer = null;
                        } catch {}
                        scheduleRender();
                    }, Math.min(250, Math.max(0, nextOkAt - now)));
                } catch {}
                return;
            }
        }

        proc._rendering = true;
        try {
            proc._rafIdSchedule = requestAnimationFrame(() => {
                proc._rafIdSchedule = null;
                proc._rendering = false;
                renderOnce();
                try {
                    if (heavy) proc._lastHeavyRenderAt = Date.now();
                } catch {}
            });
        } catch {
            proc._rendering = false;
        }
    };

    const startFrameLoop = () => {
        if (proc._destroyed) return;
        try {
            if (typeof videoEl?.requestVideoFrameCallback === "function") {
                const cb = () => {
                    if (proc._destroyed) return;
                    if (!canvas?.isConnected) return;
                    scheduleRender();
                    if (!videoEl.paused) {
                        try {
                            proc._rvfc = videoEl.requestVideoFrameCallback(cb);
                        } catch {}
                    }
                };
                try {
                    proc._rvfc = videoEl.requestVideoFrameCallback(cb);
                } catch {}
                return;
            }
        } catch {}
        const loop = () => {
            if (proc._destroyed) return;
            if (!canvas?.isConnected) return;
            scheduleRender();
            if (!videoEl.paused) {
                try {
                    proc._rafIdLoop = requestAnimationFrame(loop);
                } catch {}
            }
        };
        try {
            proc._rafIdLoop = requestAnimationFrame(loop);
        } catch {}
    };

    const setParams = (params) => {
        proc.lastParams = params || proc.lastParams || getGradeParams?.();
        scheduleRender();
    };

    const sampleAtOriginal = (x, y) => {
        try {
            if (!proc.ready) ensureSizeFromVideo();
            if (!proc.ready) return null;
            drawSource();

            const scale = proc.scale || 1;
            const sx = Math.max(0, Math.min(srcCanvas.width - 1, Math.floor((Number(x) || 0) * scale)));
            const sy = Math.max(0, Math.min(srcCanvas.height - 1, Math.floor((Number(y) || 0) * scale)));
            if (!sampleCtx) return null;
            sampleCtx.clearRect(0, 0, 1, 1);
            sampleCtx.drawImage(srcCanvas, sx, sy, 1, 1, 0, 0, 1, 1);
            const data = sampleCtx.getImageData(0, 0, 1, 1)?.data;
            if (!data || data.length < 4) return null;
            const r = data[0] ?? 0;
            const g = data[1] ?? 0;
            const b = data[2] ?? 0;
            const a = data[3] ?? 255;

            const raw = [r / 255, g / 255, b / 255, a / 255];
            const ev = Number(proc.lastParams?.exposureEV) || 0;
            const exposureScale = Math.pow(2, ev);
            const lin = [raw[0] * exposureScale, raw[1] * exposureScale, raw[2] * exposureScale, raw[3]];

            return { r, g, b, a, raw, lin, scale: proc.scale };
        } catch {
            return null;
        }
    };

    const onMeta = () => {
        ensureSizeFromVideo();
        scheduleRender();
        try {
            onReady?.({ naturalW: proc.naturalW, naturalH: proc.naturalH, pixelScale: proc.scale });
        } catch {}
    };

    try {
        const onPlay = () => startFrameLoop();
        const onError = () => {
            proc.ready = false;
            try {
                drawMediaError(canvas, "Failed to load video");
            } catch {}
        };

        unsubs.push(safeAddListener?.(videoEl, "loadedmetadata", onMeta, { once: true }) || (() => {}));
        unsubs.push(safeAddListener?.(videoEl, "seeked", scheduleRender, { passive: true }) || (() => {}));
        unsubs.push(safeAddListener?.(videoEl, "pause", scheduleRender, { passive: true }) || (() => {}));
        unsubs.push(safeAddListener?.(videoEl, "play", onPlay, { passive: true }) || (() => {}));
        unsubs.push(safeAddListener?.(videoEl, "timeupdate", scheduleRender, { passive: true }) || (() => {}));
        unsubs.push(safeAddListener?.(videoEl, "error", onError, { passive: true }) || (() => {}));
    } catch {}

    return {
        setParams,
        sampleAtOriginal,
        getInfo: () => ({ ...proc }),
        destroy: () => {
            proc._destroyed = true;
            try {
                if (proc._throttleTimer) clearTimeout(proc._throttleTimer);
            } catch {}
            proc._throttleTimer = null;
            try {
                if (proc._connectRAF != null) cancelAnimationFrame(proc._connectRAF);
            } catch {}
            proc._connectRAF = null;
            proc._connectTries = 0;
            try {
                if (proc._rvfc != null && typeof videoEl?.cancelVideoFrameCallback === "function") {
                    videoEl.cancelVideoFrameCallback(proc._rvfc);
                }
            } catch {}
            try {
                if (proc._rafIdLoop != null) cancelAnimationFrame(proc._rafIdLoop);
            } catch {}
            try {
                if (proc._rafIdSchedule != null) cancelAnimationFrame(proc._rafIdSchedule);
            } catch {}
            try {
                for (const u of unsubs) safeCall?.(u);
            } catch {}
            try {
                srcCanvas.width = 0;
                srcCanvas.height = 0;
            } catch {}
            try {
                canvas.width = 0;
                canvas.height = 0;
            } catch {}
        },
    };
}
