export function createViewerGrid({
    gridCanvas,
    content,
    state,
    VIEWER_MODES,
    getPrimaryMedia,
    getViewportRect,
    clearCanvas,
} = {}) {
    const _getNaturalSize = (el) => {
        try {
            if (!el) return { w: 0, h: 0 };
            if (el instanceof HTMLCanvasElement) {
                const w = Number(el._mjrNaturalW) || Number(el.width) || 0;
                const h = Number(el._mjrNaturalH) || Number(el.height) || 0;
                if (w > 0 && h > 0) return { w, h };
            }
            const w = Number(el.videoWidth) || Number(el.naturalWidth) || 0;
            const h = Number(el.videoHeight) || Number(el.naturalHeight) || 0;
            if (w > 0 && h > 0) return { w, h };

            // Fallbacks (before processors report natural size).
            try {
                const sw = Number(state?._mediaW) || 0;
                const sh = Number(state?._mediaH) || 0;
                if (sw > 0 && sh > 0) return { w: sw, h: sh };
            } catch {}
            try {
                const cur = state?.assets?.[state?.currentIndex] || null;
                const aw = Number(cur?.width) || 0;
                const ah = Number(cur?.height) || 0;
                if (aw > 0 && ah > 0) return { w: aw, h: ah };
            } catch {}
            return { w: 0, h: 0 };
        } catch {
            return { w: 0, h: 0 };
        }
    };

    const _fitContainRect = (boxW, boxH, naturalW, naturalH) => {
        try {
            const bw = Number(boxW) || 0;
            const bh = Number(boxH) || 0;
            const nw = Number(naturalW) || 0;
            const nh = Number(naturalH) || 0;
            if (!(bw > 0 && bh > 0 && nw > 0 && nh > 0)) return { x: 0, y: 0, w: bw, h: bh };
            const s = Math.min(bw / nw, bh / nh);
            const w = nw * s;
            const h = nh * s;
            const x = (bw - w) / 2;
            const y = (bh - h) / 2;
            return { x, y, w, h };
        } catch {
            return { x: 0, y: 0, w: Number(boxW) || 0, h: Number(boxH) || 0 };
        }
    };

    const ensureCanvasSize = () => {
        try {
            const rect = getViewportRect?.();
            if (!rect) return { w: 0, h: 0, dpr: 1 };
            const dpr = Math.max(1, Math.min(3, Number(window.devicePixelRatio) || 1));
            const w = Math.max(1, Math.floor(rect.width * dpr));
            const h = Math.max(1, Math.floor(rect.height * dpr));
            try {
                if (gridCanvas?.width !== w) gridCanvas.width = w;
                if (gridCanvas?.height !== h) gridCanvas.height = h;
            } catch {}
            return { w, h, dpr };
        } catch {
            return { w: 0, h: 0, dpr: 1 };
        }
    };

    const _aspectFromFormat = (format, mediaEl, mediaRect) => {
        try {
            const f = String(format || "image");
            if (f === "image") {
                const nat = _getNaturalSize(mediaEl);
                const a = (Number(nat.w) || 0) / (Number(nat.h) || 1);
                if (Number.isFinite(a) && a > 0) return a;
                const b = (Number(mediaRect?.width) || 0) / (Number(mediaRect?.height) || 1);
                return Number.isFinite(b) && b > 0 ? b : 1;
            }
            if (f === "16:9") return 16 / 9;
            if (f === "9:16") return 9 / 16;
            if (f === "1:1") return 1;
            if (f === "4:3") return 4 / 3;
            if (f === "2.39") return 2.39;
            return 1;
        } catch {
            return 1;
        }
    };

    const _fitAspectInBox = (boxW, boxH, aspect) => {
        try {
            const bw = Number(boxW) || 0;
            const bh = Number(boxH) || 0;
            const a = Number(aspect) || 1;
            if (!(bw > 0 && bh > 0 && a > 0)) return { x: 0, y: 0, w: bw, h: bh };
            const boxA = bw / bh;
            let w = bw;
            let h = bh;
            if (a >= boxA) {
                w = bw;
                h = bw / a;
            } else {
                h = bh;
                w = bh * a;
            }
            const x = (bw - w) / 2;
            const y = (bh - h) / 2;
            return { x, y, w, h };
        } catch {
            return { x: 0, y: 0, w: Number(boxW) || 0, h: Number(boxH) || 0 };
        }
    };

    const _drawMaskOutside = (ctx, rect, alpha) => {
        try {
            const a = Math.max(0, Math.min(0.92, Number(alpha)));
            if (!(a > 0)) return;
            ctx.save();
            ctx.globalCompositeOperation = "source-over";
            ctx.fillStyle = `rgba(0,0,0,${a})`;
            ctx.fillRect(0, 0, gridCanvas.width, gridCanvas.height);
            ctx.globalCompositeOperation = "destination-out";
            ctx.fillStyle = "rgba(0,0,0,1)";
            ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
            ctx.restore();
        } catch {
            try {
                ctx.restore();
            } catch {}
        }
    };

    const _drawFormatOutline = (ctx, rect, dpr) => {
        try {
            ctx.save();
            try {
                ctx.setLineDash?.([Math.max(2, 4 * dpr), Math.max(2, 3 * dpr)]);
            } catch {}
            ctx.strokeStyle = "rgba(255,255,255,0.22)";
            ctx.lineWidth = Math.max(1, Math.floor(1 * dpr));
            ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
            ctx.restore();
        } catch {
            try {
                ctx.restore();
            } catch {}
        }
    };

    const redrawGrid = ({ w, h, dpr } = {}) => {
        try {
            const ctx = gridCanvas?.getContext?.("2d");
            if (!ctx) return;
            try {
                clearCanvas?.(ctx, w, h);
            } catch {}

            const mediaEl = getPrimaryMedia?.();
            if (!mediaEl) return;

            // IMPORTANT: overlays must not move with pan/zoom.
            // Compute the format rect purely from the viewport and the image aspect, NOT from the transformed media element rect.
            const vp = getViewportRect?.();
            if (!vp) return;
            const vpW = Number(vp.width) || 0;
            const vpH = Number(vp.height) || 0;
            if (!(vpW > 1 && vpH > 1)) return;

            const nat = _getNaturalSize(mediaEl);
            const base = _fitContainRect(vpW, vpH, nat.w, nat.h);
            const aspect = _aspectFromFormat(state?.overlayFormat, mediaEl, { width: base.w, height: base.h });
            const fmt = _fitAspectInBox(base.w, base.h, aspect);
            const fmtRectCss = {
                x: (base.x || 0) + (fmt.x || 0),
                y: (base.y || 0) + (fmt.y || 0),
                w: fmt.w || base.w,
                h: fmt.h || base.h,
            };

            const rect = {
                x: fmtRectCss.x * dpr,
                y: fmtRectCss.y * dpr,
                w: fmtRectCss.w * dpr,
                h: fmtRectCss.h * dpr,
            };
            if (!(rect.w > 1 && rect.h > 1)) return;

            // Optional format mask (dim outside chosen rect).
            try {
                if (state?.overlayMaskEnabled) {
                    _drawMaskOutside(ctx, rect, state?.overlayMaskOpacity ?? 0.65);
                    // The viewer background is often already dark; draw an outline so the format is visible.
                    _drawFormatOutline(ctx, rect, dpr);
                }
            } catch {}

            // Only draw guide lines in single mode (mask can apply in any mode).
            if (state?.mode !== VIEWER_MODES?.SINGLE) return;
            if ((state?.gridMode || 0) === 0) return;

            try {
                ctx.save();
                ctx.translate(rect.x, rect.y);

                ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
                ctx.lineWidth = Math.max(1, Math.floor(1 * dpr));

                const drawLine = (x1, y1, x2, y2) => {
                    try {
                        ctx.beginPath();
                        ctx.moveTo(Math.round(x1) + 0.5, Math.round(y1) + 0.5);
                        ctx.lineTo(Math.round(x2) + 0.5, Math.round(y2) + 0.5);
                        ctx.stroke();
                    } catch {}
                };

                if (state.gridMode === 1) {
                    // Thirds
                    drawLine(rect.w / 3, 0, rect.w / 3, rect.h);
                    drawLine((2 * rect.w) / 3, 0, (2 * rect.w) / 3, rect.h);
                    drawLine(0, rect.h / 3, rect.w, rect.h / 3);
                    drawLine(0, (2 * rect.h) / 3, rect.w, (2 * rect.h) / 3);
                } else if (state.gridMode === 2) {
                    // Center crosshair
                    drawLine(rect.w / 2, 0, rect.w / 2, rect.h);
                    drawLine(0, rect.h / 2, rect.w, rect.h / 2);
                } else if (state.gridMode === 3) {
                    // Safe zones (title/action safe)
                    const drawRect = (inset, alpha) => {
                        try {
                            ctx.save();
                            ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
                            const ix = Math.round(rect.w * inset);
                            const iy = Math.round(rect.h * inset);
                            const rw = Math.round(rect.w * (1 - inset * 2));
                            const rh = Math.round(rect.h * (1 - inset * 2));
                            ctx.strokeRect(ix + 0.5, iy + 0.5, rw, rh);
                        } catch {} finally {
                            try {
                                ctx.restore();
                            } catch {}
                        }
                    };
                    // Approx Nuke-like: action safe 90% (5%), title safe 80% (10%)
                    drawRect(0.05, 0.24);
                    drawRect(0.10, 0.18);
                } else if (state.gridMode === 4) {
                    // Golden ratio lines (0.382 / 0.618)
                    const g0 = 0.382;
                    const g1 = 1 - g0;
                    drawLine(rect.w * g0, 0, rect.w * g0, rect.h);
                    drawLine(rect.w * g1, 0, rect.w * g1, rect.h);
                    drawLine(0, rect.h * g0, rect.w, rect.h * g0);
                    drawLine(0, rect.h * g1, rect.w, rect.h * g1);
                }
            } catch {} finally {
                try {
                    ctx.restore();
                } catch {}
            }
        } catch {}
    };

    return { ensureCanvasSize, redrawGrid };
}
