/**
 * Grid Context Menu - Right-click menu for asset cards
 */

import { buildAssetViewURL, buildDownloadURL } from "../../api/endpoints.js";
import { comfyConfirm, comfyPrompt } from "../../app/dialogs.js";
import { comfyToast } from "../../app/toast.js";
import { openInFolder, updateAssetRating, deleteAsset, renameAsset, removeFilepathsFromCollection } from "../../api/client.js";
import { ASSET_RATING_CHANGED_EVENT, ASSET_TAGS_CHANGED_EVENT } from "../../app/events.js";
import { createTagsEditor } from "../../components/TagsEditor.js";
import { getViewerInstance } from "../../components/Viewer.js";
import { safeDispatchCustomEvent } from "../../utils/events.js";
import { showAddToCollectionMenu } from "../collections/contextmenu/addToCollectionMenu.js";
import {
    getOrCreateMenu,
    createMenuItem,
    createMenuSeparator,
    showMenuAt,
    MENU_Z_INDEX,
    safeEscapeSelector,
    setMenuSessionCleanup,
    cleanupMenu,
} from "../../components/contextmenu/MenuCore.js";
import { hideMenu, clearMenu } from "../../components/contextmenu/MenuCore.js";
import { getShortcutDisplay } from "../grid/GridKeyboard.js";
// Bulk operations removed - using local helpers
const getSelectedAssetIds = (gridContainer) => {
    const selected = new Set();
    if (!gridContainer) return selected;
    try {
        // Fix: Use authoritative source (dataset) instead of DOM query which misses off-screen items
        const raw = gridContainer.dataset?.mjrSelectedAssetIds;
        if (raw) {
            const list = JSON.parse(raw);
            if (Array.isArray(list)) list.forEach(id => selected.add(String(id)));
        } else {
             // Fallback for legacy or if dataset missing
             const cards = gridContainer.querySelectorAll('.mjr-asset-card.is-selected');
             for (const card of cards) {
                 const id = card.dataset?.mjrAssetId;
                 if (id) selected.add(String(id));
             }
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

const selectCardForDetails = (gridContainer, card, asset, state) => {
    if (!gridContainer) return;
    try {
        clearSelection(gridContainer);
    } catch {}
    if (card) {
        try {
            card.classList.add('is-selected');
            card.setAttribute('aria-selected', 'true');
        } catch {}
    }
    const id = asset?.id != null ? String(asset.id) : "";
    if (id) {
        try {
            gridContainer.dataset.mjrSelectedAssetIds = JSON.stringify([id]);
            gridContainer.dataset.mjrSelectedAssetId = id;
        } catch {}
    } else {
        try {
            delete gridContainer.dataset.mjrSelectedAssetIds;
        } catch {}
        try {
            delete gridContainer.dataset.mjrSelectedAssetId;
        } catch {}
    }
    if (state && typeof state === 'object') {
        try {
            state.selectedAssetIds = id ? [id] : [];
        } catch {}
        try {
            state.activeAssetId = id;
        } catch {}
    }
};

const getAllAssetsInGrid = (gridContainer) => {
    const assets = [];
    if (!gridContainer) return assets;
    try {
        const cards = gridContainer.querySelectorAll(".mjr-asset-card");
        for (const card of cards) {
            const a = card?._mjrAsset;
            if (a) assets.push(a);
        }
    } catch {}
    return assets;
};

const findIndexById = (assets, assetId) => {
    try {
        const id = String(assetId ?? "");
        return (assets || []).findIndex((a) => String(a?.id ?? "") === id);
    } catch {
        return -1;
    }
};

const MENU_SELECTOR = ".mjr-grid-context-menu";
const POPOVER_SELECTOR = ".mjr-grid-popover";

function createMenu() {
    return getOrCreateMenu({
        selector: MENU_SELECTOR,
        className: "mjr-grid-context-menu",
        minWidth: 220,
        zIndex: MENU_Z_INDEX.MAIN,
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
        zIndex: MENU_Z_INDEX.SUBMENU,
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
    pop.className = "mjr-grid-popover";
    pop.style.cssText = `
        position: fixed;
        z-index: ${MENU_Z_INDEX.POPOVER};
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
        document.addEventListener("scroll", hide, { capture: true, passive: true, signal: ac.signal });
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

const _ratingDebounceTimers = new Map();
function setRating(asset, rating, onChanged) {
    const assetId = asset?.id;
    if (!assetId) return;
    const id = String(assetId);
    try {
        const prev = _ratingDebounceTimers.get(id);
        if (prev) clearTimeout(prev);
    } catch {}

    // Optimistic UI
    try {
        asset.rating = rating;
    } catch {}
    try {
        onChanged?.();
    } catch {}

    const t = setTimeout(async () => {
        try {
            _ratingDebounceTimers.delete(id);
        } catch {}
        try {
            const result = await updateAssetRating(assetId, rating);
            if (!result?.ok) {
                comfyToast(result?.error || "Failed to update rating", "error");
                return;
            }
            comfyToast(`Rating set to ${rating} stars`, "success", 1500);
            safeDispatchCustomEvent(
                ASSET_RATING_CHANGED_EVENT,
                { assetId: String(assetId), rating },
                { warnPrefix: "[GridContextMenu]" }
            );
        } catch (err) {
            console.error("[GridContextMenu] Rating update failed:", err);
            comfyToast("Error updating rating", "error");
        }
    }, 350);
    try {
        _ratingDebounceTimers.set(id, t);
    } catch {}
}

export function bindGridContextMenu({
    gridContainer,
    getState = () => ({}),
    onRequestOpenViewer = () => {},
} = {}) {
    if (!gridContainer) return;
    if (gridContainer._mjrGridContextMenuBound && typeof gridContainer._mjrGridContextMenuUnbind === "function") {
        return gridContainer._mjrGridContextMenuUnbind;
    }

    const menu = createMenu();

    const handler = async (e) => {
        // Check if the contextmenu event is on an asset card
        const card = e.target.closest(".mjr-asset-card");
        if (!card) return;
        
        e.preventDefault();
        e.stopPropagation();

        const asset = card._mjrAsset;
        if (!asset) return;

        const panelState = (() => {
            try {
                return getState?.() || {};
            } catch {
                return {};
            }
        })();

        menu.innerHTML = "";

        // Get current selection state
        let selectedIds = getSelectedAssetIds(gridContainer);
        
        // Implicit selection: if Right-Click on unselected item, select it exclusively.
        if (asset && asset.id && !selectedIds.has(String(asset.id))) {
             const newSelection = [String(asset.id)];
             try {
                 gridContainer.dataset.mjrSelectedAssetIds = JSON.stringify(newSelection);
                 // Dispatch event to sync state
                 safeDispatchCustomEvent("mjr:selection-changed", {
                     selectedIds: newSelection,
                     selectedAssets: [asset]
                 }, { target: gridContainer, warnPrefix: "[GridContextMenu]" });
             } catch {}
             // Update local set for menu logic
             selectedIds = new Set(newSelection);
             
             // Visually update immediately (toggle class) to give feedback
             try {
                // Clear others
                gridContainer.querySelectorAll('.mjr-asset-card.is-selected').forEach(el => el.classList.remove('is-selected'));
                // Select target
                if (card) card.classList.add('is-selected');
             } catch {}
        }

        const isSingleSelected = selectedIds.size === 1 && selectedIds.has(String(asset.id));
        const isMultiSelected = selectedIds.size > 1;
        const hasSelection = selectedIds.size > 0;

        // Open Viewer
        menu.appendChild(
            createItem("Open Viewer", "pi pi-image", getShortcutDisplay("OPEN_VIEWER"), () => {
                // For a small selection set, open the selection (useful for quick compare).
                // Otherwise open the whole grid so navigation works.
                try {
                    const viewer = getViewerInstance();
                    const selectedAssets = hasSelection ? getSelectedAssets(gridContainer) : [];
                    const selectedCount = selectedAssets.length;
                    if (selectedCount >= 2 && selectedCount <= 4) {
                        viewer.open(selectedAssets, 0);
                        return;
                    }

                    const allAssets = getAllAssetsInGrid(gridContainer);
                    const idx = findIndexById(allAssets, asset?.id);
                    viewer.open(allAssets, Math.max(0, idx));
                } catch {
                    // Fallback to the caller hook (legacy/optional).
                    try {
                        onRequestOpenViewer(asset);
                    } catch {}
                }
            })
        );

        menu.appendChild(
            createItem("Show metadata panel", "pi pi-info-circle", getShortcutDisplay("METADATA_PANEL"), () => {
                try {
                    hideMenu(menu);
                } catch {}
                try {
                    selectCardForDetails(gridContainer, card, asset, panelState);
                } catch {}
                try {
                    const toggleDetails = gridContainer?._mjrOpenDetails;
                    if (typeof toggleDetails === "function") {
                        toggleDetails();
                    }
                } catch {}
            })
        );

        // Compare options (selection-only)
        const selectedAssets = hasSelection ? getSelectedAssets(gridContainer) : [];
        const selectedCount = selectedAssets.length;
        if (selectedCount === 2) {
            menu.appendChild(
                createItem("Compare A/B (2 selected)", "pi pi-clone", getShortcutDisplay("COMPARE_AB"), () => {
                    try {
                        const viewer = getViewerInstance();
                        viewer.open(selectedAssets, 0);
                        viewer.setMode?.("ab");
                    } catch {}
                })
            );
        }
        if (selectedCount >= 2 && selectedCount <= 4) {
            menu.appendChild(
                createItem(`Side-by-side (2x2) (${selectedCount} selected)`, "pi pi-table", getShortcutDisplay("SIDE_BY_SIDE"), () => {
                    try {
                        const viewer = getViewerInstance();
                        viewer.open(selectedAssets, 0);
                        viewer.setMode?.("sidebyside");
                    } catch {}
                })
            );
        }

        // Open in Folder
        menu.appendChild(
            createItem("Open in Folder", "pi pi-folder-open", getShortcutDisplay("OPEN_IN_FOLDER"), async () => {
                if (!asset?.id) return;
                const res = await openInFolder(asset.id);
                if (!res?.ok) {
                    comfyToast(res?.error || "Failed to open folder.", "error");
                } else {
                    comfyToast("Opened in folder", "info", 2000);
                }
            }, { disabled: !asset?.id })
        );

        // Copy file path
        menu.appendChild(
            createItem("Copy file path", "pi pi-copy", getShortcutDisplay("COPY_PATH"), async () => {
                const p = asset?.filepath ? String(asset.filepath) : "";
                if (!p) {
                    comfyToast("No file path available for this asset.", "error");
                    return;
                }
                try {
                    await navigator.clipboard.writeText(p);
                    comfyToast("File path copied to clipboard", "success", 2000);
                } catch (err) {
                    console.warn("Clipboard copy failed", err);
                    comfyToast("Failed to copy path", "error");
                }
            })
        );

        // Download
        menu.appendChild(
            createItem("Download", "pi pi-download", getShortcutDisplay("DOWNLOAD"), () => {
                if (!asset || !asset.filepath) {
                    console.error("No filepath for asset", asset);
                    return;
                }

                const url = buildDownloadURL(asset.filepath);
                const filename = asset.filename || "download";

                // Trigger download invisibly
                const link = document.createElement("a");
                link.href = url;
                link.download = filename;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                comfyToast(`Downloading ${filename}...`, "info", 3000);
            }, { disabled: !asset?.filepath })
        );

        // Add to collection (single or multi)
        menu.appendChild(
                createItem("Add to collection...", "pi pi-bookmark", getShortcutDisplay("ADD_TO_COLLECTION"), async () => {
                    try {
                        hideMenu(menu);
                    } catch {}
                    const selectedAssets = getSelectedAssets(gridContainer);
                    const list = selectedAssets.length ? selectedAssets : [asset];
                    await showAddToCollectionMenu({ x: e.clientX, y: e.clientY, assets: list });
                })
        );

        // Remove from current collection (only when in collection view)
        const collectionId = String(panelState?.collectionId || "").trim();
        if (collectionId) {
            const selectedAssets = getSelectedAssets(gridContainer);
            const list = selectedAssets.length ? selectedAssets : [asset];
            const filepaths = list.map(getAssetFilepath).filter(Boolean);
            const label = filepaths.length > 1 ? `Remove from collection (${filepaths.length})` : "Remove from collection";
            menu.appendChild(
                createItem(label, "pi pi-bookmark", null, async () => {
                    try {
                        hideMenu(menu);
                    } catch {}
                    if (!filepaths.length) {
                        comfyToast("No file path available for this asset.", "error");
                        return;
                    }
                    
                    // Confirmation removed as per user request
                    const res = await removeFilepathsFromCollection(collectionId, filepaths);
                    if (!res?.ok) {
                        comfyToast(res?.error || "Failed to remove from collection.", "error");
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
        menu.appendChild(createItem("Edit Tags...", "pi pi-tags", getShortcutDisplay("EDIT_TAGS"), () => {
            try {
                hideMenu(menu);
            } catch {}
            showTagsPopover(e.clientX + 6, e.clientY + 6, asset, () => {
                // Update card UI after tags change
                const card = document.querySelector(`[data-mjr-asset-id="${safeEscapeSelector(asset.id)}"]`);
                if (card && card._mjrAsset) {
                    card._mjrAsset.tags = [...asset.tags];
                }
            });
        }));

        // Rating submenu (hover)
        menu.appendChild(separator());
        const ratingRoot = createItem("Set rating", "pi pi-star", "1-5 ›", () => {}, { disabled: !asset?.id });
        ratingRoot.style.cursor = !asset?.id ? "default" : "pointer";
        menu.appendChild(ratingRoot);

        let hideTimer = null;
        const ratingSubmenu = getOrCreateRatingSubmenu();
        ratingRoot.dataset.mjrHasSubmenu = "true";
        ratingRoot._mjrSubmenuTarget = ratingSubmenu;
        // Prevent listener buildup across repeated opens (submenu is reused).
        try {
            ratingSubmenu._mjrAbortController?.abort?.();
        } catch {}
        try {
            ratingRoot._mjrAbortController?.abort?.();
        } catch {}
        const ratingAC = new AbortController();
        ratingSubmenu._mjrAbortController = ratingAC;
        ratingRoot._mjrAbortController = ratingAC;

        const closeRatingSubmenu = () => {
            try {
                hideMenu(ratingSubmenu);
                clearMenu(ratingSubmenu);
            } catch {}
        };

        const scheduleClose = () => {
            if (hideTimer) clearTimeout(hideTimer);
            hideTimer = setTimeout(closeRatingSubmenu, 350);
        };

        const cancelClose = () => {
            if (hideTimer) clearTimeout(hideTimer);
            hideTimer = null;
        };

        // Clear timers + submenu listeners when the main menu closes.
        try {
            setMenuSessionCleanup(menu, () => {
                try {
                    if (hideTimer) clearTimeout(hideTimer);
                } catch {}
                hideTimer = null;
                try {
                    ratingSubmenu?._mjrAbortController?.abort?.();
                } catch {}
                try {
                    closeRatingSubmenu();
                } catch {}
            });
        } catch {}

        const renderRatingSubmenu = () => {
            clearMenu(ratingSubmenu);
            const stars = (n) => "★".repeat(n) + "☆".repeat(Math.max(0, 5 - n));
            for (const n of [5, 4, 3, 2, 1]) {
                ratingSubmenu.appendChild(
                    createItem(stars(n), "pi pi-star", null, async () => {
                        setRating(asset, n, () => {
                            const card = document.querySelector(
                                `[data-mjr-asset-id="${safeEscapeSelector(asset.id)}"]`
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
                    setRating(asset, 0, () => {
                        const card = document.querySelector(
                            `[data-mjr-asset-id="${safeEscapeSelector(asset.id)}"]`
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

        ratingRoot.addEventListener(
            "mouseenter",
            () => {
            if (!asset?.id) return;
            cancelClose();
            renderRatingSubmenu();
            showSubmenuNextTo(ratingRoot, ratingSubmenu);
            },
            { signal: ratingAC.signal }
        );
        ratingRoot.addEventListener(
            "mouseleave",
            () => {
            scheduleClose();
            },
            { signal: ratingAC.signal }
        );
        ratingSubmenu.addEventListener("mouseenter", () => cancelClose(), { signal: ratingAC.signal });
        ratingSubmenu.addEventListener("mouseleave", () => scheduleClose(), { signal: ratingAC.signal });

        menu.appendChild(separator());

        // Rename (single only)
        menu.appendChild(
            createItem("Rename…", "pi pi-pencil", getShortcutDisplay("RENAME"), async () => {
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
                        const card = document.querySelector(`[data-mjr-asset-id="${safeEscapeSelector(asset.id)}"]`);
                        if (card) {
                            // Update card display
                            const filenameEl = card.querySelector('.mjr-filename');
                            if (filenameEl) {
                                filenameEl.textContent = newName;
                            }
                        }
                        
                        comfyToast("File renamed successfully!", "success");
                    } else {
                        comfyToast(result?.error || "Failed to rename file.", "error");
                    }
                } catch (error) {
                    comfyToast(`Error renaming file: ${error.message}`, "error");
                }
            }, { disabled: !asset?.id })
        );

        // Delete (single or multi)
        if (isMultiSelected) {
            menu.appendChild(
                createItem(`Delete ${selectedIds.size} files...`, "pi pi-trash", getShortcutDisplay("DELETE"), async () => {
                   // Confirmation removed as per user request
                    try {
                        // Delete each asset individually
                        let successCount = 0;
                        let errorCount = 0;

                        for (const assetId of selectedIds) {
                            const result = await deleteAsset(assetId);
                            if (result?.ok) {
                                successCount++;
                                // Remove card from DOM
                                const card = document.querySelector(`[data-mjr-asset-id="${safeEscapeSelector(assetId)}"]`);
                                if (card) card.remove();
                            } else {
                                errorCount++;
                            }
                        }

                        // Clear selection
                        clearSelection(gridContainer);

                        if (errorCount === 0) {
                            comfyToast(`${successCount} files deleted successfully!`, "success");
                        } else {
                            comfyToast(`${successCount} files deleted, ${errorCount} failed.`, "warning");
                        }
                    } catch (error) {
                        comfyToast(`Error deleting files: ${error.message}`, "error");
                    }
                })
            );
        } else {
            menu.appendChild(
                createItem("Delete...", "pi pi-trash", getShortcutDisplay("DELETE"), async () => {
                   // Confirmation removed as per user request
                    try {
                        const result = await deleteAsset(asset.id);
                        if (result?.ok) {
                            // Remove the card from DOM
                            try {
                                const cardToRemove = document.querySelector(`[data-mjr-asset-id="${safeEscapeSelector(asset.id)}"]`);
                                cardToRemove?.remove?.();
                            } catch {}
                            comfyToast("File deleted successfully!", "success");
                        } else {
                            comfyToast(result?.error || "Failed to delete file.", "error");
                        }
                    } catch (error) {
                        comfyToast(`Error deleting file: ${error.message}`, "error");
                    }
                }, { disabled: !asset?.id })
            );
        }

        // Bulk operations menu removed

        showAt(menu, e.clientX, e.clientY);
    };

    try {
        gridContainer.addEventListener("contextmenu", handler);
    } catch (err) {
        console.error("[GridContextMenu] Failed to bind:", err);
    }

    gridContainer._mjrGridContextMenuBound = true;
    const unbind = () => {
        try {
            gridContainer.removeEventListener("contextmenu", handler);
        } catch {}
        try {
            gridContainer._mjrGridContextMenuBound = false;
        } catch {}
        try {
            gridContainer._mjrGridContextMenuUnbind = null;
        } catch {}
        try {
            cleanupMenu(menu);
        } catch {}
    };
    gridContainer._mjrGridContextMenuUnbind = unbind;
    return unbind;
}
