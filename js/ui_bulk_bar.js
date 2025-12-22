/**
 * Bulk Actions Bar
 *
 * Professional bulk operations UI with progress tracking.
 * Shows when multiple assets are selected.
 */

import { showToast } from './ui_settings.js';

/**
 * Create bulk actions bar component
 */
export function createBulkBar(state, api, callbacks) {
    const container = document.createElement('div');
    container.className = 'mjr-bulk-bar-container';
    container.style.display = 'none';

    const bar = document.createElement('div');
    bar.className = 'mjr-bulk-bar';

    // Selection count label
    const countLabel = document.createElement('span');
    countLabel.className = 'mjr-bulk-count';
    countLabel.textContent = '0 selected';

    // Action buttons
    const rateBtn = createButton('⭐ Rate', () => showBulkRateDialog(state, api, callbacks));
    const tagBtn = createButton('🏷️ Tag', () => showBulkTagDialog(state, api, callbacks));
    const deleteBtn = createButton('🗑️ Delete', () => showBulkDeleteDialog(state, api, callbacks));
    const exportBtn = createButton('📤 Export', () => exportSelectionList(state));
    const clearBtn = createButton('✖ Clear', () => {
        state.selected.clear();
        if (callbacks.onSelectionChange) {
            callbacks.onSelectionChange();
        }
        updateBulkBar();
    });

    bar.appendChild(countLabel);
    bar.appendChild(rateBtn);
    bar.appendChild(tagBtn);
    bar.appendChild(deleteBtn);
    bar.appendChild(exportBtn);
    bar.appendChild(clearBtn);
    container.appendChild(bar);

    function updateBulkBar() {
        const count = state.selected.size;
        if (count > 0) {
            countLabel.textContent = `${count} selected`;
            container.style.display = 'flex';
        } else {
            container.style.display = 'none';
        }
    }

    return {
        element: container,
        update: updateBulkBar
    };
}

function createButton(text, onClick) {
    const btn = document.createElement('button');
    btn.className = 'mjr-bulk-btn';
    btn.textContent = text;
    btn.onclick = onClick;
    return btn;
}

// ===== Bulk Dialogs =====

async function showBulkRateDialog(state, api, callbacks) {
    const selected = Array.from(state.selected);
    if (selected.length === 0) return;

    const rating = await promptRating();
    if (rating === null) return;

    await performBulkUpdate(
        state,
        selected,
        { rating },
        `Updating rating for ${selected.length} assets...`,
        callbacks
    );
}

async function showBulkTagDialog(state, api, callbacks) {
    const selected = Array.from(state.selected);
    if (selected.length === 0) return;

    const result = await promptTags();
    if (!result) return;

    const { action, tags } = result;

    await performBulkUpdate(
        state,
        selected,
        { tags, tagsAction: action },
        `Updating tags for ${selected.length} assets...`,
        callbacks
    );
}

async function showBulkDeleteDialog(state, api, callbacks) {
    const selected = Array.from(state.selected);
    if (selected.length === 0) return;

    const confirm = window.confirm(
        `Delete ${selected.length} assets?\n\n` +
        `This will move them to the recycle bin.`
    );

    if (!confirm) return;

    await performBulkDelete(state, selected, callbacks);
}

function exportSelectionList(state) {
    const selected = Array.from(state.selected);
    if (selected.length === 0) return;

    // Convert selection to exportable format
    const data = selected.map(id => {
        const file = state.filesMap?.get(id);
        if (!file) return { id };

        return {
            filename: file.filename,
            subfolder: file.subfolder || '',
            rating: file.rating || 0,
            tags: file.tags || [],
            has_workflow: file.has_workflow || false,
        };
    });

    // Create downloadable JSON
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `assets-selection-${Date.now()}.json`;
    a.click();

    URL.revokeObjectURL(url);
    showToast(`Exported ${selected.length} assets`);
}

// ===== Progress Modal =====

function createProgressModal(title, total) {
    const overlay = document.createElement('div');
    overlay.className = 'mjr-progress-overlay';

    const modal = document.createElement('div');
    modal.className = 'mjr-progress-modal';

    const titleEl = document.createElement('h3');
    titleEl.textContent = title;

    const progressBar = document.createElement('div');
    progressBar.className = 'mjr-progress-bar';
    const progressFill = document.createElement('div');
    progressFill.className = 'mjr-progress-fill';
    progressBar.appendChild(progressFill);

    const statusLabel = document.createElement('div');
    statusLabel.className = 'mjr-progress-status';
    statusLabel.textContent = '0 / ' + total;

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'mjr-progress-cancel';
    cancelBtn.textContent = 'Cancel';

    modal.appendChild(titleEl);
    modal.appendChild(progressBar);
    modal.appendChild(statusLabel);
    modal.appendChild(cancelBtn);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    let cancelled = false;

    cancelBtn.onclick = () => {
        cancelled = true;
        cancelBtn.disabled = true;
        cancelBtn.textContent = 'Cancelling...';
    };

    return {
        update: (current) => {
            const percent = (current / total) * 100;
            progressFill.style.width = percent + '%';
            statusLabel.textContent = `${current} / ${total}`;
        },
        close: () => {
            document.body.removeChild(overlay);
        },
        isCancelled: () => cancelled
    };
}

// ===== Bulk Operations =====

async function performBulkUpdate(state, selectedIds, updates, progressTitle, callbacks) {
    const items = selectedIds.map(id => {
        const file = state.filesMap?.get(id);
        return file ? {
            filename: file.filename,
            subfolder: file.subfolder || ''
        } : null;
    }).filter(Boolean);

    if (items.length === 0) return;

    // Show progress modal for large selections
    const showProgress = items.length > 100;
    const progress = showProgress ? createProgressModal(progressTitle, items.length) : null;

    try {
        // Prepare updates payload
        const payload = {
            items: items,
            updates: {}
        };

        if (updates.rating !== undefined) {
            payload.updates.rating = updates.rating;
        }

        if (updates.tags !== undefined) {
            if (updates.tagsAction === 'add') {
                payload.updates.tags_add = updates.tags;
            } else if (updates.tagsAction === 'remove') {
                payload.updates.tags_remove = updates.tags;
            } else {
                payload.updates.tags = updates.tags;
            }
        }

        // Call batch update endpoint
        const resp = await fetch('/mjr/filemanager/metadata/batch_update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!resp.ok) {
            throw new Error(`HTTP ${resp.status}`);
        }

        const result = await resp.json();

        // Sync to index
        await fetch('/mjr/filemanager/index/sync_from_metadata', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assets: items.map(i => ({ ...i, ...updates })) })
        });

        // Update progress
        if (progress) {
            progress.update(items.length);
        }

        showToast(`Updated ${items.length} assets successfully`);

        // Refresh grid
        if (callbacks.onRefresh) {
            callbacks.onRefresh();
        }

    } catch (error) {
        console.error('[Majoor] Bulk update failed:', error);
        showToast(`Bulk update failed: ${error.message}`, 'error');
    } finally {
        if (progress) {
            setTimeout(() => progress.close(), 500);
        }
    }
}

async function performBulkDelete(state, selectedIds, callbacks) {
    const items = selectedIds.map(id => {
        const file = state.filesMap?.get(id);
        return file ? {
            filename: file.filename,
            subfolder: file.subfolder || ''
        } : null;
    }).filter(Boolean);

    if (items.length === 0) return;

    const progress = createProgressModal(`Deleting ${items.length} assets...`, items.length);

    try {
        const resp = await fetch('/mjr/filemanager/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items })
        });

        if (!resp.ok) {
            throw new Error(`HTTP ${resp.status}`);
        }

        progress.update(items.length);
        showToast(`Deleted ${items.length} assets`);

        // Clear selection
        state.selected.clear();

        // Refresh grid
        if (callbacks.onRefresh) {
            callbacks.onRefresh();
        }

    } catch (error) {
        console.error('[Majoor] Bulk delete failed:', error);
        showToast(`Bulk delete failed: ${error.message}`, 'error');
    } finally {
        setTimeout(() => progress.close(), 500);
    }
}

// ===== Input Dialogs =====

function promptRating() {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'mjr-dialog-overlay';

        const dialog = document.createElement('div');
        dialog.className = 'mjr-dialog';

        const title = document.createElement('h3');
        title.textContent = 'Set Rating';

        const starsContainer = document.createElement('div');
        starsContainer.className = 'mjr-rating-stars';

        let selectedRating = 0;

        for (let i = 0; i <= 5; i++) {
            const star = document.createElement('span');
            star.className = 'mjr-rating-star';
            star.textContent = i === 0 ? '🚫' : '★';
            star.dataset.rating = i;

            star.onclick = () => {
                selectedRating = i;
                updateStars();
            };

            starsContainer.appendChild(star);
        }

        function updateStars() {
            Array.from(starsContainer.children).forEach((s, idx) => {
                s.classList.toggle('active', idx <= selectedRating && selectedRating > 0);
            });
        }

        const btnContainer = document.createElement('div');
        btnContainer.className = 'mjr-dialog-buttons';

        const okBtn = document.createElement('button');
        okBtn.textContent = 'OK';
        okBtn.onclick = () => {
            document.body.removeChild(overlay);
            resolve(selectedRating);
        };

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.onclick = () => {
            document.body.removeChild(overlay);
            resolve(null);
        };

        btnContainer.appendChild(okBtn);
        btnContainer.appendChild(cancelBtn);

        dialog.appendChild(title);
        dialog.appendChild(starsContainer);
        dialog.appendChild(btnContainer);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
    });
}

function promptTags() {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'mjr-dialog-overlay';

        const dialog = document.createElement('div');
        dialog.className = 'mjr-dialog';

        const title = document.createElement('h3');
        title.textContent = 'Manage Tags';

        const actionLabel = document.createElement('label');
        actionLabel.textContent = 'Action:';

        const actionSelect = document.createElement('select');
        actionSelect.innerHTML = `
            <option value="add">Add tags</option>
            <option value="remove">Remove tags</option>
            <option value="set">Set tags (replace)</option>
        `;

        const tagsLabel = document.createElement('label');
        tagsLabel.textContent = 'Tags (comma-separated):';

        const tagsInput = document.createElement('input');
        tagsInput.type = 'text';
        tagsInput.placeholder = 'favorite, portrait, hd';

        const btnContainer = document.createElement('div');
        btnContainer.className = 'mjr-dialog-buttons';

        const okBtn = document.createElement('button');
        okBtn.textContent = 'OK';
        okBtn.onclick = () => {
            const tagsStr = tagsInput.value.trim();
            if (!tagsStr) {
                resolve(null);
                document.body.removeChild(overlay);
                return;
            }

            const tags = tagsStr.split(',').map(t => t.trim()).filter(Boolean);
            const action = actionSelect.value;

            document.body.removeChild(overlay);
            resolve({ action, tags });
        };

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.onclick = () => {
            document.body.removeChild(overlay);
            resolve(null);
        };

        btnContainer.appendChild(okBtn);
        btnContainer.appendChild(cancelBtn);

        dialog.appendChild(title);
        dialog.appendChild(actionLabel);
        dialog.appendChild(actionSelect);
        dialog.appendChild(tagsLabel);
        dialog.appendChild(tagsInput);
        dialog.appendChild(btnContainer);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        tagsInput.focus();
    });
}

// ===== CSS Styles =====

const STYLES = `
.mjr-bulk-bar-container {
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 9999;
    animation: mjr-slide-up 0.3s ease-out;
}

.mjr-bulk-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    background: var(--comfy-menu-bg);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    padding: 12px 20px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
}

.mjr-bulk-count {
    font-weight: 600;
    margin-right: 8px;
    color: var(--fg-color);
}

.mjr-bulk-btn {
    padding: 6px 12px;
    border: 1px solid var(--border-color);
    background: var(--comfy-input-bg);
    color: var(--fg-color);
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    transition: all 0.2s;
}

.mjr-bulk-btn:hover {
    background: var(--comfy-input-bg);
    filter: brightness(1.2);
}

.mjr-progress-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
}

.mjr-progress-modal {
    background: var(--comfy-menu-bg);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    padding: 24px;
    min-width: 400px;
    max-width: 500px;
}

.mjr-progress-modal h3 {
    margin: 0 0 16px 0;
    color: var(--fg-color);
}

.mjr-progress-bar {
    width: 100%;
    height: 24px;
    background: var(--comfy-input-bg);
    border-radius: 12px;
    overflow: hidden;
    margin-bottom: 12px;
}

.mjr-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #22c55e, #16a34a);
    transition: width 0.3s ease;
    width: 0%;
}

.mjr-progress-status {
    text-align: center;
    margin-bottom: 16px;
    color: var(--fg-color);
}

.mjr-progress-cancel {
    width: 100%;
    padding: 8px;
    background: var(--comfy-input-bg);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    cursor: pointer;
    color: var(--fg-color);
}

.mjr-dialog-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
}

.mjr-dialog {
    background: var(--comfy-menu-bg);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    padding: 24px;
    min-width: 300px;
    max-width: 500px;
}

.mjr-dialog h3 {
    margin: 0 0 16px 0;
    color: var(--fg-color);
}

.mjr-dialog label {
    display: block;
    margin-bottom: 8px;
    color: var(--fg-color);
}

.mjr-dialog input,
.mjr-dialog select {
    width: 100%;
    padding: 8px;
    margin-bottom: 16px;
    background: var(--comfy-input-bg);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    color: var(--input-text);
}

.mjr-dialog-buttons {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
}

.mjr-dialog-buttons button {
    padding: 8px 16px;
    background: var(--comfy-input-bg);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    cursor: pointer;
    color: var(--fg-color);
}

.mjr-rating-stars {
    display: flex;
    gap: 8px;
    justify-content: center;
    margin: 20px 0;
}

.mjr-rating-star {
    font-size: 32px;
    cursor: pointer;
    opacity: 0.3;
    transition: opacity 0.2s;
}

.mjr-rating-star:hover {
    opacity: 0.7;
}

.mjr-rating-star.active {
    opacity: 1;
}

@keyframes mjr-slide-up {
    from {
        opacity: 0;
        transform: translateX(-50%) translateY(20px);
    }
    to {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
    }
}
`;

let stylesInjected = false;
export function injectBulkBarStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const styleEl = document.createElement('style');
    styleEl.textContent = STYLES;
    document.head.appendChild(styleEl);
}
