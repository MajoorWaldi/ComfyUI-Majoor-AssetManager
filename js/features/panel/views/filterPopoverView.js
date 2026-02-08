import { t } from "../../../app/i18n.js";

export function createFilterPopoverView() {
    const filterPopover = document.createElement("div");
    filterPopover.className = "mjr-popover mjr-filter-popover";
    filterPopover.style.display = "none";

    const kindRow = document.createElement("div");
    kindRow.className = "mjr-popover-row";
    const kindLabel = document.createElement("div");
    kindLabel.className = "mjr-popover-label";
    kindLabel.textContent = t("label.type");
    const kindSelect = document.createElement("select");
    kindSelect.className = "mjr-select";
    kindSelect.title = "Filter by file type";
    [
        ["", t("filter.all")],
        ["image", "Image"],
        ["video", "Video"],
        ["audio", "Audio"],
        ["model3d", "3D"],
    ].forEach(([val, text]) => {
        const opt = document.createElement("option");
        opt.value = val;
        opt.textContent = text;
        kindSelect.appendChild(opt);
    });
    kindRow.appendChild(kindLabel);
    kindRow.appendChild(kindSelect);

    const wfRow = document.createElement("div");
    wfRow.className = "mjr-popover-row";
    const wfLabel = document.createElement("div");
    wfLabel.className = "mjr-popover-label";
    wfLabel.textContent = t("label.workflow");
    const wfToggle = document.createElement("label");
    wfToggle.className = "mjr-popover-toggle";
    wfToggle.title = "Show only assets with embedded workflow data";
    const wfCheckbox = document.createElement("input");
    wfCheckbox.type = "checkbox";
    const wfText = document.createElement("span");
    wfText.textContent = t("filter.onlyWithWorkflow");
    wfToggle.appendChild(wfCheckbox);
    wfToggle.appendChild(wfText);
    wfRow.appendChild(wfLabel);
    wfRow.appendChild(wfToggle);

    const ratingRow = document.createElement("div");
    ratingRow.className = "mjr-popover-row";
    const ratingLabel = document.createElement("div");
    ratingLabel.className = "mjr-popover-label";
    ratingLabel.textContent = t("label.rating");
    const ratingSelect = document.createElement("select");
    ratingSelect.className = "mjr-select";
    ratingSelect.title = "Filter by minimum rating";
    [
        [0, t("filter.anyRating")],
        [1, "★ 1+"],
        [2, "★ 2+"],
        [3, "★ 3+"],
        [4, "★ 4+"],
        [5, "★ 5"],
    ].forEach(([val, text]) => {
        const opt = document.createElement("option");
        opt.value = String(val);
        opt.textContent = text;
        ratingSelect.appendChild(opt);
    });
    ratingRow.appendChild(ratingLabel);
    ratingRow.appendChild(ratingSelect);

    const dateRow = document.createElement("div");
    dateRow.className = "mjr-popover-row";
    const dateLabel = document.createElement("div");
    dateLabel.className = "mjr-popover-label";
    dateLabel.textContent = t("label.dateRange");
    const dateRangeSelect = document.createElement("select");
    dateRangeSelect.className = "mjr-select";
    dateRangeSelect.title = "Filter by date range";
    [
        ["", t("filter.anytime")],
        ["today", t("filter.today")],
        ["this_week", t("filter.thisWeek")],
        ["this_month", t("filter.thisMonth")],
    ].forEach(([val, text]) => {
        const opt = document.createElement("option");
        opt.value = val;
        opt.textContent = text;
        dateRangeSelect.appendChild(opt);
    });
    dateRow.appendChild(dateLabel);
    dateRow.appendChild(dateRangeSelect);

    const agendaRow = document.createElement("div");
    agendaRow.className = "mjr-popover-row";
    const agendaLabel = document.createElement("div");
    agendaLabel.className = "mjr-popover-label";
    agendaLabel.textContent = t("label.agenda");
    agendaRow.appendChild(agendaLabel);

    // Keep a hidden input as the "source of truth" for existing controllers (change events, etc.).
    // The visible calendar UI is implemented in a separate module and renders into `agendaContainer`.
    const agendaContainer = document.createElement("div");
    agendaContainer.className = "mjr-agenda-container";

    const agendaInput = document.createElement("input");
    agendaInput.type = "date";
    agendaInput.className = "mjr-input mjr-agenda-input";
    agendaInput.style.display = "none";

    agendaContainer.appendChild(agendaInput);
    agendaRow.appendChild(agendaContainer);

    filterPopover.appendChild(kindRow);
    filterPopover.appendChild(wfRow);
    filterPopover.appendChild(ratingRow);
    filterPopover.appendChild(dateRow);
    filterPopover.appendChild(agendaRow);

    return {
        filterPopover,
        kindSelect,
        wfCheckbox,
        ratingSelect,
        dateRangeSelect,
        dateExactInput: agendaInput,
        agendaContainer
    };
}

