# Majoor Assets Manager - Metadata & Viewer Guide

## Overview
The Majoor Assets Manager provides comprehensive metadata extraction and an advanced viewer with powerful analysis tools. This guide covers all features related to metadata handling and the advanced viewer capabilities.

## Metadata Extraction

### Supported File Types
The system extracts metadata from various file formats:

#### Image Files
- **PNG**: Full metadata including generation parameters, workflow, and custom tags
- **JPG/JPEG**: EXIF data, camera information, and embedded generation parameters
- **WEBP**: Metadata from AI generation tools and standard EXIF data
- **TIFF**: Professional imaging metadata and generation parameters

#### Video Files
- **MP4**: Codec information, duration, frame rate, audio tracks
- **MOV**: QuickTime metadata and generation parameters
- **AVI**: Container information and basic video properties
- **MKV**: Full multimedia metadata including embedded generation data

#### Workflow Files
- **JSON**: Complete workflow definitions and node configurations
- **PNG with embedded workflows**: Extracted workflow data from image files

### Extraction Backends

#### ExifTool (Primary)
- Most comprehensive metadata extraction
- Supports hundreds of file formats
- Handles custom tags and ratings
- Provides detailed technical information

#### FFprobe (Video/Audio Focus)
- Specialized for video and audio files
- Detailed codec and stream information
- Frame-level metadata for video analysis
- Audio track information and properties

#### Built-in Extraction
- Basic metadata when external tools unavailable
- Filename and filesystem metadata
- Size, creation date, and modification time
- Format-specific basic information

### Metadata Categories

#### Generation Information
- **Prompt**: Full positive prompt used for generation
- **Negative Prompt**: Negative prompt applied during generation
- **Model**: Base model used for generation
- **Sampler**: Sampling algorithm employed
- **Steps**: Number of sampling steps
- **CFG Scale**: Classifier-Free Guidance scale value
- **Seed**: Random seed used for generation
- **Width/Height**: Output dimensions
- **Clip Skip**: CLIP model layer skipping value

#### Technical Parameters
- **Resolution**: Width and height of the generated image
- **File Size**: On-disk size of the file
- **Format**: File format and compression details
- **Color Profile**: Color space and profile information
- **Compression**: Compression algorithm and settings

#### Workflow Data
- **Node Configuration**: Complete workflow node setup
- **Connection Map**: Input/output connections between nodes
- **Parameter Values**: All node parameter settings
- **Workflow Minimap**: Visual representation of the workflow

### Video Playback

#### Controls
- **Play/Pause**: Toggle playback
- **Example Loop**: Toggle loop mode (Loop / Once / Ping-Pong)
- **Seek**: Draggable progress bar
- **Step Frame**: Next/Previous frame (Key: Left/Right arrows)
- **Speed**: Playback speed control (0.5x, 1x, 2x, etc.)

#### Hardware Acceleration (WebGL)
The viewer automatically detects WebGL support to enable GPU-accelerated video rendering.
- **Benefits**: Real-time Exposure, Gamma, and Zebra analysis on 4K videos without CPU load.
- **Fallback**: If WebGL is unavailable, it automatically switches to a robust CPU-based renderer (Canvas 2D).

### Single View Mode

#### Navigation Controls
- **Pan**: Click and drag to move around the image
- **Zoom**: Mouse wheel to zoom in/out
- **Fit to Screen**: Automatically scales image to fit window
- **Actual Size**: View image at 1:1 pixel ratio (Alt+1)

#### Image Enhancement Tools

##### Exposure Adjustment (EV)
- Adjust exposure compensation from -5 to +5 EV
- Real-time preview of exposure changes
- Useful for evaluating details in shadows/highlights
- Preserves color relationships while adjusting brightness

##### Gamma Correction
- Adjust gamma curve from 0.25 to 4.0
- Alters midtone brightness without affecting highlights/shadows as much
- Useful for fine-tuning contrast in specific tonal ranges
- Real-time application with live preview

##### Channel Isolation
- **RGB**: View all color channels combined
- **R**: View only red channel information
- **G**: View only green channel information
- **B**: View only blue channel information
- **Alpha**: View transparency/alpha channel
- **Luma**: View luminance information only

#### Analysis Tools

##### False Color Mode (F)
- Visualizes overexposed and underexposed areas
- Highlights clipped highlights (typically white/magenta)
- Shows blocked shadows (typically blue/black)
- Helps evaluate dynamic range and exposure

##### Zebra Patterns (Z)
- Displays 100% IRE (95% for Rec.2020) areas as zebra stripes
- Helps identify areas approaching clipping
- Adjustable threshold levels
- Useful for maintaining highlight detail

### Comparison Modes

#### Side-by-Side Comparison
- View two assets next to each other
- Independent zoom and pan for each image
- Synchronized zoom/pan option available
- Perfect for comparing different generation parameters

#### A/B Toggle Mode
- Quickly switch between two assets
- Single view area showing one asset at a time
- Instant toggle between assets
- Useful for subtle difference evaluation

#### Wipe Comparison (Slider)
- Overlay one image over another with adjustable slider
- Reveal one asset over another progressively
- Clear visualization of differences
- Adjustable transition line

#### Difference Mode
- Mathematical difference between two assets
- Highlights all variations between images
- Positive differences in one color, negative in another
- Excellent for identifying subtle changes

### Video Player Features

#### Playback Controls
- **Play/Pause**: Standard play/pause functionality
- **Loop/Once**: Toggle between continuous and single playback
- **Speed Control**: Adjustable playback speed (0.25x to 4x)
- **Frame Stepping**: Precise frame-by-frame navigation (Shift+Arrow keys)

#### Timeline Features
- **Seek Bar**: Drag to jump to specific points in video
- **Current Time**: Display of current playback position
- **Duration**: Total video duration display
- **Frame Counter**: Current frame number display

#### In/Out Points
- **Set In Point**: Mark start of desired segment (I key)
- **Set Out Point**: Mark end of desired segment (O key)
- **Segment Playback**: Play only the marked segment
- **Clear Points**: Remove In/Out markers

### Visual Overlays

#### Grid Overlays (G)
Cycle through different grid types:
- **Off**: No grid overlay
- **Thirds**: Rule of thirds grid lines
- **Center**: Center crosshair
- **Safe Area**: TV broadcast safe area guides
- **Golden Ratio**: Golden ratio composition guides

#### Pixel Probe (I)
- Hover to see exact pixel coordinates
- Display RGB/RGBA values at cursor position
- Hex color code display
- Luminance value information
- Copy color value to clipboard (C key)

#### Loupe Magnification (L)
- Magnified view of area around cursor
- Adjustable magnification level
- Shows fine detail at pixel level
- Helpful for quality assessment

#### Scopes
- **Histogram**: RGB histogram showing tonal distribution
- **Waveform**: Luminance waveform for exposure evaluation
- **Vectorscope**: Color information display
- Real-time updates as you pan/zoom

### Export Capabilities

#### Save Current Frame
- Capture current video frame as PNG
- Preserves full resolution and quality
- Saves to default output directory
- Includes generation metadata if available

#### Copy to Clipboard
- Copy current view to system clipboard
- Best-effort format selection
- May not work on all platforms
- Useful for quick sharing

#### Download Original
- Download the original asset file
- Maintains original format and quality
- Preserves embedded metadata
- Safe file transfer protocol

### Viewer Hotkeys
All viewer hotkeys are captured and don't affect ComfyUI or browser:

- **Esc**: Close viewer
- **0-5**: Set rating (single view)
- **Shift+Arrow**: Step video frames (single video)
- **F**: Toggle false color analysis
- **Z**: Toggle zebra patterns
- **G**: Cycle through grid overlays
- **I**: Toggle pixel probe
- **L**: Toggle loupe magnification
- **C**: Copy last probed color hex value
- **Alt+1**: Toggle 1:1 zoom

## Metadata Panel

### Generation Info Section
Detailed information about how the asset was created:

#### Prompt Information
- **Positive Prompt**: Full text of generation prompt
- **Negative Prompt**: Negative conditioning text
- **Prompt Weights**: Attention weights and emphasis
- **Prompt Scheduling**: Temporal prompt changes if applicable

#### Model & Sampling
- **Base Model**: Primary model used for generation
- **VAE**: Variational Autoencoder used for decoding
- **Sampler**: Algorithm used for denoising
- **Scheduler**: Noise schedule type
- **Steps**: Number of denoising iterations
- **CFG Scale**: Guidance strength parameter

#### Image Parameters
- **Dimensions**: Width and height of output
- **Seed**: Random seed value used
- **ControlNet**: Applied ControlNet configurations
- **LoRA**: Active LoRA models and strengths
- **T2I Adapter**: Applied adapter models

#### Technical Details
- **File Format**: Container and compression details
- **Color Space**: Working color space during generation
- **Precision**: Bit depth and floating-point precision
- **Hardware Used**: GPU/CPU information if available

### Workflow Visualization
- **Node Graph**: Visual representation of the workflow
- **Connection Lines**: Input/output relationships
- **Node Types**: Different colors for different node categories
- **Parameter Values**: Key parameters displayed on nodes
- **Zoom/Pan**: Interactive workflow exploration

### Metadata Refresh
- **Manual Refresh**: Force reload of metadata
- **Retry Failed Loads**: Attempt to recover from errors
- **Error Details**: Information about extraction failures
- **Fallback Handling**: Graceful degradation when tools unavailable

## Context Menu Actions

### Rating & Tagging
- **Rate Asset**: Assign 0-5 star rating
- **Edit Tags**: Add/remove custom tags
- **Quick Tags**: Predefined tag suggestions

### Collection Management
- **Add to Collection**: Add to existing or new collection
- **Remove from Collection**: Remove from current collection
- **Show in Collection**: Navigate to containing collection

### File Operations
- **Open in Folder**: Reveal file in system file browser
- **Copy Path**: Copy file path to clipboard
- **Rename File**: Change filename with validation
- **Delete File**: Remove file with confirmation
- **Move File**: Relocate to different directory

### Export Options
- **Save Current Frame**: Capture current view as image
- **Export Metadata**: Save metadata as JSON file
- **Share Link**: Generate shareable link if supported

## Performance Optimization

### Loading Strategies
- **Progressive Loading**: Thumbnails load first, full data follows
- **Lazy Loading**: Metadata loaded only when viewed
- **Caching**: Frequently accessed data kept in memory
- **Background Processing**: Non-critical tasks run asynchronously

### Resource Management
- **Memory Limits**: Prevents excessive memory consumption
- **Threading**: CPU-intensive tasks run on background threads
- **Timeout Handling**: Prevents hanging on problematic files
- **Error Recovery**: Graceful handling of corrupted files

## Troubleshooting

### Metadata Extraction Issues
- **Missing Tools**: Install ExifTool and FFprobe for full functionality
- **Permission Errors**: Check file permissions for metadata access
- **Corrupted Files**: Some files may have damaged metadata sections
- **Unsupported Formats**: Some proprietary formats may not extract well

### Viewer Problems
- **Slow Performance**: Large files may take time to load
- **Memory Issues**: Close other applications if experiencing problems
- **Codec Problems**: Install appropriate codecs for video files
- **Browser Compatibility**: Ensure using supported browsers

### Common Solutions
- **Refresh Index**: Use Ctrl/Cmd+S to rescan and refresh metadata
- **Clear Cache**: Clear browser cache if interface seems stuck
- **Check Logs**: Look at ComfyUI console for detailed error messages
- **Update Tools**: Ensure ExifTool and FFprobe are current versions

## Best Practices

### Metadata Management
- Regularly refresh metadata when tools are updated
- Use consistent tagging schemes for better organization
- Maintain backup copies of important metadata
- Verify metadata accuracy periodically

### Viewer Usage
- Use comparison modes for parameter evaluation
- Leverage analysis tools for quality assessment
- Take advantage of export features for sharing
- Use keyboard shortcuts for efficiency

### Performance Tips
- Close viewer tabs when not actively using them
- Use lower resolution previews when possible
- Organize assets into collections to reduce load times
- Keep frequently accessed assets in smaller collections

---
*Metadata & Viewer Guide Version: 1.0*  
*Last Updated: January 2026*