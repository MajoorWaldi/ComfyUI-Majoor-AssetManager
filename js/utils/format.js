function parseDate(input) {
    if (!input) return null;
    let date;
    if (typeof input === 'number') {
        date = new Date(input * 1000);
    } else {
        date = new Date(input);
    }
    if (isNaN(date.getTime())) return null;
    return date;
}

export function formatDate(input) {
    const date = parseDate(input);
    if (!date) return "";
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    return `${day}/${month}`;
}

export function formatTime(input) {
    const date = parseDate(input);
    if (!date) return "";
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
}

// Format timestamp (unix seconds or date string) to human readable string
export function formatTimestamp(input) {
    const date = parseDate(input);
    if (!date) return "";
    
    // Always show date and time for better precision
    // Example: 04/07 14:30
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    
    return `${day}/${month} ${hours}:${minutes}`;
}


// Format duration (seconds) to human readable string (e.g. 1m 30s)
export function formatDuration(seconds) {
    if (!seconds) return "";
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}m ${s}s`;
}
