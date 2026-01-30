import { APP_CONFIG } from "../../app/config.js";

const _debug = () => {
    try {
        return Boolean(APP_CONFIG?.DEBUG_VIEWER);
    } catch {
        return false;
    }
};

/**
 * Sync a set of follower videos to a leader (one-way). Useful for compare modes where
 * the viewer bar controls a single "active" video.
 *
 * Must never throw. Returns an AbortController to remove listeners.
 */
export function installFollowerVideoSync(leader, followers, { threshold = 0.15 } = {}) {
    const ac = new AbortController();
    try {
        if (!leader) return ac;
        const list = Array.isArray(followers) ? followers.filter((v) => v && v !== leader) : [];
        if (!list.length) return ac;

        let syncing = false;

        const tryPlay = (v) => {
            try {
                const p = v.play?.();
                if (p && typeof p.catch === "function") p.catch(() => {});
            } catch {}
        };

        const syncTimeToLeader = () => {
            if (syncing) return;
            try {
                const t = Number(leader.currentTime) || 0;
                for (const f of list) {
                    try {
                        if (Math.abs((Number(f.currentTime) || 0) - t) > threshold) {
                            syncing = true;
                            f.currentTime = t;
                            syncing = false;
                        }
                    } catch {
                        syncing = false;
                    }
                }
            } catch {
                syncing = false;
            }
        };

        const syncPlayState = (playing) => {
            if (syncing) return;
            for (const f of list) {
                try {
                    if (playing) tryPlay(f);
                    else f.pause?.();
                } catch {}
            }
        };

        const syncVolume = () => {
            if (syncing) return;
            for (const f of list) {
                try {
                    f.muted = Boolean(leader.muted);
                    f.volume = Number(leader.volume) || 0;
                } catch {}
            }
        };

        const syncRate = () => {
            if (syncing) return;
            for (const f of list) {
                try {
                    f.playbackRate = Number(leader.playbackRate) || 1;
                } catch {}
            }
        };

        // Keep followers quiet and prevent native loop fighting the viewer bar loop logic.
        try {
            for (const f of list) {
                try {
                    f.muted = true;
                } catch {}
                try {
                    f.loop = false;
                } catch {}
            }
        } catch {}

        // Initial sync (best-effort).
        try {
            syncVolume();
            syncRate();
            syncTimeToLeader();
            if (!leader.paused) syncPlayState(true);
        } catch {}

        leader.addEventListener("play", () => syncPlayState(true), { signal: ac.signal, passive: true });
        leader.addEventListener("pause", () => syncPlayState(false), { signal: ac.signal, passive: true });
        leader.addEventListener("timeupdate", syncTimeToLeader, { signal: ac.signal, passive: true });
        leader.addEventListener("seeking", syncTimeToLeader, { signal: ac.signal, passive: true });
        leader.addEventListener("seeked", syncTimeToLeader, { signal: ac.signal, passive: true });
        leader.addEventListener("ended", syncTimeToLeader, { signal: ac.signal, passive: true });
        leader.addEventListener("volumechange", syncVolume, { signal: ac.signal, passive: true });
        leader.addEventListener("ratechange", syncRate, { signal: ac.signal, passive: true });

        // Followers can reach "ended" and pause (we disable native looping on followers).
        // Ensure they keep looping in sync with the controlled leader.
        try {
            for (const f of list) {
                try {
                    f.addEventListener(
                        "ended",
                        () => {
                            if (syncing) return;
                            try {
                                syncing = true;
                                f.currentTime = Number(leader.currentTime) || 0;
                            } catch {} finally {
                                syncing = false;
                            }
                            try {
                                if (!leader.paused) tryPlay(f);
                            } catch {}
                        },
                        { signal: ac.signal, passive: true }
                    );
                } catch {}
            }
        } catch {}

        // Followers might load later; resync once metadata is ready.
        try {
            for (const f of list) {
                try {
                    f.addEventListener("loadedmetadata", syncTimeToLeader, { signal: ac.signal, passive: true, once: true });
                } catch {}
            }
        } catch {}
    } catch (e) {
        if (_debug()) {
            try {
                console.warn("[Viewer] follower video sync setup failed", e);
            } catch {}
        }
    }
    return ac;
}
