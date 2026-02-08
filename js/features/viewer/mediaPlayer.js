import { mountVideoControls } from "../../components/VideoControls.js";

export function isPlayableViewerKind(kind) {
    const k = String(kind || "").toLowerCase();
    return k === "video" || k === "audio";
}

export function collectPlayableMediaElements({ mode, VIEWER_MODES, singleView, abView, sideView } = {}) {
    try {
        let root = singleView;
        if (mode === VIEWER_MODES?.AB_COMPARE) root = abView;
        else if (mode === VIEWER_MODES?.SIDE_BY_SIDE) root = sideView;
        if (!root) return [];
        return Array.from(root.querySelectorAll?.(".mjr-viewer-video-src, .mjr-viewer-audio-src") || []);
    } catch {
        return [];
    }
}

export function pickPrimaryPlayableMedia(elements) {
    try {
        const arr = Array.isArray(elements) ? elements : [];
        return arr.find((v) => String(v?.dataset?.mjrCompareRole || "") === "A") || arr[0] || null;
    } catch {
        return null;
    }
}

export function mountUnifiedMediaControls(mediaEl, opts = {}) {
    try {
        if (!mediaEl) return null;
        const mediaKind = String(opts?.mediaKind || "").toLowerCase();
        return mountVideoControls(mediaEl, { ...opts, mediaKind });
    } catch {
        return null;
    }
}

