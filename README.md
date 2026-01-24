# Majoor Assets Manager for ComfyUI

Majoor Assets Manager is an advanced asset browser for ComfyUI that provides a comprehensive solution for managing, organizing, and viewing your generated assets. It integrates directly into ComfyUI, offering features like full-text search, metadata extraction, rating and tagging systems, and advanced viewing capabilities.

![Majoor Assets Manager Demo](examples/ComfyUI_Majoor_AssetsManager_Video.gif)

**[User Guide](user_guide.html)** - Complete documentation with features, installation, and usage instructions.
**[Documentation Index](docs/DOCUMENTATION_INDEX.md)** - All docs (install, viewer, metadata, settings, etc).

## License

Copyright (c) 2026 Ewald ALOEBOETOE (MajoorWaldi).

Licensed under the **GNU General Public License v3.0**. See `LICENSE`.

Optional attribution request (non-binding): see `NOTICE`.

## Key Features

### Search & Filtering
- Full-text search powered by SQLite **FTS5** (BM25 ranking).
- Scope: **Outputs**, **Inputs**, **Custom roots**, **Collections**.
- Filters: kind, min rating, workflow-only, date filters, sorting.
- Optional: hide PNG siblings of video previews.
- Summary line: total assets + selected count + current context.

### Metadata & Viewer
- Extracts generation info from PNG/WEBP/video (ExifTool/FFprobe; degrades gracefully).
- Viewer modes: single, A/B compare, side-by-side.
- Navigation: zoom/pan, 1:1 pixel zoom, quick next/prev navigation.
- Tools: exposure (EV), gamma, channel view (RGB/R/G/B/Alpha/Luma), analysis (false color, zebra).
- Scopes (optional): downscaled RGB histogram + luma waveform.
- Overlays: grid (thirds/center/safe/golden), pixel probe, loupe.
- Compare: wipe (slider) and difference mode.
- Export: save current frame to PNG + copy to clipboard (best-effort).
- Generation Info panel: prompt/model/sampling/image parameters + workflow minimap, with loading/error feedback and retry for transient failures.
- Video: loops by default; player bar provides seek, In/Out range, loop/once, frame stepping, and FPS/step controls.
- Context menu: tags, rating, add to collection, open in folder, rename, delete.

### Ratings, Tags, Collections
- Ratings/tags stored in the index DB and (optionally) synced into files when enabled.
- Collections: create, add items (duplicates skipped and reported), remove items, open as a view. Large collections are capped for safety (configurable).

### Drag & Drop
- Drag an asset onto the ComfyUI canvas: stage to input, inject paths into compatible nodes.
- Drag out to the OS (Explorer/Desktop): uses `DownloadURL`/`text/uri-list` and supports multi-selection ZIP (flat ZIP; folders excluded).

### UX Details
- Filename collision indicator: if multiple assets share the same filename, the extension badge shows `EXT+` (e.g. `PNG+`).
- Context menus: add/remove collection, open viewer, open in folder, copy path, etc.

## Installation

### ComfyUI Manager (recommended)
Install via the ComfyUI Manager UI.

### Manual
```bash
cd ComfyUI/custom_nodes
git clone https://github.com/MajoorWaldi/ComfyUI-Majoor-AssetsManager ComfyUI-Majoor-AssetsManager
pip install -r ComfyUI-Majoor-AssetsManager/requirements.txt
```
Restart ComfyUI.

If dependencies are missing at startup, the extension may attempt a best-effort `pip install -r requirements.txt` automatically (can be disabled with `MJR_AM_NO_AUTO_PIP=1`).

### Optional (recommended): install ExifTool + FFprobe (metadata extraction)

The Assets Manager works without these tools, but **metadata extraction** (generation info, media probe) and **tag/rating sync to files** are best-effort and will be **degraded** if the tools are missing.

Verify they are available in your `PATH`:
```bash
exiftool -ver
ffprobe -version
```

If they are not in `PATH`, set `MAJOOR_EXIFTOOL_PATH` and/or `MAJOOR_FFPROBE_PATH` (see Environment Variables below).

#### Windows
Option A (Scoop):
```powershell
scoop install ffmpeg exiftool
```

Option B (Chocolatey):
```powershell
choco install -y ffmpeg exiftool
```

Option C (WinGet):
```powershell
winget install -e --id Gyan.FFmpeg
winget install -e --id PhilHarvey.ExifTool
```
If the IDs differ on your machine, use `winget search ffmpeg` / `winget search exiftool`.

Option D (manual download):
- FFprobe is included with FFmpeg builds: install FFmpeg and ensure the `bin/` folder is in your `PATH`.
- ExifTool: download from `https://exiftool.org/` and point `MAJOOR_EXIFTOOL_PATH` to `exiftool.exe` if needed.

#### macOS
```bash
brew install ffmpeg exiftool
```

#### Linux
Debian/Ubuntu:
```bash
sudo apt-get update
sudo apt-get install -y ffmpeg exiftool
```

Package names can vary by distro (e.g. `perl-Image-ExifTool` on some).

## Usage

- Open the **Assets Manager** panel/tab.
- Pick a scope (**Outputs / Inputs / Custom / Collections**).
- Use search + filters; right-click cards for actions; double-click to open the viewer.
- Use **Collections** to save sets of files and browse them later.
- Drag assets:
  - to the ComfyUI canvas (staging/inject path),
  - or to your OS (single file or a ZIP for multi-selection).

## Hotkeys (high level)

Hotkeys are ignored while typing inside inputs.

- `Ctrl/Cmd+S`: trigger an index scan for the current scope.
- `D`: toggle details sidebar for the current selection.
- `0`-`5`: set rating for the current selection (when interacting with the grid).
- Viewer:
  - Viewer hotkeys are consumed (don’t leak to ComfyUI/global handlers).
  - `Esc`: close viewer
  - `0`-`5`: set rating (single view)
  - `Shift+Arrow`: step video frames (single video)
  - `F`: false color toggle
  - `Z`: zebra toggle
  - `G`: grid cycle (off -> thirds -> center -> safe -> golden)
  - `I`: pixel probe toggle
  - `L`: loupe toggle
  - `C`: copy last probed color hex
  - `Alt+1`: toggle 1:1 zoom

## Settings

Settings are stored under the `mjrSettings` key in `localStorage` (browser-side).

Backend persistence is currently limited to `probeBackend.mode` (stored in the SQLite `metadata` table). It uses a version bump so changes propagate quickly even with multiple backend instances. Other settings are intentionally browser-local and won't sync across machines/browsers.

- Page size (assets per request)
- Auto-scan (on open / on startup)
- Status poll interval
- Sidebar position (left/right)
- Hide PNG siblings (video previews)
- Sync rating/tags to files (best-effort; requires tools)
- Media probe backend (auto/exiftool/ffprobe/both)
- Observability (request logging)
- Tags cache TTL (ms)
- Workflow minimap display toggles

## Environment Variables (backend)

- `MAJOOR_OUTPUT_DIRECTORY` - override output directory
- `MAJOOR_EXIFTOOL_PATH` / `MAJOOR_EXIFTOOL_BIN` - ExifTool path
- `MAJOOR_FFPROBE_PATH` / `MAJOOR_FFPROBE_BIN` - FFprobe path
- `MAJOOR_MEDIA_PROBE_BACKEND` - `auto|exiftool|ffprobe|both`
- `MAJOOR_ENABLE_FILE_WATCHER` - auto reindexing (default `false`)
- `MAJOOR_WATCHER_INTERVAL` / `MAJOOR_WATCHER_JOIN_TIMEOUT` / `MAJOOR_WATCHER_PATHS`
- `MAJOOR_DB_TIMEOUT` / `MAJOOR_DB_MAX_CONNECTIONS` / `MAJOOR_DB_QUERY_TIMEOUT`
- `MAJOOR_TO_THREAD_TIMEOUT` - timeout (seconds) for `asyncio.to_thread(...)` work in HTTP handlers (default `30`)
- `MAJOOR_MAX_METADATA_JSON_BYTES` - max metadata JSON size stored in DB/cache (default `2097152`)
- `MJR_AM_NO_AUTO_PIP` - set to `1` to disable best-effort dependency auto-install on startup
- `MJR_COLLECTION_MAX_ITEMS` - max items per collection JSON (default `50000`)
- `MJR_ALLOW_SYMLINKS` - allow symlink/junction custom roots (default `off`)
- `MAJOOR_TRUSTED_PROXIES` - comma-separated IPs/CIDRs allowed to supply `X-Forwarded-For`/`X-Real-IP` (default `127.0.0.1,::1`)

## Security Model (high level)

- **CSRF**: state-changing endpoints require `X-Requested-With: XMLHttpRequest` (or `X-CSRF-Token`) and validate `Origin` vs `Host` when present.
- **Rate limiting**: in-memory per-client limits exist on expensive endpoints (search/scan/metadata/batch-zip). Client identity is based on IP; `X-Forwarded-For` is only honored when the connection comes from `MAJOOR_TRUSTED_PROXIES`.
- **Path safety**: file operations validate root containment for output/input/custom roots and reject paths outside allowed roots (symlink/junction handling is opt-in).
- **Batch ZIP**: ZIP building streams from an open file handle (avoids TOCTOU rename/replace races).

## Files & Storage

- Index DB: `<output>/_mjr_index/assets.sqlite`
- Custom roots store: `<output>/_mjr_index/custom_roots.json`
- Collections store: `<output>/_mjr_index/collections/*.json`
- Temporary drag-out ZIPs: `<output>/_mjr_batch_zips/` (auto-cleaned)

## Development

```bash
python -m pytest -q
```

### Tests (Windows)

Batch runners generate both JUnit XML and a styled HTML report in `tests/__reports__/`:

- Full suite: `run_tests.bat` (or `tests/run_tests_all.bat`)
- Quick suite (skips the long Comfy output scan): `run_tests_quick.bat`
- Metadata / parser suite: `run_tests_parser.bat` (runs `tests/metadata/`)

Open the report index:
- `tests/__reports__/index.html`

Test runtime DB artifacts (`*.db`, `*.db-wal`, `*.db-shm`, etc.) are created under:
- `tests/__pytest_tmp__/`

Parser samples scan (metadata suite):
- Put sample files under `tests/parser/` (subfolders supported), or set `MJR_TEST_PARSER_DIR` to an external folder.

## Release (zip)

On Windows, build a clean drop-in zip (excludes `.git/`, caches, etc.):

```powershell
pwsh -File scripts/make_release_zip.ps1
```

## Architecture

- `backend/` - Python backend (routes + features)
  - `features/index` (scan/search), `features/metadata` (extract), `features/tags` (sync), `features/collections`
  - `routes/handlers` (HTTP), `routes/core` (security/paths/response)
- `js/` - frontend extension
  - `features/grid`, `features/panel`, `features/viewer`, `features/dnd`
  - `components` (Card/Viewer/Sidebar/menus), `app` (settings/bootstrap), `theme`

## Viewer Roadmap (bigger items)

- GPU grade (WebGL2): exposure/gamma/channels/zebra/false color.
- OffscreenCanvas + Worker fallback for heavy processing.
- Cache processed frame while paused (instant grade tweaks).
