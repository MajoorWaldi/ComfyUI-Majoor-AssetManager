import { t } from "../../../app/i18n.js";

export function createCustomPopoverView() {
    const customPopover = document.createElement("div");
    customPopover.className = "mjr-popover mjr-custom-popover";
    customPopover.style.display = "none";

    const customRow = document.createElement("div");
    customRow.className = "mjr-popover-row";

    const customLabel = document.createElement("div");
    customLabel.className = "mjr-popover-label";
    customLabel.textContent = t("label.folder");

    const customSelect = document.createElement("select");
    customSelect.className = "mjr-select";

    customRow.appendChild(customLabel);
    customRow.appendChild(customSelect);

    const customActionsRow = document.createElement("div");
    customActionsRow.className = "mjr-popover-row";

    const customAddBtn = document.createElement("button");
    customAddBtn.type = "button";
    customAddBtn.textContent = t("btn.add");
    customAddBtn.classList.add("mjr-btn");

    const customRemoveBtn = document.createElement("button");
    customRemoveBtn.type = "button";
    customRemoveBtn.textContent = t("btn.remove");
    customRemoveBtn.classList.add("mjr-btn");
    customRemoveBtn.disabled = true;

    customActionsRow.appendChild(customAddBtn);
    customActionsRow.appendChild(customRemoveBtn);

    customPopover.appendChild(customRow);
    customPopover.appendChild(customActionsRow);

    return {
        customPopover,
        customSelect,
        customAddBtn,
        customRemoveBtn
    };
}

