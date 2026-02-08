/**
 * Majoor settings integration with ComfyUI settings panel.
 */

import { APP_CONFIG, APP_DEFAULTS } from "./config.js";
import { getSecuritySettings, setSecuritySettings, setProbeBackendMode, getWatcherStatus, toggleWatcher, getWatcherSettings, updateWatcherSettings } from "../api/client.js";
import { comfyToast } from "./toast.js";
import { safeDispatchCustomEvent } from "../utils/events.js";
import { t, initI18n, setLang, getCurrentLang, getSupportedLanguages } from "./i18n.js";

import { SETTINGS_KEY } from "./settingsStore.js";
const SETTINGS_PREFIX = "Majoor";
const SETTINGS_CATEGORY = "Majoor Assets Manager";
const SETTINGS_REG_FLAG = "__mjrSettingsRegistered";

const DEFAULT_SETTINGS = {
    debug: {
        safeCall: APP_DEFAULTS.DEBUG_SAFE_CALL,
        safeListeners: APP_DEFAULTS.DEBUG_SAFE_LISTENERS,
        viewer: APP_DEFAULTS.DEBUG_VIEWER,
    },
    grid: {
        pageSize: APP_DEFAULTS.DEFAULT_PAGE_SIZE,
        minSize: APP_DEFAULTS.GRID_MIN_SIZE,
        minSizePreset: "medium",
        gap: APP_DEFAULTS.GRID_GAP,
        showExtBadge: APP_DEFAULTS.GRID_SHOW_BADGES_EXTENSION,
        showRatingBadge: APP_DEFAULTS.GRID_SHOW_BADGES_RATING,
        showTagsBadge: APP_DEFAULTS.GRID_SHOW_BADGES_TAGS,
        showDetails: APP_DEFAULTS.GRID_SHOW_DETAILS,
        showFilename: APP_DEFAULTS.GRID_SHOW_DETAILS_FILENAME,
        showDate: APP_DEFAULTS.GRID_SHOW_DETAILS_DATE,
        showDimensions: APP_DEFAULTS.GRID_SHOW_DETAILS_DIMENSIONS,
        showGenTime: APP_DEFAULTS.GRID_SHOW_DETAILS_GENTIME,
        showWorkflowDot: APP_DEFAULTS.GRID_SHOW_WORKFLOW_DOT,
        starColor: APP_DEFAULTS.BADGE_STAR_COLOR,
        badgeImageColor: APP_DEFAULTS.BADGE_IMAGE_COLOR,
        badgeVideoColor: APP_DEFAULTS.BADGE_VIDEO_COLOR,
        badgeAudioColor: APP_DEFAULTS.BADGE_AUDIO_COLOR,
        badgeModel3dColor: APP_DEFAULTS.BADGE_MODEL3D_COLOR,
    },
    infiniteScroll: {
        enabled: APP_DEFAULTS.INFINITE_SCROLL_ENABLED,
        rootMargin: APP_DEFAULTS.INFINITE_SCROLL_ROOT_MARGIN,
        threshold: APP_DEFAULTS.INFINITE_SCROLL_THRESHOLD,
        bottomGapPx: APP_DEFAULTS.BOTTOM_GAP_PX,
    },
    siblings: {
        hidePngSiblings: true,
    },
    autoScan: {
        onStartup: APP_DEFAULTS.AUTO_SCAN_ON_STARTUP,
    },
    watcher: {
        enabled: true,
        debounceMs: APP_DEFAULTS.WATCHER_DEBOUNCE_MS,
        dedupeTtlMs: APP_DEFAULTS.WATCHER_DEDUPE_TTL_MS,
    },
    safety: {
        confirmDeletion: true,
    },
    status: {
        pollInterval: APP_DEFAULTS.STATUS_POLL_INTERVAL,
    },
    viewer: {
        allowPanAtZoom1: APP_DEFAULTS.VIEWER_ALLOW_PAN_AT_ZOOM_1,
        disableWebGL: APP_DEFAULTS.VIEWER_DISABLE_WEBGL_VIDEO,
        videoGradeThrottleFps: APP_DEFAULTS.VIEWER_VIDEO_GRADE_THROTTLE_FPS,
        scopesFps: APP_DEFAULTS.VIEWER_SCOPES_FPS,
        metaTtlMs: APP_DEFAULTS.VIEWER_META_TTL_MS,
        metaMaxEntries: APP_DEFAULTS.VIEWER_META_MAX_ENTRIES,
    },
    rtHydrate: {
        concurrency: APP_DEFAULTS.RT_HYDRATE_CONCURRENCY,
        queueMax: APP_DEFAULTS.RT_HYDRATE_QUEUE_MAX,
        seenMax: APP_DEFAULTS.RT_HYDRATE_SEEN_MAX,
        pruneBudget: APP_DEFAULTS.RT_HYDRATE_PRUNE_BUDGET,
        seenTtlMs: APP_DEFAULTS.RT_HYDRATE_SEEN_TTL_MS,
    },
    observability: {
        enabled: false,
        verboseErrors: false,
    },
    sidebar: {
        position: "right",
        showPreviewThumb: true,
    },
    probeBackend: {
        mode: "auto",
    },
    ratingTagsSync: {
        enabled: true,
    },
    cache: {
        tagsTTLms: 30_000,
    },
    workflowMinimap: {
        enabled: false,
        nodeColors: true,
        showLinks: true,
        showGroups: true,
        renderBypassState: true,
        renderErrorState: true,
        showViewport: true,
    },
    security: {
        safeMode: false,
        allowWrite: true,
        allowRemoteWrite: true,
        allowDelete: true,
        allowRename: true,
        allowOpenInFolder: true,
        allowResetIndex: true,
        apiToken: "",
    },
};

const _safeBool = (value, fallback) => {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (["1", "true", "yes", "on"].includes(normalized)) return true;
        if (["0", "false", "no", "off"].includes(normalized)) return false;
    }
    return !!fallback;
};

const _safeNum = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : Number(fallback);
};

const _safeOneOf = (value, allowed, fallback) => {
    const candidate = typeof value === "string" ? value.trim() : String(value ?? "");
    return allowed.includes(candidate) ? candidate : fallback;
};

const GRID_SIZE_PRESETS = Object.freeze({
    small: 140,
    medium: 200,
    large: 280,
});

const GRID_SIZE_PRESET_OPTIONS = Object.freeze(["small", "medium", "large"]);

const resolveGridMinSize = (grid = {}) => {
    const preset = _safeOneOf(String(grid?.minSizePreset || "").toLowerCase(), GRID_SIZE_PRESET_OPTIONS, "");
    if (preset) return GRID_SIZE_PRESETS[preset];
    return Math.max(60, Math.min(600, Math.round(_safeNum(grid?.minSize, APP_DEFAULTS.GRID_MIN_SIZE))));
};

const detectGridSizePreset = (minSize) => {
    const val = Math.round(_safeNum(minSize, APP_DEFAULTS.GRID_MIN_SIZE));
    if (val <= 160) return "small";
    if (val >= 250) return "large";
    return "medium";
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
    if (typeof localStorage === "undefined") return { ...DEFAULT_SETTINGS };
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (!raw) return { ...DEFAULT_SETTINGS };
        const parsed = JSON.parse(raw);
        const allowed = new Set([
            "debug",
            "grid",
            "infiniteScroll",
            "siblings",
            "autoScan",
            "watcher",
            "status",
            "viewer",
            "rtHydrate",
            "observability",
            "sidebar",
            "probeBackend",
            "ratingTagsSync",
            "cache",
            "workflowMinimap",
            "security",
            "safety",
        ]);
        const sanitized = {};
        if (parsed && typeof parsed === "object") {
            for (const [key, value] of Object.entries(parsed)) {
                if (allowed.has(key)) sanitized[key] = value;
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
    const pageSize = Math.max(
        50,
        Math.min(maxPage, Number(settings.grid?.pageSize) || APP_DEFAULTS.DEFAULT_PAGE_SIZE)
    );
    APP_CONFIG.DEFAULT_PAGE_SIZE = pageSize;
    APP_CONFIG.AUTO_SCAN_ON_STARTUP = !!settings.autoScan?.onStartup;
    APP_CONFIG.STATUS_POLL_INTERVAL = Math.max(1000, Number(settings.status?.pollInterval) || APP_DEFAULTS.STATUS_POLL_INTERVAL);

    APP_CONFIG.DEBUG_SAFE_CALL = !!settings.debug?.safeCall;
    APP_CONFIG.DEBUG_SAFE_LISTENERS = !!settings.debug?.safeListeners;
    APP_CONFIG.DEBUG_VIEWER = !!settings.debug?.viewer;

    APP_CONFIG.GRID_MIN_SIZE = resolveGridMinSize(settings.grid);
    APP_CONFIG.GRID_GAP = Math.max(0, Math.min(40, Math.round(_safeNum(settings.grid?.gap, APP_DEFAULTS.GRID_GAP))));

    APP_CONFIG.GRID_SHOW_BADGES_EXTENSION = !!(settings.grid?.showExtBadge ?? APP_DEFAULTS.GRID_SHOW_BADGES_EXTENSION);
    APP_CONFIG.GRID_SHOW_BADGES_RATING = !!(settings.grid?.showRatingBadge ?? APP_DEFAULTS.GRID_SHOW_BADGES_RATING);
    APP_CONFIG.GRID_SHOW_BADGES_TAGS = !!(settings.grid?.showTagsBadge ?? APP_DEFAULTS.GRID_SHOW_BADGES_TAGS);
    APP_CONFIG.GRID_SHOW_DETAILS = !!(settings.grid?.showDetails ?? APP_DEFAULTS.GRID_SHOW_DETAILS);
    APP_CONFIG.GRID_SHOW_DETAILS_FILENAME = !!(settings.grid?.showFilename ?? APP_DEFAULTS.GRID_SHOW_DETAILS_FILENAME);
    APP_CONFIG.GRID_SHOW_DETAILS_DATE = !!(settings.grid?.showDate ?? APP_DEFAULTS.GRID_SHOW_DETAILS_DATE);
    APP_CONFIG.GRID_SHOW_DETAILS_DIMENSIONS = !!(settings.grid?.showDimensions ?? APP_DEFAULTS.GRID_SHOW_DETAILS_DIMENSIONS);
    APP_CONFIG.GRID_SHOW_DETAILS_GENTIME = !!(settings.grid?.showGenTime ?? APP_DEFAULTS.GRID_SHOW_DETAILS_GENTIME);
    APP_CONFIG.GRID_SHOW_WORKFLOW_DOT = !!(settings.grid?.showWorkflowDot ?? APP_DEFAULTS.GRID_SHOW_WORKFLOW_DOT);

    const _safeColor = (v, fallback) => /^#[0-9a-fA-F]{3,8}$/.test(String(v || "").trim()) ? String(v).trim() : fallback;
    APP_CONFIG.BADGE_STAR_COLOR = _safeColor(settings.grid?.starColor, APP_DEFAULTS.BADGE_STAR_COLOR);
    APP_CONFIG.BADGE_IMAGE_COLOR = _safeColor(settings.grid?.badgeImageColor, APP_DEFAULTS.BADGE_IMAGE_COLOR);
    APP_CONFIG.BADGE_VIDEO_COLOR = _safeColor(settings.grid?.badgeVideoColor, APP_DEFAULTS.BADGE_VIDEO_COLOR);
    APP_CONFIG.BADGE_AUDIO_COLOR = _safeColor(settings.grid?.badgeAudioColor, APP_DEFAULTS.BADGE_AUDIO_COLOR);
    APP_CONFIG.BADGE_MODEL3D_COLOR = _safeColor(settings.grid?.badgeModel3dColor, APP_DEFAULTS.BADGE_MODEL3D_COLOR);

    try {
        const root = document.querySelector(".mjr-assets-manager");
        if (root) {
            root.style.setProperty("--mjr-star-active", APP_CONFIG.BADGE_STAR_COLOR);
            root.style.setProperty("--mjr-badge-image", APP_CONFIG.BADGE_IMAGE_COLOR);
            root.style.setProperty("--mjr-badge-video", APP_CONFIG.BADGE_VIDEO_COLOR);
            root.style.setProperty("--mjr-badge-audio", APP_CONFIG.BADGE_AUDIO_COLOR);
            root.style.setProperty("--mjr-badge-model3d", APP_CONFIG.BADGE_MODEL3D_COLOR);
        }
    } catch {}

    APP_CONFIG.INFINITE_SCROLL_ENABLED = !!settings.infiniteScroll?.enabled;
    APP_CONFIG.INFINITE_SCROLL_ROOT_MARGIN = String(settings.infiniteScroll?.rootMargin || APP_DEFAULTS.INFINITE_SCROLL_ROOT_MARGIN);
    APP_CONFIG.INFINITE_SCROLL_THRESHOLD = Math.max(0, Math.min(1, _safeNum(settings.infiniteScroll?.threshold, APP_DEFAULTS.INFINITE_SCROLL_THRESHOLD)));
    APP_CONFIG.BOTTOM_GAP_PX = Math.max(0, Math.min(5000, Math.round(_safeNum(settings.infiniteScroll?.bottomGapPx, APP_DEFAULTS.BOTTOM_GAP_PX))));

    APP_CONFIG.VIEWER_ALLOW_PAN_AT_ZOOM_1 = !!settings.viewer?.allowPanAtZoom1;
    APP_CONFIG.VIEWER_DISABLE_WEBGL_VIDEO = !!settings.viewer?.disableWebGL;
    APP_CONFIG.VIEWER_VIDEO_GRADE_THROTTLE_FPS = Math.max(1, Math.min(60, Math.round(_safeNum(settings.viewer?.videoGradeThrottleFps, APP_DEFAULTS.VIEWER_VIDEO_GRADE_THROTTLE_FPS))));
    APP_CONFIG.VIEWER_SCOPES_FPS = Math.max(1, Math.min(60, Math.round(_safeNum(settings.viewer?.scopesFps, APP_DEFAULTS.VIEWER_SCOPES_FPS))));
    APP_CONFIG.VIEWER_META_TTL_MS = Math.max(1000, Math.min(10 * 60_000, Math.round(_safeNum(settings.viewer?.metaTtlMs, APP_DEFAULTS.VIEWER_META_TTL_MS))));
    APP_CONFIG.VIEWER_META_MAX_ENTRIES = Math.max(50, Math.min(5000, Math.round(_safeNum(settings.viewer?.metaMaxEntries, APP_DEFAULTS.VIEWER_META_MAX_ENTRIES))));

    APP_CONFIG.WORKFLOW_MINIMAP_ENABLED = !!(settings.workflowMinimap?.enabled ?? false);

    APP_CONFIG.RT_HYDRATE_CONCURRENCY = Math.max(1, Math.min(16, Math.round(_safeNum(settings.rtHydrate?.concurrency, APP_DEFAULTS.RT_HYDRATE_CONCURRENCY))));
    APP_CONFIG.RT_HYDRATE_QUEUE_MAX = Math.max(10, Math.min(5000, Math.round(_safeNum(settings.rtHydrate?.queueMax, APP_DEFAULTS.RT_HYDRATE_QUEUE_MAX))));
    APP_CONFIG.RT_HYDRATE_SEEN_MAX = Math.max(1000, Math.min(200_000, Math.round(_safeNum(settings.rtHydrate?.seenMax, APP_DEFAULTS.RT_HYDRATE_SEEN_MAX))));
    APP_CONFIG.RT_HYDRATE_PRUNE_BUDGET = Math.max(10, Math.min(10_000, Math.round(_safeNum(settings.rtHydrate?.pruneBudget, APP_DEFAULTS.RT_HYDRATE_PRUNE_BUDGET))));
    APP_CONFIG.RT_HYDRATE_SEEN_TTL_MS = Math.max(5_000, Math.min(6 * 60 * 60_000, Math.round(_safeNum(settings.rtHydrate?.seenTtlMs, APP_DEFAULTS.RT_HYDRATE_SEEN_TTL_MS))));

    APP_CONFIG.DELETE_CONFIRMATION = !!settings.safety?.confirmDeletion;
    APP_CONFIG.DEBUG_VERBOSE_ERRORS = !!settings.observability?.verboseErrors;
};

export async function syncBackendSecuritySettings() {
    try {
        const res = await getSecuritySettings();
        if (!res?.ok) return;
        const prefs = res.data?.prefs;
        if (!prefs || typeof prefs !== "object") return;

        const settings = loadMajoorSettings();
        settings.security = settings.security || {};
        settings.security.safeMode = _safeBool(prefs.safe_mode, settings.security.safeMode);
        settings.security.allowWrite = _safeBool(prefs.allow_write, settings.security.allowWrite);
        settings.security.allowRemoteWrite = _safeBool(prefs.allow_remote_write, settings.security.allowRemoteWrite);
        settings.security.allowDelete = _safeBool(prefs.allow_delete, settings.security.allowDelete);
        settings.security.allowRename = _safeBool(prefs.allow_rename, settings.security.allowRename);
        settings.security.allowOpenInFolder = _safeBool(prefs.allow_open_in_folder, settings.security.allowOpenInFolder);
        settings.security.allowResetIndex = _safeBool(prefs.allow_reset_index, settings.security.allowResetIndex);
        saveMajoorSettings(settings);
        applySettingsToConfig(settings);
        safeDispatchCustomEvent("mjr-settings-changed", { key: "security" }, { warnPrefix: "[Majoor]" });
    } catch (error) {
        console.warn("[Majoor] failed to sync backend security settings", error);
    }
}

// Guard to prevent multiple registrations
let _settingsStorageListenerBound = false;

export const registerMajoorSettings = (app, onApplied) => {
    initI18n(app);
    const settings = loadMajoorSettings();
    applySettingsToConfig(settings);
    void syncBackendSecuritySettings();

    let notifyTimer = null;
    const pendingKeys = new Set();
    const flushNotify = () => {
        notifyTimer = null;
        if (!pendingKeys.size) return;
        const keys = Array.from(pendingKeys);
        pendingKeys.clear();
        for (const pendingKey of keys) {
            safeDispatchCustomEvent("mjr-settings-changed", { key: pendingKey }, { warnPrefix: "[Majoor]" });
        }
    };
    const scheduleNotify = (key) => {
        if (typeof key === "string") pendingKeys.add(key);
        if (notifyTimer) return;
        notifyTimer = setTimeout(flushNotify, 120);
    };

    const refreshFromStorage = () => {
        const latest = loadMajoorSettings();
        Object.assign(settings, latest);
        applySettingsToConfig(settings);
        scheduleNotify("storage");
    };

    const storageListener = (event) => {
        if (!event || event.key !== SETTINGS_KEY) return;
        if (event.newValue === event.oldValue) return;
        refreshFromStorage();
    };

    // Only add storage listener once to prevent leaks
    if (!_settingsStorageListenerBound) {
        try {
            window.addEventListener("storage", storageListener);
            _settingsStorageListenerBound = true;
        } catch {}
    }

    const tryRegister = () => {
        const settingsApi = app?.ui?.settings;
        const addSetting = settingsApi?.addSetting;
        if (!settingsApi || typeof addSetting !== "function") {
            return false;
        }

        try {
            if (settingsApi[SETTINGS_REG_FLAG]) {
                return true;
            }
        } catch {}

        const safeAddSetting = (payload) => {
            if (!payload || typeof payload !== "object") return;
            try {
                addSetting(payload);
                return;
            } catch (err1) {
                // Some ComfyUI builds reject optional attrs payloads.
                // Retry gracefully so settings remain visible.
                try {
                    const noAttrs = { ...payload };
                    delete noAttrs.attrs;
                    addSetting(noAttrs);
                    return;
                } catch (err2) {
                    try {
                        const { category: _cat, attrs: _attrs, ...rest } = payload;
                        addSetting(rest);
                        return;
                    } catch (err3) {
                        try {
                            console.warn("[Majoor] addSetting failed", {
                                id: payload?.id,
                                name: payload?.name,
                                err1: String(err1?.message || err1 || ""),
                                err2: String(err2?.message || err2 || ""),
                                err3: String(err3?.message || err3 || ""),
                            });
                        } catch {}
                    }
                }
            }
        };

        const notifyApplied = (key) => {
            if (typeof onApplied === "function") {
                onApplied(settings, key);
            }
            scheduleNotify(key);
        };

        const cat = (section, label) => [SETTINGS_CATEGORY, section, label];
        const cardCat = (label) => [SETTINGS_CATEGORY, t("cat.cards", "Cards"), label];
        const badgeCat = (label) => [SETTINGS_CATEGORY, t("cat.badges", "Badges"), label];

          safeAddSetting({
              id: `${SETTINGS_PREFIX}.Grid.ShowExtBadge`,
              category: badgeCat("Show format badges"),
            name: "Show format badges",
            tooltip: "Display format badges (e.g. JPG, MP4) on thumbnails",
            type: "boolean",
            defaultValue: !!settings.grid?.showExtBadge,
            onChange: (value) => {
                settings.grid.showExtBadge = !!value;
                saveMajoorSettings(settings);
                applySettingsToConfig(settings);
                notifyApplied("grid.showExtBadge");
            },
        });

          safeAddSetting({
              id: `${SETTINGS_PREFIX}.Grid.ShowRatingBadge`,
              category: badgeCat("Show rating badges"),
            name: "Show ratings",
            tooltip: "Display star ratings on thumbnails",
            type: "boolean",
            defaultValue: !!settings.grid?.showRatingBadge,
            onChange: (value) => {
                settings.grid.showRatingBadge = !!value;
                saveMajoorSettings(settings);
                applySettingsToConfig(settings);
                notifyApplied("grid.showRatingBadge");
            },
        });

          safeAddSetting({
              id: `${SETTINGS_PREFIX}.Grid.ShowTagsBadge`,
              category: badgeCat("Show tags badges"),
            name: "Show tags",
            tooltip: "Display a small indicator if an asset has tags",
            type: "boolean",
            defaultValue: !!settings.grid?.showTagsBadge,
            onChange: (value) => {
                settings.grid.showTagsBadge = !!value;
                saveMajoorSettings(settings);
                applySettingsToConfig(settings);
                notifyApplied("grid.showTagsBadge");
            },
        });

        // Badge Colors
        if (!settings.grid?.minSizePreset) {
            settings.grid = settings.grid || {};
            settings.grid.minSizePreset = detectGridSizePreset(settings.grid.minSize);
            saveMajoorSettings(settings);
        }
        const colorCat = (label) => [SETTINGS_CATEGORY, t("cat.badges", "Badges"), label];
        const normalizeHexColor = (value, fallback) => {
            const v = String(value || "").trim();
            return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toUpperCase() : fallback;
        };

        safeAddSetting({
            id: `${SETTINGS_PREFIX}.Badges.StarColor`,
            category: colorCat(t("cat.badgeColors", "Badge colors")),
            name: t("setting.starColor", "Majoor: Star color"),
            tooltip: t("setting.starColor.tooltip", "Color of rating stars on thumbnails (hex, e.g. #FFD45A)"),
            type: "color",
            defaultValue: normalizeHexColor(settings.grid?.starColor, APP_DEFAULTS.BADGE_STAR_COLOR),
            onChange: (value) => {
                settings.grid.starColor = normalizeHexColor(value, APP_DEFAULTS.BADGE_STAR_COLOR);
                saveMajoorSettings(settings);
                applySettingsToConfig(settings);
                notifyApplied("grid.starColor");
            },
        });

        safeAddSetting({
            id: `${SETTINGS_PREFIX}.Badges.ImageColor`,
            category: colorCat(t("cat.badgeColors", "Badge colors")),
            name: t("setting.badgeImageColor", "Majoor: Image badge color"),
            tooltip: t("setting.badgeImageColor.tooltip", "Color for image badges: PNG, JPG, WEBP, GIF, BMP, TIF (hex)"),
            type: "color",
            defaultValue: normalizeHexColor(settings.grid?.badgeImageColor, APP_DEFAULTS.BADGE_IMAGE_COLOR),
            onChange: (value) => {
                settings.grid.badgeImageColor = normalizeHexColor(value, APP_DEFAULTS.BADGE_IMAGE_COLOR);
                saveMajoorSettings(settings);
                applySettingsToConfig(settings);
                notifyApplied("grid.badgeImageColor");
            },
        });

        safeAddSetting({
            id: `${SETTINGS_PREFIX}.Badges.VideoColor`,
            category: colorCat(t("cat.badgeColors", "Badge colors")),
            name: t("setting.badgeVideoColor", "Majoor: Video badge color"),
            tooltip: t("setting.badgeVideoColor.tooltip", "Color for video badges: MP4, WEBM, MOV, AVI, MKV (hex)"),
            type: "color",
            defaultValue: normalizeHexColor(settings.grid?.badgeVideoColor, APP_DEFAULTS.BADGE_VIDEO_COLOR),
            onChange: (value) => {
                settings.grid.badgeVideoColor = normalizeHexColor(value, APP_DEFAULTS.BADGE_VIDEO_COLOR);
                saveMajoorSettings(settings);
                applySettingsToConfig(settings);
                notifyApplied("grid.badgeVideoColor");
            },
        });

        safeAddSetting({
            id: `${SETTINGS_PREFIX}.Badges.AudioColor`,
            category: colorCat(t("cat.badgeColors", "Badge colors")),
            name: t("setting.badgeAudioColor", "Majoor: Audio badge color"),
            tooltip: t("setting.badgeAudioColor.tooltip", "Color for audio badges: MP3, WAV, OGG, FLAC (hex)"),
            type: "color",
            defaultValue: normalizeHexColor(settings.grid?.badgeAudioColor, APP_DEFAULTS.BADGE_AUDIO_COLOR),
            onChange: (value) => {
                settings.grid.badgeAudioColor = normalizeHexColor(value, APP_DEFAULTS.BADGE_AUDIO_COLOR);
                saveMajoorSettings(settings);
                applySettingsToConfig(settings);
                notifyApplied("grid.badgeAudioColor");
            },
        });

        safeAddSetting({
            id: `${SETTINGS_PREFIX}.Badges.Model3dColor`,
            category: colorCat(t("cat.badgeColors", "Badge colors")),
            name: t("setting.badgeModel3dColor", "Majoor: 3D model badge color"),
            tooltip: t("setting.badgeModel3dColor.tooltip", "Color for 3D model badges: OBJ, FBX, GLB, GLTF (hex)"),
            type: "color",
            defaultValue: normalizeHexColor(settings.grid?.badgeModel3dColor, APP_DEFAULTS.BADGE_MODEL3D_COLOR),
            onChange: (value) => {
                settings.grid.badgeModel3dColor = normalizeHexColor(value, APP_DEFAULTS.BADGE_MODEL3D_COLOR);
                saveMajoorSettings(settings);
                applySettingsToConfig(settings);
                notifyApplied("grid.badgeModel3dColor");
            },
        });

        safeAddSetting({
            id: `${SETTINGS_PREFIX}.Grid.ShowDetails`,
            category: cardCat("Show card details"),
            name: "Show metadata panel",
            tooltip: "Show the bottom details panel on asset cards (filename, date, etc.)",
            type: "boolean",
            defaultValue: !!settings.grid?.showDetails,
            onChange: (value) => {
                settings.grid.showDetails = !!value;
                saveMajoorSettings(settings);
                applySettingsToConfig(settings);
                notifyApplied("grid.showDetails");
            },
        });

        if (settings.grid?.showDetails !== false) {
                safeAddSetting({
                    id: `${SETTINGS_PREFIX}.Grid.ShowFilename`,
                    category: cardCat("Show filename"),
                name: "Show filename",
                tooltip: "Display filename in details panel",
                type: "boolean",
                defaultValue: !!settings.grid?.showFilename,
                onChange: (value) => {
                    settings.grid.showFilename = !!value;
                    saveMajoorSettings(settings);
                    applySettingsToConfig(settings);
                    notifyApplied("grid.showFilename");
                },
            });

                safeAddSetting({
                    id: `${SETTINGS_PREFIX}.Grid.ShowDate`,
                    category: cardCat("Show date/time"),
                name: "Show date/time",
                tooltip: "Display date and time in details panel",
                type: "boolean",
                defaultValue: !!settings.grid?.showDate,
                onChange: (value) => {
                    settings.grid.showDate = !!value;
                    saveMajoorSettings(settings);
                    applySettingsToConfig(settings);
                    notifyApplied("grid.showDate");
                },
            });

                safeAddSetting({
                    id: `${SETTINGS_PREFIX}.Grid.ShowDimensions`,
                    category: cardCat("Show dimensions"),
                name: "Show dimensions",
                tooltip: "Display resolution (WxH) in details panel",
                type: "boolean",
                defaultValue: !!settings.grid?.showDimensions,
                onChange: (value) => {
                    settings.grid.showDimensions = !!value;
                    saveMajoorSettings(settings);
                    applySettingsToConfig(settings);
                    notifyApplied("grid.showDimensions");
                },
            });

                safeAddSetting({
                    id: `${SETTINGS_PREFIX}.Grid.ShowGenTime`,
                    category: cardCat("Show generation time"),
                name: "Show generation time",
                tooltip: "Display seconds taken to generate the asset (if available)",
                type: "boolean",
                defaultValue: !!settings.grid?.showGenTime,
                onChange: (value) => {
                    settings.grid.showGenTime = !!value;
                    saveMajoorSettings(settings);
                    applySettingsToConfig(settings);
                    notifyApplied("grid.showGenTime");
                },
            });

            safeAddSetting({
                id: `${SETTINGS_PREFIX}.Grid.ShowWorkflowDot`,
                category: cardCat("Show workflow dot"),
                name: "Show workflow indicator",
                tooltip: "Display the green dot indicating workflow metadata availability (bottom right of card)",
                type: "boolean",
                defaultValue: !!settings.grid?.showWorkflowDot,
                onChange: (value) => {
                    settings.grid.showWorkflowDot = !!value;
                    saveMajoorSettings(settings);
                    applySettingsToConfig(settings);
                    notifyApplied("grid.showWorkflowDot");
                },
            });
        }

        safeAddSetting({
            id: `${SETTINGS_PREFIX}.Cards.ThumbSize`,
            category: cardCat(t("setting.grid.cardSize.group", "Card size")),
            name: t("setting.grid.cardSize.name", "Majoor: Card Size"),
            tooltip: t("setting.grid.cardSize.desc", "Choose the card size preset used by the grid layout."),
            type: "combo",
            defaultValue: (() => {
                const preset = _safeOneOf(
                    String(settings.grid?.minSizePreset || "").toLowerCase(),
                    GRID_SIZE_PRESET_OPTIONS,
                    detectGridSizePreset(settings.grid?.minSize)
                );
                const labels = {
                    small: t("setting.grid.cardSize.small", "Small"),
                    medium: t("setting.grid.cardSize.medium", "Medium"),
                    large: t("setting.grid.cardSize.large", "Large"),
                };
                return labels[preset] || labels.medium;
            })(),
            options: [
                t("setting.grid.cardSize.small", "Small"),
                t("setting.grid.cardSize.medium", "Medium"),
                t("setting.grid.cardSize.large", "Large"),
            ],
            onChange: (value) => {
                const label = String(value || "").trim().toLowerCase();
                const smallLabel = t("setting.grid.cardSize.small", "Small").toLowerCase();
                const mediumLabel = t("setting.grid.cardSize.medium", "Medium").toLowerCase();
                const largeLabel = t("setting.grid.cardSize.large", "Large").toLowerCase();
                let preset = "medium";
                if (label === smallLabel || label === "small" || label === "petit") preset = "small";
                else if (label === largeLabel || label === "large" || label === "grand") preset = "large";
                else if (label === mediumLabel || label === "medium" || label === "moyen") preset = "medium";
                settings.grid.minSizePreset = preset;
                settings.grid.minSize = GRID_SIZE_PRESETS[preset];
                saveMajoorSettings(settings);
                applySettingsToConfig(settings);
                notifyApplied("grid.minSizePreset");
            },
        });

        safeAddSetting({
            id: `${SETTINGS_PREFIX}.Sidebar.Position`,
            category: cat(t("cat.grid"), t("setting.sidebar.pos.name").replace("Majoor: ", "")),
            name: t("setting.sidebar.pos.name"),
            tooltip: t("setting.sidebar.pos.desc"),
            type: "combo",
            defaultValue: settings.sidebar?.position || "right",
            options: ["left", "right"],
            onChange: (value) => {
                settings.sidebar = settings.sidebar || {};
                settings.sidebar.position = value === "left" ? "left" : "right";
                saveMajoorSettings(settings);
                notifyApplied("sidebar.position");
            },
        });

        safeAddSetting({
            id: `${SETTINGS_PREFIX}.Sidebar.ShowPreviewThumb`,
            category: cat(t("cat.grid"), "Sidebar preview"),
            name: "Show sidebar preview thumb",
            tooltip: "Show/hide the large media preview at the top of the sidebar metadata panel.",
            type: "boolean",
            defaultValue: !!(settings.sidebar?.showPreviewThumb ?? true),
            onChange: (value) => {
                settings.sidebar = settings.sidebar || {};
                settings.sidebar.showPreviewThumb = !!value;
                saveMajoorSettings(settings);
                notifyApplied("sidebar.showPreviewThumb");
            },
        });

        safeAddSetting({
            id: `${SETTINGS_PREFIX}.General.HideSiblings`,
            category: cat(t("cat.grid"), t("setting.siblings.hide.name").replace("Majoor: ", "")),
            name: t("setting.siblings.hide.name"),
            tooltip: t("setting.siblings.hide.desc"),
            type: "boolean",
            defaultValue: !!settings.siblings?.hidePngSiblings,
            onChange: (value) => {
                settings.siblings = settings.siblings || {};
                settings.siblings.hidePngSiblings = !!value;
                saveMajoorSettings(settings);
                notifyApplied("siblings.hidePngSiblings");
            },
        });

        safeAddSetting({
            id: `${SETTINGS_PREFIX}.Grid.PageSize`,
            category: cat(t("cat.grid"), t("setting.grid.pagesize.name").replace("Majoor: ", "")),
            name: t("setting.grid.pagesize.name"),
            tooltip: t("setting.grid.pagesize.desc"),
            type: "number",
            defaultValue: settings.grid.pageSize,
            attrs: { min: 50, max: Number(APP_CONFIG.MAX_PAGE_SIZE) || 2000, step: 50 },
            onChange: (value) => {
                const maxPage = Number(APP_CONFIG.MAX_PAGE_SIZE) || 2000;
                settings.grid.pageSize = Math.max(50, Math.min(maxPage, Number(value) || DEFAULT_SETTINGS.grid.pageSize));
                saveMajoorSettings(settings);
                applySettingsToConfig(settings);
                notifyApplied("grid.pageSize");
            },
        });

        safeAddSetting({
            id: `${SETTINGS_PREFIX}.InfiniteScroll.Enabled`,
            category: cat(t("cat.grid"), t("setting.nav.infinite.name").replace("Majoor: ", "")),
            name: t("setting.nav.infinite.name"),
            tooltip: t("setting.nav.infinite.desc"),
            type: "boolean",
            defaultValue: !!settings.infiniteScroll?.enabled,
            onChange: (value) => {
                settings.infiniteScroll = settings.infiniteScroll || {};
                settings.infiniteScroll.enabled = !!value;
                saveMajoorSettings(settings);
                applySettingsToConfig(settings);
                notifyApplied("infiniteScroll.enabled");
            },
        });

        safeAddSetting({
            id: `${SETTINGS_PREFIX}.Viewer.AllowPanAtZoom1`,
            category: cat(t("cat.viewer"), t("setting.viewer.pan.name").replace("Majoor: ", "")),
            name: t("setting.viewer.pan.name"),
            tooltip: t("setting.viewer.pan.desc"),
            type: "boolean",
            defaultValue: !!settings.viewer?.allowPanAtZoom1,
            onChange: (value) => {
                settings.viewer = settings.viewer || {};
                settings.viewer.allowPanAtZoom1 = !!value;
                saveMajoorSettings(settings);
                applySettingsToConfig(settings);
                notifyApplied("viewer.allowPanAtZoom1");
            },
        });

        safeAddSetting({
            id: `${SETTINGS_PREFIX}.Viewer.DisableWebGL`,
            category: cat(t("cat.viewer"), "Disable WebGL Video"),
            name: "Disable WebGL Video",
            tooltip: "Use CPU rendering (Canvas 2D) for video playback. Fixes 'black screen' issues on incompatible hardware/browsers.",
            type: "boolean",
            defaultValue: !!settings.viewer?.disableWebGL,
            onChange: (value) => {
                settings.viewer = settings.viewer || {};
                settings.viewer.disableWebGL = !!value;
                saveMajoorSettings(settings);
                applySettingsToConfig(settings);
                notifyApplied("viewer.disableWebGL");
            },
        });

        safeAddSetting({
            id: `${SETTINGS_PREFIX}.AutoScan.OnStartup`,
            category: cat(t("cat.scanning"), t("setting.scan.startup.name").replace("Majoor: ", "")),
            name: t("setting.scan.startup.name"),
            tooltip: t("setting.scan.startup.desc"),
            type: "boolean",
            defaultValue: !!settings.autoScan?.onStartup,
            onChange: (value) => {
                settings.autoScan = settings.autoScan || {};
                settings.autoScan.onStartup = !!value;
                saveMajoorSettings(settings);
                applySettingsToConfig(settings);
                notifyApplied("autoScan.onStartup");
            },
        });

        safeAddSetting({
            id: `${SETTINGS_PREFIX}.Watcher.Enabled`,
            category: cat(t("cat.scanning"), t("setting.watcher.name").replace("Majoor: ", "")),
            name: t("setting.watcher.name"),
            tooltip: t("setting.watcher.desc") + " (env: MJR_ENABLE_WATCHER)",
            type: "boolean",
            defaultValue: !!settings.watcher?.enabled,
            onChange: async (value) => {
                settings.watcher = settings.watcher || {};
                settings.watcher.enabled = !!value;
                saveMajoorSettings(settings);
                notifyApplied("watcher.enabled");
                try {
                    const res = await toggleWatcher(!!value);
                    if (!res?.ok) {
                        settings.watcher.enabled = !value;
                        saveMajoorSettings(settings);
                        notifyApplied("watcher.enabled");
                        comfyToast(res?.error || "Failed to toggle watcher", "error");
                    }
                } catch {
                    settings.watcher.enabled = !value;
                    saveMajoorSettings(settings);
                    notifyApplied("watcher.enabled");
                }
            },
        });

        const _clampWatcherValue = (raw, fallback, min, max) => {
            const parsed = Math.round(_safeNum(raw, fallback));
            return Math.max(min, Math.min(max, parsed));
        };

        const applyWatcherSettingsFromBackend = (payload = {}) => {
            const changed = [];
            settings.watcher = settings.watcher || {};
            if (typeof payload.debounce_ms === "number") {
                const normalized = Math.max(50, Math.min(5000, Math.round(payload.debounce_ms)));
                if (settings.watcher.debounceMs !== normalized) {
                    settings.watcher.debounceMs = normalized;
                    changed.push("watcher.debounceMs");
                }
            }
            if (typeof payload.dedupe_ttl_ms === "number") {
                const normalized = Math.max(100, Math.min(30000, Math.round(payload.dedupe_ttl_ms)));
                if (settings.watcher.dedupeTtlMs !== normalized) {
                    settings.watcher.dedupeTtlMs = normalized;
                    changed.push("watcher.dedupeTtlMs");
                }
            }
            if (!changed.length) {
                return;
            }
            saveMajoorSettings(settings);
            changed.forEach((key) => notifyApplied(key));
        };

        const syncWatcherRuntimeSettings = async () => {
            try {
                const res = await getWatcherSettings();
                if (!res?.ok) {
                    return;
                }
                applyWatcherSettingsFromBackend(res.data || {});
            } catch {}
        };

        safeAddSetting({
            id: `${SETTINGS_PREFIX}.Watcher.DebounceDelay`,
            category: cat(t("cat.scanning"), t("setting.watcher.name").replace("Majoor: ", "")),
            name: t("setting.watcher.debounce.name"),
            tooltip: t("setting.watcher.debounce.desc") + " (env: MJR_WATCHER_DEBOUNCE_MS)",
            type: "number",
            defaultValue: settings.watcher?.debounceMs ?? APP_DEFAULTS.WATCHER_DEBOUNCE_MS,
            attrs: { min: 50, max: 5000, step: 50 },
            onChange: async (value) => {
                const fallback = APP_DEFAULTS.WATCHER_DEBOUNCE_MS;
                const clamped = _clampWatcherValue(value, fallback, 50, 5000);
                const previous = settings.watcher?.debounceMs ?? fallback;
                if (clamped === previous) return;
                settings.watcher = settings.watcher || {};
                settings.watcher.debounceMs = clamped;
                saveMajoorSettings(settings);
                try {
                    const res = await updateWatcherSettings({ debounce_ms: clamped });
                    if (!res?.ok) {
                        throw new Error(res?.error || t("setting.watcher.debounce.error"));
                    }
                    const backendValue = Math.round(Number(res?.data?.debounce_ms ?? clamped));
                    settings.watcher.debounceMs = backendValue;
                    saveMajoorSettings(settings);
                    notifyApplied("watcher.debounceMs");
                } catch (error) {
                    settings.watcher.debounceMs = previous;
                    saveMajoorSettings(settings);
                    notifyApplied("watcher.debounceMs");
                    comfyToast(error?.message || t("setting.watcher.debounce.error"), "error");
                }
            },
        });

        safeAddSetting({
            id: `${SETTINGS_PREFIX}.Watcher.DedupeWindow`,
            category: cat(t("cat.scanning"), t("setting.watcher.name").replace("Majoor: ", "")),
            name: t("setting.watcher.dedupe.name"),
            tooltip: t("setting.watcher.dedupe.desc") + " (env: MJR_WATCHER_DEDUPE_TTL_MS)",
            type: "number",
            defaultValue: settings.watcher?.dedupeTtlMs ?? APP_DEFAULTS.WATCHER_DEDUPE_TTL_MS,
            attrs: { min: 100, max: 30000, step: 100 },
            onChange: async (value) => {
                const fallback = APP_DEFAULTS.WATCHER_DEDUPE_TTL_MS;
                const clamped = _clampWatcherValue(value, fallback, 100, 30000);
                const previous = settings.watcher?.dedupeTtlMs ?? fallback;
                if (clamped === previous) return;
                settings.watcher = settings.watcher || {};
                settings.watcher.dedupeTtlMs = clamped;
                saveMajoorSettings(settings);
                try {
                    const res = await updateWatcherSettings({ dedupe_ttl_ms: clamped });
                    if (!res?.ok) {
                        throw new Error(res?.error || t("setting.watcher.dedupe.error"));
                    }
                    const backendValue = Math.round(Number(res?.data?.dedupe_ttl_ms ?? clamped));
                    settings.watcher.dedupeTtlMs = backendValue;
                    saveMajoorSettings(settings);
                    notifyApplied("watcher.dedupeTtlMs");
                } catch (error) {
                    settings.watcher.dedupeTtlMs = previous;
                    saveMajoorSettings(settings);
                    notifyApplied("watcher.dedupeTtlMs");
                    comfyToast(error?.message || t("setting.watcher.dedupe.error"), "error");
                }
            },
        });

        try {
            syncWatcherRuntimeSettings().catch(() => {});
        } catch {}

        safeAddSetting({
            id: `${SETTINGS_PREFIX}.RatingTagsSync.Enabled`,
            category: cat(t("cat.scanning"), t("setting.sync.rating.name").replace("Majoor: ", "")),
            name: t("setting.sync.rating.name"),
            tooltip: t("setting.sync.rating.desc"),
            type: "boolean",
            defaultValue: !!settings.ratingTagsSync?.enabled,
            onChange: (value) => {
                settings.ratingTagsSync = settings.ratingTagsSync || {};
                settings.ratingTagsSync.enabled = !!value;
                saveMajoorSettings(settings);
                notifyApplied("ratingTagsSync.enabled");
            },
        });

        safeAddSetting({
            id: `${SETTINGS_PREFIX}.Safety.ConfirmDeletion`,
            category: cat(t("cat.security"), "Confirm before deleting"),
            name: "Confirm before deleting",
            tooltip: "Show a confirmation dialog before deleting files. Disabling this allows instant deletion.",
            type: "boolean",
            defaultValue: settings.safety?.confirmDeletion !== false,
            onChange: (value) => {
                settings.safety = settings.safety || {};
                settings.safety.confirmDeletion = !!value;
                saveMajoorSettings(settings);
                applySettingsToConfig(settings);
                notifyApplied("safety.confirmDeletion");
            },
        });

        safeAddSetting({
            id: `${SETTINGS_PREFIX}.Observability.VerboseErrors`,
            category: cat(t("cat.advanced"), "Verbose error logging"),
            name: "Verbose error logging",
            tooltip: "Show detailed error messages in toasts and console. Useful for debugging.",
            type: "boolean",
            defaultValue: !!settings.observability?.verboseErrors,
            onChange: (value) => {
                settings.observability = settings.observability || {};
                settings.observability.verboseErrors = !!value;
                saveMajoorSettings(settings);
                applySettingsToConfig(settings);
                notifyApplied("observability.verboseErrors");
            },
        });

        safeAddSetting({
            id: `${SETTINGS_PREFIX}.Observability.Enabled`,
            category: cat(t("cat.advanced"), t("setting.obs.enabled.name").replace("Majoor: ", "")),
            name: t("setting.obs.enabled.name"),
            tooltip: t("setting.obs.enabled.desc"),
            type: "boolean",
            defaultValue: !!settings.observability?.enabled,
            onChange: (value) => {
                settings.observability = settings.observability || {};
                settings.observability.enabled = !!value;
                saveMajoorSettings(settings);
                applySettingsToConfig(settings);
                notifyApplied("observability.enabled");
            },
        });

        safeAddSetting({
            id: `${SETTINGS_PREFIX}.ProbeBackend.Mode`,
            category: cat(t("cat.advanced"), t("setting.probe.mode.name").replace("Majoor: ", "")),
            name: t("setting.probe.mode.name"),
            tooltip: t("setting.probe.mode.desc") + " (env: MAJOOR_MEDIA_PROBE_BACKEND)",
            type: "combo",
            defaultValue: settings.probeBackend?.mode || DEFAULT_SETTINGS.probeBackend.mode,
            options: ["auto", "exiftool", "ffprobe", "both"],
            onChange: (value) => {
                const mode = _safeOneOf(value, ["auto", "exiftool", "ffprobe", "both"], DEFAULT_SETTINGS.probeBackend.mode);
                settings.probeBackend = settings.probeBackend || {};
                settings.probeBackend.mode = mode;
                saveMajoorSettings(settings);
                applySettingsToConfig(settings);
                notifyApplied("probeBackend.mode");
                setProbeBackendMode(mode).catch(() => {});
            },
        });

        const registerMinimapToggle = (idKey, stateKey, nameKey, descKey) => {
            safeAddSetting({
                id: `${SETTINGS_PREFIX}.WorkflowMinimap.${idKey}`,
                category: cat(t("cat.viewer"), t(nameKey).replace("Majoor: ", "")),
                name: t(nameKey),
                tooltip: t(descKey),
                type: "boolean",
                defaultValue: !!settings.workflowMinimap?.[stateKey],
                onChange: (value) => {
                    settings.workflowMinimap = settings.workflowMinimap || {};
                    settings.workflowMinimap[stateKey] = !!value;
                    saveMajoorSettings(settings);
                    notifyApplied(`workflowMinimap.${stateKey}`);
                },
            });
        };

        registerMinimapToggle("Enabled", "enabled", "setting.minimap.enabled.name", "setting.minimap.enabled.desc");

        safeAddSetting({
            id: `${SETTINGS_PREFIX}.Security.ApiToken`,
            category: cat(t("cat.remote"), t("setting.sec.token.name").replace("Majoor: ", "")),
            name: t("setting.sec.token.name", "Majoor: API Token"),
            tooltip: t(
                "setting.sec.token.desc",
                "Store the API token used for write operations. Majoor sends it via X-MJR-Token and Authorization headers."
            ),
            type: "text",
            defaultValue: settings.security?.apiToken || "",
            attrs: {
                placeholder: t("setting.sec.token.placeholder", "Leave blank to disable."),
            },
            onChange: (value) => {
                settings.security = settings.security || {};
                settings.security.apiToken = typeof value === "string" ? value.trim() : "";
                saveMajoorSettings(settings);
                notifyApplied("security.apiToken");
            },
        });

        const registerSecurityToggle = (key, nameKey, descKey, sectionKey = "cat.security") => {
            safeAddSetting({
                id: `${SETTINGS_PREFIX}.Security.${key}`,
                category: cat(t(sectionKey), t(nameKey).replace("Majoor: ", "")),
                name: t(nameKey),
                tooltip: t(descKey),
                type: "boolean",
                defaultValue: !!settings.security?.[key],
                onChange: (value) => {
                    settings.security = settings.security || {};
                    settings.security[key] = !!value;
                    saveMajoorSettings(settings);
                    notifyApplied(`security.${key}`);
                    try {
                        const sec = settings.security || {};
                        setSecuritySettings({
                            safe_mode: _safeBool(sec.safeMode, false),
                            allow_write: _safeBool(sec.allowWrite, true),
                            allow_remote_write: _safeBool(sec.allowRemoteWrite, true),
                            allow_delete: _safeBool(sec.allowDelete, true),
                            allow_rename: _safeBool(sec.allowRename, true),
                            allow_open_in_folder: _safeBool(sec.allowOpenInFolder, true),
                            allow_reset_index: _safeBool(sec.allowResetIndex, false),
                        })
                            .then((res) => {
                                if (res?.ok && res.data?.prefs) {
                                    syncBackendSecuritySettings();
                                } else if (res && res.ok === false) {
                                    console.warn("[Majoor] backend security settings update failed", res.error || res);
                                }
                            })
                            .catch(() => {});
                    } catch {}
                },
            });
        };

        registerSecurityToggle("safeMode", "setting.sec.safe.name", "setting.sec.safe.desc");
        registerSecurityToggle(
            "allowRemoteWrite",
            "setting.sec.remote.name",
            "setting.sec.remote.desc",
            "cat.remote"
        );
        registerSecurityToggle("allowWrite", "setting.sec.write.name", "setting.sec.write.desc");
        registerSecurityToggle("allowDelete", "setting.sec.del.name", "setting.sec.del.desc");
        registerSecurityToggle("allowRename", "setting.sec.ren.name", "setting.sec.ren.desc");
        registerSecurityToggle("allowOpenInFolder", "setting.sec.open.name", "setting.sec.open.desc");
        registerSecurityToggle("allowResetIndex", "setting.sec.reset.name", "setting.sec.reset.desc");

        // Language setting
        const languages = getSupportedLanguages();
        const langOptions = languages.map(l => l.code);
        safeAddSetting({
            id: `${SETTINGS_PREFIX}.Language`,
            category: cat(t("cat.advanced"), t("setting.language.name", "Language")),
            name: t("setting.language.name", "Majoor: Language"),
            tooltip: t("setting.language.desc", "Choose the language for the Assets Manager interface. Reload required to fully apply."),
            type: "combo",
            defaultValue: getCurrentLang(),
            options: langOptions,
            onChange: (value) => {
                if (langOptions.includes(value)) {
                    setLang(value);
                    notifyApplied("language");
                    // Toast removed: no notification on language change
                }
            },
        });

        safeAddSetting({
            id: `${SETTINGS_PREFIX}.EnvVars.Reference`,
            category: cat(t("cat.advanced"), "Environment variables"),
            name: "Environment variables reference",
            tooltip: [
                "Set these env vars before starting ComfyUI to override defaults:",
                "",
                "MAJOOR_OUTPUT_DIRECTORY — Override output root directory",
                "MAJOOR_EXIFTOOL_PATH — Path to exiftool binary",
                "MAJOOR_FFPROBE_PATH — Path to ffprobe binary",
                "MAJOOR_MEDIA_PROBE_BACKEND — Probe mode: auto|exiftool|ffprobe|both",
                "MAJOOR_EXIFTOOL_TIMEOUT — ExifTool timeout in seconds (default: 15)",
                "MAJOOR_FFPROBE_TIMEOUT — FFprobe timeout in seconds (default: 10)",
                "MAJOOR_DB_TIMEOUT — Database timeout in seconds (default: 30)",
                "MAJOOR_DB_MAX_CONNECTIONS — Max DB connections (default: 8)",
                "MAJOOR_METADATA_CACHE_MAX — Metadata cache max entries (default: 100000)",
                "MAJOOR_METADATA_EXTRACT_CONCURRENCY — Parallel metadata workers (default: 1)",
                "MJR_ENABLE_WATCHER — Enable file watcher: 1|0 (default: 1)",
                "MJR_WATCHER_DEBOUNCE_MS — Watcher debounce delay in ms (default: 500)",
                "MJR_WATCHER_DEDUPE_TTL_MS — Watcher dedupe window in ms (default: 3000)",
                "MJR_WATCHER_MAX_FILE_SIZE_BYTES — Max file size to index (default: 512MB)",
                "MJR_WATCHER_FLUSH_MAX_FILES — Max files per flush batch (default: 256)",
                "MJR_WATCHER_PENDING_MAX — Max pending watcher queue (default: 5000)",
                "MAJOOR_SEARCH_MAX_LIMIT — Max search results (default: 500)",
                "MAJOOR_BG_SCAN_ON_LIST — Scan on directory list: 0|1 (default: 0)",
            ].join("\n"),
            type: "text",
            defaultValue: "Hover for full list of environment variables",
        });

        try {
            settingsApi[SETTINGS_REG_FLAG] = true;
        } catch {}

        return true;
    };

    if (!tryRegister()) {
        try {
            const maxAttempts = 30;
            const delayMs = 250;
            let attempts = 0;
            const tick = () => {
                attempts += 1;
                if (tryRegister()) return;
                if (attempts >= maxAttempts) return;
                setTimeout(tick, delayMs);
            };
            setTimeout(tick, delayMs);
        } catch {}
    }

    // Best-effort: apply watcher state to backend to match saved settings.
    try {
        const desired = !!settings?.watcher?.enabled;
        setTimeout(() => {
            toggleWatcher(desired).catch(() => {});
        }, 0);
    } catch {}

    return settings;
};

// Best-effort backend sync (watcher status) at startup.
try {
    const settings = loadMajoorSettings();
    if (settings?.watcher && typeof settings.watcher.enabled === "boolean") {
        getWatcherStatus()
            .then((res) => {
                const enabled = !!res?.ok && !!res?.data?.enabled;
                if (typeof enabled === "boolean" && enabled !== !!settings.watcher.enabled) {
                    settings.watcher.enabled = enabled;
                    saveMajoorSettings(settings);
                    safeDispatchCustomEvent("mjr-settings-changed", { key: "watcher.enabled" }, { warnPrefix: "[Majoor]" });
                }
            })
            .catch(() => {});
    }
} catch {}
