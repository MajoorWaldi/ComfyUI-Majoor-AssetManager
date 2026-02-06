import { createIconButton } from "./iconButton.js";
import { createTabsView } from "./tabsView.js";
import { get } from "../../../api/client.js";
import { ENDPOINTS } from "../../../api/endpoints.js";
import {
    VERSION_UPDATE_EVENT,
    getStoredVersionUpdateState,
} from "../../../app/versionCheck.js";

const DEFAULT_REPO_URL = "https://github.com/MajoorWaldi/ComfyUI-Majoor-AssetsManager";
const METADATA_URL = new URL("../../../comfyui_extension.json", import.meta.url);
let _extensionMetadataPromise = null;

function getExtensionMetadata() {
    if (!_extensionMetadataPromise) {
        _extensionMetadataPromise = (async () => {
            try {
                const response = await fetch(METADATA_URL.toString(), { credentials: "same-origin" });
                if (!response.ok) return {};
                return await response.json();
            } catch {
                return {};
            }
        })();
    }
    return _extensionMetadataPromise;
}

function applyExtensionMetadata(badge, isNightly) {
    getExtensionMetadata().then((info) => {
        const repo = (typeof info?.repository === "string" ? info.repository.trim() : "") || DEFAULT_REPO_URL;
        badge.href = repo;
        if (!isNightly) {
            const version = (typeof info?.version === "string" ? info.version.trim() : "") || "";
            if (version) {
                badge.textContent = `v${version}`;
            }
        }
    }).catch(() => {});
}

async function hydrateBackendVersionBadge(badge, isNightly) {
    try {
        const result = await get(ENDPOINTS.VERSION, { cache: "no-cache" });
        if (!result?.ok) {
            return;
        }
        const version = String(result.data?.version || "").trim();
        const branch = String(result.data?.branch || "").trim().toLowerCase();
        if (branch === "nightly" || version.toLowerCase() === "nightly" || isNightly) {
            badge.textContent = "nightly";
            return;
        }
        if (version) {
            badge.textContent = version.startsWith("v") ? version : `v${version}`;
        }
    } catch {
        // ignore
    }
}

function createVersionDot() {
    const dot = document.createElement("span");
    Object.assign(dot.style, {
        position: "absolute",
        top: "2px",
        right: "-3px",
        width: "6px",
        height: "6px",
        borderRadius: "50%",
        background: "#f44336",
        boxShadow: "0 0 0 1px rgba(255,255,255,0.6)",
        display: "none",
        pointerEvents: "none",
    });
    dot.setAttribute("aria-hidden", "true");
    return dot;
}

function updateVersionDot(dot, visible) {
    if (!dot) return;
    dot.style.display = visible ? "block" : "none";
}
// Detect branch from global or injected variable, fallback to nightly if present
let branch = "main";
if (window?.MajoorAssetsManagerBranch) {
    branch = window.MajoorAssetsManagerBranch;
} else if (typeof process !== "undefined" && process.env && process.env.MAJOR_ASSETS_MANAGER_BRANCH) {
    branch = process.env.MAJOR_ASSETS_MANAGER_BRANCH;
}
const IS_NIGHTLY = branch === "nightly";
const VERSION = IS_NIGHTLY ? "nightly" : "?";
const REPO_URL = DEFAULT_REPO_URL;

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
    versionBadge.style.position = "relative";
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

    const versionDot = createVersionDot();
    versionBadge.appendChild(versionDot);

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

    const applyDotState = (state) => {
        updateVersionDot(versionDot, Boolean(state?.available));
    };
    try {
        applyDotState(getStoredVersionUpdateState());
    } catch {}
    let versionUpdateListener = null;
    if (typeof window !== "undefined") {
        versionUpdateListener = (event) => {
            try {
                applyDotState(event?.detail);
            } catch {}
        };
        window.addEventListener(VERSION_UPDATE_EVENT, versionUpdateListener);
    }
    header._mjrVersionUpdateCleanup = () => {
        try {
            if (versionUpdateListener && typeof window !== "undefined") {
                window.removeEventListener(VERSION_UPDATE_EVENT, versionUpdateListener);
            }
        } catch {}
    };

    applyExtensionMetadata(versionBadge, IS_NIGHTLY);
    void hydrateBackendVersionBadge(versionBadge, IS_NIGHTLY);

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

