# Majoor Assets Manager - Drag & Drop Guide

## Overview
The Majoor Assets Manager provides seamless drag and drop functionality that integrates with both ComfyUI and your operating system. This guide covers all aspects of drag and drop operations within the extension.

## Drag to ComfyUI Canvas

### Basic Drag Operation
1. Select one or more assets in the Assets Manager
2. Click and hold on an asset card
3. Drag the asset onto the ComfyUI canvas
4. Release the mouse button to drop the asset

### Single Asset Drag
- Drag any single asset to the canvas
- The asset path is automatically injected into compatible nodes
- Compatible nodes include LoadImage, LoadLatent, and similar input nodes
- The asset is staged for immediate use in your workflow

### Multiple Asset Drag
- Select multiple assets using Ctrl/Cmd+click or Shift+click
- Drag any selected asset to the canvas
- Multiple file paths are handled appropriately
- Some nodes support multiple inputs, others will use the first path

### Node Compatibility
The system intelligently identifies compatible nodes:

#### Image Input Nodes
- **LoadImage**: Accepts image file paths
- **LoadImageMask**: For mask images
- **PreviewImage**: For direct preview
- **LoadLatent**: For latent files

#### Video Input Nodes
- **LoadVideo**: For video file paths
- **VideoLoad**: For various video formats

#### Workflow Input Nodes
- **LoadWorkflow**: For workflow files
- **ImportWorkflow**: For external workflow files

### Staging Mechanism
- Assets are staged temporarily when dragged to canvas
- Paths are injected into appropriate input fields
- No permanent changes to workflow until execution
- Allows for experimentation without committing to changes

## Drag to Operating System

### Single File Drag
1. Select an asset in the Assets Manager
2. Click and drag the asset outside the browser window
3. Drop onto your file explorer, desktop, or another application
4. The original file is transferred to the destination

### Multiple File Drag
1. Select multiple assets using Ctrl/Cmd+click or Shift+click
2. Drag any selected asset outside the browser window
3. A ZIP file is automatically created containing all selected assets
4. Drop the ZIP file onto your destination

### ZIP Creation Process
- ZIP files are created on-demand when dragging multiple items
- Files are streamed directly from disk (no temporary copies)
- ZIPs are flat (no directory structure maintained)
- ZIP files are automatically cleaned up after transfer

### Protocol Support
The system supports multiple drag protocols:

#### DownloadURL Protocol
- Used for single file transfers
- Direct file download to destination
- Maintains original filename and extension

#### text/uri-list Protocol
- Used for multiple file transfers
- Properly formatted URI list for operating system
- Compatible with most file managers and applications

## Drag Operations

### Starting a Drag
- Click and hold on any asset card for a moment
- A visual indicator appears showing the drag is active
- The cursor changes to indicate drag operation
- Selection remains active during drag

### Drag Indicators
- **Visual Outline**: Selected assets show a highlighted border
- **Cursor Change**: Cursor changes to indicate drag capability
- **Preview**: Small preview of dragged asset(s) follows cursor
- **Count Display**: For multiple selections, shows number of items

### Drag Targets
The system recognizes different drag targets:

#### Valid Targets
- ComfyUI canvas area
- Compatible input nodes
- Browser address bar (downloads)
- File explorer windows
- Desktop
- Email attachments
- Other applications accepting files

#### Invalid Targets
- Text input fields (unless specifically designed for file drops)
- Non-compatible areas of the interface
- Applications that don't accept the file type

## File Transfer Mechanisms

### Direct File Transfer
- Single files are transferred directly
- Maintains original file properties
- Preserves embedded metadata
- No quality loss during transfer

### Batch ZIP Transfer
- Multiple files are packaged into a ZIP archive
- ZIP created dynamically during drag operation
- No temporary files written to disk
- Automatic cleanup after transfer completion

### Streaming Transfer
- Files are streamed directly from disk
- No intermediate copies created
- Memory efficient for large files
- Maintains file integrity during transfer

## Filename Collision Indicator

### Understanding the Indicator
- When multiple assets share the same filename, the extension badge shows `EXT+`
- For example: `image.png` becomes `PNG+` when duplicates exist
- Helps identify potential conflicts during drag operations

### Handling Collisions
- Collisions don't prevent drag operations
- ZIP files handle duplicate names automatically
- Individual file drops may require manual renaming
- Consider renaming files to avoid confusion

## Drag Performance

### Optimizations
- Lightweight preview during drag
- Asynchronous file operations
- Memory-efficient streaming
- Responsive interface during drag operations

### Performance Considerations
- Large files may take time to initiate transfer
- Multiple large files in ZIP may take longer to create
- Network drives may affect performance
- System resources impact drag responsiveness

## Advanced Drag Features

### Drag Preview
- Live preview of dragged assets
- Shows thumbnail of the primary dragged item
- Displays count for multiple selections
- Updates in real-time during drag

### Drag Validation
- Validates target compatibility before allowing drop
- Provides visual feedback for valid/invalid targets
- Prevents invalid operations
- Shows appropriate cursors for different states

### Drag Cancellation
- Cancel drag by releasing over invalid target
- Escape key cancels active drag operation
- Clicking elsewhere cancels drag
- Drag automatically cancels if window loses focus

## Integration with Other Features

### Selection Integration
- Drag operations work with current selection
- Multiple selections enable batch operations
- Selection filters apply to drag operations
- Search results can be dragged directly

### Collection Integration
- Assets from collections can be dragged normally
- Entire collections can be exported via drag
- Collection organization preserved in transfers
- Cross-collection drags work seamlessly

### Rating/Tag Integration
- Rated and tagged assets maintain metadata during drag
- Tags and ratings preserved in file transfers (when supported)
- Filtered views can be dragged directly
- Quality indicators visible during drag

## Troubleshooting

### Common Drag Issues

#### Drag Not Initiating
- Ensure you're clicking and holding long enough
- Check that the asset is properly selected
- Verify no JavaScript errors in console
- Try refreshing the Assets Manager

#### Drag Target Not Recognized
- Ensure target application accepts file drops
- Check if target area is actually droppable
- Verify file type compatibility with target
- Try dragging to a different application

#### ZIP Creation Failure
- Check available disk space
- Verify write permissions to temporary directory
- Ensure no antivirus interference
- Try dragging fewer files at once

#### File Transfer Problems
- Large files may timeout during transfer
- Network drives may cause delays
- Antivirus software may interfere
- Check file permissions at destination

### Browser-Specific Issues

#### Chrome/Chromium
- May require specific security settings for file downloads
- Extensions might interfere with drag operations
- Incognito mode may behave differently

#### Firefox
- Security settings may restrict file operations
- Enhanced Tracking Protection might interfere
- Check privacy settings for file handling

#### Safari
- May require additional permissions for file access
- Security restrictions could limit functionality
- Check website permissions for file handling

### Operating System Issues

#### Windows
- UAC (User Account Control) may interfere
- Antivirus software may block operations
- File permissions may restrict transfers

#### macOS
- Gatekeeper may restrict file operations
- Privacy settings may limit access
- Sandboxing could affect functionality

#### Linux
- File permissions are strictly enforced
- Desktop environment may affect drag behavior
- Security modules might restrict operations

## Security Considerations

### File Access Security
- Drag operations respect file system permissions
- No files can be accessed that the user can't read
- Temporary files are created with restricted permissions
- ZIP files are cleaned up automatically

### Cross-Origin Security
- Drag operations confined to same origin
- No cross-site data leakage possible
- File system access limited to allowed directories
- Path validation prevents directory traversal

### Malicious File Protection
- No automatic execution of dragged files
- Files transferred in their original form
- No modification during drag operations
- Integrity preserved throughout transfer

## Performance Optimization

### Large File Handling
- Stream large files instead of loading entirely
- Progress indicators for long operations
- Asynchronous operations to maintain interface responsiveness
- Memory management for multiple large files

### Multiple File Optimization
- Efficient ZIP creation algorithms
- Parallel processing where possible
- Memory buffering for optimal performance
- Cleanup operations scheduled appropriately

### Interface Responsiveness
- Drag operations don't block UI thread
- Smooth animations during drag
- Immediate feedback for user actions
- Graceful degradation for slower systems

## Best Practices

### Efficient Drag Operations
- Use multiple selection for batch operations
- Organize assets in collections for easier access
- Use search and filters to find assets quickly
- Verify target compatibility before initiating drag

### File Organization
- Maintain consistent naming conventions
- Use collections to group related assets
- Apply tags for easy retrieval
- Regular cleanup of unused assets

### Workflow Integration
- Use drag operations to accelerate workflow creation
- Stage frequently used assets in collections
- Leverage drag to canvas for rapid prototyping
- Combine with other Assets Manager features

### Performance Tips
- Close unnecessary browser tabs during large operations
- Ensure sufficient system resources
- Use wired connections for network drives
- Regular maintenance of index database

## Advanced Usage

### Scripted Operations
- Combine drag operations with automation scripts
- Use collections for automated workflows
- Integrate with external tools via file operations
- Batch processing using drag interfaces

### Power User Techniques
- Master keyboard shortcuts with drag operations
- Use multiple monitors for efficient transfers
- Leverage search and filters for precise selection
- Combine collections with drag for complex operations

---
*Drag & Drop Guide Version: 1.0*  
*Last Updated: January 2026*