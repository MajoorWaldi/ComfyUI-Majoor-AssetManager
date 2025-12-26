import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { applyStyles, CONTEXT_MENU_STYLES, createEl, mjrShowToast } from "./ui_settings.js";
import { mjrOpenABViewer } from "./ui_viewer.js";

export function mjrCreateContextMenu(file, deps) {
  const { state, fileKey, removeFileFromState, refreshCollections, closeContextMenu, updateStatus } = deps;
  const contextMenu = createEl("div", "context-menu");
  applyStyles(contextMenu, CONTEXT_MENU_STYLES);
  const relPath = `${file.subfolder ? file.subfolder + "/" : ""}${file.filename || file.name}`;
  const currentKey = fileKey(file);
  const normalizePath = (p = "") => (p.startsWith("/") ? p.slice(1) : p);

  // --- COLLECTION SUBMENU ---
  const addToCollItem = createEl("div", "", "Add to Collection ▶");
  addToCollItem.style.padding = "4px 0";
  addToCollItem.style.cursor = "pointer";
  
  const closeSubmenu = (relatedTarget) => {
    const submenu = contextMenu.querySelector(".mjr-submenu");
    if (!submenu) return;
    const withinSub = relatedTarget && submenu.contains(relatedTarget);
    const withinItem = relatedTarget && addToCollItem.contains(relatedTarget);
    if (!withinSub && !withinItem) submenu.remove();
  };

  addToCollItem.addEventListener("mouseenter", async () => {
    const old = contextMenu.querySelector(".mjr-submenu");
    if (old) old.remove();

    const submenu = createEl("div", "mjr-submenu");
    applyStyles(submenu, CONTEXT_MENU_STYLES);
    submenu.style.position = "absolute";
    submenu.style.left = "140px";
    submenu.style.top = "0";

    try {
      const res = await api.fetchApi("/mjr/collections/list");
      const data = await res.json().catch(() => ({}));

      // 1. Create New
      const newItem = createEl("div", "", "+ New Collection");
      newItem.style.padding = "4px 0";
      newItem.style.cursor = "pointer";
      newItem.style.borderBottom = "1px solid #444";
      newItem.style.marginBottom = "4px";
      
      const handleAdd = async (name) => {
          const targets = (state.selected && state.selected.has(currentKey))
              ? Array.from(state.selected).map(normalizePath)
              : [relPath];
          
          for (const targetPath of targets) {
            await api.fetchApi("/mjr/collections/add", {
              method: "POST",
              body: JSON.stringify({ name, path: targetPath }),
            });
          }
          mjrShowToast("success", `Added ${targets.length} file(s) to ${name}`, "Collection");
          refreshCollections();
          closeContextMenu();
      };

      newItem.addEventListener("click", (e) => {
        e.stopPropagation();
        const name = window.prompt("Collection Name:");
        if (name) handleAdd(name);
      });
      submenu.appendChild(newItem);

      // 2. Existing Collections
      (data.collections || []).forEach((name) => {
        const item = createEl("div", "", name);
        item.style.padding = "4px 0";
        item.style.cursor = "pointer";
        item.addEventListener("click", (e) => {
          e.stopPropagation();
          handleAdd(name);
        });
        submenu.appendChild(item);
      });
    } catch (err) {
      console.error("[Majoor.AssetsManager] collections submenu failed", err);
    }
    // append to parent to avoid expanding main item height
    contextMenu.appendChild(submenu);

    submenu.addEventListener("mouseleave", (ev) => closeSubmenu(ev.relatedTarget));
  });
  
  addToCollItem.addEventListener("mouseleave", (ev) => closeSubmenu(ev.relatedTarget));
  contextMenu.appendChild(addToCollItem);

  // --- ACTIONS ---
  const actions = [
    {
      label: "Open Folder",
      action: async () => {
        closeContextMenu();
        try {
          const res = await api.fetchApi("/mjr/filemanager/open_folder", {
            method: "POST",
            body: JSON.stringify({
              filename: file.filename || file.name,
              subfolder: file.subfolder || "",
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || data.ok === false) throw new Error(data.error || "Request failed");
          
          if (data.warning) mjrShowToast("warn", data.warning, "Folder");
          else mjrShowToast("success", "Opened folder", "Folder");
        } catch (err) {
          mjrShowToast("error", err?.message || "Failed to open folder", "Folder");
        }
      },
    },
    {
      label: "Compare",
      action: () => {
        closeContextMenu();
        if (state.selected && state.selected.size === 2) {
          const keys = Array.from(state.selected);
          const keyToFile = new Map();
          for (const f of state.filtered) {
            const rawName = f.name || f.filename || "(unnamed)";
            const k = `${f.subfolder || ""}/${rawName}`;
            keyToFile.set(k, f);
          }
          const filesToShow = keys.map((k) => keyToFile.get(k)).filter(Boolean);
          if (filesToShow.length === 2) {
            mjrOpenABViewer(filesToShow[0], filesToShow[1]);
          }
        }
      },
    },
    {
      label: "Delete",
      action: async () => {
        closeContextMenu();

        // 1. Gather Items
        const currentKeyInner = fileKey(file);
        let itemsToDelete = [];
        if (state.selected && state.selected.has(currentKeyInner)) {
          const keyToFile = new Map();
          for (const f of state.files) keyToFile.set(fileKey(f), f);
          state.selected.forEach((k) => {
            const f = keyToFile.get(k);
            if (f) itemsToDelete.push({ filename: f.filename || f.name, subfolder: f.subfolder || "" });
          });
        } else {
          itemsToDelete.push({ filename: file.filename || file.name, subfolder: file.subfolder || "" });
        }
        if (!itemsToDelete.length) return;

        // 2. Show Dialog
        const count = itemsToDelete.length;
        const confirmHtml = `
          <div style="text-align:center; padding:10px;">
            <h3 style="margin: 0 0 10px 0; color: var(--fg-color);">Delete ${count} file${count > 1 ? "s" : ""}?</h3>
            <p style="margin: 0 0 20px 0; font-size: 0.9rem; opacity: 0.8;">This cannot be undone.</p>
            <div style="display:flex; gap:15px; justify-content:center;">
              <button id="mjr-cancel-btn" class="comfy-btn">Cancel</button>
              <button id="mjr-delete-btn" class="comfy-btn" style="background:#a33; color: white;">Delete</button>
            </div>
          </div>
        `;

        const dialog = new app.ui.dialog.constructor();
        dialog.show(confirmHtml); // Correct usage: pass HTML string to show()

        // 3. Bind Events
        const btnDelete = dialog.element.querySelector("#mjr-delete-btn");
        const btnCancel = dialog.element.querySelector("#mjr-cancel-btn");

        if (btnDelete) btnDelete.onclick = async () => {
          dialog.close();
          try {
            const res = await api.fetchApi("/mjr/filemanager/delete", {
              method: "POST",
              body: JSON.stringify({ items: itemsToDelete }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || data.ok === false) throw new Error(data.error || "Request failed");

            // Update State
            itemsToDelete.forEach((item) => {
              const f = state.files.find(
                (x) => (x.filename || x.name) === item.filename && (x.subfolder || "") === item.subfolder
              );
              if (f) removeFileFromState(f);
            });
            
            if (state.selected && state.selected.clear) {
              state.selected.clear();
              updateStatus();
            }
            mjrShowToast("success", `${count} file(s) deleted`, "Trash");
          } catch (e) {
            mjrShowToast("error", e?.message || "Delete failed", "Error");
          }
        };

        if (btnCancel) btnCancel.onclick = () => dialog.close();
      },
    },
  ];

  actions.forEach(({ label, action }) => {
    const item = createEl("div", "", label);
    item.style.padding = "4px 0";
    item.style.cursor = "pointer";
    item.addEventListener("click", () => action());
    contextMenu.appendChild(item);
  });

  return contextMenu;
}
