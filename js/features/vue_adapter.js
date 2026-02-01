/**
 * Majoor Vue Adapter
 * Loads the Vue-based UI components.
 */

// Dynamically import the Vue bundle
// Note: ComfyUI loads modules from the js/ root, so we use relative path.
// This file is in js/features/, so we go up one level.

let vueModule = null;

export async function loadVueModule() {
    if (vueModule) return vueModule;
    try {
        // Import the built module. Copilot build output is in js/vue/majoor-ui.mjs
        // We use absolute path from root for import logic or relative ?
        // Browsers load relative to this file.
        // this file: js/features/vue_adapter.js
        // target: js/vue/majoor-ui.mjs
        // relative: ../vue/majoor-ui.mjs
        vueModule = await import("../vue/majoor-ui.mjs");
        console.log("[Majoor] Vue module loaded:", vueModule);
        return vueModule;
    } catch (e) {
        console.error("[Majoor] Failed to load Vue module:", e);
        return null;
    }
}

export async function mountVueCard(container, props) {
    const mod = await loadVueModule();
    if (!mod || !mod.mountCard) {
        console.error("Vue mountCard not found");
        return null;
    }
    return mod.mountCard(container, props);
}
