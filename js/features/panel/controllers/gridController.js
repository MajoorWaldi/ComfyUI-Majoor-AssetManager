import { t } from "../../../app/i18n.js";

export function createGridController({ gridContainer, loadAssets, loadAssetsFromList, getCollectionAssets, disposeGrid, getQuery, state }) {
    let _isReloading = false;
    let _pendingReload = false;

    const runReloadOnce = async () => {
        // Expose the current query on the container so external listeners (ComfyUI executed events)
        // can decide whether to do incremental upserts or avoid disrupting an active search.
        try {
            gridContainer.dataset.mjrQuery = String(getQuery?.() ?? "*") || "*";
        } catch {}
        gridContainer.dataset.mjrScope = state.scope;
        gridContainer.dataset.mjrCustomRootId = state.customRootId || "";
        gridContainer.dataset.mjrSubfolder = state.subfolder || "";
        gridContainer.dataset.mjrFilterKind = state.kindFilter || "";
        gridContainer.dataset.mjrFilterWorkflowOnly = state.workflowOnly ? "1" : "0";
        gridContainer.dataset.mjrFilterMinRating = String(state.minRating || 0);
        gridContainer.dataset.mjrFilterDateRange = state.dateRangeFilter || "";
        gridContainer.dataset.mjrFilterDateExact = state.dateExactFilter || "";
        gridContainer.dataset.mjrSort = state.sort || "mtime_desc";

        // Keep selection durable across re-renders by persisting it in the dataset
        // (GridView re-applies selection as cards are created).
        try {
            const selected = Array.isArray(state.selectedAssetIds) ? state.selectedAssetIds.filter(Boolean).map(String) : [];
            if (selected.length) {
                gridContainer.dataset.mjrSelectedAssetIds = JSON.stringify(selected);
                gridContainer.dataset.mjrSelectedAssetId = String(state.activeAssetId || selected[0] || "");
            } else {
                delete gridContainer.dataset.mjrSelectedAssetIds;
                delete gridContainer.dataset.mjrSelectedAssetId;
            }
        } catch {}

        if (state.scope === "custom" && !state.customRootId) {
            try {
                disposeGrid(gridContainer);
            } catch {}
            gridContainer.replaceChildren();
            const p = document.createElement("p");
            p.className = "mjr-muted";
            p.textContent = t("msg.addCustomFolder");
            gridContainer.appendChild(p);
            try {
                state.lastGridCount = 0;
                state.lastGridTotal = 0;
                gridContainer.dispatchEvent?.(new CustomEvent("mjr:grid-stats", { detail: { count: 0, total: 0 } }));
            } catch {}
            return;
        }

        if (state.collectionId) {
            const res = await getCollectionAssets?.(state.collectionId);
            if (res?.ok && res.data && Array.isArray(res.data.assets)) {
                const title = state.collectionName ? `Collection: ${state.collectionName}` : "Collection";
                const result = await loadAssetsFromList(gridContainer, res.data.assets, { title, reset: true });
                try {
                    state.lastGridCount = Number(result?.count || 0) || 0;
                    state.lastGridTotal = Number(result?.total || 0) || 0;
                    gridContainer.dispatchEvent?.(new CustomEvent("mjr:grid-stats", { detail: result || {} }));
                } catch {}
                return;
            }
            // If collection fetch fails, fall back to normal loading and clear the broken state.
            state.collectionId = "";
            state.collectionName = "";
        }

        const result = await loadAssets(gridContainer, getQuery());
        try {
            state.lastGridCount = Number(result?.count || 0) || 0;
            state.lastGridTotal = Number(result?.total || 0) || 0;
            gridContainer.dispatchEvent?.(new CustomEvent("mjr:grid-stats", { detail: result || {} }));
        } catch {}
    };

    const reloadGrid = async () => {
        _pendingReload = true;
        if (_isReloading) return;
        _isReloading = true;
        try {
            while (_pendingReload) {
                _pendingReload = false;
                await runReloadOnce();
            }
        } finally {
            _isReloading = false;
        }
    };

    return { reloadGrid };
}
