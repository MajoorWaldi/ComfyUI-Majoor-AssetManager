export function createSortPopoverView() {
    const sortPopover = document.createElement("div");
    sortPopover.className = "mjr-popover mjr-sort-popover";
    sortPopover.style.display = "none";
    sortPopover.style.cssText = "display:none;";

    const sortMenu = document.createElement("div");
    sortMenu.className = "mjr-menu";
    sortMenu.style.cssText = "display:grid; gap:6px;";
    sortPopover.appendChild(sortMenu);

    return { sortPopover, sortMenu };
}

