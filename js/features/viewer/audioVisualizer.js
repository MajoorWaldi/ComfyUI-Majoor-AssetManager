import { APP_CONFIG } from "../../app/config.js";

function clamp(n, min, max) {
    const v = Number(n);
    if (!Number.isFinite(v)) return min;
    return Math.max(min, Math.min(max, v));
}

function resolveMode(modeOverride) {
    try {
        const direct = String(modeOverride || "").toLowerCase();
        if (direct === "simple" || direct === "artistic") return direct;
        // Legacy fallback if old state/config contains removed modes.
        if (direct === "webgl" || direct === "webgl3d") return "simple";
    } catch {}
    try {
        const raw = String(APP_CONFIG?.VIEWER_AUDIO_VISUALIZER_MODE || "simple").toLowerCase();
        if (raw === "artistic") return "artistic";
        if (raw === "webgl3d" || raw === "webgl") return "simple";
    } catch {}
    return "simple";
}

function createMinimal2DDrawer(canvas) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const sample = (freqData, tt) => {
        try {
            const idx = Math.max(0, Math.min(freqData.length - 1, Math.floor(tt * (freqData.length - 1))));
            return (Number(freqData[idx]) || 0) / 255;
        } catch {
            return 0;
        }
    };
    const vocalBand = (freqData, tt) => {
        // Approximate vocal presence in low-mid / presence region.
        // Weighted blend around ~0.18..0.46 normalized bins.
        const a = sample(freqData, 0.18 + tt * 0.18);
        const b = sample(freqData, 0.28 + tt * 0.16);
        const c = sample(freqData, 0.40 + tt * 0.06);
        const d = sample(freqData, 0.46 + tt * 0.03);
        return a * 0.28 + b * 0.36 + c * 0.24 + d * 0.12;
    };
    const bassBand = (freqData, tt) => {
        const a = sample(freqData, 0.01 + tt * 0.06);
        const b = sample(freqData, 0.04 + tt * 0.07);
        const c = sample(freqData, 0.09 + tt * 0.04);
        return a * 0.45 + b * 0.35 + c * 0.20;
    };
    const trebleBand = (freqData, tt) => {
        const a = sample(freqData, 0.64 + tt * 0.18);
        const b = sample(freqData, 0.78 + tt * 0.12);
        const c = sample(freqData, 0.92 + tt * 0.06);
        return a * 0.34 + b * 0.38 + c * 0.28;
    };

    return {
        draw(freqData, _timeData, tsMs = 0) {
            try {
                const w = canvas.width || 0;
                const h = canvas.height || 0;
                if (!(w > 1 && h > 1)) return;
                const tSec = Number(tsMs) * 0.001;
                const scroll = (tSec * 0.12) % 1;

                // Transparent clear (no gray veil).
                ctx.clearRect(0, 0, w, h);

                const cx = w * 0.5;
                const midY = h * 0.52;
                const count = Math.max(36, Math.min(140, Math.floor(w / 12)));
                const barSpan = Math.min(w * 0.56, count * 8);
                const step = barSpan / Math.max(1, count - 1);
                const startX = cx - barSpan * 0.5;
                const topAnchorY = midY - h * 0.08;

                // Top dotted line = vocals only; anchored and moving upward only.
                ctx.fillStyle = "rgba(255,255,255,0.95)";
                for (let i = 0; i < count; i++) {
                    const x = startX + i * step;
                    const t = i / Math.max(1, count - 1);
                    const tt = (t + scroll) % 1;
                    const vocal = vocalBand(freqData, tt);
                    const y = topAnchorY - vocal * h * 0.11;
                    const r = 1.2 + vocal * 1.2;
                    ctx.beginPath();
                    ctx.arc(x, y, r, 0, Math.PI * 2);
                    ctx.fill();
                }

                // Mid dotted anchor line
                ctx.fillStyle = "rgba(255,255,255,0.9)";
                for (let i = 0; i < count; i++) {
                    const x = startX + i * step;
                    const r = 1.6;
                    ctx.beginPath();
                    ctx.arc(x, midY, r, 0, Math.PI * 2);
                    ctx.fill();
                }

                // Bars = bass+treble, anchored at center and moving downward only.
                const barW = Math.max(1.5, step * 0.45);
                for (let i = 0; i < count; i++) {
                    const x = startX + i * step;
                    const t = i / Math.max(1, count - 1);
                    const tt = (t + scroll) % 1;
                    const bass = bassBand(freqData, tt);
                    const treble = trebleBand(freqData, tt);
                    const centerBoost = 1 - Math.abs(t * 2 - 1);
                    const shaped = Math.pow((bass * 0.62 + treble * 0.38) * 0.84 + centerBoost * 0.16, 1.1);
                    const lenDown = shaped * h * 0.32;

                    ctx.fillStyle = "rgba(255,255,255,0.96)";
                    ctx.fillRect(x - barW * 0.5, midY + 1, barW, lenDown);
                }
            } catch {}
        },
        destroy() {},
    };
}

function createMinimalWebGLDrawer(canvas, { pseudo3d = false } = {}) {
    let gl = null;
    try {
        gl = canvas.getContext("webgl", { antialias: true, alpha: false, preserveDrawingBuffer: false });
    } catch {
        gl = null;
    }
    if (!gl) return null;

    const vs = `
attribute vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;
    const fs = `
precision mediump float;
uniform vec4 uColor;
void main() {
  gl_FragColor = uColor;
}
`;

    const compile = (type, src) => {
        const sh = gl.createShader(type);
        if (!sh) return null;
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
            gl.deleteShader(sh);
            return null;
        }
        return sh;
    };

    const vsh = compile(gl.VERTEX_SHADER, vs);
    const fsh = compile(gl.FRAGMENT_SHADER, fs);
    if (!vsh || !fsh) return null;

    const program = gl.createProgram();
    if (!program) return null;
    gl.attachShader(program, vsh);
    gl.attachShader(program, fsh);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
    gl.useProgram(program);

    const aPos = gl.getAttribLocation(program, "aPos");
    const uColor = gl.getUniformLocation(program, "uColor");
    const buffer = gl.createBuffer();
    if (!buffer || aPos < 0 || !uColor) return null;

    const drawStrip = (verts, color) => {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
        gl.uniform4f(uColor, color[0], color[1], color[2], color[3]);
        gl.drawArrays(gl.LINE_STRIP, 0, Math.floor(verts.length / 2));
    };

    const sample = (freqData, tt) => {
        try {
            const idx = Math.max(0, Math.min(freqData.length - 1, Math.floor(tt * (freqData.length - 1))));
            return (Number(freqData[idx]) || 0) / 255;
        } catch {
            return 0;
        }
    };
    const vocalBand = (freqData, tt) => {
        const a = sample(freqData, 0.18 + tt * 0.18);
        const b = sample(freqData, 0.28 + tt * 0.16);
        const c = sample(freqData, 0.40 + tt * 0.06);
        const d = sample(freqData, 0.46 + tt * 0.03);
        return a * 0.28 + b * 0.36 + c * 0.24 + d * 0.12;
    };
    const bassBand = (freqData, tt) => {
        const a = sample(freqData, 0.01 + tt * 0.06);
        const b = sample(freqData, 0.04 + tt * 0.07);
        const c = sample(freqData, 0.09 + tt * 0.04);
        return a * 0.45 + b * 0.35 + c * 0.20;
    };
    const trebleBand = (freqData, tt) => {
        const a = sample(freqData, 0.64 + tt * 0.18);
        const b = sample(freqData, 0.78 + tt * 0.12);
        const c = sample(freqData, 0.92 + tt * 0.06);
        return a * 0.34 + b * 0.38 + c * 0.28;
    };

    return {
        draw(freqData, _timeData, tsMs = 0) {
            try {
                gl.viewport(0, 0, canvas.width || 1, canvas.height || 1);
                gl.clearColor(0, 0, 0, 1);
                gl.clear(gl.COLOR_BUFFER_BIT);

                const n = Math.max(48, Math.min(180, Math.floor((canvas.width || 640) / 7)));
                const t = Number(tsMs) * 0.001;
                // Top line (vocals): only upward from an anchor.
                const top = new Float32Array(n * 2);
                for (let i = 0; i < n; i++) {
                    const nx = i / Math.max(1, n - 1);
                    const x = nx * 2 - 1;
                    const vocal = vocalBand(freqData, nx);
                    const zLike = pseudo3d ? Math.sin(nx * Math.PI * 4 + t * 1.1) * 0.18 : 0;
                    const persp = pseudo3d ? 1 / (1 + Math.max(-0.7, zLike) * 0.8) : 1;
                    const anchor = 0.18;
                    const y = clamp((anchor + vocal * 0.32) * persp, -0.95, 0.95);
                    top[i * 2] = x;
                    top[i * 2 + 1] = y;
                }
                drawStrip(top, [1, 1, 1, 0.95]);

                // Lower bar profile (bass+treble): only downward from center.
                const down = new Float32Array(n * 2);
                for (let i = 0; i < n; i++) {
                    const nx = i / Math.max(1, n - 1);
                    const x = nx * 2 - 1;
                    const bass = bassBand(freqData, nx);
                    const treble = trebleBand(freqData, nx);
                    const mix = bass * 0.62 + treble * 0.38;
                    const zLike = pseudo3d ? Math.sin(nx * Math.PI * 3 + t * 1.0) * 0.14 : 0;
                    const persp = pseudo3d ? 1 / (1 + Math.max(-0.7, zLike) * 0.8) : 1;
                    const y = clamp((-mix * 0.62) * persp, -0.95, 0.0);
                    down[i * 2] = x;
                    down[i * 2 + 1] = y;
                }
                drawStrip(down, [1, 1, 1, 0.9]);
            } catch {}
        },
        destroy() {
            try { gl.deleteBuffer(buffer); } catch {}
            try { gl.deleteProgram(program); } catch {}
            try { gl.deleteShader(vsh); } catch {}
            try { gl.deleteShader(fsh); } catch {}
        },
    };
}

export function createAudioVisualizer({ canvas, audioEl, mode: modeOverride } = {}) {
    if (!canvas || !audioEl) return { destroy() {} };

    let raf = null;
    let disposed = false;
    let audioCtx = null;
    let source = null;
    let analyser = null;
    let freqData = null;
    let timeData = null;
    let drawer = null;
    let lastAt = 0;
    const targetFps = clamp(APP_CONFIG?.VIEWER_AUDIO_VIS_FPS ?? 24, 8, 60);
    const minDt = 1000 / targetFps;
    const mode = resolveMode(modeOverride);

    const resize = () => {
        try {
            const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
            const w = Math.max(32, Math.floor((canvas.clientWidth || 640) * dpr));
            const h = Math.max(24, Math.floor((canvas.clientHeight || 140) * dpr));
            if (canvas.width !== w) canvas.width = w;
            if (canvas.height !== h) canvas.height = h;
        } catch {}
    };

    const init = () => {
        if (disposed || analyser) return;
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return;
            audioCtx = new Ctx();
            source = audioCtx.createMediaElementSource(audioEl);
            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 1024;
            analyser.smoothingTimeConstant = 0.8;
            source.connect(analyser);
            analyser.connect(audioCtx.destination);
            freqData = new Uint8Array(analyser.frequencyBinCount);
            timeData = new Uint8Array(analyser.fftSize);

            // Unified minimalist renderer for all modes.
            drawer = createMinimal2DDrawer(canvas);
        } catch {
            analyser = null;
        }
    };

    const tick = (ts) => {
        if (disposed) return;
        try {
            raf = requestAnimationFrame(tick);
        } catch {
            raf = null;
            return;
        }
        if (!analyser || !drawer) return;
        if (ts - lastAt < minDt) return;
        lastAt = ts;
        try {
            resize();
            analyser.getByteFrequencyData(freqData);
            analyser.getByteTimeDomainData(timeData);
            drawer.draw(freqData, timeData, ts);
        } catch {}
    };

    const start = async () => {
        try {
            init();
            if (!audioCtx) return;
            if (audioCtx.state === "suspended") {
                try {
                    await audioCtx.resume();
                } catch {}
            }
            if (raf == null) raf = requestAnimationFrame(tick);
        } catch {}
    };

    const stop = () => {
        try {
            if (raf != null) cancelAnimationFrame(raf);
        } catch {}
        raf = null;
    };

    const onPlay = () => { void start(); };
    const onPause = () => stop();
    const onEnded = () => stop();
    const onResize = () => resize();

    try { resize(); } catch {}
    try {
        audioEl.addEventListener("play", onPlay, { passive: true });
        audioEl.addEventListener("pause", onPause, { passive: true });
        audioEl.addEventListener("ended", onEnded, { passive: true });
        window.addEventListener("resize", onResize, { passive: true });
    } catch {}

    return {
        destroy() {
            if (disposed) return;
            disposed = true;
            stop();
            try {
                audioEl.removeEventListener("play", onPlay);
                audioEl.removeEventListener("pause", onPause);
                audioEl.removeEventListener("ended", onEnded);
                window.removeEventListener("resize", onResize);
            } catch {}
            try { drawer?.destroy?.(); } catch {}
            try { source?.disconnect?.(); } catch {}
            try { analyser?.disconnect?.(); } catch {}
            try { audioCtx?.close?.(); } catch {}
            source = null;
            analyser = null;
            audioCtx = null;
            drawer = null;
        },
    };
}
