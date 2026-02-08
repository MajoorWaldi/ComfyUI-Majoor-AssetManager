import { createFieldRow, createSection } from "../utils/dom.js";
import { drawWorkflowMinimap, synthesizeWorkflowFromPromptGraph } from "../utils/minimap.js";
import { loadMajoorSettings, saveMajoorSettings } from "../../../app/settings.js";
import { MINIMAP_LEGACY_SETTINGS_KEY } from "../../../app/settingsStore.js";

const coerceMetadataRawObject = (asset) => {
    const raw = asset?.metadata_raw ?? null;
    if (!raw) return null;
    if (typeof raw === "object") return raw;
    if (typeof raw === "string") {
        const t = raw.trim();
        if (!t) return null;
        try {
            const parsed = JSON.parse(t);
            return parsed && typeof parsed === "object" ? parsed : null;
        } catch {
            return null;
        }
    }
    return null;
};

const loadSettings = () => {
    try {
        const main = loadMajoorSettings?.();
        const w = main?.workflowMinimap;
        if (w && typeof w === "object") return w;
    } catch {}

    // Legacy migration (one-time best effort).
    try {
        const raw = localStorage?.getItem?.(MINIMAP_LEGACY_SETTINGS_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return null;
        try {
            const next = loadMajoorSettings();
            next.workflowMinimap = { ...next.workflowMinimap, ...parsed };
            saveMajoorSettings(next);
            localStorage?.removeItem?.(MINIMAP_LEGACY_SETTINGS_KEY);
        } catch {}
        return parsed;
    } catch {
        return null;
    }
};

const saveSettings = (workflowMinimap) => {
    try {
        const next = loadMajoorSettings();
        next.workflowMinimap = { ...next.workflowMinimap, ...workflowMinimap };
        saveMajoorSettings(next);
    } catch {}
};

const coerceWorkflow = (asset) => {
    const metadataRaw = coerceMetadataRawObject(asset);
    const wf =
        asset?.workflow ||
        asset?.Workflow ||
        asset?.comfy_workflow ||
        metadataRaw?.workflow ||
        metadataRaw?.Workflow ||
        metadataRaw?.comfy_workflow ||
        null;
    if (!wf) return null;
    if (typeof wf === "object") return wf;
    if (typeof wf === "string") {
        const t = wf.trim();
        if (!t) return null;
        try {
            return JSON.parse(t);
        } catch {
            return null;
        }
    }
    return null;
};

const looksLikePromptGraph = (obj) => {
    try {
        const entries = Object.entries(obj || {});
        if (!entries.length) return false;
        let hits = 0;
        for (const [, v] of entries.slice(0, 50)) {
            if (!v || typeof v !== "object") continue;
            if (v.inputs && typeof v.inputs === "object") hits += 1;
            if (hits >= 2) return true;
        }
        return false;
    } catch {
        return false;
    }
};

const coercePromptGraph = (asset) => {
    const metadataRaw = coerceMetadataRawObject(asset);
    const raw =
        asset?.prompt ||
        asset?.Prompt ||
        metadataRaw?.prompt ||
        metadataRaw?.Prompt ||
        null;
    if (!raw) return null;
    if (typeof raw === "object") return looksLikePromptGraph(raw) ? raw : null;
    if (typeof raw === "string") {
        const t = raw.trim();
        if (!t) return null;
        try {
            const parsed = JSON.parse(t);
            return looksLikePromptGraph(parsed) ? parsed : null;
        } catch {
            return null;
        }
    }
    return null;
};

export function createWorkflowMinimapSection(asset) {
    const rawWorkflow = coerceWorkflow(asset);
    const promptGraph = coercePromptGraph(asset);

    // Show minimap if we have a positioned workflow OR we can synthesize one from a prompt graph.
    if (!rawWorkflow && !promptGraph) return null;

    const workflow = rawWorkflow || synthesizeWorkflowFromPromptGraph(promptGraph);
    if (!workflow) return null;

    const section = createSection("ComfyUI Workflow");
    section.appendChild(createFieldRow("Status", asset.has_generation_data ? "Complete" : "Partial"));

    const defaultSettings = {
        nodeColors: true,
        showLinks: true,
        showGroups: true,
        renderBypassState: true,
        renderErrorState: true,
        showViewport: true,
    };
    const settings = { ...defaultSettings, ...loadSettings() };

    const headerRow = document.createElement("div");
    headerRow.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-top: 8px;
    `;

    const toolsBtn = document.createElement("button");
    toolsBtn.type = "button";
    toolsBtn.className = "mjr-btn mjr-icon-btn";
    toolsBtn.title = "Minimap settings";
    toolsBtn.style.cssText = `
        width: 28px;
        height: 28px;
        border-radius: 8px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid var(--mjr-border, rgba(255,255,255,0.12));
        background: rgba(255,255,255,0.06);
        color: rgba(255,255,255,0.9);
        cursor: pointer;
    `;
    const toolsIcon = document.createElement("i");
    toolsIcon.className = "pi pi-sliders-h";
    toolsBtn.appendChild(toolsIcon);

    const headerSpacer = document.createElement("div");
    headerSpacer.style.flex = "1";

    headerRow.appendChild(headerSpacer);
    headerRow.appendChild(toolsBtn);
    section.appendChild(headerRow);

    const layout = document.createElement("div");
    layout.style.cssText = `
        display: flex;
        gap: 10px;
        align-items: stretch;
        margin-top: 10px;
    `;

    const panel = document.createElement("div");
    panel.style.cssText = `
        width: 190px;
        flex: 0 0 auto;
        border-radius: 10px;
        padding: 10px;
        background: rgba(0,0,0,0.20);
        border: 1px solid var(--mjr-border, rgba(255,255,255,0.12));
        display: none;
    `;

    const createToggle = ({ key, label, iconClass }) => {
        const row = document.createElement("button");
        row.type = "button";
        row.style.cssText = `
            width: 100%;
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 8px 8px;
            border-radius: 10px;
            border: 1px solid transparent;
            background: transparent;
            cursor: pointer;
            color: rgba(255,255,255,0.92);
            text-align: left;
        `;

        row.onmouseenter = () => {
            row.style.background = "rgba(255,255,255,0.06)";
            row.style.borderColor = "rgba(255,255,255,0.08)";
        };
        row.onmouseleave = () => {
            row.style.background = "transparent";
            row.style.borderColor = "transparent";
        };

        const box = document.createElement("span");
        box.style.cssText = `
            width: 22px;
            height: 22px;
            border-radius: 6px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            background: ${settings[key] ? "rgba(76,175,80,0.95)" : "rgba(255,255,255,0.08)"};
            border: 1px solid ${settings[key] ? "rgba(76,175,80,0.35)" : "rgba(255,255,255,0.12)"};
            flex: 0 0 auto;
        `;
        const check = document.createElement("i");
        check.className = "pi pi-check";
        check.style.fontSize = "12px";
        check.style.opacity = settings[key] ? "1" : "0";
        box.appendChild(check);

        const icon = document.createElement("i");
        icon.className = iconClass;
        icon.style.cssText = "font-size: 18px; opacity: 0.9; width: 18px;";

        const text = document.createElement("div");
        text.textContent = label;
        text.style.cssText = "font-size: 13px; font-weight: 600;";

        row.appendChild(box);
        row.appendChild(icon);
        row.appendChild(text);

        row.onclick = () => {
            settings[key] = !settings[key];
            check.style.opacity = settings[key] ? "1" : "0";
            box.style.background = settings[key] ? "rgba(76,175,80,0.95)" : "rgba(255,255,255,0.08)";
            box.style.borderColor = settings[key] ? "rgba(76,175,80,0.35)" : "rgba(255,255,255,0.12)";
            saveSettings(settings);
            render();
        };

        return row;
    };

    panel.appendChild(
        createToggle({ key: "nodeColors", label: "Node Colors", iconClass: "pi pi-palette" })
    );
    panel.appendChild(
        createToggle({ key: "showLinks", label: "Show Links", iconClass: "pi pi-share-alt" })
    );
    panel.appendChild(
        createToggle({ key: "showGroups", label: "Show Frames/Groups", iconClass: "pi pi-th-large" })
    );
    panel.appendChild(
        createToggle({ key: "renderBypassState", label: "Render Bypass State", iconClass: "pi pi-ban" })
    );
    panel.appendChild(
        createToggle({ key: "renderErrorState", label: "Render Error State", iconClass: "pi pi-exclamation-triangle" })
    );
    panel.appendChild(
        createToggle({ key: "showViewport", label: "Show Viewport", iconClass: "pi pi-window-maximize" })
    );

    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 120;
    canvas.style.cssText = `
        width: 100%;
        height: 120px;
        border-radius: 8px;
        margin-top: 0;
        background: rgba(0,0,0,0.25);
        border: 1px solid var(--mjr-border, rgba(255,255,255,0.12));
    `;

    const render = () => {
        const w = Math.max(1, canvas.clientWidth || 320);
        const h = Math.max(1, canvas.clientHeight || 120);
        const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
        const ctx = canvas.getContext("2d");
        if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawWorkflowMinimap(canvas, workflow, settings);
    };

    try {
        const ro = new ResizeObserver(() => render());
        ro.observe(canvas);
        section._mjrMinimapCleanup = () => {
            try {
                ro.disconnect();
            } catch {}
        };
    } catch {}

    layout.appendChild(panel);
    layout.appendChild(canvas);
    section.appendChild(layout);

    toolsBtn.onclick = () => {
        const visible = panel.style.display !== "none";
        panel.style.display = visible ? "none" : "block";
        render();
    };

    render();

    const details = document.createElement("details");
    details.style.marginTop = "10px";

    const summary = document.createElement("summary");
    summary.textContent = "Show raw JSON";
    summary.style.cssText = `
        cursor: pointer;
        color: var(--mjr-muted, rgba(255,255,255,0.65));
        font-size: 12px;
        user-select: none;
    `;
    details.appendChild(summary);

    const pre = document.createElement("pre");
    pre.style.cssText = `
        background: rgba(0,0,0,0.5);
        padding: 10px;
        border-radius: 6px;
        font-size: 11px;
        overflow: auto;
        max-height: 180px;
        margin: 10px 0 0 0;
        color: #90CAF9;
        font-family: 'Consolas', 'Monaco', monospace;
    `;
    pre.textContent = JSON.stringify(workflow, null, 2);
    details.appendChild(pre);

    section.appendChild(details);

    return section;
}
