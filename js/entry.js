/**
 * Entry Point - Majoor Assets Manager
 * Registers extension with ComfyUI and mounts UI.
 */

import { app } from "../../scripts/app.js";
import { testAPI, triggerStartupScan } from "./app/bootstrap.js";
import { ensureStyleLoaded } from "./app/style.js";
import { registerMajoorSettings } from "./app/settings.js";
import { initDragDrop } from "./features/dnd/DragDrop.js";
import { loadAssets, upsertAsset, captureAnchor, restoreAnchor, isAtBottom, scrollToBottom, flushUpsertBatch } from "./features/grid/GridView.js";
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

// Queue limits to prevent memory exhaustion and UI freeze
const PENDING_FILES_MAX = 200;           // Max files in queue before dropping oldest
const EXECUTION_STARTS_MAX = 50;         // Max tracked prompt IDs
const EXECUTION_STARTS_TTL_MS = 300000;  // 5 min TTL for orphan cleanup
const PROCESS_QUEUE_DEBOUNCE_MS = 100;   // Debounce queue processing
const PROCESS_QUEUE_BATCH_MAX = 20;      // Max files per batch to avoid long blocking

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

                const cleanupCbs = [];

                const rt = {
                    ac,
                    trackTimeout,
                    delay,
                    register: (fn) => { if (typeof fn === "function") cleanupCbs.push(fn); },
                    abort: () => {
                        try {
                            clearTimers();
                        } catch {}
                        try {
                            ac?.abort?.();
                        } catch {}
                        try {
                            cleanupCbs.forEach(fn => { try { fn(); } catch {} });
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
        
        try {
            const disposeDnD = initDragDrop();
            runtime.register(disposeDnD);
        } catch {}

        registerMajoorSettings(app, () => {
            const grid = getActiveGridContainer();
            if (grid) loadAssets(grid);
        });

        triggerStartupScan();

        const api = app.api || (app.ui ? app.ui.api : null);
        if (api) {
            // [ISSUE 1] Backend Scan Notification -> UI Event
            try {
                api.addEventListener("mjr-scan-complete", (e) => {
                    const detail = e.detail;
                    window.dispatchEvent(new CustomEvent('mjr:scan-complete', { detail }));
                });
            } catch (err) {
                console.warn("[Majoor] Failed to bind scan listener", err);
            }

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

            // Batch state for debouncing multiple checks
            api._mjrPendingFiles = api._mjrPendingFiles || [];
            api._mjrProcessingQueue = false; // Mutex for async processing
            api._mjrExecutionStarts = api._mjrExecutionStarts || new Map();
            api._mjrProcessQueueTimer = null; // Debounce timer
            api._mjrLastQueueProcess = 0;     // Last process timestamp

            // Cleanup old execution starts to prevent memory leak
            const cleanupExecutionStarts = () => {
                try {
                    if (!api._mjrExecutionStarts || api._mjrExecutionStarts.size === 0) return;
                    const now = Date.now();
                    const toDelete = [];
                    for (const [id, ts] of api._mjrExecutionStarts.entries()) {
                        if (now - ts > EXECUTION_STARTS_TTL_MS) {
                            toDelete.push(id);
                        }
                    }
                    for (const id of toDelete) {
                        api._mjrExecutionStarts.delete(id);
                    }
                    // Also limit size
                    while (api._mjrExecutionStarts.size > EXECUTION_STARTS_MAX) {
                        const oldest = api._mjrExecutionStarts.keys().next().value;
                        if (oldest) api._mjrExecutionStarts.delete(oldest);
                    }
                } catch {}
            };

            // Listen for execution start to effectively measure generation time
            const onExecutionStart = (event) => {
                const promptId = event?.detail?.prompt_id;
                if (promptId) {
                    api._mjrExecutionStarts.set(promptId, Date.now());
                    cleanupExecutionStarts();
                }
            };
            api.addEventListener("execution_start", onExecutionStart);

            // Async queue processor that mimics "Image Feed" reactivity but ensures DB consistency
            const processFileQueue = async () => {
                if (api._mjrProcessingQueue) return; // Already working
                if (api._mjrPendingFiles.length === 0) return;

                api._mjrProcessingQueue = true;
                api._mjrLastQueueProcess = Date.now();
                
                // Grab current batch (limited size to avoid blocking UI)
                const batchSize = Math.min(api._mjrPendingFiles.length, PROCESS_QUEUE_BATCH_MAX);
                const batch = api._mjrPendingFiles.splice(0, batchSize);

                try {
                    // 1. Index the files (backend)
                    // console.log(`📂 Majoor [ℹ️] Indexing batch of ${batch.length} files...`);
                    const indexRes = await post(ENDPOINTS.INDEX_FILES, { files: batch, incremental: true });
                    
                    if (!indexRes?.ok) {
                        console.warn("📂 Majoor [⚠️] index-files failed:", indexRes?.error || indexRes);
                    }

                    // 2. Fetch latest & visual update
                    // Only update if the user is looking at the default view (no search query)
                    const latestGrid = getActiveGridContainer();
                    const currentQuery = String(latestGrid?.dataset?.mjrQuery || "*").trim() || "*";
                    
                    if (latestGrid && (currentQuery === "*" || currentQuery === "")) {
                         // Use incremental update logic
                        const anchor = captureAnchor(latestGrid);
                        const atBottomBefore = isAtBottom(latestGrid);

                        // Read filter state from DOM
                        const scope = latestGrid.dataset?.mjrScope || "output";
                        const customRootId = latestGrid.dataset?.mjrCustomRootId || "";
                        const subfolder = latestGrid.dataset?.mjrSubfolder || "";
                        const kind = latestGrid.dataset?.mjrFilterKind || "";
                        const workflowOnly = latestGrid.dataset?.mjrFilterWorkflowOnly === "1";
                        const minRating = Number(latestGrid.dataset?.mjrFilterMinRating || 0) || 0;
                        const dateRange = String(latestGrid.dataset?.mjrFilterDateRange || "").trim().toLowerCase();
                        const dateExact = String(latestGrid.dataset?.mjrFilterDateExact || "").trim();

                        // Fetch the newest page (Limit increased to catch batch bursts)
                        // This "rescans from 0" (offset 0) to get the latest
                        const url = buildListURL({
                            q: "*",
                            limit: Math.max(AUTO_INSERT_FETCH_LIMIT, batch.length * 2), // Ensure we fetch enough to cover the batch
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
                            // Batch upserts to avoid multiple setItems calls
                            for (const asset of result.data.assets) {
                                try {
                                    upsertAsset(latestGrid, asset);
                                } catch {}
                            }
                            // Flush the batch before scroll operations
                            flushUpsertBatch(latestGrid);
                        }

                        // Auto-scroll logic
                        if (atBottomBefore) {
                             for (let i = 0; i < RAF_STABILIZE_FRAMES; i++) await _raf();
                            scrollToBottom(latestGrid);
                        } else {
                            await restoreAnchor(latestGrid, anchor);
                        }
                    }

                } catch (err) {
                    console.error("📂 Majoor [❌] Queue processing error:", err);
                } finally {
                    api._mjrProcessingQueue = false;
                    
                    // If new files arrived while we were working, schedule next batch with debounce
                    if (api._mjrPendingFiles.length > 0) {
                         // Yield to UI thread with debounce to prevent tight loops
                         if (api._mjrProcessQueueTimer) clearTimeout(api._mjrProcessQueueTimer);
                         api._mjrProcessQueueTimer = setTimeout(() => {
                             api._mjrProcessQueueTimer = null;
                             processFileQueue();
                         }, PROCESS_QUEUE_DEBOUNCE_MS);
                    }
                }
            };
            
            // Debounced queue trigger
            const scheduleProcessQueue = () => {
                if (api._mjrProcessQueueTimer) return; // Already scheduled
                if (api._mjrProcessingQueue) return;   // Already processing
                
                api._mjrProcessQueueTimer = setTimeout(() => {
                    api._mjrProcessQueueTimer = null;
                    processFileQueue();
                }, PROCESS_QUEUE_DEBOUNCE_MS);
            };

            api._mjrExecutedHandler = async (event) => {
                try {
                    if (runtime?.ac?.signal?.aborted) return;
                } catch {}
                
                const detail = event?.detail;
                const output = detail?.output || detail || null;
                const promptId = detail?.prompt_id;

                const grid = getActiveGridContainer();
                if (!output) return;
                
                const hasMedia = output.images || output.gifs || output.videos;
                if (!hasMedia) return;

                const newFiles = extractOutputFiles(output);
                if (!newFiles.length) return;
                
                // Calculate generation time if we saw the start
                let genTimeMs = undefined;
                if (promptId && api._mjrExecutionStarts.has(promptId)) {
                    const start = api._mjrExecutionStarts.get(promptId);
                    genTimeMs = Date.now() - start;
                    api._mjrExecutionStarts.delete(promptId); // Cleanup
                }

                if (genTimeMs) {
                    // Attach duration to each file object so backend can index it
                    for (const f of newFiles) {
                        f.generation_time_ms = genTimeMs;
                    }
                }

                // Add to batch with size limit
                api._mjrPendingFiles.push(...newFiles);
                
                // Enforce queue size limit (drop oldest if overflow)
                while (api._mjrPendingFiles.length > PENDING_FILES_MAX) {
                    api._mjrPendingFiles.shift();
                }

                // Trigger processing with debounce
                scheduleProcessQueue();
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
