# 📂 Majoor Assets Manager for ComfyUI

Fast asset browser for ComfyUI outputs (images/videos/audio/3D) with **ratings & tags** stored in OS metadata (and optional sidecars).

---

## ✅ Requirements

Python dependencies are listed in `requirements.txt` (ComfyUI Manager installs them automatically):

- `aiohttp` (REST API)
- `pillow` (thumbnails)
- `send2trash` (safe delete to recycle bin when available)
- `pywin32` (Windows only; enables Windows Property System metadata)

External tools (recommended):

- 🧰 **ExifTool** (strongly recommended for video metadata read/write)
  - Windows: download from exiftool.org and add `exiftool.exe` to `PATH`
  - macOS: `brew install exiftool`
  - Linux (Debian/Ubuntu): `sudo apt install libimage-exiftool-perl`
- 🎬 **ffprobe** (optional; improves video metadata extraction, usually installed with FFmpeg)

---

## 🚀 Key Features

- ⚡ Fast browsing: paginated file listing, virtualized grid, lazy metadata batch fetch, optional auto-refresh.
- ⭐ Ratings & 🏷️ tags: set rating `0–5` and tags; shows badges on cards and in the viewer.
- 🧠 Prompt/workflow inspector: reads generation data from images and videos (with sibling PNG fallback when needed).
- 🔎 Filters & collections: search, min rating, tag filter, smart filters, and collections stored in `_mjr_collections`.
- 🖼️ Viewer + A/B: single viewer + A/B compare, zoom/pan, video playback, rating HUD.
- 🧷 Hover info: optional native tooltip on cards (filename, folder, size/date, rating/tags, workflow state).

---

## 🎞️ Demos (GIF)

GIFs are large; these are linked (not embedded) to keep the README fast. Full-res captures are kept locally as `examples/*_full.gif` (gitignored):

- ⚡ Fast browsing: [examples/fastbrowsing.gif](examples/fastbrowsing.gif)
- ⭐ Ratings & 🏷️ tags: [examples/notations.gif](examples/notations.gif)
- 🗂️ Smart collections: [examples/Smart_Collections.gif](examples/Smart_Collections.gif)
- 🧩 Drag & drop workflow: [examples/Drop_Workflow.gif](examples/Drop_Workflow.gif)
- 🎞️ Frame-by-frame (video): [examples/Frame_by_frame.gif](examples/Frame_by_frame.gif)
- 🧩 UI rendering/integration: [examples/render.gif](examples/render.gif)

---

## 🎬 Video Metadata Reliability (important)

Windows Explorer can be inconsistent for MP4/MOV/MKV/WEBM metadata. For videos, the manager uses a **redundant write strategy**:

- ✅ Always writes:
  - `XMP:Rating` (0–5)
  - `XMP:Subject` (tags list; `; ` separator)
- ✅ Best-effort writes (does not fail the operation if unsupported):
  - `Microsoft:SharedUserRating` (0–99 “percent” scale used by Explorer)
  - `Microsoft:Category` (tags; `tag1; tag2`)
- 🛡️ Preserves embedded ComfyUI workflow JSON stored in comment-like fields by copying the original tags (`-tagsFromFile @ ...`) before writing rating/tags.
- ⏳ Handles “file not ready/locked” right after generation: retries ExifTool up to 5 times with exponential backoff for common “cannot open/write” errors.
- 📥 Read priority for videos: ExifTool values are treated as the source of truth (XMP first, Microsoft fallback), then Windows Property System.

---

## 📦 Installation

### Method 1: ComfyUI Manager (recommended)

1. Open ComfyUI Manager.
2. Search for "Majoor Assets Manager" (or install via Git URL).
3. Install and restart ComfyUI.

### Method 2: Manual

```bash
cd ComfyUI/custom_nodes
git clone <this-repo-url> ComfyUI-Majoor-AssetsManager
pip install -r ComfyUI-Majoor-AssetsManager/requirements.txt
```

Restart ComfyUI.

---

## ⌨️ Hotkeys

Hotkeys are ignored while typing in an input/textarea.

### Assets Manager (grid)

- `0`–`5`: set rating for current/selected files (`0` clears).
- `Space`: open viewer (1 selected) or A/B compare (2 selected; uses the first two).

### Viewer

- `Esc` or `Space`: close viewer.
- `ArrowLeft` / `ArrowRight`: previous/next asset (when navigation is enabled).
- `0`–`5` (including numpad): set rating (when viewer rating hotkeys are enabled).
- `ArrowUp` / `ArrowDown`: step videos +/- 1/30s (when frame-step hotkeys are enabled).
- `F`: fit/reset view.

---

## ⚙️ Settings (ComfyUI → Settings)

Main ones to know:

- 🧩 `Majoor: Panel Integration (reload to apply)`: show in `sidebar`, `bottom`, or `both`.
- 📄 `Majoor: Page Size (files per request)`: pagination chunk size (default `500`).
- 🛈 `Majoor: Hover Info Tooltips`: show/hide card hover tooltips.
- 🔁 Auto-refresh: enabled/interval/focus-only.
- 🖼️ Viewer: autoplay/loop/mute/navigation/rating HUD.

---

## 🧪 Development (Formatting)

This repo uses `ruff` for formatting and a small set of safe autofixes.

```bash
pip install -r requirements-dev.txt
ruff format .
ruff check --fix .
```

Optional: `pre-commit install`

---

## 📝 Notes

- Sidecars: `.mjr.json` are enabled by default on non-Windows; on Windows default is OS metadata. Override with `MJR_ENABLE_SIDECAR` / `MJR_FORCE_SIDECAR`.
- Output helper folders: collections in `_mjr_collections` (inside your ComfyUI output directory).
- API endpoints live under `/mjr/filemanager/*` (e.g. `/files`, `/metadata`, `/metadata/batch`, `/metadata/update`).
- Timeouts (to prevent hangs) are configurable via env vars: `MJR_META_EXIFTOOL_TIMEOUT`, `MJR_META_FFPROBE_TIMEOUT`, `MJR_EXIFTOOL_READ_TIMEOUT`, `MJR_EXIFTOOL_WRITE_TIMEOUT`, `MJR_EXIFTOOL_PRESERVE_TIMEOUT`, `MJR_FILE_MANAGER_TIMEOUT`.
