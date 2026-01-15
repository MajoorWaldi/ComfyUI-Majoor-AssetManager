/**
 * Context Menu Component
 * Right-click menu for asset cards.
 *
 * Notes:
 * - Idempotent: binds once per grid container.
 * - Safe defaults: only uses existing backend routes.
 * - Uses PrimeIcons (`pi pi-*`) for icons.
 */

import { getViewerInstance } from "./Viewer.js";
import { buildAssetViewURL } from "../api/endpoints.js";
import { comfyAlert } from "../app/dialogs.js";
import { openInFolder } from "../api/client.js";
import { showAddToCollectionMenu } from "../features/collections/contextmenu/addToCollectionMenu.js";

// NOTE: Keep this menu isolated from the newer grid context menu
// (`.mjr-grid-context-menu`) to avoid selector collisions.
const MENU_SELECTOR = ".mjr-legacy-context-menu";

export function createContextMenu() {
    const existing = document.querySelector(MENU_SELECTOR);
    if (existing) return existing;

    const menu = document.createElement("div");
    menu.className = "mjr-context-menu mjr-legacy-context-menu";
    menu.style.cssText = `
        position: fixed;
        background: var(--comfy-menu-bg);
        border: 1px solid var(--border-color);
        border-radius: 6px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        min-width: 200px;
        z-index: 9999;
        display: none;
        padding: 4px 0;
    `;

    const hide = () => {
        menu.style.display = "none";
    };

    const ac = new AbortController();
    menu._mjrAbortController = ac;

    document.addEventListener(
        "click",
        (e) => {
            if (!menu.contains(e.target)) hide();
        },
        { signal: ac.signal }
    );
    document.addEventListener(
        "keydown",
        (e) => {
            if (e.key === "Escape") hide();
        },
        { signal: ac.signal }
    );
    document.addEventListener("scroll", hide, { capture: true, passive: true, signal: ac.signal });

    document.body.appendChild(menu);
    return menu;
}

function createMenuItem(label, iconClass, shortcut, onClick) {
    const item = document.createElement("div");
    item.className = "mjr-context-menu-item";
    item.style.cssText = `
        padding: 8px 16px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        cursor: pointer;
        color: var(--fg-color);
        font-size: 13px;
        transition: background 0.15s;
        user-select: none;
    `;

    const leftSide = document.createElement("div");
    leftSide.style.cssText = "display: flex; align-items: center; gap: 10px;";

    if (iconClass) {
        const iconEl = document.createElement("i");
        iconEl.className = iconClass;
        iconEl.style.cssText = "width: 16px; text-align: center; opacity: 0.8;";
        leftSide.appendChild(iconEl);
    }

    const labelEl = document.createElement("span");
    labelEl.textContent = label;
    leftSide.appendChild(labelEl);
    item.appendChild(leftSide);

    if (shortcut) {
        const shortcutEl = document.createElement("span");
        shortcutEl.textContent = shortcut;
        shortcutEl.style.cssText = "font-size: 11px; opacity: 0.5; margin-left: 20px;";
        item.appendChild(shortcutEl);
    }

    item.addEventListener("mouseenter", () => {
        item.style.background = "var(--comfy-input-bg)";
    });
    item.addEventListener("mouseleave", () => {
        item.style.background = "transparent";
    });

    item.addEventListener("click", (e) => {
        e.stopPropagation();
        try {
            onClick?.();
        } catch {}
    });

    return item;
}

function createMenuSeparator() {
    const separator = document.createElement("div");
    separator.className = "mjr-context-menu-separator";
    separator.style.cssText = `
        height: 1px;
        background: var(--border-color);
        margin: 4px 0;
    `;
    return separator;
}

export function showContextMenu(x, y, asset, allAssets, currentIndex, selectedAssets = [], { onDetails } = {}) {
    const menu = createContextMenu();
    menu.innerHTML = "";

    const selectedCount = selectedAssets.length;
    const hide = () => {
        try {
            menu.style.display = "none";
        } catch {}
    };

    const openViewer = createMenuItem("Open in Viewer", "pi pi-eye", "Double-click", () => {
        const viewer = getViewerInstance();
        if (selectedCount >= 2 && selectedCount <= 4) {
            viewer.open(selectedAssets, 0);
        } else {
            viewer.open(allAssets, currentIndex);
        }
    });
    menu.appendChild(openViewer);

    const details = createMenuItem("Details", "pi pi-info-circle", "D", () => {
        hide();
        try {
            onDetails?.(asset);
        } catch {}
    });
    menu.appendChild(details);

    const openNewTab = createMenuItem("Open in New Tab", "pi pi-external-link", null, () => {
        hide();
        const url = buildAssetViewURL(asset);
        window.open(url, "_blank");
    });
    menu.appendChild(openNewTab);

    menu.appendChild(createMenuSeparator());

    if (selectedCount === 2) {
        const ab = createMenuItem("Compare A/B (2 selected)", "pi pi-clone", null, () => {
            const viewer = getViewerInstance();
            viewer.open(selectedAssets, 0);
            viewer.setMode("ab");
        });
        menu.appendChild(ab);
    }

    if (selectedCount >= 2 && selectedCount <= 4) {
        const side = createMenuItem(`Side-by-side (2×2) (${selectedCount} selected)`, "pi pi-table", null, () => {
            const viewer = getViewerInstance();
            viewer.open(selectedAssets, 0);
            viewer.setMode("sidebyside");
        });
        menu.appendChild(side);
    }

    const copyPath = createMenuItem("Copy file path", "pi pi-copy", null, async () => {
        try {
            const path = asset?.filepath ? String(asset.filepath) : "";
            if (!path) {
                await comfyAlert("No file path available for this asset.");
                return;
            }
            await navigator.clipboard.writeText(path);
        } catch (error) {
            console.error("Copy path failed:", error);
        }
        hide();
    });
    menu.appendChild(copyPath);

    const addToCollection = createMenuItem(
        selectedCount > 1 ? `Add to collection... (${selectedCount})` : "Add to collection...",
        "pi pi-bookmark",
        null,
        async () => {
            hide();
            try {
                const list = selectedAssets?.length ? selectedAssets : [asset];
                await showAddToCollectionMenu({ x, y, assets: list });
            } catch (err) {
                console.error("Add to collection failed:", err);
            }
        }
    );
    menu.appendChild(addToCollection);

    const openFolder = createMenuItem("Open in Folder", "pi pi-folder-open", null, async () => {
        try {
            const assetId = asset?.id;
            if (!assetId) {
                await comfyAlert("No asset id available for this item.");
                return;
            }
            const res = await openInFolder(assetId);
            if (!res?.ok) {
                await comfyAlert(res?.error || "Failed to open folder.");
            }
        } catch (error) {
            console.error("Open in folder failed:", error);
        }
        hide();
    });
    menu.appendChild(openFolder);

    menu.style.display = "block";

    const rect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let finalX = x;
    let finalY = y;

    if (x + rect.width > viewportWidth) {
        finalX = viewportWidth - rect.width - 10;
    }
    if (y + rect.height > viewportHeight) {
        finalY = viewportHeight - rect.height - 10;
    }

    menu.style.left = `${finalX}px`;
    menu.style.top = `${finalY}px`;
}

export function bindContextMenu(gridContainer, assets) {
    try {
        gridContainer._mjrContextMenuAssets = Array.isArray(assets) ? assets : [];
    } catch {}

    // If the panel has the newer grid context menu bound, don't bind the legacy one.
    try {
        if (gridContainer?._mjrGridContextMenuBound) return;
    } catch {}

    if (gridContainer._mjrContextMenuBound) return;
    gridContainer._mjrContextMenuBound = true;

    gridContainer.addEventListener("contextmenu", (e) => {
        const card = e.target.closest(".mjr-asset-card");
        if (!card) return;

        e.preventDefault();
        e.stopPropagation();

        // If right-clicking on a non-selected card, treat it as a single selection.
        try {
            if (!card.classList.contains("is-selected")) {
                for (const el of gridContainer.querySelectorAll(".mjr-asset-card.is-selected")) {
                    el.classList.remove("is-selected");
                    el.setAttribute?.("aria-selected", "false");
                }
                card.classList.add("is-selected");
                card.setAttribute?.("aria-selected", "true");
                try {
                    const id = card?.dataset?.mjrAssetId;
                    if (id) {
                        gridContainer.dataset.mjrSelectedAssetId = String(id);
                        gridContainer.dataset.mjrSelectedAssetIds = JSON.stringify([String(id)]);
                    }
                } catch {}
            }
        } catch {}

        const currentAsset = card._mjrAsset;
        if (!currentAsset) return;

        const list = gridContainer._mjrContextMenuAssets || [];
        const idx = Array.isArray(list) ? list.findIndex((a) => a.id === currentAsset.id) : -1;

        const selected = Array.from(gridContainer.querySelectorAll(".mjr-asset-card.is-selected"))
            .map((c) => c?._mjrAsset)
            .filter(Boolean);

        // Keep dataset selection in sync so selection survives grid re-renders.
        try {
            const ids = Array.from(gridContainer.querySelectorAll(".mjr-asset-card.is-selected"))
                .map((c) => c?.dataset?.mjrAssetId)
                .filter(Boolean)
                .map(String);
            gridContainer.dataset.mjrSelectedAssetIds = JSON.stringify(ids);
            if (card?.dataset?.mjrAssetId) gridContainer.dataset.mjrSelectedAssetId = String(card.dataset.mjrAssetId);
        } catch {}

        showContextMenu(e.clientX, e.clientY, currentAsset, list, idx, selected, {
            onDetails: typeof gridContainer._mjrOpenDetails === "function" ? gridContainer._mjrOpenDetails : null,
        });
    });
}
