/**
 * Workflow Hash Utilities
 *
 * Client-side workflow fingerprinting that matches server-side logic.
 * Used for "Find assets from current graph" feature.
 */

import { api } from "../../../scripts/api.js";

// Keys to exclude from canonicalization (must match server config)
const EXCLUDE_KEYS = new Set([
    'id',
    'pos',
    'size',
    'order',
    'mode',
    'properties',
    'color',
    'bgcolor',
    'flags',
    'widgets_values',
]);

/**
 * Deep copy object/array, excluding specified keys.
 */
function deepCopyWithout(obj, excludeKeys) {
    if (obj === null || obj === undefined) {
        return obj;
    }

    if (typeof obj !== 'object') {
        return obj;
    }

    if (Array.isArray(obj)) {
        return obj.map(item => deepCopyWithout(item, excludeKeys));
    }

    const copy = {};
    for (const [key, value] of Object.entries(obj)) {
        if (!excludeKeys.has(key)) {
            copy[key] = deepCopyWithout(value, excludeKeys);
        }
    }
    return copy;
}

/**
 * Recursively sort object keys to match server-side canonicalization.
 */
function sortKeysDeep(obj) {
    if (obj === null || obj === undefined) {
        return obj;
    }
    if (typeof obj !== 'object') {
        return obj;
    }
    if (Array.isArray(obj)) {
        return obj.map(item => sortKeysDeep(item));
    }
    const sorted = {};
    Object.keys(obj).sort().forEach((key) => {
        sorted[key] = sortKeysDeep(obj[key]);
    });
    return sorted;
}

/**
 * Canonicalize workflow for hashing.
 * - Removes volatile fields (id, pos, size, etc.)
 * - Sorts all object keys recursively
 * - Returns compact JSON string
 */
export function canonicalizeWorkflow(workflow) {
    if (!workflow || typeof workflow !== 'object') {
        return '';
    }

    // Remove volatile fields
    const clean = deepCopyWithout(workflow, EXCLUDE_KEYS);

    // Sort keys recursively and stringify
    const canonical = JSON.stringify(sortKeysDeep(clean));
    return canonical;
}

/**
 * Calculate SHA1 hash of workflow.
 * Returns 40-character hex string.
 */
export async function hashWorkflow(workflow) {
    if (!workflow) {
        return '';
    }

    try {
        const canonical = canonicalizeWorkflow(workflow);
        if (!canonical) {
            return '';
        }

        // Use Web Crypto API for SHA-1
        const encoder = new TextEncoder();
        const data = encoder.encode(canonical);
        const hashBuffer = await crypto.subtle.digest('SHA-1', data);

        // Convert to hex string
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        return hashHex;
    } catch (error) {
        console.error('[Majoor] Failed to hash workflow:', error);
        return '';
    }
}

/**
 * Get current workflow from ComfyUI app.
 * Returns the workflow object or null if not available.
 */
export function getCurrentWorkflow(app) {
    if (!app || !app.graph) {
        return null;
    }

    try {
        // Serialize current graph to workflow JSON
        const workflow = app.graph.serialize();
        return workflow;
    } catch (error) {
        console.error('[Majoor] Failed to get current workflow:', error);
        return null;
    }
}

/**
 * Calculate hash of current workflow in ComfyUI.
 * Convenience function combining getCurrentWorkflow + hashWorkflow.
 */
export async function hashCurrentWorkflow(app) {
    const workflow = getCurrentWorkflow(app);
    if (!workflow) {
        return '';
    }
    return await hashWorkflow(workflow);
}

/**
 * Validate that client-side hashing matches server-side.
 * Useful for debugging/testing.
 */
export async function validateHashAlgorithm() {
    try {
        const resp = await api.fetchApi('/mjr/filemanager/workflow/hash_info');
        const info = await resp.json();

        console.log('[Majoor] Server workflow hash algorithm:', info);

        // Check if exclude keys match
        const serverKeys = new Set(info.exclude_keys || []);
        const clientKeys = EXCLUDE_KEYS;

        const missingOnClient = Array.from(serverKeys).filter(k => !clientKeys.has(k));
        const missingOnServer = Array.from(clientKeys).filter(k => !serverKeys.has(k));

        if (missingOnClient.length > 0) {
            console.warn('[Majoor] Client missing exclude keys:', missingOnClient);
        }

        if (missingOnServer.length > 0) {
            console.warn('[Majoor] Server missing exclude keys:', missingOnServer);
        }

        if (missingOnClient.length === 0 && missingOnServer.length === 0) {
            console.log('[Majoor] ✓ Workflow hash algorithm validated');
        }

        return info;
    } catch (error) {
        console.error('[Majoor] Failed to validate hash algorithm:', error);
        return null;
    }
}
