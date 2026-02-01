# Majoor Assets Manager - Complete User Guide

## Table of Contents
1. [Getting Started](#getting-started)
2. [Basic Operations](#basic-operations)
3. [Advanced Features](#advanced-features)
4. [Workflow Integration](#workflow-integration)
5. [Organization Strategies](#organization-strategies)
6. [Troubleshooting](#troubleshooting)
7. [Tips & Tricks](#tips--tricks)

## Getting Started

### Prerequisites
Before starting with the Majoor Assets Manager, ensure you have:
- ComfyUI installed and running
- The Majoor Assets Manager extension installed
- (Optional but recommended) ExifTool and FFprobe installed for full metadata functionality

### First Launch
1. Start ComfyUI as usual
2. Open your browser and navigate to the ComfyUI interface
3. Look for the "Assets Manager" tab or panel
4. Click on the Assets Manager tab to open the interface

### Initial Interface Overview
When you first open the Assets Manager, you'll see:
- **Top Navigation**: Tabs for Outputs, Inputs, Custom, and Collections
- **Search Bar**: For searching across all assets
- **Filter Panel**: For applying filters and sorting
- **Asset Grid**: Main display area showing asset thumbnails
- **Status Bar**: Showing current status and scan progress

### Initial Scan
The first time you open each scope (Outputs, Inputs, Custom), the system will automatically begin scanning:
1. Wait for the initial scan to complete (shown in status bar)
2. The asset grid will populate with thumbnails
3. Use the search bar to find specific assets
4. Apply filters to narrow down results

## Basic Operations

### Browsing Assets

#### Switching Between Scopes
1. Click on the "Outputs" tab to browse generated outputs
2. Click on the "Inputs" tab to browse input images
3. Click on the "Custom" tab to browse custom directories
4. Click on the "Collections" tab to browse saved collections

#### Viewing Assets
1. Browse through the asset grid by scrolling
2. Click on any asset to select it
3. Double-click on an asset to open the viewer
4. Use the pagination controls to navigate through pages

### Searching for Assets

#### Basic Search
1. Click in the search bar at the top
2. Type your search term (e.g., "landscape", "character")
3. Press Enter or wait for results to appear
4. Results will be highlighted and ranked by relevance

#### Advanced Search
1. Use quotes for exact phrases: `"fantasy warrior"`
2. Combine terms for broader search: `portrait fantasy`
3. Use filters in combination with search for refined results

### Applying Filters

#### Filter by File Type
1. Click the "Kind" filter dropdown
2. Select the file types you want to see (Images, Videos, Workflows)
3. The asset grid will update to show only selected types

#### Filter by Rating
1. Click the "Rating" filter dropdown
2. Select minimum rating (e.g., "3 stars or higher")
3. Only assets meeting the rating threshold will be shown

#### Filter by Date
1. Click the date filter icon
2. Select a date range using the calendar
3. Apply the filter to see assets from the selected period

### Sorting Results
1. Click the sort dropdown (usually shows "Relevance" by default)
2. Select your preferred sort order (Name, Date, Size, Rating, etc.)
3. Toggle ascending/descending order if needed

## Advanced Features

### Using the Viewer

#### Opening the Viewer
1. Double-click on any asset in the grid
2. Or right-click and select "Open in Viewer"
3. The advanced viewer will open in a modal window

#### Viewer Navigation
1. Use mouse wheel to zoom in/out
2. Click and drag to pan around the image
3. Press "0" to fit image to screen
4. Press "1" or "Alt+1" for 1:1 pixel view

#### Image Analysis Tools
1. Press "F" to toggle false color mode
2. Press "Z" to toggle zebra patterns
3. Press "G" to cycle through grid overlays
4. Press "I" to toggle pixel probe
5. Press "L" to toggle loupe magnification

#### Video Playback
1. Use play/pause button to control playback
2. Drag the timeline slider to seek to specific points
3. Press "Shift+Left/Right" to step through frames
4. Set In/Out points with "I" and "O" keys

### Rating and Tagging Assets

#### Rating an Asset
1. Right-click on an asset
2. Select "Rate" from the context menu
3. Choose the number of stars (0-5)
4. Or press the corresponding number key (0-5) when asset is selected

#### Adding Tags
1. Right-click on an asset
2. Select "Edit Tags" from the context menu
3. Type your tags separated by commas
4. Press Enter to save the tags

#### Bulk Operations
1. Hold Ctrl/Cmd and click to select multiple assets
2. Or click one asset, hold Shift, and click another to select a range
3. Right-click on any selected asset
4. Apply rating or tags to all selected items

### Creating and Managing Collections

#### Creating a New Collection
1. Select one or more assets
2. Right-click and choose "Add to Collection"
3. Select "Create New Collection"
4. Give your collection a name
5. The collection is created and assets are added

#### Adding to Existing Collection
1. Select one or more assets
2. Right-click and choose "Add to Collection"
3. Select an existing collection from the list
4. Assets are added (duplicates are automatically skipped)

#### Managing Collections
1. Switch to the "Collections" tab
2. Right-click on a collection name
3. Choose from options like Rename, Delete, or Clear
4. To view a collection's contents, simply click on its name

### Using Drag and Drop

#### Dragging to ComfyUI Canvas
1. Select one or more assets
2. Click and hold on an asset thumbnail
3. Drag the asset onto the ComfyUI canvas
4. Release to drop - the asset path will be injected into compatible nodes

#### Dragging to Operating System
1. Select one or more assets
2. Click and drag an asset outside the browser window
3. For single files: drops the original file
4. For multiple files: creates and drops a ZIP file

## Workflow Integration

### Integrating Assets into Workflows

#### Loading Assets into Nodes
1. Find the asset you want to use in Assets Manager
2. Drag it directly onto the ComfyUI canvas
3. The asset path will be automatically injected into compatible nodes
4. Common compatible nodes: LoadImage, LoadVideo, etc.

#### Using Collections for Workflow Elements
1. Create collections for different types of assets (characters, backgrounds, etc.)
2. Organize assets by project or style
3. Use collections to quickly access frequently used assets
4. Share collections with team members

### Metadata-Driven Workflows

#### Examining Generation Parameters
1. Open an asset in the viewer
2. Look at the metadata panel for generation details
3. Note the model, sampler, steps, CFG scale, etc.
4. Use this information to recreate or modify results

#### Reproducing Results
1. Find a result you like in Assets Manager
2. Note the seed value in the metadata
3. Use the same parameters with the same seed to reproduce
4. Or slightly modify parameters for variations

### Quality Assessment Workflow

#### Rating System for Quality Control
1. Establish consistent rating criteria for your workflow
2. Rate assets as you review them (0-5 stars)
3. Use rating filters to quickly find high-quality results
4. Focus your attention on top-rated assets

#### Tagging for Organization
1. Develop a consistent tagging system
2. Tag assets by subject, style, quality, or other relevant categories
3. Use tags to quickly find assets with specific characteristics
4. Combine tags with other filters for precise searching

## Organization Strategies

### Effective Tagging Systems

#### Hierarchical Tagging
1. Use colons to create hierarchy: "subject:person:face:portrait"
2. Organize tags in logical groups
3. Use consistent terminology across your collection
4. Create tag templates for common categories

#### Project-Based Tagging
1. Tag assets by project: "project:client_name"
2. Use status tags: "status:approved", "status:rejected", "status:review"
3. Add version tags: "version:v1", "version:final"
4. Include collaboration tags: "collaborator:designer_name"

### Collection Organization

#### Thematic Collections
1. Create collections based on themes or subjects
2. Group similar styles together
3. Separate experimental work from production assets
4. Create mood boards as collections

#### Workflow Collections
1. Create collections for different stages of your workflow
2. "Reference" collection for inspiration
3. "To Review" collection for pending evaluation
4. "Approved" collection for final assets

#### Client/Project Collections
1. Create separate collections for each client or project
2. Use consistent naming conventions
3. Include version information in collection names
4. Archive old project collections when appropriate

### Rating Strategies

#### Consistent Rating Criteria
1. Define what each star rating means for your work
2. Apply ratings consistently across similar asset types
3. Revisit and adjust ratings periodically as needed
4. Use ratings to identify your most successful techniques

#### Quality Filtering
1. Use rating filters to focus on high-quality results
2. Set minimum rating thresholds for different purposes
3. Regularly review low-rated assets for improvement opportunities
4. Use ratings to track improvement over time

## Troubleshooting

### Common Issues and Solutions

#### Assets Not Appearing
**Problem**: Assets don't show up in the grid
**Solution**: 
1. Check if the correct scope is selected (Outputs, Inputs, Custom, Collections)
2. Trigger a manual scan with Ctrl/Cmd+S
3. Verify the directory contains assets in supported formats
4. Check ComfyUI console for error messages

#### Slow Performance
**Problem**: Interface is slow or unresponsive
**Solution**:
1. Reduce page size in settings
2. Apply more specific filters to reduce results
3. Close other browser tabs to free memory
4. Restart ComfyUI if the issue persists

#### Metadata Not Loading
**Problem**: Metadata panel shows "Loading..." indefinitely
**Solution**:
1. Verify ExifTool and FFprobe are installed and in PATH
2. Check file permissions for the asset files
3. Try refreshing the metadata manually
4. Check if the file format is supported

#### Search Not Working
**Problem**: Search returns no results or unexpected results
**Solution**:
1. Wait for initial indexing to complete
2. Trigger a manual scan with Ctrl/Cmd+S
3. Try simpler search terms
4. Check that the correct scope is selected

### Advanced Troubleshooting

#### Index Database Issues
**Problem**: Assets Manager behaves unexpectedly or shows old data
**Solution**:
1. Clear the index database (backup first if needed)
2. Trigger a full rescan of your directories
3. Check the index database file permissions
4. Verify disk space is available

#### File Permission Issues
**Problem**: Cannot access certain files or directories
**Solution**:
1. Check that ComfyUI has read access to the directories
2. Verify file ownership and permissions
3. Run ComfyUI with appropriate user privileges
4. Check for any security software blocking access

#### External Tool Issues
**Problem**: Metadata extraction or file tagging not working
**Solution**:
1. Verify ExifTool and FFprobe are properly installed
2. Test the tools independently from command line
3. Set explicit paths using environment variables if needed
4. Check that the tools have appropriate file access permissions

## Tips & Tricks

### Productivity Boosters

#### Keyboard Shortcuts Mastery
1. Learn rating shortcuts (0-5 keys) for quick evaluation
2. Use Ctrl+A to select all visible assets
3. Master navigation keys (arrows, Page Up/Down) for efficient browsing
4. Use D key to toggle details sidebar quickly

#### Search Efficiency
1. Use specific terms rather than generic ones
2. Combine search with filters for precise results
3. Use quotes for exact phrase matching
4. Leverage metadata fields in searches (e.g., "model:SDXL")

#### Batch Operations
1. Select multiple assets using Ctrl/Cmd+click or Shift+click
2. Apply ratings or tags to multiple assets at once
3. Drag multiple assets to ComfyUI canvas simultaneously
4. Use collections for batch operations

### Advanced Techniques

#### Power User Workflow
1. Use Collections to create reusable asset libraries
2. Develop consistent tagging schemes for your work
3. Leverage metadata to understand what parameters produce good results
4. Use the viewer's analysis tools for quality assessment

#### Integration with External Tools
1. Export collections as JSON for use in other applications
2. Use drag-and-drop to integrate with design software
3. Leverage metadata for automated processing pipelines
4. Share assets and collections with collaborators

#### Customization and Optimization
1. Adjust page size based on your system's capabilities
2. Configure auto-scan settings for your workflow
3. Set up custom roots for frequently accessed directories
4. Fine-tune performance settings based on your hardware

### Best Practices

#### Organization Best Practices
1. Establish consistent naming conventions
2. Regularly clean up unused collections
3. Maintain a manageable number of tags
4. Use hierarchical tags for complex organization

#### Performance Best Practices
1. Keep collections reasonably sized (under 50,000 items)
2. Use filters to narrow down large result sets
3. Regularly optimize the database through maintenance tools
4. Monitor index size and rebuild if needed

#### Collaboration Best Practices
1. Share consistent tagging schemes with team members
2. Use standardized collection naming conventions
3. Document your rating criteria for consistency
4. Export and share valuable collections

## Quick Reference

### Essential Keyboard Shortcuts
- **Ctrl+S** / **Cmd+S**: Trigger index scan
- **D**: Toggle details sidebar
- **0-5**: Rate selected asset (0-5 stars)
- **Enter**: Open viewer for selected asset
- **Ctrl+A** / **Cmd+A**: Select all visible assets
- **Ctrl+F** / **Cmd+F**: Focus search bar
- **Escape**: Close viewer or clear selection

### Common Tasks Quick Steps

#### Find Recent High-Quality Assets
1. Click "Outputs" tab
2. Set rating filter to "4 stars or higher"
3. Set date filter to last week
4. Sort by date (descending)

#### Create a Mood Board Collection
1. Browse and select relevant assets
2. Right-click and choose "Add to Collection"
3. Create new collection named "Mood Board YYYY-MM-DD"
4. Continue adding assets as needed

#### Evaluate a Batch of Results
1. Apply relevant filters to isolate results
2. Select all with Ctrl+A
3. Use rating shortcuts to quickly assess quality
4. Create a collection of top-rated items

#### Share Assets with Others
1. Create a collection with the assets to share
2. Export the collection as JSON
3. Send the JSON file to recipients
4. They can import the collection to access the assets

---

*Complete User Guide Version: 1.1*  
*Last Updated: January 31, 2026 (Performance Update)*