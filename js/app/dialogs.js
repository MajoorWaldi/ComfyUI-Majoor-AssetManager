/**
 * ComfyUI-native-ish dialogs for extensions.
 *
 * Uses ComfyDialog if available (window.comfyAPI.ui.ComfyDialog) to avoid browser
 * alert/confirm/prompt popups. Falls back to window.* when unavailable.
 */

const getComfyUi = () => {
    try {
        return window?.comfyAPI?.ui || null;
    } catch {
        return null;
    }
};

const fallbackEl = (tag, props = {}, children = []) => {
    const el = document.createElement(tag);
    Object.entries(props || {}).forEach(([key, value]) => {
        if (key === "style" && value && typeof value === "object") {
            Object.assign(el.style, value);
            return;
        }
        if (key === "className") {
            el.className = String(value);
            return;
        }
        if (key.startsWith("on") && typeof value === "function") {
            el.addEventListener(key.slice(2).toLowerCase(), value);
            return;
        }
        try {
            el[key] = value;
        } catch {
            el.setAttribute(key, String(value));
        }
    });
    const childList = Array.isArray(children) ? children : [children];
    childList.filter(Boolean).forEach((c) => el.appendChild(c));
    return el;
};

const $el = (tag, props, children) => {
    const ui = getComfyUi();
    if (ui?.$el) {
        try {
            return ui.$el(tag, props, children);
        } catch {
            // fall through
        }
    }
    return fallbackEl(tag, props, children);
};

const getComfyDialogCtor = () => {
    const ui = getComfyUi();
    return ui?.ComfyDialog || null;
};

const DIALOG_Z_INDEX = 999_999;
const DIALOG_WIDTH_PX = 420;
const DIALOG_RADIUS_PX = 10;

const styleDialog = (dialog) => {
    try {
        // Ensure dialogs are above extension panels/popovers.
        dialog.element.style.zIndex = String(DIALOG_Z_INDEX);
        dialog.element.style.width = `${DIALOG_WIDTH_PX}px`;
        dialog.element.style.padding = "0";
        dialog.element.style.backgroundColor = "var(--comfy-menu-bg, #2a2a2a)";
        dialog.element.style.border = "1px solid var(--border-color, #3a3a3a)";
        dialog.element.style.borderRadius = `${DIALOG_RADIUS_PX}px`;
        dialog.element.style.boxSizing = "border-box";
        dialog.element.style.overflow = "hidden";
    } catch {}
};

export const comfyAlert = async (message, title = "Majoor") => {
    const Dialog = getComfyDialogCtor();
    if (!Dialog) {
        try {
            window.alert(message);
        } catch {}
        return;
    }

    return new Promise((resolve) => {
        const dialog = new Dialog();
        styleDialog(dialog);

        const close = () => {
            try {
                dialog.close();
            } catch {}
            resolve();
        };

        const content = $el("div", {
            style: {
                display: "flex",
                flexDirection: "column",
                gap: "12px",
                padding: "16px",
            },
        }, [
            $el("div", {
                textContent: title,
                style: {
                    fontWeight: "600",
                    fontSize: "14px",
                    color: "rgba(255,255,255,0.95)",
                },
            }),
            $el("div", {
                textContent: String(message || ""),
                style: {
                    fontSize: "13px",
                    color: "rgba(255,255,255,0.80)",
                    whiteSpace: "pre-wrap",
                    lineHeight: "1.4",
                },
            }),
            $el("div", {
                style: { display: "flex", justifyContent: "flex-end", gap: "10px" },
            }, [
                $el("button", {
                    textContent: "OK",
                    onclick: close,
                    style: {
                        padding: "8px 12px",
                        borderRadius: "8px",
                        border: "1px solid rgba(255,255,255,0.12)",
                        background: "rgba(0,0,0,0.25)",
                        color: "rgba(255,255,255,0.9)",
                        cursor: "pointer",
                    },
                }),
            ]),
        ]);

        try {
            dialog.show(content);
        } catch {
            try {
                window.alert(message);
            } catch {}
            resolve();
        }
    });
};

export const comfyConfirm = async (message, title = "Majoor") => {
    const Dialog = getComfyDialogCtor();
    if (!Dialog) {
        try {
            return window.confirm(message);
        } catch {
            return false;
        }
    }

    return new Promise((resolve) => {
        const dialog = new Dialog();
        styleDialog(dialog);

        const finish = (value) => {
            try {
                dialog.close();
            } catch {}
            resolve(!!value);
        };

        const content = $el("div", {
            style: {
                display: "flex",
                flexDirection: "column",
                gap: "12px",
                padding: "16px",
            },
        }, [
            $el("div", {
                textContent: title,
                style: {
                    fontWeight: "600",
                    fontSize: "14px",
                    color: "rgba(255,255,255,0.95)",
                },
            }),
            $el("div", {
                textContent: String(message || ""),
                style: {
                    fontSize: "13px",
                    color: "rgba(255,255,255,0.80)",
                    whiteSpace: "pre-wrap",
                    lineHeight: "1.4",
                },
            }),
            $el("div", {
                style: { display: "flex", justifyContent: "flex-end", gap: "10px" },
            }, [
                $el("button", {
                    textContent: "Cancel",
                    onclick: () => finish(false),
                    style: {
                        padding: "8px 12px",
                        borderRadius: "8px",
                        border: "1px solid rgba(255,255,255,0.12)",
                        background: "rgba(0,0,0,0.25)",
                        color: "rgba(255,255,255,0.85)",
                        cursor: "pointer",
                    },
                }),
                $el("button", {
                    textContent: "OK",
                    onclick: () => finish(true),
                    style: {
                        padding: "8px 12px",
                        borderRadius: "8px",
                        border: "1px solid rgba(95,179,255,0.45)",
                        background: "rgba(95,179,255,0.18)",
                        color: "rgba(255,255,255,0.95)",
                        cursor: "pointer",
                    },
                }),
            ]),
        ]);

        try {
            dialog.show(content);
        } catch {
            try {
                resolve(!!window.confirm(message));
            } catch {
                resolve(false);
            }
        }
    });
};

export const comfyPrompt = async (message, defaultValue = "", title = "Majoor") => {
    const Dialog = getComfyDialogCtor();
    if (!Dialog) {
        try {
            return window.prompt(message, defaultValue);
        } catch {
            return null;
        }
    }

    return new Promise((resolve) => {
        const dialog = new Dialog();
        styleDialog(dialog);

        const finish = (value) => {
            try {
                dialog.close();
            } catch {}
            resolve(value ?? null);
        };

        const input = $el("input", {
            type: "text",
            value: String(defaultValue ?? ""),
            style: {
                width: "100%",
                padding: "10px 10px",
                borderRadius: "10px",
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(0,0,0,0.25)",
                color: "rgba(255,255,255,0.9)",
                outline: "none",
                boxSizing: "border-box",
            },
            onkeydown: (e) => {
                if (e.key === "Enter") finish(input.value);
                if (e.key === "Escape") finish(null);
                e.stopPropagation();
            },
        });

        const content = $el("div", {
            style: {
                display: "flex",
                flexDirection: "column",
                gap: "12px",
                padding: "16px",
            },
        }, [
            $el("div", {
                textContent: title,
                style: {
                    fontWeight: "600",
                    fontSize: "14px",
                    color: "rgba(255,255,255,0.95)",
                },
            }),
            $el("div", {
                textContent: String(message || ""),
                style: {
                    fontSize: "13px",
                    color: "rgba(255,255,255,0.80)",
                    whiteSpace: "pre-wrap",
                    lineHeight: "1.4",
                },
            }),
            input,
            $el("div", {
                style: { display: "flex", justifyContent: "flex-end", gap: "10px" },
            }, [
                $el("button", {
                    textContent: "Cancel",
                    onclick: () => finish(null),
                    style: {
                        padding: "8px 12px",
                        borderRadius: "8px",
                        border: "1px solid rgba(255,255,255,0.12)",
                        background: "rgba(0,0,0,0.25)",
                        color: "rgba(255,255,255,0.85)",
                        cursor: "pointer",
                    },
                }),
                $el("button", {
                    textContent: "OK",
                    onclick: () => finish(input.value),
                    style: {
                        padding: "8px 12px",
                        borderRadius: "8px",
                        border: "1px solid rgba(95,179,255,0.45)",
                        background: "rgba(95,179,255,0.18)",
                        color: "rgba(255,255,255,0.95)",
                        cursor: "pointer",
                    },
                }),
            ]),
        ]);

        try {
            dialog.show(content);
            setTimeout(() => {
                try {
                    input.focus();
                    input.select();
                } catch {}
            }, 0);
        } catch {
            try {
                resolve(window.prompt(message, defaultValue));
            } catch {
                resolve(null);
            }
        }
    });
};
