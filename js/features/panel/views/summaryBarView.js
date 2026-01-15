const _safeText = (v) => {
    try {
        return String(v ?? "");
    } catch {
        return "";
    }
};

const _titleScope = (scope) => {
    const s = String(scope || "").toLowerCase();
    if (s === "input" || s === "inputs") return "Inputs";
    if (s === "custom") return "Custom";
    return "Outputs";
};

export function createSummaryBarView() {
    const bar = document.createElement("div");
    bar.className = "mjr-am-summary";
    bar.setAttribute("aria-live", "polite");

    const left = document.createElement("div");
    left.className = "mjr-am-summary-left";

    const right = document.createElement("div");
    right.className = "mjr-am-summary-right";

    const text = document.createElement("div");
    text.className = "mjr-am-summary-text";

    left.appendChild(text);
    bar.appendChild(left);
    bar.appendChild(right);

    const update = ({ state, gridContainer } = {}) => {
        const cardsCount = (() => {
            try {
                return Number(gridContainer?.querySelectorAll?.(".mjr-asset-card")?.length || 0) || 0;
            } catch {
                return 0;
            }
        })();

        const selectedCount = (() => {
            try {
                const fromState = Array.isArray(state?.selectedAssetIds) ? state.selectedAssetIds.length : 0;
                if (fromState > 0) return fromState;
            } catch {}
            try {
                return Number(gridContainer?.querySelectorAll?.(".mjr-asset-card.is-selected")?.length || 0) || 0;
            } catch {
                return 0;
            }
        })();

        const total = (() => {
            const v = Number(state?.lastGridTotal ?? 0) || 0;
            return v > 0 ? v : 0;
        })();

        const shown = (() => {
            const v = Number(state?.lastGridCount ?? 0) || 0;
            if (v > 0) return v;
            return cardsCount;
        })();

        const scope = _titleScope(state?.scope || gridContainer?.dataset?.mjrScope || "output");
        const subfolder = _safeText(gridContainer?.dataset?.mjrSubfolder || "").trim();
        const folderPart = subfolder ? `folder: ${subfolder}` : "";

        const collectionPart = (() => {
            const cid = _safeText(state?.collectionId || "").trim();
            if (!cid) return "";
            const name = _safeText(state?.collectionName || cid).trim();
            return `collection: ${name}`;
        })();

        const customPart = (() => {
            const scopeRaw = String(state?.scope || gridContainer?.dataset?.mjrScope || "").toLowerCase();
            if (scopeRaw !== "custom") return "";
            const rid = _safeText(state?.customRootId || gridContainer?.dataset?.mjrCustomRootId || "").trim();
            return rid ? `custom: ${rid}` : "custom: (none)";
        })();

        const countPart = total && total >= shown ? `${shown}/${total}` : `${shown}`;
        const parts = [`assets: ${countPart}`];
        if (selectedCount > 0) parts.push(`selected: ${selectedCount}`);
        parts.push(scope);
        if (collectionPart) parts.push(collectionPart);
        else if (customPart) parts.push(customPart);
        else if (folderPart) parts.push(folderPart);

        try {
            text.textContent = parts.filter(Boolean).join(" · ");
        } catch {}
    };

    return { bar, update };
}

