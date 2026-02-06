export function createScopeController({ state, tabButtons, customMenuBtn, customPopover, popovers, refreshCustomRoots, reloadGrid, onChanged = null, onScopeChanged = null }) {
    const setActiveTabStyles = () => {
        const buttons = Object.values(tabButtons || {});
        buttons.forEach((b) => {
            const scope = b?.dataset?.scope;
            const active = scope === state.scope;
            b?.classList?.toggle?.("is-active", active);
        });

        customMenuBtn.style.display = state.scope === "custom" ? "inline-flex" : "none";
        if (state.scope !== "custom") {
            customPopover.style.display = "none";
            popovers.close(customPopover);
        }
    };

    const setScope = async (scope) => {
        const allowed = new Set(["output", "outputs", "input", "inputs", "all", "custom"]);
        const normalized = String(scope || "").toLowerCase();
        if (!allowed.has(normalized)) return;

        // Switching scope exits any active collection view.
        state.collectionId = "";
        state.collectionName = "";

        state.scope = normalized === "outputs" ? "output" : normalized === "inputs" ? "input" : normalized;
        if (state.scope !== "custom") {
            state.customRootId = "";
        } else {
            await refreshCustomRoots();
        }

        setActiveTabStyles();
        try {
            onChanged?.();
        } catch {}
        try {
            await onScopeChanged?.(state);
        } catch {}
        await reloadGrid();
    };

    return { setScope, setActiveTabStyles };
}

