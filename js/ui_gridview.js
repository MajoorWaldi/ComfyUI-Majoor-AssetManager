import {
  createEl,
  mjrCardBasePx,
  getBaseName,
  getExt,
  detectKindFromExt,
  applyStyles,
  CARD_STYLES,
  mjrSettings,
} from "./ui_settings.js";
import { createFileThumb, updateCardSelectionStyle, updateCardVisuals, resolveWorkflowState, handleDragStart } from "./am_cards.js";
import { mjrOpenABViewer, mjrOpenViewerForFiles } from "./ui_viewer.js";

/**
 * Creates grid rendering helpers.
 * deps: { state, grid, gridWrapper, statusEl, loadMetadataForFile, openContextMenu, onRequestMetadata, isMetaVisible }
 */
export function createGridView(deps) {
  const {
    state,
    grid,
    gridWrapper,
    statusEl,
    loadMetadataForFile,
    openContextMenu,
    onRequestMetadata,
    onNeedMoreFiles,
    isMetaVisible,
  } = deps;

  let lastRenderWindow = { startIndex: -1, endIndex: -1, cols: -1, version: -1 };

  const updateStatus = () => {
    const loaded = (state.files || []).length;
    const total = Number.isFinite(state.filesTotal) ? state.filesTotal : loaded;
    const totalText = total && total !== loaded ? `/${total}` : "";
    const moreText = state.filesHasMore ? " (more...)" : "";
    statusEl.textContent = `${state.filtered.length}/${loaded}${totalText} items${moreText} - ${state.selected.size} selected`;
  };

  const clearAllSelection = () => {
    state.selected.forEach((k) => {
      const el = grid.querySelector(`[data-mjr-key="${CSS.escape(k)}"]`);
      if (el) updateCardSelectionStyle(el, false);
    });
    state.selected.clear();
  };

  const createFileCard = (file, handlers) => {
    const rawName = file.name || file.filename || "(unnamed)";
    const baseName = getBaseName(rawName);
    const ext = file.ext || getExt(rawName) || "";
    const kind = file.kind || detectKindFromExt(ext);
    const key = `${file.subfolder || ""}/${rawName}`;

    const rating =
      Number(
        file.rating ??
          (file.meta && file.meta.rating) ??
          (file.metadata && file.metadata.rating)
      ) || 0;
    const tags =
      (Array.isArray(file.tags) && file.tags) ||
      (Array.isArray(file.meta && file.meta.tags) && file.meta.tags) ||
      (Array.isArray(file.metadata && file.metadata.tags) && file.metadata.tags) ||
      [];

    const card = createEl("div", "mjr-fm-card");
    card.dataset.mjrKey = key;
    card.__mjrFile = file;
    applyStyles(card, CARD_STYLES);
    card.style.transition =
      "border-color 0.12s ease, box-shadow 0.12s ease, background 0.12s ease";
    card.style.width = "100%";

    const thumb = createFileThumb(kind, ext, file, card);
    thumb.style.width = "100%";
    thumb.style.aspectRatio = "1 / 1";
    thumb.style.height = "auto";
    updateCardVisuals(card, file);

    const meta = createEl("div", "mjr-fm-meta");
    meta.style.padding = "6px";
    meta.style.display = "flex";
    meta.style.flexDirection = "column";
    meta.style.gap = "2px";
    meta.style.fontSize = "0.75rem";

    const name = createEl("div", "mjr-fm-name", baseName || "(unnamed)");
    name.style.fontWeight = "500";
    name.style.whiteSpace = "nowrap";
    name.style.textOverflow = "ellipsis";
    name.style.overflow = "hidden";

    const folder = createEl(
      "div",
      "mjr-fm-folder",
      file.subfolder || "(root)"
    );
    folder.style.opacity = "0.7";

    meta.appendChild(name);
    meta.appendChild(folder);

    card.appendChild(thumb);
    card.appendChild(meta);

    const currentFile = () => card.__mjrFile || file;

    card.draggable = true;
    card.addEventListener("dragstart", (ev) => handleDragStart(currentFile(), ev));

    card.addEventListener("mouseenter", () => {
      if (!state.selected.has(key)) {
        card.style.borderColor = "var(--comfy-accent-soft, #888)";
        card.style.background = "rgba(255,255,255,0.04)";
      }
    });
    card.addEventListener("mouseleave", () => {
      updateCardSelectionStyle(card, state.selected.has(key));
    });

    card.addEventListener("click", (ev) => {
      ev.preventDefault();
      handlers?.onSelect?.(currentFile(), card.dataset.mjrKey || key, card, ev);
    });

    card.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      handlers?.onContextMenu?.(ev, currentFile());
    });

    card.addEventListener("dblclick", (ev) => {
      ev.preventDefault();
      handlers?.onOpen?.(currentFile(), card.dataset.mjrKey || key, ev);
    });

    updateCardSelectionStyle(card, state.selected.has(key));
    return card;
  };

  const renderGrid = () => {
    const basePx = mjrCardBasePx();
    grid.style.gridTemplateColumns = `repeat(auto-fill, minmax(${basePx}px, 1fr))`;

    Array.from(grid.children).forEach((el) => {
      const isSpacer =
        el.classList &&
        (el.classList.contains("mjr-fm-top-spacer") || el.classList.contains("mjr-fm-bottom-spacer"));
      if (!isSpacer && (!el.dataset || !el.dataset.mjrKey)) {
        el.remove();
      }
    });

    const getCols = () =>
      Math.max(1, Math.floor((gridWrapper.clientWidth || grid.clientWidth || 1) / (basePx + 8)));
    const cols = getCols();
    const rowHeight = basePx + 90;
    const viewportHeight = gridWrapper.clientHeight || 0;
    const scrollTop = gridWrapper.scrollTop || 0;
    const overscanRows = 2;
    const startRow = Math.max(0, Math.floor(scrollTop / rowHeight) - overscanRows);
    const endRow = Math.floor((scrollTop + viewportHeight) / rowHeight) + overscanRows;
    const startIndex = startRow * cols;
    const endIndex = Math.min(state.filtered.length, (endRow + 1) * cols);

    if (onRequestMetadata) {
      onRequestMetadata(startIndex, endIndex);
    }
    if (typeof onNeedMoreFiles === "function") {
      const threshold = cols * 6; // ~6 rows from the end
      const canScroll =
        (gridWrapper.scrollHeight || 0) > (gridWrapper.clientHeight || 0) + 10 ||
        (gridWrapper.scrollTop || 0) > 0;
      const filtersActive = !!(
        (state.search && String(state.search).trim()) ||
        (state.tagFilter && String(state.tagFilter).trim()) ||
        Number(state.minRating || 0) > 0 ||
        state.collectionSet ||
        state.smartFilter ||
        state.activeCollection
      );

      const nearEnd = state.filtered.length && endIndex >= state.filtered.length - threshold;
      const underfilled = state.filtered.length && state.filtered.length < endIndex + threshold;
      const shouldLoad = state.filesHasMore && (nearEnd || (!filtersActive && underfilled));

      if ((canScroll || (!filtersActive && underfilled)) && shouldLoad) onNeedMoreFiles();
    }
    const totalRows = Math.ceil(state.filtered.length / cols) || 0;
    const rowsBefore = startRow;
    const rowsAfter = Math.max(0, totalRows - Math.ceil(endIndex / cols));

    if (
      lastRenderWindow.version === state.renderVersion &&
      lastRenderWindow.startIndex === startIndex &&
      lastRenderWindow.endIndex === endIndex &&
      lastRenderWindow.cols === cols
    ) {
      return;
    }

    let topSpacer = grid.querySelector(".mjr-fm-top-spacer");
    let bottomSpacer = grid.querySelector(".mjr-fm-bottom-spacer");
    if (!topSpacer) {
      topSpacer = createEl("div", "mjr-fm-top-spacer");
      topSpacer.style.gridColumn = "1 / -1";
      topSpacer.style.height = "0px";
      grid.appendChild(topSpacer);
    }
    if (!bottomSpacer) {
      bottomSpacer = createEl("div", "mjr-fm-bottom-spacer");
      bottomSpacer.style.gridColumn = "1 / -1";
      bottomSpacer.style.height = "0px";
      grid.appendChild(bottomSpacer);
    }
    if (grid.firstElementChild !== topSpacer) {
      grid.insertBefore(topSpacer, grid.firstElementChild);
    }

    const handlers = {
      onSelect: (file, key, card, ev) => {
        const multi = ev && (ev.ctrlKey || ev.metaKey);
        if (!multi) {
          clearAllSelection();
          if (state.selected && state.selected.clear) {
            state.selected.clear();
          }
        }
        if (multi && state.selected.has(key)) {
          state.selected.delete(key);
          updateCardSelectionStyle(card, false);
        } else {
          state.selected.add(key);
          state.currentFile = file;
          updateCardSelectionStyle(card, true);
        }
        updateStatus();
        if (typeof isMetaVisible === "function" ? isMetaVisible() : isMetaVisible) {
          loadMetadataForFile(file);
        }
      },
      onContextMenu: (ev, file) => {
        openContextMenu(ev, file);
      },
      onOpen: (file, ev) => {
        let filesToShow = [];
        if (state.selected && state.selected.size === 2) {
          const keys = Array.from(state.selected);
          const keyToFile = new Map();
          for (const f of state.filtered) {
            const rawName = f.name || f.filename || "(unnamed)";
            const k = `${f.subfolder || ""}/${rawName}`;
            keyToFile.set(k, f);
          }
          filesToShow = keys.map((k) => keyToFile.get(k)).filter(Boolean);
        }
        if (!filesToShow.length) {
          filesToShow = [file];
        }
        mjrOpenViewerForFiles(filesToShow, state.filtered);
      },
      isSelected: (key) => state.selected.has(key),
    };

    if (!state.filtered.length) {
      grid.innerHTML = "";
      const empty = createEl("div", "", "No outputs found.");
      empty.style.opacity = "0.7";
      empty.style.padding = "10px";
      grid.appendChild(empty);
      updateStatus();
      return;
    }

    const existingCards = new Map();
    Array.from(grid.children).forEach((el) => {
      if (el === topSpacer || el === bottomSpacer) return;
      if (el.dataset && el.dataset.mjrKey) existingCards.set(el.dataset.mjrKey, el);
    });

    const keptKeys = new Set();
    const visibleFiles = state.filtered.slice(startIndex, endIndex);
    
    // NEW: Version string now includes global settings
    const cardVersion = (file) => {
      const rating =
        Number(
          file.rating ??
            (file.meta && file.meta.rating) ??
            (file.metadata && file.metadata.rating)
        ) || 0;
      const tags =
        (Array.isArray(file.tags) && file.tags) ||
        (Array.isArray(file.meta && file.meta.tags) && file.meta.tags) ||
        (Array.isArray(file.metadata && file.metadata.tags) && file.metadata.tags) ||
        [];
      
      const showRating = mjrSettings.grid.showRating ? 1 : 0;
      const showTags = mjrSettings.grid.showTags ? 1 : 0;

      const wfState = resolveWorkflowState(file);
      return `${rating}|${tags.length ? tags.join(",") : ""}|${file.mtime || ""}|${showRating}|${showTags}|wf:${wfState}`;
    };

    const orderedElements = visibleFiles.map((file) => {
      const rawName = file.name || file.filename || "";
      const key = `${file.subfolder || ""}/${rawName}`;
      keptKeys.add(key);

      let card = existingCards.get(key);
      if (card) {
        card.__mjrFile = file;
        const nextVersion = cardVersion(file);
        if (card.__mjrVersion !== nextVersion) {
          // This will now trigger if mjrSettings.grid.* changed!
          updateCardVisuals(card, file); // from am_cards.js, which reads mjrSettings
          card.__mjrVersion = nextVersion;
        }
      } else {
        card = createFileCard(file, handlers);
        card.dataset.mjrKey = key;
        card.__mjrVersion = cardVersion(file);
      }
      return card;
    });

    existingCards.forEach((el, key) => {
      if (!keptKeys.has(key)) el.remove();
    });

    const baseIndex = topSpacer ? 1 : 0;
    orderedElements.forEach((card, index) => {
      const desiredIndex = baseIndex + index;
      const currentAtPos = grid.children[desiredIndex];
      if (currentAtPos !== card) {
        if (currentAtPos) {
          grid.insertBefore(card, currentAtPos);
        } else {
          grid.appendChild(card);
        }
      }
    });

    topSpacer.style.height = `${rowsBefore * rowHeight}px`;
    bottomSpacer.style.height = `${rowsAfter * rowHeight}px`;
    if (bottomSpacer.parentNode !== grid || grid.lastElementChild !== bottomSpacer) {
      grid.appendChild(bottomSpacer);
    }

    lastRenderWindow = {
      startIndex,
      endIndex,
      cols,
      version: state.renderVersion,
    };

    updateStatus();
  };

  return { renderGrid, clearAllSelection, updateStatus };
}
