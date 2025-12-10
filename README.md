# 📂 Majoor Asset Manager for ComfyUI

**A fast, modern, and robust media manager for ComfyUI with native OS metadata integration.**

Majoor Asset Manager is a custom node extension designed to browse, inspect, and organize your generated images, videos, and audio files without leaving the ComfyUI interface.

Unlike other file managers, **it runs asynchronously** (no freezing during scans) and **writes ratings/tags directly to your files' Windows properties** (via Exif/OS shell), ensuring your organization survives outside of ComfyUI.

---

## ✨ Key Features

### 🚀 High Performance
- **Async Backend:** Scanning folders happens in a separate thread. It won't block your ComfyUI queue or freeze the interface, even with thousands of files.
- **Lazy Loading:** Metadata (stars, tags, prompt info) is loaded only for visible items, ensuring smooth scrolling.

### 🌟 Native Metadata Integration (Windows)
- **Persistent Ratings:** Rate files (1-5 stars) directly in the UI.
- **System-Level Tags:** Add tags that are written to the file's properties.
- **Portable:** Ratings and tags are visible in Windows Explorer. If you move the file, the rating moves with it.
- *Note: On Linux/Mac, it falls back to Sidecar JSON files or ExifTool if installed.*

### 🔍 Advanced Inspection
- **Workflow & Prompts:** View positive/negative prompts, seed, sampler, CFG, model, and LoRAs.
- **Deep Parsing:** Supports complex workflows (Flux, WanVideo, etc.).
- **A/B Comparison:** Select two files to compare them side-by-side with a sliding splitter and synchronized zoom/pan.

### 🎥 Smart "Sibling" Support
- Automatically detects "sibling" files.
- **Example:** If you have `video.mp4` and `video.png`, dragging the video into the workflow will load the workflow from the PNG.
- Supports Audio and 3D models preview.

### ⌨️ Productivity Focused
- **Hotkeys:** Press `1`-`5` to rate, `0` to clear. `Enter` to open viewer.
- **Drag & Drop:** Drag images directly into ComfyUI nodes to load their workflow.
- **Context Menu:** Right-click to "Open in Explorer".

---

## 📥 Installation

### Method 1: Via ComfyUI Manager (Recommended)
1. Open **ComfyUI Manager**.
2. Click **"Install via Git URL"**.
3. Paste the repository URL: `https://github.com/YOUR_USERNAME/ComfyUI-Majoor-FileManager`
4. Click **Install** and Restart ComfyUI.

### Method 2: Manual Installation
1. Navigate to your ComfyUI `custom_nodes` folder:
   ```bash
   cd ComfyUI/custom_nodes/
