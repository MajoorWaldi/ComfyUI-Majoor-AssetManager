import { createParametersBox } from "../utils/dom.js";
import { formatDate, formatTime, formatDuration } from "../../../utils/format.js";

/**
 * Create a section displaying file information:
 * - Date & Time (creation/modification)
 * - Duration (for videos)
 * - Generation Time (if available)
 * - Dimensions
 * - File size
 */
export function createFileInfoSection(asset) {
    if (!asset) return null;

    const fileData = [];

    // Dimensions
    if (asset.width && asset.height) {
        fileData.push({ 
            label: "Dimensions", 
            value: `${asset.width} × ${asset.height}`,
            tooltip: "Image/video resolution in pixels"
        });
    }

    // Duration (for videos)
    if (asset.duration && asset.duration > 0) {
        fileData.push({ 
            label: "Duration", 
            value: formatDuration(asset.duration),
            tooltip: "Video duration"
        });
    }

    // FPS + Length (frames) for animated media (video, gif, webp, webm)
    if (isAnimatedMedia(asset)) {
        const fps = readFps(asset);
        if (fps != null) {
            fileData.push({
                label: "FPS",
                value: formatFps(fps),
                tooltip: "Native frame rate",
            });
        }

        const frameCount = readFrameCount(asset, fps);
        if (frameCount != null) {
            fileData.push({
                label: "Length",
                value: `${Math.max(0, Math.floor(frameCount))} frames`,
                tooltip: "Total frame count",
            });
        }
    }

    // Generation Time (workflow execution time)
    const genTimeMs = asset.generation_time_ms ?? asset.metadata?.generation_time_ms ?? 0;
    if (genTimeMs && Number.isFinite(Number(genTimeMs)) && genTimeMs > 0 && genTimeMs < 86400000) {
        const secs = (Number(genTimeMs) / 1000).toFixed(1);
        
        // Color based on generation time
        let color = "#4CAF50"; // Green for < 10s
        if (secs >= 60) color = "#FF9800"; // Orange
        else if (secs >= 30) color = "#FFC107"; // Yellow
        else if (secs >= 10) color = "#8BC34A"; // Light green
        
        fileData.push({ 
            label: "Generation Time", 
            value: `${secs}s`,
            tooltip: "Time taken to generate this asset (workflow execution time)",
            valueStyle: `color: ${color}; font-weight: 600;`
        });
    }

    // Date & Time
    const timestamp = asset.generation_time || asset.file_creation_time || asset.mtime || asset.created_at;
    if (timestamp) {
        const dateStr = formatDate(timestamp);
        const timeStr = formatTime(timestamp);
        
        if (dateStr) {
            fileData.push({ 
                label: "Date", 
                value: dateStr,
                tooltip: "File creation/generation date"
            });
        }
        if (timeStr) {
            fileData.push({ 
                label: "Time", 
                value: timeStr,
                tooltip: "File creation/generation time"
            });
        }
    }

    // File size
    if (asset.size && asset.size > 0) {
        const sizeStr = formatFileSize(asset.size);
        fileData.push({ 
            label: "File Size", 
            value: sizeStr,
            tooltip: "File size on disk"
        });
    }

    if (fileData.length === 0) return null;

    return createParametersBox("File Info", fileData, "#607D8B", { emphasis: true });
}

/**
 * Format file size in human-readable format
 */
function formatFileSize(bytes) {
    if (!bytes || bytes <= 0) return "0 B";
    
    const units = ["B", "KB", "MB", "GB"];
    let unitIndex = 0;
    let size = bytes;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    
    return `${size.toFixed(unitIndex > 0 ? 1 : 0)} ${units[unitIndex]}`;
}

function isAnimatedMedia(asset) {
    try {
        const kind = String(asset?.kind || "").toLowerCase();
        if (kind === "video") return true;
        const name = String(asset?.filename || asset?.filepath || asset?.path || "").toLowerCase();
        return /\.(gif|webp|webm)$/.test(name);
    } catch {
        return false;
    }
}

function parseFpsValue(value) {
    try {
        const n = Number(value);
        if (Number.isFinite(n) && n > 0) return n;
        const s = String(value || "").trim();
        if (!s) return null;
        if (s.includes("/")) {
            const [a, b] = s.split("/");
            const na = Number(a);
            const nb = Number(b);
            if (Number.isFinite(na) && Number.isFinite(nb) && nb !== 0) {
                const fps = na / nb;
                return Number.isFinite(fps) && fps > 0 ? fps : null;
            }
        }
        const f = Number.parseFloat(s);
        return Number.isFinite(f) && f > 0 ? f : null;
    } catch {
        return null;
    }
}

function readFps(asset) {
    try {
        const raw = asset?.metadata_raw || {};
        const ff = raw?.raw_ffprobe || {};
        const vs = ff?.video_stream || {};
        return (
            parseFpsValue(asset?.fps) ??
            parseFpsValue(raw?.fps) ??
            parseFpsValue(raw?.frame_rate) ??
            parseFpsValue(vs?.avg_frame_rate) ??
            parseFpsValue(vs?.r_frame_rate)
        );
    } catch {
        return null;
    }
}

function readFrameCount(asset, fps) {
    try {
        const raw = asset?.metadata_raw || {};
        const ff = raw?.raw_ffprobe || {};
        const vs = ff?.video_stream || {};

        const direct =
            Number(asset?.frame_count) ||
            Number(raw?.frame_count) ||
            Number(raw?.frames) ||
            Number(vs?.nb_frames) ||
            Number(vs?.nb_read_frames) ||
            0;
        if (Number.isFinite(direct) && direct > 0) return Math.floor(direct);

        const dur = Number(asset?.duration ?? raw?.duration ?? vs?.duration);
        if (Number.isFinite(dur) && dur > 0 && Number.isFinite(fps) && fps > 0) {
            return Math.max(1, Math.round(dur * fps));
        }
    } catch {}
    return null;
}

function formatFps(fps) {
    const n = Number(fps);
    if (!Number.isFinite(n) || n <= 0) return "";
    if (Math.abs(n - Math.round(n)) < 0.001) return `${Math.round(n)} fps`;
    return `${n.toFixed(3).replace(/\.?0+$/, "")} fps`;
}
