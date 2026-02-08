/**
 * Badges Component - File type, rating, tags badges
 */

/**
 * Create file type badge (overlaid on thumbnail)
 */
export function createFileBadge(filename, kind, nameCollision = false) {
    const badge = document.createElement("div");
    badge.className = "mjr-file-badge";

    const ext = String(filename || "").split(".").pop()?.toUpperCase?.() || "";
    try {
        badge.dataset.mjrExt = ext;
    } catch {}

    let category = "unknown";
    switch (ext) {
        case "PNG": case "JPG": case "JPEG": case "WEBP": case "GIF": case "BMP": case "TIF": case "TIFF":
            category = "image"; break;
        case "MP4": case "WEBM": case "MOV": case "AVI": case "MKV":
            category = "video"; break;
        case "MP3": case "WAV": case "OGG": case "FLAC":
            category = "audio"; break;
        case "OBJ": case "FBX": case "GLB": case "GLTF":
            category = "model3d"; break;
        default:
            category = kind || "unknown";
    }

    const cssVarMap = {
        image: "--mjr-badge-image",
        video: "--mjr-badge-video",
        audio: "--mjr-badge-audio",
        model3d: "--mjr-badge-model3d",
    };
    const cssVar = cssVarMap[category];
    const bgColor = cssVar
        ? `var(${cssVar}, #607D8B)`
        : "#607D8B";

    badge.textContent = ext + (nameCollision ? "+" : "");
    badge.title = nameCollision ? `${ext} file (duplicate filename in view)` : `${ext} file`;
    badge.style.cssText = `
        position: absolute;
        top: 6px;
        left: 6px;
        padding: 3px 8px;
        border-radius: 4px;
        font-size: 10px;
        font-weight: 700;
        background: ${bgColor};
        opacity: 0.85;
        color: white;
        text-transform: uppercase;
        pointer-events: auto;
        z-index: 10;
        letter-spacing: 0.5px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
    `;

    return badge;
}

export function setFileBadgeCollision(badgeEl, nameCollision) {
    if (!badgeEl) return;
    try {
        const ext = badgeEl.dataset?.mjrExt || "";
        badgeEl.textContent = String(ext || "") + (nameCollision ? "+" : "");
    } catch {}
}

/**
 * Create workflow status dot (inline with filename)
 * States: complete (green), partial (orange), none (red), unparsed (grey)
 */
export function createWorkflowDot(asset) {
    const dot = document.createElement("span");
    dot.className = "mjr-workflow-dot";

    const toBoolish = (v) => {
        if (v === true) return true;
        if (v === false) return false;
        if (v === 1 || v === "1") return true;
        if (v === 0 || v === "0") return false;
        return null;
    };

    const hasWorkflow = toBoolish(asset?.has_workflow ?? asset?.hasWorkflow);
    const hasGen = toBoolish(asset?.has_generation_data ?? asset?.hasGenerationData);

    let color = "var(--mjr-status-neutral, #666)";
    let title = "Pending: parsing metadata\u2026";

    const anyTrue = hasWorkflow === true || hasGen === true;
    const anyFalse = hasWorkflow === false || hasGen === false;
    const anyUnknown = hasWorkflow === null || hasGen === null;

    if (hasWorkflow === true && hasGen === true) {
        color = "var(--mjr-status-success, #4CAF50)";
        title = "Complete: workflow + generation data detected";
    } else if (anyTrue) {
        color = "var(--mjr-status-warning, #FF9800)";
        title = hasWorkflow === true ? "Partial: workflow only (generation data missing)" : "Partial: generation data only (workflow missing)";
    } else if (anyFalse && !anyTrue && !anyUnknown) {
        color = "var(--mjr-status-error, #f44336)";
        title = "None: no workflow or generation data found";
    } else if (anyUnknown) {
        color = "var(--mjr-status-info, #64B5F6)";
        title = "Pending: metadata not parsed yet";
    }

    dot.textContent = "\u25CF";
    dot.title = `${title}\nClick to rescan this file`;
    dot.style.cssText = `
        color: ${color};
        margin-left: 4px;
        font-size: 12px;
        cursor: pointer;
    `;

    return dot;
}

/**
 * Create rating badge (stars) - Top right position
 */
export function createRatingBadge(rating) {
    const ratingValue = Math.max(0, Math.min(5, Number(rating) || 0));
    if (ratingValue <= 0) return null;

    const badge = document.createElement("div");
    badge.className = "mjr-rating-badge";
    badge.title = `Rating: ${ratingValue} star${ratingValue > 1 ? "s" : ""}`;
    badge.style.cssText = `
        position: absolute;
        top: 6px;
        right: 6px;
        background: rgba(0, 0, 0, 0.55);
        border: 1px solid rgba(255, 255, 255, 0.12);
        padding: 2px 6px;
        border-radius: 6px;
        font-size: 13px;
        letter-spacing: 1px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
        z-index: 10;
        text-shadow: 0 2px 6px rgba(0,0,0,0.6);
        box-shadow: 0 6px 18px rgba(0,0,0,0.25);
    `;

    for (let i = 1; i <= ratingValue; i++) {
        const star = document.createElement("span");
        star.textContent = "\u2605";
        star.style.color = "var(--mjr-star-active, #FFD45A)";
        star.style.marginRight = i < ratingValue ? "2px" : "0";
        badge.appendChild(star);
    }

    return badge;
}

/**
 * Create tags badge - Bottom left position
 */
export function createTagsBadge(tags) {
    const badge = document.createElement("div");
    badge.className = "mjr-tags-badge";

    if (!tags || tags.length === 0) {
        badge.style.display = "none";
        return badge;
    }

    badge.textContent = tags.join(", ");
    badge.title = `Tags: ${tags.join(", ")}`;
    badge.style.cssText = `
        position: absolute;
        bottom: 6px;
        left: 6px;
        padding: 3px 6px;
        border-radius: 4px;
        background: rgba(0,0,0,0.8);
        color: #90CAF9;
        font-size: 9px;
        max-width: 80%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        pointer-events: none;
        z-index: 10;
        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
    `;

    return badge;
}
