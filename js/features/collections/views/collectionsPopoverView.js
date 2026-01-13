export function createCollectionsPopoverView() {
    const collectionsPopover = document.createElement("div");
    collectionsPopover.className = "mjr-popover mjr-collections-popover";
    collectionsPopover.style.display = "none";

    const collectionsMenu = document.createElement("div");
    collectionsMenu.className = "mjr-menu";
    collectionsPopover.appendChild(collectionsMenu);

    return { collectionsPopover, collectionsMenu };
}

