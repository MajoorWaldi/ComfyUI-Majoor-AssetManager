/**
 * Context Menu Core
 *
 * Shared primitives for all Majoor context menus (grid/viewer/collections).
 * Avoids duplicated DOM + event wiring and prevents selector collisions.
 */

const _DEFAULT_Z = 10001;

function _asClassName(value) {
    const s = String(value || "").trim();
    if (!s) return "";
    return s.startsWith(".") ? s.slice(1) : s;
}

export function getOrCreateMenu({
    selector,
    className,
    minWidth = 220,
    zIndex = _DEFAULT_Z,
    onHide = null,
} = {}) {
    const sel = String(selector || "").trim();
    if (!sel) throw new Error("MenuCore.getOrCreateMenu: missing selector");

    const existing = document.querySelector(sel);
    if (existing) return existing;

    const menu = document.createElement("div");
    menu.className = `${_asClassName(className) || _asClassName(sel)} mjr-context-menu`;
    menu.style.cssText = `
        position: fixed;
        background: var(--comfy-menu-bg);
        border: 1px solid var(--border-color);
        border-radius: 6px;
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
        min-width: ${Math.max(180, Number(minWidth) || 220)}px;
        z-index: ${Number(zIndex) || _DEFAULT_Z};
        display: none;
        padding: 4px 0;
    `;

    const ac = new AbortController();
    menu._mjrAbortController = ac;

    const hide = () => {
        try {
            menu.style.display = "none";
        } catch {}
        try {
            onHide?.();
        } catch {}
    };

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
    document.addEventListener("scroll", hide, { capture: true, signal: ac.signal });

    document.body.appendChild(menu);
    return menu;
}

export function hideMenu(menu) {
    try {
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
        try {
            await onClick?.();
        } catch {}
    });

    return item;
}

export function createMenuSeparator() {
    const s = document.createElement("div");
    s.style.cssText = "height:1px;background:var(--border-color);margin:4px 0;";
    return s;
}
