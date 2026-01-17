/**
 * Entry Point - Majoor Assets Manager
 * Registers extension with ComfyUI and mounts UI.
 */

import { app } from "../../scripts/app.js";
import { testAPI, triggerStartupScan } from "./app/bootstrap.js";
import { ensureStyleLoaded } from "./app/style.js";
import { registerMajoorSettings } from "./app/settings.js";
import { initDragDrop } from "./features/dnd/DragDrop.js";
import { loadAssets, upsertAsset, captureAnchor, restoreAnchor, isAtBottom, scrollToBottom } from "./features/grid/GridView.js";
import { renderAssetsManager, getActiveGridContainer } from "./features/panel/AssetsManagerPanel.js";
import { extractOutputFiles } from "./utils/extractOutputFiles.js";
import { post, get } from "./api/client.js";
import { ENDPOINTS } from "./api/endpoints.js";
import { buildListURL } from "./api/endpoints.js";

const UI_FLAGS = {
    useComfyThemeUI: true,
};

function isObservabilityEnabled() {
    try {
        const raw = localStorage?.getItem?.("mjrSettings");
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        return !!parsed?.observability?.enabled;
    } catch {
        return false;
    }
}

app.registerExtension({
    name: "Majoor.AssetsManager",

    async setup() {
        testAPI();
        ensureStyleLoaded({ enabled: UI_FLAGS.useComfyThemeUI });
        initDragDrop();

        registerMajoorSettings(app, () => {
            const grid = getActiveGridContainer();
            if (grid) loadAssets(grid);
        });

        triggerStartupScan();

        const api = app.api || (app.ui ? app.ui.api : null);
        if (api) {
            // Avoid double-binding when ComfyUI reloads extensions.
            try {
                if (api._mjrRtHandlers && typeof api._mjrRtHandlers === "object") {
                    for (const [evt, handler] of Object.entries(api._mjrRtHandlers)) {
                        try {
                            api.removeEventListener(String(evt), handler);
                        } catch {}
                    }
                } else if (api._mjrExecutedHandler) {
                    api.removeEventListener("executed", api._mjrExecutedHandler);
                }
            } catch {}

            api._mjrExecutedHandler = async (event) => {
                // ComfyUI variants differ: sometimes the payload is on `detail.output`, sometimes `detail` is the output.
                const output = event?.detail?.output || event?.detail || null;
                const grid = getActiveGridContainer();
                if (!output || !grid) return;

                const hasMedia = output.images || output.gifs || output.videos;
                if (!hasMedia) return;

                console.log("📂 Majoor [ℹ️] New media generated, refreshing grid...");

                setTimeout(async () => {
                    await new Promise((resolve) => setTimeout(resolve, 1500));

                    const files = extractOutputFiles(output);
                    if (!files.length) return;

                    const indexRes = await post(ENDPOINTS.INDEX_FILES, { files, incremental: true });
                    if (!indexRes?.ok) {
                        console.warn("📂 Majoor [⚠️] index-files failed:", indexRes?.error || indexRes);
                        return;
                    }

                    const latestGrid = getActiveGridContainer();
                    if (latestGrid) {
                        // Only auto-insert when browsing "*" (avoid disrupting active searches).
                        const currentQuery = String(latestGrid.dataset?.mjrQuery || "*").trim() || "*";
                        if (currentQuery !== "*" && currentQuery !== "") return;

                        // Use incremental update instead of full reload.
                        const anchor = captureAnchor(latestGrid);
                        const atBottomBefore = isAtBottom(latestGrid);

                        const scope = latestGrid.dataset?.mjrScope || "output";
                        const customRootId = latestGrid.dataset?.mjrCustomRootId || "";
                        const subfolder = latestGrid.dataset?.mjrSubfolder || "";
                        const kind = latestGrid.dataset?.mjrFilterKind || "";
                        const workflowOnly = latestGrid.dataset?.mjrFilterWorkflowOnly === "1";
                        const minRating = Number(latestGrid.dataset?.mjrFilterMinRating || 0) || 0;
                        const dateRange = String(latestGrid.dataset?.mjrFilterDateRange || "").trim().toLowerCase();
                        const dateExact = String(latestGrid.dataset?.mjrFilterDateExact || "").trim();

                        // Fetch the newest page and upsert into the grid (more reliable than filename search).
                        const url = buildListURL({
                            q: "*",
                            limit: 50,
                            offset: 0,
                            scope,
                            subfolder,
                            customRootId: customRootId || null,
                            kind: kind || null,
                            hasWorkflow: workflowOnly ? true : null,
                            minRating: minRating > 0 ? minRating : null,
                            dateRange: dateRange || null,
                            dateExact: dateExact || null,
                            includeTotal: false
                        });

                        const result = await get(url);
                        if (result?.ok && Array.isArray(result.data?.assets)) {
                            for (const asset of result.data.assets) {
                                try {
                                    upsertAsset(latestGrid, asset);
                                } catch {}
                            }
                        }

                        // Check if user is at bottom to decide whether to follow newest
                        if (atBottomBefore) {
                            // If user is at bottom, scroll to bottom after upserting all assets

                            // Wait for layout to stabilize before scrolling
                            await new Promise(r => requestAnimationFrame(() => r()));
                            await new Promise(r => requestAnimationFrame(() => r()));
                            scrollToBottom(latestGrid);
                        } else {
                            // If user is not at bottom, preserve scroll position
                            await restoreAnchor(latestGrid, anchor);
                        }
                    }
                }, 500);
            };

            // Bind to multiple event names across ComfyUI variants.
            const rtHandlers = {};
            const bind = (evt) => {
                try {
                    api.addEventListener(evt, api._mjrExecutedHandler);
                    rtHandlers[evt] = api._mjrExecutedHandler;
                } catch {}
            };
            for (const evt of ["executed", "execution_success", "execution_complete"]) bind(evt);
            api._mjrRtHandlers = rtHandlers;

            console.log("📂 Majoor [✅] Real-time listener registered");
        } else {
            console.warn("📂 Majoor [⚠️] API not available, real-time updates disabled");
        }

        if (app.extensionManager?.registerSidebarTab) {
            app.extensionManager.registerSidebarTab({
                id: "majoor-assets",
                icon: "pi pi-folder",
                title: "Assets Manager",
                tooltip: "Majoor Assets Manager - Browse and search your outputs",
                type: "custom",
                render: (el) => {
                    void renderAssetsManager(el, { useComfyThemeUI: UI_FLAGS.useComfyThemeUI });
                },
            });

            console.log("📂 Majoor Assets Manager: Sidebar tab registered");
        } else {
            console.warn("📂 Majoor Assets Manager: extensionManager.registerSidebarTab is unavailable");
        }
    },
});
