# 📂 Majoor Assets Manager for ComfyUI

Fast asset browser for ComfyUI outputs with native OS metadata.

Majoor Assets Manager is a UI extension (no custom nodes) to browse, inspect, and organize images, videos, audio, and 3D exports without leaving ComfyUI. It runs asynchronously and writes ratings/tags directly to your files' Windows properties (with ExifTool/JSON sidecar fallback), so your organization survives outside of ComfyUI.

---

## Prerequisites / System Requirements

- ExifTool is recommended for video metadata (MP4/MOV/M4V/WEBM/MKV). Without it, video workflows/prompts can fall back to a degraded scan and some embedded metadata may be missed.
- Windows: download from exiftool.org and ensure `exiftool.exe` is on your PATH.
- macOS: `brew install exiftool`
- Linux (Debian/Ubuntu): `sudo apt install libimage-exiftool-perl`
- ffprobe is used when available; timeouts are configurable via `MJR_META_FFPROBE_TIMEOUT` and `MJR_META_EXIFTOOL_TIMEOUT`.
- Additional safety timeouts:
  - `MJR_EXIFTOOL_READ_TIMEOUT` (default: `2`)
  - `MJR_EXIFTOOL_PRESERVE_TIMEOUT` (default: `3`)
  - `MJR_EXIFTOOL_WRITE_TIMEOUT` (default: `3`)
  - `MJR_FILE_MANAGER_TIMEOUT` (default: `15`)

---

## Scalability (Large Libraries)

- The file listing endpoint supports pagination: `GET /mjr/filemanager/files?offset=0&limit=500` (omit `limit` to return everything for backward compatibility).
- Frontend page size can be tuned via settings key `grid.pageSize` (default: `500`).

---

## Development (Formatting)

This repo uses `ruff` for consistent Python formatting (and a small set of safe autofixes).

```bash
pip install -r requirements-dev.txt
ruff format .
ruff check --fix .
```

Optional (recommended): enable pre-commit hooks so formatting runs automatically before commits.

```bash
pre-commit install
```

---

## ✨ Key Features

- ⚡ Async, cached scans: non-blocking backend, virtualized grid, lazy metadata fetch, auto-refresh, and queue listener so new renders show up quickly.
- 🏷️ Native ratings & tags: edit 0-5 ratings and tags that sync to Windows Explorer; ExifTool or JSON sidecars on Linux/Mac; badges on cards and in the viewer.
- 🔎 Prompt/workflow inspector: view prompts, seed, sampler, CFG, checkpoint, LoRAs, and parsed workflow. Video parsing scans common comment/description/parameters tags via ffprobe/ExifTool and can reconstruct a workflow from a prompt graph when needed. Sibling PNG fallback is used if video metadata is empty.
- 🧭 Filters, search, collections: search bar, type filter (image/video/audio/3D), min rating, tag filter, smart views (Today, Yesterday, Last 7 Days, 4+/5, Videos, Images), and custom collections stored in `_mjr_collections`.
- 🖼️ Viewer + A/B compare: lightbox viewer with filmstrip nav, zoom/pan, video/audio playback, rating HUD, and side-by-side slider compare for two selected files.
- 🗂️ Sibling-aware metadata: detects PNG companions for videos/audio/3D to reuse metadata; open in Explorer, delete/send to trash, and add to collections from the context menu.
- 🧲 Clean drag & drop: dragging any asset exposes standard `text/uri-list` and `DownloadURL` (when supported) for ComfyUI and external targets; drops on the ComfyUI canvas are handled natively by ComfyUI (no workflow import/interception by this plugin).

---

## 📥 Installation

### Method 1: Via ComfyUI Manager (Recommended)

1. Open ComfyUI Manager.
2. Search for "Majoor Assets Manager" or choose Install via Git URL.
3. Paste this repository URL (the URL of this repo).
4. Click Install and restart ComfyUI.

### Method 2: Manual Installation

1. Navigate to your ComfyUI `custom_nodes` folder:
   ```bash
   cd ComfyUI/custom_nodes
   ```
2. Clone the repository:
   ```bash
   git clone <this-repo-url> ComfyUI-Majoor-AssetsManager
   ```
3. Install Python requirements:
   ```bash
   pip install -r ComfyUI-Majoor-AssetsManager/requirements.txt
   ```
4. Restart ComfyUI.

---

## 🎹 Hotkeys

Hotkeys are ignored while typing in an input/textarea.

### Assets Manager (grid)

- `Tab`: focus/open the Assets Manager sidebar tab.
- `0`-`5`: set rating for the current file (0 clears).
- `Enter`: open viewer (1 selected) or A/B compare (2 selected; uses the first two).

### Viewer

- `Esc` or `Space`: close viewer.
- `ArrowLeft` / `ArrowRight`: previous/next asset (when navigation is enabled).
- `0`-`5` (including numpad): set rating (when rating hotkeys are enabled).
- `ArrowUp` / `ArrowDown`: step videos +/- 1/30s (when frame-step hotkeys are enabled).
- `F`: fit/reset view.

---

## ℹ️ Notes

- Windows uses native shell metadata; Linux/Mac fall back to ExifTool or JSON sidecars (`.mjr.json` and `_mjr_collections` live in your output folder).
- Drag & drop: dragging from the grid uses standard `text/uri-list` and `DownloadURL` (when supported). Drops on the ComfyUI canvas are handled natively by ComfyUI (this plugin does not import/open workflows on drop).
- No custom nodes are added; the manager runs entirely in the UI and the REST API under `/mjr/filemanager/*`.
