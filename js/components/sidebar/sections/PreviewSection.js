import { buildAssetViewURL } from "../../../api/endpoints.js";
import { formatFileSize, formatShortDate } from "../utils/format.js";
import { mountVideoControls } from "../../VideoControls.js";

export function createPreviewSection(asset, options = {}) {
    const showPreviewThumb = !!(options?.showPreviewThumb ?? true);
    const section = document.createElement("div");
    section.className = "mjr-sidebar-preview";

    const previewContainer = document.createElement("div");
    previewContainer.style.cssText = `
        width: 100%;
        aspect-ratio: 1;
        background: black;
        border-radius: 8px;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
    `;

    const viewUrl = buildAssetViewURL(asset);

    if (showPreviewThumb) {
        if (asset.kind === "image") {
            const img = document.createElement("img");
            img.src = viewUrl;
            img.style.cssText = `
                max-width: 100%;
                max-height: 100%;
                object-fit: contain;
            `;
            previewContainer.appendChild(img);
        } else if (asset.kind === "video") {
            const video = document.createElement("video");
            video.src = viewUrl;
            video.controls = false;
            video.autoplay = true;
            video.loop = true;
            video.muted = true;
            video.playsInline = true;
            video.preload = "metadata";
            video.style.cssText = `
                max-width: 100%;
                max-height: 100%;
                object-fit: contain;
            `;
            previewContainer.appendChild(video);
            // Best-effort auto-play (muted loop). Some browsers require a direct play() attempt even with autoplay.
            try {
                const tryPlay = () => {
                    try {
                        const p = video.play?.();
                        if (p && typeof p.catch === "function") p.catch(() => {});
                    } catch {}
                };
                video.addEventListener("loadedmetadata", tryPlay, { passive: true });
                video.addEventListener("canplay", tryPlay, { passive: true });
                tryPlay();
            } catch {}
            try {
                mountVideoControls(video, { variant: "preview", hostEl: previewContainer });
            } catch {}
        } else if (asset.kind === "audio") {
            const audio = document.createElement("audio");
            audio.src = viewUrl;
            audio.controls = true;
            audio.preload = "metadata";
            audio.style.cssText = `
                width: 92%;
                max-width: 560px;
            `;
            previewContainer.appendChild(audio);
        } else {
            const placeholder = document.createElement("div");
            placeholder.textContent = asset.kind?.toUpperCase() || "PREVIEW";
            placeholder.style.cssText = `
                color: rgba(255,255,255,0.4);
                font-size: 14px;
            `;
            previewContainer.appendChild(placeholder);
        }
    }

    const metaLine = document.createElement("div");
    metaLine.className = "mjr-sidebar-preview-meta";
    metaLine.style.cssText = `
        margin-top: 10px;
        font-size: 12px;
        color: var(--mjr-muted, rgba(255,255,255,0.65));
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
        line-height: 1.3;
        padding-bottom: 12px;
        border-bottom: 1px solid var(--mjr-border, rgba(255,255,255,0.12));
    `;

    const ext = (() => {
        const name = String(asset?.filename || "");
        const idx = name.lastIndexOf(".");
        if (idx === -1) return "";
        return name.slice(idx + 1).toUpperCase();
    })();

    const parts = [];
    if (ext) parts.push(ext);
    if (asset?.kind) parts.push(String(asset.kind).toLowerCase());
    const size = formatFileSize(asset?.size);
    if (size) parts.push(size);
    const date = formatShortDate(asset?.mtime);
    if (date) parts.push(date);
    metaLine.textContent = parts.join(" • ");

    if (showPreviewThumb) {
        section.appendChild(previewContainer);
    }
    section.appendChild(metaLine);
    return section;
}

