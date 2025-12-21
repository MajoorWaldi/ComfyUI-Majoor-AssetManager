import { detectKindFromExt, getExt } from "./ui_settings.js";

export const normalizeMtimeValue = (mtime) => {
  const n = Number(mtime || 0);
  return n < 100000000000 ? n * 1000 : n;
};

export const normalizeMtimeOnList = (files) => {
  if (!Array.isArray(files)) return;
  files.forEach((f) => {
    f.mtime = normalizeMtimeValue(f.mtime);
  });
};

export const SMART_FILTERS = {
  "smart:today": {
    label: "📅 Today",
    filter: (f) => {
      const ms = normalizeMtimeValue(f.mtime);
      const d = new Date(ms);
      const now = new Date();
      return d.toDateString() === now.toDateString();
    },
  },
  "smart:yesterday": {
    label: "📅 Yesterday",
    filter: (f) => {
      const ms = normalizeMtimeValue(f.mtime);
      const d = new Date(ms);
      const now = new Date();
      now.setDate(now.getDate() - 1);
      return d.toDateString() === now.toDateString();
    },
  },
  "smart:last7": {
    label: "📅 Last 7 Days",
    filter: (f) => {
      const ms = normalizeMtimeValue(f.mtime);
      const diff = Date.now() - ms;
      return diff < 7 * 24 * 60 * 60 * 1000;
    },
  },
  "smart:5stars": {
    label: "⭐ 5 Stars",
    filter: (f) => {
      const r = f.rating ?? (f.meta && f.meta.rating) ?? 0;
      return Number(r) === 5;
    },
  },
  "smart:4plus": {
    label: "⭐ 4+ Stars",
    filter: (f) => {
      const r = f.rating ?? (f.meta && f.meta.rating) ?? 0;
      return Number(r) >= 4;
    },
  },
  "smart:videos": {
    label: "🎥 Videos",
    filter: (f) => (f.kind || detectKindFromExt(f.ext || getExt(f.filename || f.name))) === "video",
  },
  "smart:images": {
    label: "🖼️ Images",
    filter: (f) => (f.kind || detectKindFromExt(f.ext || getExt(f.filename || f.name))) === "image",
  },
};
