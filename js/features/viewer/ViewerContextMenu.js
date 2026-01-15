import { buildAssetViewURL } from "../../api/endpoints.js";
import { comfyAlert, comfyConfirm, comfyPrompt } from "../../app/dialogs.js";
import { openInFolder, updateAssetRating, deleteAsset, renameAsset } from "../../api/client.js";
import { ASSET_RATING_CHANGED_EVENT, ASSET_TAGS_CHANGED_EVENT } from "../../app/events.js";
import { createTagsEditor } from "../../components/TagsEditor.js";
import { safeDispatchCustomEvent } from "../../utils/events.js";
import { getOrCreateMenu, createMenuItem, createMenuSeparator, showMenuAt } from "../../components/contextmenu/MenuCore.js";
import { hideMenu, clearMenu } from "../../components/contextmenu/MenuCore.js";
import { showAddToCollectionMenu } from "../collections/contextmenu/addToCollectionMenu.js";

const MENU_SELECTOR = ".mjr-viewer-context-menu";
const POPOVER_SELECTOR = ".mjr-viewer-popover";

function createMenu() {
    return getOrCreateMenu({
        selector: MENU_SELECTOR,
        className: "mjr-viewer-context-menu",
        minWidth: 220,
        zIndex: 10001,
        onHide: null,
    });
}

const createItem = createMenuItem;
const separator = createMenuSeparator;
const showAt = showMenuAt;

function getOrCreateRatingSubmenu() {
    return getOrCreateMenu({
        selector: ".mjr-viewer-rating-submenu",
        className: "mjr-viewer-rating-submenu",
        minWidth: 200,
        zIndex: 10002,
        onHide: null,
    });
}

function showSubmenuNextTo(anchorEl, menuEl) {
    if (!anchorEl || !menuEl) return;
    const rect = anchorEl.getBoundingClientRect();
    const x = Math.round(rect.right + 6);
    const y = Math.round(rect.top - 4);
    showAt(menuEl, x, y);
}

function showTagsPopover(x, y, asset, onChanged) {
    try {
        const existing = document.querySelector(POPOVER_SELECTOR);
        try {
            existing?._mjrAbortController?.abort?.();
        } catch {}
        existing?.remove?.();
    } catch {}

    const pop = document.createElement("div");
    pop.className = "mjr-viewer-popover";
    pop.style.cssText = `
        position: fixed;
        z-index: 10002;
        left: ${x}px;
        top: ${y}px;
    `;

    const ac = new AbortController();
    pop._mjrAbortController = ac;

    const editor = createTagsEditor(asset, (tags) => {
        asset.tags = tags;
        safeDispatchCustomEvent(
            ASSET_TAGS_CHANGED_EVENT,
            { assetId: String(asset.id), tags },
            { warnPrefix: "[ViewerContextMenu]" }
        );
        try {
            onChanged?.();
        } catch {}
    });
    pop.appendChild(editor);
    document.body.appendChild(pop);

    const hide = () => {
        try {
            pop._mjrAbortController?.abort?.();
        } catch {}
        try {
            pop.remove?.();
        } catch {}
    };

    // Dismiss when clicking outside (so clicking inside input doesn't close it).
    try {
        document.addEventListener(
            "mousedown",
            (e) => {
                if (!pop.contains(e.target)) hide();
            },
            { capture: true, signal: ac.signal }
        );
        document.addEventListener(
            "keydown",
            (e) => {
                if (e.key === "Escape") hide();
            },
            { capture: true, signal: ac.signal }
        );
        document.addEventListener("scroll", hide, { capture: true, signal: ac.signal });
    } catch {}

    // Clamp into viewport
    const rect = pop.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let fx = x;
    let fy = y;
    if (x + rect.width > vw) fx = vw - rect.width - 10;
    if (y + rect.height > vh) fy = vh - rect.height - 10;
    pop.style.left = `${Math.max(8, fx)}px`;
    pop.style.top = `${Math.max(8, fy)}px`;
}

async function setRating(asset, rating, onChanged) {
    const assetId = asset?.id;
    if (!assetId) return;
    try {
        const result = await updateAssetRating(assetId, rating);
        if (!result?.ok) return;
        asset.rating = rating;
        safeDispatchCustomEvent(
            ASSET_RATING_CHANGED_EVENT,
            { assetId: String(assetId), rating },
            { warnPrefix: "[ViewerContextMenu]" }
        );
        onChanged?.();
    } catch {}
}

export function bindViewerContextMenu({
    overlayEl,
    getCurrentAsset,
    getCurrentViewUrl,
    onAssetChanged,
} = {}) {
    if (!overlayEl || typeof getCurrentAsset !== "function") return;
    if (overlayEl._mjrViewerContextMenuBound) return;
    overlayEl._mjrViewerContextMenuBound = true;

    const menu = createMenu();

    overlayEl.addEventListener("contextmenu", async (e) => {
        if (!overlayEl.contains(e.target)) return;
        e.preventDefault();
        e.stopPropagation();

        const asset = getCurrentAsset();
        if (!asset) return;

        menu.innerHTML = "";

        const viewUrl = typeof getCurrentViewUrl === "function" ? getCurrentViewUrl(asset) : buildAssetViewURL(asset);

        menu.appendChild(
            createItem("Open in New Tab", "pi pi-external-link", null, () => {
                window.open(viewUrl, "_blank");
            })
        );

        menu.appendChild(
            createItem("Copy file path", "pi pi-copy", null, async () => {
                const p = asset?.filepath ? String(asset.filepath) : "";
                if (!p) {
                    await comfyAlert("No file path available for this asset.");
                    return;
                }
                try {
                    await navigator.clipboard.writeText(p);
                } catch {}
            })
        );

        menu.appendChild(
            createItem("Open in Folder", "pi pi-folder-open", null, async () => {
                if (!asset?.id) return;
                const res = await openInFolder(asset.id);
                if (!res?.ok) {
                    await comfyAlert(res?.error || "Failed to open folder.");
                }
            }, { disabled: !asset?.id })
        );

        menu.appendChild(
            createItem("Add to collection...", "pi pi-bookmark", null, async () => {
                try {
                    hideMenu(menu);
                } catch {}
                try {
                    await showAddToCollectionMenu({ x: e.clientX, y: e.clientY, assets: [asset] });
                } catch (err) {
                    try {
                        console.error("Add to collection failed:", err);
                    } catch {}
                }
            })
        );

        menu.appendChild(separator());

        menu.appendChild(createItem("Edit Tags…", "pi pi-tags", null, () => {
            try {
                hideMenu(menu);
            } catch {}
            showTagsPopover(e.clientX + 6, e.clientY + 6, asset, onAssetChanged);
        }));

        menu.appendChild(separator());

        const ratingRoot = createItem("Set rating", "pi pi-star", "›", () => {}, { disabled: !asset?.id });
        ratingRoot.style.cursor = !asset?.id ? "default" : "pointer";
        menu.appendChild(ratingRoot);

        let hideTimer = null;
        const ratingSubmenu = getOrCreateRatingSubmenu();

        const closeRatingSubmenu = () => {
            try {
                hideMenu(ratingSubmenu);
                clearMenu(ratingSubmenu);
            } catch {}
        };

        const scheduleClose = () => {
            if (hideTimer) clearTimeout(hideTimer);
            hideTimer = setTimeout(closeRatingSubmenu, 180);
        };

        const cancelClose = () => {
            if (hideTimer) clearTimeout(hideTimer);
            hideTimer = null;
        };

        const renderRatingSubmenu = () => {
            clearMenu(ratingSubmenu);
            const stars = (n) => "★".repeat(n) + "☆".repeat(Math.max(0, 5 - n));
            for (const n of [5, 4, 3, 2, 1]) {
                ratingSubmenu.appendChild(
                    createItem(stars(n), "pi pi-star", null, async () => {
                        await setRating(asset, n, onAssetChanged);
                        closeRatingSubmenu();
                        try {
                            hideMenu(menu);
                        } catch {}
                    }, { disabled: !asset?.id })
                );
            }
            ratingSubmenu.appendChild(separator());
            ratingSubmenu.appendChild(
                createItem("Reset rating", "pi pi-star", "0", async () => {
                    await setRating(asset, 0, onAssetChanged);
                    closeRatingSubmenu();
                    try {
                        hideMenu(menu);
                    } catch {}
                }, { disabled: !asset?.id })
            );
        };

        ratingRoot.addEventListener("mouseenter", () => {
            if (!asset?.id) return;
            cancelClose();
            renderRatingSubmenu();
            showSubmenuNextTo(ratingRoot, ratingSubmenu);
        });
        ratingRoot.addEventListener("mouseleave", () => {
            scheduleClose();
        });
        ratingSubmenu.addEventListener("mouseenter", () => cancelClose());
        ratingSubmenu.addEventListener("mouseleave", () => scheduleClose());

        menu.appendChild(separator());

        // Rename option
        menu.appendChild(
            createItem("Rename…", "pi pi-pencil", null, async () => {
                if (!asset?.id) return;

                const currentName = asset.filename || "";
                const newName = await comfyPrompt("Rename file", currentName);
                if (!newName || newName === currentName) return;

                try {
                    const renameResult = await renameAsset(asset.id, newName);
                    if (renameResult?.ok) {
                        // Update the asset object
                        asset.filename = newName;
                        asset.filepath = asset.filepath.replace(/[^\\/]+$/, newName);

                        await comfyAlert("File renamed successfully!");
                        onAssetChanged?.();
                    } else {
                        await comfyAlert(renameResult?.error || "Failed to rename file.");
                    }
                } catch (error) {
                    await comfyAlert(`Error renaming file: ${error.message}`);
                }
            }, { disabled: !asset?.id })
        );

        // Delete option
        menu.appendChild(
            createItem("Delete…", "pi pi-trash", null, async () => {
                if (!asset?.id) return;

                const confirmed = await comfyConfirm("Delete this file? This cannot be undone.");
                if (!confirmed) return;

                try {
                    const deleteResult = await deleteAsset(asset.id);
                    if (deleteResult?.ok) {
                        await comfyAlert("File deleted successfully!");
                        // Close viewer or navigate to next asset
                        onAssetChanged?.();
                    } else {
                        await comfyAlert(deleteResult?.error || "Failed to delete file.");
                    }
                } catch (error) {
                    await comfyAlert(`Error deleting file: ${error.message}`);
                }
            }, { disabled: !asset?.id })
        );

        showAt(menu, e.clientX, e.clientY);
    });
}
