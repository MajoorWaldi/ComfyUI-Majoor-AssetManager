export function createViewerMetadataHydrator({
    state,
    VIEWER_MODES,
    APP_CONFIG,
    getAssetMetadata,
    getAssetsBatch,
} = {}) {
    const noop = () => {};
    const safeCall = (fn) => {
        try {
            return fn?.();
        } catch {
            return undefined;
        }
    };

    // Metadata hydration cache for viewer-visible assets (so rating/tags show even if the grid
    // passed a lightweight asset object).
    const cache = new Map(); // id -> { at:number, data:any }
    const TTL_MS = APP_CONFIG?.VIEWER_META_TTL_MS ?? 30_000;
    const MAX_ENTRIES = APP_CONFIG?.VIEWER_META_MAX_ENTRIES ?? 500;

    // Track hydration requests to prevent race conditions
    let requestId = 0;
    let abortController = null;

    const cleanupCache = () => {
        if (cache.size <= MAX_ENTRIES) return;
        const now = Date.now();

        // Remove expired entries first.
        try {
            for (const [key, value] of cache.entries()) {
                if (!value) continue;
                if (now - (value.at || 0) > TTL_MS) {
                    cache.delete(key);
                }
            }
        } catch {}

        if (cache.size <= MAX_ENTRIES) return;
        // Still too large: remove oldest by timestamp.
        try {
            const sorted = Array.from(cache.entries()).sort((a, b) => (a?.[1]?.at || 0) - (b?.[1]?.at || 0));
            const excess = cache.size - MAX_ENTRIES;
            for (let i = 0; i < excess; i++) {
                const key = sorted[i]?.[0];
                if (key != null) cache.delete(key);
            }
        } catch {}
    };

    const applyToAsset = (asset, meta) => {
        if (!asset || !meta || typeof meta !== "object") return;
        try {
            if (meta.rating !== undefined) asset.rating = meta.rating;
        } catch {}
        try {
            if (meta.tags !== undefined) asset.tags = meta.tags;
        } catch {}
    };

    const hydrateAssetsMetadataBatch = async (assets, { signal } = {}) => {
        const list = Array.isArray(assets) ? assets : [];
        const now = Date.now();
        const toFetch = [];
        for (const asset of list) {
            const id = asset?.id;
            if (id == null) continue;
            const key = String(id);
            const cached = cache.get(key);
            if (cached && now - (cached.at || 0) < TTL_MS) {
                applyToAsset(asset, cached.data);
                continue;
            }
            toFetch.push(id);
        }
        if (!toFetch.length) return;

        try {
            const res = await getAssetsBatch?.(toFetch, signal ? { signal } : {});
            const items = Array.isArray(res?.data) ? res.data : [];
            for (const meta of items) {
                const id = meta?.id;
                if (id == null) continue;
                const key = String(id);
                cache.set(key, { at: now, data: meta });
            }
            cleanupCache();
            // Apply to local asset objects
            for (const asset of list) {
                const id = asset?.id;
                if (id == null) continue;
                const cached = cache.get(String(id));
                if (cached && cached.data) applyToAsset(asset, cached.data);
            }
        } catch {}
    };

    const hydrateAssetMetadata = async (asset, { signal } = {}) => {
        const id = asset?.id;
        if (id == null) return;
        const key = String(id);
        const now = Date.now();
        const cached = cache.get(key);
        if (cached && now - (cached.at || 0) < TTL_MS) {
            applyToAsset(asset, cached.data);
            return;
        }
        try {
            const res = await getAssetMetadata?.(id, signal ? { signal } : {});
            if (res?.ok && res.data) {
                cache.set(key, { at: now, data: res.data });
                cleanupCache();
                applyToAsset(asset, res.data);
            }
        } catch {}
    };

    const hydrateVisibleMetadata = async () => {
        const current = state?.assets?.[state?.currentIndex];
        const compare = state?.compareAsset;
        const mode = state?.mode;

        // Increment request ID to invalidate previous requests
        const thisId = ++requestId;

        try {
            abortController?.abort?.();
        } catch {}
        abortController = new AbortController();
        const signal = abortController.signal;

        try {
            if (mode === VIEWER_MODES?.SINGLE) {
                if (current) await hydrateAssetsMetadataBatch([current], { signal });
                if (thisId !== requestId) return;
                return;
            }

            const visible = Array.isArray(state?.assets) ? state.assets.slice(0, 4) : [];
            const batch = visible.slice();
            if (compare) batch.push(compare);
            await hydrateAssetsMetadataBatch(batch, { signal });
        } catch {}
    };

    return {
        hydrateVisibleMetadata,
        hydrateAssetMetadata,
        hydrateAssetsMetadataBatch,
        getCached: (assetId) => {
            try {
                return cache.get(String(assetId));
            } catch {
                return null;
            }
        },
        setCached: (assetId, data) => {
            try {
                cache.set(String(assetId), { at: Date.now(), data });
                cleanupCache();
            } catch {}
        },
        deleteCached: (assetId) => {
            try {
                cache.delete(String(assetId));
            } catch {}
        },
        abort: () => {
            safeCall(() => abortController?.abort?.());
            abortController = null;
        },
        dispose: () => {
            safeCall(() => abortController?.abort?.());
            abortController = null;
            safeCall(() => cache.clear());
        },
        cleanupCache: () => safeCall(cleanupCache) || undefined,
        _unsafeCache: cache,
        _noop: noop,
    };
}

