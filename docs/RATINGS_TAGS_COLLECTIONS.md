# Majoor Assets Manager - Ratings, Tags & Collections Guide

## Overview
The Majoor Assets Manager provides powerful organizational tools including ratings, tags, and collections to help you manage and organize your generated assets. This guide covers all features related to asset organization and categorization.

## Rating System

### Understanding Ratings
The rating system allows you to assign star ratings from 0 to 5 stars to your assets:
- **0 Stars**: Poor quality or unusable
- **1 Star**: Below average quality
- **2 Stars**: Average quality
- **3 Stars**: Good quality
- **4 Stars**: Very good quality
- **5 Stars**: Excellent quality

### Setting Ratings

#### Via Context Menu
1. Right-click on an asset card
2. Select "Rate" from the context menu
3. Choose the desired star rating (0-5)
4. The rating is saved immediately

#### Via Keyboard Shortcuts
1. Select an asset card
2. Press the corresponding number key (0-5)
3. The rating is applied instantly

#### Via Rating Editor
1. Click on the rating stars directly on the asset card
2. Select the desired number of stars
3. The rating is saved automatically

### Rating Features

#### Bulk Rating
- Select multiple assets using Ctrl/Cmd+click or Shift+click
- Apply the same rating to all selected assets
- Right-click and choose "Rate" to apply to all selections

#### Rating Filters
- Filter assets by minimum rating threshold
- Show only assets rated 3 stars or higher
- Quickly find your best results using rating filters

#### Rating Persistence
- Ratings are stored in the SQLite index database
- Ratings persist between ComfyUI sessions
- Ratings can be synchronized to file metadata (when external tools available)

### Rating Synchronization
When ExifTool is available, ratings can be synced to file metadata:
- Ratings stored in file metadata for portability
- Maintains ratings when files are moved/copied
- Compatible with other applications that read ratings
- Enabled/disabled via settings

#### Windows rating mapping (why 99?)

When sync is enabled, the manager writes both star ratings (0–5) and Windows-style percent fields (`RatingPercent` / `Microsoft:SharedUserRating`) for best Explorer compatibility.

- 0★ → 0
- 1★ → 1
- 2★ → 25
- 3★ → 50
- 4★ → 75
- 5★ → 99 (many Windows handlers treat 99 as “max”)

## Tagging System

### Understanding Tags
Tags are customizable keywords that help categorize and organize your assets:
- Free-form text labels (e.g., "character", "landscape", "fantasy")
- Multiple tags per asset
- Hierarchical tagging support (e.g., "style:anime", "color:warm")
- Searchable across all assets

### Adding Tags

#### Via Context Menu
1. Right-click on an asset card
2. Select "Edit Tags" from the context menu
3. Type tags separated by commas or spaces
4. Press Enter to save

#### Via Tags Editor
1. Click on an asset to select it
2. Open the details sidebar (press 'D')
3. Find the tags section
4. Add or remove tags as needed

#### Bulk Tagging
1. Select multiple assets
2. Right-click and choose "Edit Tags"
3. Add tags that apply to all selected assets
4. Tags are applied to all selected items

### Managing Tags

#### Tag Suggestions
- System suggests previously used tags
- Intelligent autocomplete for faster tagging
- Recently used tags appear at the top of suggestions

#### Tag Validation
- Prevents duplicate tags on the same asset
- Validates tag format and content
- Sanitizes special characters when needed

#### Tag Search
- Search for assets by specific tags
- Combine tag searches with other filters
- Use partial tag names for broader results

### Tag Features

#### Tag Hierarchy
- Use colons to create hierarchical tags: "subject:person:face"
- Organize tags in logical groups
- Facilitate more granular categorization

#### Tag Colors
- Visual indication of different tag types
- Customizable tag appearance
- Consistent color coding across the interface

#### Tag Statistics
- View tag frequency across your collection
- Identify most commonly used tags
- Analyze your tagging patterns

### Tag Synchronization
When ExifTool is available, tags can be synced to file metadata:
- Tags stored in file metadata for portability
- Maintains tags when files are moved/copied
- Compatible with other applications that read tags
- Enabled/disabled via settings

## Collections System

### Understanding Collections
Collections are user-created groups of assets that can span multiple directories:
- Named groups of related assets
- Can include assets from different scopes (Outputs, Inputs, Custom)
- Persistent storage in JSON format
- Shareable between users

### Creating Collections

#### From Selected Assets
1. Select one or more assets
2. Right-click and choose "Add to Collection"
3. Select an existing collection or create a new one
4. Name your new collection appropriately
5. Assets are added to the collection

#### From Search Results
1. Apply search and filters to find desired assets
2. Select all results (Ctrl+A or Cmd+A)
3. Right-click and choose "Add to Collection"
4. Create a new collection for the filtered results

#### Empty Collections
1. Right-click in the Collections tab
2. Choose "Create New Collection"
3. Name your collection
4. Add assets later as needed

### Managing Collections

#### Collection Operations
- **Rename**: Change collection name via context menu
- **Delete**: Remove entire collection (doesn't delete assets)
- **Clear**: Remove all items from collection (doesn't delete assets)
- **Export**: Save collection as JSON file for sharing
- **Import**: Load collection from JSON file

#### Item Management
- **Add Items**: Add assets to existing collections
- **Remove Items**: Remove specific assets from collections
- **Bulk Operations**: Add/remove multiple items at once
- **Duplicate Prevention**: Automatic detection of duplicates

### Collection Features

#### Smart Collections
- Dynamic collections based on criteria
- Automatically updated as new assets match criteria
- Based on tags, ratings, date ranges, or other attributes

#### Nested Collections
- Collections within collections (hierarchical)
- Organize large collections into subcategories
- Flexible organization structures

#### Collection Sharing
- Export collections as JSON files
- Import collections from other users
- Share curated sets of assets
- Collaborative collection building

### Collection Limits
- Maximum 50,000 items per collection (configurable)
- Performance optimization for large collections
- Warning when approaching limits
- Suggestions for splitting large collections

### Collection Views

#### Grid View
- Thumbnail display of collection contents
- Visual browsing of assets
- Consistent with main interface design

#### List View
- Detailed information display
- Sortable columns (name, date, size, rating)
- More information per asset

#### Compact View
- Dense layout for many items
- Efficient space utilization
- Quick scanning of large collections

## Integration with Other Features

### Search Integration
- Search within specific collections
- Cross-collection search capability
- Filter search results by collection membership
- Search for assets across all collections

### Filtering Integration
- Filter by collection membership
- Combine collection filters with other filters
- Show only assets from specific collections
- Exclude assets from certain collections

### Viewer Integration
- View collection context in viewer
- Navigate between collection items
- Show collection information in metadata panel
- Maintain collection context during comparisons

### Rating and Tag Integration
- Apply ratings/tags to entire collections
- Filter collections by ratings/tags
- Bulk operations on collection contents
- Maintain rating/tag statistics per collection

## Best Practices

### Rating Best Practices
- Establish consistent rating criteria
- Use ratings consistently across similar assets
- Regularly review and adjust ratings as needed
- Use rating filters to quickly find quality assets

### Tagging Best Practices
- Develop a consistent tagging vocabulary
- Use specific but not overly granular tags
- Maintain tag hierarchy for organization
- Regularly review and consolidate similar tags
- Use tags that will be meaningful later

### Collection Best Practices
- Create collections based on clear criteria
- Use descriptive names for collections
- Regularly clean up unused collections
- Split large collections into more manageable groups
- Share valuable collections with others

## Performance Considerations

### Large Collections
- Collections with many items may take longer to load
- Interface remains responsive during loading
- Pagination helps manage large collections
- Consider splitting very large collections

### Tag Performance
- Many tags per asset don't significantly impact performance
- Tag search remains fast regardless of quantity
- Regular cleanup of unused tags improves performance

### Rating Performance
- Rating operations are nearly instantaneous
- Rating filters apply quickly to large datasets
- Bulk rating operations are optimized

## Troubleshooting

### Rating Issues
- **Ratings not saving**: Check database permissions
- **Ratings not displaying**: Refresh the view or rescan
- **Sync issues**: Verify ExifTool installation for file sync

### Tagging Issues
- **Tags not appearing**: Check for typos or special characters
- **Tag search not working**: Ensure proper tag format
- **Sync issues**: Verify ExifTool installation for file sync

### Collection Issues
- **Collection not saving**: Check write permissions to index directory
- **Items not adding**: Verify collection limits haven't been reached
- **Collection not loading**: Check JSON file integrity

### Common Solutions
- **Refresh Index**: Use Ctrl/Cmd+S to rescan and refresh
- **Clear Cache**: Clear browser cache if interface seems stuck
- **Check Logs**: Look at ComfyUI console for detailed error messages
- **Database Maintenance**: Run optimization tools periodically

## Advanced Features

### Tag Expressions
- Complex tag queries using boolean logic
- Combine tags with AND/OR operations
- Parentheses for complex expressions
- Negation operators for exclusions

### Rating Statistics
- View rating distributions across collections
- Track rating trends over time
- Identify most/least rated assets
- Generate reports on rating patterns

### Collection Analytics
- View collection usage statistics
- Track most accessed collections
- Identify underutilized collections
- Analyze collection overlap and relationships

### Automation Possibilities
- Script-based tag assignment
- Automated rating based on criteria
- Scheduled collection maintenance
- Integration with external tools

## Security & Privacy

### Local Storage
- Ratings and tags stored locally
- No external data transmission
- Full control over your organizational data
- Backup your index database regularly

### File Metadata
- Optional synchronization to file metadata
- Controlled via settings
- Respects file permissions
- Preserves existing file metadata

---
*Ratings, Tags & Collections Guide Version: 1.0*  
*Last Updated: January 2026*