/**
 * Status Dot Indicator
 *
 * Shows real-time index status:
 * - Green: Index up-to-date
 * - Yellow: Indexing in progress
 * - Red: Error
 * - Gray: Stale (needs reindex)
 */

export function createStatusDot(api) {
    const dot = document.createElement('span');
    dot.className = 'mjr-status-dot mjr-status-unknown';
    dot.title = 'Index status: loading...';

    let pollInterval = null;

    async function updateStatus() {
        try {
            const resp = await api.fetchApi('/mjr/filemanager/index/status');
            const status = await resp.json();

            // Determine dot class based on status
            let dotClass = 'mjr-status-unknown';
            if (status.status === 'error') {
                dotClass = 'mjr-status-error';
            } else if (status.status === 'indexing') {
                dotClass = 'mjr-status-indexing';
            } else if (status.freshness === 'stale') {
                dotClass = 'mjr-status-stale';
            } else if (status.freshness === 'up_to_date') {
                dotClass = 'mjr-status-up_to_date';
            } else {
                dotClass = 'mjr-status-idle';
            }

            dot.className = `mjr-status-dot ${dotClass}`;

            // Build tooltip
            const tooltip = [];
            tooltip.push(`Status: ${status.status}`);

            if (status.total_assets !== undefined) {
                tooltip.push(`Assets: ${status.indexed_assets.toLocaleString()} / ${status.total_assets.toLocaleString()}`);
            }

            if (status.last_scan) {
                try {
                    const lastScan = new Date(status.last_scan);
                    tooltip.push(`Last scan: ${lastScan.toLocaleString()}`);
                } catch (e) {
                    tooltip.push(`Last scan: ${status.last_scan}`);
                }
            }

            if (status.backlog > 0) {
                tooltip.push(`Backlog: ${status.backlog} files`);
            }

            if (status.errors && status.errors.length > 0) {
                tooltip.push(`Errors: ${status.errors.slice(0, 3).join(', ')}`);
                if (status.errors.length > 3) {
                    tooltip.push(`...and ${status.errors.length - 3} more`);
                }
            }

            if (status.fts_available !== undefined) {
                if (status.fts_available) {
                    tooltip.push('✓ Full-text search enabled');
                } else {
                    tooltip.push('⚠️ FTS5 not available, search limited');
                }
            }

            dot.title = tooltip.join('\n');

        } catch (error) {
            console.error('[Majoor] Failed to fetch index status:', error);
            dot.className = 'mjr-status-dot mjr-status-error';
            dot.title = `Index status: Error\n${error.message}`;
        }
    }

    // Initial update
    updateStatus();

    // Poll every 5 seconds
    pollInterval = setInterval(updateStatus, 5000);

    // Cleanup function
    const cleanup = () => {
        if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
        }
    };

    // Click to manually trigger reindex
    dot.addEventListener('click', async (e) => {
        e.stopPropagation();

        const confirm = window.confirm('Reindex all assets? This may take a few minutes for large libraries.');
        if (!confirm) return;

        try {
            const resp = await api.fetchApi('/mjr/filemanager/index/reindex', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({scope: 'all'})
            });

            const result = await resp.json();

            if (result.status === 'started') {
                alert('Reindexing started in background. Check status dot for progress.');
                updateStatus(); // Immediate update
            } else {
                alert('Reindexing failed: ' + (result.error || 'Unknown error'));
            }
        } catch (error) {
            console.error('[Majoor] Failed to trigger reindex:', error);
            alert('Failed to trigger reindex: ' + error.message);
        }
    });

    return {
        element: dot,
        update: updateStatus,
        cleanup: cleanup
    };
}

// CSS styles (inject once)
const STYLES = `
.mjr-status-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-left: 8px;
    transition: background-color 0.3s;
    cursor: pointer;
}

 .mjr-status-idle,
.mjr-status-up_to_date {
    background-color: var(--mjr-status-success, #22c55e);
}

.mjr-status-indexing {
    background-color: var(--mjr-status-warning, #eab308);
    animation: mjr-pulse 2s infinite;
}

.mjr-status-error {
    background-color: var(--mjr-status-error, #ef4444);
}

.mjr-status-stale {
    background-color: var(--mjr-status-neutral, #9ca3af);
}

.mjr-status-unknown {
    background-color: var(--mjr-status-muted, #6b7280);
}

@keyframes mjr-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
}
`;

// Inject styles once
let stylesInjected = false;
export function injectStatusDotStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const styleEl = document.createElement('style');
    styleEl.textContent = STYLES;
    document.head.appendChild(styleEl);
}
