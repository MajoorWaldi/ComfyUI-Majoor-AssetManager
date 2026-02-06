import { get } from "../api/client.js";
import { ENDPOINTS } from "../api/endpoints.js";
import { comfyToast } from "./toast.js";

export const VERSION_UPDATE_EVENT = "mjr:version-update-available";
export const VERSION_UPDATE_STATE_KEY = "__MJR_VERSION_UPDATE_STATE__";
const LATEST_RELEASE_URL = "https://api.github.com/repos/MajoorWaldi/ComfyUI-Majoor-AssetsManager/releases/latest";
const LAST_CHECK_KEY = "majoor_last_update_check";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

let _versionUpdateState = { available: false, timestamp: Date.now() };

function normalizeVersion(value) {
    if (!value) return "";
    return String(value).trim().replace(/^v/i, "");
}

function parseVersionSegments(value) {
    return String(value || "")
        .split(".")
        .map((part) => {
            const num = Number(part);
            if (Number.isFinite(num)) return Math.max(0, Math.trunc(num));
            return 0;
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
    _versionUpdateState = { ...(state || {}), timestamp: Date.now() };
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

    if (!localVersion || localVersion.toLowerCase() === "nightly" || branch === "nightly") {
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
            summary: "Majoor Assets Manager",
            detail: `Mise à jour disponible : ${remoteVersion} (Actuel : ${localVersion})`
        },
        "info",
        10000
    );

    return { current: localVersion, latest: remoteVersion };
}
