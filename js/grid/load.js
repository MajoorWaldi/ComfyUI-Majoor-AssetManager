import { normalizeRefreshOptions, mergeRefreshOptions, mergeLoadOpts, createRefreshInstance, mjrRefreshDefaults } from "../am_data.js";
import { mjrShowToast } from "../ui_settings.js";
import { mjrGlobalState } from "../mjr_global.js";

export function createRefreshController(state, grid, applyFilterAndRender, fetchMetadataForVisible) {
  let mjrGlobalRefreshPromise = null;
  let mjrGlobalRefreshPending = null;
  const lastSignatureRef = { value: null };

  const loadFiles = (silent = false, force = false, { skipMetadataFetch = false } = {}) =>
    import("../am_data.js").then(({ loadFiles: fmLoadFiles }) =>
      fmLoadFiles(state, grid, applyFilterAndRender, { silent, force, skipMetadataFetch }, { lastSignatureRef, mergeLoadOptsFn: mergeLoadOpts })
    );

  const loadFilesWrapper = (opts = {}) => loadFiles(opts.silent ?? true, opts.forceFiles ?? false, { skipMetadataFetch: opts.skipMetadataFetch ?? true });

  const loadMoreFiles = (opts = {}) =>
    import("../am_data.js").then(({ loadMoreFiles: fmLoadMoreFiles }) =>
      fmLoadMoreFiles(state, grid, applyFilterAndRender, { silent: opts.silent ?? true, skipMetadataFetch: opts.skipMetadataFetch ?? false }, {})
    );

  const refreshInstance = createRefreshInstance(state, fetchMetadataForVisible || (() => Promise.resolve()), loadFilesWrapper, {
    mjrRefreshDefaults,
    mergeRefreshOptionsFn: mergeRefreshOptions,
  });

  function refreshAllInstances(optionsOrSilent = true, force = false) {
    const opts = normalizeRefreshOptions(optionsOrSilent, force);
    if (mjrGlobalRefreshPromise) {
      mjrGlobalRefreshPending = mergeRefreshOptions(mjrGlobalRefreshPending, opts);
      return mjrGlobalRefreshPromise;
    }

    const run = async () => {
      const instances = Array.from(mjrGlobalState.instances);
      for (const inst of instances) {
        try {
          if (typeof inst.refresh === "function") {
            await inst.refresh(opts);
          } else if (typeof inst.loadFiles === "function") {
            await inst.loadFiles(opts.silent, opts.forceFiles, { skipMetadataFetch: false });
          }
        } catch (err) {
          console.warn("[Majoor.AssetsManager] refresh failed for an instance", err);
          if (!opts.silent) mjrShowToast("warn", "Auto refresh failed", "Warning");
        }
      }
    };

    mjrGlobalRefreshPromise = run().finally(() => {
      const pending = mjrGlobalRefreshPending;
      mjrGlobalRefreshPending = null;
      mjrGlobalRefreshPromise = null;
      if (pending) {
        refreshAllInstances(pending);
      }
    });

    return mjrGlobalRefreshPromise;
  }

  return { refreshInstance, refreshAllInstances, loadFilesWrapper, loadFiles, loadMoreFiles, lastSignatureRef };
}
