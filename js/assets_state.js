export const createInitialState = () => ({
  files: [],
  filtered: [],
  search: "",
  minRating: 0,
  kindFilter: "",
  tagFilter: "",
  activeCollection: null,
  collectionSet: null,
  smartFilter: null,
  selected: new Set(),
  currentFile: null,
  currentMeta: null,
  loading: false,
  loadingPromise: null,
  metaCache: new Map(),
  metaFetchAt: new Map(),
  nextLoadOpts: null,
  renderVersion: 0,
});

export const fileKey = (file) => `${file.subfolder || ""}/${file.filename || file.name || ""}`;
