/**
 * Drag & Drop support for staging assets to input (video-focused).
 */

import { app } from "../../../../scripts/app.js";
import { get, post } from "../../api/client.js";
import { ENDPOINTS, buildCustomViewURL, buildViewURL } from "../../api/endpoints.js";
import { comfyToast } from "../../app/toast.js";
import { pickRootId } from "../../utils/ids.js";

import { DND_GLOBAL_KEY, DND_INSTANCE_VERSION, DND_MIME } from "./utils/constants.js";
import { dndLog } from "./utils/log.js";
import { buildPayloadViewURL, getDraggedAsset } from "./utils/payload.js";
import { isVideoPayload } from "./utils/video.js";
import { isCanvasDropTarget, markCanvasDirty } from "./targets/canvas.js";
import { applyDragOutToOS } from "./out/DragOut.js";
import {
    applyHighlight,
    clearHighlight,
    ensureComboHasValue,
    getNodeUnderClientXY,
    pickBestVideoPathWidget
} from "./targets/node.js";
import { stageToInput, stageToInputDetailed } from "./staging/stageToInput.js";

const buildURL = (payload) =>
    buildPayloadViewURL(payload, { buildCustomViewURL, buildViewURL });

// Workflow cache: filename -> { workflow, at }
const _workflowCache = new Map();
const WORKFLOW_CACHE_TTL_MS = 60_000; // 1 minute
const WORKFLOW_CACHE_MAX = 100;

const cleanupWorkflowCache = () => {
    if (_workflowCache.size <= WORKFLOW_CACHE_MAX) return;
    const now = Date.now();

    // Remove expired first
    for (const [key, value] of _workflowCache.entries()) {
        if (now - (value?.at || 0) > WORKFLOW_CACHE_TTL_MS) {
            _workflowCache.delete(key);
        }
    }

    // If still too large, remove oldest
    if (_workflowCache.size > WORKFLOW_CACHE_MAX) {
        const entries = Array.from(_workflowCache.entries())
            .sort((a, b) => (a[1]?.at || 0) - (b[1]?.at || 0));
        const toRemove = entries.slice(0, _workflowCache.size - WORKFLOW_CACHE_MAX);
        toRemove.forEach(([key]) => _workflowCache.delete(key));
    }
};

export const tryLoadWorkflowToCanvas = async (payload) => {
    const pl = payload && typeof payload === "object" ? payload : null;
    const rootId = pickRootId(pl);

    // Check cache first
    const cacheKey = pl?.filename
        ? `${pl.type || "output"}:${pl.filename}:${pl.subfolder || ""}:${rootId}`
        : null;

    if (cacheKey) {
        const cached = _workflowCache.get(cacheKey);
        const now = Date.now();

        if (cached && now - (cached.at || 0) < WORKFLOW_CACHE_TTL_MS) {
            if (cached.workflow) {
                try {
                    if (typeof app?.loadGraphData === "function") {
                        app.loadGraphData(cached.workflow);
                        return true;
                    }
                    if (typeof app?.canvas?.graph?.configure === "function") {
                        app.canvas.graph.configure(cached.workflow);
                        try {
                            app.canvas.setDirty?.(true, true);
                        } catch {}
                        return true;
                    }
                    if (typeof app?.graph?.configure === "function") {
                        app.graph.configure(cached.workflow);
                        return true;
                    }
                } catch {}
            }
            // Cached but no workflow (already tried and failed)
            return false;
        }
    }

    try {
        // Try ultra-fast workflow-quick endpoint first (direct SQL, no self-heal)
        // Falls back to slower metadata endpoint with workflow_only=1 if needed
        let url = null;
        let workflow = null;

        if (pl?.filename) {
            // First: try the fast endpoint (no self-heal, direct SQL)
            const quickUrl = `${ENDPOINTS.WORKFLOW_QUICK}?type=${encodeURIComponent(pl.type || "output")}` +
                `&filename=${encodeURIComponent(pl.filename)}` +
                `&subfolder=${encodeURIComponent(pl.subfolder || "")}` +
                (rootId ? `&root_id=${encodeURIComponent(rootId)}` : "");

            const quickRes = await get(quickUrl);
            if (quickRes?.ok && quickRes.workflow) {
                workflow = quickRes.workflow;
            }

            // Fallback to slower metadata endpoint if quick lookup didn't find it
            if (!workflow) {
                url = `${ENDPOINTS.METADATA}?workflow_only=1&type=${encodeURIComponent(pl.type || "output")}` +
                    `&filename=${encodeURIComponent(pl.filename)}` +
                    `&subfolder=${encodeURIComponent(pl.subfolder || "")}` +
                    `&root_id=${encodeURIComponent(rootId)}`;
            }
        }

        // If we need the fallback metadata endpoint
        if (!workflow && url) {
            const res = await get(url);
            if (!res?.ok || !res.data) {
                // Cache negative result to avoid retrying
                if (cacheKey) {
                    _workflowCache.set(cacheKey, { workflow: null, at: Date.now() });
                    cleanupWorkflowCache();
                }
                return false;
            }
            workflow = res.data?.workflow;
        }

        if (!workflow || typeof workflow !== "object") {
            // Cache negative result
            if (cacheKey) {
                _workflowCache.set(cacheKey, { workflow: null, at: Date.now() });
                cleanupWorkflowCache();
            }
            return false;
        }

        // Cache the workflow
        if (cacheKey) {
            _workflowCache.set(cacheKey, { workflow, at: Date.now() });
            cleanupWorkflowCache();
        }

        // Prefer ComfyUI helper if available; otherwise use LiteGraph configure.
        if (typeof app?.loadGraphData === "function") {
            app.loadGraphData(workflow);
            return true;
        }
        if (typeof app?.canvas?.graph?.configure === "function") {
            app.canvas.graph.configure(workflow);
            try {
                app.canvas.setDirty?.(true, true);
            } catch {}
            return true;
        }
        if (typeof app?.graph?.configure === "function") {
            app.graph.configure(workflow);
            return true;
        }
    } catch {}
    return false;
};

export const bindAssetDragStart = (containerEl) => {
    if (!containerEl) return;
    if (containerEl._mjrAssetDragStartBound) return;
    containerEl._mjrAssetDragStartBound = true;

    containerEl.addEventListener(
        "dragstart",
        (event) => {
            const dt = event?.dataTransfer;
            if (!dt) return;
            const card = event?.target?.closest?.(".mjr-asset-card");
            if (!card) return;

            const asset = card._mjrAsset;
            if (!asset || typeof asset !== "object") return;

            const type = String(asset?.type || "output").toLowerCase();
            const payload = {
                filename: asset.filename,
                subfolder: asset.subfolder || "",
                type,
                root_id: pickRootId(asset) || undefined,
                kind: asset.kind
            };

            try {
                dt.setData(DND_MIME, JSON.stringify(payload));
                dt.setData("text/plain", String(asset.filename || ""));
                const viewUrl = buildURL(payload);
                applyDragOutToOS({ dt, asset, containerEl, card, viewUrl });
            } catch {}

            const preview = card.querySelector("img") || card.querySelector("video");
            if (preview && preview instanceof HTMLElement) {
                try {
                    dt.setDragImage(preview, 10, 10);
                } catch {}
            }
        },
        true
    );
};

// Stable alias (entry-point contract).
export const enableAssetDrag = bindAssetDragStart;

export const initDragDrop = () => {
    const existing = (() => {
        try {
            return window?.[DND_GLOBAL_KEY] || null;
        } catch {
            return null;
        }
    })();

    // If a previous version is already installed, remove it and replace with the current one.
    if (existing?.initialized) {
        if (existing.version === DND_INSTANCE_VERSION) {
            return existing.dispose || (() => {});
        }
        try {
            existing.dispose?.({ force: true });
        } catch {}
    }

    const onDragOver = (event) => {
        const types = Array.from(event?.dataTransfer?.types || []);
        if (!types.includes(DND_MIME)) return;
        const payload = getDraggedAsset(event, DND_MIME);
        if (!isVideoPayload(payload)) return;

        const node = getNodeUnderClientXY(app, event.clientX, event.clientY);
        const droppedExt = String(payload?.filename || "").split(".").pop() || "";
        const widget = node ? pickBestVideoPathWidget(node, droppedExt) : null;

        if (node && widget) {
            event.preventDefault();
            event.stopImmediatePropagation?.();
            event.stopPropagation();
            applyHighlight(app, node, markCanvasDirty);
            event.dataTransfer.dropEffect = "copy";
            dndLog("dragover", { node: node?.title, widget: widget?.name });
            return;
        }

        clearHighlight(app, markCanvasDirty);
        if (!isCanvasDropTarget(app, event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
    };

    const onDrop = async (event) => {
        const types = Array.from(event?.dataTransfer?.types || []);
        if (!types.includes(DND_MIME)) return;
        const payload = getDraggedAsset(event, DND_MIME);
        if (!isVideoPayload(payload)) return;
        if (!isCanvasDropTarget(app, event)) return;

        const node = getNodeUnderClientXY(app, event.clientX, event.clientY);
        const droppedExt = String(payload?.filename || "").split(".").pop() || "";
        const widget = node ? pickBestVideoPathWidget(node, droppedExt) : null;

        if (!node || !widget) {
            clearHighlight(app, markCanvasDirty);
            event.preventDefault();
            event.stopImmediatePropagation?.();
            event.stopPropagation();

            // Run staging + workflow extraction in TRUE parallel for best UX.
            const stagePromise = stageToInputDetailed({
                post,
                endpoint: ENDPOINTS.STAGE_TO_INPUT,
                payload,
                index: false
            });
            const workflowPromise = tryLoadWorkflowToCanvas(payload);

            // Execute both in parallel (max performance)
            const [loaded, staged] = await Promise.all([workflowPromise, stagePromise]);

            if (loaded) {
                dndLog("drop canvas loaded workflow", { file: payload?.filename });
                // Staging has already completed in parallel; no further UI needed here.
                return;
            }

            const relativePath = staged?.relativePath;
            if (!relativePath) {
                dndLog("drop canvas stage failed");
                comfyToast(
                    `Failed to load file: "${payload?.filename}". Staging failed.`,
                    "error"
                );
                return;
            }
            dndLog("drop canvas staged", { value: relativePath });
            comfyToast(
                `Staged to input: ${relativePath}`,
                "success",
                4000
            );
            return;
        }

        event.preventDefault();
        event.stopImmediatePropagation?.();
        event.stopPropagation();
        clearHighlight(app, markCanvasDirty);

        const relativePath = await stageToInput({
            post,
            endpoint: ENDPOINTS.STAGE_TO_INPUT,
            payload,
            index: false
        });
        if (!relativePath) return;

        if (widget.type === "combo") ensureComboHasValue(widget, relativePath);
        widget.value = relativePath;
        try {
            widget.callback?.(widget.value);
        } catch {}

        markCanvasDirty(app);
        dndLog("drop inject", { node: node?.title, widget: widget?.name, value: relativePath });
    };

    const onDragLeave = () => {
        clearHighlight(app, markCanvasDirty);
        dndLog("dragleave");
    };

    window.addEventListener("dragover", onDragOver, true);
    window.addEventListener("drop", onDrop, true);
    window.addEventListener("dragleave", onDragLeave, true);

    const dispose = ({ force = false } = {}) => {
        const state = (() => {
            try {
                return window?.[DND_GLOBAL_KEY] || null;
            } catch {
                return null;
            }
        })();

        // Only uninstall if this instance is still the active one.
        if (!force && state?.dispose !== dispose) return;

        try {
            window.removeEventListener("dragover", onDragOver, true);
            window.removeEventListener("drop", onDrop, true);
            window.removeEventListener("dragleave", onDragLeave, true);
        } catch {}

        try {
            clearHighlight(app, markCanvasDirty);
        } catch {}

        try {
            if (window?.[DND_GLOBAL_KEY]?.dispose === dispose) {
                delete window[DND_GLOBAL_KEY];
            }
        } catch {}
    };

    try {
        window[DND_GLOBAL_KEY] = {
            initialized: true,
            version: DND_INSTANCE_VERSION,
            dispose
        };
    } catch {}

    return dispose;
};

export const DND_CONSTANTS = {
    DND_MIME
};
