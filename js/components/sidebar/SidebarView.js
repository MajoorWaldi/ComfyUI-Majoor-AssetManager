/**
 * Inline Asset Sidebar - Integrates into the Assets Manager panel
 *
 * This module keeps the public API stable (`createSidebar`, `showAssetInSidebar`, `closeSidebar`)
 * while delegating UI rendering/parsing to `js/components/sidebar/sections/*` and `parsers/*`.
 */

import { getAssetMetadata, getFileMetadata } from "../../api/client.js";
import { createFieldRow, createSection } from "./utils/dom.js";
import { createSidebarHeader } from "./sections/HeaderSection.js";
import { createPreviewSection } from "./sections/PreviewSection.js";
import { createRatingTagsSection } from "./sections/RatingTagsSection.js";
import { createFileInfoSection } from "./sections/FileInfoSection.js";
import { createGenerationSection } from "./sections/GenerationSection.js";
import { createWorkflowMinimapSection } from "./sections/WorkflowMinimapSection.js";
import { ASSET_RATING_CHANGED_EVENT, ASSET_TAGS_CHANGED_EVENT } from "../../app/events.js";

/**
 * Create inline sidebar (for panel integration)
 * @param {string} position - "left" or "right"
 */
export function createSidebar(position = "right") {
    const sidebar = document.createElement("div");
    sidebar.className = "mjr-inline-sidebar";

    sidebar.dataset.position = position;
    sidebar._requestSeq = 0;
    sidebar._closeTimer = null;

    const placeholder = document.createElement("div");
    placeholder.className = "mjr-sidebar-placeholder";
    placeholder.textContent = "Select an asset to view details";

    sidebar.appendChild(placeholder);
    sidebar._placeholder = placeholder;
    sidebar._currentAsset = null;
    sidebar._currentFullAsset = null;
    sidebar._ratingTagsSection = null;

    const unsubs = [];
    const ac = typeof AbortController !== "undefined" ? new AbortController() : null;
    sidebar._mjrAbortController = ac;
    sidebar._dispose = () => {
        try {
            ac?.abort?.();
        } catch {}
        try {
            for (const u of unsubs) u?.();
        } catch {}
        try {
            unsubs.length = 0;
        } catch {}
    };

    const matchesCurrent = (assetId) => {
        const id = sidebar._currentAsset?.id ?? sidebar._currentFullAsset?.id ?? null;
        if (id == null || assetId == null) return false;
        return String(id) === String(assetId);
    };

    const onRatingChanged = (ev) => {
        const detail = ev?.detail || {};
        const assetId = detail.assetId ?? detail.id ?? null;
        const rating = Number(detail.rating);
        if (!matchesCurrent(assetId)) return;
        if (!Number.isFinite(rating)) return;
        try {
            if (sidebar._currentAsset) sidebar._currentAsset.rating = rating;
            if (sidebar._currentFullAsset) sidebar._currentFullAsset.rating = rating;
            sidebar._ratingTagsSection?._mjrSetRating?.(rating);
        } catch {}
    };

    const onTagsChanged = (ev) => {
        const detail = ev?.detail || {};
        const assetId = detail.assetId ?? detail.id ?? null;
        const tags = Array.isArray(detail.tags) ? detail.tags : null;
        if (!matchesCurrent(assetId)) return;
        if (!tags) return;
        try {
            if (sidebar._currentAsset) sidebar._currentAsset.tags = tags;
            if (sidebar._currentFullAsset) sidebar._currentFullAsset.tags = tags;
            sidebar._ratingTagsSection?._mjrSetTags?.(tags);
        } catch {}
    };

    try {
        window.addEventListener(ASSET_RATING_CHANGED_EVENT, onRatingChanged, ac ? { signal: ac.signal } : undefined);
        window.addEventListener(ASSET_TAGS_CHANGED_EVENT, onTagsChanged, ac ? { signal: ac.signal } : undefined);
    } catch {
        try {
            window.addEventListener(ASSET_RATING_CHANGED_EVENT, onRatingChanged);
            window.addEventListener(ASSET_TAGS_CHANGED_EVENT, onTagsChanged);
            unsubs.push(() => {
                try {
                    window.removeEventListener(ASSET_RATING_CHANGED_EVENT, onRatingChanged);
                } catch {}
                try {
                    window.removeEventListener(ASSET_TAGS_CHANGED_EVENT, onTagsChanged);
                } catch {}
            });
        } catch {}
    }

    return sidebar;
}

const cleanupMinimapSections = (root) => {
    try {
        if (!root) return;
        const sections = root.querySelectorAll(".mjr-sidebar-section");
        sections.forEach((section) => {
            try {
                section._mjrMinimapCleanup?.();
            } catch {}
        });
    } catch {}
};

/**
 * Show asset in inline sidebar
 */
export async function showAssetInSidebar(sidebar, asset, onUpdate) {
    if (!sidebar || !asset) return;

    const hasMeaningfulMetadataRaw = (value) => {
        if (value == null) return false;
        if (typeof value === "string") {
            const trimmed = value.trim();
            if (!trimmed) return false;
            return trimmed !== "{}" && trimmed !== "null";
        }
        if (typeof value === "object") {
            try {
                return Object.keys(value).length > 0;
            } catch {
                return false;
            }
        }
        return true;
    };

    const hasGenerationLikeData = (obj) => {
        if (!obj) return false;
        return !!(obj.geninfo || obj.prompt || hasMeaningfulMetadataRaw(obj.metadata_raw));
    };

    try {
        if (sidebar._closeTimer) {
            clearTimeout(sidebar._closeTimer);
            sidebar._closeTimer = null;
        }
    } catch {}

    const requestSeq = (sidebar._requestSeq = (sidebar._requestSeq || 0) + 1);
    sidebar._currentFetchAbortController?.abort?.();
    sidebar._currentFetchAbortController = null;

    sidebar.classList.add("is-open");

    if (sidebar._placeholder && sidebar._placeholder.parentNode) {
        sidebar._placeholder.remove();
    }

    sidebar.innerHTML = "";
    sidebar._currentAsset = asset;
    sidebar._currentFullAsset = asset;
    sidebar._ratingTagsSection = null;

    const header = createSidebarHeader(asset, () => closeSidebar(sidebar));
    const content = document.createElement("div");
    content.className = "mjr-sidebar-content";
    content.style.cssText = `
        flex: 1;
        overflow-y: auto;
        padding: 10px 12px;
        display: flex;
        flex-direction: column;
        gap: 20px;
    `;

    sidebar.appendChild(header);
    sidebar.appendChild(content);

    let fullAsset = asset;
    const renderContent = (data) => {
        if (sidebar._requestSeq !== requestSeq || sidebar._currentAsset !== asset) return;
        cleanupMinimapSections(content);
        content.innerHTML = "";
        content.appendChild(createPreviewSection(data));
        const ratingTagsSection = createRatingTagsSection(data, onUpdate);
        sidebar._ratingTagsSection = ratingTagsSection;
        content.appendChild(ratingTagsSection);
        const fileInfoSection = createFileInfoSection(data);
        if (fileInfoSection) content.appendChild(fileInfoSection);
        const genMetadata = createGenerationSection(data);
        if (genMetadata) content.appendChild(genMetadata);
        const workflow = createWorkflowMinimapSection(data);
        if (workflow) content.appendChild(workflow);
        sidebar._currentFullAsset = data;
    };

    renderContent(fullAsset);

    const tryUpdateWith = (extra = {}) => {
        const updated = { ...fullAsset, ...extra };
        fullAsset = updated;
        renderContent(fullAsset);
        try {
            if (typeof onUpdate === "function") onUpdate(fullAsset);
        } catch {}
    };

    const buildFetchOptions = () => {
        sidebar._currentFetchAbortController?.abort?.();
        const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
        sidebar._currentFetchAbortController = controller;
        return controller?.signal ? { signal: controller.signal } : {};
    };

    const loadMetadataAsync = async () => {
        if (sidebar._requestSeq !== requestSeq || sidebar._currentAsset !== asset) return;
        const opts = buildFetchOptions();
        const signal = opts.signal;
        try {
            if (asset.id && (!hasGenerationLikeData(fullAsset) && !fullAsset.exif)) {
                const result = await getAssetMetadata(asset.id, opts);
                if (signal?.aborted) return;
                if (result?.ok && result.data) {
                    tryUpdateWith(result.data);
                }
            }
        } catch (err) {
            if (!(signal?.aborted)) console.warn("Failed to load full asset metadata:", err);
        }
        if (signal?.aborted) return;

        if (!hasGenerationLikeData(fullAsset)) {
            const filePath = fullAsset?.filepath || fullAsset?.path || fullAsset?.file_info?.filepath || null;
            if (typeof filePath === "string" && filePath.trim()) {
                try {
                    const result = await getFileMetadata(filePath, opts);
                    if (signal?.aborted) return;
                    if (result?.ok && result.data) {
                        const md = result.data;
                        const updates = {
                            prompt: fullAsset.prompt ?? md.prompt,
                            workflow: fullAsset.workflow ?? md.workflow,
                            geninfo: fullAsset.geninfo ?? md.geninfo,
                            exif: fullAsset.exif ?? md.exif,
                            ffprobe: fullAsset.ffprobe ?? md.ffprobe,
                            metadata_raw: fullAsset.metadata_raw ?? md,
                        };
                        tryUpdateWith(updates);
                    }
                } catch (err) {
                    if (!(signal?.aborted)) console.warn("Failed to load metadata by filepath:", err);
                }
            }
        }

        if (!signal?.aborted) {
            sidebar._currentFetchAbortController = null;
        }
    };

    void loadMetadataAsync();
}

/**
 * Close inline sidebar
 */
export function closeSidebar(sidebar) {
    if (!sidebar) return;

    sidebar._requestSeq = (sidebar._requestSeq || 0) + 1;
    sidebar.classList.remove("is-open");
    sidebar._currentAsset = null;
    sidebar._currentFetchAbortController?.abort?.();
    sidebar._currentFetchAbortController = null;

    // Dispatch event so controllers can update their state
    try {
        sidebar.dispatchEvent?.(new CustomEvent("mjr:sidebar-closed", { bubbles: true }));
    } catch {}

}

// Raw metadata is now available as a toggle inside WorkflowMinimapSection.
