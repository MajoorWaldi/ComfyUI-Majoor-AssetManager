import { buildAssetViewURL, buildDownloadURL } from "../../api/endpoints.js";
import { comfyPrompt } from "../../app/dialogs.js";
import { comfyToast } from "../../app/toast.js";
import { t } from "../../app/i18n.js";
import { openInFolder, deleteAsset, renameAsset, getViewerInfo } from "../../api/client.js";
import { ASSET_RATING_CHANGED_EVENT, ASSET_TAGS_CHANGED_EVENT, VIEWER_INFO_REFRESHED_EVENT } from "../../app/events.js";
import { createTagsEditor } from "../../components/TagsEditor.js";
import { safeDispatchCustomEvent } from "../../utils/events.js";
import {
    getOrCreateMenu,
    createMenuItem,
    createMenuSeparator,
    showMenuAt,
    MENU_Z_INDEX,
    setMenuSessionCleanup,
    cleanupMenu,
} from "../../components/contextmenu/MenuCore.js";
import { hideMenu, clearMenu } from "../../components/contextmenu/MenuCore.js";
import { showAddToCollectionMenu } from "../collections/contextmenu/addToCollectionMenu.js";
import { confirmDeletion } from "../../utils/deleteGuard.js";
import { sanitizeFilename, validateFilename } from "../../utils/filenames.js";
import { reportError } from "../../utils/logging.js";
import { scheduleRatingUpdate, cancelAllRatingUpdates } from "../contextmenu/ratingUpdater.js";

/**
 * Viewer-specific shortcut displays
 * These match the shortcuts defined in keyboard.js for the viewer
 */
const VIEWER_SHORTCUTS = {
    COPY_PATH: "Ctrl+Shift+C",
    DOWNLOAD: "Ctrl+S",
    OPEN_IN_FOLDER: "Ctrl+Shift+E",
    ADD_TO_COLLECTION: "B",
    EDIT_TAGS: "T",
    RATING_SUBMENU: "1-5",
    RENAME: "F2",
    DELETE: "Del",
};

const MENU_SELECTOR = ".mjr-viewer-context-menu";
const POPOVER_SELECTOR = ".mjr-viewer-popover";

function createMenu() {
    return getOrCreateMenu({
        selector: MENU_SELECTOR,
        className: "mjr-viewer-context-menu",
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
        selector: ".mjr-viewer-rating-submenu",
        className: "mjr-viewer-rating-submenu",
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
    pop.className = "mjr-viewer-popover";
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

function setRating(asset, rating, onChanged) {
    const assetId = asset?.id;
    if (!assetId) return;
    try {
        asset.rating = rating;
    } catch {}
    try {
        onChanged?.();
    } catch {}

    scheduleRatingUpdate(String(assetId), rating, {
        successMessage: rating > 0 ? `Rating set to ${rating} stars` : "Rating cleared",
        errorMessage: "Failed to update rating",
        warnPrefix: "[ViewerContextMenu]",
        onSuccess: () => {
            safeDispatchCustomEvent(
                ASSET_RATING_CHANGED_EVENT,
                { assetId: String(assetId), rating },
                { warnPrefix: "[ViewerContextMenu]" }
            );
        },
        onFailure: (error) => {
            reportError(error, "[ViewerContextMenu] Rating update", { showToast: true });
        },
    });
}

const SIZE_UNITS = ["B", "KB", "MB", "GB", "TB"];
function formatReadableSize(value) {
    let bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes < 0) return "";
    let unitIndex = 0;
    while (bytes >= 1024 && unitIndex < SIZE_UNITS.length - 1) {
        bytes /= 1024;
        unitIndex += 1;
    }
    const formatted = unitIndex === 0 ? `${Math.round(bytes)}` : bytes.toFixed(2);
    return `${formatted} ${SIZE_UNITS[unitIndex]}`;
}

export function bindViewerContextMenu({
    overlayEl,
    getCurrentAsset,
    getCurrentViewUrl,
    onAssetChanged,
} = {}) {
    if (!overlayEl || typeof getCurrentAsset !== "function") return;
    if (overlayEl._mjrViewerContextMenuBound && typeof overlayEl._mjrViewerContextMenuUnbind === "function") {
        return overlayEl._mjrViewerContextMenuUnbind;
    }

    const menu = createMenu();

    const handler = async (e) => {
        if (!overlayEl.contains(e.target)) return;
        e.preventDefault();
        e.stopPropagation();

        const asset = getCurrentAsset();
        if (!asset) return;

        menu.innerHTML = "";

        // Auto-close wrapper for cleaner menu code
        const withClose = (fn) => async () => {
            try {
                await fn();
            } finally {
                hideMenu(menu);
            }
        };

        const viewUrl = typeof getCurrentViewUrl === "function" ? getCurrentViewUrl(asset) : buildAssetViewURL(asset);

        menu.appendChild(
            createItem("Open in New Tab", "pi pi-external-link", null, withClose(() => {
                window.open(viewUrl, "_blank");
            }))
        );

        menu.appendChild(
            createItem("Copy file path", "pi pi-copy", VIEWER_SHORTCUTS.COPY_PATH, withClose(async () => {
                const p = asset?.filepath ? String(asset.filepath) : "";
                if (!p) {
                    comfyToast(t("toast.noFilePath"), "error");
                    return;
                }
                try {
                    await navigator.clipboard.writeText(p);
                    comfyToast(t("toast.pathCopied"), "success", 2000);
                } catch (err) {
                    console.error("[ViewerContextMenu] Copy failed:", err);
                    comfyToast(t("toast.pathCopyFailed"), "error");
                }
            }))
        );

        // Download Original
        menu.appendChild(
            createItem("Download Original", "pi pi-download", VIEWER_SHORTCUTS.DOWNLOAD, withClose(() => {
                if (!asset || !asset.filepath) return;

                const url = buildDownloadURL(asset.filepath);
                const link = document.createElement("a");
                link.href = url;
                link.download = asset.filename;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                comfyToast(`Downloading ${asset.filename}...`, "info", 3000);
            }), { disabled: !asset?.filepath })
        );

        menu.appendChild(
            createItem("Open in Folder", "pi pi-folder-open", VIEWER_SHORTCUTS.OPEN_IN_FOLDER, withClose(async () => {
                if (!asset?.id) return;
                const res = await openInFolder(asset.id);
                if (!res?.ok) {
                    comfyToast(res?.error || t("toast.openFolderFailed"), "error");
                } else {
                    comfyToast(t("toast.openedInFolder"), "info", 2000);
                }
            }), { disabled: !asset?.id })
        );

        menu.appendChild(
            createItem("Add to collection...", "pi pi-bookmark", VIEWER_SHORTCUTS.ADD_TO_COLLECTION, withClose(async () => {
                try {
                    await showAddToCollectionMenu({ x: e.clientX, y: e.clientY, assets: [asset] });
                } catch (err) {
                    try {
                        console.error("Add to collection failed:", err);
                    } catch {}
                }
            }))
        );

        menu.appendChild(separator());

        menu.appendChild(createItem("Edit Tags...", "pi pi-tags", VIEWER_SHORTCUTS.EDIT_TAGS, withClose(() => {
            showTagsPopover(e.clientX + 6, e.clientY + 6, asset, onAssetChanged);
        })));

        menu.appendChild(separator());

        const ratingRoot = createItem("Set rating", "pi pi-star", VIEWER_SHORTCUTS.RATING_SUBMENU + " ›", () => {}, { disabled: !asset?.id });
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
                        setRating(asset, n, onAssetChanged);
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
                    setRating(asset, 0, onAssetChanged);
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

        menu.appendChild(
            createItem("Refresh metadata", "pi pi-sync", "R", withClose(async () => {
                if (!asset?.id) return;
                try {
                    const res = await getViewerInfo(asset.id, { refresh: true });
                    if (!res?.ok || !res?.data) {
                        comfyToast(res?.error || "Failed to refresh metadata.", "error");
                        return;
                    }
                    const info = res.data;
                    try {
                        safeDispatchCustomEvent(
                            VIEWER_INFO_REFRESHED_EVENT,
                            { assetId: String(asset.id), info },
                            { warnPrefix: "[ViewerContextMenu]" }
                        );
                    } catch {}
                    const parts = [];
                    const sizeLabel = formatReadableSize(info?.size_bytes);
                    if (sizeLabel) parts.push(sizeLabel);
                    if (info?.mime) parts.push(info.mime);
                    const suffix = parts.length ? ` (${parts.join(", ")})` : "";
                    comfyToast(`Metadata refreshed${suffix}`, "success", 3000);
                } catch (error) {
                    reportError(error, "[ViewerContextMenu] Metadata refresh", { showToast: true });
                }
            }), { disabled: !asset?.id })
        );
        menu.appendChild(separator());

        // Rename option
        menu.appendChild(
            createItem("Rename...", "pi pi-pencil", VIEWER_SHORTCUTS.RENAME, withClose(async () => {
                if (!asset?.id) return;

                const currentName = asset.filename || "";
                const rawInput = await comfyPrompt("Rename file", currentName);
                const newName = sanitizeFilename(rawInput);
                if (!newName || newName === currentName) return;
                const validation = validateFilename(newName);
                if (!validation.valid) {
                    comfyToast(validation.reason, "error");
                    return;
                }

                try {
                    const renameResult = await renameAsset(asset.id, newName);
                    if (renameResult?.ok) {
                        // Update the asset object
                        asset.filename = newName;
                        asset.filepath = asset.filepath.replace(/[^\\/]+$/, newName);

                        comfyToast(t("toast.fileRenamedSuccess"), "success");
                        onAssetChanged?.();
                    } else {
                        comfyToast(renameResult?.error || t("toast.fileRenameFailed"), "error");
                    }
                } catch (error) {
                    comfyToast(`Error renaming file: ${error.message}`, "error");
                }
            }), { disabled: !asset?.id })
        );

        // Delete option
        menu.appendChild(
            createItem("Delete...", "pi pi-trash", VIEWER_SHORTCUTS.DELETE, withClose(async () => {
                if (!asset?.id) return;

                const ok = await confirmDeletion(1, asset?.filename);
                if (!ok) return;

                try {
                    const deleteResult = await deleteAsset(asset.id);
                    if (deleteResult?.ok) {
                        comfyToast(t("toast.fileDeletedSuccess"), "success");
                        // Close viewer or navigate to next asset
                        onAssetChanged?.();
                    } else {
                        comfyToast(deleteResult?.error || t("toast.fileDeleteFailed"), "error");
                    }
                } catch (error) {
                    comfyToast(`Error deleting file: ${error.message}`, "error");
                }
            }), { disabled: !asset?.id })
        );

        showAt(menu, e.clientX, e.clientY);
    };

    try {
        overlayEl.addEventListener("contextmenu", handler);
    } catch (err) {
        console.error("[ViewerContextMenu] Failed to bind:", err);
    }

    overlayEl._mjrViewerContextMenuBound = true;
    const unbind = () => {
        try {
            overlayEl.removeEventListener("contextmenu", handler);
        } catch {}
        try {
            cancelAllRatingUpdates();
        } catch {}
        try {
            cleanupMenu(menu);
        } catch {}
        try {
            overlayEl._mjrViewerContextMenuBound = false;
        } catch {}
        try {
            overlayEl._mjrViewerContextMenuUnbind = null;
        } catch {}
    };
    overlayEl._mjrViewerContextMenuUnbind = unbind;
    return unbind;
}
