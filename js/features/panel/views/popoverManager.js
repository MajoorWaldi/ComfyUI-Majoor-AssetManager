export function createPopoverManager(container) {
    const openPopovers = new Map();
    let resizeObserver = null;
    let repositionRaf = 0;
    let dismissWhitelist = [];
    let containerScrollHandlerBound = false;
    let windowScrollHandlerBound = false;
    let windowResizeHandlerBound = false;
    let repositionController = new AbortController();

    const POPOVER_GAP_PX = 8;
    const POPOVER_PAD_PX = 8;
    const POPOVER_MIN_WIDTH_PX = 200;
    const POPOVER_MAX_WIDTH_PX = 360;
    const POPOVER_DEFAULT_WIDTH_PX = 280;
    const POPOVER_BOTTOM_SAFETY_PX = 80;
    const POPOVER_MIN_HEIGHT_PX = 140;

    const attachPopoverToPortal = (popover) => {
        if (!popover || !(popover instanceof HTMLElement)) return;
        if (!popover._mjrPortal) {
            popover._mjrPortal = {
                parent: popover.parentNode,
                nextSibling: popover.nextSibling
            };
        }
        popover.classList.add("mjr-popover-portal");
        try {
            document.body.appendChild(popover);
        } catch {}
    };

    const restorePopoverFromPortal = (popover) => {
        const info = popover?._mjrPortal;
        if (!info) return;
        popover.classList.remove("mjr-popover-portal");
        try {
            const parent = info.parent;
            if (parent && parent instanceof HTMLElement) {
                if (info.nextSibling && info.nextSibling.parentNode === parent) {
                    parent.insertBefore(popover, info.nextSibling);
                } else {
                    parent.appendChild(popover);
                }
            }
        } catch {}
    };

    const positionPopover = (popover, anchor) => {
        if (!popover || !anchor) return;
        try {
            const anchorRect = anchor.getBoundingClientRect();
            const panelRect = container.getBoundingClientRect();

            attachPopoverToPortal(popover);

            popover.style.position = "fixed";
            popover.style.margin = "0";

            const maxWidth = Math.max(
                POPOVER_MIN_WIDTH_PX,
                Math.min(
                    POPOVER_MAX_WIDTH_PX,
                    panelRect.width - POPOVER_PAD_PX * 2,
                    window.innerWidth - POPOVER_PAD_PX * 2
                )
            );
            popover.style.maxWidth = `${maxWidth}px`;

            const popW = popover.offsetWidth || Math.min(POPOVER_DEFAULT_WIDTH_PX, maxWidth);
            const popH = popover.offsetHeight || 1;

            // Align to the anchor's left edge (ComfyUI-like), then clamp inside the panel.
            let left = anchorRect.left;
            left = Math.max(
                panelRect.left + POPOVER_PAD_PX,
                Math.min(left, panelRect.right - popW - POPOVER_PAD_PX)
            );

            let top = anchorRect.bottom + POPOVER_GAP_PX;
            const bottomLimit = Math.min(panelRect.bottom, window.innerHeight) - POPOVER_PAD_PX;
            const topLimit = Math.max(panelRect.top, 0) + POPOVER_PAD_PX;

            if (top + popH > bottomLimit && anchorRect.top - POPOVER_GAP_PX - popH >= topLimit) {
                top = anchorRect.top - POPOVER_GAP_PX - popH;
            }

            top = Math.max(topLimit, Math.min(top, bottomLimit - POPOVER_BOTTOM_SAFETY_PX));
            const availableBelow = bottomLimit - top;
            popover.style.maxHeight = `${Math.max(POPOVER_MIN_HEIGHT_PX, availableBelow)}px`;
            popover.style.overflow = "auto";

            popover.style.left = `${Math.round(left)}px`;
            popover.style.top = `${Math.round(top)}px`;
        } catch {}
    };

    const scheduleReposition = () => {
        if (!openPopovers.size) return;
        if (repositionRaf) cancelAnimationFrame(repositionRaf);
        repositionRaf = requestAnimationFrame(() => {
            repositionRaf = 0;
            for (const item of openPopovers.values()) positionPopover(item.popover, item.anchor);
        });
    };

    const ensureRepositionListeners = () => {
        if (!openPopovers.size) return;
        try {
            if (!windowResizeHandlerBound) {
            window.addEventListener("resize", scheduleReposition, { passive: true, signal: repositionController.signal });
                windowResizeHandlerBound = true;
            }
        } catch {}
        try {
            if (!windowScrollHandlerBound) {
                // Scroll doesn't bubble; use capture to catch nested scroll containers.
            window.addEventListener("scroll", scheduleReposition, { passive: true, capture: true, signal: repositionController.signal });
                windowScrollHandlerBound = true;
            }
        } catch {}
        try {
            if (!resizeObserver) {
                resizeObserver = new ResizeObserver(scheduleReposition);
                resizeObserver.observe(container);
            }
        } catch {}
        try {
            if (!containerScrollHandlerBound) {
                // Bind to panel root as a fallback when window capture doesn't fire reliably.
                container.addEventListener("scroll", scheduleReposition, { passive: true });
                containerScrollHandlerBound = true;
            }
        } catch {}
    };

    const maybeRemoveRepositionListeners = () => {
        if (openPopovers.size) return;
        try {
            if (windowResizeHandlerBound) window.removeEventListener("resize", scheduleReposition);
        } catch {}
        windowResizeHandlerBound = false;
        try {
            if (windowScrollHandlerBound) window.removeEventListener("scroll", scheduleReposition, { capture: true });
        } catch {}
        // Safari/Chromium ignore the options object mismatch sometimes; best-effort extra removal.
        try {
            if (windowScrollHandlerBound) window.removeEventListener("scroll", scheduleReposition, true);
        } catch {}
        windowScrollHandlerBound = false;
        try {
            if (containerScrollHandlerBound) container.removeEventListener("scroll", scheduleReposition);
        } catch {}
        containerScrollHandlerBound = false;
        try {
            if (resizeObserver) resizeObserver.disconnect();
        } catch {}
        resizeObserver = null;
        try {
            repositionController.abort();
        } catch {}
        repositionController = new AbortController();
    };

    const close = (popover) => {
        if (!popover) return;
        try {
            popover.style.display = "none";
        } catch {}
        try {
            restorePopoverFromPortal(popover);
        } catch {}
        openPopovers.delete(popover);
        maybeRemoveRepositionListeners();
    };

    const open = (popover, anchor) => {
        if (!popover || !anchor) return;
        openPopovers.set(popover, { popover, anchor });
        ensureRepositionListeners();
        positionPopover(popover, anchor);
        scheduleReposition();
    };

    const toggle = (popover, anchor) => {
        if (!popover || !anchor) return;
        const isOpen = openPopovers.has(popover) || popover.style.display === "block";
        const next = isOpen ? "none" : "block";
        popover.style.display = next;
        if (next !== "none") open(popover, anchor);
        else close(popover);
    };

    const closeAll = () => {
        for (const item of openPopovers.values()) {
            try {
                restorePopoverFromPortal(item.popover);
            } catch {}
        }
        for (const popover of Array.from(openPopovers.keys())) close(popover);
        openPopovers.clear();
        maybeRemoveRepositionListeners();
    };

    const setDismissWhitelist = (elements) => {
        dismissWhitelist = Array.isArray(elements) ? elements.filter(Boolean) : [];
    };

    const onDocMouseDown = (event) => {
        const target = event.target;
        if (!target) return;
        // Clicking inside an open popover (or its anchor) should not dismiss it.
        for (const item of openPopovers.values()) {
            try {
                if (item?.popover && item.popover.contains(target)) return;
            } catch {}
            try {
                if (item?.anchor && item.anchor.contains(target)) return;
            } catch {}
        }
        for (const el of dismissWhitelist) {
            try {
                if (el && typeof el.contains === "function" && el.contains(target)) return;
            } catch {}
        }
        closeAll();
    };

    const init = () => {
        document.addEventListener("mousedown", onDocMouseDown);
    };

    const dispose = () => {
        try {
            document.removeEventListener("mousedown", onDocMouseDown);
        } catch {}
        try {
            maybeRemoveRepositionListeners();
        } catch {}
        try {
            repositionController.abort();
        } catch {}
        repositionController = new AbortController();
        try {
            closeAll();
        } catch {}
    };

    init();

    return {
        open,
        close,
        toggle,
        closeAll,
        scheduleReposition,
        setDismissWhitelist,
        dispose
    };
}

export function getPopoverManagerForElement(el) {
    try {
        const host = el?.closest?.(".mjr-am-container");
        return host?._mjrPopoverManager || null;
    } catch {}
    return null;
}
