const STORAGE_KEY = "mjr_panel_state";
let _lastSavedSerialized = "";

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
        const serialized = JSON.stringify(toSave);
        if (serialized === _lastSavedSerialized) return;
        _lastSavedSerialized = serialized;
        localStorage.setItem(STORAGE_KEY, serialized);
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
    
    let debounceTimer = null;
    const debouncedSave = (targetState) => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            savePanelState(targetState);
            debounceTimer = null;
        }, 750);
    };

    const storageHandler = (event) => {
        if (!event) return;
        if (event.key !== STORAGE_KEY) return;
        if (!event.newValue) return;
        try {
            const updated = JSON.parse(event.newValue);
            Object.assign(state, updated || {});
        } catch {}
    };
    try {
        window.addEventListener("storage", storageHandler);
    } catch {}

    return new Proxy(state, {
        set(target, prop, value) {
            target[prop] = value;
            debouncedSave(target);
            return true;
        }
    });
}
