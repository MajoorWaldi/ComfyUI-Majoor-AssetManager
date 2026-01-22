import { APP_CONFIG } from "../../app/config.js";

export const noop = () => {};

function _debugEnabled(flag) {
    try {
        return Boolean(APP_CONFIG?.[flag]);
    } catch {
        return false;
    }
}

function _warn(label, err) {
    try {
        // Keep it short and non-throwing; only logs when debug flags are enabled.
        console.warn(`[Majoor][viewer] ${label}`, err);
    } catch {}
}

export function safeCall(fn, label = "safeCall") {
    try {
        return fn?.();
    } catch (err) {
        if (_debugEnabled("DEBUG_SAFE_CALL")) _warn(label, err);
        return undefined;
    }
}

export function safeAddListener(target, event, handler, options, label = "safeAddListener") {
    try {
        target?.addEventListener?.(event, handler, options);
        return () => {
            try {
                target?.removeEventListener?.(event, handler, options);
            } catch (err) {
                if (_debugEnabled("DEBUG_SAFE_LISTENERS")) _warn(`${label}:remove:${String(event || "")}`, err);
            }
        };
    } catch (err) {
        if (_debugEnabled("DEBUG_SAFE_LISTENERS")) {
            _warn(`${label}:add:${String(event || "")}`, err);
        }
        return noop;
    }
}

export function destroyMediaProcessorsIn(rootEl) {
    if (!rootEl) return;
    try {
        rootEl._mjrSyncAbort?.abort?.();
    } catch {}
    try {
        rootEl._mjrSyncAbort = null;
    } catch {}

    // Stop any media elements first (best-effort).
    try {
        const mediaEls = rootEl.querySelectorAll?.("video, audio");
        if (mediaEls && mediaEls.length) {
            for (const el of mediaEls) {
                try {
                    el.pause?.();
                } catch {}
                try {
                    el.currentTime = 0;
                } catch {}
                try {
                    el.removeAttribute?.("src");
                } catch {}
                try {
                    el.load?.();
                } catch {}
            }
        }
    } catch {}

    try {
        const canvases = rootEl.querySelectorAll?.(".mjr-viewer-media");
        if (canvases && canvases.length) {
            for (const c of canvases) {
                try {
                    c?._mjrProc?.destroy?.();
                } catch {}
                try {
                    c._mjrProc = null;
                } catch {}
                try {
                    c.width = 0;
                    c.height = 0;
                } catch {}
            }
        }
    } catch {}
}

export function createViewerLifecycle(overlay) {
    const unsubs = [];
    try {
        overlay._mjrViewerUnsubs = unsubs;
    } catch {}

    const lifecycle = {
        unsubs,
        safeAddListener,
        safeCall,
        destroyMediaProcessorsIn,
        _observer: null,
        disposeAll: () => {
            try {
                lifecycle._observer?.disconnect?.();
            } catch {}
            try {
                for (const u of unsubs) safeCall(u);
            } catch {}
            try {
                unsubs.length = 0;
            } catch {}
        },
    };

    // Fallback: if the overlay is removed from DOM without calling dispose, clean up listeners.
    try {
        if (overlay && typeof MutationObserver !== "undefined") {
            const obs = new MutationObserver(() => {
                try {
                    if (!document.contains(overlay)) {
                        try {
                            obs.disconnect();
                        } catch {}
                        safeCall(() => lifecycle.disposeAll?.(), "lifecycle:autoDispose");
                    }
                } catch {}
            });
            obs.observe(document.body, { childList: true, subtree: true });
            lifecycle._observer = obs;
        }
    } catch {}

    try {
        overlay._mjrViewerLifecycle = lifecycle;
    } catch {}

    return lifecycle;
}
