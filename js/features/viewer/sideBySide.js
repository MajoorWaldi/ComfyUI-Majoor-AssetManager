export function renderSideBySideView({
    sideView,
    state,
    currentAsset,
    viewUrl,
    buildAssetViewURL,
    createMediaElement,
    destroyMediaProcessorsIn,
} = {}) {
    try {
        destroyMediaProcessorsIn?.(sideView);
    } catch {}
    try {
        if (sideView) sideView.innerHTML = "";
    } catch {}

    if (!sideView || !state || !currentAsset) return;

    const items = Array.isArray(state.assets) ? state.assets.slice(0, 4) : [];
    const count = items.length;

    if (count > 2) {
        // 2x2 grid (3 or 4 items). Do not wrap in another container: theme CSS targets direct children.
        try {
            sideView.style.display = "grid";
            sideView.style.gridTemplateColumns = "1fr 1fr";
            sideView.style.gridTemplateRows = "1fr 1fr";
            sideView.style.gap = "2px";
            sideView.style.padding = "2px";
        } catch {}

        for (let i = 0; i < 4; i++) {
            const cell = document.createElement("div");
            cell.style.cssText = `
                display: flex;
                align-items: center;
                justify-content: center;
                background: rgba(255,255,255,0.05);
                overflow: hidden;
            `;
            const a = items[i];
            if (a) {
                let u = "";
                try {
                    u = buildAssetViewURL?.(a) || "";
                } catch {}
                try {
                    const media = createMediaElement?.(a, u);
                    if (media) cell.appendChild(media);
                } catch {}
            }
            try {
                sideView.appendChild(cell);
            } catch {}
        }
        return;
    }

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

    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = `
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(255,255,255,0.05);
        overflow: hidden;
    `;
    const leftMedia = createMediaElement?.(currentAsset, viewUrl);
    if (leftMedia) leftPanel.appendChild(leftMedia);

    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = `
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(255,255,255,0.05);
        overflow: hidden;
    `;
    const rightMedia = createMediaElement?.(other, compareUrl);
    if (rightMedia) rightPanel.appendChild(rightMedia);

    try {
        sideView.style.display = "flex";
        sideView.style.flexDirection = "row";
        sideView.style.gap = "2px";
        sideView.style.padding = "0";
    } catch {}
    try {
        sideView.appendChild(leftPanel);
        sideView.appendChild(rightPanel);
    } catch {}

    // Tag roles for the global viewer bar (so it controls the "A" side by default).
    try {
        const leftVideo = leftMedia?.querySelector?.(".mjr-viewer-video-src") || leftMedia?.querySelector?.("video");
        const rightVideo = rightMedia?.querySelector?.(".mjr-viewer-video-src") || rightMedia?.querySelector?.("video");
        const leftAudio = leftMedia?.querySelector?.(".mjr-viewer-audio-src") || leftMedia?.querySelector?.("audio");
        const rightAudio = rightMedia?.querySelector?.(".mjr-viewer-audio-src") || rightMedia?.querySelector?.("audio");
        if (leftVideo?.dataset) leftVideo.dataset.mjrCompareRole = "A";
        if (rightVideo?.dataset) rightVideo.dataset.mjrCompareRole = "B";
        if (leftAudio?.dataset) leftAudio.dataset.mjrCompareRole = "A";
        if (rightAudio?.dataset) rightAudio.dataset.mjrCompareRole = "B";
    } catch {}

    // Video sync is handled centrally by the viewer bar (Viewer.js) so we avoid double-sync here.
}
