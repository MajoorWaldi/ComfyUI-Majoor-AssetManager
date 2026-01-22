/**
 * Context Menu Core
 *
 * Shared primitives for all Majoor context menus (grid/viewer/collections).
 * Avoids duplicated DOM + event wiring and prevents selector collisions.
 */

export const MENU_Z_INDEX = Object.freeze({
    MAIN: 10001,
    SUBMENU: 10002,
    POPOVER: 10003,
    COLLECTIONS: 10005,
});

const _DEFAULT_Z = MENU_Z_INDEX.MAIN;

function _asClassName(value) {
    const s = String(value || "").trim();
    if (!s) return "";
    return s.startsWith(".") ? s.slice(1) : s;
}

export function safeEscapeSelector(value) {
    const str = String(value ?? "");
    try {
        if (typeof CSS?.escape === "function") return CSS.escape(str);
    } catch {}
    // Fallback: escape special CSS selector characters (conservative).
    return str.replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, "\\$1");
}

export function destroyMenu(menu) {
    if (!menu) return;
    try {
        menu._mjrAbortController?.abort?.();
    } catch {}
    try {
        menu._mjrAbortController = null;
    } catch {}
    try {
        menu._mjrOnHideCallbacks = [];
    } catch {}
    try {
        menu._mjrSessionCleanup = null;
    } catch {}
    try {
        menu.remove?.();
    } catch {}
}

export function setMenuSessionCleanup(menu, fn) {
    if (!menu) return;
    try {
        menu._mjrSessionCleanup = typeof fn === "function" ? fn : null;
    } catch {}
}

export function getOrCreateMenu({
    selector,
    className,
    minWidth = 220,
    zIndex = _DEFAULT_Z,
    onHide = null,
} = {}) {
    const sel = String(selector || "").trim();
    if (!sel) {
        console.warn("[MenuCore] getOrCreateMenu: missing selector");
        return null;
    }

    const existing = document.querySelector(sel);
    if (existing) {
        try {
            if (!Array.isArray(existing._mjrOnHideCallbacks)) existing._mjrOnHideCallbacks = [];
            if (typeof onHide === "function") existing._mjrOnHideCallbacks.push(onHide);
        } catch {}
        return existing;
    }

    const menu = document.createElement("div");
    menu.className = `${_asClassName(className) || _asClassName(sel)} mjr-context-menu`;
    try {
        menu.setAttribute("role", "menu");
        menu.setAttribute("aria-label", "Context menu");
    } catch {}
    // Prefer CSS for visuals; keep only dynamic values inline (width + z-index).
    try {
        menu.style.position = "fixed";
        menu.style.display = "none";
        menu.style.minWidth = `${Math.max(180, Number(minWidth) || 220)}px`;
        menu.style.zIndex = String(Number(zIndex) || _DEFAULT_Z);
    } catch {}

    const ac = new AbortController();
    menu._mjrAbortController = ac;

    try {
        menu._mjrOnHideCallbacks = [];
        if (typeof onHide === "function") menu._mjrOnHideCallbacks.push(onHide);
    } catch {}

    const runOnHide = () => {
        try {
            const fn = menu._mjrSessionCleanup;
            if (typeof fn === "function") {
                try {
                    fn();
                } catch (err) {
                    console.error("[MenuCore] Session cleanup failed:", err);
                }
                try {
                    menu._mjrSessionCleanup = null;
                } catch {}
            }
        } catch {}

        try {
            const list = Array.isArray(menu._mjrOnHideCallbacks) ? menu._mjrOnHideCallbacks : [];
            for (const fn of list) {
                try {
                    fn?.();
                } catch (err) {
                    console.error("[MenuCore] onHide failed:", err);
                }
            }
        } catch {}
    };

    const hide = () => {
        try {
            menu.style.display = "none";
        } catch {}
        runOnHide();
    };

    menu._mjrHide = hide;

    document.addEventListener(
        "click",
        (e) => {
            if (!menu.contains(e.target)) hide();
        },
        { signal: ac.signal, capture: true }
    );
    document.addEventListener(
        "keydown",
        (e) => {
            if (e.key === "Escape") hide();
        },
        { signal: ac.signal, capture: true }
    );
    document.addEventListener("scroll", hide, { capture: true, passive: true, signal: ac.signal });

    document.body.appendChild(menu);
    return menu;
}

export function hideMenu(menu) {
    try {
        if (typeof menu?._mjrHide === "function") {
            menu._mjrHide();
            return;
        }
        menu.style.display = "none";
    } catch {}
}

export function clearMenu(menu) {
    try {
        menu.replaceChildren();
    } catch {}
    try {
        menu.innerHTML = "";
    } catch {}
}

export function showMenuAt(menu, x, y) {
    menu.style.display = "block";
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    const rect = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let fx = x;
    let fy = y;
    if (x + rect.width > vw) fx = vw - rect.width - 10;
    if (y + rect.height > vh) fy = vh - rect.height - 10;

    menu.style.left = `${Math.max(8, fx)}px`;
    menu.style.top = `${Math.max(8, fy)}px`;
}

export function createMenuItem(label, iconClass, rightHint, onClick, { disabled = false } = {}) {
    const item = document.createElement("div");
    item.className = "mjr-context-menu-item";
    try {
        item.setAttribute("role", "menuitem");
        item.setAttribute("tabindex", disabled ? "-1" : "0");
        item.setAttribute("aria-disabled", disabled ? "true" : "false");
    } catch {}
    item.style.cssText = `
        padding: 8px 14px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        cursor: ${disabled ? "default" : "pointer"};
        color: var(--fg-color);
        font-size: 13px;
        opacity: ${disabled ? "0.45" : "1"};
        transition: background 0.15s;
        user-select: none;
    `;

    const left = document.createElement("div");
    left.style.cssText = "display:flex; align-items:center; gap:10px;";
    if (iconClass) {
        const iconEl = document.createElement("i");
        iconEl.className = iconClass;
        iconEl.style.cssText = "width:16px; text-align:center; opacity:0.8;";
        left.appendChild(iconEl);
    }
    const labelEl = document.createElement("span");
    labelEl.textContent = label;
    left.appendChild(labelEl);
    item.appendChild(left);

    if (rightHint) {
        const hint = document.createElement("span");
        hint.textContent = rightHint;
        hint.style.cssText = "font-size: 11px; opacity: 0.55; margin-left: 16px;";
        item.appendChild(hint);
    }

    item.addEventListener("mouseenter", () => {
        if (!disabled) item.style.background = "var(--comfy-input-bg)";
    });
    item.addEventListener("mouseleave", () => {
        item.style.background = "transparent";
    });

    item.addEventListener("click", async (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (disabled) return;
        if (item.dataset?.executing === "1") return;
        try {
            item.dataset.executing = "1";
            item.style.pointerEvents = "none";
            item.style.opacity = "0.7";
        } catch {}
        try {
            await onClick?.();
        } catch (err) {
            console.error("[ContextMenu] Action failed:", err);
        } finally {
            try {
                item.dataset.executing = "0";
                item.style.pointerEvents = "";
                item.style.opacity = disabled ? "0.45" : "1";
            } catch {}
        }
    });

    item.addEventListener("keydown", (e) => {
        if (disabled) return;
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            item.click();
        }
    });

    return item;
}

export function createMenuSeparator() {
    const s = document.createElement("div");
    s.style.cssText = "height:1px;background:var(--border-color);margin:4px 0;";
    return s;
}
