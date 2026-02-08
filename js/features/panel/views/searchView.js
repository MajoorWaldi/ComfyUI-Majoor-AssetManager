import { get } from "../../../api/client.js";
import { debounce } from "../../../utils/debounce.js";

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

    // Autocomplete datalist
    const dataListId = "mjr-search-autocomplete-" + Math.random().toString(36).substr(2, 9);
    const dataList = document.createElement("datalist");
    dataList.id = dataListId;
    
    const searchInputEl = document.createElement("input");
    searchInputEl.type = "text";
    searchInputEl.id = "mjr-search-input";
    searchInputEl.classList.add("mjr-input");
    searchInputEl.placeholder = "Search assets...";
    searchInputEl.title = "Search by filename, tags, or attributes (e.g. rating:5, ext:png)";
    searchInputEl.setAttribute("list", dataListId);

    // Autocomplete handler
    const handleAutocomplete = debounce(async (e) => {
        const val = (e.target.value || "").trim();
        // Trigger only if generic search (not attribute search like rating:5)
        if (val.length < 2 || val.includes(":")) return; 

        try {
            const res = await get("/mjr/am/autocomplete", { q: val, limit: 10 });
            if (res && res.ok && Array.isArray(res.data)) {
                // Keep current options if focused? Datalist handles this.
                dataList.innerHTML = "";
                res.data.forEach(term => {
                    const opt = document.createElement("option");
                    opt.value = term;
                    dataList.appendChild(opt);
                });
            }
        } catch {
            // Ignore autocomplete errors
        }
    }, 300);

    searchInputEl.addEventListener("input", handleAutocomplete);

    searchInner.appendChild(searchIcon);
    searchInner.appendChild(searchInputEl);
    searchInner.appendChild(dataList);
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

