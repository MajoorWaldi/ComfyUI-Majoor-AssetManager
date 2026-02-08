import { normalizeQuery } from "./query.js";

const _safeSetValue = (el, value) => {
    if (!el) return;
    try {
        el.value = value;
    } catch {}
};

const _safeSetChecked = (el, checked) => {
    if (!el) return;
    try {
        el.checked = !!checked;
    } catch {}
};

export function createContextController({
    state,
    gridContainer,
    filterBtn,
    sortBtn,
    collectionsBtn,
    searchInputEl,
    kindSelect,
    wfCheckbox,
    ratingSelect,
    dateRangeSelect,
    dateExactInput,
    scopeController,
    sortController,
    updateSummaryBar,
    reloadGrid,
    extraActions = null,
    getExtraContext = null
} = {}) {
    const actions = {
        clearQuery: async () => {
            try {
                _safeSetValue(searchInputEl, "");
                state.searchQuery = "";
            } catch {}
            try {
                await reloadGrid?.();
            } catch {}
        },
        clearCollection: async () => {
            try {
                state.collectionId = "";
                state.collectionName = "";
            } catch {}
            try {
                await reloadGrid?.();
            } catch {}
        },
        clearScope: async () => {
            let didSetScope = false;
            try {
                state.customRootId = "";
                state.subfolder = "";
                delete gridContainer?.dataset?.mjrSubfolder;
                if (typeof scopeController?.setScope === "function") {
                    await scopeController.setScope("output");
                    didSetScope = true;
                } else {
                    state.scope = "output";
                    scopeController?.setActiveTabStyles?.();
                }
            } catch {}
            try {
                if (!didSetScope) await reloadGrid?.();
            } catch {}
        },
        clearCustomRoot: async () => {
            let didSetScope = false;
            try {
                state.customRootId = "";
                if (String(state.scope || "").toLowerCase() === "custom") {
                    if (typeof scopeController?.setScope === "function") {
                        await scopeController.setScope("output");
                        didSetScope = true;
                    } else {
                        state.scope = "output";
                        scopeController?.setActiveTabStyles?.();
                    }
                }
            } catch {}
            try {
                if (!didSetScope) await reloadGrid?.();
            } catch {}
        },
        clearFolder: async () => {
            try {
                // Ensure state is cleared so it doesn't get restored
                state.subfolder = ""; 
                delete gridContainer?.dataset?.mjrSubfolder;
            } catch {}
            try {
                await reloadGrid?.();
            } catch {}
        },
        clearKind: async () => {
            try {
                state.kindFilter = "";
                _safeSetValue(kindSelect, "");
            } catch {}
            try {
                await reloadGrid?.();
            } catch {}
        },
        clearMinRating: async () => {
            try {
                state.minRating = 0;
                _safeSetValue(ratingSelect, "0");
            } catch {}
            try {
                await reloadGrid?.();
            } catch {}
        },
        clearWorkflowOnly: async () => {
            try {
                state.workflowOnly = false;
                _safeSetChecked(wfCheckbox, false);
            } catch {}
            try {
                await reloadGrid?.();
            } catch {}
        },
        clearDateRange: async () => {
            try {
                state.dateRangeFilter = "";
                _safeSetValue(dateRangeSelect, "");
            } catch {}
            try {
                await reloadGrid?.();
            } catch {}
        },
        clearDateExact: async () => {
            try {
                state.dateExactFilter = "";
                _safeSetValue(dateExactInput, "");
            } catch {}
            try {
                await reloadGrid?.();
            } catch {}
        },
        clearSort: async () => {
            try {
                state.sort = "mtime_desc";
                sortController?.setSortIcon?.(state.sort);
                sortController?.renderSortMenu?.();
            } catch {}
            try {
                await reloadGrid?.();
            } catch {}
        },
        clearAll: async () => {
            let didSetScope = false;
            try {
                _safeSetValue(searchInputEl, "");
            } catch {}
            try {
                state.collectionId = "";
                state.collectionName = "";
                state.kindFilter = "";
                state.workflowOnly = false;
                state.minRating = 0;
                state.dateRangeFilter = "";
                state.dateExactFilter = "";
                state.sort = "mtime_desc";
                state.customRootId = "";
                state.subfolder = "";
                delete gridContainer?.dataset?.mjrSubfolder;
                if (typeof scopeController?.setScope === "function") {
                    await scopeController.setScope("output");
                    didSetScope = true;
                } else {
                    state.scope = "output";
                    scopeController?.setActiveTabStyles?.();
                }
            } catch {}
            try {
                _safeSetValue(kindSelect, "");
                _safeSetChecked(wfCheckbox, false);
                _safeSetValue(ratingSelect, "0");
                _safeSetValue(dateRangeSelect, "");
                _safeSetValue(dateExactInput, "");
            } catch {}
            try {
                sortController?.setSortIcon?.(state.sort);
                sortController?.renderSortMenu?.();
            } catch {}
            try {
                if (!didSetScope) await reloadGrid?.();
            } catch {}
        }
    };
    if (extraActions && typeof extraActions === "object") {
        try {
            Object.assign(actions, extraActions);
        } catch {}
    }

    const update = () => {
        const rawQuery = String(searchInputEl?.value || "").trim();
        const normalizedQuery = normalizeQuery(searchInputEl);

        const filterActive = !!(
            (state?.kindFilter || "")
            || state?.workflowOnly
            || (Number(state?.minRating || 0) || 0) > 0
            || (state?.dateRangeFilter || "")
            || (state?.dateExactFilter || "")
        );
        const sortActive = String(state?.sort || "mtime_desc") !== "mtime_desc";
        const collectionsActive = !!(state?.collectionId || "");

        try {
            filterBtn?.classList?.toggle?.("mjr-context-active", filterActive);
            sortBtn?.classList?.toggle?.("mjr-context-active", sortActive);
            collectionsBtn?.classList?.toggle?.("mjr-context-active", collectionsActive);
        } catch {}

        try {
            const extraContext = (typeof getExtraContext === "function" ? (getExtraContext() || {}) : {}) || {};
            updateSummaryBar?.({
                state,
                gridContainer,
                context: { rawQuery: rawQuery || normalizedQuery, ...extraContext },
                actions
            });
        } catch {}
    };

    return { update, actions };
}

