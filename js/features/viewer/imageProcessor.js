import { clamp01 } from "./state.js";
import { computeProcessorScale } from "./processorUtils.js";

export function drawMediaError(canvas, message) {
    if (!canvas) return;
    try {
        if (!(canvas.width > 1 && canvas.height > 1)) {
            canvas.width = 960;
            canvas.height = 540;
        }
    } catch {}
    const ctx = (() => {
        try {
            return canvas.getContext?.("2d");
        } catch {
            return null;
        }
    })();
    if (!ctx) return;
    try {
        ctx.save();
    } catch {}
    try {
        ctx.fillStyle = "rgba(0,0,0,0.85)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    } catch {}
    try {
        ctx.fillStyle = "rgba(255, 120, 120, 0.95)";
        ctx.font = "14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
        ctx.textBaseline = "top";
        const text = message ? String(message) : "Failed to load media";
        ctx.fillText(text, 14, 14);
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.fillText("Check file permissions / path, or try re-indexing.", 14, 34);
    } catch {}
    try {
        ctx.restore();
    } catch {}
}

export function createImageProcessor({
    canvas,
    url,
    getGradeParams,
    isDefaultGrade,
    tonemap,
    maxProcPixels,
    onReady,
} = {}) {
    const image = new Image();
    try {
        image.decoding = "async";
    } catch {}
    try {
        image.crossOrigin = "anonymous";
    } catch {}

    const ctx = (() => {
        try {
            return canvas.getContext("2d", { willReadFrequently: true });
        } catch {
            return null;
        }
    })();

    const srcCanvas = document.createElement("canvas");
    const srcCtx = (() => {
        try {
            return srcCanvas.getContext("2d", { willReadFrequently: true });
        } catch {
            return null;
        }
    })();

    const proc = {
        naturalW: 0,
        naturalH: 0,
        scale: 1,
        srcData: null,
        jobId: 0,
        lastParams: null,
        ready: false,
        _destroyed: false,
        _rafId: null,
        _connectRAF: null,
        _connectTries: 0,
        _pendingParams: null,
        _buffer: null,
    };

    const scheduleWhenConnected = () => {
        if (proc._destroyed) return;
        try {
            if (canvas?.isConnected) {
                proc._connectRAF = null;
                proc._connectTries = 0;
                const p = proc._pendingParams;
                proc._pendingParams = null;
                if (p) setParams(p);
                return;
            }
        } catch {}
        if (proc._connectRAF != null) return;
        proc._connectTries = (Number(proc._connectTries) || 0) + 1;
        if (proc._connectTries > 20) {
            proc._connectRAF = null;
            proc._connectTries = 0;
            proc._pendingParams = null;
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

    const computeScale = (w, h) => computeProcessorScale(maxProcPixels, w, h);

    const ensureSourceData = () => {
        if (proc.srcData) return proc.srcData;
        if (!srcCtx) return null;
        if (!proc.ready) return null;
        try {
            const sw = srcCanvas.width;
            const sh = srcCanvas.height;
            if (!(sw > 0 && sh > 0)) return null;
            proc.srcData = srcCtx.getImageData(0, 0, sw, sh);
            return proc.srcData;
        } catch {
            return null;
        }
    };

    const sampleAtOriginal = (x, y) => {
        try {
            const ox = Number(x) || 0;
            const oy = Number(y) || 0;
            if (!(proc.naturalW > 0 && proc.naturalH > 0)) return null;
            const sx = Math.max(0, Math.min(srcCanvas.width - 1, Math.floor(ox * proc.scale)));
            const sy = Math.max(0, Math.min(srcCanvas.height - 1, Math.floor(oy * proc.scale)));
            const src = ensureSourceData();
            if (!src?.data) return null;
            const idx = (sy * srcCanvas.width + sx) * 4;
            const r = src.data[idx] ?? 0;
            const g = src.data[idx + 1] ?? 0;
            const b = src.data[idx + 2] ?? 0;
            const a = src.data[idx + 3] ?? 255;

            const raw = [r / 255, g / 255, b / 255, a / 255];
            const ev = Number(proc.lastParams?.exposureEV) || 0;
            const exposureScale = Math.pow(2, ev);
            const lin = [raw[0] * exposureScale, raw[1] * exposureScale, raw[2] * exposureScale, raw[3]];
            return { r, g, b, a, raw, lin, scale: proc.scale };
        } catch {
            return null;
        }
    };

    const runProcessing = (jobId, params) => {
        if (!ctx) return;
        if (proc._destroyed) return;
        if (!canvas?.isConnected) {
            try {
                proc._pendingParams = params || proc.lastParams || getGradeParams?.() || null;
            } catch {}
            scheduleWhenConnected();
            return;
        }
        if (jobId !== proc.jobId) return;
        const src = ensureSourceData();
        if (!src?.data) return;

        const w = srcCanvas.width;
        const h = srcCanvas.height;
        if (!(w > 0 && h > 0)) return;

        // Fast path: preserve exact colors when grade is default.
        try {
            const p0 = params || getGradeParams?.() || {};
            if (typeof isDefaultGrade === "function" && isDefaultGrade(p0)) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(srcCanvas, 0, 0);
                return;
            }
        } catch {}

        let dst = proc._buffer;
        if (!dst || dst.width !== w || dst.height !== h) {
            try {
                dst = ctx.createImageData(w, h);
                proc._buffer = dst;
            } catch {
                try {
                    dst = new ImageData(w, h);
                    proc._buffer = dst;
                } catch {
                    return;
                }
            }
        }
        if (!dst) return;

        const p = params || getGradeParams?.() || {};
        const exposureEV = Number(p.exposureEV) || 0;
        const gamma = Math.max(0.1, Math.min(3, Number(p.gamma) || 1));
        const invGamma = 1 / gamma;
        const channel = String(p.channel || "rgb");
        const analysisMode = String(p.analysisMode || "none");
        const zebraThreshold = clamp01(p.zebraThreshold ?? 0.95);
        const exposureScale = Math.pow(2, exposureEV);

        // Precompute gamma LUT (256 entries) to avoid per-pixel Math.pow()
        // We store floats 0.0-1.0 in the LUT to match pipeline expectations.
        const gammaLUT = new Float32Array(256);
        for (let j = 0; j < 256; j++) {
            gammaLUT[j] = Math.pow(j / 255, invGamma);
        }

        const d = dst.data;
        const s = src.data;

        const total = w * h * 4;
        const chunk = 55_000 * 4;
        let i = 0;

        const step = () => {
            if (proc._destroyed) return;
            if (!canvas?.isConnected) return;
            if (jobId !== proc.jobId) return;

            const end = Math.min(total, i + chunk);
            for (; i < end; i += 4) {
                const r0 = (s[i] ?? 0) / 255;
                const g0 = (s[i + 1] ?? 0) / 255;
                const b0 = (s[i + 2] ?? 0) / 255;
                const a0 = (s[i + 3] ?? 255) / 255;

                let rr = r0 * exposureScale;
                let gg = g0 * exposureScale;
                let bb = b0 * exposureScale;

                const lum = 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;

                if (analysisMode === "zebra") {
                    // Input is 8-bit sRGB; avoid tonemapping (it alters baseline contrast/colors).
                    const over = clamp01(lum) >= zebraThreshold;
                    if (over) {
                        const stripe = (((Math.floor(i / 4) % w) + Math.floor((i / 4) / w)) & 7) < 3;
                        rr = stripe ? 1 : 0;
                        gg = stripe ? 1 : 0;
                        bb = stripe ? 1 : 0;
                    } else {
                        rr = gammaLUT[(clamp01(rr) * 255 + 0.5) | 0];
                        gg = gammaLUT[(clamp01(gg) * 255 + 0.5) | 0];
                        bb = gammaLUT[(clamp01(bb) * 255 + 0.5) | 0];
                    }
                } else {
                    rr = gammaLUT[(clamp01(rr) * 255 + 0.5) | 0];
                    gg = gammaLUT[(clamp01(gg) * 255 + 0.5) | 0];
                    bb = gammaLUT[(clamp01(bb) * 255 + 0.5) | 0];
                }

                // Channel viewing
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
                    const lg = gammaLUT[(l * 255 + 0.5) | 0];
                    rr = lg;
                    gg = lg;
                    bb = lg;
                }

                d[i] = Math.round(clamp01(rr) * 255);
                d[i + 1] = Math.round(clamp01(gg) * 255);
                d[i + 2] = Math.round(clamp01(bb) * 255);
                d[i + 3] = 255;
            }

            if (i < total) {
                try {
                    proc._rafId = requestAnimationFrame(step);
                } catch {}
                return;
            }

            try {
                ctx.putImageData(dst, 0, 0);
            } catch {}
        };

        try {
            proc._rafId = requestAnimationFrame(step);
        } catch {}
    };

    const setParams = (nextParams) => {
        if (proc._destroyed) return;
        proc.lastParams = nextParams || proc.lastParams || getGradeParams?.() || null;
        if (!canvas?.isConnected) {
            try {
                proc._pendingParams = proc.lastParams;
            } catch {}
            scheduleWhenConnected();
            return;
        }
        proc.jobId++;
        const jobId = proc.jobId;
        try {
            runProcessing(jobId, proc.lastParams);
        } catch {}
    };

    const onLoaded = () => {
        if (proc._destroyed) return;
        try {
            proc.naturalW = Number(image.naturalWidth) || 0;
            proc.naturalH = Number(image.naturalHeight) || 0;
            if (!(proc.naturalW > 0 && proc.naturalH > 0)) return;
            proc.scale = computeScale(proc.naturalW, proc.naturalH);

            const w = Math.max(1, Math.round(proc.naturalW * proc.scale));
            const h = Math.max(1, Math.round(proc.naturalH * proc.scale));
            srcCanvas.width = w;
            srcCanvas.height = h;
            canvas.width = w;
            canvas.height = h;

            canvas._mjrNaturalW = proc.naturalW;
            canvas._mjrNaturalH = proc.naturalH;
            canvas._mjrPixelScale = proc.scale;

            try {
                srcCtx?.clearRect(0, 0, w, h);
                srcCtx?.drawImage(image, 0, 0, w, h);
            } catch {}

            proc.ready = true;
            proc.srcData = null;
            ensureSourceData();
            setParams(proc.lastParams || getGradeParams?.());
        } finally {
            try {
                onReady?.({ naturalW: proc.naturalW, naturalH: proc.naturalH, pixelScale: proc.scale });
            } catch {}
        }
    };

    const onError = () => {
        proc.ready = false;
        try {
            drawMediaError(canvas, "Failed to load image");
        } catch {}
    };

    try {
        image.onload = onLoaded;
        image.onerror = onError;
    } catch {}

    try {
        image.src = url;
    } catch {}

    return {
        setParams,
        sampleAtOriginal,
        getInfo: () => ({ ...proc }),
        destroy: () => {
            proc._destroyed = true;
            try {
                proc.jobId++;
            } catch {}
            try {
                if (proc._rafId != null) cancelAnimationFrame(proc._rafId);
            } catch {}
            try {
                if (proc._connectRAF != null) cancelAnimationFrame(proc._connectRAF);
            } catch {}
            proc._connectRAF = null;
            proc._connectTries = 0;
            proc._pendingParams = null;
            try {
                image.onload = null;
                image.onerror = null;
            } catch {}
            try {
                image.src = "";
            } catch {}
            try {
                srcCanvas.width = 0;
                srcCanvas.height = 0;
            } catch {}
            try {
                canvas.width = 0;
                canvas.height = 0;
            } catch {}
            proc.srcData = null;
            proc._buffer = null;
        },
    };
}
