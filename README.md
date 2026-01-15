# Majoor Assets Manager for ComfyUI 🧩

An asset browser that lives directly inside ComfyUI: browse outputs/inputs/custom roots, search (FTS5), inspect generation metadata, rate/tag, collect, and drag assets into ComfyUI (or out to your OS).

![Majoor Assets Manager Demo](examples/ComfyUI_Majoor_AssetsManager_Video.gif)

## Key Features ✨

### Search & Filtering 🔎
- Full-text search powered by SQLite **FTS5** (BM25 ranking).
- Scope: **Outputs**, **Inputs**, **Custom roots**, **Collections**.
- Filters: kind, min rating, workflow-only, date filters, sorting.
- Optional: hide PNG siblings of video previews.
- Summary line: total assets + selected count + current context.

### Metadata & Viewer 🧾
- Extracts generation info from PNG/WEBP/video (ExifTool/FFprobe; degrades gracefully).
- Viewer modes: single, A/B compare, side-by-side (2-4).
- Video frame stepping in viewer (Shift + Arrow keys), zoom/pan.
- Viewer context menu: tags, rating, add to collection, open in folder, rename, delete.

### Ratings, Tags, Collections 🗂️
- Ratings/tags stored in the index DB and (optionally) synced into files when enabled.
- Collections: create, add items (duplicates skipped and reported at the end), remove items, open as a view.

### Drag & Drop 🧲
- Drag an asset onto the ComfyUI canvas (video-focused): stage to input, inject paths into compatible nodes.
- Drag out to the OS (Explorer/Desktop): uses `DownloadURL`/`text/uri-list` and supports multi-selection ZIP (flat ZIP; folders excluded).

### UX Details 🧠
- Filename collision indicator: if multiple assets share the same filename, the extension badge shows `EXT+` (e.g. `PNG+`).
- Context menus: add/remove collection, open viewer, open in folder, copy path, etc.

## Installation ⚙️

### ComfyUI Manager (recommended)
Install via the ComfyUI Manager UI.

### Manual
```bash
cd ComfyUI/custom_nodes
git clone https://github.com/MajoorWaldi/ComfyUI-Majoor-AssetsManager ComfyUI-Majoor-AssetsManager
pip install -r ComfyUI-Majoor-AssetsManager/requirements.txt
```
Restart ComfyUI.

## Usage 🧭

- Open the **Assets Manager** panel/tab.
- Pick a scope (**Outputs / Inputs / Custom / Collections**).
- Use search + filters; right-click cards for actions; double-click to open the viewer.
- Use **Collections** to save sets of files and browse them later.
- Drag assets:
  - to the ComfyUI canvas (staging/inject path),
  - or to your OS (single file or a ZIP for multi-selection).

## Hotkeys (high level) ⌨️

Hotkeys are ignored while typing inside inputs.

- `Ctrl/Cmd+S`: trigger an index scan for the current scope.
- `D`: toggle details sidebar for the current selection.
- `0`-`5`: set rating for the current selection (when interacting with the grid).
- Viewer: `Esc` closes, Shift+Arrow steps video frames (single video).

## Settings 🧰

Settings are stored under the `mjrSettings` key in `localStorage`.

- Page size (assets per request)
- Auto-scan (on open / on startup)
- Status poll interval
- Sidebar position (left/right)
- Hide PNG siblings (video previews)
- Sync rating/tags to files (best-effort; requires tools)
- Media probe backend (auto/exiftool/ffprobe/both)
- Observability (request logging)

## Environment Variables (backend) 🧪

- `MAJOOR_OUTPUT_DIRECTORY` - override output directory
- `MAJOOR_EXIFTOOL_PATH` / `MAJOOR_EXIFTOOL_BIN` - ExifTool path
- `MAJOOR_FFPROBE_PATH` / `MAJOOR_FFPROBE_BIN` - FFprobe path
- `MAJOOR_MEDIA_PROBE_BACKEND` - `auto|exiftool|ffprobe|both`
- `MAJOOR_ENABLE_FILE_WATCHER` - auto reindexing (default `false`)
- `MAJOOR_WATCHER_INTERVAL` / `MAJOOR_WATCHER_JOIN_TIMEOUT` / `MAJOOR_WATCHER_PATHS`
- `MAJOOR_DB_TIMEOUT` / `MAJOOR_DB_MAX_CONNECTIONS` / `MAJOOR_DB_QUERY_TIMEOUT`

## Files & Storage 🗃️

- Index DB: `<output>/_mjr_index/assets.sqlite`
- Custom roots store: `<output>/_mjr_index/custom_roots.json`
- Collections store: `<output>/_mjr_index/collections/*.json`
- Temporary drag-out ZIPs: `<output>/_mjr_batch_zips/` (auto-cleaned)

## Development 🧑‍💻

```bash
python -m pytest -q
```

## Architecture 🏗️

- `backend/` - Python backend (routes + features)
  - `features/index` (scan/search), `features/metadata` (extract), `features/tags` (sync), `features/collections`
  - `routes/handlers` (HTTP), `routes/core` (security/paths/response)
- `js/` - frontend extension
  - `features/grid`, `features/panel`, `features/viewer`, `features/dnd`
  - `components` (Card/Viewer/Sidebar/menus), `app` (settings/bootstrap), `theme`
