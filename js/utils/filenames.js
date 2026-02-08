const WINDOWS_RESERVED_NAMES = new Set([
    "CON",
    "PRN",
    "AUX",
    "NUL",
    "COM1",
    "COM2",
    "COM3",
    "COM4",
    "COM5",
    "COM6",
    "COM7",
    "COM8",
    "COM9",
    "LPT1",
    "LPT2",
    "LPT3",
    "LPT4",
    "LPT5",
    "LPT6",
    "LPT7",
    "LPT8",
    "LPT9",
]);

const MAX_FILENAME_LENGTH = 255;

export function validateFilename(filename) {
    try {
        const name = String(filename ?? "").trim();
        if (!name) {
            return { valid: false, reason: "Filename cannot be empty" };
        }
        if (name.length > MAX_FILENAME_LENGTH) {
            return { valid: false, reason: `Filename is too long (max ${MAX_FILENAME_LENGTH} characters)` };
        }
        if (name.includes("/") || name.includes("\\")) {
            return { valid: false, reason: "Filename cannot contain path separators" };
        }
        if (name.includes("\x00")) {
            return { valid: false, reason: "Filename cannot contain null bytes" };
        }
        for (const char of name) {
            if (char.charCodeAt(0) < 32) {
                return { valid: false, reason: "Filename cannot contain control characters" };
            }
        }
        if (name.startsWith(".") || name.startsWith(" ")) {
            return { valid: false, reason: "Filename cannot start with a dot or space" };
        }
        if (name.endsWith(".") || name.endsWith(" ")) {
            return { valid: false, reason: "Filename cannot end with a dot or space" };
        }
        const base = name.split(".")[0].toUpperCase();
        if (WINDOWS_RESERVED_NAMES.has(base)) {
            return { valid: false, reason: "Filename uses a reserved Windows name" };
        }
        return { valid: true, reason: "" };
    } catch (error) {
        return { valid: false, reason: String(error || "Invalid filename") };
    }
}

export function sanitizeFilename(filename) {
    try {
        return String(filename ?? "").trim();
    } catch {
        return "";
    }
}
