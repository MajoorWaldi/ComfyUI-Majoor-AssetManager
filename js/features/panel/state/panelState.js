const STORAGE_KEY = "mjr_panel_state";

function loadPanelState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw);
    } catch {}
    return null;
}

function savePanelState(state) {
    try {
        const toSave = { ...state };
        // Don't persist transient stats
        delete toSave.lastGridCount;
        delete toSave.lastGridTotal;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch {}
}

export function createPanelState() {
    const saved = loadPanelState() || {};
    
    const state = {
        scope: saved.scope || "output",
        customRootId: saved.customRootId || "",
        subfolder: saved.subfolder || "",
        collectionId: saved.collectionId || "",
        collectionName: saved.collectionName || "",
        kindFilter: saved.kindFilter || "",
        dateRangeFilter: saved.dateRangeFilter || "",
        dateExactFilter: saved.dateExactFilter || "",
        workflowOnly: saved.workflowOnly || false,
        minRating: saved.minRating || 0,
        sort: saved.sort || "mtime_desc",
        // Search query and scroll position persistence
        searchQuery: saved.searchQuery || "",
        scrollTop: saved.scrollTop || 0,
        
        // Last grid load stats (best-effort; used by UI summary bar).
        lastGridCount: 0,
        lastGridTotal: 0,
        // Selection state (source of truth) for durable selection across grid re-renders.
        // Stored as strings because DOM dataset values are strings.
        activeAssetId: saved.activeAssetId || "",
        selectedAssetIds: saved.selectedAssetIds || []
    };
    
    return new Proxy(state, {
        set(target, prop, value) {
            target[prop] = value;
            // Debounce save (optional, but reliable enough without for now)
            savePanelState(target);
            return true;
        }
    });
}
