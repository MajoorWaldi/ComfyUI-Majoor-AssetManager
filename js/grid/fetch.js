import { api } from "../../../../scripts/api.js";

export function createMetadataFetcher(state, gridView, opts = {}) {
  let metadataAbortCtrl = null;
  let metadataFetchInFlight = null;
  let metadataDebounceTimer = null;
  let currentGridView = gridView || null;
  let onMetadataUpdated = typeof opts.onMetadataUpdated === "function" ? opts.onMetadataUpdated : null;

  // Retry limit tracking to prevent infinite loops
  const MAX_RETRY_ATTEMPTS = 3;
  const RETRY_BACKOFF_MS = 1000; // Start with 1 second
  let retryCountVisible = 0;
  let lastRetryTimeVisible = 0;
  let retryCountFilter = 0;
  let lastRetryTimeFilter = 0;

  // Concurrency guard: prevent visible + filter from ping-ponging
  let lastFetchType = null; // "visible" | "filter"
  let lastFetchTime = 0;
  const MIN_FETCH_INTERVAL_MS = 100; // Minimum 100ms between different fetch types

  const setOnMetadataUpdated = (fn) => {
    onMetadataUpdated = typeof fn === "function" ? fn : null;
  };

  const shouldHydrateForFilter = () => {
    const tagFilter = (state.tagFilter || "").trim();
    const minRating = Number(state.minRating || 0);
    return !!tagFilter || minRating > 0;
  };

  const applyBatchResults = (data) => {
    const metaByKey = new Map();
    (data.metadatas || []).forEach((m) => metaByKey.set(`${m.subfolder || ""}/${m.filename || ""}`, m));

    let updatedCount = 0;
    state.files.forEach((f) => {
      const key = `${f.subfolder || ""}/${f.filename || f.name || ""}`;
      const m = metaByKey.get(key);
      if (m) {
        f.rating = m.rating ?? 0;
        f.tags = m.tags || [];
        if (m.has_workflow !== undefined) f.hasWorkflow = !!m.has_workflow;
        f.__metaLoaded = true;
        updatedCount += 1;
      }
    });
    return updatedCount;
  };

  // Safety check: should we proceed with this fetch?
  const canProceedWithFetch = (fetchType, reqVersion) => {
    // Check if render version changed
    if (reqVersion !== state.renderVersion) {
      return false;
    }

    // Check if abort controller is aborted
    if (metadataAbortCtrl?.signal?.aborted) {
      return false;
    }

    // Check if loading is in flight
    if (state.loadingPromise) {
      return false;
    }

    // Check if already fetching
    if (metadataFetchInFlight) {
      return false;
    }

    // Concurrency guard: prevent ping-pong between visible and filter
    const now = Date.now();
    if (lastFetchType && lastFetchType !== fetchType) {
      const timeSinceLastFetch = now - lastFetchTime;
      if (timeSinceLastFetch < MIN_FETCH_INTERVAL_MS) {
        return false;
      }
    }

    return true;
  };

  async function fetchMetadataForVisible() {
    const reqVersion = state.renderVersion;

    if (!canProceedWithFetch("visible", reqVersion)) {
      return;
    }

    const fullList = state.filtered || [];
    const { visibleStart: start, visibleEnd: end } = state;

    const buffer = 20;
    const effectiveStart = Math.max(0, start - buffer);
    const effectiveEnd = Math.min(fullList.length, end + buffer);

    const visibleSlice = fullList.slice(effectiveStart, effectiveEnd);
    const targetFiles = visibleSlice.filter((f) => !f.__metaLoaded);

    if (!targetFiles.length) {
      // Reset retry count if no files need loading
      retryCountVisible = 0;
      return;
    }

    const batch = targetFiles.slice(0, 30).map((f) => ({ filename: f.filename || f.name, subfolder: f.subfolder || "" }));

    if (metadataAbortCtrl) {
      try {
        metadataAbortCtrl.abort();
      } catch (_) {}
    }
    metadataAbortCtrl = new AbortController();
    const thisCtrl = metadataAbortCtrl;

    // Update concurrency guard
    lastFetchType = "visible";
    lastFetchTime = Date.now();

    metadataFetchInFlight = api.fetchApi("/mjr/filemanager/metadata/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: batch }),
      signal: thisCtrl.signal,
    });

    let updatedAny = false;
    try {
      const res = await metadataFetchInFlight;

      // Safety check after await
      if (thisCtrl.signal.aborted || reqVersion !== state.renderVersion || state.loadingPromise) {
        return;
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      let data;
      try {
        data = await res.json();
      } catch (parseErr) {
        console.error("[Majoor.AssetsManager] Failed to parse metadata JSON response", parseErr);
        throw new Error(`JSON parse error: ${parseErr.message}`);
      }

      // Safety check after JSON parse
      if (thisCtrl.signal.aborted || reqVersion !== state.renderVersion || state.loadingPromise) {
        return;
      }

      updatedAny = applyBatchResults(data) > 0;

      if (currentGridView) currentGridView.renderGrid();
    } catch (err) {
      if (err?.name === "AbortError") {
        // ignore aborted fetch
      } else {
        console.warn("[Majoor.AssetsManager] batch metadata load failed", err);
      }
    } finally {
      metadataFetchInFlight = null;
      if (metadataAbortCtrl === thisCtrl) metadataAbortCtrl = null;

      if (updatedAny && onMetadataUpdated) {
        setTimeout(() => {
          try {
            onMetadataUpdated();
          } catch (_) {}
        }, 0);
      }

      // Retry logic with exponential backoff and max attempts
      // Only retry if conditions are still valid
      const shouldRetry =
        reqVersion === state.renderVersion &&
        !state.loadingPromise &&
        !thisCtrl.signal.aborted &&
        fullList.slice(effectiveStart, effectiveEnd).some((f) => !f.__metaLoaded);

      if (shouldRetry) {
        const now = Date.now();

        // Reset retry count if enough time has passed (30 seconds)
        if (now - lastRetryTimeVisible > 30000) {
          retryCountVisible = 0;
        }

        if (retryCountVisible < MAX_RETRY_ATTEMPTS) {
          const backoffDelay = updatedAny ? 0 : RETRY_BACKOFF_MS * Math.pow(2, retryCountVisible);
          retryCountVisible++;
          lastRetryTimeVisible = now;

          setTimeout(() => {
            // Final safety check before retry
            if (reqVersion === state.renderVersion && !state.loadingPromise) {
              fetchMetadataForVisible();
            }
          }, backoffDelay);
        } else {
          console.warn("[Majoor.AssetsManager] Max metadata fetch retries (visible) reached, stopping to prevent infinite loop");
          // Don't reset here - let the 30s timeout reset it
        }
      } else {
        // Reset retry count on successful completion or abort
        retryCountVisible = 0;
      }
    }
  }

  async function fetchMetadataForFilter() {
    const reqVersion = state.renderVersion;

    if (!canProceedWithFetch("filter", reqVersion)) {
      return;
    }

    if (!shouldHydrateForFilter()) {
      // Reset retry count if filter is no longer active
      retryCountFilter = 0;
      return;
    }

    const allFiles = state.files || [];
    const targetFiles = allFiles.filter((f) => !f.__metaLoaded).slice(0, 30);

    if (!targetFiles.length) {
      // Reset retry count if no files need loading
      retryCountFilter = 0;
      return;
    }

    const batch = targetFiles.map((f) => ({ filename: f.filename || f.name, subfolder: f.subfolder || "" }));

    if (metadataAbortCtrl) {
      try {
        metadataAbortCtrl.abort();
      } catch (_) {}
    }
    metadataAbortCtrl = new AbortController();
    const thisCtrl = metadataAbortCtrl;

    // Update concurrency guard
    lastFetchType = "filter";
    lastFetchTime = Date.now();

    metadataFetchInFlight = api.fetchApi("/mjr/filemanager/metadata/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: batch }),
      signal: thisCtrl.signal,
    });

    let updatedAny = false;
    try {
      const res = await metadataFetchInFlight;

      // Safety check after await
      if (thisCtrl.signal.aborted || reqVersion !== state.renderVersion || state.loadingPromise) {
        return;
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      let data;
      try {
        data = await res.json();
      } catch (parseErr) {
        console.error("[Majoor.AssetsManager] Failed to parse metadata JSON response (filter)", parseErr);
        throw new Error(`JSON parse error: ${parseErr.message}`);
      }

      // Safety check after JSON parse
      if (thisCtrl.signal.aborted || reqVersion !== state.renderVersion || state.loadingPromise) {
        return;
      }

      updatedAny = applyBatchResults(data) > 0;

      if (currentGridView) currentGridView.renderGrid();
    } catch (err) {
      if (err?.name === "AbortError") {
        // ignore aborted fetch
      } else {
        console.warn("[Majoor.AssetsManager] filter metadata load failed", err);
      }
    } finally {
      metadataFetchInFlight = null;
      if (metadataAbortCtrl === thisCtrl) metadataAbortCtrl = null;

      if (updatedAny && onMetadataUpdated) {
        setTimeout(() => {
          try {
            onMetadataUpdated();
          } catch (_) {}
        }, 0);
      }

      // Retry logic with exponential backoff and max attempts
      // Only retry if conditions are still valid
      const shouldRetry =
        reqVersion === state.renderVersion &&
        !state.loadingPromise &&
        !thisCtrl.signal.aborted &&
        shouldHydrateForFilter() &&
        allFiles.some((f) => !f.__metaLoaded);

      if (shouldRetry) {
        const now = Date.now();

        // Reset retry count if enough time has passed (30 seconds)
        if (now - lastRetryTimeFilter > 30000) {
          retryCountFilter = 0;
        }

        if (retryCountFilter < MAX_RETRY_ATTEMPTS) {
          const backoffDelay = updatedAny ? 0 : RETRY_BACKOFF_MS * Math.pow(2, retryCountFilter);
          retryCountFilter++;
          lastRetryTimeFilter = now;

          setTimeout(() => {
            // Final safety check before retry
            if (reqVersion === state.renderVersion && !state.loadingPromise && shouldHydrateForFilter()) {
              fetchMetadataForFilter();
            }
          }, backoffDelay);
        } else {
          console.warn("[Majoor.AssetsManager] Max metadata fetch retries (filter) reached, stopping to prevent infinite loop");
          // Don't reset here - let the 30s timeout reset it
        }
      } else {
        // Reset retry count on successful completion or abort
        retryCountFilter = 0;
      }
    }
  }

  const onRequestMetadata = (start, end) => {
    state.visibleStart = start;
    state.visibleEnd = end;
    if (metadataDebounceTimer) clearTimeout(metadataDebounceTimer);
    metadataDebounceTimer = setTimeout(() => fetchMetadataForVisible(), 150);
  };

  const cleanup = () => {
    if (metadataDebounceTimer) clearTimeout(metadataDebounceTimer);
    if (metadataAbortCtrl) {
      try {
        metadataAbortCtrl.abort();
      } catch (_) {}
    }
    // Reset retry counters on cleanup
    retryCountVisible = 0;
    retryCountFilter = 0;
    lastFetchType = null;
  };

  const setGridView = (gv) => {
    currentGridView = gv;
  };

  return { fetchMetadataForVisible, fetchMetadataForFilter, onRequestMetadata, cleanup, setGridView, setOnMetadataUpdated };
}
