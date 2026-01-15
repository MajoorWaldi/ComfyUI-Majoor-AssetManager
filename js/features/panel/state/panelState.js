export function createPanelState() {
    return {
        scope: "output",
        customRootId: "",
        collectionId: "",
        collectionName: "",
        kindFilter: "",
        dateRangeFilter: "",
        dateExactFilter: "",
        workflowOnly: false,
        minRating: 0,
        sort: "mtime_desc",
        // Last grid load stats (best-effort; used by UI summary bar).
        lastGridCount: 0,
        lastGridTotal: 0,
        // Selection state (source of truth) for durable selection across grid re-renders.
        // Stored as strings because DOM dataset values are strings.
        activeAssetId: "",
        selectedAssetIds: []
    };
}
