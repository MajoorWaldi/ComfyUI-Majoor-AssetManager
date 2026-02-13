import { t } from "../../../app/i18n.js";

export function createFilterPopoverView() {
    const filterPopover = document.createElement("div");
    filterPopover.className = "mjr-popover mjr-filter-popover";
    filterPopover.style.display = "none";
    filterPopover.style.cssText = "display:none;";

    const makeGroup = (title) => {
        const g = document.createElement("div");
        g.className = "mjr-filter-group";
        const h = document.createElement("div");
        h.className = "mjr-filter-group-title";
        h.textContent = title;
        g.appendChild(h);
        return g;
    };

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
    kindRow.style.cssText = "display:grid; grid-template-columns: 110px 1fr; gap:8px; align-items:center; margin-bottom:8px;";

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
    wfRow.style.cssText = "display:grid; grid-template-columns: 110px 1fr; gap:8px; align-items:center; margin-bottom:8px;";

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
    ratingRow.style.cssText = "display:grid; grid-template-columns: 110px 1fr; gap:8px; align-items:center; margin-bottom:8px;";

    const workflowTypeRow = document.createElement("div");
    workflowTypeRow.className = "mjr-popover-row";
    workflowTypeRow.style.cssText = "display:grid; grid-template-columns: 110px 1fr; gap:8px; align-items:center; margin-bottom:8px;";
    const workflowTypeLabel = document.createElement("div");
    workflowTypeLabel.className = "mjr-popover-label";
    workflowTypeLabel.textContent = "Workflow type";
    const workflowTypeSelect = document.createElement("select");
    workflowTypeSelect.className = "mjr-select";
    [
        ["", "Any"],
        ["T2I", "T2I"],
        ["I2I", "I2I"],
        ["T2V", "T2V"],
        ["I2V", "I2V"],
        ["V2V", "V2V"],
        ["FLF", "FLF (First/Last Frame)"],
        ["UPSCL", "UPSCL"],
        ["INPT", "INPT"],
        ["TTS", "TTS (Text to Speech)"],
        ["A2A", "A2A (Audio to Audio)"],
    ].forEach(([val, text]) => {
        const opt = document.createElement("option");
        opt.value = val;
        opt.textContent = text;
        workflowTypeSelect.appendChild(opt);
    });
    workflowTypeRow.appendChild(workflowTypeLabel);
    workflowTypeRow.appendChild(workflowTypeSelect);

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
    dateRow.style.cssText = "display:grid; grid-template-columns: 110px 1fr; gap:8px; align-items:center; margin-bottom:8px;";

    const sizeRow = document.createElement("div");
    sizeRow.className = "mjr-popover-row";
    sizeRow.style.cssText = "display:grid; grid-template-columns: 110px 1fr 1fr; gap:8px; align-items:center; margin-bottom:8px;";
    const sizeLabel = document.createElement("div");
    sizeLabel.className = "mjr-popover-label";
    sizeLabel.textContent = "File size (MB)";
    const minSizeInput = document.createElement("input");
    minSizeInput.type = "number";
    minSizeInput.min = "0";
    minSizeInput.step = "0.1";
    minSizeInput.className = "mjr-input";
    minSizeInput.placeholder = "Min";
    const maxSizeInput = document.createElement("input");
    maxSizeInput.type = "number";
    maxSizeInput.min = "0";
    maxSizeInput.step = "0.1";
    maxSizeInput.className = "mjr-input";
    maxSizeInput.placeholder = "Max";
    sizeRow.appendChild(sizeLabel);
    sizeRow.appendChild(minSizeInput);
    sizeRow.appendChild(maxSizeInput);

    const resPresetRow = document.createElement("div");
    resPresetRow.className = "mjr-popover-row";
    resPresetRow.style.cssText = "display:grid; grid-template-columns: 110px 1fr; gap:8px; align-items:center; margin-bottom:8px;";
    const resPresetLabel = document.createElement("div");
    resPresetLabel.className = "mjr-popover-label";
    resPresetLabel.textContent = "Resolution";
    const resolutionPresetSelect = document.createElement("select");
    resolutionPresetSelect.className = "mjr-select";
    [
        ["", "Any"],
        ["hd", "HD (>=1280x720)"],
        ["fhd", "FHD (>=1920x1080)"],
        ["qhd", "QHD (>=2560x1440)"],
        ["uhd", "4K (>=3840x2160)"],
    ].forEach(([val, text]) => {
        const opt = document.createElement("option");
        opt.value = val;
        opt.textContent = text;
        resolutionPresetSelect.appendChild(opt);
    });
    resPresetRow.appendChild(resPresetLabel);
    resPresetRow.appendChild(resolutionPresetSelect);

    const resRow = document.createElement("div");
    resRow.className = "mjr-popover-row";
    resRow.style.cssText = "display:grid; grid-template-columns: 110px 1fr 1fr; gap:8px; align-items:center; margin-bottom:8px;";
    const resLabel = document.createElement("div");
    resLabel.className = "mjr-popover-label";
    resLabel.textContent = "Min WxH";
    const minWidthInput = document.createElement("input");
    minWidthInput.type = "number";
    minWidthInput.min = "0";
    minWidthInput.step = "1";
    minWidthInput.className = "mjr-input";
    minWidthInput.placeholder = "Width";
    const minHeightInput = document.createElement("input");
    minHeightInput.type = "number";
    minHeightInput.min = "0";
    minHeightInput.step = "1";
    minHeightInput.className = "mjr-input";
    minHeightInput.placeholder = "Height";
    resRow.appendChild(resLabel);
    resRow.appendChild(minWidthInput);
    resRow.appendChild(minHeightInput);

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

    const groupMain = makeGroup("Core");
    groupMain.appendChild(kindRow);
    groupMain.appendChild(wfRow);
    groupMain.appendChild(workflowTypeRow);
    groupMain.appendChild(ratingRow);

    const groupMedia = makeGroup("Media");
    groupMedia.appendChild(sizeRow);
    groupMedia.appendChild(resPresetRow);
    groupMedia.appendChild(resRow);

    const groupTime = makeGroup("Time");
    groupTime.appendChild(dateRow);
    groupTime.appendChild(agendaRow);

    filterPopover.appendChild(groupMain);
    filterPopover.appendChild(groupMedia);
    filterPopover.appendChild(groupTime);

    return {
        filterPopover,
        kindSelect,
        wfCheckbox,
        workflowTypeSelect,
        ratingSelect,
        minSizeInput,
        maxSizeInput,
        resolutionPresetSelect,
        minWidthInput,
        minHeightInput,
        dateRangeSelect,
        dateExactInput: agendaInput,
        agendaContainer
    };
}

