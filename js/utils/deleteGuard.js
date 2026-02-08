import { APP_CONFIG } from "../app/config.js";
import { comfyConfirm } from "../app/dialogs.js";

export async function confirmDeletion(count, label) {
    if (!APP_CONFIG.DELETE_CONFIRMATION) return true;
    const target = count > 1 ? `${count} files` : `"${label || "this file"}"`;
    const message = count > 1
        ? `Delete ${count} selected files?`
        : `Delete ${target}?`;
    return comfyConfirm(message, "Majoor: Confirm delete");
}
