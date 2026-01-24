import { createIconButton } from "./iconButton.js";
import { createTabsView } from "./tabsView.js";

export function createHeaderView() {
    const header = document.createElement("div");
    header.classList.add("mjr-am-header");

    const headerRow = document.createElement("div");
    headerRow.classList.add("mjr-am-header-row");

    const headerLeft = document.createElement("div");
    headerLeft.classList.add("mjr-am-header-left");

    const headerIcon = document.createElement("img");
    headerIcon.className = "mjr-am-header-icon";
    headerIcon.alt = "Assets Manager";
    try {
        headerIcon.src = new URL("../../../../ressources/icon.png", import.meta.url).toString();
    } catch {}

    const headerTitle = document.createElement("div");
    headerTitle.classList.add("mjr-am-header-title");
    headerTitle.textContent = "Assets Manager";

    headerLeft.appendChild(headerIcon);
    headerLeft.appendChild(headerTitle);

    const headerActions = document.createElement("div");
    headerActions.classList.add("mjr-am-header-actions");

    const headerTools = document.createElement("div");
    headerTools.classList.add("mjr-am-header-tools");

    const { tabs, tabButtons } = createTabsView();
    headerActions.appendChild(tabs);
    headerActions.appendChild(headerTools);

    const customMenuBtn = createIconButton("pi-folder-open", "Custom folders");
    const filterBtn = createIconButton("pi-filter", "Filters");
    const sortBtn = createIconButton("pi-sort", "Sort");
    const collectionsBtn = createIconButton("pi-bookmark", "Collections");

    customMenuBtn.style.display = "none";
    headerTools.appendChild(customMenuBtn);

    headerRow.appendChild(headerLeft);
    headerRow.appendChild(headerActions);
    header.appendChild(headerRow);

    return {
        header,
        headerActions,
        headerTools,
        tabs,
        tabButtons,
        customMenuBtn,
        filterBtn,
        sortBtn,
        collectionsBtn
    };
}

