/**
 * Status Dot Feature - Health indicator
 */

import { get, getToolsStatus, post, resetIndex, getWatcherStatus, forceDeleteDb } from "../../api/client.js";
import { ENDPOINTS } from "../../api/endpoints.js";
import { APP_CONFIG } from "../../app/config.js";
import { comfyToast } from "../../app/toast.js";
import { t } from "../../app/i18n.js";

const TOOL_CAPABILITIES = [
    {
        key: "exiftool",
        labelKey: "tool.exiftool",
        hintKey: "tool.exiftool.hint"
    },
    {
        key: "ffprobe",
        labelKey: "tool.ffprobe",
        hintKey: "tool.ffprobe.hint"
    }
];

function formatBytes(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = n;
    let idx = 0;
    while (value >= 1024 && idx < units.length - 1) {
        value /= 1024;
        idx += 1;
    }
    const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2;
    return `${value.toFixed(precision)} ${units[idx]}`;
}

function setStatusLines(statusText, lines, footerText = null) {
    if (!statusText) return;
    statusText.replaceChildren();

    const normalizedLines = Array.isArray(lines) ? lines.filter((l) => l != null && String(l).trim() !== "") : [];
    normalizedLines.forEach((line, index) => {
        if (index > 0) statusText.appendChild(document.createElement("br"));
        statusText.appendChild(document.createTextNode(String(line)));
    });

    if (footerText != null && String(footerText).trim() !== "") {
        statusText.appendChild(document.createElement("br"));
        const span = document.createElement("span");
        span.style.fontSize = "11px";
        span.style.opacity = "0.6";
        span.textContent = String(footerText);
        statusText.appendChild(span);
    }
}

function setStatusWithHint(statusText, mainText, hintText) {
    if (!statusText) return;
    statusText.replaceChildren();
    statusText.appendChild(document.createTextNode(String(mainText || "")));
    statusText.appendChild(document.createElement("br"));
    const span = document.createElement("span");
    span.style.fontSize = "11px";
    span.style.opacity = "0.7";
    span.textContent = String(hintText || "");
    statusText.appendChild(span);
}

function formatWatcherScopeLabel(scope) {
    const s = String(scope || "").toLowerCase();
    if (s === "all") return t("scope.allFull", "All (Inputs + Outputs)");
    if (s === "input" || s === "inputs") return t("scope.input", "Inputs");
    if (s === "custom") return t("scope.custom", "Custom");
    return t("scope.output", "Outputs");
}

function formatWatcherLine(watcher, desiredScope = "") {
    if (!watcher || typeof watcher !== "object") {
        if (desiredScope) {
            return t("status.watcher.disabledScoped", "Watcher: disabled ({scope})", { scope: formatWatcherScopeLabel(desiredScope) });
        }
        return t("status.watcher.disabled", "Watcher: disabled");
    }
    const enabled = !!watcher.enabled;
    const scope = watcher.scope ? String(watcher.scope) : "";
    if (!enabled) {
        if (scope || desiredScope) {
            const effective = desiredScope && scope && scope !== desiredScope ? desiredScope : (scope || desiredScope);
            return t("status.watcher.disabledScoped", "Watcher: disabled ({scope})", { scope: formatWatcherScopeLabel(effective) });
        }
        return t("status.watcher.disabled", "Watcher: disabled");
    }
    if (scope) {
        return t("status.watcher.enabledScoped", `Watcher: enabled (${scope})`, { scope: formatWatcherScopeLabel(scope) });
    }
    return t("status.watcher.enabled", "Watcher: enabled");
}

/**
 * Create status indicator section
 */
export function createStatusIndicator(options = {}) {
    const getScanContext =
        typeof options?.getScanContext === "function" ? options.getScanContext : null;
    const section = document.createElement("div");
    section.style.cssText = "margin-bottom: 20px; padding: 12px; background: var(--bg-color, #1a1a1a); border-radius: 6px; border: 1px solid var(--border-color, #333); cursor: pointer; transition: all 0.2s;";

    // Header container
    const header = document.createElement("div");
    header.style.cssText = "display: flex; align-items: center; gap: 10px; margin-bottom: 8px;";

    // Status dot
    const statusDot = document.createElement("span");
    statusDot.id = "mjr-status-dot";
    statusDot.style.cssText = "width: 12px; height: 12px; border-radius: 50%; background: #FFA726; display: inline-block; cursor: pointer;";

    // Title container
    const titleSpan = document.createElement("span");
    titleSpan.id = "mjr-status-title";
    titleSpan.style.cssText = "font-weight: 500; font-size: 13px; cursor: pointer;";

    const indicator = document.createElement("span");
    indicator.id = "mjr-status-title-indicator";
    indicator.style.marginRight = "6px";
    indicator.textContent = "▾";

    titleSpan.appendChild(indicator);
    titleSpan.appendChild(document.createTextNode(t("status.indexStatus", "Index Status")));

    header.appendChild(statusDot);
    header.appendChild(titleSpan);

    // Body container
    const body = document.createElement("div");
    body.id = "mjr-status-body";
    body.style.marginLeft = "22px";

    // Status text
    const statusText = document.createElement("div");
    statusText.id = "mjr-status-text";
    statusText.style.cssText = "font-size: 12px; opacity: 0.8;";
    statusText.textContent = t("status.checking");

    // Capabilities section
    const capabilities = document.createElement("div");
    capabilities.id = "mjr-status-capabilities";
    capabilities.style.cssText = "font-size: 11px; opacity: 0.75; margin-top: 10px; display: flex; gap: 6px; flex-wrap: wrap;";
    capabilities.textContent = t("status.discoveringTools");

    body.appendChild(statusText);
    body.appendChild(capabilities);

    const toolsStatus = document.createElement("div");
    toolsStatus.id = "mjr-tools-status";
    toolsStatus.style.cssText = "font-size: 11px; opacity: 0.7; margin-top: 10px;";
    toolsStatus.textContent = t("status.toolStatusChecking", "Tool status: checking...");
    body.appendChild(toolsStatus);

    const actionsRow = document.createElement("div");
    actionsRow.style.cssText = "margin-top: 10px; display: flex; justify-content: flex-end; gap: 8px;";

    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.textContent = t("btn.resetIndex");
    resetBtn.title = t("status.resetIndexHint", "Reset index cache (requires allowResetIndex in settings).");
    resetBtn.style.cssText = `
        padding: 5px 12px;
        font-size: 11px;
        border-radius: 6px;
        border: 1px solid rgba(255,255,255,0.25);
        background: transparent;
        color: inherit;
        cursor: pointer;
        transition: border 0.2s, background 0.2s;
    `;
    resetBtn.onmouseenter = () => {
        resetBtn.style.borderColor = "rgba(255,255,255,0.6)";
        resetBtn.style.background = "rgba(255,255,255,0.08)";
    };
    resetBtn.onmouseleave = () => {
        resetBtn.style.borderColor = "rgba(255,255,255,0.25)";
        resetBtn.style.background = "transparent";
    };
    resetBtn.onclick = async (event) => {
        event.stopPropagation();

        comfyToast(t("toast.resetTriggered"), "warning", 3000);

        const originalText = resetBtn.textContent;
        resetBtn.disabled = true;
        resetBtn.textContent = t("btn.resetting");
        
        // Status indicator feedback
        statusDot.style.background = "var(--mjr-status-warning, #FFA726)"; // Orange (working)

        try {
            const ctx = getScanContext ? getScanContext() : {};
            const scope = String(ctx?.scope || "output").toLowerCase();
            const customRootId = ctx?.customRootId || ctx?.custom_root_id || ctx?.root_id || null;
            const isAll = scope === "all";

            const res = await resetIndex({
                scope,
                customRootId,
                reindex: true,
                hard_reset_db: isAll,
                clear_scan_journal: true,
                clear_metadata_cache: true,
                clear_asset_metadata: true,
                clear_assets: true,
                rebuild_fts: true,
            });
            if (res?.ok) {
                statusDot.style.background = "var(--mjr-status-success, #4CAF50)";
                comfyToast(t("toast.resetStarted"), "success");
            } else {
                statusDot.style.background = "var(--mjr-status-error, #f44336)";
                const err = String(res?.error || "").toLowerCase();
                const isCorrupt = err.includes("malform") || err.includes("corrupt") || err.includes("disk image") || res?.code === "SERVICE_UNAVAILABLE" || res?.code === "QUERY_FAILED";
                if (isCorrupt) {
                    comfyToast(t("toast.resetFailedCorrupt"), "error", 8000);
                } else {
                    comfyToast(res?.error || t("toast.resetFailed"), "error");
                }
            }
        } catch (error) {
            statusDot.style.background = "var(--mjr-status-error, #f44336)";
            const msg = String(error?.message || "").toLowerCase();
            const isCorrupt = msg.includes("malform") || msg.includes("corrupt") || msg.includes("disk image");
            if (isCorrupt) {
                comfyToast(t("toast.resetFailedCorrupt"), "error", 8000);
            } else {
                comfyToast(error?.message || t("toast.resetFailed"), "error");
            }
        } finally {
            resetBtn.disabled = false;
            resetBtn.textContent = originalText;
        }
    };

    actionsRow.appendChild(resetBtn);

    const deleteDbBtn = document.createElement("button");
    deleteDbBtn.type = "button";
    deleteDbBtn.textContent = t("btn.deleteDb");
    deleteDbBtn.title = "Force-delete the database, unlock files, and rebuild from scratch.";
    deleteDbBtn.style.cssText = `
        padding: 5px 12px;
        font-size: 11px;
        border-radius: 6px;
        border: 1px solid rgba(255,80,80,0.4);
        background: transparent;
        color: inherit;
        cursor: pointer;
        transition: border 0.2s, background 0.2s;
    `;
    deleteDbBtn.onmouseenter = () => {
        deleteDbBtn.style.borderColor = "rgba(255,80,80,0.8)";
        deleteDbBtn.style.background = "rgba(255,80,80,0.12)";
    };
    deleteDbBtn.onmouseleave = () => {
        deleteDbBtn.style.borderColor = "rgba(255,80,80,0.4)";
        deleteDbBtn.style.background = "transparent";
    };
    deleteDbBtn.onclick = async (event) => {
        event.stopPropagation();

        const confirmed = confirm(t("dialog.dbDelete.confirm"));
        if (!confirmed) return;

        comfyToast(t("toast.dbDeleteTriggered"), "warning", 3000);

        const originalText = deleteDbBtn.textContent;
        deleteDbBtn.disabled = true;
        deleteDbBtn.textContent = t("btn.deletingDb");
        resetBtn.disabled = true;

        statusDot.style.background = "var(--mjr-status-warning, #FFA726)";

        try {
            const res = await forceDeleteDb();
            if (res?.ok) {
                globalThis._mjrCorruptToastShown = false;
                statusDot.style.background = "var(--mjr-status-success, #4CAF50)";
                comfyToast(t("toast.dbDeleteSuccess"), "success");
            } else {
                statusDot.style.background = "var(--mjr-status-error, #f44336)";
                comfyToast(res?.error || t("toast.dbDeleteFailed"), "error");
            }
        } catch (error) {
            statusDot.style.background = "var(--mjr-status-error, #f44336)";
            comfyToast(error?.message || t("toast.dbDeleteFailed"), "error");
        } finally {
            deleteDbBtn.disabled = false;
            deleteDbBtn.textContent = originalText;
            resetBtn.disabled = false;
        }
    };

    actionsRow.appendChild(deleteDbBtn);
    body.appendChild(actionsRow);

    section.appendChild(header);
    section.appendChild(body);



    const title = section.querySelector("#mjr-status-title");
    if (title) {
        title.addEventListener("click", (event) => {
            event.stopPropagation();
            const body = section.querySelector("#mjr-status-body");
            if (!body) return;
            const collapsed = body.style.display === "none";
            setBodyCollapsed(section, !collapsed);
        });
    }

    setBodyCollapsed(section, true);
    // Add hover effect
    section.onmouseenter = () => {
        section.style.borderColor = "var(--mjr-accent-border, var(--border-color, #333))";
        section.style.background = "var(--mjr-accent-bg, var(--bg-color, #1a1a1a))";
    };
    section.onmouseleave = () => {
        section.style.borderColor = "var(--border-color, #333)";
        section.style.background = "var(--bg-color, #1a1a1a)";
    };

    return section;
}

/**
 * Trigger a scan
 */
export async function triggerScan(statusDot, statusText, capabilitiesSection = null, scanTarget = null) {
    const desiredScope = String(scanTarget?.scope || "output").toLowerCase();
    const desiredCustomRootId = scanTarget?.customRootId || scanTarget?.custom_root_id || scanTarget?.root_id || null;

    // Prevent overlapping scans (manual or polling-triggered).
    try {
        const now = Date.now();
        const inflight = globalThis?._mjrScanInFlight;
        if (inflight && typeof inflight === "object") {
            const ageMs = now - Number(inflight.at || 0);
            if (ageMs >= 0 && ageMs < 10 * 60_000) {
                setStatusWithHint(
                    statusText,
                    t("status.scanInProgress", "Scan already running..."),
                    t("status.scanInProgressHint", "Please wait for the current scan to finish")
                );
                return;
            }
        }
        globalThis._mjrScanInFlight = { at: now, scope: desiredScope, root_id: desiredCustomRootId || null };
    } catch {}

    const clearScanInFlight = () => {
        try {
            if (globalThis?._mjrScanInFlight) {
                globalThis._mjrScanInFlight = null;
            }
        } catch {}
    };

    // Incremental is always favored.
    // Shift+Click logic is handled by caller (if applicable), but here we default to true.
    const shouldIncremental = true;

    // Fetch roots so we can show meaningful paths
    let roots = null;
    try {
        const rootsResult = await get(ENDPOINTS.ROOTS);
        if (rootsResult.ok) roots = rootsResult.data;
    } catch {}

    // Fallback to config for output directory if roots endpoint is unavailable
    if (!roots) {
        const configResult = await get(ENDPOINTS.CONFIG);
        if (!configResult.ok) {
            statusText.textContent = t("status.errorGetConfig");
            clearScanInFlight();
            return;
        }
        roots = { output_directory: configResult.data.output_directory };
    }

    const scopeLabel =
        desiredScope === "all"
            ? t("scope.all", "Inputs + Outputs")
            : desiredScope === "input"
            ? t("scope.input", "Inputs")
            : desiredScope === "custom"
            ? t("scope.custom", "Custom")
            : t("scope.output", "Outputs");

    let detail = "";
    if (desiredScope === "input") detail = roots?.input_directory ? ` (${roots.input_directory})` : "";
    else if (desiredScope === "custom") {
        const list = Array.isArray(roots?.custom_roots) ? roots.custom_roots : [];
        const picked = desiredCustomRootId ? list.find((r) => r?.id === desiredCustomRootId) : null;
        detail = picked?.path ? ` (${picked.path})` : "";
    } else if (desiredScope === "output") detail = roots?.output_directory ? ` (${roots.output_directory})` : "";

    // Show scanning status
    statusDot.style.background = "var(--mjr-status-warning, #FFA726)"; // Orange
    setStatusWithHint(statusText, t("status.scanningScope", `Scanning ${scopeLabel}${detail}...`, { scope: scopeLabel, detail }), t("status.scanningHint", "This may take a while"));

    const payload = {
        scope: desiredScope,
        recursive: true,
        incremental: shouldIncremental,
        fast: true,
        background_metadata: true
    };
    if (desiredScope === "custom") {
        if (!desiredCustomRootId) {
            statusDot.style.background = "var(--mjr-status-error, #f44336)";
            statusText.textContent = t("status.selectCustomFolder");
            clearScanInFlight();
            return;
        }
        payload.custom_root_id = desiredCustomRootId;
    }

    let scanResult = null;
    try {
        // Trigger scan
        scanResult = await post(ENDPOINTS.SCAN, payload);
    } finally {
        clearScanInFlight();
    }

    if (scanResult?.ok) {
        const stats = scanResult.data;
        statusDot.style.background = "var(--mjr-status-success, #4CAF50)"; // Green
        setStatusWithHint(
            statusText,
            t("toast.scanComplete"),
            t("status.scanStats", `Added: ${stats.added || 0}  -  Updated: ${stats.updated || 0}  -  Skipped: ${stats.skipped || 0}`, { added: stats.added || 0, updated: stats.updated || 0, skipped: stats.skipped || 0 })
        );

        // Refresh status after 2 seconds
        setTimeout(() => {
            updateStatus(statusDot, statusText, capabilitiesSection);
        }, 2000);
    } else {
        statusDot.style.background = "var(--mjr-status-error, #f44336)"; // Red
        setStatusLines(statusText, [t("toast.scanFailed") + `: ${scanResult?.error || "Unknown error"}`]);

        // Restore status after 3 seconds
        setTimeout(() => {
            updateStatus(statusDot, statusText, capabilitiesSection);
        }, 3000);
    }
}

function createCapabilityBadge(label, available, hint) {
    const badge = document.createElement("span");
    badge.style.cssText = `
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 6px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
    `;
    badge.textContent = `${available ? "✅" : "❌"} ${label}`;
    badge.title = available ? t("status.toolAvailable", `${label} available`, { tool: label }) : hint || t("status.toolUnavailable", `${label} unavailable`, { tool: label });
    badge.style.opacity = available ? "1" : "0.75";
    return badge;
}

function renderCapabilities(section, toolAvailability = {}, toolPaths = {}) {
    if (!section) return;
    section.replaceChildren();
    if (!toolAvailability || Object.keys(toolAvailability).length === 0) {
        section.textContent = t("status.discoveringTools");
        return;
    }

    const wrapper = document.createElement("div");
    wrapper.style.display = "flex";
    wrapper.style.flexWrap = "wrap";
    wrapper.style.gap = "10px";
    wrapper.style.alignItems = "flex-start";

    TOOL_CAPABILITIES.forEach(({ key, labelKey, hintKey }) => {
        const available = Boolean(toolAvailability[key]);
        const path = toolPaths[key];
        const label = t(labelKey, key);
        const hint = t(hintKey, "");
        wrapper.appendChild(createCapabilityNode({ label, hint }, available, path));
    });

    section.appendChild(wrapper);
}

function renderToolsStatusLine(section, toolStatus = null, fallbackAvailability = {}) {
    if (!section) return;
    const parent = section.parentElement;
    if (!parent) return;
    const container = parent.querySelector("#mjr-tools-status");
    if (!container) return;

    const hasFallback = fallbackAvailability && Object.keys(fallbackAvailability).length > 0;
    if (!toolStatus && !hasFallback) {
        container.textContent = t("status.toolStatusChecking", "Tool status: checking...");
        return;
    }

    const segments = TOOL_CAPABILITIES.map(({ key, labelKey }) => {
        const label = t(labelKey, key);
        const availability =
            toolStatus && key in toolStatus ? toolStatus[key] : undefined;
        const fallback = key in fallbackAvailability ? fallbackAvailability[key] : undefined;
        const available = availability !== undefined ? availability : fallback;
        const statusText =
            available === null || available === undefined ? t("status.unknown", "unknown") : available ? t("status.available", "available") : t("status.missing", "missing");
        const version = toolStatus?.versions?.[key];
        return version ? `${label}: ${statusText} - ${version}` : `${label}: ${statusText}`;
    });
    container.textContent = segments.join("  |  ");
}

function createCapabilityNode({ label, hint }, available, path) {
    const container = document.createElement("div");
    container.style.cssText = `
        display: flex;
        flex-direction: column;
        gap: 3px;
        padding: 6px 8px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.08);
        min-width: 170px;
    `;

    const badge = createCapabilityBadge(label, available, hint);
    badge.style.fontWeight = "500";
    container.appendChild(badge);

    const pathLine = document.createElement("span");
    pathLine.style.fontSize = "10px";
    pathLine.style.opacity = "0.7";
    pathLine.style.wordBreak = "break-all";
    pathLine.textContent = t("status.path", "Path") + `: ${path ? path : t("status.pathAuto", "auto / not configured")}`;
    container.appendChild(pathLine);

    return container;
}

function setBodyCollapsed(section, collapsed) {
    const body = section.querySelector("#mjr-status-body");
    const indicator = section.querySelector("#mjr-status-title-indicator");
    if (!body || !indicator) return;
    if (collapsed) {
        body.style.display = "none";
        indicator.textContent = "▸";
    } else {
        body.style.display = "";
        indicator.textContent = "▾";
    }
}
export async function updateStatus(statusDot, statusText, capabilitiesSection = null, scanTarget = null, meta = null) {
    // Optional: caller-provided object to read the last HTTP error details from.
    // (Used by the polling loop to avoid relying on string matching.)
    if (meta && typeof meta === "object") {
        meta.lastCode = null;
        meta.lastStatus = null;
    }

    const desiredScope = String(scanTarget?.scope || "output").toLowerCase();
    const desiredCustomRootId = scanTarget?.customRootId || scanTarget?.custom_root_id || scanTarget?.root_id || null;
    const url =
        desiredScope === "custom"
            ? `${ENDPOINTS.HEALTH_COUNTERS}?scope=custom&custom_root_id=${encodeURIComponent(String(desiredCustomRootId || ""))}`
            : `${ENDPOINTS.HEALTH_COUNTERS}?scope=${encodeURIComponent(desiredScope || "output")}`;
    const result = await get(url);
    let toolStatusData = null;
    try {
        const toolsResult = await getToolsStatus();
        if (toolsResult?.ok) {
            toolStatusData = toolsResult.data;
        }
    } catch {}

    if (meta && typeof meta === "object") {
        meta.lastCode = result?.code || null;
        meta.lastStatus = typeof result?.status === "number" ? result.status : null;
    }

    if (result.ok) {
        const counters = result.data;
        const totalAssets = counters.total_assets || 0;
        const withWorkflows = counters.with_workflows ?? 0;
        const withGenerationData = counters.with_generation_data ?? 0;
        const lastScanRaw = counters.last_scan_end;
        const lastScanText = lastScanRaw ? new Date(lastScanRaw).toLocaleString() : "N/A";
        const toolAvailability = counters.tool_availability || {};
        const toolPaths = counters.tool_paths || {};
        const dbSizeLine = t("status.dbSize", "Database size: {size}", {
            size: formatBytes(counters.db_size_bytes || 0),
        });
        let watcherInfo = counters.watcher;
        try {
            if (!watcherInfo || typeof watcherInfo.enabled !== "boolean") {
                const wres = await getWatcherStatus();
                if (wres?.ok && wres.data) {
                    watcherInfo = {
                        enabled: !!wres.data.enabled,
                        scope: (counters?.watcher?.scope || desiredScope),
                        custom_root_id: desiredCustomRootId || null,
                    };
                }
            }
        } catch {}
        const watcherLine = formatWatcherLine(watcherInfo, desiredScope);

        renderCapabilities(capabilitiesSection, toolAvailability, toolPaths);
        renderToolsStatusLine(capabilitiesSection, toolStatusData, toolAvailability);

        const scopeLabel =
            desiredScope === "all"
                ? t("scope.allFull", "All (Inputs + Outputs)")
                : desiredScope === "input"
                ? t("scope.input", "Inputs")
                : desiredScope === "custom"
                ? t("scope.custom", "Custom")
                : t("scope.output", "Outputs");

        if (totalAssets === 0) {
            // No assets indexed - yellow
            statusDot.style.background = "var(--mjr-status-warning, #FFA726)";
            setStatusWithHint(
                statusText,
                t("status.noAssets", `No assets indexed yet (${scopeLabel})`, { scope: scopeLabel }),
                [t("status.clickToScan", "Click the dot to start a scan"), dbSizeLine, watcherLine].filter(Boolean).join("  |  ")
            );
        } else {
            // Assets indexed - green
            statusDot.style.background = "var(--mjr-status-success, #4CAF50)";
            setStatusLines(
                statusText,
                [
                    t("status.assetsIndexed", `${totalAssets.toLocaleString()} assets indexed (${scopeLabel})`, { count: totalAssets.toLocaleString(), scope: scopeLabel }),
                    t("status.imagesVideos", `Images: ${counters.images || 0}  -  Videos: ${counters.videos || 0}`, { images: counters.images || 0, videos: counters.videos || 0 }),
                    t("status.withWorkflows", `With workflows: ${withWorkflows}  -  Generation data: ${withGenerationData}`, { workflows: withWorkflows, gendata: withGenerationData }),
                    dbSizeLine,
                    watcherLine,
                ],
                t("status.lastScan", `Last scan: ${lastScanText}`, { date: lastScanText })
            );
        }
        return counters;
    } else {
        // Error - red
        renderCapabilities(capabilitiesSection, {}, {});
        renderToolsStatusLine(capabilitiesSection, toolStatusData);
        statusDot.style.background = "var(--mjr-status-error, #f44336)";
        if (result?.code === "INVALID_RESPONSE" && result?.status === 404) {
            setStatusWithHint(
                statusText,
                t("status.apiNotFound", "Majoor API endpoints not found (404)"),
                t("status.apiNotFoundHint", "Backend routes are not loaded. Restart ComfyUI and check the terminal for Majoor import errors.")
            );
        } else {
            const errMsg = String(result?.error || "").toLowerCase();
            const isCorrupt = errMsg.includes("malform") || errMsg.includes("corrupt") || errMsg.includes("disk image");
            if (isCorrupt) {
                setStatusWithHint(
                    statusText,
                    t("status.dbCorrupted"),
                    t("status.dbCorruptedHint")
                );
                if (!globalThis._mjrCorruptToastShown) {
                    globalThis._mjrCorruptToastShown = true;
                    comfyToast(t("toast.resetFailedCorrupt"), "error", 8000);
                }
            } else {
                setStatusLines(statusText, [result.error || t("status.errorChecking", "Error checking status")]);
            }
        }
        if (result.code === "SERVICE_UNAVAILABLE") {
            const retryBtn = createRetryButton(statusDot, statusText, capabilitiesSection, scanTarget);
            statusText.appendChild(document.createElement("br"));
            statusText.appendChild(retryBtn);
        }
    }
    return null;
}

function createRetryButton(statusDot, statusText, capabilitiesSection = null, scanTarget = null) {
    const button = document.createElement("button");
    button.textContent = t("btn.retryServices");
    button.style.cssText = `
        padding: 4px 10px;
        margin-top: 6px;
        font-size: 11px;
        border-radius: 4px;
        border: 1px solid rgba(255,255,255,0.3);
        background: transparent;
        color: white;
        cursor: pointer;
    `;

    button.onclick = async () => {
        button.disabled = true;
        button.textContent = t("btn.retrying");
        const retryResult = await post(ENDPOINTS.RETRY_SERVICES, {});
        button.disabled = false;
        button.textContent = t("btn.retryServices");
        if (retryResult.ok) {
            updateStatus(statusDot, statusText, capabilitiesSection, scanTarget);
        } else {
            setStatusLines(statusText, [retryResult.error || t("status.retryFailed", "Retry failed")]);
            statusText.appendChild(document.createElement("br"));
            statusText.appendChild(button);
        }
    };

    return button;
}

/**
 * Setup status polling
 */
export function setupStatusPolling(
    statusDot,
    statusText,
    section,
    capabilitiesSection = null,
    onCountersUpdate = null,
    getScanTarget = null
) {
    const GLOBAL_POLL_KEY = "__MJR_STATUS_POLL_DISPOSE__";
    const pollMeta = { lastCode: null, lastStatus: null };

    const handleUpdate = async () => {
        const target = typeof getScanTarget === "function" ? getScanTarget() : null;
        const counters = await updateStatus(statusDot, statusText, capabilitiesSection, target, pollMeta);
        if (counters && typeof onCountersUpdate === "function") {
            onCountersUpdate(counters);
        }
        return counters;
    };

    // Initial update
    handleUpdate();

    try {
        section._mjrStatusPollDispose?.();
    } catch {}

    // Ensure only one polling loop exists globally (panel rerenders can otherwise duplicate timers).
    try {
        const oldGlobalDispose = window?.[GLOBAL_POLL_KEY];
        if (typeof oldGlobalDispose === "function") oldGlobalDispose();
    } catch {}

    // Poll using a dynamic interval so settings changes apply without reload.
    let pollTimerId = null;
    let consecutiveFailures = 0;
    let lastWasMissingEndpoint = false;

    const scheduleNext = () => {
        const baseMs = Math.max(250, Number(APP_CONFIG.STATUS_POLL_INTERVAL) || 2000);
        const waitMs = lastWasMissingEndpoint
            ? Math.max(30_000, baseMs)
            : consecutiveFailures > 0
            ? Math.min(60_000, Math.round(baseMs * Math.min(8, 1 + consecutiveFailures)))
            : baseMs;

        pollTimerId = setTimeout(async () => {
            const counters = await handleUpdate();

            // If the backend routes aren't loaded, ComfyUI returns an HTML 404 page (non-JSON).
            // Back off to avoid spamming the console/network.
            lastWasMissingEndpoint = pollMeta.lastCode === "INVALID_RESPONSE" && pollMeta.lastStatus === 404;
            if (counters) {
                consecutiveFailures = 0;
            } else if (lastWasMissingEndpoint) {
                consecutiveFailures = Math.min(999, consecutiveFailures + 1);
            } else {
                consecutiveFailures = Math.min(999, consecutiveFailures + 1);
            }

            // After a few consecutive 404s, stop polling entirely until reload.
            if (lastWasMissingEndpoint && consecutiveFailures >= 3) {
                try {
                    section._mjrStatusPollDispose?.();
                } catch {}
                return;
            }
            scheduleNext();
        }, waitMs);
    };
    section._mjrStatusPollDispose = () => {
        if (pollTimerId) clearTimeout(pollTimerId);
        pollTimerId = null;
    };
    try {
        window[GLOBAL_POLL_KEY] = section._mjrStatusPollDispose;
    } catch {}
    scheduleNext();

    const statusDotEl = section.querySelector("#mjr-status-dot");
    if (statusDotEl) {
        statusDotEl.onclick = (event) => {
            event.stopPropagation();
            const target = typeof getScanTarget === "function" ? getScanTarget() : null;
            triggerScan(statusDot, statusText, capabilitiesSection, target);
        };
        statusDotEl.title = t("status.clickToScan", "Click to scan");
    }
}
