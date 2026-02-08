/**
 * Toast Element - Majoor Assets Manager
 * 
 * Provides transient notification messages (Toasts) that mimic ComfyUI native style.
 * Supports: success, error, warning, info.
 */
import { app } from "../../../scripts/app.js";
import { t } from "./i18n.js";

const TOAST_CONTAINER_ID = "mjr-toast-container";

function translateToastMessage(message) {
    if (typeof message !== "string") return message;
    const msg = message.trim();
    const directMap = {
        "Failed to update rating": t("toast.ratingUpdateFailed", "Failed to update rating"),
        "Error updating rating": t("toast.ratingUpdateError", "Error updating rating"),
        "Rating cleared": t("toast.ratingCleared", "Rating cleared"),
        "Failed to update tags": t("toast.tagsUpdateFailed", "Failed to update tags"),
        "Tags updated": t("toast.tagsUpdated", "Tags updated"),
        "Failed to toggle watcher": t("toast.watcherToggleFailed", "Failed to toggle watcher"),
        "No valid assets selected.": t("toast.noValidAssetsSelected", "No valid assets selected."),
        "Failed to create collection.": t("toast.failedCreateCollectionDot", "Failed to create collection."),
        "Failed to add assets to collection.": t("toast.failedAddAssetsToCollection", "Failed to add assets to collection."),
        "File renamed successfully!": t("toast.fileRenamedSuccess", "File renamed successfully!"),
        "Failed to rename file": t("toast.fileRenameFailed", "Failed to rename file"),
        "Failed to rename file.": t("toast.fileRenameFailed", "Failed to rename file."),
        "File deleted successfully!": t("toast.fileDeletedSuccess", "File deleted successfully!"),
        "Failed to delete file.": t("toast.fileDeleteFailed", "Failed to delete file."),
        "Failed to delete file. ": t("toast.fileDeleteFailed", "Failed to delete file."),
        "Failed to remove from collection.": t("toast.removeFromCollectionFailed", "Failed to remove from collection."),
        "Opened in folder": t("toast.openedInFolder", "Opened in folder"),
        "Failed to open folder": t("toast.openFolderFailed", "Failed to open folder"),
        "Failed to open folder.": t("toast.openFolderFailed", "Failed to open folder."),
        "File path copied to clipboard": t("toast.pathCopied", "File path copied to clipboard"),
        "Failed to copy path": t("toast.pathCopyFailed", "Failed to copy path"),
        "Failed to copy to clipboard": t("toast.copyClipboardFailed", "Failed to copy to clipboard"),
        "No file path available for this asset.": t("toast.noFilePath", "No file path available for this asset."),
        "Failed to refresh metadata.": t("toast.metadataRefreshFailed", "Failed to refresh metadata."),
        "Duplicate analysis started": t("toast.dupAnalysisStarted", "Duplicate analysis started"),
        "Tags merged": t("toast.tagsMerged", "Tags merged"),
        "Duplicates deleted": t("toast.duplicatesDeleted", "Duplicates deleted"),
        "Playback speed is available for video media only": t("toast.playbackVideoOnly", "Playback speed is available for video media only"),
        "Rescanning file…": t("toast.rescanningFile", "Rescanning file…"),
    };
    if (directMap[msg]) return directMap[msg];

    let m = msg.match(/^Rating set to (\d+) stars?$/i);
    if (m) return t("toast.ratingSetN", { n: Number(m[1]) });

    m = msg.match(/^Downloading (.+)\.\.\.$/i);
    if (m) return t("toast.downloadingFile", { filename: m[1] });

    m = msg.match(/^Playback ([0-9]+(?:\.[0-9]+)?)x$/i);
    if (m) return t("toast.playbackRate", { rate: Number(m[1]).toFixed(2) });

    m = msg.match(/^Metadata refreshed(.*)$/i);
    if (m) return t("toast.metadataRefreshed", { suffix: m[1] || "" });

    m = msg.match(/^Error renaming(?: file)?:\s*(.+)$/i);
    if (m) return t("toast.errorRenaming", { error: m[1] });

    m = msg.match(/^Error deleting(?: files?| file)?:\s*(.+)$/i);
    if (m) return t("toast.errorDeleting", { error: m[1] });

    m = msg.match(/^Tag merge failed:\s*(.+)$/i);
    if (m) return t("toast.tagMergeFailed", { error: m[1] });

    m = msg.match(/^Delete failed:\s*(.+)$/i);
    if (m) return t("toast.deleteFailed", { error: m[1] });

    m = msg.match(/^Analysis not started:\s*(.+)$/i);
    if (m) return t("toast.analysisNotStarted", { error: m[1] });

    m = msg.match(/^(\d+)\s+files deleted successfully!$/i);
    if (m) return t("toast.filesDeletedSuccessN", { n: Number(m[1]) });

    m = msg.match(/^(\d+)\s+files deleted,\s+(\d+)\s+failed\.$/i);
    if (m) return t("toast.filesDeletedPartial", { success: Number(m[1]), failed: Number(m[2]) });

    m = msg.match(/^(\d+)\s+files?\s+deleted$/i);
    if (m) return t("toast.filesDeletedShort", { n: Number(m[1]) });

    m = msg.match(/^(\d+)\s+deleted,\s+(\d+)\s+failed$/i);
    if (m) return t("toast.filesDeletedShortPartial", { success: Number(m[1]), failed: Number(m[2]) });

    m = msg.match(/^(.+)\s+copied to clipboard!$/i);
    if (m) return t("toast.copiedToClipboardNamed", { name: m[1] });

    return msg;
}

/**
 * Ensures the toast container exists in the DOM.
 */
function getToastContainer() {
    let container = document.getElementById(TOAST_CONTAINER_ID);
    if (!container) {
        container = document.createElement("div");
        container.id = TOAST_CONTAINER_ID;
        // Position: Top-Center for ComfyUI v1 style, or Bottom-Center for classic
        // We'll stick to top-center to be more visible like prompts
        Object.assign(container.style, {
            position: "fixed",
            top: "16px",
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "10px",
            zIndex: "1000001", // Above most dialogs
            pointerEvents: "none", // Allow clicks to pass through container
        });
        document.body.appendChild(container);
    }
    return container;
}

/**
 * Shows a toast notification.
 * @param {string} message The message to display
 * @param {'info'|'success'|'warning'|'error'} type The type of message
 * @param {number} duration Duration in ms (default 3000)
 */
export function comfyToast(message, type = "info", duration = 3000) {
    message = translateToastMessage(message);
    // 1. Try ComfyUI extensionManager toast (ComfyUI v1.3+ standard)
    // See: ComfyUI-Majoor-NodeFlow reference implementation
    try {
        const t = app?.extensionManager?.toast;
        if (t && typeof t.add === "function") {
            let severity = type;
            if (severity === "warning") severity = "warn"; // Map warning -> warn
            
            // Allow passing an object { summary, detail } as message
            let summary = "Majoor Assets Manager";
            let detail = message;
            
            if (typeof message === "object" && message?.summary) {
                summary = message.summary;
                detail = message.detail || "";
            } else if (typeof message !== "string") {
                 try { detail = message.message || String(message); } catch {}
            }

            t.add({ 
                severity, 
                summary, 
                detail, 
                life: duration 
            });
            return;
        }
    } catch(e) {
        console.debug("Majoor: extensionManager.toast failed", e);
    }

    // 2. Try generic ComfyUI app.ui.toast (Older or alternative implementations)
    if (app?.ui?.toast) {
         try {
             return app.ui.toast(message, type);
         } catch(e) { console.debug("Native app.ui.toast failed, falling back", e); }
    }

    const container = getToastContainer();
    
    // Fallback if message is an object/error
    if (typeof message !== "string") {
        try {
            message = message.message || String(message);
        } catch {
            message = "Unknown message";
        }
    }

    const el = document.createElement("div");
    
    // Theme colors matching js/app/dialogs.js and ComfyUI variables
    // Mimic ComfyDialog style
    
    const bg = "var(--comfy-menu-bg, #2a2a2a)";
    const border = "var(--border-color, #3a3a3a)";
    let icon = "";
    let stripColor = "transparent";
    
    switch (type) {
        case "success":
            stripColor = "#4caf50";
            icon = ""; 
            break;
        case "error":
            stripColor = "#f44336";
            icon = "";
            duration = duration < 4000 ? 5000 : duration;
            break;
        case "warning":
            stripColor = "#ff9800";
            icon = "";
            break;
        case "info":
        default:
            stripColor = "#2196f3";
            icon = "";
            break;
    }

    Object.assign(el.style, {
        background: bg,
        border: `1px solid ${border}`,
        borderLeft: `4px solid ${stripColor}`,
        borderRadius: "4px", // ComfyUI style is often slightly more squared or 10px? Dialog is 10px.
        padding: "12px 16px",
        color: "var(--fg-color, #efefef)",
        fontFamily: "var(--font-sans, sans-serif)",
        fontSize: "14px",
        boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
        opacity: "0",
        transform: "translateY(-15px)",
        transition: "all 0.2s ease-out",
        pointerEvents: "auto",
        display: "flex",
        alignItems: "center",
        gap: "12px",
        whiteSpace: "pre-wrap",
        minWidth: "250px",
        maxWidth: "400px",
        backdropFilter: "blur(4px)",
        cursor: "default",
        userSelect: "none",
    });

    const textSpan = document.createElement("span");
    textSpan.textContent = (icon ? icon + " " : "") + message;
    textSpan.style.flex = "1";
    
    el.appendChild(textSpan);
    
    // Click to dismiss
    el.onclick = () => removeToast(el);

    container.appendChild(el);

    // Animate In
    requestAnimationFrame(() => {
        el.style.opacity = "1";
        el.style.transform = "translateY(0)";
    });

    // Auto Remove
    const timer = setTimeout(() => {
        removeToast(el);
    }, duration);

    // Helpers
    function removeToast(element) {
        if (!element.parentNode) return;
        element.style.opacity = "0";
        element.style.transform = "translateY(-10px)";
        element.onclick = null;
        clearTimeout(timer);
        setTimeout(() => {
            if (element.parentNode) element.parentNode.removeChild(element);
        }, 300);
    }
}
