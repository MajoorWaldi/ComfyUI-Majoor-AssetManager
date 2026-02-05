export function createSidebarHeader(asset, onClose) {
    const header = document.createElement("div");
    header.className = "mjr-sidebar-header";
    header.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 12px;
        border-bottom: 1px solid var(--mjr-border, rgba(255,255,255,0.12));
        background: var(--mjr-surface-2, #333);
        min-width: 0;
    `;

    const titleDiv = document.createElement("div");
    titleDiv.style.cssText = "flex: 1; min-width: 0;";

    const filename = document.createElement("div");
    filename.className = "mjr-sidebar-filename";
    filename.textContent = asset.filename || "Unknown";
    filename.title = asset.filename;
    filename.style.cssText = `
        margin: 0;
        font-size: 14px;
        font-weight: 600;
        color: var(--content-fg, #fff);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    `;

    titleDiv.appendChild(filename);

    const closeBtn = document.createElement("button");
    closeBtn.className = "mjr-sidebar-close";
    closeBtn.type = "button";
    closeBtn.textContent = "×";
    closeBtn.title = "Close sidebar (Esc)";
    closeBtn.setAttribute("aria-label", "Close sidebar");
    closeBtn.style.cssText = `
        background: none;
        border: none;
        color: white;
        font-size: 26px;
        cursor: pointer;
        padding: 0;
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        transition: background 0.2s;
        line-height: 1;
    `;

    closeBtn.addEventListener("mouseenter", () => {
        closeBtn.style.background = "rgba(255,255,255,0.1)";
    });

    closeBtn.addEventListener("mouseleave", () => {
        closeBtn.style.background = "none";
    });

    closeBtn.addEventListener("click", onClose);

    header.appendChild(titleDiv);
    header.appendChild(closeBtn);

    return header;
}

