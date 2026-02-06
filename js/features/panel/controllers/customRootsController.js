import { t } from "../../../app/i18n.js";

export function createCustomRootsController({
    state,
    customSelect,
    customRemoveBtn,
    comfyConfirm,
    comfyPrompt,
    comfyToast,
    get,
    post,
    ENDPOINTS,
    reloadGrid,
    onRootChanged = null
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
        // Show loading state
        const originalPlaceholder = customSelect.querySelector('option[value=""]')?.textContent || t("label.selectFolder", "Select folder…");
        customSelect.innerHTML = "";

        const loadingOption = document.createElement("option");
        loadingOption.value = "";
        loadingOption.textContent = t("msg.loading");
        loadingOption.disabled = true;
        customSelect.appendChild(loadingOption);
        customSelect.disabled = true;

        try {
            const json = await get(ENDPOINTS.CUSTOM_ROOTS);
            const roots = json && json.ok && Array.isArray(json.data) ? json.data : [];
            customSelect.innerHTML = "";

            const placeholder = document.createElement("option");
            placeholder.value = "";
            placeholder.textContent = originalPlaceholder;
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
            // Show error state
            customSelect.innerHTML = "";
            const errorOption = document.createElement("option");
            errorOption.value = "";
            errorOption.textContent = t("msg.errorLoadingFolders");
            errorOption.disabled = true;
            customSelect.appendChild(errorOption);
        } finally {
            customSelect.disabled = false;
        }
    };

    const bind = ({ customAddBtn, customRemoveBtn }) => {
        customSelect.addEventListener("change", async () => {
            // Only update state if not disabled (not in loading/error state)
            if (!customSelect.disabled) {
                state.customRootId = customSelect.value || "";
                customRemoveBtn.disabled = !state.customRootId;
                try {
                    await onRootChanged?.(state);
                } catch {}
                await reloadGrid();
            }
        });

        customAddBtn.addEventListener("click", async () => {
            // Disable button during operation to prevent multiple clicks
            customAddBtn.disabled = true;
            customAddBtn.textContent = t("btn.adding");

            try {
                // Attempt to open the native folder selector via the backend
                const response = await post("/mjr/sys/browse-folder", {});

                if (response && response.ok && response.data && response.data.path) {
                    // If a path is returned, use it directly
                    const path = response.data.path;

                    // (Optional) Security check as in the original code
                    if (isSensitivePath(path)) {
                        const ok = await comfyConfirm(
                            t("dialog.securityWarning", "This looks like a system or very broad directory.\n\nAdding it can expose sensitive files via the viewer/custom roots feature.\n\nContinue?"),
                            t("dialog.securityWarningTitle", "Majoor: Security Warning")
                        );
                        if (!ok) return;
                    }

                    // Send to backend for actual addition
                    const json = await post(ENDPOINTS.CUSTOM_ROOTS, { path });
                    if (!json?.ok) {
                        comfyToast(json?.error || t("toast.failedAddFolder", "Failed to add custom folder"), "error");
                        return;
                    }
                    // Refresh
                    comfyToast(t("toast.folderLinked", "Folder linked successfully"), "success");
                    await refreshCustomRoots(json.data?.id);
                    await reloadGrid();
                    return;
                } else if (response && !response.ok && (response.code === "TKINTER_ERROR" || response.code === "HEADLESS_ENV" || response.code === "TKINTER_UNAVAILABLE")) {
                    // Handle specific tkinter errors
                    console.warn("Tkinter error:", response.error);
                    comfyToast(t("toast.nativeBrowserUnavailable", "Native folder browser unavailable. Please enter path manually."), "warning");
                }
            } catch (e) {
                console.log("Native selector failed or was cancelled, falling back to manual input...", e);
            } finally {
                // Re-enable button regardless of outcome
                customAddBtn.disabled = false;
                customAddBtn.textContent = t("btn.add");
            }

            // --- FALLBACK TO ORIGINAL METHOD (Text box) ---
            const path = await comfyPrompt(
                t("dialog.enterFolderPath", "Enter a folder path to add as a Custom root:"),
                "",
                t("dialog.customFoldersTitle", "Majoor: Custom Folders")
            );
            if (!path) return;

            try {
                if (isSensitivePath(path)) {
                    const ok = await comfyConfirm(
                        t("dialog.securityWarning", "This looks like a system or very broad directory.\n\nAdding it can expose sensitive files via the viewer/custom roots feature.\n\nContinue?"),
                        t("dialog.securityWarningTitle", "Majoor: Security Warning")
                    );
                    if (!ok) return;
                }
            } catch {}

            try {
                // Show loading state
                customAddBtn.disabled = true;
                customAddBtn.textContent = t("btn.adding");

                const json = await post(ENDPOINTS.CUSTOM_ROOTS, { path });
                if (!json?.ok) {
                    comfyToast(json?.error || t("toast.failedAddFolder", "Failed to add custom folder"), "error");
                    return;
                }
                const newId = json.data?.id;
                comfyToast(t("toast.folderLinked", "Folder linked successfully"), "success");
                await refreshCustomRoots(newId);
                await reloadGrid();
            } catch (err) {
                console.warn("Majoor: add custom root failed", err);
                comfyToast(t("toast.errorAddingFolder", "An error occurred while adding the custom folder"), "error");
            } finally {
                // Re-enable button regardless of outcome
                customAddBtn.disabled = false;
                customAddBtn.textContent = t("btn.add");
            }
        });

        customRemoveBtn.addEventListener("click", async () => {
            if (!state.customRootId) return;

            const selectedOption = customSelect.options[customSelect.selectedIndex];
            const folderName = selectedOption ? selectedOption.text : t("label.thisFolder", "this folder");

            const ok = await comfyConfirm(t("dialog.removeFolder", `Remove the custom folder "${folderName}"?`, { name: folderName }), t("dialog.customFoldersTitle", "Majoor: Custom Folders"));
            if (!ok) return;

            // Show loading state
            customRemoveBtn.disabled = true;
            customRemoveBtn.textContent = t("btn.removing");

            try {
                const json = await post(ENDPOINTS.CUSTOM_ROOTS_REMOVE, { id: state.customRootId });
                if (!json?.ok) {
                    comfyToast(json?.error || t("toast.failedRemoveFolder", "Failed to remove custom folder"), "error");
                    return;
                }
                comfyToast(t("toast.folderRemoved", "Folder removed"), "success");
                state.customRootId = "";
                await refreshCustomRoots();
                await reloadGrid();
            } catch (err) {
                console.warn("Majoor: remove custom root failed", err);
                comfyToast(t("toast.errorRemovingFolder", "An error occurred while removing the custom folder"), "error");
            } finally {
                // Re-enable button regardless of outcome
                customRemoveBtn.disabled = !state.customRootId; // Keep disabled if no selection
                customRemoveBtn.textContent = t("btn.remove");
            }
        });
    };

    return { refreshCustomRoots, bind };
}

