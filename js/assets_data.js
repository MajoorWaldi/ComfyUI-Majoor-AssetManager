import { api } from "../../../scripts/api.js";
import {
  mjrPrefetchedFiles,
  mjrShowToast,
  mjrSettings,
} from "./ui_settings.js";
import { normalizeMtimeOnList, normalizeMtimeValue } from "./assets_filters.js";
import { mjrThemeVars } from "./ui_theme.js";

export const mjrRefreshDefaults = { silent: true, forceFiles: false, metaOnly: false };

export const mergeLoadOpts = (current, next) => {
  if (!current) return next;
  return {
    silent: current.silent && next.silent,
    force: current.force || next.force,
    skipMetadataFetch: current.skipMetadataFetch && next.skipMetadataFetch,
  };
};

export const normalizeRefreshOptions = (optionsOrSilent = true, forceFiles = false) => {
  if (typeof optionsOrSilent === "object" && optionsOrSilent !== null) {
    return { ...mjrRefreshDefaults, ...optionsOrSilent };
  }
  return { ...mjrRefreshDefaults, silent: !!optionsOrSilent, forceFiles: !!forceFiles };
};

export const mergeRefreshOptions = (current, next) => {
  if (!current) return next;
  return {
    silent: current.silent && next.silent,
    forceFiles: current.forceFiles || next.forceFiles,
    metaOnly: current.metaOnly && next.metaOnly,
  };
};

export function computeSignature(files) {
  try {
    return files
      .map((f) => {
        const path = `${f.subfolder || ""}/${f.filename || f.name || ""}`;
        const mtime = normalizeMtimeValue(f.mtime);
        f.mtime = mtime;
        const rating =
          f.rating ??
          (f.meta && f.meta.rating) ??
          (f.metadata && f.metadata.rating) ??
          0;
        const tags =
          (Array.isArray(f.tags) && f.tags) ||
          (Array.isArray(f.meta && f.meta.tags) && f.meta.tags) ||
          (Array.isArray(f.metadata && f.metadata.tags) && f.metadata.tags) ||
          [];
        return `${path}|${mtime || ""}|${f.size || ""}|${rating}|${tags.length}|${tags.join(",")}`;
      })
      .join(";");
  } catch (err) {
    console.warn("[Majoor.AssetsManager] signature error", err);
    return null;
  }
}

export function sortFilesDeterministically(files) {
  files.sort((a, b) => {
    const am = normalizeMtimeValue(a.mtime);
    const bm = normalizeMtimeValue(b.mtime);
    a.mtime = am;
    b.mtime = bm;
    const diff = bm - am;
    if (diff !== 0) return diff;
    const ak = `${a.subfolder || ""}/${a.filename || a.name || ""}`;
    const bk = `${b.subfolder || ""}/${b.filename || b.name || ""}`;
    return ak.localeCompare(bk);
  });
}

function mjrPageSize() {
  const cfg = Number(mjrSettings?.grid?.pageSize);
  if (!Number.isFinite(cfg) || cfg <= 0) return 500;
  return Math.max(50, Math.min(2000, Math.floor(cfg)));
}

async function fetchFilesPage({ force = false, offset = 0, limit = 0 } = {}) {
  const params = new URLSearchParams();
  params.set("t", Date.now().toString());
  if (force) params.set("force", "1");
  if (offset) params.set("offset", String(offset));
  if (limit) params.set("limit", String(limit));
  const source = String(mjrSettings?.index?.source || "auto").toLowerCase();
  if (source) {
    params.set("source", source === "filesystem" ? "scan" : source);
  }

  const res = await api.fetchApi(`/mjr/filemanager/files?${params.toString()}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function loadFiles(state, gridEl, applyFilterAndRender, opts = {}, refs) {
  const { silent = false, force = false, skipMetadataFetch = false } = opts;
  const { lastSignatureRef, mergeLoadOptsFn = mergeLoadOpts, setLoadingPromise } = refs;

  if (state.loadingPromise) {
    state.nextLoadOpts = mergeLoadOptsFn(state.nextLoadOpts, { silent, force, skipMetadataFetch });
    return state.loadingPromise;
  }

  state.loadingPromise = (async () => {
    state.loading = true;
    if (!silent && gridEl.children.length === 0) {
      gridEl.innerHTML = '<div style="opacity:.7;padding:10px;">Loading outputs...</div>';
    }
    try {
      if (!force && Array.isArray(mjrPrefetchedFiles) && mjrPrefetchedFiles.length) {
        normalizeMtimeOnList(mjrPrefetchedFiles);
        const sig = computeSignature(mjrPrefetchedFiles);
        state.files = mjrPrefetchedFiles;
        state.filesTotal = mjrPrefetchedFiles.length;
        state.filesHasMore = true;
        state.filesNextOffset = mjrPrefetchedFiles.length;
        lastSignatureRef.value = sig;
        applyFilterAndRender({ skipMetadataFetch });
      }

      const data = await fetchFilesPage({ force, offset: 0, limit: mjrPageSize() });
      const incoming = data.files || data.items || [];

      normalizeMtimeOnList(incoming);
      sortFilesDeterministically(incoming);

      const prevMap = new Map();
      (state.files || []).forEach((f) => {
        const raw = f.name || f.filename || "";
        const k = `${f.subfolder || ""}/${raw}`;
        prevMap.set(k, f);
      });
      incoming.forEach((f) => {
        const raw = f.name || f.filename || "";
        const k = `${f.subfolder || ""}/${raw}`;
        const prev = prevMap.get(k);
        if (prev) {
          if (prev.rating !== undefined) f.rating = prev.rating;
          if (Array.isArray(prev.tags)) f.tags = prev.tags;
          if (prev.__metaLoaded) f.__metaLoaded = true;
        }
      });

      const sig = `${data.total ?? incoming.length}|${computeSignature(incoming)}`;
      if (!force && sig && sig === lastSignatureRef.value) {
        lastSignatureRef.value = sig;
        return;
      }
      state.files = incoming;
      lastSignatureRef.value = sig;
      state.filesTotal = data.total ?? incoming.length;
      state.filesHasMore = data.has_more ?? (incoming.length < (data.total ?? incoming.length));
      state.filesNextOffset = data.next_offset ?? incoming.length;
      applyFilterAndRender({ skipMetadataFetch });
    } catch (err) {
      console.error("[Majoor.AssetsManager] load error", err);
      gridEl.innerHTML = `<div style="color:${mjrThemeVars.errorText};padding:10px;">Error loading files (see console).</div>`;
      mjrShowToast("error", "Error loading files", "Error");
    } finally {
      state.loading = false;
      const pending = state.nextLoadOpts;
      state.nextLoadOpts = null;
      state.loadingPromise = null;
      if (pending) {
        await loadFiles(state, gridEl, applyFilterAndRender, pending, refs);
      }
    }
  })();

  if (typeof setLoadingPromise === "function") setLoadingPromise(state.loadingPromise);
  return state.loadingPromise;
}

export async function loadMoreFiles(state, gridEl, applyFilterAndRender, opts = {}, refs = {}) {
  const { silent = true, skipMetadataFetch = false } = opts;
  const { setLoadingPromise } = refs;

  if (state.loadingPromise) return state.loadingPromise;
  if (!state.filesHasMore) return Promise.resolve();

  if (state.loadingMorePromise) {
    state.moreQueued = true;
    return state.loadingMorePromise;
  }

  state.loadingMorePromise = (async () => {
    const offset = Math.max(0, Number(state.filesNextOffset ?? state.files?.length ?? 0) || 0);
    const data = await fetchFilesPage({ force: false, offset, limit: mjrPageSize() });
    const incoming = data.files || data.items || [];

    normalizeMtimeOnList(incoming);
    sortFilesDeterministically(incoming);

    const existing = new Set(
      (state.files || []).map((f) => `${f.subfolder || ""}/${f.filename || f.name || ""}`)
    );
    const appended = [];
    for (const f of incoming) {
      const k = `${f.subfolder || ""}/${f.filename || f.name || ""}`;
      if (!existing.has(k)) {
        appended.push(f);
        existing.add(k);
      }
    }

    if (appended.length) {
      state.files = (state.files || []).concat(appended);
      applyFilterAndRender({ skipMetadataFetch });
    } else if (!silent) {
      mjrShowToast("info", "No more files to load", "Files");
    }

    state.filesTotal = data.total ?? state.filesTotal ?? state.files.length;
    state.filesHasMore = data.has_more ?? (state.files.length < (state.filesTotal ?? state.files.length));
    state.filesNextOffset = data.next_offset ?? (offset + incoming.length);
  })()
    .catch((err) => {
      console.warn("[Majoor.AssetsManager] load more failed", err);
      if (!silent) mjrShowToast("warn", "Failed to load more files", "Warning");
    })
    .finally(async () => {
      const again = !!state.moreQueued;
      state.moreQueued = false;
      state.loadingMorePromise = null;
      if (again && state.filesHasMore) {
        await loadMoreFiles(state, gridEl, applyFilterAndRender, opts, refs);
      }
    });

  if (typeof setLoadingPromise === "function") setLoadingPromise(state.loadingMorePromise);
  return state.loadingMorePromise;
}

export function createRefreshInstance(state, fetchMetadataForVisible, loadFilesFn, refs) {
  const { mjrRefreshDefaults: refreshDefaults = mjrRefreshDefaults, mergeRefreshOptionsFn = mergeRefreshOptions } = refs || {};
  let instanceRefreshInFlight = null;
  let instanceRefreshPending = null;

  const refreshInstance = async (options = {}) => {
    const opts = { ...refreshDefaults, ...options };
    if (instanceRefreshInFlight) {
      instanceRefreshPending = mergeRefreshOptionsFn(instanceRefreshPending, opts);
      return instanceRefreshInFlight;
    }

    const run = async () => {
      if (!opts.metaOnly) {
        await loadFilesFn(opts);
      }
      await fetchMetadataForVisible();
    };

    instanceRefreshInFlight = run().finally(() => {
      const pending = instanceRefreshPending;
      instanceRefreshPending = null;
      instanceRefreshInFlight = null;
      if (pending) {
        refreshInstance(pending);
      }
    });

    return instanceRefreshInFlight;
  };

  return refreshInstance;
}
