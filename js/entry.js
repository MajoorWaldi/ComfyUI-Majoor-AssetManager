/**
 * Entry Point - Majoor Assets Manager
 * Registers extension with ComfyUI and mounts UI.
 */

import { testAPI, triggerStartupScan } from "./app/bootstrap.js";
import { checkMajoorVersion } from "./app/versionCheck.js";
import { ensureStyleLoaded } from "./app/style.js";
import { registerMajoorSettings, startRuntimeStatusDashboard } from "./app/settings.js";
import { getComfyApi, registerSidebarTabCompat } from "./app/comfyApiBridge.js";
import { initDragDrop } from "./features/dnd/DragDrop.js";
import { loadAssets, upsertAsset, removeAssetsFromGrid } from "./features/grid/GridView.js";
import { renderAssetsManager, getActiveGridContainer } from "./features/panel/AssetsManagerPanel.js";
import { extractOutputFiles } from "./utils/extractOutputFiles.js";
import { post } from "./api/client.js";
import { ENDPOINTS } from "./api/endpoints.js";
import { comfyToast } from "./app/toast.js";
import { t } from "./app/i18n.js";
import { app } from "../../scripts/app.js";

const UI_FLAGS = {
    useComfyThemeUI: true,
};

// Runtime cleanup key (used for hot-reload cleanup in ComfyUI)
const ENTRY_RUNTIME_KEY = "__MJR_ENTRY_RUNTIME__";
const ENTRY_ABORT = typeof AbortController !== "undefined" ? new AbortController() : null;
try {
    if (typeof window !== "undefined") {
        // Replace previous runtime entry to allow cleanup on hot-reload
        try {
            const prev = window[ENTRY_RUNTIME_KEY];
            if (prev && prev.controller && typeof prev.controller.abort === "function") {
                try { prev.controller.abort(); } catch {}
            }
        } catch {}
        window[ENTRY_RUNTIME_KEY] = { controller: ENTRY_ABORT };
    }
} catch {}

// Deduplication for executed events (ComfyUI can fire multiple times for same file)
const DEDUPE_TTL_MS = 2000;
const recentFiles = new Map(); // key -> timestamp

// Track execution start times to compute generation duration
const EXECUTION_START_TTL_MS = 10 * 60 * 1000;
const executionStarts = new Map(); // prompt_id -> timestamp(ms)

function rememberExecutionStart(promptId, timestampMs) {
    if (!promptId) return;
    const ts = Number(timestampMs) || Date.now();
    executionStarts.set(String(promptId), ts);
    pruneExecutionStarts();
}

function pruneExecutionStarts() {
    const now = Date.now();
    for (const [key, ts] of executionStarts) {
        if (!ts || now - ts > EXECUTION_START_TTL_MS) {
            executionStarts.delete(key);
        }
    }
}

function dedupeFiles(files) {
    const now = Date.now();
    // Prune old entries
    for (const [key, ts] of recentFiles) {
        if (now - ts > DEDUPE_TTL_MS) recentFiles.delete(key);
    }
    // Filter out recently seen files
    const fresh = [];
    for (const f of files) {
        const key = `${f.type || ""}|${f.subfolder || ""}|${f.filename || ""}`.toLowerCase();
        if (!recentFiles.has(key)) {
            recentFiles.set(key, now);
            fresh.push(f);
        }
    }
    return fresh;
}

app.registerExtension({
    name: "Majoor.AssetsManager",

    async setup() {
        // Initialize core services
        testAPI();
        ensureStyleLoaded({ enabled: UI_FLAGS.useComfyThemeUI });
        startRuntimeStatusDashboard();

        try {
            initDragDrop();
        } catch {}

        setTimeout(() => {
            registerMajoorSettings(app, () => {
                const grid = getActiveGridContainer();
                if (grid) loadAssets(grid);
            });
        }, 500);

        triggerStartupScan();
        void checkMajoorVersion();

        // Get ComfyUI API
        const api = getComfyApi(app);
        if (api) {
            // Clean up previous handlers (hot-reload safety)
            try {
                if (api._mjrExecutedHandler) {
                    api.removeEventListener("executed", api._mjrExecutedHandler);
                }
                if (api._mjrAssetAddedHandler) {
                    api.removeEventListener("mjr-asset-added", api._mjrAssetAddedHandler);
                }
                if (api._mjrAssetUpdatedHandler) {
                    api.removeEventListener("mjr-asset-updated", api._mjrAssetUpdatedHandler);
                }
                if (api._mjrScanCompleteHandler) {
                    api.removeEventListener("mjr-scan-complete", api._mjrScanCompleteHandler);
                }
                if (api._mjrExecutionStartHandler) {
                    api.removeEventListener("execution_start", api._mjrExecutionStartHandler);
                }
                if (api._mjrExecutionEndHandler) {
                    api.removeEventListener("execution_success", api._mjrExecutionEndHandler);
                    api.removeEventListener("execution_error", api._mjrExecutionEndHandler);
                    api.removeEventListener("execution_interrupted", api._mjrExecutionEndHandler);
                }
                if (api._mjrEnrichmentStatusHandler) {
                    api.removeEventListener("mjr-enrichment-status", api._mjrEnrichmentStatusHandler);
                }
                if (api._mjrDbRestoreStatusHandler) {
                    api.removeEventListener("mjr-db-restore-status", api._mjrDbRestoreStatusHandler);
                }
            } catch {}

            try {
                if (window._mjrAssetsDeletedHandler) {
                    window.removeEventListener("mjr:assets-deleted", window._mjrAssetsDeletedHandler);
                }
            } catch {}

            // Listen for ComfyUI execution - extract output files and send to backend
            api._mjrExecutedHandler = (event) => {
                const outputFiles = dedupeFiles(extractOutputFiles(event?.detail?.output));
                if (!outputFiles.length) return;

                const promptId = event?.detail?.prompt_id || event?.detail?.promptId;
                const startTs = promptId ? executionStarts.get(String(promptId)) : null;
                const genTimeMs = startTs ? Math.max(0, Date.now() - startTs) : 0;

                const files = genTimeMs > 0
                    ? outputFiles.map((f) => ({ ...f, generation_time_ms: genTimeMs }))
                    : outputFiles;

                post(ENDPOINTS.INDEX_FILES, { files, origin: "generation" }).catch(() => {});
            };
            api.addEventListener("executed", api._mjrExecutedHandler);

            // Track execution start/end to compute duration
            api._mjrExecutionStartHandler = (event) => {
                const promptId = event?.detail?.prompt_id || event?.detail?.promptId;
                const ts = event?.detail?.timestamp;
                rememberExecutionStart(promptId, ts);
            };
            api._mjrExecutionEndHandler = (event) => {
                const promptId = event?.detail?.prompt_id || event?.detail?.promptId;
                if (promptId) {
                    executionStarts.delete(String(promptId));
                }
                pruneExecutionStarts();
            };
            api.addEventListener("execution_start", api._mjrExecutionStartHandler);
            api.addEventListener("execution_success", api._mjrExecutionEndHandler);
            api.addEventListener("execution_error", api._mjrExecutionEndHandler);
            api.addEventListener("execution_interrupted", api._mjrExecutionEndHandler);

            // Listen for backend push - upsert asset directly to grid
            api._mjrAssetAddedHandler = (event) => {
                const grid = getActiveGridContainer();
                if (grid && event?.detail) {
                    upsertAsset(grid, event.detail);
                }
            };
            api.addEventListener("mjr-asset-added", api._mjrAssetAddedHandler);

            api._mjrAssetUpdatedHandler = (event) => {
                const grid = getActiveGridContainer();
                if (grid && event?.detail) {
                    upsertAsset(grid, event.detail);
                }
            };
            api.addEventListener("mjr-asset-updated", api._mjrAssetUpdatedHandler);

            // Listen for scan-complete events to avoid "Unknown message type" warnings
            api._mjrScanCompleteHandler = (event) => {
                try {
                    const detail = event?.detail || {};
                    window.dispatchEvent(new CustomEvent("mjr-scan-complete", { detail }));
                } catch {}
            };
            api.addEventListener("mjr-scan-complete", api._mjrScanCompleteHandler);

            api._mjrEnrichmentStatusHandler = (event) => {
                try {
                    const detail = event?.detail || {};
                    const active = !!detail?.active;
                    const prev = !!globalThis?._mjrEnrichmentActive;
                    globalThis._mjrEnrichmentActive = active;
                    window.dispatchEvent(new CustomEvent("mjr-enrichment-status", { detail }));
                    // Do not force a full grid reset on enrichment state flips.
                    // Panel-level listeners handle refresh with scroll/selection anchor preservation.
                    if (prev && !active) {
                        comfyToast(t("toast.enrichmentComplete", "Metadata enrichment complete"), "success", 2600);
                    }
                } catch {}
            };
            api.addEventListener("mjr-enrichment-status", api._mjrEnrichmentStatusHandler);

            api._mjrDbRestoreStatusHandler = (event) => {
                try {
                    const detail = event?.detail || {};
                    const step = String(detail?.step || "");
                    const level = String(detail?.level || "info");
                    const op = String(detail?.operation || "");
                    window.dispatchEvent(new CustomEvent("mjr-db-restore-status", { detail }));
                    const isDelete = op === "delete_db";
                    const isReset = op === "reset_index";
                    if (isDelete && !["started", "done", "failed"].includes(step)) {
                        return;
                    }
                    const map = {
                        started: isDelete
                            ? t("toast.dbDeleteTriggered", "Deleting database and rebuilding...")
                            : isReset
                            ? t("toast.resetTriggered", "Reset triggered: Reindexing all files...")
                            : t("toast.dbRestoreStarted", "DB restore started"),
                        stopping_workers: t("toast.dbRestoreStopping", "Stopping running workers"),
                        resetting_db: t("toast.dbRestoreResetting", "Unlocking and resetting database"),
                        delete_db: t("toast.dbDeleteTriggered", "Deleting database and rebuilding..."),
                        recreate_db: t("toast.dbRestoreReplacing", "Recreating database"),
                        replacing_files: t("toast.dbRestoreReplacing", "Replacing database files"),
                        restarting_scan: t("toast.dbRestoreRescan", "Restarting scan"),
                        done: isDelete
                            ? t("toast.dbDeleteSuccess", "Database deleted and rebuilt. Files are being reindexed.")
                            : isReset
                            ? t("toast.resetStarted", "Index reset started. Files will be reindexed in the background.")
                            : t("toast.dbRestoreSuccess", "Database backup restored"),
                        failed: String(
                            detail?.message
                                || (isDelete
                                    ? t("toast.dbDeleteFailed", "Failed to delete database")
                                    : isReset
                                    ? t("toast.resetFailed", "Failed to reset index")
                                    : t("toast.dbRestoreFailed", "Failed to restore DB backup"))
                        ),
                    };
                    const msg = map[step] || String(detail?.message || "");
                    if (!msg) return;
                    const tone = level === "error" || step === "failed" ? "error" : step === "done" ? "success" : "info";
                    comfyToast(msg, tone, step === "done" || step === "failed" ? 2800 : 1800);
                } catch {}
            };
            api.addEventListener("mjr-db-restore-status", api._mjrDbRestoreStatusHandler);

            window._mjrAssetsDeletedHandler = (event) => {
                try {
                    const ids = Array.isArray(event?.detail?.ids)
                        ? event.detail.ids.map((x) => String(x || "")).filter(Boolean)
                        : [];
                    if (!ids.length) return;
                    const grid = getActiveGridContainer();
                    if (grid) removeAssetsFromGrid(grid, ids);
                } catch {}
            };
            window.addEventListener("mjr:assets-deleted", window._mjrAssetsDeletedHandler);

            console.log("📂 Majoor [✅] Real-time listener registered");
        } else {
            console.warn("📂 Majoor [⚠️] API not available, real-time updates disabled");
        }

        // Register sidebar tab
        if (registerSidebarTabCompat(app, {
                id: "majoor-assets",
                icon: "pi pi-folder",
                title: "Assets Manager",
                tooltip: "Majoor Assets Manager - Browse and search your outputs",
                type: "custom",
                render: (el) => {
                    void renderAssetsManager(el, { useComfyThemeUI: UI_FLAGS.useComfyThemeUI });
                },
            })) {

            console.log("📂 Majoor Assets Manager: Sidebar tab registered");
        } else {
            console.warn("📂 Majoor Assets Manager: extensionManager.registerSidebarTab is unavailable");
        }
    },
});
