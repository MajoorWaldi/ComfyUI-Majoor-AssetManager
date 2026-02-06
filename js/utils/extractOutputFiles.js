export function extractOutputFiles(output) {
    const files = [];
    const seen = new Set();
    const MAX_ITEMS = 500;
    const MAX_DEPTH = 4;
    const MAX_SCAN_ITEMS = 2000;
    const visited = typeof WeakSet !== "undefined" ? new WeakSet() : null;

    const pushItem = (item) => {
        if (!item) return;
        const rawPath = item.path || item.filepath || item.fullpath || item.fullPath || item.full_path;
        let filename = item.filename;
        if (!filename && rawPath) {
            const parts = String(rawPath).split(/[/\\\\]/);
            filename = parts[parts.length - 1];
        }
        if (!filename) return;
        filename = String(filename);
        if (!filename) return;
        const subfolder = item.subfolder || item.sub_folder || item.subFolder || "";
        const type = item.type || item.output_type || "output";
        const key = `${type}|${subfolder}|${filename}`.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        const entry = { filename, subfolder, type };
        if (rawPath) entry.path = rawPath;
        files.push(entry);
    };

    const addItems = (items) => {
        if (!Array.isArray(items)) return;
        let scanned = 0;
        for (const item of items) {
            if (files.length >= MAX_ITEMS || scanned >= MAX_SCAN_ITEMS) break;
            scanned += 1;
            if (item && typeof item === "object" && "filename" in item) {
                pushItem(item);
            } else {
                walk(item, 1);
            }
        }
    };

    const walk = (node, depth) => {
        if (!node || depth > MAX_DEPTH || files.length >= MAX_ITEMS) return;
        if (typeof node !== "object") return;
        if (visited) {
            if (visited.has(node)) return;
            visited.add(node);
        }

        if (Array.isArray(node)) {
            let scanned = 0;
            for (const item of node) {
                if (files.length >= MAX_ITEMS || scanned >= MAX_SCAN_ITEMS) break;
                scanned += 1;
                if (item && typeof item === "object" && "filename" in item) {
                    pushItem(item);
                } else {
                    walk(item, depth + 1);
                }
            }
            return;
        }

        // Common ComfyUI output keys
        if (node.images || node.gifs || node.videos) {
            addItems(node.images);
            addItems(node.gifs);
            addItems(node.videos);
        }

        // Known wrappers
        if (node.output) walk(node.output, depth + 1);
        if (node.outputs) walk(node.outputs, depth + 1);
        if (node.result) walk(node.result, depth + 1);
        if (node.data) walk(node.data, depth + 1);

        // Shallow scan of object values for nested outputs
        if (depth < MAX_DEPTH) {
            for (const value of Object.values(node)) {
                if (files.length >= MAX_ITEMS) break;
                if (!value || typeof value !== "object") continue;
                if (value.images || value.gifs || value.videos) {
                    addItems(value.images);
                    addItems(value.gifs);
                    addItems(value.videos);
                    continue;
                }
                walk(value, depth + 1);
            }
        }
    };

    walk(output, 0);
    return files;
}

