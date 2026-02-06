# Majoor Assets Manager - Comprehensive User Guide

## Table of Contents
1. [Introduction](#introduction)
2. [Installation & Setup](#installation--setup)
3. [Core Features](#core-features)
4. [Search & Filtering](#search--filtering)
5. [Metadata & Viewer](#metadata--viewer)
6. [Ratings, Tags & Collections](#ratings-tags--collections)
7. [Drag & Drop Functionality](#drag--drop-functionality)
8. [Hotkeys & Shortcuts](#hotkeys--shortcuts)
9. [Settings & Configuration](#settings--configuration)
10. [Troubleshooting](#troubleshooting)

## Introduction

The Majoor Assets Manager is an advanced asset browser for ComfyUI that provides a comprehensive solution for managing, organizing, and viewing your generated assets. It integrates directly into ComfyUI, offering features like full-text search, metadata extraction, rating and tagging systems, and advanced viewing capabilities.

### Key Benefits
- Browse output, input, and custom directories directly in ComfyUI
- **High Performance**: Virtualized grid for browsing 10k+ assets and GPU-accelerated video viewer.
- Powerful search with full-text indexing
- Rich metadata extraction from generated assets
- Rating and tagging systems for organization
- Collections for grouping related assets
- Advanced viewer with comparison tools
- Drag-and-drop integration with ComfyUI canvas

## Installation & Setup

### Prerequisites
- ComfyUI installation
- Python 3.8 or higher

### Installation Methods

#### Method 1: Using ComfyUI Manager (Recommended)
1. Open ComfyUI Manager
2. Search for "Majoor Assets Manager"
3. Install the extension
4. Restart ComfyUI

#### Method 2: Manual Installation
```bash
cd ComfyUI/custom_nodes
git clone https://github.com/MajoorWaldi/ComfyUI-Majoor-AssetsManager ComfyUI-Majoor-AssetsManager
pip install -r ComfyUI-Majoor-AssetsManager/requirements.txt
```
Restart ComfyUI.

### Optional Dependencies (Highly Recommended)

For enhanced metadata extraction and file tagging capabilities, install these tools:

#### Windows
Using Scoop:
```powershell
scoop install ffmpeg exiftool
```

Using Chocolatey:
```powershell
choco install -y ffmpeg exiftool
```

Using WinGet:
```powershell
winget install -e --id Gyan.FFmpeg
winget install -e --id PhilHarvey.ExifTool
```

#### macOS
```bash
brew install ffmpeg exiftool
```

#### Linux (Ubuntu/Debian)
```bash
sudo apt-get update
sudo apt-get install -y ffmpeg exiftool
```

Verify installation:
```bash
exiftool -ver
ffprobe -version
```

If tools are not in PATH, set environment variables:
- `MAJOOR_EXIFTOOL_PATH` - Path to exiftool executable
- `MAJOOR_FFPROBE_PATH` - Path to ffprobe executable

## Core Features

### Asset Browser Interface
The Assets Manager provides a tabbed interface with four main scopes:
- **Outputs**: Browse your ComfyUI output directory
- **Inputs**: Browse your ComfyUI input directory  
- **Custom**: Browse user-defined directories
- **Collections**: Browse saved collections of assets

### Initial Setup
1. Open the Assets Manager panel in ComfyUI
2. Select a scope (Outputs, Inputs, Custom, or Collections)
3. The interface will automatically scan and index assets in the selected scope
4. Use search and filters to narrow down results

### Navigation
- Click on asset cards to select them
- Double-click on asset cards to open the viewer
- Right-click on asset cards for context menu options
- Use pagination controls to navigate through large result sets

## Search & Filtering

### Full-Text Search
The Assets Manager uses SQLite FTS5 with BM25 ranking for powerful search capabilities:

- Type any text in the search box to search across all indexed assets
- Search looks through filenames, metadata, prompts, and other text fields
- Results are ranked by relevance using BM25 algorithm
- Search works across all scopes (Outputs, Inputs, Custom, Collections)

### Advanced Filters

#### Kind Filter
Filter by file type:
- Images (PNG, JPG, WEBP, etc.)
- Videos (MP4, MOV, AVI, etc.)
- Workflows (JSON, PNG with embedded workflows)

#### Rating Filter
- Show only assets with minimum rating (1-5 stars)
- Useful for quickly finding your best results

#### Workflow Filter
- Filter to show only assets with embedded workflow information
- Helpful when looking for specific generation parameters

#### Date Filters
- Filter by creation/modification dates
- Useful for finding recent or historical assets

#### Sorting Options
- Sort by name, date, size, rating, or relevance
- Toggle ascending/descending order

### Search Tips
- Use quotes for exact phrase matching: `"landscape portrait"`
- Combine multiple terms for broader search: `character landscape`
- Use the summary line to see total assets and current selection count

## Metadata & Viewer

### Metadata Extraction
The Assets Manager extracts rich metadata from your assets:

#### Image Metadata
- Generation parameters (prompt, negative prompt, model, sampling parameters)
- Workflow information (with minimap preview)
- Technical details (resolution, file size, format)
- Custom tags and ratings

#### Video Metadata
- Duration, frame rate, resolution
- Audio information if present
- Generation parameters if embedded

#### Extraction Backends
The system uses multiple backends for metadata extraction:
- **ExifTool**: Most comprehensive, handles all formats
- **FFprobe**: Specialized for video/audio
- **Built-in**: Basic extraction when external tools unavailable

### Advanced Viewer

#### Single View Mode
- Zoom and pan functionality
- 1:1 pixel view for detail inspection
- Exposure adjustment (EV controls)
- Gamma correction
- Channel isolation (RGB/R/G/B/Alpha/Luma)
- Analysis tools (false color, zebra patterns)

#### Comparison Modes
- **Side-by-side**: Compare two assets visually
- **A/B Compare**: Toggle between two assets
- **Wipe**: Slider to reveal one asset over another
- **Difference**: Show mathematical difference between assets

#### Video Player
- Loop/once playback options
- Seek controls with timeline
- In/Out point markers for segment playback
- Frame-by-frame stepping
- Adjustable playback speed

#### Overlays
- Grid overlays (thirds, center, safe area, golden ratio)
- Pixel probe for color values
- Loupe magnification
- Histogram and waveform scopes

#### Export Options
- Save current frame as PNG
- Copy to clipboard (best-effort)
- Download original file

### Context Menu Actions
Right-click on any asset to access:
- Add/remove from collections
- Rate the asset (0-5 stars)
- Tag the asset
- Open in folder
- Copy file path
- Rename file
- Delete file
- Refresh metadata

## Ratings, Tags & Collections

### Rating System
- Rate assets from 0 to 5 stars
- Ratings are stored in the index database
- Optionally synced to file metadata when external tools are available
- Filter by minimum rating to quickly find your best results

### Tagging System
- Add custom tags to organize assets
- Tags are stored in the index database
- Optionally synced to file metadata when external tools are available
- Search by tags to find related assets
- Bulk tagging for multiple selections

### Collections
Collections allow you to group related assets:

#### Creating Collections
1. Select one or more assets
2. Right-click and choose "Add to Collection"
3. Choose an existing collection or create a new one
4. Name your collection appropriately

#### Managing Collections
- View all collections in the Collections tab
- Add or remove items from collections
- Rename or delete collections
- Collections are stored as JSON files in the index directory

#### Collection Features
- Duplicate items are automatically skipped
- Large collections are capped for performance (default 50,000 items)
- Collections can span multiple directories
- Share collections by sharing the JSON files

## Drag & Drop Functionality

### Drag to ComfyUI Canvas
- Drag assets directly onto the ComfyUI canvas
- Assets are automatically staged to compatible input nodes
- File paths are injected into appropriate nodes
- Works with single or multiple selections

### Drag to Operating System
- Drag assets to your file explorer/desktop
- Single files are opened directly
- Multiple selections are packaged into a ZIP file
- ZIP files are created on-demand and cleaned up automatically
- Supports `DownloadURL` and `text/uri-list` protocols

### Filename Collision Indicator
- When multiple assets share the same filename, the extension badge shows `EXT+` (e.g., `PNG+`)
- Helps identify duplicate filenames in your asset collection

## Hotkeys & Shortcuts

### Global Hotkeys
These work throughout the Assets Manager interface:

- `Ctrl/Cmd+S`: Trigger index scan for current scope
- `D`: Toggle details sidebar for current selection
- `0`-`5`: Set rating for current selection (when interacting with grid)

### Viewer Hotkeys
These work only when the viewer is open:

- `Esc`: Close viewer
- `0`-`5`: Set rating (single view)
- `Shift+Arrow`: Step video frames (single video)
- `F`: Toggle false color analysis
- `Z`: Toggle zebra patterns
- `G`: Cycle through grid overlays (off → thirds → center → safe → golden)
- `I`: Toggle pixel probe
- `L`: Toggle loupe magnification
- `C`: Copy last probed color hex value
- `Alt+1`: Toggle 1:1 zoom

### Notes
- Hotkeys are ignored while typing in input fields
- Viewer hotkeys are captured and don't leak to ComfyUI or global handlers

## Settings & Configuration

### Browser-Based Settings
Stored in `localStorage` under `mjrSettings`:

#### Display Settings
- **Page size**: Number of assets loaded per request
- **Sidebar position**: Left or right placement
- **Hide PNG siblings**: Hide PNG files when video previews exist
- **Auto-scan**: Automatically scan on open/startup

#### Performance Settings
- **Status poll interval**: How often to check background tasks
- **Tags cache TTL**: Time-to-live for tag caching (milliseconds)

#### Viewer Settings
- **Media probe backend**: Auto, ExifTool, FFprobe, or both
- **Workflow minimap display**: Toggle elements in workflow preview
- **Observability**: Enable request logging

### Backend Configuration

#### Environment Variables
Configure the backend using environment variables:

```bash
# Override output directory
export MAJOOR_OUTPUT_DIRECTORY="/path/to/output"

# Specify tool paths if not in PATH
export MAJOOR_EXIFTOOL_PATH="/path/to/exiftool"
export MAJOOR_FFPROBE_PATH="/path/to/ffprobe"

# Set media probe backend
export MAJOOR_MEDIA_PROBE_BACKEND="auto"  # auto, exiftool, ffprobe, both

# Database tuning
export MAJOOR_DB_TIMEOUT=30.0
export MAJOOR_DB_MAX_CONNECTIONS=8
export MAJOOR_DB_QUERY_TIMEOUT=30.0

# Collection limits
export MJR_COLLECTION_MAX_ITEMS=50000

# Allow symlinks in custom roots
export MJR_ALLOW_SYMLINKS=on
```

## Troubleshooting

### Common Issues

#### Missing Dependencies
If you see warnings about missing dependencies:
1. Check that all requirements are installed: `pip install -r requirements.txt`
2. Install optional tools (ExifTool, FFprobe) for full functionality
3. Verify tools are in your system PATH or set environment variables

#### Slow Performance
- Large collections may take time to load
- Increase page size for fewer requests
- Ensure external tools (ExifTool, FFprobe) are properly installed
- Adjust database connection settings if needed

#### Index Not Updating
- Use `Ctrl/Cmd+S` to manually trigger a scan
- Check permissions on output directory

#### Metadata Extraction Issues
- Verify ExifTool and FFprobe are installed and accessible
- Check file permissions for metadata access
- Some file formats may not contain embedded metadata

### File Locations
- **Index Database**: `<output>/_mjr_index/assets.sqlite`
- **Custom Roots**: `<output>/_mjr_index/custom_roots.json`
- **Collections**: `<output>/_mjr_index/collections/*.json`
- **Temporary ZIPs**: `<output>/_mjr_batch_zips/` (auto-cleaned)

### Security Considerations
- CSRF protection on state-changing endpoints
- Rate limiting on expensive operations
- Path validation to prevent directory traversal
- Trusted proxy configuration for forwarded headers

## Best Practices

### Organization
- Use collections to group related assets
- Apply consistent tagging schemes
- Regularly rate your assets to identify quality results
- Clean up unused collections periodically

### Performance
- Keep collections reasonably sized (under 50,000 items)
- Use filters to narrow down large result sets
- Periodically optimize the database through the maintenance tools
- Monitor index size and rebuild if needed

### Workflow Integration
- Use drag-and-drop to quickly incorporate assets into workflows
- Leverage metadata to reproduce good results
- Share collections with team members
- Use the viewer to compare different generation approaches

---
*Documentation Version: 1.0*  
*Last Updated: January 2026*
