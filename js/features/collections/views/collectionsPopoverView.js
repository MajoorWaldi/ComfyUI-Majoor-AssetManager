export function createCollectionsPopoverView() {
    const collectionsPopover = document.createElement("div");
    collectionsPopover.className = "mjr-popover mjr-collections-popover";
    collectionsPopover.style.display = "none";
    collectionsPopover.style.cssText = "display:none;";

    const collectionsMenu = document.createElement("div");
    collectionsMenu.className = "mjr-menu";
    collectionsMenu.style.cssText = "display:grid; gap:6px;";
    collectionsPopover.appendChild(collectionsMenu);

    return { collectionsPopover, collectionsMenu };
}

