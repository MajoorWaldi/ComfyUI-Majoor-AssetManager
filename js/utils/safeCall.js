import { APP_CONFIG } from "../app/config.js";

export const noop = () => {};

function _debugEnabled(flag) {
    try {
        return Boolean(APP_CONFIG?.[flag]);
    } catch {
        return false;
    }
}

function _warn(label, err) {
    try {
        console.warn(`[Majoor] ${label}`, err);
    } catch {}
}

export function safeCall(fn, label = "safeCall") {
    try {
        return fn?.();
    } catch (err) {
        if (_debugEnabled("DEBUG_SAFE_CALL")) _warn(label, err);
        return undefined;
    }
}

export function safeAddListener(target, event, handler, options, label = "safeAddListener") {
    try {
        target?.addEventListener?.(event, handler, options);
        return () => {
            try {
                target?.removeEventListener?.(event, handler, options);
            } catch (err) {
                if (_debugEnabled("DEBUG_SAFE_LISTENERS")) _warn(`${label}:remove:${String(event || "")}`, err);
            }
        };
    } catch (err) {
        if (_debugEnabled("DEBUG_SAFE_LISTENERS")) _warn(`${label}:add:${String(event || "")}`, err);
        return noop;
    }
}
