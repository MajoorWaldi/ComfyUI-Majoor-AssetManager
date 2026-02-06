/**
 * DOM helpers
 */

/**
 * Safely call Element.closest on a potentially non-Element target.
 * Returns null if target is not suitable or any error occurs.
 * @param {any} target
 * @param {string} selector
 * @returns {Element|null}
 */
export function safeClosest(target, selector) {
    if (!selector) return null;
    try {
        if (!target) return null;
        if (target instanceof Element && typeof target.closest === "function") {
            return target.closest(selector);
        }
        // Text nodes or other non-Element targets
        const parent = target?.parentElement;
        if (parent && typeof parent.closest === "function") {
            return parent.closest(selector);
        }
    } catch {}
    return null;
}
