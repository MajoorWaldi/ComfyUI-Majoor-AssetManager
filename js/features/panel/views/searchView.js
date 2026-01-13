export function createSearchView({ filterBtn, sortBtn, collectionsBtn, filterPopover, sortPopover, collectionsPopover }) {
    const searchSection = document.createElement("div");
    searchSection.classList.add("mjr-am-search");

    const searchInner = document.createElement("div");
    searchInner.classList.add("mjr-am-search-pill");

    const searchIcon = document.createElement("span");
    searchIcon.classList.add("mjr-am-search-icon");
    const searchIconEl = document.createElement("i");
    searchIconEl.className = "pi pi-search";
    searchIcon.appendChild(searchIconEl);

    const searchInputEl = document.createElement("input");
    searchInputEl.type = "text";
    searchInputEl.id = "mjr-search-input";
    searchInputEl.classList.add("mjr-input");
    searchInputEl.placeholder = "Search assets...";

    searchInner.appendChild(searchIcon);
    searchInner.appendChild(searchInputEl);
    searchSection.appendChild(searchInner);

    const searchTools = document.createElement("div");
    searchTools.className = "mjr-am-search-tools";

    const filterAnchor = document.createElement("div");
    filterAnchor.className = "mjr-popover-anchor";
    filterAnchor.appendChild(filterBtn);
    filterAnchor.appendChild(filterPopover);

    const sortAnchor = document.createElement("div");
    sortAnchor.className = "mjr-popover-anchor";
    sortAnchor.appendChild(sortBtn);
    sortAnchor.appendChild(sortPopover);

    const collectionsAnchor = document.createElement("div");
    collectionsAnchor.className = "mjr-popover-anchor";
    if (collectionsBtn) collectionsAnchor.appendChild(collectionsBtn);
    if (collectionsPopover) collectionsAnchor.appendChild(collectionsPopover);

    searchTools.appendChild(filterAnchor);
    searchTools.appendChild(sortAnchor);
    searchTools.appendChild(collectionsAnchor);
    searchSection.appendChild(searchTools);

    return { searchSection, searchInputEl };
}

