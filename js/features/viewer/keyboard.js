import { safeAddListener, safeCall } from "./lifecycle.js";
import { comfyToast } from "../../app/toast.js";
import { t } from "../../app/i18n.js";

export function installViewerKeyboard({
    overlay,
    _content,
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
    getVideoControls,
    lifecycle,
    renderGenInfoPanel,
} = {}) {
    const unsubs = lifecycle?.unsubs || [];

    let ratingDebounceTimer = null;
    let ratingPending = null;

    const clearRatingDebounce = () => {
        try {
            if (ratingDebounceTimer) clearTimeout(ratingDebounceTimer);
        } catch {}
        ratingDebounceTimer = null;
        ratingPending = null;
    };

    const scheduleRatingUpdate = (assetId, rating) => {
        clearRatingDebounce();
        ratingPending = { assetId, rating };
        ratingDebounceTimer = setTimeout(async () => {
            const pending = ratingPending;
            ratingDebounceTimer = null;
            ratingPending = null;
            if (!pending?.assetId) return;
            try {
                const result = await updateAssetRating?.(pending.assetId, pending.rating);
                if (!result?.ok) {
                    comfyToast(result?.error || t("toast.ratingUpdateFailed"), "error");
                    return;
                }
                
                comfyToast(t("toast.ratingSetN", { n: pending.rating }), "success", 1500);
                
                safeDispatchCustomEvent?.(
                    ASSET_RATING_CHANGED_EVENT,
                    { assetId: String(pending.assetId), rating: pending.rating },
                    { warnPrefix: "[Viewer]" }
                );
            } catch {
                comfyToast(t("toast.ratingUpdateError"), "error");
            }
        }, 300);
    };

    const toggleFullscreen = () => {
        try {
            if (!document.fullscreenElement) {
                overlay?.requestFullscreen?.();
            } else {
                document?.exitFullscreen?.();
            }
        } catch {}
    };

    const handleKeyboard = (e) => {
        const consume = () => {
            try {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation?.();
            } catch {}
        };

        // Check if hotkeys are suspended (e.g. when dialogs/popovers are open)
        if (globalThis?._mjrHotkeysState?.suspended) return;

        try {
            if (overlay?.style?.display === "none") return;
        } catch {}

        // If an input-like element is focused inside the viewer, avoid hijacking typing.
        try {
            const t = e?.target;
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
                if (e.key === "f" || e.key === "F") {
                    consume();
                    toggleFullscreen();
                    return;
                }

                if (e.key === "Escape") {
                    consume();
                    safeCall(closeViewer);
                }
                return;
            }
        } catch {}

        const isSingle = state?.mode === VIEWER_MODES?.SINGLE;
        const current = state?.assets?.[state?.currentIndex];

        const setRatingFromKey = async (key) => {
            if (!isSingle) return false;
            if (!current?.id) return false;
            if (key !== "0" && key !== "1" && key !== "2" && key !== "3" && key !== "4" && key !== "5") return false;
            const rating = key === "0" ? 0 : Number(key);
            if (!Number.isFinite(rating)) return false;

            try {
                current.rating = rating;
                safeCall(renderBadges);
                scheduleRatingUpdate(current.id, rating);
                return true;
            } catch {
                return true;
            }
        };

        const getControls = () => {
            try {
                return getVideoControls?.() || null;
            } catch {
                return null;
            }
        };

        const stepFrame = async (direction) => {
            if (!isSingle) return false;
            if (current?.kind !== "video") return false;

            // Prefer the mounted player bar logic (respects In/Out range + step + loop).
            try {
                const controls = getControls();
                if (controls?.stepFrames) {
                    controls.stepFrames(direction);
                    return true;
                }
            } catch {}

            const video = singleView?.querySelector?.("video");
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
                const next = Math.max(
                    0,
                    Math.min(Number.isFinite(duration) ? duration : Infinity, (video.currentTime || 0) + delta)
                );
                video.currentTime = next;
                try {
                    video.dispatchEvent?.(new CustomEvent("mjr:frameStep", { detail: { direction, time: next } }));
                } catch {}
                return true;
            } catch {
                return true;
            }
        };

        const changePlaybackRate = (deltaOrAbsolute, { absolute = false } = {}) => {
            try {
                const controls = getControls();
                if (!controls) return false;
                if (absolute) {
                    const rate = controls.setPlaybackRate?.(deltaOrAbsolute);
                    if (Number.isFinite(Number(rate))) {
                        state.playbackRate = Number(rate);
                        comfyToast(`Playback ${Number(rate).toFixed(2)}x`, "info", 1200);
                        return true;
                    }
                    return false;
                }
                const rate = controls.adjustPlaybackRate?.(deltaOrAbsolute);
                if (Number.isFinite(Number(rate))) {
                    state.playbackRate = Number(rate);
                    comfyToast(`Playback ${Number(rate).toFixed(2)}x`, "info", 1200);
                    return true;
                }
                return false;
            } catch {
                return false;
            }
        };

        // Rating shortcuts (viewer single only). Ignore modifier combos so we can reserve Alt+keys for viewer tools.
        if (
            isSingle &&
            !e.altKey &&
            !e.ctrlKey &&
            !e.metaKey &&
            (e.key === "0" || e.key === "1" || e.key === "2" || e.key === "3" || e.key === "4" || e.key === "5")
        ) {
            consume();
            void setRatingFromKey(e.key);
            return;
        }

        // Frame-by-frame logic is now handled in Arrow shortcuts contextually

        switch (e.key) {
            case "1": {
                // Alt+1 toggles 1:1 pixel zoom (plain "1" is used for rating hotkeys).
                if (!e.altKey) break;
                const z = safeCall(computeOneToOneZoom);
                if (z == null) break;
                consume();
                try {
                    const near = Math.abs((Number(state?.zoom) || 1) - z) < 0.01;
                    setZoom?.(near ? 1 : z, { clientX: state?._lastPointerX, clientY: state?._lastPointerY });
                } catch {}
                break;
            }
            case "g":
            case "G": {
                consume();
                try {
                    state.gridMode = ((Number(state.gridMode) || 0) + 1) % 5;
                } catch {}
                safeCall(scheduleOverlayRedraw);
                safeCall(syncToolsUIFromState);
                break;
            }
            case "f":
            case "F": {
                consume();
                toggleFullscreen();
                break;
            }
            case "d":
            case "D": {
                consume();
                 try {
                     state.genInfoOpen = !state.genInfoOpen;
                 } catch {}
                 safeCall(syncToolsUIFromState);
                 safeCall(renderGenInfoPanel);
                break;
            }
            case "z":
            case "Z": {
                consume();
                try {
                    state.analysisMode = state.analysisMode === "zebra" ? "none" : "zebra";
                } catch {}
                safeCall(syncToolsUIFromState);
                safeCall(scheduleApplyGrade);
                break;
            }
            case "i":
            case "I": {
                consume();
                try {
                    state.probeEnabled = !state.probeEnabled;
                } catch {}
                try {
                    if (!state.probeEnabled) probeTooltip.style.display = "none";
                } catch {}
                safeCall(syncToolsUIFromState);
                break;
            }
            case "l":
            case "L": {
                consume();
                try {
                    state.loupeEnabled = !state.loupeEnabled;
                } catch {}
                try {
                    if (!state.loupeEnabled) loupeWrap.style.display = "none";
                } catch {}
                safeCall(syncToolsUIFromState);
                break;
            }
            case "x":
            case "X": {
                consume();
                try {
                    state.distractionFree = !state.distractionFree;
                } catch {}
                safeCall(syncToolsUIFromState);
                safeCall(renderGenInfoPanel);
                break;
            }
            case "c":
            case "C": {
                const p = state?._probe;
                if (!p || p.r == null || p.g == null || p.b == null) break;
                const hex = `#${[p.r, p.g, p.b]
                    .map((v) => {
                        const n = Math.max(0, Math.min(255, Number(v) || 0));
                        return n.toString(16).padStart(2, "0");
                    })
                    .join("")}`;
                try {
                    const clip = navigator?.clipboard;
                    if (clip?.writeText) {
                        consume();
                        void clip.writeText(hex).catch(() => {});
                    }
                } catch {}
                break;
            }
            case " ":
            case "Spacebar": {
                if (isSingle && current?.kind === "video") {
                    const videoEl = singleView?.querySelector?.("video");
                    if (videoEl) {
                        consume();
                        try {
                            const controls = getControls();
                            if (controls?.togglePlay) {
                                controls.togglePlay();
                                break;
                            }
                        } catch {}
                        try {
                            if (videoEl.paused) {
                                const p = videoEl.play?.();
                                if (p && typeof p.catch === "function") p.catch(() => {});
                            } else {
                                videoEl.pause?.();
                            }
                        } catch {}
                        break;
                    }
                }
                break;
            }
            case "Tab": {
                consume();
                try {
                    if (!overlay?.contains?.(document.activeElement)) overlay?.focus?.();
                } catch {}
                break;
            }
            case "Escape":
                consume();
                safeCall(closeViewer);
                break;
            case "ArrowLeft":
                if (isSingle && e.target?.closest?.(".mjr-viewer-playerbar")) {
                    consume();
                    void stepFrame(-1);
                    break;
                }
                consume();
                safeCall(() => navigateViewerAssets?.(-1));
                break;
            case "ArrowRight":
                if (isSingle && e.target?.closest?.(".mjr-viewer-playerbar")) {
                    consume();
                    void stepFrame(1);
                    break;
                }
                consume();
                safeCall(() => navigateViewerAssets?.(1));
                break;
            case "[":
            case "{": {
                consume();
                if (!changePlaybackRate(-0.25)) {
                    comfyToast(t("toast.playbackVideoOnly"), "warning", 1400);
                }
                break;
            }
            case "]":
            case "}": {
                consume();
                if (!changePlaybackRate(0.25)) {
                    comfyToast(t("toast.playbackVideoOnly"), "warning", 1400);
                }
                break;
            }
            case "\\":
            case "|": {
                consume();
                if (!changePlaybackRate(1, { absolute: true })) {
                    comfyToast(t("toast.playbackVideoOnly"), "warning", 1400);
                }
                break;
            }
            case "+":
            case "=":
                consume();
                try {
                    setZoom?.((Number(state?.zoom) || 1) + 0.25, { clientX: state?._lastPointerX, clientY: state?._lastPointerY });
                } catch {}
                break;
            case "-":
            case "_":
                consume();
                try {
                    setZoom?.((Number(state?.zoom) || 1) - 0.25, { clientX: state?._lastPointerX, clientY: state?._lastPointerY });
                } catch {}
                break;
        }
    };

    let keyUnsub = null;
    const bind = () => {
        try {
            if (keyUnsub) return;
            keyUnsub = safeAddListener(window, "keydown", handleKeyboard, true);
        } catch {}
    };
    const unbind = () => {
        try {
            safeCall(keyUnsub);
        } catch {}
        keyUnsub = null;
    };

    unsubs.push(() => clearRatingDebounce());
    unsubs.push(() => unbind());

    return {
        bind,
        unbind,
        dispose: () => {
            clearRatingDebounce();
            unbind();
        },
    };
}
