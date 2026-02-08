import { createImageProcessor, drawMediaError } from "./imageProcessor.js";
import { createVideoProcessor } from "./videoProcessor.js";
import { createAudioVisualizer } from "./audioVisualizer.js";
import { safeAddListener as defaultSafeAddListener, safeCall as defaultSafeCall } from "../../utils/safeCall.js";
import { APP_CONFIG } from "../../app/config.js";

const AUDIO_BG_URL = (() => {
    try {
        return new URL("../../assets/audio-bg.png", import.meta.url).href;
    } catch {
        return "";
    }
})();

export function createViewerMediaFactory({
    overlay,
    state,
    mediaTransform,
    updateMediaNaturalSize,
    clampPanToBounds,
    applyTransform,
    scheduleOverlayRedraw,
    getGradeParams,
    isDefaultGrade,
    tonemap,
    maxProcPixels,
    maxProcPixelsVideo,
    disableWebGL,
    videoGradeThrottleFps,
    safeAddListener,
    safeCall,
} = {}) {
    const _safeCall = safeCall || defaultSafeCall;
    const _safeAddListener = safeAddListener || defaultSafeAddListener;

    const _extOf = (asset) => {
        try {
            const ext = String(asset?.ext || "").trim().toLowerCase();
            if (ext) return ext.startsWith(".") ? ext : `.${ext}`;
        } catch {}
        try {
            const name = String(asset?.filename || asset?.filepath || "").trim();
            const idx = name.lastIndexOf(".");
            if (idx >= 0) return name.slice(idx).toLowerCase();
        } catch {}
        return "";
    };

    // Formats that may be animated (GIF, animated WebP). Rendering through the
    // image processor (canvas) would only show a single frame.
    const _shouldUseNativeImageEl = (asset) => {
        const ext = _extOf(asset);
        return ext === ".gif" || ext === ".webp";
    };

    const _createNativeImageEl = (asset, url) => {
        const img = document.createElement("img");
        img.className = "mjr-viewer-media";
        try {
            if (asset?.id != null && img?.dataset) img.dataset.mjrAssetId = String(asset.id);
        } catch {}
        img.alt = String(asset?.filename || "") || "image";
        try {
            img.decoding = "async";
        } catch {}
        try {
            img.loading = "eager";
        } catch {}
        try {
            img.draggable = false;
        } catch {}
        img.src = url;
        img.style.cssText = `
            max-width: 100%;
            max-height: 100%;
            display: block;
            transform: ${mediaTransform?.() || ""};
            transform-origin: center center;
        `;

        const onLoad = () => {
            try {
                requestAnimationFrame(() => {
                    try {
                        if (!state?._userInteracted) {
                            updateMediaNaturalSize?.();
                            clampPanToBounds?.();
                            applyTransform?.();
                        }
                    } catch {}
                });
            } catch {}
            try {
                scheduleOverlayRedraw?.();
            } catch {}
        };

        const onError = () => {
            try {
                const canvas = document.createElement("canvas");
                canvas.className = "mjr-viewer-media";
                try {
                    if (asset?.id != null && canvas?.dataset) canvas.dataset.mjrAssetId = String(asset.id);
                } catch {}
                _seedNaturalSizeFromAsset(canvas, asset);
                canvas.style.cssText = `
                    max-width: 100%;
                    max-height: 100%;
                    display: block;
                    transform: ${mediaTransform?.() || ""};
                    transform-origin: center center;
                `;
                drawMediaError(canvas, "Failed to load image");
                img.replaceWith(canvas);
            } catch {}
        };

        try {
            img.addEventListener("load", onLoad, { once: true });
        } catch {}
        try {
            img.addEventListener("error", onError, { once: true });
        } catch {}

        return img;
    };

    const _seedNaturalSizeFromAsset = (canvas, asset) => {
        try {
            if (!canvas || !(canvas instanceof HTMLCanvasElement)) return;
            const w = Number(asset?.width) || 0;
            const h = Number(asset?.height) || 0;
            if (!(w > 0 && h > 0)) return;
            // Hint used before processors are ready; processors will overwrite with true natural size.
            if (!Number(canvas._mjrNaturalW) && !Number(canvas._mjrNaturalH)) {
                canvas._mjrNaturalW = w;
                canvas._mjrNaturalH = h;
            }
        } catch {}
    };

    const _createAudioElement = (asset, url, { compare = false } = {}) => {
        const wrap = document.createElement("div");
        wrap.style.cssText = `
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-direction: column;
            gap: 12px;
            color: rgba(255,255,255,0.85);
            padding: 14px;
            background-image: linear-gradient(rgba(0,0,0,0.42), rgba(0,0,0,0.42)), url('${AUDIO_BG_URL}');
            background-size: cover;
            background-position: center center;
            background-repeat: no-repeat;
        `;

        if (!compare) {
            const label = document.createElement("div");
            label.textContent = String(asset?.filename || "Audio");
            label.style.cssText =
                "font-size: 12px; opacity: 0.9; max-width: 90%; text-align: center; overflow: hidden; text-overflow: ellipsis;";
            wrap.appendChild(label);
        }

        const viz = document.createElement("canvas");
        viz.className = "mjr-viewer-audio-viz";
        viz.style.cssText = `
            width: min(1920px, 96%);
            aspect-ratio: 16 / 9;
            height: auto;
            max-height: min(1080px, 68vh);
            min-height: 260px;
            border: none;
            border-radius: 10px;
            background: transparent;
        `;

        const audio = document.createElement("audio");
        audio.className = "mjr-viewer-audio-src";
        audio.src = url;
        audio.controls = false;
        audio.autoplay = true;
        audio.preload = "metadata";
        audio.style.cssText = "width: min(680px, 90%);";

        try {
            const vizProc = createAudioVisualizer({
                canvas: viz,
                audioEl: audio,
                mode: state?.audioVisualizerMode,
            });
            // Keep lifecycle compatibility: audio cleanup + canvas processor cleanup.
            audio._mjrAudioViz = vizProc;
            viz._mjrProc = vizProc;
        } catch {
            audio._mjrAudioViz = null;
            viz._mjrProc = null;
        }

        wrap.appendChild(viz);
        wrap.appendChild(audio);
        return wrap;
    };

    function createMediaElement(asset, url) {
        const container = document.createElement("div");
        container.className = "mjr-video-host";
        container.style.cssText = `
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
        `;

        const kind = String(asset?.kind || "").toLowerCase();
        if (kind && kind !== "image" && kind !== "video" && kind !== "audio") {
            const canvas = document.createElement("canvas");
            canvas.className = "mjr-viewer-media";
            try {
                if (asset?.id != null && canvas?.dataset) canvas.dataset.mjrAssetId = String(asset.id);
            } catch {}
            _seedNaturalSizeFromAsset(canvas, asset);
            canvas.style.cssText = `
                max-width: 100%;
                max-height: 100%;
                display: block;
                transform: ${mediaTransform?.() || ""};
                transform-origin: center center;
            `;
            try {
                drawMediaError(canvas, `Unsupported file type: ${kind}`);
            } catch {}
            return canvas;
        }

        if (kind === "audio") return _createAudioElement(asset, url, { compare: false });

        if (kind === "video") {
            const canvas = document.createElement("canvas");
            canvas.className = "mjr-viewer-media";
            try {
                if (asset?.id != null && canvas?.dataset) canvas.dataset.mjrAssetId = String(asset.id);
            } catch {}
            _seedNaturalSizeFromAsset(canvas, asset);
            canvas.style.cssText = `
                max-width: 100%;
                max-height: 100%;
                object-fit: contain;
                display: block;
                transform: ${mediaTransform?.() || ""};
                transform-origin: center center;
            `;

            const video = document.createElement("video");
            video.className = "mjr-viewer-video-src";
            video.src = url;
            video.controls = false;
            video.autoplay = true;
            // Default: loop videos in the viewer. If custom controls are mounted, they may disable native looping.
            video.loop = true;
            video.playsInline = true;
            video.muted = true;
            video.preload = "metadata";
            video.style.cssText = "position:absolute; width:1px; height:1px; opacity:0; pointer-events:none;";

            try {
                canvas._mjrProc = createVideoProcessor({
                    canvas,
                    videoEl: video,
                    disableWebGL: disableWebGL || !!APP_CONFIG.VIEWER_DISABLE_WEBGL_VIDEO,
                    getGradeParams,
                    isDefaultGrade,
                    tonemap,
                    maxProcPixelsVideo: maxProcPixelsVideo,
                    throttleFps: videoGradeThrottleFps,
                    safeAddListener: _safeAddListener,
                    safeCall: _safeCall,
                    onReady: () => {
                        try {
                            requestAnimationFrame(() => {
                                try {
                                    // Refit only if the user hasn't already interacted (zoom/pan).
                                    if (!state?._userInteracted) {
                                        updateMediaNaturalSize?.();
                                        clampPanToBounds?.();
                                        applyTransform?.();
                                    }
                                } catch {}
                            });
                        } catch {}
                        try {
                            scheduleOverlayRedraw?.();
                        } catch {}
                    },
                });
                canvas._mjrProc?.setParams?.(getGradeParams?.());
            } catch {}

            try {
                video.addEventListener(
                    "canplay",
                    () => {
                        try {
                            const p = video.play?.();
                            if (p && typeof p.catch === "function") {
                                p.catch(() => {
                                    try {
                                        drawMediaError(canvas, "Autoplay blocked (press Space / Play)");
                                    } catch {}
                                });
                            }
                        } catch {
                            try {
                                drawMediaError(canvas, "Autoplay blocked (press Space / Play)");
                            } catch {}
                        }
                    },
                    { once: true }
                );
            } catch {}

            container.appendChild(canvas);
            container.appendChild(video);
            return container;
        }

        if (_shouldUseNativeImageEl(asset)) {
            return _createNativeImageEl(asset, url);
        }

        const canvas = document.createElement("canvas");
        canvas.className = "mjr-viewer-media";
        try {
            if (asset?.id != null && canvas?.dataset) canvas.dataset.mjrAssetId = String(asset.id);
        } catch {}
        _seedNaturalSizeFromAsset(canvas, asset);
        canvas.style.cssText = `
            max-width: 100%;
            max-height: 100%;
            object-fit: contain;
            display: block;
            transform: ${mediaTransform?.() || ""};
            transform-origin: center center;
        `;
        try {
            canvas._mjrProc = createImageProcessor({
                canvas,
                url,
                getGradeParams,
                isDefaultGrade,
                tonemap,
                maxProcPixels: maxProcPixels,
                onReady: () => {
                    try {
                        // Refit only if the user hasn't already interacted (zoom/pan).
                        requestAnimationFrame(() => {
                            try {
                                if (!state?._userInteracted) {
                                    updateMediaNaturalSize?.();
                                    clampPanToBounds?.();
                                    applyTransform?.();
                                }
                            } catch {}
                        });
                    } catch {}
                    try {
                        scheduleOverlayRedraw?.();
                    } catch {}
                },
            });
            canvas._mjrProc?.setParams?.(getGradeParams?.());
        } catch {}
        return canvas;
    }

    // Create media element for compare modes (A/B and side-by-side).
    // Important: the returned element fills the container so both layers share identical sizing/centering.
        function createCompareMediaElement(asset, url) {
        const kind = String(asset?.kind || "").toLowerCase();
        if (kind && kind !== "image" && kind !== "video" && kind !== "audio") {
            const canvas = document.createElement("canvas");
            canvas.className = "mjr-viewer-media";
            try {
                if (asset?.id != null && canvas?.dataset) canvas.dataset.mjrAssetId = String(asset.id);
            } catch {}
            _seedNaturalSizeFromAsset(canvas, asset);
            canvas.style.cssText = `
                max-width: 100%;
                max-height: 100%;
                display: block;
                transform: ${mediaTransform?.() || ""};
                transform-origin: center center;
            `;
            try {
                drawMediaError(canvas, `Unsupported file type: ${kind}`);
            } catch {}
            return canvas;
        }

        if (kind === "audio") return _createAudioElement(asset, url, { compare: true });

            if (kind === "video") {
                const wrap = document.createElement("div");
                wrap.style.cssText = "width:100%; height:100%; position:relative; display:flex; align-items:center; justify-content:center;";

            const canvas = document.createElement("canvas");
            canvas.className = "mjr-viewer-media";
            try {
                if (asset?.id != null && canvas?.dataset) canvas.dataset.mjrAssetId = String(asset.id);
            } catch {}
            _seedNaturalSizeFromAsset(canvas, asset);
            canvas.style.cssText = `
                max-width: 100%;
                max-height: 100%;
                object-fit: contain;
                display: block;
                transform: ${mediaTransform?.() || ""};
                transform-origin: center center;
            `;

            const video = document.createElement("video");
            video.className = "mjr-viewer-video-src";
            video.src = url;
            video.controls = false;
            video.loop = true;
            video.muted = true;
            video.playsInline = true;
            video.autoplay = true;
            video.preload = "metadata";
            video.style.cssText = "position:absolute; width:1px; height:1px; opacity:0; pointer-events:none;";

                try {
                    canvas._mjrProc = createVideoProcessor({
                        canvas,
                        videoEl: video,
                        getGradeParams,
                        isDefaultGrade,
                        tonemap,
                        maxProcPixelsVideo: maxProcPixelsVideo,
                        throttleFps: videoGradeThrottleFps,
                        safeAddListener: _safeAddListener,
                        safeCall: _safeCall,
                        onReady: () => {
                            try {
                                // Refit after the processor updates natural size (important in compare modes).
                                requestAnimationFrame(() => {
                                    try {
                                        if (!state?._userInteracted) {
                                            updateMediaNaturalSize?.();
                                            clampPanToBounds?.();
                                            applyTransform?.();
                                        }
                                    } catch {}
                                });
                            } catch {}
                            try {
                                scheduleOverlayRedraw?.();
                            } catch {}
                        },
                    });
                    canvas._mjrProc?.setParams?.(getGradeParams?.());
                } catch {}

            wrap.appendChild(canvas);
            wrap.appendChild(video);
            return wrap;
        }

        if (_shouldUseNativeImageEl(asset)) {
            return _createNativeImageEl(asset, url);
        }

        const canvas = document.createElement("canvas");
        canvas.className = "mjr-viewer-media";
        try {
            if (asset?.id != null && canvas?.dataset) canvas.dataset.mjrAssetId = String(asset.id);
        } catch {}
        _seedNaturalSizeFromAsset(canvas, asset);
        canvas.style.cssText = `
            max-width: 100%;
            max-height: 100%;
            display: block;
            transform: ${mediaTransform?.() || ""};
            transform-origin: center center;
        `;
        try {
            canvas._mjrProc = createImageProcessor({
                canvas,
                url,
                getGradeParams,
                isDefaultGrade,
                tonemap,
                maxProcPixels: maxProcPixels,
                onReady: () => {
                    try {
                        // Refit after the processor updates natural size (important in compare modes).
                        requestAnimationFrame(() => {
                            try {
                                if (!state?._userInteracted) {
                                    updateMediaNaturalSize?.();
                                    clampPanToBounds?.();
                                    applyTransform?.();
                                }
                            } catch {}
                        });
                    } catch {}
                    try {
                        scheduleOverlayRedraw?.();
                    } catch {}
                },
            });
            canvas._mjrProc?.setParams?.(getGradeParams?.());
        } catch {}
        return canvas;
    }

    // Update visible media transforms when pan/zoom changes.
    const applyTransformToVisibleMedia = () => {
        try {
            const t = mediaTransform?.() || "";
            const els = overlay?.querySelectorAll?.(".mjr-viewer-media") || [];
            for (const el of els) {
                try {
                    el.style.transform = t;
                } catch {}
            }
        } catch {}
    };

    return {
        createMediaElement,
        createCompareMediaElement,
        applyTransformToVisibleMedia,
    };
}
