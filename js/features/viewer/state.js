export function clamp01(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
}

export function clamp(v, min, max) {
    const n = Number(v);
    if (!Number.isFinite(n)) return Number(min);
    return Math.max(Number(min), Math.min(Number(max), n));
}

export function createDefaultViewerState() {
    return {
        assets: [],
        currentIndex: 0,
        mode: "single",

        zoom: 1,
        panX: 0,
        panY: 0,
        targetZoom: 1,

        compareAsset: null,

        // Processing / analysis
        channel: "rgb",
        exposureEV: 0,
        gamma: 1.0,
        analysisMode: "none",
        zebraThreshold: 0.95,
        abCompareMode: "wipe",
        scopesMode: "off", // off|hist|wave|both

        // Overlay features
        gridMode: 0, // 0=off, 1=thirds, 2=center, 3=safe, 4=golden
        overlayMaskEnabled: false,
        overlayMaskOpacity: 0.65,
        overlayFormat: "image", // image|16:9|1:1|4:3|2.39|9:16
        probeEnabled: false,
        loupeEnabled: false,
        hudEnabled: true,
        distractionFree: false,
        loupeSize: 120,
        loupeMagnification: 8,
        genInfoOpen: true,
        audioVisualizerMode: "artistic", // simple|artistic

        // UX state
        _userInteracted: false,
        _panHintAt: 0,
        _panHintX: null,
        _panHintY: null,
        _panHintTimer: null,

        _prevBodyOverflow: "",
        _prevFocusedElement: null,
        _lastPointerX: null,
        _lastPointerY: null,
        _mediaW: 0,
        _mediaH: 0,
        _viewportCache: null,

        _probe: null,
        _videoControlsDestroy: null,
        _activeVideoEl: null,

        // A/B wipe state (for export)
        _abWipePercent: 50,

        // Scopes scheduling
        _scopesLastAt: 0,
    };
}
