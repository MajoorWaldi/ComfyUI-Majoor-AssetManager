import { get } from "../api/client.js";
import { ENDPOINTS } from "../api/endpoints.js";
import { comfyToast } from "./toast.js";
import { comfyAlert } from "./dialogs.js";
import { t } from "./i18n.js";

export const VERSION_UPDATE_EVENT = "mjr:version-update-available";
export const VERSION_UPDATE_STATE_KEY = "__MJR_VERSION_UPDATE_STATE__";
const LATEST_RELEASE_URL = "https://api.github.com/repos/MajoorWaldi/ComfyUI-Majoor-AssetsManager/releases/latest";
const LAST_CHECK_KEY = "majoor_last_update_check";
const DB_RESET_NOTICE_VERSION_KEY = "majoor_db_reset_notice_version";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

let _versionUpdateState = { available: false, timestamp: Date.now() };

function normalizeVersion(value) {
    if (!value) return "";
    return String(value).trim().replace(/^v/i, "");
}

/**
 * Check whether a version/branch should be treated as nightly/dev build.
 */
function isNightly(version, branch) {
    const v = String(version || "").trim().toLowerCase();
    const b = String(branch || "").trim().toLowerCase();
    const nightlyKeywords = ["nightly", "dev", "alpha", "experimental"];
    const hasNightlyKeyword = nightlyKeywords.some((kw) => v.includes(kw) || b.includes(kw));

    // Examples: 1.2.0+a1b2c3d, 6432abc, deadbeef...
    const hasCommitHash = v.includes("+") || (v.length > 10 && /^[a-f0-9]+$/i.test(v));

    return hasNightlyKeyword || hasCommitHash;
}

function parseVersionSegments(value) {
    return String(value || "")
        .split("-")[0]
        .split(".")
        .map((part) => {
            const num = parseInt(part, 10);
            return Number.isFinite(num) ? Math.max(0, num) : 0;
        });
}

function isNewerVersion(remote, local) {
    if (!remote || !local) return false;
    const remoteParts = parseVersionSegments(remote);
    const localParts = parseVersionSegments(local);
    const length = Math.max(remoteParts.length, localParts.length);
    for (let i = 0; i < length; i += 1) {
        const remoteValue = Number.isFinite(remoteParts[i]) ? remoteParts[i] : 0;
        const localValue = Number.isFinite(localParts[i]) ? localParts[i] : 0;
        if (remoteValue > localValue) return true;
        if (remoteValue < localValue) return false;
    }
    return false;
}

async function fetchLatestReleaseVersion() {
    const response = await fetch(LATEST_RELEASE_URL, {
        cache: "no-cache",
        headers: {
            Accept: "application/vnd.github+json",
        },
    });
    if (!response.ok) {
        throw new Error(`GitHub release request failed (${response.status})`);
    }
    const payload = await response.json().catch(() => null);
    if (!payload || typeof payload !== "object") {
        throw new Error("GitHub release returned invalid payload");
    }
    return normalizeVersion(payload.tag_name);
}

function emitVersionUpdateState(state) {
    _versionUpdateState = { ...state, timestamp: Date.now() };
    const w = typeof window !== "undefined" ? window : null;
    if (w) {
        try {
            w[VERSION_UPDATE_STATE_KEY] = _versionUpdateState;
        } catch {}
        try {
            w.dispatchEvent(new CustomEvent(VERSION_UPDATE_EVENT, { detail: _versionUpdateState }));
        } catch {}
    }
}

export function getStoredVersionUpdateState() {
    return _versionUpdateState;
}

emitVersionUpdateState({ available: false });

export async function checkMajoorVersion({ force = false } = {}) {
    if (typeof window === "undefined" || !window.localStorage) {
        return null;
    }

    try {
        if (!force) {
            const lastCheck = Number(window.localStorage.getItem(LAST_CHECK_KEY) || 0);
            if (Number.isFinite(lastCheck) && Date.now() - lastCheck < CHECK_INTERVAL_MS) {
                return null;
            }
        }
    } catch {
        // localStorage might be disabled; continue without caching
    }

    let localVersion = "";
    let branch = "";
    try {
        const result = await get(ENDPOINTS.VERSION);
        if (!result?.ok) {
            emitVersionUpdateState({ available: false });
            return null;
        }
        localVersion = normalizeVersion(result.data?.version);
        branch = String(result.data?.branch || "").trim().toLowerCase();
    } catch {
        emitVersionUpdateState({ available: false });
        return null;
    }

    if (!localVersion || isNightly(localVersion, branch)) {
        console.log("Majoor: Nightly/development build detected. Skipping update check.");
        emitVersionUpdateState({ available: false });
        return null;
    }

    let remoteVersion = "";
    try {
        remoteVersion = await fetchLatestReleaseVersion();
    } catch (error) {
        console.warn("Impossible de vérifier les mises à jour Majoor :", error);
        emitVersionUpdateState({ available: false });
        return null;
    } finally {
        try {
            window.localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
        } catch {
            // ignore
        }
    }

    if (!remoteVersion || !isNewerVersion(remoteVersion, localVersion)) {
        emitVersionUpdateState({ available: false });
        return null;
    }

    emitVersionUpdateState({
        available: true,
        current: localVersion,
        latest: remoteVersion,
    });

    comfyToast(
        {
            summary: t("msg.newVersionTitle", "Majoor Assets Manager"),
            detail: t("msg.newVersionDetail", "New version available: {latest} (Current: {current})", {
                latest: remoteVersion,
                current: localVersion,
            }),
        },
        "info",
        10000
    );

    try {
        const alreadyShownFor = String(window.localStorage.getItem(DB_RESET_NOTICE_VERSION_KEY) || "").trim();
        if (alreadyShownFor !== remoteVersion) {
            setTimeout(() => {
                comfyAlert(
                    t(
                        "msg.dbResetNotice",
                        "Majoor Update Notice:\n\nTo avoid database errors with this new version, please delete your existing index. Click the 'Delete DB' button in the Index Status panel to reset it."
                    )
                );
            }, 1000);
            try {
                window.localStorage.setItem(DB_RESET_NOTICE_VERSION_KEY, remoteVersion);
            } catch {}
        }
    } catch {}


    return { current: localVersion, latest: remoteVersion };
}
