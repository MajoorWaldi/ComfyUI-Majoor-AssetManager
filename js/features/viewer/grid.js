export function createViewerGrid({
    gridCanvas,
    content,
    state,
    VIEWER_MODES,
    getPrimaryMedia,
    getViewportRect,
    clearCanvas,
} = {}) {
    const _getModeRoot = () => {
        try {
            const mode = state?.mode;
            if (mode === VIEWER_MODES?.AB_COMPARE) return content?.querySelector?.(".mjr-viewer-ab") || content || null;
            if (mode === VIEWER_MODES?.SIDE_BY_SIDE) return content?.querySelector?.(".mjr-viewer-sidebyside") || content || null;
            return content?.querySelector?.(".mjr-viewer-single") || content || null;
        } catch {
            return content || null;
        }
    };

    const _getBoxElForMedia = (mediaEl, root) => {
        try {
            if (!mediaEl) return root || null;
            const mode = state?.mode;
            if (mode === VIEWER_MODES?.SIDE_BY_SIDE || mode === VIEWER_MODES?.AB_COMPARE) {
                // Prefer the direct child panel/layer of the mode root (stable, not transformed by pan/zoom).
                let el = mediaEl;
                while (el && el !== root && el.parentElement) {
                    if (el.parentElement === root) return el;
                    el = el.parentElement;
                }
                return root || null;
            }
            return root || content || null;
        } catch {
            return root || content || null;
        }
    };

    const _getAssetForMedia = (mediaEl) => {
        try {
            const id = mediaEl?.dataset?.mjrAssetId;
            if (id == null || id === "") return state?.assets?.[state?.currentIndex] || null;
            const list = Array.isArray(state?.assets) ? state.assets : [];
            for (const a of list) {
                try {
                    if (a?.id != null && String(a.id) === String(id)) return a;
                } catch {}
            }
            return state?.assets?.[state?.currentIndex] || null;
        } catch {
            return state?.assets?.[state?.currentIndex] || null;
        }
    };

    const _getNaturalSize = (el, assetHint = null) => {
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

            // Prefer per-media asset dimensions (works in side-by-side / A-B while processors are still loading).
            try {
                const aw = Number(assetHint?.width) || 0;
                const ah = Number(assetHint?.height) || 0;
                if (aw > 0 && ah > 0) return { w: aw, h: ah };
            } catch {}

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

    const _fitHeightRect = (boxW, boxH, naturalW, naturalH) => {
        try {
            const bw = Number(boxW) || 0;
            const bh = Number(boxH) || 0;
            const nw = Number(naturalW) || 0;
            const nh = Number(naturalH) || 0;
            if (!(bw > 0 && bh > 0 && nw > 0 && nh > 0)) return { x: 0, y: 0, w: bw, h: bh };
            const aspect = nw / nh;
            if (!Number.isFinite(aspect) || aspect <= 0) return { x: 0, y: 0, w: bw, h: bh };
            const h = bh;
            const w = bh * aspect;
            const x = (bw - w) / 2;
            const y = 0;
            return { x, y, w, h };
        } catch {
            return { x: 0, y: 0, w: Number(boxW) || 0, h: Number(boxH) || 0 };
        }
    };

    const _transformRectAround = (rectCss, centerCss, zoom, panX, panY) => {
        try {
            const z = Math.max(0.1, Math.min(16, Number(zoom) || 1));
            const cx = Number(centerCss?.x) || 0;
            const cy = Number(centerCss?.y) || 0;
            const x = Number(rectCss?.x) || 0;
            const y = Number(rectCss?.y) || 0;
            const w = Number(rectCss?.w) || 0;
            const h = Number(rectCss?.h) || 0;
            const px = Number(panX) || 0;
            const py = Number(panY) || 0;
            return {
                x: cx + (x - cx) * z + px,
                y: cy + (y - cy) * z + py,
                w: w * z,
                h: h * z,
            };
        } catch {
            return { x: 0, y: 0, w: 0, h: 0 };
        }
    };

    const _drawHudSizeLabel = (ctx, rect, label, dpr) => {
        try {
            const r = rect || {};
            const x = Number(r.x) || 0;
            const y = Number(r.y) || 0;
            const w = Number(r.w) || 0;
            const h = Number(r.h) || 0;
            if (!(w > 8 && h > 8)) return;
            const text = String(label || "");
            if (!text) return;

            const padX = Math.max(6, Math.round(6 * dpr));
            const padY = Math.max(3, Math.round(3 * dpr));
            const fontPx = Math.max(11, Math.round(11 * dpr));

            ctx.save();
            ctx.font = `${fontPx}px var(--comfy-font, ui-sans-serif, system-ui)`;
            ctx.textAlign = "left";
            ctx.textBaseline = "top";

            const tw = Math.ceil(ctx.measureText(text).width);
            const bw = tw + padX * 2;
            const bh = fontPx + padY * 2;

            const bx = x + Math.max(2, Math.round(8 * dpr));
            const by = y + Math.max(2, Math.round(8 * dpr));

            ctx.fillStyle = "rgba(0,0,0,0.55)";
            ctx.strokeStyle = "rgba(255,255,255,0.18)";
            ctx.lineWidth = Math.max(1, Math.round(1 * dpr));
            ctx.beginPath();
            const rr = Math.max(6, Math.round(8 * dpr));
            ctx.moveTo(bx + rr, by);
            ctx.arcTo(bx + bw, by, bx + bw, by + bh, rr);
            ctx.arcTo(bx + bw, by + bh, bx, by + bh, rr);
            ctx.arcTo(bx, by + bh, bx, by, rr);
            ctx.arcTo(bx, by, bx + bw, by, rr);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = "rgba(255,255,255,0.92)";
            ctx.fillText(text, bx + padX, by + padY);
            ctx.restore();
        } catch {
            try {
                ctx.restore();
            } catch {}
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
            const rects = Array.isArray(rect) ? rect : [rect];
            for (const r of rects) {
                if (!r) continue;
                const x = Number(r.x) || 0;
                const y = Number(r.y) || 0;
                const w = Number(r.w) || 0;
                const h = Number(r.h) || 0;
                if (!(w > 1 && h > 1)) continue;
                ctx.fillRect(x, y, w, h);
            }
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

            const vp = getViewportRect?.();
            if (!vp) return;
            const vpW = Number(vp.width) || 0;
            const vpH = Number(vp.height) || 0;
            if (!(vpW > 1 && vpH > 1)) return;

            const root = _getModeRoot();
            const mode = state?.mode;
            const mediaEls = (() => {
                try {
                    if (mode === VIEWER_MODES?.SINGLE) return [getPrimaryMedia?.()].filter(Boolean);
                    // Multi-media modes: collect all .mjr-viewer-media elements in the active view root.
                    const els = root?.querySelectorAll?.(".mjr-viewer-media") || [];
                    return Array.from(els || []).filter(Boolean);
                } catch {
                    return [getPrimaryMedia?.()].filter(Boolean);
                }
            })();
            if (!mediaEls.length) return;

            // IMPORTANT: overlays must not move with pan/zoom.
            // Compute the format rect purely from the viewport and the image aspect, NOT from the transformed media element rect.
            const rects = [];
            const baseRects = [];
            for (const mediaEl of mediaEls) {
                try {
                    const boxEl = _getBoxElForMedia(mediaEl, root);
                    const boxRect = boxEl?.getBoundingClientRect?.() || null;
                    if (!boxRect) continue;

                    const boxW = Number(boxRect.width) || 0;
                    const boxH = Number(boxRect.height) || 0;
                    if (!(boxW > 1 && boxH > 1)) continue;

                    const assetHint = _getAssetForMedia(mediaEl);
                    const nat = _getNaturalSize(mediaEl, assetHint);

                    const base = _fitHeightRect(boxW, boxH, nat.w, nat.h);
                    const aspect = _aspectFromFormat(state?.overlayFormat, mediaEl, { width: base.w, height: base.h });
                    const fmt = _fitAspectInBox(base.w, base.h, aspect);

                    const ox = (Number(boxRect.left) || 0) - (Number(vp.left) || 0);
                    const oy = (Number(boxRect.top) || 0) - (Number(vp.top) || 0);

                    const baseRectCss0 = {
                        x: ox + (base.x || 0),
                        y: oy + (base.y || 0),
                        w: base.w || boxW,
                        h: base.h || boxH,
                    };
                    const fmtRectCss0 = {
                        x: baseRectCss0.x + (fmt.x || 0),
                        y: baseRectCss0.y + (fmt.y || 0),
                        w: fmt.w || baseRectCss0.w,
                        h: fmt.h || baseRectCss0.h,
                    };

                    const centerCss = { x: ox + boxW / 2, y: oy + boxH / 2 };
                    const z = Number(state?.zoom) || 1;
                    // Pan state is stored as "screen_pixels * zoom" (inflated) in panzoom.js to maintain stability.
                    // We must deflate it here to get back to screen pixels for the grid transform.
                    const panX = (Number(state?.panX) || 0) / z;
                    const panY = (Number(state?.panY) || 0) / z;

                    const baseRectCss = _transformRectAround(baseRectCss0, centerCss, z, panX, panY);
                    const fmtRectCss = _transformRectAround(fmtRectCss0, centerCss, z, panX, panY);

                    const rb = {
                        x: baseRectCss.x * dpr,
                        y: baseRectCss.y * dpr,
                        w: baseRectCss.w * dpr,
                        h: baseRectCss.h * dpr,
                        _sizeLabel: (() => {
                            try {
                                const hw = Number(assetHint?.width) || Number(nat.w) || 0;
                                const hh = Number(assetHint?.height) || Number(nat.h) || 0;
                                if (hw > 0 && hh > 0) return `${hw}x${hh}`;
                            } catch {}
                            return "";
                        })(),
                    };
                    const rf = {
                        x: fmtRectCss.x * dpr,
                        y: fmtRectCss.y * dpr,
                        w: fmtRectCss.w * dpr,
                        h: fmtRectCss.h * dpr,
                    };
                    if (rb.w > 1 && rb.h > 1) baseRects.push(rb);
                    if (rf.w > 1 && rf.h > 1) rects.push(rf);
                } catch {}
            }
            if (!rects.length && !baseRects.length) return;
            const formatRects = rects.length ? rects : baseRects;
            const rect = formatRects[0] || null;

            // Optional format mask (dim outside chosen rect).
            try {
                if (state?.overlayMaskEnabled) {
                    _drawMaskOutside(ctx, formatRects, state?.overlayMaskOpacity ?? 0.65);
                    // The viewer background is often already dark; draw outlines so the format is visible.
                    for (const r of formatRects) {
                        try {
                            _drawFormatOutline(ctx, r, dpr);
                        } catch {}
                    }
                }
            } catch {}

            // Nuke-like format box per image (single mode only).
            try {
                if (state?.hudEnabled && state?.mode === VIEWER_MODES?.SINGLE) {
                    for (const r of baseRects) {
                        try {
                            ctx.save();
                            ctx.strokeStyle = "rgba(255,255,255,0.22)";
                            ctx.lineWidth = Math.max(1, Math.floor(1 * dpr));
                            ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
                            ctx.restore();
                        } catch {
                            try {
                                ctx.restore();
                            } catch {}
                        }
                        try {
                            _drawHudSizeLabel(ctx, r, r._sizeLabel || "", dpr);
                        } catch {}
                    }
                }
            } catch {}

            // Only draw guide lines in single mode (mask can apply in any mode).
            if (state?.mode !== VIEWER_MODES?.SINGLE) return;
            if ((state?.gridMode || 0) === 0) return;
            if (!rect) return;

            try {
                ctx.save();
                ctx.translate(rect.x, rect.y);

                ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
                // Slightly thicker grid lines for readability.
                ctx.lineWidth = Math.max(2, Math.round(1.25 * dpr));

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
