# Majoor Assets Manager - Installation Guide

## Overview
This guide provides detailed instructions for installing and configuring the Majoor Assets Manager for ComfyUI. Follow these steps to get the extension up and running with all its features.

## Prerequisites

### System Requirements
- ComfyUI installation
- Python 3.8 or higher
- At least 500MB free disk space for the extension and dependencies
- Administrator privileges (for installation and optional tool installations)

### Supported Platforms
- Windows 10/11
- macOS 10.15 or higher
- Linux (Ubuntu 20.04+, Debian 11+, or equivalent)

## Quick Installation (Recommended)

### Using ComfyUI Manager
1. Open ComfyUI Manager in your browser
2. Find "Majoor Assets Manager" in the extensions list
3. Click "Install" next to the extension
4. Wait for the installation to complete
5. Restart ComfyUI completely
6. The extension should now be available in the Assets Manager tab

## Manual Installation

### Step 1: Clone the Repository
Open your terminal/command prompt and navigate to your ComfyUI custom_nodes directory:

```bash
cd /path/to/your/ComfyUI/custom_nodes
```

Clone the repository:

```bash
git clone https://github.com/MajoorWaldi/ComfyUI-Majoor-AssetsManager ComfyUI-Majoor-AssetsManager
```

### Step 2: Install Python Dependencies
Navigate to the extension directory and install the required packages:

```bash
cd ComfyUI-Majoor-AssetsManager
pip install -r requirements.txt
```

### Step 3: Restart ComfyUI
Stop your ComfyUI server completely and restart it to load the new extension.

## Optional Dependencies (Highly Recommended)

For full functionality including metadata extraction and file tagging, install these external tools:

### Windows Installation

#### Option A: Using Scoop Package Manager
1. Install Scoop if you don't have it:
   ```powershell
   Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
   irm get.scoop.sh | iex
   ```

2. Install the required tools:
   ```powershell
   scoop install ffmpeg exiftool
   ```

#### Option B: Using Chocolatey Package Manager
1. Install Chocolatey if you don't have it:
   ```powershell
   Set-ExecutionPolicy Bypass -Scope Process -Force
   [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
   iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
   ```

2. Install the required tools:
   ```powershell
   choco install -y ffmpeg exiftool
   ```

#### Option C: Using WinGet
```powershell
winget install -e --id Gyan.FFmpeg
winget install -e --id PhilHarvey.ExifTool
```

#### Option D: Manual Installation
1. **FFmpeg**: Download from https://www.gyan.dev/ffmpeg/builds/
   - Extract to a folder (e.g., `C:\ffmpeg`)
   - Add `C:\ffmpeg\bin` to your system PATH

2. **ExifTool**: Download from https://exiftool.org/
   - Download `exiftool-#.##.zip`
   - Extract to a folder (e.g., `C:\exiftool`)
   - Add `C:\exiftool` to your system PATH

### macOS Installation

#### Using Homebrew (Recommended)
1. Install Homebrew if you don't have it:
   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```

2. Install the required tools:
   ```bash
   brew install ffmpeg exiftool
   ```

### Linux Installation

#### Ubuntu/Debian
```bash
sudo apt update
sudo apt install -y ffmpeg libimage-exiftool-perl
```

#### Fedora/RHEL
```bash
sudo dnf install -y ffmpeg perl-Image-ExifTool
```

#### Arch Linux
```bash
sudo pacman -S ffmpeg exiftool
```

## Verification Steps

After installation, verify everything is working:

### Step 1: Check Extension Loading
1. Start ComfyUI
2. Look for the Assets Manager tab in the interface
3. Check the console/logs for any error messages during startup

### Step 2: Verify External Tools (if installed)
Open a terminal/command prompt and run:

```bash
exiftool -ver
ffprobe -version
```

Both commands should return version information without errors.

### Step 3: Test Basic Functionality
1. Open the Assets Manager in ComfyUI
2. Switch between different scopes (Outputs, Inputs, Custom, Collections)
3. Perform a simple search to verify indexing is working
4. Try opening the viewer for an asset

## Configuration

### Environment Variables
You can configure the extension using environment variables. Add these to your shell profile or set them before starting ComfyUI:

```bash
# Override default output directory
export MAJOOR_OUTPUT_DIRECTORY="/path/to/your/output"

# Specify tool paths if not in system PATH
export MAJOOR_EXIFTOOL_PATH="/path/to/exiftool"
export MAJOOR_FFPROBE_PATH="/path/to/ffprobe"

# Set media probe backend (auto, exiftool, ffprobe, both)
export MAJOOR_MEDIA_PROBE_BACKEND="auto"

```

### Windows Batch File Example
Create a batch file to set environment variables and start ComfyUI:

```batch
@echo off
set MAJOOR_MEDIA_PROBE_BACKEND=auto

REM Start ComfyUI with the environment variables
cd /d "C:\path\to\ComfyUI"
python main.py --auto-launch
pause
```

## Troubleshooting

### Extension Not Appearing
- Verify the folder is named correctly: `ComfyUI-Majoor-AssetsManager`
- Check that all files were downloaded properly
- Ensure ComfyUI was restarted after installation
- Look for error messages in the ComfyUI console

### Missing Dependencies Error
If you see messages about missing dependencies:
```bash
# Navigate to the extension directory
cd ComfyUI-Majoor-AssetsManager
pip install -r requirements.txt
```

### External Tools Not Found
If metadata extraction isn't working:
1. Verify tools are installed: `exiftool -ver` and `ffprobe -version`
2. Check if tools are in your system PATH
3. Set environment variables to point to the executables directly

### Permission Errors
- Ensure ComfyUI has read/write access to the output directory
- On Windows, run as administrator if needed
- On Unix systems, check file permissions with `ls -la`

### Slow Performance
- The first scan may take time for large directories
- Subsequent scans will be faster due to incremental indexing
- Consider excluding very large directories that don't contain relevant assets

## Post-Installation Setup

### First-Time Usage
1. Open ComfyUI and navigate to the Assets Manager tab
2. The extension will automatically begin indexing your output directory
3. Wait for the initial scan to complete (progress shown in status bar)
4. Use the search bar to find assets
5. Right-click on assets to access context menus

### Adding Custom Directories
1. Right-click in the Assets Manager interface
2. Select "Add Custom Root" 
3. Enter the path to your custom directory
4. The directory will be added to the Custom scope

### Creating Your First Collection
1. Select one or more assets
2. Right-click and choose "Add to Collection"
3. Create a new collection or add to an existing one
4. Access your collections from the Collections tab

## Updates

### Using ComfyUI Manager
Updates will be available through the ComfyUI Manager interface when released.

### Manual Updates
```bash
cd ComfyUI/custom_nodes/ComfyUI-Majoor-AssetsManager
git pull origin main
pip install -r requirements.txt --upgrade
```

Remember to restart ComfyUI after updating.

## Uninstallation

### Using ComfyUI Manager
Simply click "Uninstall" in the ComfyUI Manager interface.

### Manual Removal
1. Delete the `ComfyUI-Majoor-AssetsManager` folder from `custom_nodes`
2. Restart ComfyUI
3. The extension will be completely removed

---
*Installation Guide Version: 1.0*  
*Last Updated: January 2026*
