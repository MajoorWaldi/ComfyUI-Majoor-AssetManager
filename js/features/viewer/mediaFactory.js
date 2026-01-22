import { createImageProcessor, drawMediaError } from "./imageProcessor.js";
import { createVideoProcessor } from "./videoProcessor.js";

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
    videoGradeThrottleFps,
    safeAddListener,
    safeCall,
} = {}) {
    const _safeCall = safeCall || ((fn) => {
        try {
            return fn?.();
        } catch {
            return undefined;
        }
    });

    const _safeAddListener =
        safeAddListener ||
        ((target, event, handler, options) => {
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
        if (kind && kind !== "image" && kind !== "video") {
            const canvas = document.createElement("canvas");
            canvas.className = "mjr-viewer-media";
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

        if (kind === "video") {
            const canvas = document.createElement("canvas");
            canvas.className = "mjr-viewer-media";
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

        const canvas = document.createElement("canvas");
        canvas.className = "mjr-viewer-media";
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
        if (kind && kind !== "image" && kind !== "video") {
            const canvas = document.createElement("canvas");
            canvas.className = "mjr-viewer-media";
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

        if (kind === "video") {
            const wrap = document.createElement("div");
            wrap.style.cssText = "width:100%; height:100%; position:relative; display:flex; align-items:center; justify-content:center;";

            const canvas = document.createElement("canvas");
            canvas.className = "mjr-viewer-media";
            canvas.style.cssText = `
                max-width: 100%;
                max-height: 100%;
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

        const canvas = document.createElement("canvas");
        canvas.className = "mjr-viewer-media";
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
