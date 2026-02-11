import {
    comboHasAnyAudioValue,
    comboHasAnyVideoValue,
    looksLikeAudioPath,
    looksLikeVideoPath
} from "../utils/video.js";

let highlightedNode = null;
let highlightedNodePrev = null;

export const getNodeUnderClientXY = (app, clientX, clientY) => {
    const canvasEl = app?.canvas?.canvas || document.querySelector("canvas");
    const graph = app?.canvas?.graph;
    const ds = app?.canvas?.ds;
    if (!canvasEl || !graph || !ds) return null;

    const rect = canvasEl.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
        return null;
    }

    const scale = Number(ds.scale) || 1;
    const off = ds.offset || [0, 0];
    const offX = Array.isArray(off) ? Number(off[0]) || 0 : Number(off?.x) || 0;
    const offY = Array.isArray(off) ? Number(off[1]) || 0 : Number(off?.y) || 0;
    const x = (clientX - rect.left) / scale - offX;
    const y = (clientY - rect.top) / scale - offY;

    if (typeof graph.getNodeOnPos === "function") {
        return graph.getNodeOnPos(x, y);
    }

    const nodes = graph._nodes || [];
    for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        if (!n?.pos || !n?.size) continue;
        const width = n.size[0];
        let height = n.size[1];
        if (n.flags && n.flags.collapsed) {
            height = 30;
        }
        if (
            x >= n.pos[0] &&
            y >= n.pos[1] &&
            x <= n.pos[0] + width &&
            y <= n.pos[1] + height
        ) {
            return n;
        }
    }
    return null;
};

export const applyHighlight = (app, node, markCanvasDirty) => {
    if (!node || highlightedNode === node) return;
    clearHighlight(app, markCanvasDirty);
    highlightedNode = node;
    highlightedNodePrev = { color: node.color, bgcolor: node.bgcolor };
    node.bgcolor = "#3355ff";
    node.color = "#a9c4ff";
    markCanvasDirty(app);
};

export const clearHighlight = (app, markCanvasDirty) => {
    if (!highlightedNode) return;
    try {
        if (highlightedNodePrev) {
            highlightedNode.color = highlightedNodePrev.color;
            highlightedNode.bgcolor = highlightedNodePrev.bgcolor;
        }
    } catch {}
    highlightedNode = null;
    highlightedNodePrev = null;
    markCanvasDirty(app);
};

export const ensureComboHasValue = (widget, value) => {
    if (!widget || widget.type !== "combo" || !widget.options) return;
    let vals = widget.options.values;
    let target = widget.options;

    if (typeof vals === "function") {
        return;
    }

    if (!Array.isArray(vals)) {
        if (vals && typeof vals === "object" && Array.isArray(vals.values)) {
            target = vals;
            vals = vals.values;
        } else {
            return;
        }
    }

    const has = vals.some((v) => {
        if (typeof v === "string") return v === value;
        return (v?.content ?? v?.value ?? v?.text) === value;
    });
    if (has) return;

    if (vals.length === 0 || typeof vals[0] === "string") {
        vals.unshift(value);
    } else {
        vals.unshift({ content: value, text: value, value });
    }
    target.values = vals;
};

export const pickBestVideoPathWidget = (node, droppedExt) => {
    const widgets = node?.widgets;
    if (!Array.isArray(widgets) || !widgets.length) return null;

    const ext = String(droppedExt || "").toLowerCase().replace(/^\./, "");
    const exactNames = new Set(["video_path", "input_video", "source_video", "video"]);
    const nodeType = String(node?.type || "").toLowerCase();
    const isKnownVideoNode =
        nodeType.includes("loadvideo") ||
        nodeType.includes("vhs_loadvideo") ||
        nodeType.includes("videoloader") ||
        nodeType === "loadvideo";

    const candidates = [];
    for (const w of widgets) {
        if (!w) continue;
        const type = String(w?.type || "").toLowerCase();
        const value = w?.value;

        const rejectTypes = new Set(["number", "int", "float", "boolean", "toggle", "checkbox"]);
        if (rejectTypes.has(type)) continue;
        if (typeof value === "number" || typeof value === "boolean") continue;

        const stringLikeByType = type === "text" || type === "string" || type === "combo";
        const stringLikeByCallback = typeof w?.callback === "function" && typeof value === "string";
        if (!stringLikeByType && !stringLikeByCallback) continue;

        const rawName = String(w?.name || w?.label || "");
        const name = rawName.toLowerCase().trim();

        let score = 0;
        if (exactNames.has(name)) score += 100;

        if (name === "file" && isKnownVideoNode && type === "combo" && comboHasAnyVideoValue(w, ext)) {
            score += 100;
        }

        const hasVideo = name.includes("video");
        const hasAnyVideoHint =
            name.includes("path") || name.includes("file") || name.includes("input") || name.includes("src") || name.includes("source");
        if (hasVideo && hasAnyVideoHint) score += 80;
        if (name.includes("file") || name.includes("path")) score += 35;
        if (name.includes("media") || name.includes("clip") || name.includes("footage")) score += 45;

        const isOutputy =
            name.includes("output") ||
            name.includes("save") ||
            name.includes("export") ||
            name.includes("folder") ||
            name.includes("dir");
        if (isOutputy) score -= 90;

        if (name === "video") {
            const empty = typeof value === "string" && value.trim() === "";
            if (empty) {
                score += 25;
            } else if (looksLikeVideoPath(value, ext)) {
                score += 25;
            } else {
                score -= 10;
            }
        }

        if (isKnownVideoNode) score += 15;
        const emptyValue = typeof value === "string" && value.trim() === "";
        if (emptyValue) score += 3;
        if (type === "combo" && comboHasAnyVideoValue(w, ext)) score += 12;

        candidates.push({ w, score, emptyValue, combo: type === "combo" });
    }

    if (!candidates.length) return null;
    candidates.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.emptyValue !== a.emptyValue) return b.emptyValue ? 1 : -1;
        if (b.combo !== a.combo) return b.combo ? 1 : -1;
        return 0;
    });

    const best = candidates[0];
    if (!best || best.score < 20) return null;
    try {
        best.w.__mjrVideoPickScore = best.score;
    } catch {}
    return best.w;
};

export const pickBestMediaPathWidget = (node, payload, droppedExt) => {
    const kind = String(payload?.kind || "").toLowerCase();
    if (kind !== "audio") return pickBestVideoPathWidget(node, droppedExt);

    const widgets = node?.widgets;
    if (!Array.isArray(widgets) || !widgets.length) return null;

    const ext = String(droppedExt || "").toLowerCase().replace(/^\./, "");
    const exactNames = new Set(["audio_path", "input_audio", "source_audio", "audio"]);
    const nodeType = String(node?.type || "").toLowerCase();
    const isKnownAudioNode =
        nodeType.includes("loadaudio") ||
        nodeType.includes("vhs_loadaudioupload") ||
        nodeType.includes("vhs_loadaudio") ||
        nodeType.includes("audioloader") ||
        nodeType.includes("inputaudio") ||
        nodeType === "loadaudio";

    const candidates = [];
    for (const w of widgets) {
        if (!w) continue;
        const type = String(w?.type || "").toLowerCase();
        const value = w?.value;

        const rejectTypes = new Set(["number", "int", "float", "boolean", "toggle", "checkbox"]);
        if (rejectTypes.has(type)) continue;
        if (typeof value === "number" || typeof value === "boolean") continue;

        const stringLikeByType = type === "text" || type === "string" || type === "combo";
        const stringLikeByCallback = typeof w?.callback === "function" && typeof value === "string";
        if (!stringLikeByType && !stringLikeByCallback) continue;

        const rawName = String(w?.name || w?.label || "");
        const name = rawName.toLowerCase().trim();

        let score = 0;
        if (exactNames.has(name)) score += 100;

        if (name === "file" && isKnownAudioNode && type === "combo" && comboHasAnyAudioValue(w, ext)) {
            score += 100;
        }

        const hasAudio = name.includes("audio") || name.includes("sound") || name.includes("music");
        const hasAnyHint =
            name.includes("path") || name.includes("file") || name.includes("input") || name.includes("src") || name.includes("source");
        if (hasAudio && hasAnyHint) score += 80;
        if (name.includes("file") || name.includes("path")) score += 35;
        if (name.includes("media") || name.includes("track")) score += 45;

        const isOutputy =
            name.includes("output") ||
            name.includes("save") ||
            name.includes("export") ||
            name.includes("folder") ||
            name.includes("dir");
        if (isOutputy) score -= 90;

        if (name === "audio") {
            const empty = typeof value === "string" && value.trim() === "";
            if (empty) {
                score += 25;
            } else if (looksLikeAudioPath(value, ext)) {
                score += 25;
            } else {
                score -= 10;
            }
        }

        if (isKnownAudioNode) score += 15;
        const emptyValue = typeof value === "string" && value.trim() === "";
        if (emptyValue) score += 3;
        if (type === "combo" && comboHasAnyAudioValue(w, ext)) score += 12;

        candidates.push({ w, score, emptyValue, combo: type === "combo" });
    }

    if (!candidates.length) return null;
    candidates.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.emptyValue !== a.emptyValue) return b.emptyValue ? 1 : -1;
        if (b.combo !== a.combo) return b.combo ? 1 : -1;
        return 0;
    });

    const best = candidates[0];
    if (!best || best.score < 20) return null;
    try {
        best.w.__mjrAudioPickScore = best.score;
    } catch {}
    return best.w;
};
