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

const ENTRY_RUNTIME_KEY = "__MJR_AM_ENTRY_RUNTIME__";
const UI_BOOT_DELAY_MS = 1500;
const RAF_STABILIZE_FRAMES = 2;
const AUTO_REFRESH_DEBOUNCE_MS = 500;
const AUTO_INSERT_FETCH_LIMIT = 50;

const _raf = () =>
    new Promise((resolve) => {
        try {
            requestAnimationFrame(() => resolve(true));
        } catch {
            resolve(false);
        }
    });

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
        // Best-effort hot-reload safety: abort previous listeners/timers for this extension instance.
        const runtime = (() => {
            try {
                const w = typeof window !== "undefined" ? window : null;
                const prev = w?.[ENTRY_RUNTIME_KEY] || null;
                try {
                    prev?.abort?.();
                } catch {}

                const ac = typeof AbortController !== "undefined" ? new AbortController() : null;
                const timers = new Set();
                const trackTimeout = (fn, ms) => {
                    try {
                        const id = setTimeout(fn, ms);
                        timers.add(id);
                        return id;
                    } catch {
                        return null;
                    }
                };
                const clearTimers = () => {
                    try {
                        for (const t of Array.from(timers)) {
                            try {
                                clearTimeout(t);
                            } catch {}
                        }
                    } catch {}
                    try {
                        timers.clear();
                    } catch {}
                };
                try {
                    ac?.signal?.addEventListener?.("abort", clearTimers, { once: true });
                } catch {}

                const delay = (ms) =>
                    new Promise((resolve) => {
                        try {
                            if (ac?.signal?.aborted) return resolve(false);
                        } catch {}
                        const id = trackTimeout(() => resolve(true), ms);
                        try {
                            ac?.signal?.addEventListener?.(
                                "abort",
                                () => {
                                    try {
                                        if (id != null) clearTimeout(id);
                                    } catch {}
                                    resolve(false);
                                },
                                { once: true }
                            );
                        } catch {}
                    });

                const rt = {
                    ac,
                    trackTimeout,
                    delay,
                    abort: () => {
                        try {
                            clearTimers();
                        } catch {}
                        try {
                            ac?.abort?.();
                        } catch {}
                    },
                };

                try {
                    if (w) w[ENTRY_RUNTIME_KEY] = rt;
                } catch {}
                return rt;
            } catch {
                return { ac: null, trackTimeout: setTimeout, delay: (ms) => new Promise((r) => setTimeout(() => r(true), ms)), abort: () => {} };
            }
        })();

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
                try {
                    if (runtime?.ac?.signal?.aborted) return;
                } catch {}
                // ComfyUI variants differ: sometimes the payload is on `detail.output`, sometimes `detail` is the output.
                const output = event?.detail?.output || event?.detail || null;
                const grid = getActiveGridContainer();
                if (!output || !grid) return;

                const hasMedia = output.images || output.gifs || output.videos;
                if (!hasMedia) return;

                console.log("📂 Majoor [ℹ️] New media generated, refreshing grid...");

                const outerTimer = runtime?.trackTimeout?.(async () => {
                    const ok = await runtime?.delay?.(UI_BOOT_DELAY_MS);
                    if (ok === false) return;

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
                            limit: AUTO_INSERT_FETCH_LIMIT,
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
                            for (let i = 0; i < RAF_STABILIZE_FRAMES; i++) {
                                await _raf();
                            }
                            scrollToBottom(latestGrid);
                        } else {
                            // If user is not at bottom, preserve scroll position
                            await restoreAnchor(latestGrid, anchor);
                        }
                    }
                }, AUTO_REFRESH_DEBOUNCE_MS);
                try {
                    if (outerTimer != null) {
                        runtime?.ac?.signal?.addEventListener?.(
                            "abort",
                            () => {
                                try {
                                    clearTimeout(outerTimer);
                                } catch {}
                            },
                            { once: true }
                        );
                    }
                } catch {}
            };

            // Bind to multiple event names across ComfyUI variants.
            const rtHandlers = {};
            const bind = (evt) => {
                try {
                    api.addEventListener(evt, api._mjrExecutedHandler, runtime?.ac ? { signal: runtime.ac.signal } : undefined);
                    rtHandlers[evt] = api._mjrExecutedHandler;
                } catch {}
            };
            for (const evt of ["executed", "execution_success", "execution_complete"]) bind(evt);
            api._mjrRtHandlers = rtHandlers;
            try {
                runtime?.ac?.signal?.addEventListener?.(
                    "abort",
                    () => {
                        try {
                            if (api._mjrRtHandlers && typeof api._mjrRtHandlers === "object") {
                                for (const [evt, handler] of Object.entries(api._mjrRtHandlers)) {
                                    try {
                                        api.removeEventListener(String(evt), handler);
                                    } catch {}
                                }
                            }
                        } catch {}
                        try {
                            api._mjrRtHandlers = {};
                        } catch {}
                        try {
                            api._mjrExecutedHandler = null;
                        } catch {}
                    },
                    { once: true }
                );
            } catch {}

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
