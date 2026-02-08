/**
 * VirtualGrid
 * @description
 * High-performance virtualized grid renderer.
 * Handles thousands of items by only rendering the visible viewport + buffer rows.
 * Supports absolute positioning efficient updates.
 */
export class VirtualGrid {
    /**
     * @param {HTMLElement} container The container to render items into (wrapper)
     * @param {HTMLElement|Window} scrollElement The element that scrolls (usually parent or window)
     * @param {Object} options Configuration object
     * @param {function(object, number): HTMLElement} options.createItem Callback to create a DOM node for an item
     * @param {function(object, HTMLElement): void} [options.onItemRendered] Called after creating a new DOM node
     * @param {function(HTMLElement): void} [options.onItemRecycled] Called before removing a DOM node (cleanup)
     * @param {function(object, HTMLElement): void} [options.onItemUpdated] Called when reusing a DOM node with updated data
     * @param {number} [options.minItemWidth=120] Minimum width in pixels
     * @param {number} [options.gap=10] Gap between items in pixels
     * @param {number} [options.bufferRows=2] Rows to render above/below viewport
     */
    constructor(container, scrollElement, options = {}) {
        /** @type {HTMLElement} */
        this.container = container;

        /** @type {HTMLElement|Window} */
        this.scrollElement = scrollElement;
        
        /** @type {Required<typeof options>} */
        this.options = {
            minItemWidth: options.minItemWidth || 120,
            gap: options.gap || 10,
            bufferRows: options.bufferRows || 2,
            createItem: options.createItem || (() => document.createElement("div")),
            onItemRendered: options.onItemRendered || (() => {}),
            onItemRecycled: options.onItemRecycled || (() => {}),
            onItemUpdated: options.onItemUpdated || (() => {}),
        };

        /** @type {any[]} List of data items to render */
        this.items = [];
        
        this.visibleRange = { start: 0, end: 0 };
        
        /** @type {Map<number, HTMLElement>} Map of index -> rendered wrapper element */
        this.renderedItems = new Map(); 
        
        // Metrics
        this.columnCount = 1;
        this.itemWidth = this.options.minItemWidth;
        this.rowHeight = 200; // Initial guess
        this.metaHeight = 0;  // Height of non-image part
        this.measured = false;
        
        /** @type {number[]} Samples for dynamic height calculation */
        this.measureSamples = [];
        
        this.renderPending = false;
        this.rafId = 0;
        this.lastWidth = 0;
        this._resizeDebounce = 0;
        this._lastLayoutWidth = 0;
        this._lastLayoutHeight = 0;
        this._layoutGuardThreshold = 12;

        // Observer for container width changes
        const scheduleResize = (width) => {
            if (this._resizeDebounce) {
                clearTimeout(this._resizeDebounce);
            }
            this._resizeDebounce = window.setTimeout(() => {
                this._resizeDebounce = 0;
                if (width > 0) {
                    this.lastWidth = width;
                    this.onResize();
                }
            }, 100);
        };

        this.resizeObserver = new ResizeObserver((entries) => {
            // Use the container's actual content width (excludes border/scrollbar of itself)
            // entry.contentRect.width is reliable for the observed element
            for (const entry of entries) {
                 if (entry.target === this.container) {
                     const width = entry.contentRect.width;
                      if (width > 0 && Math.abs(width - this.lastWidth) > 20) {
                         scheduleResize(width);
                      }
                      break; // Only care about container
                  }
            }
        });
        // Always observe container for correct width relative to parent padding/scrollbars
        this.resizeObserver.observe(this.container);

        this.onScrollBound = this.onScroll.bind(this);
        
        // Dedicated scroll-container mode: normally scrollElement is an HTMLElement.
        // Keep a safety fallback for legacy configurations.
        this.scrollTarget = (this.scrollElement === document.body || this.scrollElement === document.documentElement)
            ? window
            : this.scrollElement;
        
        if (this.scrollTarget) {
            this.scrollTarget.addEventListener("scroll", this.onScrollBound, { passive: true });
        }

        // Style the container for absolute positioning
        this.container.style.position = "relative";
        this.container.style.display = "block"; // Override 'grid'
        // Use overflow: visible so IntersectionObserver can properly detect sentinel
        // Parent wrapper (gridWrapper) handles scrolling and clipping with overflow: auto
        this.container.style.overflow = "visible";
        this.container.style.width = "100%";
    }

    /**
     * Update the list of items to display. Triggers a relayout.
     * @param {any[]} items New list of data items (assets)
     * @param {boolean} [force=false] Force re-creation of DOM elements (e.g. settings change)
     */
    setItems(items, force = false) {
        // Fix: Cancel pending scroll render to prevent race conditions
        if (this.renderPending && this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.renderPending = false;
        }

        if (force) {
            // Recycle all currently rendered items
            for (const [, el] of this.renderedItems) {
                // Try to clean up
                const card = this._getCard(el);
                if (card) {
                    try { this.options.onItemRecycled(card); } catch {}
                }
                el.remove();
            }
            this.renderedItems.clear();
            // Reset measurement state in case layout settings changed (e.g. badges affecting height)
            this.measured = false;
            this.measureSamples = [];
            this._lastLayoutWidth = 0;
            this._lastLayoutHeight = 0;
        }

        this.items = items || [];
        this.updateLayout(force);
    }

    /**
     * Update configuration dynamicallly (e.g. settings change)
     * @param {Object} conf
     * @param {number} [conf.minItemWidth]
     * @param {number} [conf.gap]
     */
    updateConfig({ minItemWidth, gap }) {
        let changed = false;
        if (minItemWidth != null && minItemWidth !== this.options.minItemWidth) {
            this.options.minItemWidth = Number(minItemWidth);
            changed = true;
        }
        if (gap != null && gap !== this.options.gap) {
            this.options.gap = Number(gap);
            changed = true;
        }
        if (changed) {
            // Force re-measure and layout
            this.onResize(); 
        }
    }

    /**
     * Clean up observers and listeners when grid is destroyed.
     */
    dispose() {
        this.resizeObserver.disconnect();
        if (this.scrollTarget) {
            this.scrollTarget.removeEventListener("scroll", this.onScrollBound);
        }
        this.container.innerHTML = "";
        this.renderedItems.clear();
    }

    /**
     * Handle resize: re-calculate columns and render.
     * @private
     */
    onResize() {
        this.updateMetrics();
        this.render();
    }

    /**
     * Handle scroll: request render frame.
     * @private
     */
    onScroll() {
        if (!this.renderPending) {
            this.renderPending = true;
            this.rafId = requestAnimationFrame(() => {
                this.render();
                this.renderPending = false;
            });
        }
    }

    /**
     * Log debug metrics.
     */
    debug() {
        console.log("[VirtualGrid Debug]", {
            scrollTop: this.scrollElement?.scrollTop,
            scrollHeight: this.scrollElement?.scrollHeight,
            clientHeight: this.scrollElement?.clientHeight,
            containerHeight: this.container?.style?.height,
            items: this.items?.length,
            rendered: this.renderedItems?.size,
            scrollTarget: this.scrollTarget
        });
    }

    /**
     * Calculate column count and dimensions based on container width.
     * @private
     */
    updateMetrics() {
        // Use container's clientWidth as the source of truth.
        // This automatically accounts for parent padding and parent scrollbars.
        let containerWidth = this.container.clientWidth;
        
        // Fallback or sanity check
        if (!containerWidth) return;

        const gap = this.options.gap;
        const minW = this.options.minItemWidth;

        // Safety buffer: increased to 24px to handle scrollbars on all OS/browsers + potential container padding issues.
        // Formula fix: Ensures strictly no overflow even if container width reports incorrectly due to layout thrashing.
        let availWidth = containerWidth - 24;

        this.columnCount = Math.max(1, Math.floor((availWidth + gap) / (minW + gap))); 
        
        // Calculate exact item width to fill space (like auto-fill)
        this.itemWidth = Math.floor((availWidth - (this.columnCount - 1) * gap) / this.columnCount);

        // Update row height estimate if we have a measured meta height
        if (this.measured && this.metaHeight > 0) {
            // Assume 1:1 aspect ratio for image part + meta height
            this.rowHeight = this.itemWidth + this.metaHeight;
        }

        this.updateLayout();
    }

    /**
     * Updates container height and triggers render.
     * @private
     */
    updateLayout(force = false) {
        if (!this.items.length) {
            this.container.style.height = "0px";
            return;
        }

        const gap = this.options.gap;
        const totalRows = Math.ceil(this.items.length / this.columnCount);
        const totalHeight = totalRows * this.rowHeight + (totalRows - 1) * gap;
        
        const containerWidth = this.container.clientWidth || this.container.offsetWidth || this.lastWidth || 0;
        if (!force && containerWidth > 0) {
            const widthDelta = Math.abs(containerWidth - this._lastLayoutWidth);
            const heightDelta = Math.abs(totalHeight - this._lastLayoutHeight);
            const threshold = this._layoutGuardThreshold;
            if (widthDelta <= threshold && heightDelta <= threshold) {
                // Skip heavy recalculation when size didn't change significantly.
                return;
            }
        }

        this._lastLayoutWidth = containerWidth;
        this._lastLayoutHeight = totalHeight;
        this.container.style.height = `${totalHeight}px`;
        this.render();
    }

    /**
     * Detects dynamic height of items by sampling the first few rendered elements.
     * @param {HTMLElement} element The card element to measure
     * @private
     */
    measureItem(element) {
        if (this.measured) return;
        // Try to find the thumb and measure aspect ratio / meta height
        // This is a heuristic.
        try {
            const rect = element.getBoundingClientRect();
            if (rect.height > 0) {
                const fullHeight = rect.height;
                const meta = fullHeight - this.itemWidth;
                
                this.measureSamples.push(meta);

                // Sample at least 3 items to avoid outliers
                if (this.measureSamples.length >= 3) {
                     // Calculate median meta height
                     const sorted = [...this.measureSamples].sort((a,b) => a-b);
                     const mid = Math.floor(sorted.length / 2);
                     this.metaHeight = sorted[mid];
                     if (this.metaHeight < 20) this.metaHeight = 50; 

                    this.rowHeight = this.itemWidth + this.metaHeight;
                    this.measured = true;
                    this.updateLayout(true);
                } else if (this.measureSamples.length === 1) {
                     // Initial update to ensure grid has some height
                     let tempMeta = meta;
                     if (tempMeta < 20) tempMeta = 50;
                     this.rowHeight = this.itemWidth + tempMeta;
                     this.updateLayout(true);
                }
            }
        } catch {}
    }

    /**
     * Best-effort re-measure after async content (badges/metadata) is applied.
     * This avoids layout drift when card height changes after initial render.
     */
    scheduleRemeasure() {
        if (this.measured) return;
        try {
            requestAnimationFrame(() => {
                try { this.updateMetrics(); } catch {}
            });
            setTimeout(() => {
                try { this.updateMetrics(); } catch {}
            }, 60);
        } catch {}
    }

    /**
     * Core render loop. Calculates visible range and creates/removes DOM elements.
     */
    render() {
        if (!this.items.length || this.columnCount < 1) return;

        // Cache layout rects to avoid repeated DOM reads
        let scrollTop = 0;
        let viewportHeight = 0;
        const safeRect = (el) => {
            try {
                return el?.getBoundingClientRect?.() || null;
            } catch {
                return null;
            }
        };
        const containerRect = safeRect(this.container);
        const rootRect = this.scrollTarget === window ? null : safeRect(this.scrollElement);

        if (this.scrollTarget === window) {
            viewportHeight = window.innerHeight || document.documentElement.clientHeight;
            if (containerRect) {
                scrollTop = Math.max(0, -containerRect.top);
            } else {
                scrollTop = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
            }
        } else {
            viewportHeight = this.scrollElement?.clientHeight || 0;
            if (containerRect && rootRect) {
                scrollTop = Math.max(0, -(containerRect.top - rootRect.top));
            } else {
                scrollTop = this.scrollElement?.scrollTop || 0;
            }
        }
        
        // Sanity check
        if (viewportHeight <= 0) viewportHeight = 600;

        const gap = this.options.gap;
        const rowTotal = this.rowHeight + gap;

        // Calculate visible row range
        const startRow = Math.floor(scrollTop / rowTotal);
        const visibleRows = Math.ceil(viewportHeight / rowTotal);
        
        const buffer = this.options.bufferRows;
        
        // Determine index range
        const firstRow = Math.max(0, startRow - buffer);
        const lastRow = startRow + visibleRows + buffer;
        
        const startIndex = firstRow * this.columnCount;
        const endIndex = Math.min(this.items.length, (lastRow + 1) * this.columnCount);

            // Track used keys (indices) to cleanup later
            const desiredIndices = new Set();
    
            // Render loop
            for (let i = startIndex; i < endIndex; i++) {
                desiredIndices.add(i);
                
                let el = this.renderedItems.get(i);
                const item = this.items[i];
                
                // Check if element matches data (handle list mutations)
                // Fix: Use ID check to avoid re-creating DOM when object ref changes but item is same
                const isSameItem = el && (
                    el._virtualItem === item || 
                    (item.id != null && el._virtualItem?.id === item.id)
                );
    
                if (el && !isSameItem) {
                    // Fix: onItemRecycled should receive the card context, not the wrapper.
                    const card = this._getCard(el);
                    if (card) this.options.onItemRecycled(card);
                    
                    el.remove();
                    this.renderedItems.delete(i);
                    el = undefined;
                } else if (el && isSameItem && el._virtualItem !== item) {
                    // Update reference but keep DOM
                    el._virtualItem = item;
                    this.options.onItemUpdated(item, this._getCard(el));
                }
    
                if (!el) {
                    // Create wrapper for positioning
                    el = document.createElement("div");
                    el.className = "mjr-virtual-cell";
                    el.style.position = "absolute";
                    // CRITICAL: Set width BEFORE appending/measuring so content flows correctly
                    el.style.width = `${this.itemWidth}px`;
                    
                    let card;
                    try {
                        card = this.options.createItem(item, i);
                    } catch (e) {
                         console.error("VirtualGrid createItem failed", e);
                         card = document.createElement("div");
                    }
                    
                    // Add to wrapper
                    el.appendChild(card);
                    
                    el._virtualItem = item;
                    
                    this.container.appendChild(el);
                    this.renderedItems.set(i, el);
                    
                    // IMPORTANT: The card element inside is what we measure and update
                    // But VirtualGrid manages the 'el' wrapper position.
                    
                    if (!this.measured) {
                        this.measureItem(card);
                    }
                    
                    this.options.onItemRendered(item, card);
                }
    
                // Update position for everyone in range (in case resize happened)
                if (el) {
                    const row = Math.floor(i / this.columnCount);
                    const col = i % this.columnCount;
                    const x = col * (this.itemWidth + gap);
                    const y = row * (this.rowHeight + gap);
                    
                    // CRITICAL FIX: Use left/top instead of transform to avoid being overwritten by
                    // selection state CSS which applies transform: scale().
                    el.style.transform = ""; // clear any legacy transform
                    el.style.left = `${x}px`;
                    el.style.top = `${y}px`;
                    
                    el.style.width = `${this.itemWidth}px`;
                    el.style.height = `${this.rowHeight}px`; 
                    
                    // Force child card to fill wrapper?
                    // The wrapper is absolute. The card inside should probably be width 100%.
                    const card = el.firstElementChild;
                    if (card) {
                        card.style.width = "100%";
                        card.style.height = "100%";
                    }
                }
            }
    
            // Cleanup
            for (const [i, el] of this.renderedItems) {
                if (!desiredIndices.has(i)) {
                    const card = el.firstElementChild;
                    if (card) this.options.onItemRecycled(card);
                    el.remove();
                    this.renderedItems.delete(i);
                }
            }
        }

        _getCard(el) {
            return el.firstElementChild || el;
        }
    }
