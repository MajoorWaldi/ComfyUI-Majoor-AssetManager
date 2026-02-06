# Majoor Assets Manager - Settings & Configuration Guide

## Overview
The Majoor Assets Manager offers extensive configuration options to customize the interface, performance, and functionality to match your workflow. This guide covers all available settings and configuration options.

## Browser-Based Settings

### Storage Location
Browser-based settings are stored in `localStorage` under the `mjrSettings` key:
- Settings persist between browser sessions
- Settings are specific to each browser/computer
- Settings don't sync across different browsers or devices
- Settings are tied to the specific domain where ComfyUI is hosted

### Accessing Settings
Settings are primarily adjusted through the user interface:
1. Open the Assets Manager in ComfyUI
2. Look for settings icons or configuration panels
3. Adjust settings as needed
4. Settings are saved automatically

## Display Settings

### Page Size
- **Purpose**: Controls how many assets are loaded per request
- **Default**: Usually 50-100 assets per page
- **Range**: Typically 10-500 assets per page
- **Impact**: Larger pages mean fewer requests but more memory usage
- **Recommendation**: Adjust based on your system resources and usage patterns

### Sidebar Position
- **Options**: Left or Right
- **Default**: Usually Right
- **Purpose**: Controls where the details sidebar appears
- **Impact**: Affects layout and workflow depending on screen orientation
- **Recommendation**: Choose based on your screen setup and preferences

### Hide PNG Siblings
- **Purpose**: Hide PNG files when video previews exist
- **Default**: Usually Off/Disabled
- **Function**: Reduces clutter from duplicate content in different formats
- **Impact**: Cleaner interface when working with video generations that include PNG previews
- **Recommendation**: Enable if you frequently work with video generations

## Performance Settings

### Auto-Scan on Startup
- **Auto-scan on Startup**: Automatically scan when ComfyUI starts
- **Default**: Usually Disabled to save resources
- **Impact**: Ensures fresh index but uses system resources
- **Recommendation**: Enable for frequently updated directories

### Status Poll Interval
- **Purpose**: How often to check background tasks and status
- **Default**: Usually 1-5 seconds
- **Range**: 0.5-30 seconds
- **Impact**: More frequent polling provides more responsive status updates but uses more resources
- **Recommendation**: 1-2 seconds for good balance of responsiveness and resource usage

### Tags Cache TTL
- **Purpose**: Time-to-live for tag caching in milliseconds
- **Default**: Usually 30,000ms (30 seconds)
- **Range**: 1,000ms to 300,000ms (1 second to 5 minutes)
- **Impact**: Longer TTL means fewer requests but potentially stale data
- **Recommendation**: 30,000ms (30 seconds) for good balance

## Metadata & Viewer Settings

### Media Probe Backend
- **Auto**: Automatically choose the best available backend
- **ExifTool**: Use ExifTool exclusively for metadata extraction
- **FFprobe**: Use FFprobe exclusively (especially for video)
- **Both**: Use both tools when available
- **Default**: Auto
- **Impact**: Affects metadata extraction speed and completeness
- **Recommendation**: Keep as Auto unless troubleshooting specific issues

### Workflow Minimap Display
- **Show Node Labels**: Display text labels on workflow minimap
- **Show Connection Lines**: Display connections between nodes
- **Show Parameter Values**: Display parameter values on nodes
- **Minimap Size**: Adjust the size of the workflow minimap
- **Default**: Varies by preference
- **Impact**: Affects readability of workflow previews
- **Recommendation**: Enable based on your need for workflow detail

### Observability
- **Request Logging**: Enable detailed logging of API requests
- **Performance Metrics**: Track timing and performance data
- **Debug Information**: Enable additional debugging output
- **Default**: Usually Disabled
- **Impact**: Provides detailed information for troubleshooting but increases log volume
- **Recommendation**: Enable only when troubleshooting issues

## File System Settings

### Custom Roots
- **Adding Custom Directories**: Add additional directories to browse
- **Path Validation**: Ensures paths are valid and accessible
- **Symlink Support**: Allow symbolic links in custom roots (if enabled)
- **Access Permissions**: Respects file system permissions
- **Default**: None initially
- **Impact**: Expands browsing capabilities beyond standard directories
- **Recommendation**: Add directories you frequently access

## Database Settings

### Connection Management
- **Max Connections**: Maximum simultaneous database connections
- **Connection Timeout**: Time to wait for database operations
- **Query Timeout**: Maximum time for individual queries
- **Default**: Usually 8 connections, 30-second timeouts
- **Impact**: Affects performance with concurrent operations
- **Recommendation**: Adjust based on system resources and usage patterns

### Optimization
- **Auto-Optimize**: Automatically optimize database periodically
- **Manual Optimization**: Run optimization tools manually
- **Maintenance Schedule**: When optimization occurs
- **Default**: Usually Manual
- **Impact**: Improves performance but requires temporary locking
- **Recommendation**: Schedule during low-usage periods

## Advanced Configuration

### Environment Variables (Backend)

#### Directory Configuration
- **MAJOOR_OUTPUT_DIRECTORY**: Override default output directory
  - Default: ComfyUI's output directory
  - Format: Full path to directory
  - Impact: Changes where the indexer looks for assets
  - Example: `MAJOOR_OUTPUT_DIRECTORY=/path/to/my/output`

#### External Tool Paths
- **MAJOOR_EXIFTOOL_PATH** / **MAJOOR_EXIFTOOL_BIN**: Path to ExifTool executable
  - Default: `exiftool` (assumes in PATH)
  - Format: Full path to exiftool executable
  - Impact: Used for metadata extraction and file tagging
  - Example: `MAJOOR_EXIFTOOL_PATH=/usr/local/bin/exiftool`

- **MAJOOR_FFPROBE_PATH** / **MAJOOR_FFPROBE_BIN**: Path to FFprobe executable
  - Default: `ffprobe` (assumes in PATH)
  - Format: Full path to ffprobe executable
  - Impact: Used for video/audio metadata extraction
  - Example: `MAJOOR_FFPROBE_PATH=/usr/local/bin/ffprobe`

#### Media Processing
- **MAJOOR_MEDIA_PROBE_BACKEND**: Media extraction backend selection
  - Options: `auto`, `exiftool`, `ffprobe`, `both`
  - Default: `auto`
  - Impact: Determines which tools are used for metadata extraction
  - Example: `MAJOOR_MEDIA_PROBE_BACKEND=both`

#### Database Tuning
- **MAJOOR_DB_TIMEOUT**: Database operation timeout in seconds
  - Default: 30.0
  - Range: 1.0 to 300.0
  - Impact: Maximum time to wait for database operations
  - Example: `MAJOOR_DB_TIMEOUT=60.0`

- **MAJOOR_DB_MAX_CONNECTIONS**: Maximum database connections
  - Default: 8
  - Range: 1 to 50
  - Impact: Concurrency level for database operations
  - Example: `MAJOOR_DB_MAX_CONNECTIONS=12`

- **MAJOOR_DB_QUERY_TIMEOUT**: Maximum query execution time
  - Default: 30.0 seconds
  - Range: 1.0 to 300.0
  - Impact: Prevents long-running queries from blocking
  - Example: `MAJOOR_DB_QUERY_TIMEOUT=45.0`

#### Performance Tuning
- **MAJOOR_TO_THREAD_TIMEOUT**: Timeout for background thread operations
  - Default: 30 seconds
  - Range: 10 to 600 seconds
  - Impact: Maximum time for background operations
  - Example: `MAJOOR_TO_THREAD_TIMEOUT=60`

- **MAJOOR_MAX_METADATA_JSON_BYTES**: Maximum metadata JSON size
  - Default: 2097152 (2MB)
  - Range: 1024 to 104857600 (100MB)
  - Impact: Limits memory usage for metadata storage
  - Example: `MAJOOR_MAX_METADATA_JSON_BYTES=4194304`

#### Collection Management
- **MJR_COLLECTION_MAX_ITEMS**: Maximum items per collection
  - Default: 50000
  - Range: 1000 to 1000000
  - Impact: Prevents extremely large collections from impacting performance
  - Example: `MJR_COLLECTION_MAX_ITEMS=100000`

#### Security & Networking
- **MJR_ALLOW_SYMLINKS**: Allow symbolic links in custom roots
  - Options: `on`, `off`, `true`, `false`
  - Default: `off`
  - Impact: Enables browsing of linked directories
  - Example: `MJR_ALLOW_SYMLINKS=on`

- **MAJOOR_TRUSTED_PROXIES**: IPs/CIDRs allowed for forwarded headers
  - Default: `127.0.0.1,::1`
  - Format: Comma-separated IP addresses or CIDR blocks
  - Impact: Security setting for proxy environments
  - Example: `MAJOOR_TRUSTED_PROXIES=127.0.0.1,192.168.1.0/24`

#### Dependency Management
- **MJR_AM_NO_AUTO_PIP**: Disable automatic dependency installation
  - Options: `1`, `true`, `yes`, `on` to disable
  - Default: Automatic installation enabled
  - Impact: Prevents automatic pip installs at startup
  - Example: `MJR_AM_NO_AUTO_PIP=1`

## Setting Up Environment Variables

### Windows
Create a batch file to set environment variables:

```batch
@echo off
set MAJOOR_MEDIA_PROBE_BACKEND=auto
set MAJOOR_DB_TIMEOUT=60.0

REM Start ComfyUI with the environment variables
cd /d "C:\path\to\ComfyUI"
python main.py --auto-launch
pause
```

### Unix/Linux/macOS
Create a shell script to set environment variables:

```bash
#!/bin/bash
export MAJOOR_MEDIA_PROBE_BACKEND=auto
export MAJOOR_DB_TIMEOUT=60.0

# Start ComfyUI with the environment variables
cd /path/to/ComfyUI
python main.py --auto-launch
```

Or add to your shell profile (`.bashrc`, `.zshrc`, etc.):

```bash
export MAJOOR_MEDIA_PROBE_BACKEND=auto
export MAJOOR_DB_TIMEOUT=60.0
```

## Configuration Best Practices

### Performance Optimization
- Adjust page size based on your system's RAM
- Set appropriate timeouts based on your storage speed
- Monitor database performance and adjust connections as needed

### Security Considerations
- Keep default security settings unless you have specific requirements
- Only enable symlink support if you trust the linked directories
- Configure trusted proxies appropriately in networked environments
- Regularly update external tools (ExifTool, FFprobe) for security

### Resource Management
- Monitor memory usage with large collections
- Adjust cache settings based on available RAM
- Set appropriate timeouts for your storage system
- Consider SSD storage for better database performance

### Backup and Recovery
- Regularly backup the index database (`assets.sqlite`)
- Backup custom root configurations
- Maintain copies of important collections
- Document your configuration settings for recovery

## Troubleshooting Configuration Issues

### Common Problems

#### Settings Not Saving
- Clear browser cache and cookies
- Check browser localStorage quota
- Verify no browser extensions are interfering
- Try a different browser

#### Performance Issues
- Reduce page size if experiencing slowdowns
- Disable auto-scan if not needed
- Adjust database connection settings
- Check system resources (RAM, disk space)

#### External Tool Issues
- Verify tools are in PATH or set explicit paths
- Check tool permissions and access rights
- Ensure tools are properly installed
- Test tools independently before using with Assets Manager

### Diagnostic Steps
1. Check ComfyUI console for error messages
2. Verify all required dependencies are installed
3. Test external tools independently
4. Review environment variable settings
5. Try default settings to isolate configuration issues

## Migration and Updates

### Settings Preservation
- Browser settings are preserved across updates
- Environment variables need to be reapplied after system restarts
- Custom root configurations are stored in the index directory
- Collections are preserved as JSON files

### Configuration Updates
- New settings are added with sensible defaults
- Old settings remain unchanged during updates
- Review new settings after updates to optimize functionality
- Check release notes for configuration changes

---
*Settings & Configuration Guide Version: 1.0*  
*Last Updated: January 2026*
