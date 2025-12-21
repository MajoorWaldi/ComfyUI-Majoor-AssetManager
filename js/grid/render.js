import { detectKindFromExt, getBaseName, getExt, mjrSettings } from "../ui_settings.js";
import { normalizeMtimeValue } from "../assets_filters.js";

export function createApplyFilterAndRender(state, fetchMetadataForVisible, fetchMetadataForFilter) {
  let gridView = null;

  // Track previous filtered list for two-phase filtering
  let previousFiltered = [];
  let metaHydrationStartTime = 0;
  const META_HYDRATION_TIMEOUT_MS = 5000; // 5 seconds max wait for metadata

  const applyFilterAndRender = (options = {}) => {
    const { skipMetadataFetch = false } = options;
    const q = (state.search || "").trim().toLowerCase();
    const tagFilter = (state.tagFilter || "").trim().toLowerCase();
    const minRating = Number(state.minRating || 0);
    const needsMetaFilter = minRating > 0 || !!tagFilter;
    const hidePng = !!mjrSettings.siblings.hidePngSiblings;
    let nonImageStems = null;
    if (hidePng) {
      nonImageStems = new Set();
      for (const f of state.files) {
        const raw = f.name || f.filename || "";
        if ((f.kind || detectKindFromExt(f.ext || getExt(raw) || "")) !== "image") {
          nonImageStems.add(getBaseName(raw));
        }
      }
    }

    // TWO-PHASE FILTERING APPROACH
    // Phase 1: Basic filtering (always applied)
    const basicFiltered = state.files.filter((file) => {
      const rawName = file.name || file.filename || "";
      const extUpper = (file.ext || getExt(rawName) || "").toUpperCase();
      const kind = file.kind || detectKindFromExt(extUpper);
      if (hidePng && nonImageStems?.has(getBaseName(rawName)) && extUpper === "PNG") return false;

      const name = rawName.toLowerCase();
      const folder = (file.subfolder || "").toLowerCase();
      if (q && !name.includes(q) && !folder.includes(q)) return false;

      file.mtime = normalizeMtimeValue(file.mtime);
      if (state.collectionSet) {
        const fileRelPath = `${file.subfolder ? file.subfolder + "/" : ""}${rawName}`;
        if (!state.collectionSet.has(fileRelPath)) return false;
      } else if (state.smartFilter && !state.smartFilter(file)) {
        return false;
      }

      return true;
    });

    // Phase 2: Metadata filtering (conditional)
    let finalFiltered;
    let shouldHydrate = false;

    if (needsMetaFilter) {
      // Count how many files in basic filtered have metadata loaded
      const filesWithMeta = basicFiltered.filter((file) => {
        const hasMeta = !!file.__metaLoaded || file.rating !== undefined || Array.isArray(file.tags);
        return hasMeta;
      });

      const filesWithoutMeta = basicFiltered.filter((file) => {
        const hasMeta = !!file.__metaLoaded || file.rating !== undefined || Array.isArray(file.tags);
        return !hasMeta;
      });

      // Calculate hydration progress
      const totalNeedingMeta = basicFiltered.length;
      const metaLoadedCount = filesWithMeta.length;
      const metaHydrationPercent = totalNeedingMeta > 0 ? (metaLoadedCount / totalNeedingMeta) * 100 : 100;

      // Check if we're in hydration phase
      const now = Date.now();
      const isHydrating = filesWithoutMeta.length > 0 && (now - metaHydrationStartTime) < META_HYDRATION_TIMEOUT_MS;

      if (filesWithoutMeta.length > 0 && metaHydrationPercent < 95) {
        // We have files without metadata and haven't reached 95% hydration
        if (metaHydrationStartTime === 0) {
          metaHydrationStartTime = now;
        }
        shouldHydrate = true;

        // TWO-PHASE STRATEGY:
        // Keep previous filtered list if we have one and we're still hydrating
        // This prevents blinking/popping as metadata loads
        if (previousFiltered.length > 0 && isHydrating) {
          // Use previous filtered list + newly loaded items that pass the filter
          const passesMetaFilter = (file) => {
            const fileRating = Number(file.rating ?? 0);
            if (fileRating < minRating) return false;

            const tagsArr = Array.isArray(file.tags) ? file.tags : [];
            if (tagFilter && !tagsArr.some((tag) => String(tag).toLowerCase().includes(tagFilter))) return false;

            return true;
          };

          const newlyLoadedPassing = filesWithMeta.filter((file) => {
            const key = `${file.subfolder || ""}/${file.name || file.filename || ""}`;
            const wasInPrevious = previousFiltered.some((pf) => {
              const pkey = `${pf.subfolder || ""}/${pf.name || pf.filename || ""}`;
              return pkey === key;
            });
            return !wasInPrevious && passesMetaFilter(file);
          });

          // Keep previous + add newly loaded passing files
          const previousKeys = new Set(previousFiltered.map((f) => `${f.subfolder || ""}/${f.name || f.filename || ""}`));
          const combinedFiltered = [...previousFiltered];

          newlyLoadedPassing.forEach((file) => {
            const key = `${file.subfolder || ""}/${file.name || file.filename || ""}`;
            if (!previousKeys.has(key)) {
              combinedFiltered.push(file);
            }
          });

          finalFiltered = combinedFiltered;
          state.metaHydrating = true;
          state.metaHydrationPercent = Math.round(metaHydrationPercent);
        } else {
          // First time or timeout exceeded - apply immediate filter
          finalFiltered = filesWithMeta.filter((file) => {
            const fileRating = Number(file.rating ?? 0);
            if (fileRating < minRating) return false;

            const tagsArr = Array.isArray(file.tags) ? file.tags : [];
            if (tagFilter && !tagsArr.some((tag) => String(tag).toLowerCase().includes(tagFilter))) return false;

            return true;
          });
          state.metaHydrating = shouldHydrate;
          state.metaHydrationPercent = Math.round(metaHydrationPercent);
        }
      } else {
        // All (or 95%+) metadata is loaded, apply final filter
        metaHydrationStartTime = 0; // Reset timer
        finalFiltered = filesWithMeta.filter((file) => {
          const fileRating = Number(file.rating ?? 0);
          if (fileRating < minRating) return false;

          const tagsArr = Array.isArray(file.tags) ? file.tags : [];
          if (tagFilter && !tagsArr.some((tag) => String(tag).toLowerCase().includes(tagFilter))) return false;

          return true;
        });
        state.metaHydrating = false;
        state.metaHydrationPercent = 100;
        previousFiltered = finalFiltered; // Update previous for next time
      }
    } else {
      // No metadata filter needed, just use basic filtered
      finalFiltered = basicFiltered;
      state.metaHydrating = false;
      state.metaHydrationPercent = 100;
      metaHydrationStartTime = 0;
      previousFiltered = [];
    }

    state.filtered = finalFiltered;
    state.filtered.sort((a, b) => b.mtime - a.mtime || (a.name || "").localeCompare(b.name || ""));
    state.renderVersion = (state.renderVersion || 0) + 1;

    if (gridView) gridView.renderGrid();

    if (!skipMetadataFetch) {
      fetchMetadataForVisible();
      if (needsMetaFilter && typeof fetchMetadataForFilter === "function") {
        fetchMetadataForFilter();
      }
    }
  };

  const setGridView = (gv) => {
    gridView = gv;
  };

  return { applyFilterAndRender, setGridView };
}
