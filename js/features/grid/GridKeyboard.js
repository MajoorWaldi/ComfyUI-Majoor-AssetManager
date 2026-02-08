/**
 * Grid Keyboard Shortcuts - Keyboard navigation and actions for asset grid
 *
 * Shortcuts are designed to be:
 * - Mnemonic (easy to remember)
 * - Standard (consistent with Lightroom, Windows, macOS)
 * - Non-conflicting with browser/ComfyUI defaults
 *
 * @see docs/SHORTCUTS.md for full documentation
 */

import { comfyToast } from "../../app/toast.js";
import { t } from "../../app/i18n.js";
import { comfyPrompt } from "../../app/dialogs.js";
import { openInFolder, updateAssetRating, deleteAsset, renameAsset } from "../../api/client.js";
import { buildDownloadURL } from "../../api/endpoints.js";
import { ASSET_RATING_CHANGED_EVENT } from "../../app/events.js";
import { safeDispatchCustomEvent } from "../../utils/events.js";
import { getViewerInstance } from "../../components/Viewer.js";
import { showAddToCollectionMenu } from "../collections/contextmenu/addToCollectionMenu.js";

/**
 * Keyboard shortcut definitions
 * Format: { key, ctrl, shift, alt, action, description }
 */
export const GRID_SHORTCUTS = {
    // Viewing
    OPEN_VIEWER: { key: "Enter", description: "Open selected in viewer" },
    OPEN_VIEWER_ALT: { key: " ", description: "Open selected in viewer" },
    METADATA_PANEL: { key: "d", description: "Show metadata panel (Details)" },
    COMPARE_AB: { key: "c", description: "Compare A/B (2 selected)" },
    SIDE_BY_SIDE: { key: "g", description: "Side-by-side Grid view (2-4 selected)" },

    // Rating (Lightroom/Bridge standard)
    RATING_1: { key: "1", description: "Set rating 1 star" },
    RATING_2: { key: "2", description: "Set rating 2 stars" },
    RATING_3: { key: "3", description: "Set rating 3 stars" },
    RATING_4: { key: "4", description: "Set rating 4 stars" },
    RATING_5: { key: "5", description: "Set rating 5 stars" },
    RATING_RESET: { key: "0", description: "Reset rating" },

    // Organization
    EDIT_TAGS: { key: "t", description: "Edit Tags" },
    ADD_TO_COLLECTION: { key: "b", description: "Add to collection (Bookmark)" },
    REMOVE_FROM_COLLECTION: { key: "b", shift: true, description: "Remove from collection" },

    // File operations
    COPY_PATH: { key: "c", ctrl: true, shift: true, description: "Copy file path" },
    DOWNLOAD: { key: "s", ctrl: true, description: "Download file" },
    RENAME: { key: "F2", description: "Rename file" },
    DELETE: { key: "Delete", description: "Delete file" },
    DELETE_ALT: { key: "Backspace", description: "Delete file" },
    OPEN_IN_FOLDER: { key: "e", ctrl: true, shift: true, description: "Open in folder (Explorer)" },

    // Selection
    SELECT_ALL: { key: "a", ctrl: true, description: "Select all" },
    DESELECT_ALL: { key: "d", ctrl: true, description: "Deselect all" },

    // Navigation
    NAV_UP: { key: "ArrowUp", description: "Navigate up" },
    NAV_DOWN: { key: "ArrowDown", description: "Navigate down" },
    NAV_LEFT: { key: "ArrowLeft", description: "Navigate left" },
    NAV_RIGHT: { key: "ArrowRight", description: "Navigate right" },
};

/**
 * Format shortcut for display in context menu
 * @param {Object} shortcut - Shortcut definition
 * @returns {string} Formatted shortcut string (e.g., "Ctrl+Shift+C")
 */
export function formatShortcut(shortcut) {
    if (!shortcut) return "";
    const parts = [];
    if (shortcut.ctrl) parts.push("Ctrl");
    if (shortcut.shift) parts.push("Shift");
    if (shortcut.alt) parts.push("Alt");

    let key = shortcut.key;
    // Format special keys
    if (key === " ") key = "Space";
    if (key === "Delete") key = "Del";
    if (key === "ArrowUp") key = "↑";
    if (key === "ArrowDown") key = "↓";
    if (key === "ArrowLeft") key = "←";
    if (key === "ArrowRight") key = "→";

    parts.push(key.length === 1 ? key.toUpperCase() : key);
    return parts.join("+");
}

/**
 * Check if a keyboard event matches a shortcut definition
 * @param {KeyboardEvent} e - Keyboard event
 * @param {Object} shortcut - Shortcut definition
 * @returns {boolean} True if event matches shortcut
 */
function matchesShortcut(e, shortcut) {
    if (!shortcut || !e) return false;

    const keyMatches = e.key.toLowerCase() === shortcut.key.toLowerCase() ||
                       e.key === shortcut.key;
    const ctrlMatches = !!shortcut.ctrl === (e.ctrlKey || e.metaKey);
    const shiftMatches = !!shortcut.shift === e.shiftKey;
    const altMatches = !!shortcut.alt === e.altKey;

    return keyMatches && ctrlMatches && shiftMatches && altMatches;
}

/**
 * Rating debounce state
 */
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
        onChanged?.();
    } catch {}

    const t = setTimeout(async () => {
        try {
            _ratingDebounceTimers.delete(id);
            const result = await updateAssetRating(assetId, rating);
            if (!result?.ok) {
                comfyToast(result?.error || t("toast.ratingUpdateFailed"), "error");
                return;
            }
            comfyToast(t("toast.ratingSetN", { n: rating }), "success", 1500);
            safeDispatchCustomEvent(
                ASSET_RATING_CHANGED_EVENT,
                { assetId: String(assetId), rating },
                { warnPrefix: "[GridKeyboard]" }
            );
        } catch (err) {
            console.error("[GridKeyboard] Rating update failed:", err);
            comfyToast(t("toast.ratingUpdateError"), "error");
        }
    }, 350);

    _ratingDebounceTimers.set(id, t);
}

/**
 * Install keyboard shortcuts for the asset grid
 *
 * @param {Object} options - Configuration options
 * @param {HTMLElement} options.gridContainer - Grid container element
 * @param {Function} options.getState - Function to get panel state
 * @param {Function} options.getSelectedAssets - Function to get selected assets
 * @param {Function} options.getActiveAsset - Function to get the active/focused asset
 * @param {Function} options.onOpenDetails - Callback to open details panel
 * @param {Function} options.onOpenTagsEditor - Callback to open tags editor
 * @param {Function} options.onSelectionChanged - Callback when selection changes
 * @param {Function} options.onAssetChanged - Callback when asset is modified
 * @returns {Object} Object with bind, unbind, and dispose methods
 */
export function installGridKeyboard({
    gridContainer,
    getState = () => ({}),
    getSelectedAssets = () => [],
    getActiveAsset = () => null,
    onOpenDetails = () => {},
    onOpenTagsEditor = () => {},
    onSelectionChanged = () => {},
    onAssetChanged = () => {},
} = {}) {
    if (!gridContainer) return { bind: () => {}, unbind: () => {}, dispose: () => {} };

    let keydownHandler = null;
    let bound = false;

    const getSelection = () => {
        try {
            return getSelectedAssets() || [];
        } catch {
            return [];
        }
    };

    const getActive = () => {
        try {
            const active = getActiveAsset();
            if (active) return active;
            // Fallback: first selected
            const selected = getSelection();
            return selected[0] || null;
        } catch {
            return null;
        }
    };

    const handleKeydown = async (e) => {
        // Skip if typing in input
        const target = e.target;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
            return;
        }

        // Skip if hotkeys suspended (dialog open, etc.)
        if (globalThis?._mjrHotkeysState?.suspended) return;

        // Skip if grid not visible/focused
        // Allow if focus is:
        // 1. Inside grid (contains active)
        // 2. On grid parent wrapper (active contains grid)
        // 3. On body (no specific focus)
        // 4. On a card (explicit check though covered by 1 usually)
        if (document.activeElement !== document.body) {
            const active = document.activeElement;
            const inGrid = gridContainer.contains(active);
            const wrapsGrid = active && active.contains && active.contains(gridContainer);
            const isCard = active?.closest?.('.mjr-asset-card');

            if (!inGrid && !wrapsGrid && !isCard) {
                return;
            }
        }

        const consume = () => {
            e.preventDefault();
            e.stopPropagation();
        };

        const selected = getSelection();
        const asset = getActive();
        const state = getState();

        // Rating shortcuts (1-5, 0 for reset) - Lightroom/Bridge standard
        if (!e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
            if (matchesShortcut(e, GRID_SHORTCUTS.RATING_1)) {
                if (asset?.id) { consume(); setRating(asset, 1, onAssetChanged); return; }
            }
            if (matchesShortcut(e, GRID_SHORTCUTS.RATING_2)) {
                if (asset?.id) { consume(); setRating(asset, 2, onAssetChanged); return; }
            }
            if (matchesShortcut(e, GRID_SHORTCUTS.RATING_3)) {
                if (asset?.id) { consume(); setRating(asset, 3, onAssetChanged); return; }
            }
            if (matchesShortcut(e, GRID_SHORTCUTS.RATING_4)) {
                if (asset?.id) { consume(); setRating(asset, 4, onAssetChanged); return; }
            }
            if (matchesShortcut(e, GRID_SHORTCUTS.RATING_5)) {
                if (asset?.id) { consume(); setRating(asset, 5, onAssetChanged); return; }
            }
            if (matchesShortcut(e, GRID_SHORTCUTS.RATING_RESET)) {
                if (asset?.id) { consume(); setRating(asset, 0, onAssetChanged); return; }
            }
        }

        // Open Viewer (Enter or Space)
        if (matchesShortcut(e, GRID_SHORTCUTS.OPEN_VIEWER) || matchesShortcut(e, GRID_SHORTCUTS.OPEN_VIEWER_ALT)) {
            if (selected.length > 0) {
                consume();
                try {
                    const viewer = getViewerInstance();
                    if (selected.length >= 2 && selected.length <= 4) {
                        viewer.open(selected, 0);
                    } else {
                        // Open all assets from grid, starting at active
                        let allAssets = [];
                        if (Array.isArray(state?.assets) && state.assets.length) {
                            allAssets = state.assets;
                        } else if (typeof gridContainer?._mjrGetAssets === "function") {
                            const list = gridContainer._mjrGetAssets();
                            if (Array.isArray(list) && list.length) allAssets = list;
                        } else {
                            allAssets = Array.from(gridContainer.querySelectorAll('.mjr-asset-card'))
                                .map(card => card._mjrAsset)
                                .filter(Boolean);
                        }
                        const idx = allAssets.findIndex(a => String(a?.id) === String(asset?.id));
                        viewer.open(allAssets, Math.max(0, idx));
                    }
                } catch (err) {
                    console.error("[GridKeyboard] Open viewer failed:", err);
                }
                return;
            }
        }

        // Metadata panel (D)
        if (matchesShortcut(e, GRID_SHORTCUTS.METADATA_PANEL)) {
            if (asset) {
                consume();
                onOpenDetails(asset);
                return;
            }
        }

        // Compare A/B (C) - 2 selected only
        if (matchesShortcut(e, GRID_SHORTCUTS.COMPARE_AB)) {
            if (selected.length === 2) {
                consume();
                try {
                    const viewer = getViewerInstance();
                    viewer.open(selected, 0);
                    viewer.setMode?.("ab");
                } catch {}
                return;
            }
        }

        // Side-by-side (G) - 2-4 selected
        if (matchesShortcut(e, GRID_SHORTCUTS.SIDE_BY_SIDE)) {
            if (selected.length >= 2 && selected.length <= 4) {
                consume();
                try {
                    const viewer = getViewerInstance();
                    viewer.open(selected, 0);
                    viewer.setMode?.("sidebyside");
                } catch {}
                return;
            }
        }

        // Edit Tags (T)
        if (matchesShortcut(e, GRID_SHORTCUTS.EDIT_TAGS)) {
            if (asset?.id) {
                consume();
                onOpenTagsEditor(asset);
                return;
            }
        }

        // Add to collection (B)
        if (matchesShortcut(e, GRID_SHORTCUTS.ADD_TO_COLLECTION)) {
            if (selected.length > 0 || asset) {
                consume();
                const list = selected.length > 0 ? selected : [asset];
                // Show menu at center of grid
                const rect = gridContainer.getBoundingClientRect();
                await showAddToCollectionMenu({
                    x: rect.left + rect.width / 2,
                    y: rect.top + rect.height / 2,
                    assets: list
                });
                return;
            }
        }

        // Remove from collection (Shift+B)
        if (matchesShortcut(e, GRID_SHORTCUTS.REMOVE_FROM_COLLECTION)) {
            const collectionId = state?.collectionId;
            if (collectionId && (selected.length > 0 || asset)) {
                consume();
                // Trigger reload to remove
                try {
                    gridContainer.dispatchEvent(new CustomEvent("mjr:reload-grid"));
                } catch {}
                return;
            }
        }

        // Copy file path (Ctrl+Shift+C)
        if (matchesShortcut(e, GRID_SHORTCUTS.COPY_PATH)) {
            if (asset?.filepath) {
                consume();
                try {
                    await navigator.clipboard.writeText(asset.filepath);
                    comfyToast(t("toast.pathCopied"), "success", 2000);
                } catch {
                    comfyToast(t("toast.pathCopyFailed"), "error");
                }
                return;
            }
        }

        // Download (Ctrl+S)
        if (matchesShortcut(e, GRID_SHORTCUTS.DOWNLOAD)) {
            if (asset?.filepath) {
                consume();
                const url = buildDownloadURL(asset.filepath);
                const link = document.createElement("a");
                link.href = url;
                link.download = asset.filename || "download";
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                comfyToast(`Downloading ${asset.filename}...`, "info", 3000);
                return;
            }
        }

        // Open in Folder (Ctrl+Shift+E)
        if (matchesShortcut(e, GRID_SHORTCUTS.OPEN_IN_FOLDER)) {
            if (asset?.id) {
                consume();
                const res = await openInFolder(asset.id);
                if (!res?.ok) {
                    comfyToast(res?.error || t("toast.openFolderFailed"), "error");
                } else {
                    comfyToast(t("toast.openedInFolder"), "info", 2000);
                }
                return;
            }
        }

        // Rename (F2)
        if (matchesShortcut(e, GRID_SHORTCUTS.RENAME)) {
            if (asset?.id) {
                consume();
                const currentName = asset.filename || "";
                const newName = await comfyPrompt("Rename file", currentName);
                if (newName && newName !== currentName) {
                    try {
                        const result = await renameAsset(asset.id, newName);
                        if (result?.ok) {
                            asset.filename = newName;
                            asset.filepath = asset.filepath?.replace(/[^\\/]+$/, newName);
                            comfyToast(t("toast.fileRenamedSuccess"), "success");
                            onAssetChanged();
                        } else {
                            comfyToast(result?.error || t("toast.fileRenameFailed"), "error");
                        }
                    } catch (err) {
                        comfyToast(`Error renaming: ${err.message}`, "error");
                    }
                }
                return;
            }
        }

        // Delete (Delete/Backspace)
        if (matchesShortcut(e, GRID_SHORTCUTS.DELETE) || matchesShortcut(e, GRID_SHORTCUTS.DELETE_ALT)) {
            if (asset?.id || selected.length > 0) {
                consume();
                const toDelete = selected.length > 0 ? selected : [asset];
                let successCount = 0;
                let errorCount = 0;
                const deletedIds = [];

                for (const a of toDelete) {
                    if (!a?.id) continue;
                    try {
                        const result = await deleteAsset(a.id);
                        if (result?.ok) {
                            successCount++;
                            deletedIds.push(String(a.id));
                        } else {
                            errorCount++;
                        }
                    } catch {
                        errorCount++;
                    }
                }

                if (deletedIds.length) {
                    try {
                        const removeFn = gridContainer?._mjrRemoveAssets;
                        if (typeof removeFn === "function") {
                            removeFn(deletedIds);
                        } else {
                            for (const id of deletedIds) {
                                const card = gridContainer.querySelector(`[data-mjr-asset-id="${id}"]`);
                                card?.remove?.();
                            }
                        }
                    } catch {}
                }

                if (errorCount === 0) {
                    comfyToast(`${successCount} file${successCount !== 1 ? 's' : ''} deleted`, "success");
                } else {
                    comfyToast(`${successCount} deleted, ${errorCount} failed`, "warning");
                }
                try {
                    if (typeof gridContainer?._mjrSetSelection === "function") {
                        const remaining = selected.filter(a => !deletedIds.includes(String(a?.id || ""))).map(a => String(a?.id || "")).filter(Boolean);
                        gridContainer._mjrSetSelection(remaining, remaining[0] || "");
                    }
                } catch {}
                onSelectionChanged();
                return;
            }
        }

        // Select All (Ctrl+A)
        if (matchesShortcut(e, GRID_SHORTCUTS.SELECT_ALL)) {
            consume();
            let ids = [];
            try {
                if (Array.isArray(state?.assets) && state.assets.length) {
                    ids = state.assets.map(a => String(a?.id || "")).filter(Boolean);
                } else if (typeof gridContainer?._mjrGetAssets === "function") {
                    const list = gridContainer._mjrGetAssets();
                    if (Array.isArray(list)) ids = list.map(a => String(a?.id || "")).filter(Boolean);
                }
            } catch {}
            if (!ids.length) {
                try {
                    const cards = gridContainer.querySelectorAll('.mjr-asset-card');
                    ids = Array.from(cards).map(card => String(card?._mjrAsset?.id || "")).filter(Boolean);
                } catch {}
            }
            try {
                if (typeof gridContainer?._mjrSetSelection === "function") {
                    gridContainer._mjrSetSelection(ids, ids[0] || "");
                } else {
                    const cards = gridContainer.querySelectorAll('.mjr-asset-card');
                    cards.forEach(card => {
                        card.classList.add('is-selected');
                        card.setAttribute('aria-selected', 'true');
                    });
                    gridContainer.dataset.mjrSelectedAssetIds = JSON.stringify(ids);
                    gridContainer.dataset.mjrSelectedAssetId = String(ids[0] || "");
                }
            } catch {}
            onSelectionChanged();
            return;
        }

        // Deselect All (Ctrl+D)
        if (matchesShortcut(e, GRID_SHORTCUTS.DESELECT_ALL)) {
            consume();
            try {
                if (typeof gridContainer?._mjrSetSelection === "function") {
                    gridContainer._mjrSetSelection([], "");
                } else {
                    const cards = gridContainer.querySelectorAll('.mjr-asset-card.is-selected');
                    cards.forEach(card => {
                        card.classList.remove('is-selected');
                        card.setAttribute('aria-selected', 'false');
                    });
                    delete gridContainer.dataset.mjrSelectedAssetIds;
                    delete gridContainer.dataset.mjrSelectedAssetId;
                }
            } catch {}
            onSelectionChanged();
            return;
        }
    };

    const bind = () => {
        if (bound) return;
        keydownHandler = handleKeydown;
        document.addEventListener("keydown", keydownHandler, true);
        bound = true;
    };

    const unbind = () => {
        if (!bound || !keydownHandler) return;
        document.removeEventListener("keydown", keydownHandler, true);
        keydownHandler = null;
        bound = false;
    };

    const dispose = () => {
        unbind();
        // Clear pending timers
        for (const t of _ratingDebounceTimers.values()) {
            try { clearTimeout(t); } catch {}
        }
        _ratingDebounceTimers.clear();
    };

    return { bind, unbind, dispose };
}

/**
 * Get shortcut string for a specific action (for display in context menus)
 * @param {string} actionName - Name of the action (e.g., "OPEN_VIEWER", "METADATA_PANEL")
 * @returns {string} Formatted shortcut string or empty string
 */
export function getShortcutDisplay(actionName) {
    const shortcut = GRID_SHORTCUTS[actionName];
    return shortcut ? formatShortcut(shortcut) : "";
}
