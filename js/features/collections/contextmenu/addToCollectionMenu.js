import { comfyAlert, comfyPrompt } from "../../../app/dialogs.js";
import { listCollections, createCollection, addAssetsToCollection } from "../../../api/client.js";
import {
    getOrCreateMenu as getOrCreateMenuCore,
    createMenuItem,
    createMenuSeparator,
    showMenuAt,
    clearMenu,
    hideMenu,
    MENU_Z_INDEX,
} from "../../../components/contextmenu/MenuCore.js";
import { pickRootId } from "../../../utils/ids.js";

const MENU_SELECTOR = ".mjr-collections-context-menu";

function getOrCreateCollectionsMenu() {
    return getOrCreateMenuCore({
        selector: MENU_SELECTOR,
        className: "mjr-collections-context-menu",
        minWidth: 240,
        zIndex: MENU_Z_INDEX.COLLECTIONS,
        onHide: null,
    });
}

function separator() {
    return createMenuSeparator();
}

const createItem = (label, iconClass, onClick, opts) => createMenuItem(label, iconClass, null, onClick, opts);
const showAt = showMenuAt;

function simplifyAsset(a) {
    if (!a || typeof a !== "object") return null;
    const filepath = a.filepath || a.path || a?.file_info?.filepath || "";
    if (!filepath) return null;
    return {
        filepath,
        filename: a.filename || "",
        subfolder: a.subfolder || "",
        type: (a.type || "output").toLowerCase(),
        root_id: pickRootId(a),
        kind: a.kind || "",
    };
}

function formatAddResultMessage({ collectionName, selectedCount, addRes }) {
    const added = Number(addRes?.data?.added ?? 0) || 0;
    const skippedExisting = Number(addRes?.data?.skipped_existing ?? 0) || 0;
    const skippedDuplicate = Number(addRes?.data?.skipped_duplicate ?? 0) || 0;

    const name = String(collectionName || "").trim() || "collection";
    let msg = `Added ${added} item(s) to "${name}".`;

    if (skippedExisting > 0) {
        msg += `\n\nSkipped ${skippedExisting} item(s): already present in the collection.`;
    }
    if (skippedDuplicate > 0) {
        msg += `\n\nIgnored ${skippedDuplicate} duplicate(s) in selection.`;
    }
    if (added === 0 && skippedExisting > 0 && selectedCount > 0) {
        msg = `Nothing added to "${name}".\n\nAll selected item(s) were already present in the collection.`;
    }
    return msg;
}

export async function showAddToCollectionMenu({ x, y, assets }) {
    const selected = Array.isArray(assets) ? assets.map(simplifyAsset).filter(Boolean) : [];
    if (!selected.length) {
        await comfyAlert("No assets selected.");
        return;
    }

    const listRes = await listCollections();
    const collections = Array.isArray(listRes?.data) ? listRes.data : [];

    // If none exist, directly prompt creation.
    if (!collections.length) {
        const name = await comfyPrompt("Create collection", "My collection");
        if (!name) return;
        const created = await createCollection(name);
        if (!created?.ok) {
            await comfyAlert(created?.error || "Failed to create collection.");
            return;
        }
        const cid = created.data?.id;
        const addRes = await addAssetsToCollection(cid, selected);
        if (!addRes?.ok) {
            await comfyAlert(addRes?.error || "Failed to add assets to collection.");
            return;
        }
        await comfyAlert(formatAddResultMessage({ collectionName: created.data?.name || name, selectedCount: selected.length, addRes }));
        return;
    }

    const menu = getOrCreateCollectionsMenu();
    clearMenu(menu);

    const createIt = createItem("Create collection...", "pi pi-plus", async () => {
        hideMenu(menu);
        const name = await comfyPrompt("Create collection", "My collection");
        if (!name) return;
        const created = await createCollection(name);
        if (!created?.ok) {
            await comfyAlert(created?.error || "Failed to create collection.");
            return;
        }
        const cid = created.data?.id;
        const addRes = await addAssetsToCollection(cid, selected);
        if (!addRes?.ok) {
            await comfyAlert(addRes?.error || "Failed to add assets to collection.");
            return;
        }
        await comfyAlert(formatAddResultMessage({ collectionName: created.data?.name || name, selectedCount: selected.length, addRes }));
    });
    menu.appendChild(createIt);
    menu.appendChild(separator());

    for (const c of collections) {
        const cid = String(c?.id || "");
        const name = String(c?.name || cid);
        if (!cid) continue;
        menu.appendChild(
            createItem(name, "pi pi-bookmark", async () => {
                hideMenu(menu);
                const addRes = await addAssetsToCollection(cid, selected);
                if (!addRes?.ok) {
                    await comfyAlert(addRes?.error || "Failed to add assets to collection.");
                    return;
                }
                await comfyAlert(formatAddResultMessage({ collectionName: name, selectedCount: selected.length, addRes }));
            })
        );
    }

    showAt(menu, Number(x) || 0, Number(y) || 0);
}
