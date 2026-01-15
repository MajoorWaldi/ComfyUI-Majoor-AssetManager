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

    let bgColor = "rgba(0,0,0,0.7)";
    switch (ext) {
        case "PNG":
            bgColor = "rgba(33, 150, 243, 0.85)";
            break;
        case "JPG":
        case "JPEG":
            bgColor = "rgba(0, 188, 212, 0.85)";
            break;
        case "WEBP":
            bgColor = "rgba(3, 169, 244, 0.85)";
            break;
        case "GIF":
            bgColor = "rgba(0, 150, 136, 0.85)";
            break;
        case "BMP":
        case "TIF":
        case "TIFF":
            bgColor = "rgba(63, 81, 181, 0.85)";
            break;

        case "MP4":
            bgColor = "rgba(156, 39, 176, 0.85)";
            break;
        case "WEBM":
            bgColor = "rgba(103, 58, 183, 0.85)";
            break;
        case "MOV":
            bgColor = "rgba(142, 36, 170, 0.85)";
            break;
        case "AVI":
            bgColor = "rgba(123, 31, 162, 0.85)";
            break;
        case "MKV":
            bgColor = "rgba(171, 71, 188, 0.85)";
            break;

        case "MP3":
            bgColor = "rgba(255, 152, 0, 0.85)";
            break;
        case "WAV":
            bgColor = "rgba(255, 111, 0, 0.85)";
            break;
        case "OGG":
        case "FLAC":
            bgColor = "rgba(255, 193, 7, 0.85)";
            break;

        case "OBJ":
        case "FBX":
        case "GLB":
        case "GLTF":
            bgColor = "rgba(76, 175, 80, 0.85)";
            break;

        default:
            switch (kind) {
                case "image":
                    bgColor = "rgba(33, 150, 243, 0.8)";
                    break;
                case "video":
                    bgColor = "rgba(156, 39, 176, 0.8)";
                    break;
                case "audio":
                    bgColor = "rgba(255, 152, 0, 0.8)";
                    break;
                case "model3d":
                    bgColor = "rgba(76, 175, 80, 0.8)";
                    break;
                default:
                    bgColor = "rgba(96, 125, 139, 0.8)";
            }
    }

    badge.textContent = ext + (nameCollision ? "+" : "");
    badge.style.cssText = `
        position: absolute;
        top: 6px;
        left: 6px;
        padding: 3px 8px;
        border-radius: 4px;
        font-size: 10px;
        font-weight: 700;
        background: ${bgColor};
        color: white;
        text-transform: uppercase;
        pointer-events: none;
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

    let color = "#666";
    let title = "Not parsed yet";

    if (asset.has_workflow && asset.has_generation_metadata) {
        color = "#4CAF50";
        title = "Complete: Workflow + Generation metadata";
    } else if (asset.has_workflow || asset.has_generation_metadata) {
        color = "#FF9800";
        title = asset.has_workflow ? "Partial: Workflow only" : "Partial: Generation metadata only";
    } else if (asset.has_workflow === false || asset.has_generation_metadata === false) {
        color = "#f44336";
        title = "No workflow or generation data";
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
        star.style.color = "#FFD45A";
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
