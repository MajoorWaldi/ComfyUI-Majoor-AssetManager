import { comfyAlert, comfyPrompt, comfyConfirm } from "../../../app/dialogs.js";
import { listCollections, createCollection, deleteCollection } from "../../../api/client.js";

function createMenuItem(label, { right = null, checked = false, danger = false } = {}) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mjr-menu-item";
    if (danger) btn.style.color = "var(--error-text, #f44336)";

    const left = document.createElement("span");
    left.className = "mjr-menu-item-label";
    left.textContent = label;

    const rightWrap = document.createElement("span");
    rightWrap.style.cssText = "display:flex; align-items:center; gap:10px;";

    if (right) {
        const hint = document.createElement("span");
        hint.className = "mjr-menu-item-hint";
        hint.textContent = String(right);
        hint.style.opacity = "0.65";
        hint.style.fontSize = "11px";
        rightWrap.appendChild(hint);
    }

    const check = document.createElement("i");
    check.className = "pi pi-check mjr-menu-item-check";
    check.style.opacity = checked ? "1" : "0";
    rightWrap.appendChild(check);

    btn.appendChild(left);
    btn.appendChild(rightWrap);
    return btn;
}

function createDivider() {
    const d = document.createElement("div");
    d.style.cssText = "height:1px; background: var(--border-color); margin: 6px 0;";
    return d;
}

export function createCollectionsController({ state, collectionsBtn, collectionsMenu, collectionsPopover, popovers, reloadGrid }) {
    const render = async () => {
        collectionsMenu.replaceChildren();

        const createBtn = createMenuItem("Create collection...");
        createBtn.addEventListener("click", async () => {
            const name = await comfyPrompt("Create collection", "My collection");
            if (!name) return;
            const res = await createCollection(name);
            if (!res?.ok) {
                await comfyAlert(res?.error || "Failed to create collection.");
                return;
            }
            state.collectionId = String(res.data?.id || "");
            state.collectionName = String(res.data?.name || name);
            popovers.close(collectionsPopover);
            await reloadGrid();
        });
        collectionsMenu.appendChild(createBtn);

        if (state.collectionId) {
            const exitBtn = createMenuItem(`Exit collection view`, { right: state.collectionName || null });
            exitBtn.addEventListener("click", async () => {
                state.collectionId = "";
                state.collectionName = "";
                popovers.close(collectionsPopover);
                await reloadGrid();
            });
            collectionsMenu.appendChild(exitBtn);
        }

        collectionsMenu.appendChild(createDivider());

        const listRes = await listCollections();
        const list = Array.isArray(listRes?.data) ? listRes.data : [];

        if (!list.length) {
            const empty = document.createElement("div");
            empty.className = "mjr-muted";
            empty.style.cssText = "padding: 10px 12px; opacity: 0.75;";
            empty.textContent = "No collections yet.";
            collectionsMenu.appendChild(empty);
            return;
        }

        for (const item of list) {
            const id = String(item?.id || "");
            const name = String(item?.name || id);
            const count = Number(item?.count || 0) || 0;
            if (!id) continue;

            const row = document.createElement("div");
            row.style.cssText = "display:flex; align-items:stretch; width:100%;";

            const openBtn = createMenuItem(name, { right: count ? `${count}` : null, checked: state.collectionId === id });
            openBtn.style.flex = "1";
            openBtn.addEventListener("click", async () => {
                state.collectionId = id;
                state.collectionName = name;
                popovers.close(collectionsPopover);
                await reloadGrid();
            });

            const delBtn = document.createElement("button");
            delBtn.type = "button";
            delBtn.className = "mjr-menu-item";
            delBtn.title = "Delete collection";
            delBtn.style.cssText =
                "width:42px; justify-content:center; padding:0; border-left: 1px solid var(--border-color);";

            const trash = document.createElement("i");
            trash.className = "pi pi-trash";
            trash.style.opacity = "0.75";
            delBtn.appendChild(trash);

            delBtn.addEventListener("click", async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const ok = await comfyConfirm(`Delete collection \"${name}\"?`);
                if (!ok) return;
                const res = await deleteCollection(id);
                if (!res?.ok) {
                    await comfyAlert(res?.error || "Failed to delete collection.");
                    return;
                }
                if (state.collectionId === id) {
                    state.collectionId = "";
                    state.collectionName = "";
                }
                await render();
                await reloadGrid();
            });

            row.appendChild(openBtn);
            row.appendChild(delBtn);
            collectionsMenu.appendChild(row);
        }
    };

    const bind = () => {
        if (!collectionsBtn) return;
        collectionsBtn.addEventListener("click", async (e) => {
            e.stopPropagation();
            try {
                await render();
            } catch {}
            popovers.toggle(collectionsPopover, collectionsBtn);
        });
    };

    return { bind, render };
}

