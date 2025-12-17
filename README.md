# 📂 Majoor Assets Manager for ComfyUI

Fast asset browser for ComfyUI outputs with ratings/tags stored in native OS metadata (and optional sidecars).

Majoor Assets Manager is a UI extension (no custom nodes) to browse, inspect, and organize images, videos, audio, and 3D exports without leaving ComfyUI.

---

## ✅ Requirements

Python dependencies are listed in `requirements.txt` and installed automatically by ComfyUI Manager, or manually via pip.

- `aiohttp` (API)
- `pillow` (thumbnails)
- `send2trash` (safe delete to recycle bin when available)
- `pywin32` (Windows only; enables native Explorer metadata reads/writes)

External tools (recommended):

- **ExifTool** (strongly recommended): better metadata read/write (especially for video tags/ratings).
  - Windows: install from exiftool.org and put `exiftool.exe` on PATH
  - macOS: `brew install exiftool`
  - Linux (Debian/Ubuntu): `sudo apt install libimage-exiftool-perl`
- **ffprobe** (optional): used when available for video metadata parsing (usually installed with FFmpeg).

---

## 🚀 Key Features

- ⚡ Fast browsing: paginated file listing, virtualized grid, lazy metadata batch fetch, optional auto-refresh.
- ⭐ Ratings & 🏷️ tags: edit rating (0–5) and tags; persists to OS metadata (Windows) and/or ExifTool/sidecar on other OSes.
- 🧠 Prompt/workflow inspector: shows prompts/seeds/models/LoRAs and workflow extraction (images + videos; can fall back to sibling PNG).
- 🔎 Filters & collections: search, min rating, tag filter, smart filters, and collections stored in `_mjr_collections`.
- 🖼️ Viewer + A/B: single viewer + A/B compare, zoom/pan, video playback, rating HUD.
- 🧷 Hover info: optional hover tooltip on cards with filename, folder, date/size, rating/tags, workflow state.

---

## 📦 Installation

### Method 1: ComfyUI Manager (recommended)

1. Open ComfyUI Manager.
2. Search for “Majoor Assets Manager” (or install via Git URL).
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

- `0`–`5`: set rating for current/selected files (0 clears).
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
- 🖼️ Viewer: autoplay/loop/mute/nav/rating HUD.

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

- Sidecars: `.mjr.json` are enabled by default on non-Windows; on Windows the default is native metadata. Override with `MJR_ENABLE_SIDECAR` / `MJR_FORCE_SIDECAR`.
- Endpoints live under `/mjr/filemanager/*` (e.g. `/files`, `/metadata`, `/metadata/batch`, `/metadata/update`).
- Tool timeouts are configurable (prevents hangs): `MJR_META_EXIFTOOL_TIMEOUT`, `MJR_META_FFPROBE_TIMEOUT`, `MJR_EXIFTOOL_READ_TIMEOUT`, `MJR_EXIFTOOL_WRITE_TIMEOUT`, `MJR_FILE_MANAGER_TIMEOUT`.
