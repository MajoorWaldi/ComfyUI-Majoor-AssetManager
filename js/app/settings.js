/**
 * Majoor settings integration with ComfyUI settings panel.
 */

import { APP_CONFIG, APP_DEFAULTS } from "./config.js";
import { invalidateObsCache, setProbeBackendMode } from "../api/client.js";
import { safeDispatchCustomEvent } from "../utils/events.js";

import { SETTINGS_KEY } from "./settingsStore.js";
const SETTINGS_PREFIX = "Majoor";

const DEFAULT_SETTINGS = {
    grid: {
        pageSize: APP_DEFAULTS.DEFAULT_PAGE_SIZE
    },
    siblings: {
        hidePngSiblings: true
    },
    autoScan: {
        enabled: APP_DEFAULTS.AUTO_SCAN_ENABLED,
        onStartup: APP_DEFAULTS.AUTO_SCAN_ON_STARTUP
    },
    status: {
        pollInterval: APP_DEFAULTS.STATUS_POLL_INTERVAL
    },
    observability: {
        enabled: false
    },
    sidebar: {
        position: "right"  // "left" or "right"
    },
    probeBackend: {
        mode: "auto"
    },
    ratingTagsSync: {
        enabled: false
    },
    cache: {
        // TTL for `getAvailableTags()` caching in `js/api/client.js`
        tagsTTLms: 30_000
    },
    workflowMinimap: {
        nodeColors: true,
        showLinks: true,
        showGroups: true,
        renderBypassState: true,
        renderErrorState: true,
        showViewport: true,
    }
};

const deepMerge = (base, next) => {
    const output = { ...base };
    if (!next || typeof next !== "object") {
        return output;
    }
    Object.keys(next).forEach((key) => {
        const value = next[key];
        if (value && typeof value === "object" && !Array.isArray(value)) {
            output[key] = deepMerge(base[key] || {}, value);
        } else if (value !== undefined) {
            output[key] = value;
        }
    });
    return output;
};

export const loadMajoorSettings = () => {
    if (typeof localStorage === "undefined") {
        return { ...DEFAULT_SETTINGS };
    }
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (!raw) return { ...DEFAULT_SETTINGS };
        const parsed = JSON.parse(raw);
        // Whitelist top-level keys (avoid carrying unknown keys from localStorage).
        const allowed = new Set([
            "grid",
            "siblings",
            "autoScan",
            "status",
            "observability",
            "sidebar",
            "probeBackend",
            "ratingTagsSync",
            "cache",
            "workflowMinimap",
        ]);
        const sanitized = {};
        if (parsed && typeof parsed === "object") {
            for (const [k, v] of Object.entries(parsed)) {
                if (allowed.has(k)) sanitized[k] = v;
            }
        }
        return deepMerge(DEFAULT_SETTINGS, sanitized);
    } catch (error) {
        console.warn("[Majoor] settings load failed, using defaults", error);
        return { ...DEFAULT_SETTINGS };
    }
};

export const saveMajoorSettings = (settings) => {
    if (typeof localStorage === "undefined") return;
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (error) {
        console.warn("[Majoor] settings save failed", error);
        // Best-effort user notification (throttled).
        try {
            const now = Date.now();
            const last = Number(window?._mjrSettingsSaveFailAt || 0) || 0;
            if (now - last > 30_000) {
                window._mjrSettingsSaveFailAt = now;
                import("./dialogs.js")
                    .then(({ comfyAlert }) => comfyAlert("Majoor: Failed to save settings (browser storage full or blocked)."))
                    .catch(() => {});
            }
        } catch {}
        try {
            safeDispatchCustomEvent("mjr-settings-save-failed", { error: String(error?.message || error || "") }, { warnPrefix: "[Majoor]" });
        } catch {}
    }
};

const applySettingsToConfig = (settings) => {
    const maxPage = Number(APP_DEFAULTS.MAX_PAGE_SIZE) || 2000;
    const pageSize = Math.max(50, Math.min(maxPage, Number(settings.grid?.pageSize) || APP_DEFAULTS.DEFAULT_PAGE_SIZE));
    APP_CONFIG.DEFAULT_PAGE_SIZE = pageSize;
    APP_CONFIG.AUTO_SCAN_ENABLED = !!settings.autoScan?.enabled;
    APP_CONFIG.AUTO_SCAN_ON_STARTUP = !!settings.autoScan?.onStartup;
    APP_CONFIG.STATUS_POLL_INTERVAL = Math.max(1000, Number(settings.status?.pollInterval) || APP_DEFAULTS.STATUS_POLL_INTERVAL);
};

export const registerMajoorSettings = (app, onApplied) => {
    const settings = loadMajoorSettings();
    applySettingsToConfig(settings);

    if (!app?.ui?.settings?.addSetting) {
        return settings;
    }

    const notifyApplied = (key) => {
        if (typeof onApplied === "function") {
            onApplied(settings, key);
        }
        safeDispatchCustomEvent("mjr-settings-changed", { key }, { warnPrefix: "[Majoor]" });
    };

    app.ui.settings.addSetting({
        id: `${SETTINGS_PREFIX}.Grid.PageSize`,
        name: "Majoor: Page Size (files per request)",
        tooltip: "Bigger loads more at once; smaller reduces memory.",
        type: "number",
        defaultValue: settings.grid.pageSize,
        attrs: { min: 50, max: Number(APP_CONFIG.MAX_PAGE_SIZE) || 2000, step: 50 },
        onChange: (val) => {
            const maxPage = Number(APP_CONFIG.MAX_PAGE_SIZE) || 2000;
            settings.grid.pageSize = Math.max(50, Math.min(maxPage, Number(val) || DEFAULT_SETTINGS.grid.pageSize));
            saveMajoorSettings(settings);
            applySettingsToConfig(settings);
            notifyApplied("grid.pageSize");
        }
    });

    app.ui.settings.addSetting({
        id: `${SETTINGS_PREFIX}.AutoScan.Enabled`,
        name: "Majoor: Auto-scan on open",
        type: "boolean",
        defaultValue: settings.autoScan.enabled,
        onChange: (val) => {
            settings.autoScan.enabled = !!val;
            saveMajoorSettings(settings);
            applySettingsToConfig(settings);
            notifyApplied("autoScan.enabled");
        }
    });

    app.ui.settings.addSetting({
        id: `${SETTINGS_PREFIX}.AutoScan.OnStartup`,
        name: "Majoor: Auto-scan at ComfyUI startup",
        tooltip: "Starts a background scan as soon as ComfyUI loads in your browser (before opening the panel).",
        type: "boolean",
        defaultValue: !!settings.autoScan?.onStartup,
        onChange: (val) => {
            settings.autoScan = settings.autoScan || {};
            settings.autoScan.onStartup = !!val;
            saveMajoorSettings(settings);
            applySettingsToConfig(settings);
            notifyApplied("autoScan.onStartup");
        }
    });

    app.ui.settings.addSetting({
        id: `${SETTINGS_PREFIX}.Status.PollInterval`,
        name: "Majoor: Status poll interval (ms)",
        tooltip: "Reload the page to apply.",
        type: "number",
        defaultValue: settings.status.pollInterval,
        attrs: { min: 1000, max: 60000, step: 500 },
        onChange: (val) => {
            settings.status.pollInterval = Math.max(1000, Number(val) || DEFAULT_SETTINGS.status.pollInterval);
            saveMajoorSettings(settings);
            applySettingsToConfig(settings);
            notifyApplied("status.pollInterval");
        }
    });

    app.ui.settings.addSetting({
        id: `${SETTINGS_PREFIX}.Observability.Enabled`,
        name: "Majoor: Observability (request logging)",
        tooltip: "Controls Majoor backend request logs (via X-MJR-OBS header). When disabled, Majoor suppresses its own request logs.",
        type: "boolean",
        defaultValue: !!settings.observability?.enabled,
        onChange: (val) => {
            settings.observability = settings.observability || {};
            settings.observability.enabled = !!val;
            saveMajoorSettings(settings);
            invalidateObsCache();
            notifyApplied("observability.enabled");
        }
    });

    app.ui.settings.addSetting({
        id: `${SETTINGS_PREFIX}.Sidebar.Position`,
        name: "Majoor: Sidebar position",
        tooltip: "Choose whether the asset details sidebar appears on the left or right side of the panel. Reload the page to apply.",
        type: "combo",
        defaultValue: settings.sidebar?.position || "right",
        options: ["left", "right"],
        onChange: (val) => {
            settings.sidebar = settings.sidebar || {};
            settings.sidebar.position = val === "left" ? "left" : "right";
            saveMajoorSettings(settings);
            notifyApplied("sidebar.position");
        }
    });

    app.ui.settings.addSetting({
        id: `${SETTINGS_PREFIX}.RatingTagsSync.Enabled`,
        name: "Majoor: Sync rating/tags to files",
        tooltip: "When enabled, Majoor will request the backend to write your rating/tags into the file metadata (ExifTool). On Windows, it may also try a Shell fallback if ExifTool fails.",
        type: "boolean",
        defaultValue: !!settings.ratingTagsSync?.enabled,
        onChange: (val) => {
            settings.ratingTagsSync = settings.ratingTagsSync || {};
            settings.ratingTagsSync.enabled = !!val;
            saveMajoorSettings(settings);
            notifyApplied("ratingTagsSync.enabled");
        }
    });

    app.ui.settings.addSetting({
        id: `${SETTINGS_PREFIX}.Cache.TagsTTLms`,
        name: "Majoor: Tags cache TTL (ms)",
        tooltip: "How long to cache the available tags list in the browser (lower = fresher, higher = fewer requests).",
        type: "number",
        defaultValue: Number(settings.cache?.tagsTTLms) || DEFAULT_SETTINGS.cache.tagsTTLms,
        attrs: { min: 1000, max: 10 * 60_000, step: 1000 },
        onChange: (val) => {
            const n = Math.floor(Number(val) || DEFAULT_SETTINGS.cache.tagsTTLms);
            settings.cache = settings.cache || {};
            settings.cache.tagsTTLms = Math.max(1000, Math.min(10 * 60_000, n));
            saveMajoorSettings(settings);
            notifyApplied("cache.tagsTTLms");
        }
    });

    app.ui.settings.addSetting({
        id: `${SETTINGS_PREFIX}.General.HideSiblings`,
        name: "Majoor: Hide PNG siblings (video previews)",
        tooltip: "If a video has a matching .png, hide the .png from the grid.",
        type: "boolean",
        defaultValue: !!settings.siblings?.hidePngSiblings,
        onChange: (val) => {
            settings.siblings = settings.siblings || {};
            settings.siblings.hidePngSiblings = !!val;
            saveMajoorSettings(settings);
            notifyApplied("siblings.hidePngSiblings");
        }
    });

    app.ui.settings.addSetting({
        id: `${SETTINGS_PREFIX}.Probe.Backend`,
        name: "Majoor: Media probe backend",
        tooltip: "Choose which probe(s) drive metadata extraction (Auto, ExifTool, FFprobe, Both).",
        type: "combo",
        defaultValue: settings.probeBackend?.mode || "auto",
        options: ["auto", "exiftool", "ffprobe", "both"],
        onChange: (val) => {
            const normalized = typeof val === "string" ? val.trim().toLowerCase() : "auto";
            const allowed = ["auto", "exiftool", "ffprobe", "both"];
            const mode = allowed.includes(normalized) ? normalized : "auto";
            settings.probeBackend = settings.probeBackend || {};
            settings.probeBackend.mode = mode;
            saveMajoorSettings(settings);
            setProbeBackendMode(mode)
                .then((result) => {
                    if (!result?.ok) {
                        console.warn("[Majoor] Probe backend update failed", result?.error || result);
                    }
                })
                .catch((error) => {
                    console.warn("[Majoor] Failed to persist probe backend preference", error);
                });
            notifyApplied("probeBackend.mode");
        }
    });

    return settings;
};
