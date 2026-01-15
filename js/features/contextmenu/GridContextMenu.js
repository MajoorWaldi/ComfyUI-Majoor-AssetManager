/**
 * Grid Context Menu - Right-click menu for asset cards
 */

import { buildAssetViewURL } from "../../api/endpoints.js";
import { comfyAlert, comfyConfirm, comfyPrompt } from "../../app/dialogs.js";
import { openInFolder, updateAssetRating, deleteAsset, renameAsset, removeFilepathsFromCollection } from "../../api/client.js";
import { ASSET_RATING_CHANGED_EVENT, ASSET_TAGS_CHANGED_EVENT } from "../../app/events.js";
import { createTagsEditor } from "../../components/TagsEditor.js";
import { safeDispatchCustomEvent } from "../../utils/events.js";
import { showAddToCollectionMenu } from "../collections/contextmenu/addToCollectionMenu.js";
import { getOrCreateMenu, createMenuItem, createMenuSeparator, showMenuAt } from "../../components/contextmenu/MenuCore.js";
import { hideMenu, clearMenu } from "../../components/contextmenu/MenuCore.js";
// Bulk operations removed - using local helpers
const getSelectedAssetIds = (gridContainer) => {
    const selected = new Set();
    if (!gridContainer) return selected;
    try {
        const cards = gridContainer.querySelectorAll('.mjr-asset-card.is-selected');
        for (const card of cards) {
            const id = card.dataset?.mjrAssetId;
            if (id) selected.add(String(id));
        }
    } catch {}
    return selected;
};

const getSelectedAssets = (gridContainer) => {
    const assets = [];
    if (!gridContainer) return assets;
    try {
        const cards = gridContainer.querySelectorAll(".mjr-asset-card.is-selected");
        for (const card of cards) {
            const a = card?._mjrAsset;
            if (a) assets.push(a);
        }
    } catch {}
    return assets;
};

const getAssetFilepath = (asset) => {
    try {
        const fp = asset?.filepath || asset?.path || asset?.file_info?.filepath || "";
        return fp ? String(fp) : "";
    } catch {
        return "";
    }
};

const clearSelection = (gridContainer) => {
    if (!gridContainer) return;
    try {
        const cards = gridContainer.querySelectorAll('.mjr-asset-card.is-selected');
        for (const card of cards) {
            card.classList.remove('is-selected');
            card.setAttribute('aria-selected', 'false');
        }
    } catch {}
};

const MENU_SELECTOR = ".mjr-grid-context-menu";
const POPOVER_SELECTOR = ".mjr-grid-popover";

function createMenu() {
    return getOrCreateMenu({
        selector: MENU_SELECTOR,
        className: "mjr-grid-context-menu",
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
        selector: ".mjr-grid-rating-submenu",
        className: "mjr-grid-rating-submenu",
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
        existing?.remove?.();
    } catch {}

    const pop = document.createElement("div");
    pop.className = "mjr-grid-popover";
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
            { warnPrefix: "[GridContextMenu]" }
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
            { warnPrefix: "[GridContextMenu]" }
        );
        onChanged?.();
    } catch {}
}

export function bindGridContextMenu({
    gridContainer,
    getState = () => ({}),
    onRequestOpenViewer = () => {},
} = {}) {
    if (!gridContainer) return;
    if (gridContainer._mjrGridContextMenuBound) return;
    gridContainer._mjrGridContextMenuBound = true;

    const menu = createMenu();

    gridContainer.addEventListener("contextmenu", async (e) => {
        // Check if the contextmenu event is on an asset card
        const card = e.target.closest(".mjr-asset-card");
        if (!card) return;
        
        e.preventDefault();
        e.stopPropagation();

        const asset = card._mjrAsset;
        if (!asset) return;

        menu.innerHTML = "";

        // Get current selection state
        const selectedIds = getSelectedAssetIds(gridContainer);
        const isSingleSelected = selectedIds.size === 1 && selectedIds.has(String(asset.id));
        const isMultiSelected = selectedIds.size > 1;
        const hasSelection = selectedIds.size > 0;

        // Open Viewer
        menu.appendChild(
            createItem("Open Viewer", "pi pi-image", null, () => {
                onRequestOpenViewer(asset);
            })
        );

        // Open in Folder
        menu.appendChild(
            createItem("Open in Folder", "pi pi-folder-open", null, async () => {
                if (!asset?.id) return;
                const res = await openInFolder(asset.id);
                if (!res?.ok) {
                    await comfyAlert(res?.error || "Failed to open folder.");
                }
            }, { disabled: !asset?.id })
        );

        // Copy file path
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

        // Add to collection (single or multi)
        menu.appendChild(
            createItem("Add to collection...", "pi pi-bookmark", null, async () => {
                try {
                    menu.style.display = "none";
                } catch {}
                const selectedAssets = getSelectedAssets(gridContainer);
                const list = selectedAssets.length ? selectedAssets : [asset];
                await showAddToCollectionMenu({ x: e.clientX, y: e.clientY, assets: list });
            })
        );

        // Remove from current collection (only when in collection view)
        const state = (() => {
            try {
                return getState?.() || {};
            } catch {
                return {};
            }
        })();
        const collectionId = String(state?.collectionId || "").trim();
        if (collectionId) {
            const selectedAssets = getSelectedAssets(gridContainer);
            const list = selectedAssets.length ? selectedAssets : [asset];
            const filepaths = list.map(getAssetFilepath).filter(Boolean);
            const label = filepaths.length > 1 ? `Remove from collection (${filepaths.length})` : "Remove from collection";
            menu.appendChild(
                createItem(label, "pi pi-bookmark", null, async () => {
                    try {
                        menu.style.display = "none";
                    } catch {}
                    if (!filepaths.length) {
                        await comfyAlert("No file path available for this asset.");
                        return;
                    }
                    const confirmed = await comfyConfirm(`Remove ${filepaths.length} item(s) from this collection?`);
                    if (!confirmed) return;

                    const res = await removeFilepathsFromCollection(collectionId, filepaths);
                    if (!res?.ok) {
                        await comfyAlert(res?.error || "Failed to remove from collection.");
                        return;
                    }

                    // Refresh the collection view (best effort).
                    try {
                        gridContainer?.dispatchEvent?.(new CustomEvent("mjr:reload-grid"));
                    } catch {}
                })
            );
        }

        menu.appendChild(separator());

        // Edit Tags
        menu.appendChild(createItem("Edit Tags…", "pi pi-tags", null, () => {
            try {
                hideMenu(menu);
            } catch {}
            showTagsPopover(e.clientX + 6, e.clientY + 6, asset, () => {
                // Update card UI after tags change
                const card = document.querySelector(`[data-mjr-asset-id="${CSS.escape ? CSS.escape(String(asset.id)) : String(asset.id)}"]`);
                if (card && card._mjrAsset) {
                    card._mjrAsset.tags = [...asset.tags];
                }
            });
        }));

        // Rating submenu (hover)
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
                        await setRating(asset, n, () => {
                            const card = document.querySelector(
                                `[data-mjr-asset-id="${CSS.escape ? CSS.escape(String(asset.id)) : String(asset.id)}"]`
                            );
                            if (card && card._mjrAsset) card._mjrAsset.rating = n;
                        });
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
                    await setRating(asset, 0, () => {
                        const card = document.querySelector(
                            `[data-mjr-asset-id="${CSS.escape ? CSS.escape(String(asset.id)) : String(asset.id)}"]`
                        );
                        if (card && card._mjrAsset) card._mjrAsset.rating = 0;
                    });
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

        // Rename (single only)
        menu.appendChild(
            createItem("Rename…", "pi pi-pencil", null, async () => {
                if (!asset?.id) return;
                
                const currentName = asset.filename || "";
                const newName = await comfyPrompt("Rename file", currentName);
                if (!newName || newName === currentName) return;
                
                try {
                    const result = await renameAsset(asset.id, newName);
                    if (result?.ok) {
                        // Update the asset object and card UI
                        asset.filename = newName;
                        asset.filepath = asset.filepath.replace(/[^\\/]+$/, newName);
                        
                        // Update card UI
                        const card = document.querySelector(`[data-mjr-asset-id="${CSS.escape ? CSS.escape(String(asset.id)) : String(asset.id)}"]`);
                        if (card) {
                            // Update card display
                            const filenameEl = card.querySelector('.mjr-filename');
                            if (filenameEl) {
                                filenameEl.textContent = newName;
                            }
                        }
                        
                        await comfyAlert("File renamed successfully!");
                    } else {
                        await comfyAlert(result?.error || "Failed to rename file.");
                    }
                } catch (error) {
                    await comfyAlert(`Error renaming file: ${error.message}`);
                }
            }, { disabled: !asset?.id })
        );

        // Delete (single or multi)
        if (isMultiSelected) {
            menu.appendChild(
                createItem(`Delete ${selectedIds.size} files…`, "pi pi-trash", null, async () => {
                    const confirmed = await comfyConfirm(`Delete ${selectedIds.size} files? This cannot be undone.`);
                    if (!confirmed) return;

                    try {
                        // Delete each asset individually
                        let successCount = 0;
                        let errorCount = 0;

                        for (const assetId of selectedIds) {
                            const result = await deleteAsset(assetId);
                            if (result?.ok) {
                                successCount++;
                                // Remove card from DOM
                                const card = document.querySelector(`[data-mjr-asset-id="${CSS.escape ? CSS.escape(String(assetId)) : String(assetId)}"]`);
                                if (card) card.remove();
                            } else {
                                errorCount++;
                            }
                        }

                        // Clear selection
                        clearSelection(gridContainer);

                        if (errorCount === 0) {
                            await comfyAlert(`${successCount} files deleted successfully!`);
                        } else {
                            await comfyAlert(`${successCount} files deleted, ${errorCount} failed.`);
                        }
                    } catch (error) {
                        await comfyAlert(`Error deleting files: ${error.message}`);
                    }
                })
            );
        } else {
            menu.appendChild(
                createItem("Delete…", "pi pi-trash", null, async () => {
                    const confirmed = await comfyConfirm("Delete this file? This cannot be undone.");
                    if (!confirmed) return;
                    
                    try {
                        const result = await deleteAsset(asset.id);
                        if (result?.ok) {
                            // Remove the card from DOM
                            card.remove();
                            await comfyAlert("File deleted successfully!");
                        } else {
                            await comfyAlert(result?.error || "Failed to delete file.");
                        }
                    } catch (error) {
                        await comfyAlert(`Error deleting file: ${error.message}`);
                    }
                }, { disabled: !asset?.id })
            );
        }

        // Bulk operations menu removed

        showAt(menu, e.clientX, e.clientY);
    });
}
