const _safeText = (v) => {
    try {
        return String(v ?? "");
    } catch {
        return "";
    }
};

const _labelSort = (key) => {
    const k = String(key || "");
    if (k === "name_asc") return "Name A-Z";
    if (k === "name_desc") return "Name Z-A";
    if (k === "mtime_asc") return "Oldest first";
    return "Newest first";
};

function _createPill({ label, value, onClear } = {}) {
    const pill = document.createElement("div");
    pill.className = "mjr-context-pill";

    const txt = document.createElement("span");
    txt.className = "mjr-context-pill-text";
    txt.textContent = value != null && String(value).length ? `${label}: ${String(value)}` : String(label || "");
    pill.appendChild(txt);

    if (typeof onClear === "function") {
        const x = document.createElement("button");
        x.type = "button";
        x.className = "mjr-context-pill-x";
        x.title = `Clear ${label || "filter"}`;
        x.setAttribute("aria-label", `Clear ${label || "filter"}`);
        x.textContent = "×";
        x.addEventListener("click", (e) => {
            try {
                e.preventDefault();
                e.stopPropagation();
            } catch {}
            try {
                onClear();
            } catch {}
        });
        pill.appendChild(x);
    }

    return pill;
}

export function createContextPillsView() {
    const root = document.createElement("div");
    root.className = "mjr-am-context-pills";

    const update = ({ state, gridContainer, rawQuery = "", actions = null } = {}) => {
        const safeActions = actions && typeof actions === "object" ? actions : {};

        const query = _safeText(rawQuery || "").trim();
        const isQueryActive = query.length > 0 && query !== "*";

        const subfolder = _safeText(gridContainer?.dataset?.mjrSubfolder || "").trim();
        const isFilterActive = !!(
            _safeText(state?.kindFilter || "").trim()
            || !!state?.workflowOnly
            || (Number(state?.minRating || 0) || 0) > 0
            || _safeText(state?.dateRangeFilter || "").trim()
            || _safeText(state?.dateExactFilter || "").trim()
        );
        const isSortActive = _safeText(state?.sort || "mtime_desc").trim() !== "mtime_desc";
        const isCollectionActive = _safeText(state?.collectionId || "").trim().length > 0;
        const isScopeActive = String(state?.scope || "output") !== "output";
        const isCustomActive = String(state?.scope || "") === "custom" && _safeText(state?.customRootId || "").trim().length > 0;
        const isFolderActive = subfolder.length > 0 && !isCollectionActive && !isCustomActive;

        const anyContext =
            isQueryActive || isFilterActive || isSortActive || isCollectionActive || isScopeActive || isCustomActive || isFolderActive;
        void anyContext;

        try {
            root.replaceChildren();
        } catch {}

        if (isCollectionActive) {
            root.appendChild(
                _createPill({
                    label: "Collection",
                    value: _safeText(state?.collectionName || state?.collectionId || "").trim(),
                    onClear: () => safeActions?.clearCollection?.()
                })
            );
        }
        if (isCustomActive) {
            root.appendChild(
                _createPill({
                    label: "Custom",
                    value: _safeText(state?.customRootId || "").trim(),
                    onClear: () => safeActions?.clearCustomRoot?.()
                })
            );
        } else if (isFolderActive) {
            root.appendChild(
                _createPill({
                    label: "Folder",
                    value: subfolder,
                    onClear: () => safeActions?.clearFolder?.()
                })
            );
        }
        if (isScopeActive) {
            root.appendChild(
                _createPill({
                    label: "Scope",
                    value: _safeText(state?.scope || "output"),
                    onClear: () => safeActions?.clearScope?.()
                })
            );
        }
        if (isQueryActive) {
            root.appendChild(
                _createPill({
                    label: "Query",
                    value: query,
                    onClear: () => safeActions?.clearQuery?.()
                })
            );
        }
        if (_safeText(state?.kindFilter || "").trim()) {
            root.appendChild(
                _createPill({
                    label: "Type",
                    value: _safeText(state?.kindFilter || "").trim(),
                    onClear: () => safeActions?.clearKind?.()
                })
            );
        }
        if (Number(state?.minRating || 0) > 0) {
            root.appendChild(
                _createPill({
                    label: "Rating",
                    value: `>= ${Number(state?.minRating || 0)}`,
                    onClear: () => safeActions?.clearMinRating?.()
                })
            );
        }
        if (state?.workflowOnly) {
            root.appendChild(
                _createPill({
                    label: "Workflow",
                    value: "Only",
                    onClear: () => safeActions?.clearWorkflowOnly?.()
                })
            );
        }
        if (_safeText(state?.dateRangeFilter || "").trim()) {
            root.appendChild(
                _createPill({
                    label: "Date",
                    value: _safeText(state?.dateRangeFilter || "").trim(),
                    onClear: () => safeActions?.clearDateRange?.()
                })
            );
        }
        if (_safeText(state?.dateExactFilter || "").trim()) {
            root.appendChild(
                _createPill({
                    label: "Day",
                    value: _safeText(state?.dateExactFilter || "").trim(),
                    onClear: () => safeActions?.clearDateExact?.()
                })
            );
        }
        if (isSortActive) {
            root.appendChild(
                _createPill({
                    label: "Sort",
                    value: _labelSort(state?.sort),
                    onClear: () => safeActions?.clearSort?.()
                })
            );
        }
    };

    return { wrap: root, update };
}
