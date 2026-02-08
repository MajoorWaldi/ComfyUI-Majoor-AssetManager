import { clamp01 } from "./state.js";

function srgbToLuma(r, g, b) {
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const HIST_BINS = 256;
const DEFAULT_HIST_SAMPLE_STEP = 3;
const DEFAULT_WF_COLUMNS = 220;
const DEFAULT_WF_ROWS = 110;
const DEFAULT_WF_SAMPLE_STEP = 2;
const PANEL_RADIUS_PX = 10;
const PANEL_BORDER_W = 1;
const PANEL_TITLE_FONT = "12px var(--comfy-font, ui-sans-serif, system-ui)";
const PANEL_TITLE_PAD_X = 10;
const PANEL_TITLE_PAD_Y = 8;
const PLOT_PAD = 10;
const PLOT_PAD_TOP = 28;
const PLOT_MIN_SIZE_PX = 10;
const HIST_LINE_W = 1.2;
const HIST_LUMA_LINE_W = 1.0;
const SCOPE_MAX_SRC_W = 420;
const SCOPE_MAX_SRC_H = 240;
const WAVE_MIN_GRID_W = 32;
const WAVE_MIN_GRID_H = 24;
const WAVE_CELL_ALPHA_BASE = 0.06;
const WAVE_CELL_ALPHA_MAX = 0.9;
const WAVE_CELL_ALPHA_SCALE = 0.9;

let _scopesTmpCanvas = null;
let _scopesTmpCtx = null;

function getScopesTmpCtx(w, h) {
    try {
        const dw = Math.max(1, Math.floor(Number(w) || 1));
        const dh = Math.max(1, Math.floor(Number(h) || 1));
        if (!_scopesTmpCanvas) _scopesTmpCanvas = document.createElement("canvas");
        if (_scopesTmpCanvas.width !== dw) _scopesTmpCanvas.width = dw;
        if (_scopesTmpCanvas.height !== dh) _scopesTmpCanvas.height = dh;
        if (!_scopesTmpCtx) _scopesTmpCtx = _scopesTmpCanvas.getContext("2d", { willReadFrequently: true });
        return _scopesTmpCtx || null;
    } catch {
        return null;
    }
}

function safeGetImageData(ctx, w, h) {
    try {
        return ctx.getImageData(0, 0, w, h);
    } catch {
        return null;
    }
}

function drawPanel(ctx, { x, y, w, h, title }) {
    try {
        ctx.save();
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.strokeStyle = "rgba(255,255,255,0.14)";
        ctx.lineWidth = PANEL_BORDER_W;
        const r = PANEL_RADIUS_PX;
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        if (title) {
            ctx.font = PANEL_TITLE_FONT;
            ctx.textAlign = "left";
            ctx.textBaseline = "top";
            ctx.fillStyle = "rgba(255,255,255,0.86)";
            ctx.fillText(String(title), x + PANEL_TITLE_PAD_X, y + PANEL_TITLE_PAD_Y);
        }
        ctx.restore();
    } catch {}
}

function computeHistogramFromImageData(img, { sampleStep = DEFAULT_HIST_SAMPLE_STEP } = {}) {
    const bins = HIST_BINS;
    const hr = new Uint32Array(bins);
    const hg = new Uint32Array(bins);
    const hb = new Uint32Array(bins);
    const hl = new Uint32Array(bins);
    try {
        const d = img?.data;
        if (!d) return { hr, hg, hb, hl, max: 1 };
        const step = Math.max(1, Math.floor(sampleStep));
        for (let i = 0; i < d.length; i += 4 * step) {
            const r = d[i] ?? 0;
            const g = d[i + 1] ?? 0;
            const b = d[i + 2] ?? 0;
            hr[r] += 1;
            hg[g] += 1;
            hb[b] += 1;
            const l = Math.max(0, Math.min(255, Math.round(srgbToLuma(r, g, b))));
            hl[l] += 1;
        }
        let max = 1;
        for (let i = 0; i < bins; i++) {
            max = Math.max(max, hr[i], hg[i], hb[i], hl[i]);
        }
        return { hr, hg, hb, hl, max };
    } catch {
        return { hr, hg, hb, hl, max: 1 };
    }
}

function drawHistogram(ctx, rect, hist, { channel = "rgb" } = {}) {
    try {
        const { x, y, w, h } = rect;
        const padTop = PLOT_PAD_TOP;
        const pad = PLOT_PAD;
        const gx = x + pad;
        const gy = y + padTop;
        const gw = w - pad * 2;
        const gh = h - padTop - pad;
        if (!(gw > PLOT_MIN_SIZE_PX && gh > PLOT_MIN_SIZE_PX)) return;

        ctx.save();
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = "rgba(255,255,255,0.10)";
        ctx.lineWidth = PANEL_BORDER_W;
        ctx.beginPath();
        ctx.rect(gx, gy, gw, gh);
        ctx.stroke();

        const max = Number(hist?.max) || 1;
        const drawChannel = (arr, color) => {
            ctx.strokeStyle = color;
            ctx.beginPath();
            for (let i = 0; i < HIST_BINS; i++) {
                const v = (arr?.[i] || 0) / max;
                const px = gx + (i / 255) * gw;
                const py = gy + gh - v * gh;
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.stroke();
        };

        const ch = String(channel || "rgb");
        ctx.lineWidth = HIST_LINE_W;
        if (ch === "r") {
            drawChannel(hist.hr, "rgba(255,90,90,0.95)");
        } else if (ch === "g") {
            drawChannel(hist.hg, "rgba(90,255,140,0.95)");
        } else if (ch === "b") {
            drawChannel(hist.hb, "rgba(90,160,255,0.95)");
        } else if (ch === "l") {
            drawChannel(hist.hl, "rgba(255,210,90,0.95)");
        } else {
            drawChannel(hist.hr, "rgba(255,90,90,0.95)");
            drawChannel(hist.hg, "rgba(90,255,140,0.95)");
            drawChannel(hist.hb, "rgba(90,160,255,0.95)");
        }
        // Luma overlay (subtle) when not explicitly luma-only.
        if (ch !== "l") {
            ctx.lineWidth = HIST_LUMA_LINE_W;
            drawChannel(hist.hl, "rgba(255,255,255,0.45)");
        }
        ctx.restore();
    } catch {}
}

function computeWaveformFromImageData(
    img,
    { columns = DEFAULT_WF_COLUMNS, rows = DEFAULT_WF_ROWS, sampleStep = DEFAULT_WF_SAMPLE_STEP } = {}
) {
    const gridW = Math.max(WAVE_MIN_GRID_W, Math.floor(columns));
    const gridH = Math.max(WAVE_MIN_GRID_H, Math.floor(rows));
    const out = new Uint16Array(gridW * gridH);
    try {
        const d = img?.data;
        const w = img?.width || 0;
        const h = img?.height || 0;
        if (!d || !(w > 0 && h > 0)) return { out, gridW, gridH, max: 1 };

        const step = Math.max(1, Math.floor(sampleStep));
        for (let y = 0; y < h; y += step) {
            const base = y * w * 4;
            for (let x = 0; x < w; x += step) {
                const nx = x / (w - 1 || 1);
                const col = Math.max(0, Math.min(gridW - 1, Math.floor(nx * (gridW - 1))));
                const i = base + x * 4;
                const r = d[i] ?? 0;
                const g = d[i + 1] ?? 0;
                const b = d[i + 2] ?? 0;
                const l = clamp01(srgbToLuma(r / 255, g / 255, b / 255));
                const yl = Math.max(0, Math.min(gridH - 1, Math.round((1 - l) * (gridH - 1))));
                out[yl * gridW + col] += 1;
            }
        }
        let max = 1;
        for (let i = 0; i < out.length; i++) max = Math.max(max, out[i]);
        return { out, gridW, gridH, max };
    } catch {
        return { out, gridW, gridH, max: 1 };
    }
}

function drawWaveform(ctx, rect, wf) {
    try {
        const { x, y, w, h } = rect;
        const padTop = PLOT_PAD_TOP;
        const pad = PLOT_PAD;
        const gx = x + pad;
        const gy = y + padTop;
        const gw = w - pad * 2;
        const gh = h - padTop - pad;
        if (!(gw > PLOT_MIN_SIZE_PX && gh > PLOT_MIN_SIZE_PX)) return;

        ctx.save();
        ctx.strokeStyle = "rgba(255,255,255,0.10)";
        ctx.lineWidth = PANEL_BORDER_W;
        ctx.beginPath();
        ctx.rect(gx, gy, gw, gh);
        ctx.stroke();

        const gridW = wf?.gridW || 0;
        const gridH = wf?.gridH || 0;
        const data = wf?.out;
        const max = Number(wf?.max) || 1;
        if (!data || !(gridW > 0 && gridH > 0)) return;

        for (let yy = 0; yy < gridH; yy++) {
            for (let xx = 0; xx < gridW; xx++) {
                const v = (data[yy * gridW + xx] || 0) / max;
                if (v <= 0) continue;
                const px = gx + (xx / (gridW - 1 || 1)) * gw;
                const py = gy + (yy / (gridH - 1 || 1)) * gh;
                const a = Math.min(WAVE_CELL_ALPHA_MAX, WAVE_CELL_ALPHA_BASE + v * WAVE_CELL_ALPHA_SCALE);
                ctx.fillStyle = `rgba(255,255,255,${a})`;
                ctx.fillRect(px, py, Math.max(1, gw / gridW), Math.max(1, gh / gridH));
            }
        }
        ctx.restore();
    } catch {}
}

/**
 * Draw lightweight scopes (RGB histogram + luma waveform) from a source canvas.
 * Must never throw.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{w:number,h:number}} viewport
 * @param {HTMLCanvasElement} sourceCanvas
 * @param {{mode?: 'hist'|'wave'|'both'}} opts
 */
export function drawScopesLight(ctx, viewport, sourceCanvas, opts = {}) {
    try {
        const mode = String(opts?.mode || "both");
        const channel = String(opts?.channel || "rgb");
        if (!ctx || !viewport || !sourceCanvas) return;
        if (mode === "off") return;

        const srcW = Number(sourceCanvas.width) || 0;
        const srcH = Number(sourceCanvas.height) || 0;
        if (!(srcW > 1 && srcH > 1)) return;

        // Downscale to keep work bounded and stable.
        const s = Math.max(srcW / SCOPE_MAX_SRC_W, srcH / SCOPE_MAX_SRC_H, 1);
        const dw = Math.max(1, Math.floor(srcW / s));
        const dh = Math.max(1, Math.floor(srcH / s));

        const tctx = getScopesTmpCtx(dw, dh);
        if (!tctx) return;
        try {
            tctx.clearRect(0, 0, dw, dh);
            tctx.drawImage(sourceCanvas, 0, 0, dw, dh);
        } catch {
            return;
        }
        const img = safeGetImageData(tctx, dw, dh);
        if (!img) return;

        const pad = 10;
        const panelW = Math.min(520, Math.max(320, Math.floor(viewport.w * 0.36)));
        const panelH = Math.min(260, Math.max(160, Math.floor(viewport.h * 0.22)));

        const baseX = viewport.w - panelW - pad;
        const baseY = viewport.h - panelH - pad;

        if (mode === "hist" || mode === "both") {
            const rect = { x: baseX, y: baseY, w: panelW, h: panelH };
            const title =
                channel === "r"
                    ? "Histogram (R)"
                    : channel === "g"
                      ? "Histogram (G)"
                      : channel === "b"
                        ? "Histogram (B)"
                        : channel === "l"
                          ? "Histogram (Luma)"
                          : "Histogram (RGB + Luma)";
            drawPanel(ctx, { ...rect, title });
            const hist = computeHistogramFromImageData(img, { sampleStep: 2 });
            drawHistogram(ctx, rect, hist, { channel });
        }
        if (mode === "wave" || mode === "both") {
            const y = mode === "both" ? baseY - panelH - 8 : baseY;
            const rect = { x: baseX, y, w: panelW, h: panelH };
            drawPanel(ctx, { ...rect, title: "Waveform (Luma)" });
            const wf = computeWaveformFromImageData(img, { columns: 240, rows: 120, sampleStep: 2 });
            drawWaveform(ctx, rect, wf);
        }
    } catch {}
}
