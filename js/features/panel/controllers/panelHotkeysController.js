// Global state for suspended hotkeys (when dialogs/popovers are open)
// Using window global to make it accessible across modules
if (!window._mjrHotkeysState) {
    window._mjrHotkeysState = { suspended: false };
}

export function setHotkeysSuspended(suspended) {
    window._mjrHotkeysState.suspended = Boolean(suspended);
}

// Also attach to window for easy access from other modules
window.setHotkeysSuspended = setHotkeysSuspended;

export function createPanelHotkeysController({
    onTriggerScan,
    getScanContext,
    onToggleDetails,
    allowListKeys,
} = {}) {
    let panelFocused = false;
    let panelHovered = false;
    let boundEl = null;

    const allowed =
        allowListKeys instanceof Set
            ? allowListKeys
            : new Set([
                  " ",
                  "ArrowUp",
                  "ArrowDown",
                  "ArrowLeft",
                  "ArrowRight",
                  "PageUp",
                  "PageDown",
                  "Home",
                  "End",
                  "Enter",
                  "Escape",
                  "Tab",
              ]);

    const isPanelActive = () => panelFocused || panelHovered;

    const handlers = {
        focusin: () => {
            panelFocused = true;
        },
        focusout: () => {
            panelFocused = false;
        },
        mouseenter: () => {
            panelHovered = true;
        },
        mouseleave: () => {
            panelHovered = false;
        },
        keydown: (event) => {
            // Check if hotkeys are suspended (e.g. when dialogs/popovers are open)
            if (window._mjrHotkeysState?.suspended) return;

            // Check if viewer has hotkey priority
            if (window._mjrHotkeysState?.scope === "viewer") return;

            // Check if panel is active before processing hotkeys
            // This ensures hotkeys only work when the panel is hovered or focused
            if (!isPanelActive()) return;

            const lower = event.key?.toLowerCase?.() || "";
            const isTypingTarget =
                event.target?.isContentEditable ||
                event.target?.closest?.("input, textarea, select, [contenteditable='true']");

            // Ctrl/Cmd+S triggers an index scan for the current scope, without letting the
            // surrounding ComfyUI UI capture the shortcut (e.g. workflow save).
            if (lower === "s" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation?.();
                try {
                    const ctx = typeof getScanContext === "function" ? getScanContext() : null;
                    onTriggerScan?.(ctx);
                } catch {}
                return;
            }

            // D toggles the Details sidebar for the current selection.
            if (lower === "d" && !event.ctrlKey && !event.metaKey && !event.altKey) {
                if (isTypingTarget) return;
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation?.();
                try {
                    onToggleDetails?.();
                } catch {}
                return;
            }

            // For navigation keys, prevent ComfyUI global handlers from stealing focus/scroll.
            // Only intercept if panel is actually active.
            // Never intercept while typing in inputs (e.g. tags editor in the sidebar).
            if (allowed.has(event.key) && isPanelActive()) {
                if (isTypingTarget) return;
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation?.();
            }
        },
    };

    const bind = (el) => {
        if (!el || boundEl === el) return;
        if (boundEl) dispose();
        boundEl = el;

        try {
            boundEl.addEventListener("focusin", handlers.focusin);
            boundEl.addEventListener("focusout", handlers.focusout);
            boundEl.addEventListener("mouseenter", handlers.mouseenter);
            boundEl.addEventListener("mouseleave", handlers.mouseleave);
        } catch {}

        // Use global listener with capture phase for keydown to ensure it works regardless of focus
        try {
            window.addEventListener("keydown", handlers.keydown, { capture: true });
        } catch {}
    };

    const dispose = () => {
        if (!boundEl) return;
        try {
            boundEl.removeEventListener("focusin", handlers.focusin);
            boundEl.removeEventListener("focusout", handlers.focusout);
            boundEl.removeEventListener("mouseenter", handlers.mouseenter);
            boundEl.removeEventListener("mouseleave", handlers.mouseleave);
        } catch {}

        // Remove global listener for keydown
        try {
            window.removeEventListener("keydown", handlers.keydown, { capture: true });
        } catch {}
        boundEl = null;
    };

    return { bind, dispose };
}
