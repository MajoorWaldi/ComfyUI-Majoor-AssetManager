export function createCustomRootsController({
    state,
    customSelect,
    customRemoveBtn,
    comfyAlert,
    comfyConfirm,
    comfyPrompt,
    get,
    post,
    ENDPOINTS,
    reloadGrid
}) {
    const isSensitivePath = (input) => {
        try {
            const raw = String(input || "").trim();
            if (!raw) return false;
            const p = raw.replaceAll("\\", "/").toLowerCase();

            // Very broad roots (drive root / filesystem root).
            if (p === "/" || /^[a-z]:\/?$/.test(p)) return true;

            // Common sensitive/system folders (best-effort heuristics).
            const needles = [
                "/windows",
                "/program files",
                "/program files (x86)",
                "/users",
                "/appdata",
                "/system32",
                "/etc",
                "/usr",
                "/bin",
                "/var",
            ];
            return needles.some((n) => p === n || p.startsWith(n + "/") || p.includes(n + "/"));
        } catch {
            return false;
        }
    };

    const refreshCustomRoots = async (preferId = null) => {
        try {
            const json = await get(ENDPOINTS.CUSTOM_ROOTS);
            const roots = json && json.ok && Array.isArray(json.data) ? json.data : [];
            customSelect.innerHTML = "";

            const placeholder = document.createElement("option");
            placeholder.value = "";
            placeholder.textContent = "Select folder…";
            customSelect.appendChild(placeholder);

            roots.forEach((r) => {
                const opt = document.createElement("option");
                opt.value = r.id;
                opt.textContent = r.name || r.path || r.id;
                customSelect.appendChild(opt);
            });

            const desired = preferId || state.customRootId;
            if (desired && roots.some((r) => r.id === desired)) {
                customSelect.value = desired;
                state.customRootId = desired;
            } else {
                customSelect.value = "";
                state.customRootId = "";
            }
            customRemoveBtn.disabled = !state.customRootId;
        } catch (err) {
            console.warn("Majoor: failed to load custom roots", err);
        }
    };

    const bind = ({ customAddBtn, customRemoveBtn }) => {
        customSelect.addEventListener("change", async () => {
            state.customRootId = customSelect.value || "";
            customRemoveBtn.disabled = !state.customRootId;
            await reloadGrid();
        });

        customAddBtn.addEventListener("click", async () => {
            const path = await comfyPrompt(
                "Enter a folder path to add as a Custom root:",
                "",
                "Majoor: Custom Folders"
            );
            if (!path) return;
            try {
                if (isSensitivePath(path)) {
                    const ok = await comfyConfirm(
                        "This looks like a system or very broad directory.\n\nAdding it can expose sensitive files via the viewer/custom roots feature.\n\nContinue?",
                        "Majoor: Security Warning"
                    );
                    if (!ok) return;
                }
            } catch {}
            try {
                const json = await post(ENDPOINTS.CUSTOM_ROOTS, { path });
                if (!json?.ok) {
                    await comfyAlert(json?.error || "Failed to add custom folder", "Majoor: Custom Folders");
                    return;
                }
                const newId = json.data?.id;
                await refreshCustomRoots(newId);
                await reloadGrid();
            } catch (err) {
                console.warn("Majoor: add custom root failed", err);
            }
        });

        customRemoveBtn.addEventListener("click", async () => {
            if (!state.customRootId) return;
            const ok = await comfyConfirm("Remove this custom folder?", "Majoor: Custom Folders");
            if (!ok) return;
            try {
                const json = await post(ENDPOINTS.CUSTOM_ROOTS_REMOVE, { id: state.customRootId });
                if (!json?.ok) {
                    await comfyAlert(json?.error || "Failed to remove custom folder", "Majoor: Custom Folders");
                    return;
                }
                state.customRootId = "";
                await refreshCustomRoots();
                await reloadGrid();
            } catch (err) {
                console.warn("Majoor: remove custom root failed", err);
            }
        });
    };

    return { refreshCustomRoots, bind };
}

