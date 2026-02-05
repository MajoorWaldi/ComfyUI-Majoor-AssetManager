import { comfyPrompt, comfyConfirm } from "../../../app/dialogs.js";
import { comfyToast } from "../../../app/toast.js";
import { listCollections, createCollection, deleteCollection } from "../../../api/client.js";
import { t } from "../../../app/i18n.js";

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

export function createCollectionsController({ state, collectionsBtn, collectionsMenu, collectionsPopover, popovers, reloadGrid, onChanged = null }) {
    const render = async () => {
        collectionsMenu.replaceChildren();

        const createBtn = createMenuItem(t("ctx.createCollection"));
        createBtn.addEventListener("click", async () => {
            const name = await comfyPrompt(t("dialog.createCollection"), t("dialog.collectionPlaceholder"));
            if (!name) return;
            const res = await createCollection(name);
            if (!res?.ok) {
                comfyToast(res?.error || t("toast.failedCreateCollection"), "error");
                return;
            }
            state.collectionId = String(res.data?.id || "");
            state.collectionName = String(res.data?.name || name);
            try {
                onChanged?.();
            } catch {}
            popovers.close(collectionsPopover);
            await reloadGrid();
        });
        collectionsMenu.appendChild(createBtn);

            if (state.collectionId) {
                const exitBtn = createMenuItem(t("ctx.exitCollection"), { right: state.collectionName || null });
                exitBtn.addEventListener("click", async () => {
                    state.collectionId = "";
                    state.collectionName = "";
                    try {
                        onChanged?.();
                    } catch {}
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
            empty.textContent = t("msg.noCollections");
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
                try {
                    onChanged?.();
                } catch {}
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
                const ok = await comfyConfirm(t("dialog.deleteCollection", `Delete collection "${name}"?`, { name }));
                if (!ok) return;
                const res = await deleteCollection(id);
                if (!res?.ok) {
                    comfyToast(res?.error || t("toast.failedDeleteCollection"), "error");
                    return;
                }
                if (state.collectionId === id) {
                    state.collectionId = "";
                    state.collectionName = "";
                    try {
                        onChanged?.();
                    } catch {}
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

