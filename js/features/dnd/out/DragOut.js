/**
 * Drag-out support (AssetsManager -> OS / Explorer).
 *
 * Implements "DownloadURL" + "text/uri-list" so users can drop an asset
 * outside ComfyUI (desktop, Explorer, other apps).
 *
 * Also supports multi-selection: creates a temporary ZIP on the backend and
 * drags that ZIP URL instead of individual files.
 */

import { post } from "../../../api/client.js";
import { ENDPOINTS, buildBatchZipDownloadURL } from "../../../api/endpoints.js";
import { getDownloadMimeForFilename } from "../utils/video.js";
import { pickRootId } from "../../../utils/ids.js";

const _abs = (url) => {
    try {
        return new URL(String(url || ""), window.location.href).href;
    } catch {
        return String(url || "");
    }
};

const _makeToken = () => {
    try {
        const cryptoObj = globalThis?.crypto || window?.crypto;
        if (cryptoObj?.getRandomValues) {
            const bytes = new Uint8Array(18); // 144 bits
            cryptoObj.getRandomValues(bytes);
            let bin = "";
            for (let i = 0; i < bytes.length; i++) {
                bin += String.fromCharCode(bytes[i]);
            }
            const b64 = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
            return `mjr_${b64}`;
        }
        return `mjr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    } catch {
        return `mjr_${Date.now()}`;
    }
};

const _assetToZipItem = (asset) => {
    const a = asset && typeof asset === "object" ? asset : null;
    if (!a) return null;
    const filename = a.filename || a.name;
    if (!filename) return null;
    return {
        filename,
        subfolder: a.subfolder || "",
        type: String(a.type || "output").toLowerCase(),
        root_id: pickRootId(a) || undefined
    };
};

const _getSelectedAssets = (containerEl, draggedCard) => {
    const out = [];
    if (!containerEl || !draggedCard) return out;

    let selectedIds = [];
    try {
        const raw = containerEl.dataset?.mjrSelectedAssetIds;
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) selectedIds = parsed.map(String).filter(Boolean);
        }
    } catch {}

    // If dataset is available, use full asset list (VirtualGrid-safe).
    if (selectedIds.length) {
        try {
            const draggedId = draggedCard?.dataset?.mjrAssetId ? String(draggedCard.dataset.mjrAssetId) : "";
            if (!draggedId || !selectedIds.includes(draggedId)) return out;
            const allAssets = typeof containerEl?._mjrGetAssets === "function" ? containerEl._mjrGetAssets() : [];
            for (const a of allAssets || []) {
                const id = String(a?.id || "");
                if (id && selectedIds.includes(id)) out.push(a);
            }
            if (out.length) return out;
        } catch {}
    }

    // Fallback: DOM selection state (visible cards only).
    let selectedCards = [];
    try {
        selectedCards = Array.from(containerEl.querySelectorAll(".mjr-asset-card.is-selected")) || [];
    } catch {
        selectedCards = [];
    }

    // Only treat it as "multi" if the dragged card is part of the selection.
    try {
        if (!selectedCards.includes(draggedCard)) {
            return out;
        }
    } catch {
        return out;
    }

    for (const el of selectedCards) {
        const asset = el?._mjrAsset;
        if (!asset || typeof asset !== "object") continue;
        out.push(asset);
    }
    return out;
};

export const applyDragOutToOS = ({ dt, asset, containerEl, card, viewUrl }) => {
    if (!dt || !asset) return;

    const selected = _getSelectedAssets(containerEl, card);
    if (Array.isArray(selected) && selected.length > 1) {
        const items = selected.map(_assetToZipItem).filter(Boolean);
        if (items.length > 1) {
            const token = _makeToken();

            // Fire-and-forget zip build. Never block dragstart.
            try {
                post(ENDPOINTS.BATCH_ZIP_CREATE, { token, items }).catch(() => {});
            } catch {}

            const url = _abs(buildBatchZipDownloadURL(token));
            const zipName = `Majoor_Batch_${items.length}.zip`;
            try {
                dt.setData("text/uri-list", url);
                dt.setData("DownloadURL", `application/zip:${zipName}:${url}`);
                dt.effectAllowed = "copy";
            } catch {}
            return;
        }
    }

    // Single asset drag-out.
    const filename = asset.filename || asset.name;
    if (!filename) return;

    const url = _abs(viewUrl);
    const mime = getDownloadMimeForFilename(filename);
    try {
        dt.setData("text/uri-list", url);
        dt.setData("DownloadURL", `${mime}:${filename}:${url}`);
        dt.effectAllowed = "copy";
    } catch {}
};
