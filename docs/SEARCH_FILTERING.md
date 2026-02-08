# Majoor Assets Manager - Search & Filtering Guide

## Overview
The Majoor Assets Manager provides powerful search and filtering capabilities to help you quickly find and organize your assets. This guide explains all the search and filtering features available in the extension.

## Full-Text Search

### How It Works
The Assets Manager uses SQLite FTS5 with BM25 ranking to provide fast and accurate search results. The search indexes:
- Filenames and file extensions
- Embedded metadata (prompts, models, parameters)
- Workflow information
- Tags and ratings
- File content where applicable

### Basic Search
1. Locate the search bar at the top of the Assets Manager interface
2. Type any text you want to search for
3. Press Enter or wait for results to appear automatically
4. Results are displayed with relevance ranking

### Search Syntax

#### Simple Terms
- Type any word or phrase to search for it
- Example: `landscape` finds all assets with "landscape" in their metadata

#### Exact Phrases
- Use quotes to search for exact phrases
- Example: `"fantasy character"` finds assets with that exact phrase

#### Multiple Terms
- Search for multiple terms simultaneously
- Results containing more terms rank higher
- Example: `portrait fantasy digital` finds assets matching any or all terms

### Search Scopes
Search works across all available scopes:
- **Outputs**: Search in your ComfyUI output directory
- **Inputs**: Search in your ComfyUI input directory
- **Custom**: Search in user-defined directories
- **Collections**: Search within saved collections

## Filtering Options

### Kind Filter
The kind filter dropdown exposes the four file buckets that the backend consistently understands: **image**, **video**, **audio**, and **model3d**. Pick the bucket that best fits your search and the grid will stay in sync with the backend filters.

If you need to target a specific extension (for example `ext:webp` or `ext:gif`), type the `ext:<extension>` token directly in the search bar. The server parses these tokens and applies them as extension filters even if the dropdown remains on “All” or a different category.

### Rating Filter
Filter by star ratings (0-5 stars):
1. Click the rating filter dropdown
2. Select minimum rating threshold
3. Only assets with equal or higher ratings will be displayed
4. Useful for quickly finding your best results

### Workflow Filter
Toggle to show only assets with embedded workflow information:
- Shows only assets that contain workflow data
- Helpful when looking for specific generation parameters
- Particularly useful for reproducible results

### Date Filters
Filter assets by creation or modification dates:
1. Open the date filter panel
2. Select date range using calendar pickers
3. Apply the filter to narrow results
4. Useful for finding recent work or historical assets
> **UTC note:** The server evaluates date filters using UTC boundaries so every “today”/“this week” span is consistent regardless of the machine timezone.

### Advanced Filters

#### Inline Attribute Filters
Type tokens like `rating:5` or `ext:png` directly into the search input to add filters without touching the dropdowns. The backend recognizes these attribute-style tokens, so the grid applies the extra constraint even when the UI controls stay untouched.

#### Hide PNG Siblings
When working with video generations that include PNG previews:
- Enable this option to hide PNG files when video previews exist
- Reduces clutter from duplicate content in different formats
- Keeps your view focused on the primary asset type

#### Sort Options
Sort results by various criteria:
- **Relevance**: Based on search term matching (default)
- **Name**: Alphabetical by filename
- **Date**: Chronological by creation/modification date
- **Size**: By file size (ascending/descending)
- **Rating**: By star rating (ascending/descending)
- **Kind**: By file type

## Search Tips & Best Practices

### Effective Search Strategies
1. **Be Specific**: Use specific terms for better results
   - Instead of: `character`
   - Try: `"fantasy warrior"` or `"cyberpunk city"`

2. **Combine Filters**: Use multiple filters together
   - Rating + Date + Kind filters can quickly narrow results

3. **Use Quotes**: For exact phrase matching
   - `"negative prompt: ugly"` finds assets with that exact phrase

4. **Leverage Metadata**: Search for model names, samplers, or parameters
   - `model:SDXL` finds assets generated with SDXL
   - `steps:30` finds assets with 30 sampling steps

### Performance Considerations
- First search in a scope may take longer as indexing occurs
- Subsequent searches are faster due to cached indexes
- Very large directories may take time to scan initially
- Results are loaded in pages for smooth performance

### Search Result Information
Each search result displays:
- **Thumbnail**: Visual preview of the asset
- **Filename**: Original file name
- **Extension Badge**: File type with collision indicator (e.g., `PNG+` for duplicates)
- **Rating**: Star rating if assigned
- **Tags**: Preview of assigned tags
- **Metadata**: Brief generation information when available

## Using Filters Together

### Sequential Filtering
Apply filters in sequence for refined results:
1. Start with a broad search term
2. Apply kind filter to narrow by file type
3. Use rating filter to show only quality results
4. Apply date filter to focus on timeframe
5. Sort results by preference

### Resetting Filters
- Click the "Clear All Filters" button to reset all active filters
- Or individually disable filters using their respective controls
- Search terms remain unless cleared separately

## Collections Integration

### Searching Within Collections
- Switch to the Collections scope to search within saved collections
- Individual collections can be searched independently
- Cross-collection searches are also supported

### Adding Filtered Results to Collections
1. Apply your desired search and filters
2. Select the results you want to save
3. Right-click and choose "Add to Collection"
4. Create a new collection or add to existing one
5. The filtered results are preserved in the collection

## Troubleshooting Search Issues

### No Results Found
- Check spelling of search terms
- Try broader terms or synonyms
- Verify the correct scope is selected
- Ensure the directory has been scanned (trigger with Ctrl/Cmd+S)

### Too Many Results
- Add more specific search terms
- Apply kind filters to narrow by file type
- Use rating filters to show only quality results
- Apply date filters to focus on recent work

### Slow Search Performance
- First search in a large directory takes longer
- Subsequent searches are faster with cached indexes
- Consider excluding very large directories that don't contain relevant assets
- Check system resources and close other applications if needed

### Missing Metadata in Search
- Verify external tools (ExifTool, FFprobe) are installed
- Check file permissions for metadata access
- Some file formats may not contain embeddable metadata
- Re-index the directory if metadata should be present

## Advanced Search Techniques

### Boolean Operations
While direct boolean operators aren't supported, you can achieve similar results:
- AND: Include multiple terms (results must contain all terms)
- OR: Use broader terms that match any of your interests
- NOT: Manually exclude unwanted results after searching

### Pattern Recognition
- Search for common patterns in your workflow names
- Use recurring artist/model names as search terms
- Look for specific parameter combinations in metadata

### Workflow-Based Searching
- Search for specific sampler names: `euler`, `ddim`, `dpm++`
- Find results from particular models: `realisticvision`, `dreamshaper`
- Locate generations with specific settings: `cfg_scale:7`, `steps:40`

## Search Statistics

### Result Count Display
The interface shows:
- Total assets in current scope
- Number of assets matching current filters
- Current page and total pages
- Time taken for the search operation

### Performance Metrics
- Search duration is displayed for each query
- Indexing status shows when background processes are running
- Memory usage indicators help monitor performance

---
*Search & Filtering Guide Version: 1.0*  
*Last Updated: January 2026*
