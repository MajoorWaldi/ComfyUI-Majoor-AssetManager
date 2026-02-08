import { safeAddListener, safeCall } from "./lifecycle.js";

export function installViewerProbe({
    overlay,
    content,
    state,
    VIEWER_MODES,
    getPrimaryMedia,
    getMediaNaturalSize,
    _getViewportRect,
    positionOverlayBox,
    probeTooltip,
    loupeWrap,
    onLoupeRedraw,
    lifecycle,
} = {}) {
    const unsubs = lifecycle?.unsubs || [];

    const sampleCanvas = document.createElement("canvas");
    sampleCanvas.width = 1;
    sampleCanvas.height = 1;
    let sampleCtx = null;
    try {
        sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true });
    } catch {}

    let probeRAF = null;
    let lastX = null;
    let lastY = null;

    const hideProbe = () => {
        try {
            probeTooltip.style.display = "none";
        } catch {}
        try {
            loupeWrap.style.display = "none";
        } catch {}
        try {
            state._probe = null;
        } catch {}
    };

    const formatProbeText = (p) => {
        try {
            const x = p?.x;
            const y = p?.y;
            const r = p?.r;
            const g = p?.g;
            const b = p?.b;
            const a = p?.a;
            const raw = Array.isArray(p?.raw) ? p.raw : null;
            const lin = Array.isArray(p?.lin) ? p.lin : null;
            const scale = Number(p?.scale);
            const fmt = (v) => {
                const n = Number(v);
                if (!Number.isFinite(n)) return "?";
                return n.toFixed(3);
            };
            const hex =
                r != null && g != null && b != null
                    ? `#${[r, g, b]
                          .map((v) => {
                              const n = Math.max(0, Math.min(255, Number(v) || 0));
                              return n.toString(16).padStart(2, "0");
                          })
                          .join("")}`
                    : "";
            const scaleNote =
                Number.isFinite(scale) && scale > 0 && scale < 0.999 ? ` (proc ${(scale * 100).toFixed(0)}%)` : "";
            const lines = [];
            lines.push(`X: ${x ?? "?"}  Y: ${y ?? "?"}${scaleNote}`);
            lines.push(`RGBA8: ${r ?? "?"} ${g ?? "?"} ${b ?? "?"} ${a ?? "?"}`);
            if (raw && raw.length >= 3) {
                lines.push(`RGB: ${fmt(raw[0])} ${fmt(raw[1])} ${fmt(raw[2])}`);
            }
            if (lin && lin.length >= 3) {
                lines.push(`HDR: ${fmt(lin[0])} ${fmt(lin[1])} ${fmt(lin[2])}`);
            }
            if (hex) lines.push(hex);
            return lines.join("\n");
        } catch {
            return "";
        }
    };

    const samplePixel = (mediaEl, px, py) => {
        if (!sampleCtx) return null;
        try {
            sampleCtx.clearRect(0, 0, 1, 1);
        } catch {}
        try {
            let sx = Number(px) || 0;
            let sy = Number(py) || 0;
            if (mediaEl?.tagName === "CANVAS") {
                const scale = Number(mediaEl._mjrPixelScale) || 1;
                sx = Math.floor(sx * scale);
                sy = Math.floor(sy * scale);
            }
            sampleCtx.drawImage(mediaEl, sx, sy, 1, 1, 0, 0, 1, 1);
            const data = sampleCtx.getImageData(0, 0, 1, 1)?.data;
            if (!data || data.length < 4) return null;
            return { r: data[0], g: data[1], b: data[2], a: data[3] };
        } catch {
            return null;
        }
    };

    const updateProbeAt = (clientX, clientY) => {
        try {
            if (overlay?.style?.display === "none") return hideProbe();
            if (state?.mode !== VIEWER_MODES?.SINGLE) return hideProbe();
            if (!state?.probeEnabled && !state?.loupeEnabled) return hideProbe();

            const mediaEl = getPrimaryMedia?.();
            if (!mediaEl) return hideProbe();

            const rect = mediaEl.getBoundingClientRect();
            if (!rect || !(rect.width > 2 && rect.height > 2)) return hideProbe();

            const x = (Number(clientX) || 0) - rect.left;
            const y = (Number(clientY) || 0) - rect.top;
            if (x < 0 || y < 0 || x > rect.width || y > rect.height) return hideProbe();

            const { w: aw, h: ah } = getMediaNaturalSize?.(mediaEl) || { w: 0, h: 0 };
            if (!(aw > 0 && ah > 0)) return hideProbe();

            const nx = x / rect.width;
            const ny = y / rect.height;
            const px = Math.max(0, Math.min(aw - 1, Math.floor(nx * aw)));
            const py = Math.max(0, Math.min(ah - 1, Math.floor(ny * ah)));

            let p = null;
            if (state?.probeEnabled) {
                try {
                    const proc = mediaEl?._mjrProc;
                    if (proc?.sampleAtOriginal) {
                        const s = proc.sampleAtOriginal(px, py);
                        if (s) p = { x: px, y: py, ...s };
                    }
                } catch {}
                if (!p) {
                    const rgba = samplePixel(mediaEl, px, py);
                    if (rgba) p = { x: px, y: py, ...rgba };
                }
            }
            if (!p) p = { x: px, y: py };
            try {
                state._probe = p;
            } catch {}

            if (state?.probeEnabled) {
                try {
                    probeTooltip.textContent = formatProbeText(p);
                    probeTooltip.style.display = "";
                } catch {}
                safeCall(() => positionOverlayBox?.(probeTooltip, clientX, clientY, { offsetX: 18, offsetY: 18 }));
            } else {
                try {
                    probeTooltip.style.display = "none";
                } catch {}
            }

            if (state?.loupeEnabled) {
                safeCall(() => onLoupeRedraw?.(mediaEl, px, py, clientX, clientY));
            } else {
                try {
                    loupeWrap.style.display = "none";
                } catch {}
            }
        } catch {}
    };

    const scheduleProbe = (clientX, clientY) => {
        lastX = clientX;
        lastY = clientY;
        try {
            if (probeRAF != null) return;
            probeRAF = requestAnimationFrame(() => {
                probeRAF = null;
                updateProbeAt(lastX, lastY);
            });
        } catch {}
    };

    try {
        if (content && !content._mjrProbeBound) {
            const onProbeMove = (e) => {
                try {
                    scheduleProbe(e.clientX, e.clientY);
                } catch {}
            };
            const onProbeLeave = () => {
                hideProbe();
            };
            unsubs.push(safeAddListener(content, "mousemove", onProbeMove, { passive: true, capture: true }));
            unsubs.push(safeAddListener(content, "mouseleave", onProbeLeave, { passive: true, capture: true }));
            content._mjrProbeBound = true;
        }
    } catch {}

    return {
        hide: hideProbe,
        dispose: () => {
            try {
                if (probeRAF != null) cancelAnimationFrame(probeRAF);
            } catch {}
            probeRAF = null;
            hideProbe();
        },
    };
}

