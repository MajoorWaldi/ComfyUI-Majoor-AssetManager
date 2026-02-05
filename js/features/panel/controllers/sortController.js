import { t } from "../../../app/i18n.js";

export function createSortController({ state, sortBtn, sortMenu, sortPopover, popovers, reloadGrid, onChanged = null }) {
    const getSortOptions = () => [
        { key: "mtime_desc", label: t("sort.newest") },
        { key: "mtime_asc", label: t("sort.oldest") },
        { key: "name_asc", label: t("sort.nameAZ") },
        { key: "name_desc", label: t("sort.nameZA") },
    ];

    const setSortIcon = (key) => {
        const icon = sortBtn.querySelector("i");
        if (!icon) return;
        if (key === "name_asc") icon.className = "pi pi-sort-alpha-down";
        else if (key === "name_desc") icon.className = "pi pi-sort-alpha-up";
        else if (key === "mtime_asc") icon.className = "pi pi-sort-amount-up-alt";
        else icon.className = "pi pi-sort-amount-down";
    };

    const renderSortMenu = () => {
        sortMenu.replaceChildren();
        const sortOptions = getSortOptions();
        for (const opt of sortOptions) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "mjr-menu-item";

            const label = document.createElement("span");
            label.className = "mjr-menu-item-label";
            label.textContent = opt.label;

            const check = document.createElement("i");
            check.className = "pi pi-check mjr-menu-item-check";
            check.style.opacity = opt.key === state.sort ? "1" : "0";

            btn.appendChild(label);
            btn.appendChild(check);

            btn.addEventListener("click", async () => {
                state.sort = opt.key;
                setSortIcon(state.sort);
                renderSortMenu();
                try {
                    onChanged?.();
                } catch {}
                sortPopover.style.display = "none";
                popovers.close(sortPopover);
                await reloadGrid();
            });

            sortMenu.appendChild(btn);
        }
    };

    const bind = ({ onBeforeToggle } = {}) => {
        setSortIcon(state.sort);
        renderSortMenu();
        sortBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            try {
                onBeforeToggle?.();
            } catch {}
            renderSortMenu();
            popovers.toggle(sortPopover, sortBtn);
        });
    };

    return { bind, renderSortMenu, setSortIcon };
}
