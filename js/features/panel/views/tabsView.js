export function createTabsView() {
    const tabs = document.createElement("div");
    tabs.classList.add("mjr-tabs");

    const makeTab = (label, scope, tooltip) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = label;
        btn.dataset.scope = scope;
        btn.classList.add("mjr-tab");
        btn.title = tooltip;
        return btn;
    };

    const tabAll = makeTab("All", "all", "Browse all assets (inputs + outputs + custom)");
    const tabInputs = makeTab("Inputs", "input", "Browse input folder assets");
    const tabOutputs = makeTab("Outputs", "output", "Browse generated outputs");
    const tabCustom = makeTab("Custom", "custom", "Browse custom folders");
    tabs.appendChild(tabAll);
    tabs.appendChild(tabInputs);
    tabs.appendChild(tabOutputs);
    tabs.appendChild(tabCustom);

    return {
        tabs,
        tabButtons: { tabAll, tabInputs, tabOutputs, tabCustom }
    };
}

