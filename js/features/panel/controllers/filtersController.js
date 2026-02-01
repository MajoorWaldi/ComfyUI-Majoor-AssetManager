let _lastAgendaHandler = null;

export function bindFilters({
    state,
    kindSelect,
    wfCheckbox,
    ratingSelect,
    dateRangeSelect,
    dateExactInput,
    reloadGrid,
    onFiltersChanged = null
}) {
    // Cleanup previous window listener to prevent accumulation
    if (_lastAgendaHandler) {
        try {
            window.removeEventListener("MJR:AgendaStatus", _lastAgendaHandler);
        } catch {}
        _lastAgendaHandler = null;
    }

    kindSelect.addEventListener("change", async () => {
        state.kindFilter = kindSelect.value || "";
        try { onFiltersChanged?.(); } catch {}
        await reloadGrid();
    });
    wfCheckbox.addEventListener("change", async () => {
        state.workflowOnly = Boolean(wfCheckbox.checked);
        try { onFiltersChanged?.(); } catch {}
        await reloadGrid();
    });
    ratingSelect.addEventListener("change", async () => {
        state.minRating = Number(ratingSelect.value || 0) || 0;
        try { onFiltersChanged?.(); } catch {}
        await reloadGrid();
    });
    if (dateRangeSelect) {
        dateRangeSelect.addEventListener("change", async () => {
            state.dateRangeFilter = dateRangeSelect.value || "";
            if (state.dateRangeFilter && state.dateExactFilter) {
                state.dateExactFilter = "";
                if (dateExactInput) {
                    dateExactInput.value = "";
                }
            }
            try { onFiltersChanged?.(); } catch {}
            await reloadGrid();
        });
    }
    if (dateExactInput) {
        const applyAgendaStyle = (status) => {
            dateExactInput.classList.toggle("mjr-agenda-filled", status === "filled");
            dateExactInput.classList.toggle("mjr-agenda-empty", status === "empty");
        };
        dateExactInput.addEventListener("change", async () => {
            state.dateExactFilter = dateExactInput.value ? String(dateExactInput.value) : "";
            if (state.dateExactFilter && state.dateRangeFilter) {
                state.dateRangeFilter = "";
                if (dateRangeSelect) {
                    dateRangeSelect.value = "";
                }
            }
            if (!state.dateExactFilter) {
                applyAgendaStyle("");
            }
            try { onFiltersChanged?.(); } catch {}
            await reloadGrid();
        });
        const handleAgendaStatus = (event) => {
            if (!event?.detail) return;
            const { date, hasResults } = event.detail;
            if (!dateExactInput.value) {
                applyAgendaStyle("");
                return;
            }
            if (date !== dateExactInput.value) return;
            applyAgendaStyle(hasResults ? "filled" : "empty");
        };
        try {
            window?.addEventListener?.("MJR:AgendaStatus", handleAgendaStatus, { passive: true });
            _lastAgendaHandler = handleAgendaStatus;
        } catch {}
    }
}

