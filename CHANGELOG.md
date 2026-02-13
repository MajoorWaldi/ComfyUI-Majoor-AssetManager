# Changelog

All notable changes to this project are documented in this file.

## [2.3.3] - 2026-02-13
### Added / Improved
- Enhanced metadata extraction for the AC-Step (Ace Step) custom node.
- Drag & Drop: stage dropped audio files to the node input (audio file staging).
- Added new filtering/sorting capabilities:
  - Filter by workflow type (I2I, I2V, T2I, T2V, V2V, FLF, UPSCL, INPT, TTS, A2A).
  - Filter by file size (weight).
  - Filter by image resolution/size.
- Added a settings option to configure the output path directly from the UI.
- Added grid settings to configure video preview behavior.
- Refactored frontend/backend integration paths for better ComfyUI compatibility.
### Fixed
- Fixed drag & drop issues for images and videos.
- Enhanced index status functionality and various bug fixes.
- Fixed multiple UI/filtering issues and improved overall stability.

---

## [2.3.2] - 2026-02-09
### Added / Improved
- Added language support for Chinese, Korean, Russian, Hindi, Spanish, French, and English. 🌍
- Added audio support for workflows such as AC-STEP, Stable Audio, and TTS. 🎵
- Improved metadata extraction. 🧠
- Improved UI design. 🎨
- Added database management. 🗄️

### Fixed
- Fixed multiple bugs across the extension. 🐛

---

## [2.3.1] - 2026-02-07
### Added / Improved
- UI parameters for **API token** and remote access: added settings in the UI to configure an API token and enable remote access to the Assets Manager (secure-by-default). 🔐

### Notes
- This is a non-breaking, minor patch focused on remote access configuration and UI exposure of token settings.

---

## [2.3.0] - 2026-02-07
### Added / Improved
- Improved GenInfo display in the Viewer: side-by-side generation info panel and clearer parameter presentation. 🔧
- Improved metadata parsing for complex workflows (better handling for nested/custom node graphs). 🧩
- Viewer enhancements: side-by-side generation info and better workflow minimap rendering. 👀
- Added "Reset Index" action to re-scan and rebuild the index. ✅
- Configurable settings for card display and grid layout (card size, density, details). ⚙️

### Fixed
- Multiple bug fixes across indexing, metadata parsing, and viewer interactions. 🐛

---

For previous history, see earlier tags/releases on GitHub.
