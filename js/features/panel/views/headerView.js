import { createIconButton } from "./iconButton.js";
import { createTabsView } from "./tabsView.js";

// Version info - update on release
const VERSION = "2.2.3";
const IS_NIGHTLY = false;
const REPO_URL = "https://github.com/MajoorWaldi/ComfyUI-Majoor-AssetsManager";

export function createHeaderView() {
    const header = document.createElement("div");
    header.classList.add("mjr-am-header");

    const headerRow = document.createElement("div");
    headerRow.classList.add("mjr-am-header-row");

    const headerLeft = document.createElement("div");
    headerLeft.classList.add("mjr-am-header-left");

    // Use PrimeIcons (ComfyUI ships them) for maximum compatibility across extension loaders.
    const headerIcon = document.createElement("i");
    headerIcon.className = "mjr-am-header-icon pi pi-folder";
    headerIcon.setAttribute("aria-hidden", "true");

    const headerTitle = document.createElement("div");
    headerTitle.classList.add("mjr-am-header-title");
    headerTitle.textContent = "Assets Manager";

    // Version badge with link to GitHub
    const versionBadge = document.createElement("a");
    versionBadge.href = REPO_URL;
    versionBadge.target = "_blank";
    versionBadge.rel = "noopener noreferrer";
    versionBadge.className = "mjr-am-version-badge";
    versionBadge.textContent = IS_NIGHTLY ? "nightly" : `v${VERSION}`;
    versionBadge.title = "Open GitHub repository";
    versionBadge.style.cssText = `
        font-size: 10px;
        opacity: 0.6;
        margin-left: 6px;
        padding: 2px 5px;
        border-radius: 4px;
        background: rgba(255, 255, 255, 0.08);
        color: inherit;
        text-decoration: none;
        cursor: pointer;
        transition: opacity 0.2s, background 0.2s;
        vertical-align: middle;
    `;
    versionBadge.onmouseenter = () => {
        versionBadge.style.opacity = "1";
        versionBadge.style.background = "rgba(255, 255, 255, 0.15)";
    };
    versionBadge.onmouseleave = () => {
        versionBadge.style.opacity = "0.6";
        versionBadge.style.background = "rgba(255, 255, 255, 0.08)";
    };

    headerLeft.appendChild(headerIcon);
    headerLeft.appendChild(headerTitle);
    headerLeft.appendChild(versionBadge);

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

