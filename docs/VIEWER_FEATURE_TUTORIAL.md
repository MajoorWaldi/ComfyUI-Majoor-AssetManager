# Majoor Assets Manager - Viewer Feature Tutorial

## Overview
The advanced viewer provides powerful tools for examining, enhancing, and analyzing your assets. It supports various file types including images and videos, with specialized tools for each format.

## Opening the Viewer

### Methods to Open
There are several ways to open the viewer:

1. **Double-click Method**:
   - Double-click any asset in the grid view
   - Opens the asset with adjacent assets available for navigation

2. **Context Menu Method**:
   - Right-click on an asset
   - Select "Open in Viewer" from the context menu

3. **Keyboard Method**:
   - Select an asset in the grid
   - Press Enter to open in viewer

### Viewer Layout
The viewer consists of:
- **Main View Area**: Displays the selected asset
- **Toolbar**: Contains viewing and analysis tools
- **Sidebar**: Shows metadata and generation info
- **Navigation Controls**: Move between assets in the current set

## Viewer Navigation

### Basic Navigation
- **Zoom**: Use mouse wheel to zoom in/out
- **Pan**: Click and drag to move around the image
- **Fit to Screen**: Automatically scales image to fit window
- **Actual Size**: View image at 1:1 pixel ratio (Alt+1)

### Asset Navigation
- **Next/Previous**: Navigate between assets in the current set
- **Keyboard Arrows**: Use arrow keys to move between assets
- **Direct Selection**: Click on thumbnails if available

## Image Enhancement Tools

### Exposure Adjustment (EV)
The exposure adjustment tool allows you to modify the brightness of your image:

1. **Accessing the Tool**:
   - Locate the exposure control in the toolbar
   - Usually represented by a sun or EV icon

2. **Adjusting Exposure**:
   - Adjust exposure compensation from -5 to +5 EV
   - Real-time preview shows changes immediately
   - Use to evaluate details in shadows/highlights
   - Preserves color relationships while adjusting brightness

3. **Use Cases**:
   - Revealing details in underexposed areas
   - Recovering highlights in overexposed regions
   - Comparing exposure differences between assets
   - Evaluating dynamic range

### Gamma Correction
Gamma correction adjusts the midtone brightness:

1. **Accessing the Tool**:
   - Find the gamma control in the toolbar
   - Usually labeled with γ or gamma symbol

2. **Adjusting Gamma**:
   - Adjust gamma curve from 0.25 to 4.0
   - Alters midtone brightness without affecting highlights/shadows as much
   - Real-time application with live preview
   - Useful for fine-tuning contrast in specific tonal ranges

3. **Use Cases**:
   - Enhancing midtone contrast
   - Adjusting overall tonal balance
   - Fine-tuning for display characteristics
   - Preparing for different output conditions

### Channel Isolation
The viewer allows you to isolate different color channels:

1. **Available Channels**:
   - **RGB**: View all color channels combined
   - **R**: View only red channel information
   - **G**: View only green channel information
   - **B**: View only blue channel information
   - **Alpha**: View transparency/alpha channel
   - **Luma**: View luminance information only

2. **Using Channel Isolation**:
   - Select the desired channel from the toolbar
   - Observe the isolated channel information
   - Compare between different channels
   - Identify channel-specific issues

3. **Use Cases**:
   - Identifying color channel imbalances
   - Detecting channel-specific noise
   - Analyzing alpha channel transparency
   - Evaluating luminance distribution

## Analysis Tools

### False Color Mode
False color mode helps identify exposure issues:

1. **Activating False Color**:
   - Enable false color mode from the toolbar
   - Usually represented by a color palette icon

2. **Interpreting Results**:
   - Identifies overexposed and underexposed areas
   - Highlights clipped highlights (typically white/magenta)
   - Shows blocked shadows (typically blue/black)
   - Helps evaluate dynamic range and exposure

3. **Use Cases**:
   - Checking for highlight clipping
   - Identifying shadow detail loss
   - Evaluating overall exposure balance
   - Comparing exposure between different assets

### Zebra Patterns (Z)
Zebra patterns indicate areas approaching clipping:

1. **Enabling Zebra**:
   - Activate zebra patterns from the toolbar
   - Usually labeled with "Z" or zebra icon

2. **Understanding Zebra**:
   - Displays 100% IRE (95% for Rec.2020) areas as zebra stripes
   - Helps identify areas approaching clipping
   - Adjustable threshold levels
   - Useful for maintaining highlight detail

3. **Use Cases**:
   - Protecting highlight detail
   - Setting optimal exposure levels
   - Comparing exposure between shots
   - Quality control for consistent exposure

## Visual Overlays

### Grid Overlays (G)
Grid overlays assist with composition:

1. **Available Grid Types**:
   - **Off**: No grid overlay
   - **Thirds**: Rule of thirds grid lines
   - **Center**: Center crosshair
   - **Safe Area**: TV broadcast safe area guides
   - **Golden Ratio**: Golden ratio composition guides

2. **Using Grid Overlays**:
   - Cycle through grid types using "G" key
   - Assess compositional balance
   - Align elements to grid lines
   - Compare compositions between assets

3. **Use Cases**:
   - Composition analysis
   - Alignment verification
   - Rule of thirds evaluation
   - Broadcast compliance checking

### Pixel Probe (I)
Pixel probe provides detailed pixel information:

1. **Activating Pixel Probe**:
   - Enable pixel probe from toolbar or press "I"
   - Hover over image to see information

2. **Information Provided**:
   - Exact pixel coordinates
   - RGB/RGBA values at cursor position
   - Hex color code
   - Luminance value information

3. **Use Cases**:
   - Color accuracy verification
   - Detail inspection
   - Color sampling
   - Quality assessment at pixel level

### Loupe Magnification (L)
Loupe provides magnified view of specific areas:

1. **Using Loupe**:
   - Activate loupe from toolbar or press "L"
   - Hover over area of interest
   - View magnified representation

2. **Features**:
   - Adjustable magnification level
   - Shows fine detail at pixel level
   - Helpful for quality assessment
   - Real-time magnification

3. **Use Cases**:
   - Quality inspection
   - Artifact detection
   - Detail analysis
   - Sharpness evaluation

## Professional Analysis Tools (Scopes)

### Histogram
The histogram shows tonal distribution:

1. **Accessing Histogram**:
   - Enable from scopes section
   - Shows RGB channel distribution

2. **Interpretation**:
   - X-axis represents tonal range (shadows to highlights)
   - Y-axis represents pixel count
   - Separate curves for R, G, B channels
   - Identifies tonal distribution patterns

3. **Use Cases**:
   - Exposure evaluation
   - Contrast analysis
   - Color balance assessment
   - Dynamic range evaluation

### Waveform
The waveform shows luminance distribution:

1. **Accessing Waveform**:
   - Enable from scopes section
   - Shows luminance across image

2. **Interpretation**:
   - Horizontal axis represents image width
   - Vertical axis represents luminance levels
   - Brighter areas appear higher in the display
   - Darker areas appear lower in the display

3. **Use Cases**:
   - Exposure evaluation
   - Luminance distribution analysis
   - Highlight/shadow placement
   - Consistency checking

### Vectorscope
The vectorscope shows color information:

1. **Accessing Vectorscope**:
   - Enable from scopes section
   - Shows color information in chromaticity diagram

2. **Interpretation**:
   - Shows color saturation and hue
   - Identifies color distribution
   - Reveals color casts or imbalances
   - Shows skin tone placement

3. **Use Cases**:
   - Color balance correction
   - Skin tone evaluation
   - Saturation assessment
   - Color cast identification

## Video-Specific Features

### Video Playback Controls
- **Play/Pause**: Standard play/pause functionality
- **Loop/Once**: Toggle between continuous and single playback
- **Speed Control**: Adjustable playback speed (0.25x to 4x)
- **Frame Stepping**: Precise frame-by-frame navigation (Left/Right Arrow keys when player bar is focused)

### Timeline Features
- **Seek Bar**: Drag to jump to specific points in video
- **Current Time**: Display of current playback position
- **Duration**: Total video duration display
- **Frame Counter**: Current frame number display

### In/Out Points
- **Set In Point**: Mark start of desired segment (I key)
- **Set Out Point**: Mark end of desired segment (O key)
- **Segment Playback**: Play only the marked segment
- **Clear Points**: Remove In/Out markers

### Hardware Acceleration (WebGL)
The viewer automatically detects WebGL support to enable GPU-accelerated video rendering:
- **Benefits**: Real-time Exposure, Gamma, and Zebra analysis on 4K videos without CPU load
- **Fallback**: If WebGL is unavailable, it automatically switches to a robust CPU-based renderer (Canvas 2D)

## Export Capabilities

### Save Current Frame
- Capture current video frame as PNG
- Preserves full resolution and quality
- Saves to default output directory
- Includes generation metadata if available

### Copy to Clipboard
- Copy current view to system clipboard
- Best-effort format selection
- May not work on all platforms
- Useful for quick sharing

### Download Original
- Download the original asset file
- Maintains original format and quality
- Preserves embedded metadata
- Safe file transfer protocol

## Viewer Hotkeys
All viewer hotkeys are captured and don't affect ComfyUI or browser:

- **Esc**: Close viewer
- **0-5**: Set rating (single view)
- **Left/Right Arrow**: Step video frames (when player bar is focused)
- **F**: Toggle fullscreen
- **Z**: Toggle zebra patterns
- **G**: Cycle through grid overlays
- **I**: Toggle pixel probe
- **L**: Toggle loupe magnification
- **C**: Copy last probed color hex value
- **Alt+1**: Toggle 1:1 zoom

## Comparison Integration
The viewer seamlessly integrates with the comparison feature:
- Switch between single view and comparison modes
- Maintain analysis tools during comparison
- Apply enhancements to both compared assets
- Use analysis tools on comparison results

## Troubleshooting Viewer Issues

### Performance Problems
- **Slow Rendering**: Reduce enhancement effects or close other applications
- **Memory Issues**: Close viewer tabs when not actively using them
- **Codec Problems**: Install appropriate codecs for video files
- **Browser Compatibility**: Ensure using supported browsers

### Tool Malfunctions
- **Missing Tools**: Verify WebGL support in your browser
- **Unresponsive Controls**: Refresh the viewer or browser
- **Display Issues**: Check browser zoom level and display settings
- **Audio Problems**: Check system audio settings for video files

### File-Specific Issues
- **Unsupported Formats**: Convert to supported formats if needed
- **Corrupted Files**: Verify file integrity
- **Large Files**: Be patient with initial loading of large files
- **Network Issues**: Ensure stable connection for remote files

## Best Practices

### Efficient Viewing
- Use keyboard shortcuts for faster navigation
- Apply analysis tools systematically
- Take advantage of export features for sharing
- Use comparison modes for parameter evaluation

### Quality Assessment
- Use pixel probe for detailed inspection
- Apply false color to check exposure
- Use zebra patterns to protect highlights
- Employ scopes for professional analysis

### Workflow Integration
- Combine viewer tools with rating system
- Use export features for review workflows
- Integrate with collection management
- Apply consistent analysis methodology

### Performance Optimization
- Close viewers when not actively using them
- Use lower resolution previews when possible
- Organize assets into collections to reduce load times
- Keep frequently accessed assets in smaller collections

---
*Viewer Feature Tutorial Version: 1.0*
*Last Updated: February 2026*