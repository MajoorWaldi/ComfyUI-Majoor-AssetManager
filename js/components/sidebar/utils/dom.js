import { comfyToast } from "../../../app/toast.js";

export function createSection(title) {
    const section = document.createElement("div");
    section.className = "mjr-sidebar-section";
    section.style.cssText = `
        background: rgba(0,0,0,0.2);
        border-radius: 8px;
        padding: 12px;
        min-width: 300px;
    `;

    const header = document.createElement("div");
    header.style.cssText = `
        font-size: 13px;
        font-weight: 600;
        color: white;
        margin-bottom: 12px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    `;
    header.textContent = title;

    section.appendChild(header);
    return section;
}

export function createInfoBox(title, content, accentColor) {
    const box = document.createElement("div");
    box.style.cssText = `
        background: rgba(0,0,0,0.3);
        border-left: 3px solid ${accentColor};
        border-radius: 6px;
        padding: 12px;
        position: relative;
    `;

    const header = document.createElement("div");
    header.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 11px;
        font-weight: 600;
        color: ${accentColor};
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 8px;
    `;

    const titleSpan = document.createElement("span");
    titleSpan.textContent = title;
    header.appendChild(titleSpan);

    const copyBtn = document.createElement("div");
    copyBtn.title = "Copy to clipboard";
    copyBtn.style.cssText = `
        cursor: pointer;
        opacity: 0.7;
        transition: opacity 0.2s, transform 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 16px; 
        height: 16px;
    `;
    copyBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
    `;

    copyBtn.onmouseenter = () => { copyBtn.style.opacity = "1"; };
    copyBtn.onmouseleave = () => { copyBtn.style.opacity = "0.7"; };
    
    copyBtn.onclick = async (e) => {
        e.stopPropagation();
        try {
            await navigator.clipboard.writeText(content);
            
            // Visual feedback
            const originalHTML = copyBtn.innerHTML;
            copyBtn.innerHTML = `
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
            `;
            copyBtn.style.color = "#4CAF50";
            copyBtn.style.transform = "scale(1.1)";
            
            setTimeout(() => {
                copyBtn.innerHTML = originalHTML;
                copyBtn.style.color = "inherit";
                copyBtn.style.transform = "scale(1)";
            }, 1000);
            
            comfyToast(`${title} copied to clipboard!`, "success", 2000);

        } catch (err) {
            console.warn("Clipboard copy failed", err);
            comfyToast("Failed to copy to clipboard", "error");
        }
    };

    header.appendChild(copyBtn);

    const text = document.createElement("div");
    text.textContent = content;
    text.style.cssText = `
        font-size: 12px;
        color: rgba(255,255,255,0.9);
        line-height: 1.5;
        white-space: pre-wrap;
        word-break: break-word;
    `;

    box.appendChild(header);
    box.appendChild(text);
    return box;
}

export function createParametersBox(title, fields, accentColor) {
    const box = document.createElement("div");
    box.style.cssText = `
        background: rgba(0,0,0,0.3);
        border-left: 3px solid ${accentColor};
        border-radius: 6px;
        padding: 12px;
    `;

    const header = document.createElement("div");
    header.textContent = title;
    header.style.cssText = `
        font-size: 11px;
        font-weight: 600;
        color: ${accentColor};
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 10px;
    `;
    box.appendChild(header);

    const grid = document.createElement("div");
    grid.style.cssText = `
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 8px 12px;
        align-items: start;
    `;

    fields.forEach((field) => {
        const label = document.createElement("div");
        label.textContent = field.label + ":";
        label.title = field.tooltip || field.label;
        label.style.cssText = `
            font-size: 11px;
            color: rgba(255,255,255,0.6);
            font-weight: 500;
        `;

        const value = document.createElement("div");
        value.textContent = String(field.value);
        value.title = `${field.label}: ${field.value} (click to copy)`;
        value.style.cssText = `
            font-size: 12px;
            color: rgba(255,255,255,0.95);
            word-break: break-word;
            white-space: pre-wrap;
            cursor: pointer;
            ${field.valueStyle || ""}
        `;
        
        value.addEventListener("click", async () => {
            try {
                await navigator.clipboard.writeText(String(field.value));
                value.style.background = "rgba(76, 175, 80, 0.3)";
                setTimeout(() => { value.style.background = ""; }, 300);
            } catch {}
        });

        grid.appendChild(label);
        grid.appendChild(value);
    });

    box.appendChild(grid);
    return box;
}

export function createFieldRow(label, value, multiline = false) {
    const row = document.createElement("div");
    row.style.cssText = `
        display: flex;
        flex-direction: ${multiline ? "column" : "row"};
        gap: ${multiline ? "4px" : "8px"};
        margin-bottom: 8px;
        font-size: 12px;
    `;

    const labelEl = document.createElement("div");
    labelEl.textContent = label;
    labelEl.style.cssText = `
        color: var(--mjr-muted, rgba(255,255,255,0.65));
        ${multiline ? "" : "min-width: 100px;"}
        font-weight: 500;
    `;

    const valueEl = document.createElement("div");
    valueEl.textContent = String(value);
    valueEl.style.cssText = `
        color: white;
        ${multiline ? "white-space: pre-wrap; word-break: break-word;" : ""}
        flex: 1;
    `;

    row.appendChild(labelEl);
    row.appendChild(valueEl);

    return row;
}
