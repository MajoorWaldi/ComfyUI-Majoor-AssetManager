import { AUDIO_EXTS, VIDEO_EXTS } from "./constants.js";

export const isVideoFilename = (filename) => {
    if (!filename) return false;
    const dot = filename.lastIndexOf(".");
    if (dot === -1) return false;
    return VIDEO_EXTS.has(filename.slice(dot).toLowerCase());
};

export const isVideoPayload = (payload) => {
    if (!payload) return false;
    if (payload.kind === "video") return true;
    return isVideoFilename(payload.filename);
};

export const isAudioFilename = (filename) => {
    if (!filename) return false;
    const dot = filename.lastIndexOf(".");
    if (dot === -1) return false;
    return AUDIO_EXTS.has(filename.slice(dot).toLowerCase());
};

export const isAudioPayload = (payload) => {
    if (!payload) return false;
    if (String(payload.kind || "").toLowerCase() === "audio") return true;
    return isAudioFilename(payload.filename);
};

export const isManagedPayload = (payload) =>
    isVideoPayload(payload) || isAudioPayload(payload);

export const getDownloadMimeForFilename = (filename) => {
    const ext = String(filename || "").split(".").pop()?.toLowerCase();
    return ext === "mp4"
        ? "video/mp4"
        : ext === "mov"
        ? "video/quicktime"
        : ext === "webm"
        ? "video/webm"
        : ext === "mkv"
        ? "video/x-matroska"
        : "application/octet-stream";
};

export const looksLikeVideoPath = (value, droppedExt) => {
    if (typeof value !== "string") return false;
    const v = value.trim().toLowerCase();
    if (!v) return false;
    const ext = (v.split(/[?#]/)[0].split(".").pop() || "").toLowerCase();
    if (!ext) return false;
    if (droppedExt && ext === String(droppedExt).toLowerCase()) return true;
    return VIDEO_EXTS.has(`.${ext}`);
};

export const comboHasAnyVideoValue = (widget, droppedExt) => {
    if (!widget || widget.type !== "combo" || !widget.options) return false;
    const vals =
        (Array.isArray(widget.options.values) && widget.options.values) ||
        (widget.options.values &&
            Array.isArray(widget.options.values.values) &&
            widget.options.values.values) ||
        null;
    if (!Array.isArray(vals)) return false;
    return vals.some((v) => {
        const s = typeof v === "string" ? v : v?.content ?? v?.value ?? v?.text;
        return looksLikeVideoPath(s, droppedExt);
    });
};

export const looksLikeAudioPath = (value, droppedExt) => {
    if (typeof value !== "string") return false;
    const v = value.trim().toLowerCase();
    if (!v) return false;
    const ext = (v.split(/[?#]/)[0].split(".").pop() || "").toLowerCase();
    if (!ext) return false;
    if (droppedExt && ext === String(droppedExt).toLowerCase()) return true;
    return AUDIO_EXTS.has(`.${ext}`);
};

export const comboHasAnyAudioValue = (widget, droppedExt) => {
    if (!widget || widget.type !== "combo" || !widget.options) return false;
    const vals =
        (Array.isArray(widget.options.values) && widget.options.values) ||
        (widget.options.values &&
            Array.isArray(widget.options.values.values) &&
            widget.options.values.values) ||
        null;
    if (!Array.isArray(vals)) return false;
    return vals.some((v) => {
        const s = typeof v === "string" ? v : v?.content ?? v?.value ?? v?.text;
        return looksLikeAudioPath(s, droppedExt);
    });
};

