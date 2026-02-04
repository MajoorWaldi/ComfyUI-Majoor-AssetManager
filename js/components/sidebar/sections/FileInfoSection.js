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

    return createParametersBox("File Info", fileData, "#607D8B");
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
