export function createViewerLoupe({
    state,
    loupeCanvas,
    loupeWrap,
    getMediaNaturalSize,
    positionOverlayBox,
} = {}) {
    let loupeCtx = null;
    try {
        loupeCtx = loupeCanvas?.getContext?.("2d", { willReadFrequently: true });
    } catch {}

    const hide = () => {
        try {
            loupeWrap.style.display = "none";
        } catch {}
    };

    const redraw = (mediaEl, px, py, clientX, clientY) => {
        try {
            if (!state?.loupeEnabled) return;
            if (!loupeCtx) return;
            if (!mediaEl) return;

            const { w: aw, h: ah } = getMediaNaturalSize?.(mediaEl) || { w: 0, h: 0 };
            if (!(aw > 0 && ah > 0)) return;

            const size = Math.max(48, Math.min(240, Number(state.loupeSize) || 120));
            const mag = Math.max(2, Math.min(20, Number(state.loupeMagnification) || 8));
            try {
                if (loupeCanvas.width !== size) loupeCanvas.width = size;
                if (loupeCanvas.height !== size) loupeCanvas.height = size;
            } catch {}

            const region = Math.max(3, Math.floor(size / mag));
            const scale = mediaEl?.tagName === "CANVAS" ? Number(mediaEl._mjrPixelScale) || 1 : 1;
            const sourceW = mediaEl?.tagName === "CANVAS" ? Number(mediaEl.width) || 0 : aw;
            const sourceH = mediaEl?.tagName === "CANVAS" ? Number(mediaEl.height) || 0 : ah;
            if (!(sourceW > 0 && sourceH > 0)) return;

            const regionSrc = Math.max(1, Math.floor(region * scale));
            const halfSrc = Math.floor(regionSrc / 2);
            const cx = Math.floor((Number(px) || 0) * scale);
            const cy = Math.floor((Number(py) || 0) * scale);
            const sx = Math.max(0, Math.min(sourceW - regionSrc, cx - halfSrc));
            const sy = Math.max(0, Math.min(sourceH - regionSrc, cy - halfSrc));

            loupeCtx.imageSmoothingEnabled = false;
            loupeCtx.clearRect(0, 0, size, size);
            loupeCtx.drawImage(mediaEl, sx, sy, regionSrc, regionSrc, 0, 0, size, size);

            // Crosshair
            loupeCtx.strokeStyle = "rgba(255,255,255,0.75)";
            loupeCtx.lineWidth = 1;
            loupeCtx.beginPath();
            loupeCtx.moveTo(size / 2 + 0.5, 0);
            loupeCtx.lineTo(size / 2 + 0.5, size);
            loupeCtx.moveTo(0, size / 2 + 0.5);
            loupeCtx.lineTo(size, size / 2 + 0.5);
            loupeCtx.stroke();

            try {
                loupeWrap.style.display = "";
                loupeWrap.style.width = `${size}px`;
                loupeWrap.style.height = `${size}px`;
            } catch {}
            try {
                positionOverlayBox?.(loupeWrap, clientX, clientY, { offsetX: 18, offsetY: -size - 18 });
            } catch {}
        } catch {}
    };

    return { redraw, hide };
}

