/**
 * Internationalization support for Majoor Assets Manager.
 * Detects ComfyUI language and provides translations for the entire UI.
 */
import { GENERATED_TRANSLATIONS } from "./i18n.generated.js";
import { getSettingValue } from "./comfyApiBridge.js";

const DEFAULT_LANG = "en-US";
let currentLang = DEFAULT_LANG;
let _langChangeListeners = [];
const LANG_STORAGE_KEYS = ["mjr_lang", "majoor.lang"];
const _missingTranslationKeys = new Set();

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// DICTIONARY - Full UI translations
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const DICTIONARY = {
    "en-US": {
        // â”€â”€â”€ Settings Categories â”€â”€â”€
        "cat.grid": "Grid",
        "cat.cards": "Cards",
        "cat.badges": "Badges",
        "cat.viewer": "Viewer",
        "cat.scanning": "Scanning",
        "cat.advanced": "Advanced",
        "cat.security": "Security",
        "cat.remote": "Remote Access",

        // â”€â”€â”€ Settings: Grid â”€â”€â”€
        "setting.grid.minsize.name": "Majoor: Thumbnail Size (px)",
        "setting.grid.minsize.desc": "Minimum size of thumbnails in the grid. May require reopening the panel.",
        "setting.grid.cardSize.group": "Card size",
        "setting.grid.cardSize.name": "Majoor: Card Size",
        "setting.grid.cardSize.desc": "Choose a card size preset: small, medium, or large.",
        "setting.grid.cardSize.small": "Small",
        "setting.grid.cardSize.medium": "Medium",
        "setting.grid.cardSize.large": "Large",
        "setting.grid.gap.name": "Majoor: Gap (px)",
        "setting.grid.gap.desc": "Space between thumbnails.",
        "setting.sidebar.pos.name": "Majoor: Sidebar Position",
        "setting.sidebar.pos.desc": "Show details sidebar on the left or the right. Reload required.",
        "setting.siblings.hide.name": "Majoor: Hide PNG Siblings",
        "setting.siblings.hide.desc": "If a video has a corresponding .png preview, hide the .png from the grid.",
        "setting.nav.infinite.name": "Majoor: Infinite Scroll",
        "setting.nav.infinite.desc": "Automatically load more files when scrolling.",
        "setting.grid.pagesize.name": "Majoor: Grid Page Size",
        "setting.grid.pagesize.desc": "Number of assets loaded per page/request in the grid.",

        // â”€â”€â”€ Settings: Viewer â”€â”€â”€
        "setting.viewer.pan.name": "Majoor: Pan without Zoom",
        "setting.viewer.pan.desc": "Allow panning the image even at zoom level 1.",
        "setting.minimap.enabled.name": "Majoor: Enable Minimap",
        "setting.minimap.enabled.desc": "Global activation of the workflow minimap.",

        // â”€â”€â”€ Settings: Scanning â”€â”€â”€
        "setting.scan.startup.name": "Majoor: Auto-scan on Startup",
        "setting.scan.startup.desc": "Start a background scan as soon as ComfyUI loads.",
        "setting.watcher.name": "Majoor: File Watcher",
        "setting.watcher.desc": "Watch output and custom folders for manually added files and auto-index them in real time.",
        "setting.watcher.debounce.name": "Majoor: Watcher debounce delay",
        "setting.watcher.debounce.desc": "Delay (ms) for batching watcher events before indexing.",
        "setting.watcher.debounce.error": "Failed to update watcher debounce delay.",
        "setting.watcher.dedupe.name": "Majoor: Watcher dedupe window",
        "setting.watcher.dedupe.desc": "Duration (ms) a file is treated as already processed after an event.",
        "setting.watcher.dedupe.error": "Failed to update watcher dedupe window.",
        "setting.sync.rating.name": "Majoor: Sync Rating/Tags to Files",
        "setting.sync.rating.desc": "Write ratings and tags into file metadata (ExifTool).",

        // â”€â”€â”€ Settings: Badge Colors â”€â”€â”€
        "cat.badgeColors": "Badge colors",
        "setting.starColor": "Star color",
        "setting.starColor.tooltip": "Color of rating stars on thumbnails (hex, e.g. #FFD45A)",
        "setting.badgeImageColor": "Image badge color",
        "setting.badgeImageColor.tooltip": "Color for image badges: PNG, JPG, WEBP, GIF, BMP, TIF (hex)",
        "setting.badgeVideoColor": "Video badge color",
        "setting.badgeVideoColor.tooltip": "Color for video badges: MP4, WEBM, MOV, AVI, MKV (hex)",
        "setting.badgeAudioColor": "Audio badge color",
        "setting.badgeAudioColor.tooltip": "Color for audio badges: MP3, WAV, OGG, FLAC (hex)",
        "setting.badgeModel3dColor": "3D model badge color",
        "setting.badgeModel3dColor.tooltip": "Color for 3D model badges: OBJ, FBX, GLB, GLTF (hex)",

        // â”€â”€â”€ Settings: Advanced â”€â”€â”€
        "setting.obs.enabled.name": "Majoor: Enable Detailed Logs",
        "setting.obs.enabled.desc": "Enable detailed backend logs for debugging.",
        "setting.probe.mode.name": "Majoor: Metadata Backend",
        "setting.probe.mode.desc": "Choose the tool used directly to extract metadata.",
        "setting.language.name": "Majoor: Language",
        "setting.language.desc": "Choose the language for the Assets Manager interface. Reload required to fully apply.",

        // â”€â”€â”€ Settings: Security â”€â”€â”€
        "setting.sec.safe.name": "Majoor: Safe Mode",
        "setting.sec.safe.desc": "When enabled, rating/tags writes are blocked unless explicitly authorized.",
        "setting.sec.remote.name": "Majoor: Allow Remote Full Access",
        "setting.sec.remote.desc": "Allow non-local clients to perform write operations. Disabling blocks writes unless a token is configured.",
        "setting.sec.write.name": "Majoor: Allow Write",
        "setting.sec.write.desc": "Allow writing ratings and tags.",
        "setting.sec.del.name": "Majoor: Allow Delete",
        "setting.sec.del.desc": "Allow deleting files.",
        "setting.sec.ren.name": "Majoor: Allow Rename",
        "setting.sec.ren.desc": "Allow renaming files.",
        "setting.sec.open.name": "Majoor: Allow Open in Folder",
        "setting.sec.open.desc": "Allow opening file location in OS file manager.",
        "setting.sec.reset.name": "Majoor: Allow Index Reset",
        "setting.sec.reset.desc": "Allow resetting the index cache and triggering a full rescan.",
        "setting.sec.token.name": "Majoor: API Token",
        "setting.sec.token.desc": "Store the write authorization token. Majoor inserts it in the Authorization and X-MJR-Token headers.",
        "setting.sec.token.placeholder": "Leave blank to disable.",

        // â”€â”€â”€ Panel: Tabs â”€â”€â”€
        "tab.output": "Output",
        "tab.input": "Input",
        "tab.custom": "Custom",

        // â”€â”€â”€ Panel: Buttons â”€â”€â”€
        "btn.add": "Addâ€¦",
        "btn.remove": "Remove",
        "btn.adding": "Adding...",
        "btn.removing": "Removing...",
        "btn.retry": "Retry",
        "btn.clear": "Clear",
        "btn.refresh": "Refresh",
        "btn.scan": "Scan",
        "btn.scanning": "Scanning...",
        "btn.resetIndex": "Reset index",
        "btn.resetting": "Resetting...",
        "btn.deleteDb": "Delete DB",
        "btn.deletingDb": "Deleting DB...",
        "btn.retryServices": "Retry services",
        "btn.retrying": "Retrying...",
        "btn.loadWorkflow": "Load Workflow",
        "btn.copyPrompt": "Copy Prompt",
        "btn.close": "Close",

        // â”€â”€â”€ Panel: Labels â”€â”€â”€
        "label.folder": "Folder",
        "label.type": "Type",
        "label.workflow": "Workflow",
        "label.rating": "Rating",
        "label.dateRange": "Date range",
        "label.agenda": "Agenda",
        "label.sort": "Sort",
        "label.collections": "Collections",
        "label.filters": "Filters",
        "label.selectFolder": "Select folderâ€¦",
        "label.thisFolder": "this folder",

        // â”€â”€â”€ Panel: Filters â”€â”€â”€
        "filter.all": "All",
        "filter.images": "Images",
        "filter.videos": "Videos",
        "filter.onlyWithWorkflow": "Only with workflow",
        "filter.anyRating": "Any rating",
        "filter.minStars": "{n}+ stars",
        "filter.anytime": "Anytime",
        "filter.today": "Today",
        "filter.yesterday": "Yesterday",
        "filter.thisWeek": "This week",
        "filter.thisMonth": "This month",
        "filter.last7days": "Last 7 days",
        "filter.last30days": "Last 30 days",

        // â”€â”€â”€ Panel: Sort â”€â”€â”€
        "sort.newest": "Newest first",
        "sort.oldest": "Oldest first",
        "sort.nameAZ": "Name A-Z",
        "sort.nameZA": "Name Z-A",
        "sort.ratingHigh": "Rating (high)",
        "sort.ratingLow": "Rating (low)",
        "sort.sizeDesc": "Size (large)",
        "sort.sizeAsc": "Size (small)",

        // â”€â”€â”€ Panel: Status â”€â”€â”€
        "status.checking": "Checking...",
        "status.ready": "Ready",
        "status.scanning": "Scanning...",
        "status.error": "Error",
        "status.capabilities": "Capabilities",
        "status.toolStatus": "Tool status",
        "status.selectCustomFolder": "Select a custom folder first",
        "status.errorGetConfig": "Error: Failed to get config",
        "status.discoveringTools": "Capabilities: discovering tools...",
        "status.indexStatus": "Index Status",
        "status.toolStatusChecking": "Tool status: checking...",
        "status.resetIndexHint": "Reset index cache (requires allowResetIndex in settings).",
        "status.scanningHint": "This may take a while",
        "status.toolAvailable": "{tool} available",
        "status.toolUnavailable": "{tool} unavailable",
        "status.unknown": "unknown",
        "status.available": "available",
        "status.missing": "missing",
        "status.path": "Path",
        "status.pathAuto": "auto / not configured",
        "status.noAssets": "No assets indexed yet ({scope})",
        "status.clickToScan": "Click the dot to start a scan",
        "status.assetsIndexed": "{count} assets indexed ({scope})",
        "status.imagesVideos": "Images: {images}  -  Videos: {videos}",
        "status.withWorkflows": "With workflows: {workflows}  -  Generation data: {gendata}",
        "status.dbSize": "Database size: {size}",
        "status.lastScan": "Last scan: {date}",
        "status.scanStats": "Added: {added}  -  Updated: {updated}  -  Skipped: {skipped}",
        "status.watcher.enabled": "Watcher: enabled",
        "status.watcher.enabledScoped": "Watcher: enabled ({scope})",
        "status.watcher.disabled": "Watcher: disabled",
        "status.watcher.disabledScoped": "Watcher: disabled ({scope})",
        "status.apiNotFound": "Majoor API endpoints not found (404)",
        "status.apiNotFoundHint": "Backend routes are not loaded. Restart ComfyUI and check the terminal for Majoor import errors.",
        "status.errorChecking": "Error checking status",
        "status.dbCorrupted": "Database is corrupted",
        "status.dbCorruptedHint": "Use the \"Delete DB\" button below to force-delete and rebuild the index.",
        "status.retryFailed": "Retry failed",

        // â”€â”€â”€ Scopes â”€â”€â”€
        "scope.all": "Inputs + Outputs",
        "scope.allFull": "All (Inputs + Outputs)",
        "scope.input": "Inputs",
        "scope.output": "Outputs",
        "scope.custom": "Custom",

        // â”€â”€â”€ Tools â”€â”€â”€
        "tool.exiftool": "ExifTool metadata",
        "tool.exiftool.hint": "PNG/WEBP workflow data (uses ExifTool)",
        "tool.ffprobe": "FFprobe video stats",
        "tool.ffprobe.hint": "Video duration, FPS, and resolution (uses FFprobe)",

        // â”€â”€â”€ Panel: Messages â”€â”€â”€
        "msg.noCollections": "No collections yet.",
        "msg.addCustomFolder": "Add a custom folder to browse.",
        "msg.noResults": "No results found.",
        "msg.loading": "Loading...",
        "msg.errorLoading": "Error loading",
        "msg.errorLoadingFolders": "Error loading folders",
        "msg.noGenerationData": "No generation data found for this file.",
        "msg.rawMetadata": "Raw metadata",

        // â”€â”€â”€ Viewer â”€â”€â”€
        "viewer.genInfo": "Generation Info",
        "viewer.workflow": "Workflow",
        "viewer.metadata": "Metadata",
        "viewer.noWorkflow": "No workflow data",
        "viewer.noMetadata": "No metadata available",
        "viewer.copySuccess": "Copied to clipboard!",
        "viewer.copyFailed": "Failed to copy",

        // â”€â”€â”€ Sidebar â”€â”€â”€
        "sidebar.details": "Details",
        "sidebar.preview": "Preview",
        "sidebar.rating": "Rating",
        "sidebar.tags": "Tags",
        "sidebar.addTag": "Add tag...",
        "sidebar.noTags": "No tags",
        "sidebar.filename": "Filename",
        "sidebar.dimensions": "Dimensions",
        "sidebar.date": "Date",
        "sidebar.size": "Size",
        "sidebar.genTime": "Generation time",

        // â”€â”€â”€ Context Menu â”€â”€â”€
        "ctx.openViewer": "Open in viewer",
        "ctx.loadWorkflow": "Load workflow",
        "ctx.copyPath": "Copy path",
        "ctx.openInFolder": "Open in folder",
        "ctx.rename": "Rename",
        "ctx.delete": "Delete",
        "ctx.addToCollection": "Add to collection",
        "ctx.removeFromCollection": "Remove from collection",
        "ctx.newCollection": "New collection...",
        "ctx.rescanMetadata": "Rescan metadata",
        "ctx.createCollection": "Create collection...",
        "ctx.exitCollection": "Exit collection view",

        // â”€â”€â”€ Dialogs â”€â”€â”€
        "dialog.confirm": "Confirm",
        "dialog.cancel": "Cancel",
        "dialog.delete.title": "Delete file?",
        "dialog.delete.msg": "Are you sure you want to delete this file? This cannot be undone.",
        "dialog.rename.title": "Rename file",
        "dialog.rename.placeholder": "New filename",
        "dialog.newCollection.title": "New collection",
        "dialog.newCollection.placeholder": "Collection name",
        "dialog.resetIndex.title": "Reset index?",
        "dialog.resetIndex.msg": "This will delete the database and rescan all files. Continue?",
        "dialog.securityWarning": "This looks like a system or very broad directory.\n\nAdding it can expose sensitive files via the viewer/custom roots feature.\n\nContinue?",
        "dialog.securityWarningTitle": "Majoor: Security Warning",
        "dialog.enterFolderPath": "Enter a folder path to add as a Custom root:",
        "dialog.customFoldersTitle": "Majoor: Custom Folders",
        "dialog.removeFolder": "Remove the custom folder \"{name}\"?",
        "dialog.deleteCollection": "Delete collection \"{name}\"?",
        "dialog.createCollection": "Create collection",
        "dialog.collectionPlaceholder": "My collection",

        // â”€â”€â”€ Toasts â”€â”€â”€
        "toast.scanStarted": "Scan started",
        "toast.scanComplete": "Scan complete",
        "toast.scanFailed": "Scan failed",
        "toast.resetTriggered": "Reset triggered: Reindexing all files...",
        "toast.resetStarted": "Index reset started. Files will be reindexed in the background.",
        "toast.resetFailed": "Failed to reset index",
        "toast.resetFailedCorrupt": "Reset failed â€” database is corrupted. Use the \"Delete DB\" button to force-delete and rebuild.",
        "toast.dbDeleteTriggered": "Deleting database and rebuilding...",
        "toast.dbDeleteSuccess": "Database deleted and rebuilt. Files are being reindexed.",
        "toast.dbDeleteFailed": "Failed to delete database",
        "dialog.dbDelete.confirm": "This will permanently delete the index database and rebuild it from scratch. All ratings, tags, and cached metadata will be lost.\n\nContinue?",
        "toast.deleted": "File deleted",
        "toast.renamed": "File renamed",
        "toast.addedToCollection": "Added to collection",
        "toast.removedFromCollection": "Removed from collection",
        "toast.collectionCreated": "Collection created",
        "toast.permissionDenied": "Permission denied",
        "toast.tagAdded": "Tag added",
        "toast.tagRemoved": "Tag removed",
        "toast.ratingSaved": "Rating saved",
        "toast.failedAddFolder": "Failed to add custom folder",
        "toast.failedRemoveFolder": "Failed to remove custom folder",
        "toast.folderLinked": "Folder linked successfully",
        "toast.folderRemoved": "Folder removed",
        "toast.nativeBrowserUnavailable": "Native folder browser unavailable. Please enter path manually.",
        "toast.errorAddingFolder": "An error occurred while adding the custom folder",
        "toast.errorRemovingFolder": "An error occurred while removing the custom folder",
        "toast.failedCreateCollection": "Failed to create collection",
        "toast.failedDeleteCollection": "Failed to delete collection",
        "toast.languageChanged": "Language changed. Reload the page for full effect.",
        "toast.ratingUpdateFailed": "Failed to update rating",
        "toast.ratingUpdateError": "Error updating rating",
        "toast.tagsUpdateFailed": "Failed to update tags",
        "toast.watcherToggleFailed": "Failed to toggle watcher",
        "toast.noValidAssetsSelected": "No valid assets selected.",
        "toast.failedCreateCollectionDot": "Failed to create collection.",
        "toast.failedAddAssetsToCollection": "Failed to add assets to collection.",
        "toast.removeFromCollectionFailed": "Failed to remove from collection.",
        "toast.copyClipboardFailed": "Failed to copy to clipboard",
        "toast.metadataRefreshFailed": "Failed to refresh metadata.",
        "toast.ratingCleared": "Rating cleared",
        "toast.ratingSetN": "Rating set to {n} stars",
        "toast.tagsUpdated": "Tags updated",
        "toast.fileRenamedSuccess": "File renamed successfully!",
        "toast.fileRenameFailed": "Failed to rename file.",
        "toast.fileDeletedSuccess": "File deleted successfully!",
        "toast.fileDeleteFailed": "Failed to delete file.",
        "toast.openedInFolder": "Opened in folder",
        "toast.openFolderFailed": "Failed to open folder.",
        "toast.pathCopied": "File path copied to clipboard",
        "toast.pathCopyFailed": "Failed to copy path",
        "toast.noFilePath": "No file path available for this asset.",
        "toast.downloadingFile": "Downloading {filename}...",
        "toast.playbackRate": "Playback {rate}x",
        "toast.metadataRefreshed": "Metadata refreshed{suffix}",
        "toast.enrichmentComplete": "Metadata enrichment complete",
        "toast.errorRenaming": "Error renaming file: {error}",
        "toast.errorDeleting": "Error deleting file: {error}",
        "toast.tagMergeFailed": "Tag merge failed: {error}",
        "toast.deleteFailed": "Delete failed: {error}",
        "toast.analysisNotStarted": "Analysis not started: {error}",
        "toast.dupAnalysisStarted": "Duplicate analysis started",
        "toast.tagsMerged": "Tags merged",
        "toast.duplicatesDeleted": "Duplicates deleted",
        "toast.playbackVideoOnly": "Playback speed is available for video media only",
        "toast.filesDeletedSuccessN": "{n} files deleted successfully!",
        "toast.filesDeletedPartial": "{success} files deleted, {failed} failed.",
        "toast.filesDeletedShort": "{n} files deleted",
        "toast.filesDeletedShortPartial": "{success} deleted, {failed} failed",
        "toast.copiedToClipboardNamed": "{name} copied to clipboard!",
        "toast.rescanningFile": "Rescanning fileâ€¦",

        // â”€â”€â”€ Hotkeys â”€â”€â”€
        // Missing keys filled from runtime usage
        "cat.search": "Search",
        "setting.badgeDuplicateAlertColor": "Duplicate alert badge color",
        "setting.badgeDuplicateAlertColor.tooltip": "Alert color used when duplicate extension badges are shown (e.g. PNG+).",
        "setting.grid.videoAutoplayMode.name": "Majoor: Video Autoplay",
        "setting.grid.videoAutoplayMode.desc": "Controls video thumbnail playback in the grid. Off: static frame. Hover: play on mouse hover. Always: loop while visible.",
        "setting.grid.videoAutoplayMode.off": "Off",
        "setting.grid.videoAutoplayMode.hover": "Hover",
        "setting.grid.videoAutoplayMode.always": "Always",
        "setting.watcher.enabled.label": "Watcher enabled",
        "setting.watcher.debounce.label": "Watcher debounce (ms)",
        "setting.watcher.dedupe.label": "Watcher dedupe window (ms)",
        "setting.search.maxResults.name": "Majoor: Search max results",
        "setting.search.maxResults.desc": "Maximum number of results returned by search endpoints.",
        "btn.dbSave": "Save DB",
        "btn.dbRestore": "Restore DB",
        "status.dbBackupSelectHint": "Select a DB backup to restore",
        "status.dbBackupLoading": "Loading DB backups...",
        "status.dbSaveHint": "Create a DB backup snapshot now.",
        "status.dbRestoreHint": "Restore selected DB backup and restart indexing.",
        "status.dbHealthOk": "DB health: ok",
        "status.dbHealthError": "DB health: error",
        "status.indexHealthOk": "Index health: ok",
        "status.indexHealthPartial": "Index health: partial",
        "status.indexHealthEmpty": "Index health: empty",
        "status.pending": "Pending",
        "status.dbRestoreInProgress": "DB restore in progress",
        "status.scanningScope": "Scanning scope: {scope}",
        "status.toast.info": "Index status: checking",
        "status.toast.success": "Index status: ready",
        "status.toast.warning": "Index status: attention needed",
        "status.toast.error": "Index status: error",
        "toast.dbRestoreStopping": "Stopping running workers",
        "toast.dbRestoreResetting": "Unlocking and resetting database",
        "toast.dbRestoreReplacing": "Replacing database files",
        "toast.dbRestoreRescan": "Restarting scan",
        "toast.dbRestoreSuccess": "Database backup restored",
        "hotkey.scan": "Scan (S)",
        "hotkey.search": "Search (Ctrl+F)",
        "hotkey.details": "Toggle details (D)",
        "hotkey.delete": "Delete (Del)",
        "hotkey.viewer": "Open viewer (Enter)",
        "hotkey.escape": "Close (Esc)",
    },

    "fr-FR": {
        // â”€â”€â”€ CatÃ©gories Settings â”€â”€â”€
        "cat.grid": "Grille",
        "cat.cards": "Cartes",
        "cat.badges": "Badges",
        "cat.viewer": "Visionneuse",
        "cat.scanning": "Scan",
        "cat.advanced": "AvancÃ©",
        "cat.security": "SÃ©curitÃ©",
        "cat.remote": "AccÃ¨s distant",

        // â”€â”€â”€ Settings: Grille â”€â”€â”€
        "setting.grid.minsize.name": "Majoor: Taille des vignettes (px)",
        "setting.grid.minsize.desc": "Taille minimale des vignettes. Peut nÃ©cessiter de rÃ©ouvrir le panneau.",
        "setting.grid.cardSize.group": "Taille des cartes",
        "setting.grid.cardSize.name": "Majoor: Taille des cartes",
        "setting.grid.cardSize.desc": "Choisir un preset de taille de carte : small, medium ou large.",
        "setting.grid.cardSize.small": "Petit",
        "setting.grid.cardSize.medium": "Moyen",
        "setting.grid.cardSize.large": "Grand",
        "setting.grid.gap.name": "Majoor: Espacement (px)",
        "setting.grid.gap.desc": "Espace entre les vignettes.",
        "setting.sidebar.pos.name": "Majoor: Position sidebar",
        "setting.sidebar.pos.desc": "Afficher la sidebar Ã  gauche ou Ã  droite. Recharger la page pour appliquer.",
        "setting.siblings.hide.name": "Majoor: Masquer aperÃ§us PNG",
        "setting.siblings.hide.desc": "Si une vidÃ©o a un fichier .png correspondant, masquer le .png de la grille.",
        "setting.nav.infinite.name": "Majoor: DÃ©filement infini",
        "setting.nav.infinite.desc": "Charger automatiquement plus de fichiers en scrollant.",
        "setting.grid.pagesize.name": "Majoor: Taille de page de la grille",
        "setting.grid.pagesize.desc": "Nombre d'assets charg?s par page/requ?te dans la grille.",

        // â”€â”€â”€ Settings: Visionneuse â”€â”€â”€
        "setting.viewer.pan.name": "Majoor: Pan sans zoom",
        "setting.viewer.pan.desc": "Permet de dÃ©placer l'image mÃªme sans zoom.",
        "setting.minimap.enabled.name": "Majoor: Activer Minimap",
        "setting.minimap.enabled.desc": "Activation globale de la minimap du workflow.",

        // â”€â”€â”€ Settings: Scan â”€â”€â”€
        "setting.scan.startup.name": "Majoor: Auto-scan au dÃ©marrage",
        "setting.scan.startup.desc": "Lancer un scan en arriÃ¨re-plan dÃ¨s le chargement de ComfyUI.",
        "setting.watcher.name": "Majoor: Surveillance fichiers",
        "setting.watcher.desc": "Surveiller les dossiers output et custom pour indexer automatiquement les fichiers ajoutÃ©s manuellement.",
        "setting.watcher.debounce.name": "Majoor : DÃ©lai du watcher",
        "setting.watcher.debounce.desc": "Regroupe les Ã©vÃ©nements du watcher pendant N ms avant l'indexation.",
        "setting.watcher.debounce.error": "Ã‰chec de la mise Ã  jour du dÃ©lai du watcher.",
        "setting.watcher.dedupe.name": "Majoor : FenÃªtre de dÃ©duplication du watcher",
        "setting.watcher.dedupe.desc": "DurÃ©e (ms) pendant laquelle un fichier reÃ§u est considÃ©rÃ© comme dÃ©jÃ  traitÃ©.",
        "setting.watcher.dedupe.error": "Ã‰chec de la mise Ã  jour de la fenÃªtre de dÃ©duplication.",
        "setting.sync.rating.name": "Majoor: Sync rating/tags vers fichiers",
        "setting.sync.rating.desc": "Ã‰crire les notes et tags dans les mÃ©tadonnÃ©es des fichiers (ExifTool).",

        // â”€â”€â”€ Settings: Couleurs des badges â”€â”€â”€
        "cat.badgeColors": "Couleurs des badges",
        "setting.starColor": "Couleur des Ã©toiles",
        "setting.starColor.tooltip": "Couleur des Ã©toiles de notation sur les vignettes (hex, ex. #FFD45A)",
        "setting.badgeImageColor": "Couleur badge image",
        "setting.badgeImageColor.tooltip": "Couleur des badges image : PNG, JPG, WEBP, GIF, BMP, TIF (hex)",
        "setting.badgeVideoColor": "Couleur badge vidÃ©o",
        "setting.badgeVideoColor.tooltip": "Couleur des badges vidÃ©o : MP4, WEBM, MOV, AVI, MKV (hex)",
        "setting.badgeAudioColor": "Couleur badge audio",
        "setting.badgeAudioColor.tooltip": "Couleur des badges audio : MP3, WAV, OGG, FLAC (hex)",
        "setting.badgeModel3dColor": "Couleur badge modÃ¨le 3D",
        "setting.badgeModel3dColor.tooltip": "Couleur des badges modÃ¨le 3D : OBJ, FBX, GLB, GLTF (hex)",

        // â”€â”€â”€ Settings: AvancÃ© â”€â”€â”€
        "setting.obs.enabled.name": "Majoor: Activer logs dÃ©taillÃ©s",
        "setting.obs.enabled.desc": "Active les logs dÃ©taillÃ©s cÃ´tÃ© backend pour le debugging.",
        "setting.probe.mode.name": "Majoor: Backend mÃ©tadonnÃ©es",
        "setting.probe.mode.desc": "Choisir l'outil pour extraire les mÃ©tadonnÃ©es des fichiers.",
        "setting.language.name": "Majoor: Langue",
        "setting.language.desc": "Choisir la langue de l'interface Assets Manager. Rechargement requis pour appliquer entiÃ¨rement.",

        // â”€â”€â”€ Settings: SÃ©curitÃ© â”€â”€â”€
        "setting.sec.safe.name": "Majoor: Mode sÃ©curisÃ©",
        "setting.sec.safe.desc": "Quand activÃ©, les Ã©critures rating/tags sont bloquÃ©es sauf autorisation explicite.",
        "setting.sec.remote.name": "Majoor: Autoriser l'accÃ¨s distant complet",
        "setting.sec.remote.desc": "Autorise les clients non locaux Ã  Ã©crire. DÃ©sactiver bloque les Ã©critures sauf si un token est configurÃ©.",
        "setting.sec.write.name": "Majoor: Autoriser Ã©criture",
        "setting.sec.write.desc": "Autorise l'Ã©criture des notes et tags.",
        "setting.sec.del.name": "Majoor: Autoriser suppression",
        "setting.sec.del.desc": "Active la suppression de fichiers.",
        "setting.sec.ren.name": "Majoor: Autoriser renommage",
        "setting.sec.ren.desc": "Active le renommage de fichiers.",
        "setting.sec.open.name": "Majoor: Autoriser ouvrir dans dossier",
        "setting.sec.open.desc": "Active l'ouverture dans le dossier.",
        "setting.sec.reset.name": "Majoor: Autoriser reset index",
        "setting.sec.reset.desc": "Reset le cache d'index et relance un scan complet.",
        "setting.sec.token.name": "Majoor: Token API",
        "setting.sec.token.desc": "Stocke le token d'autorisation pour les Ã©critures. Majoor l'envoie via les en-tÃªtes Authorization et X-MJR-Token.",
        "setting.sec.token.placeholder": "Laisser vide pour dÃ©sactiver.",

        // â”€â”€â”€ Panel: Onglets â”€â”€â”€
        "tab.output": "Sortie",
        "tab.input": "EntrÃ©e",
        "tab.custom": "PersonnalisÃ©",

        // â”€â”€â”€ Panel: Boutons â”€â”€â”€
        "btn.add": "Ajouterâ€¦",
        "btn.remove": "Supprimer",
        "btn.adding": "Ajout...",
        "btn.removing": "Suppression...",
        "btn.retry": "RÃ©essayer",
        "btn.clear": "Effacer",
        "btn.refresh": "Actualiser",
        "btn.scan": "Scanner",
        "btn.scanning": "Scan...",
        "btn.resetIndex": "RÃ©initialiser l'index",
        "btn.resetting": "RÃ©initialisation...",
        "btn.deleteDb": "Supprimer BDD",
        "btn.deletingDb": "Suppression BDD...",
        "btn.retryServices": "RÃ©essayer services",
        "btn.retrying": "RÃ©essai...",
        "btn.loadWorkflow": "Charger le workflow",
        "btn.copyPrompt": "Copier le prompt",
        "btn.close": "Fermer",

        // â”€â”€â”€ Panel: Labels â”€â”€â”€
        "label.folder": "Dossier",
        "label.type": "Type",
        "label.workflow": "Workflow",
        "label.rating": "Note",
        "label.dateRange": "PÃ©riode",
        "label.agenda": "Agenda",
        "label.sort": "Trier",
        "label.collections": "Collections",
        "label.filters": "Filtres",
        "label.selectFolder": "SÃ©lectionner un dossierâ€¦",
        "label.thisFolder": "ce dossier",

        // â”€â”€â”€ Panel: Filtres â”€â”€â”€
        "filter.all": "Tout",
        "filter.images": "Images",
        "filter.videos": "VidÃ©os",
        "filter.onlyWithWorkflow": "Avec workflow uniquement",
        "filter.anyRating": "Toutes notes",
        "filter.minStars": "{n}+ Ã©toiles",
        "filter.anytime": "Toutes dates",
        "filter.today": "Aujourd'hui",
        "filter.yesterday": "Hier",
        "filter.thisWeek": "Cette semaine",
        "filter.thisMonth": "Ce mois",
        "filter.last7days": "7 derniers jours",
        "filter.last30days": "30 derniers jours",

        // â”€â”€â”€ Panel: Tri â”€â”€â”€
        "sort.newest": "Plus rÃ©cent",
        "sort.oldest": "Plus ancien",
        "sort.nameAZ": "Nom A-Z",
        "sort.nameZA": "Nom Z-A",
        "sort.ratingHigh": "Note (haute)",
        "sort.ratingLow": "Note (basse)",
        "sort.sizeDesc": "Taille (grand)",
        "sort.sizeAsc": "Taille (petit)",

        // â”€â”€â”€ Panel: Statut â”€â”€â”€
        "status.checking": "VÃ©rification...",
        "status.ready": "PrÃªt",
        "status.scanning": "Scan en cours...",
        "status.error": "Erreur",
        "status.capabilities": "CapacitÃ©s",
        "status.toolStatus": "Ã‰tat des outils",
        "status.selectCustomFolder": "SÃ©lectionnez d'abord un dossier personnalisÃ©",
        "status.errorGetConfig": "Erreur: Impossible d'obtenir la config",
        "status.discoveringTools": "CapacitÃ©s: dÃ©couverte des outils...",
        "status.indexStatus": "Ã‰tat de l'index",
        "status.toolStatusChecking": "Ã‰tat des outils: vÃ©rification...",
        "status.resetIndexHint": "RÃ©initialiser le cache d'index (nÃ©cessite allowResetIndex dans les paramÃ¨tres).",
        "status.scanningHint": "Cela peut prendre un moment",
        "status.toolAvailable": "{tool} disponible",
        "status.toolUnavailable": "{tool} indisponible",
        "status.unknown": "inconnu",
        "status.available": "disponible",
        "status.missing": "manquant",
        "status.path": "Chemin",
        "status.pathAuto": "auto / non configurÃ©",
        "status.noAssets": "Aucun asset indexÃ© ({scope})",
        "status.clickToScan": "Cliquez sur le point pour lancer un scan",
        "status.assetsIndexed": "{count} assets indexÃ©s ({scope})",
        "status.imagesVideos": "Images: {images}  -  VidÃ©os: {videos}",
        "status.withWorkflows": "Avec workflows: {workflows}  -  DonnÃ©es de gÃ©nÃ©ration: {gendata}",
        "status.dbSize": "Taille de la base: {size}",
        "status.lastScan": "Dernier scan: {date}",
        "status.scanStats": "AjoutÃ©s: {added}  -  Mis Ã  jour: {updated}  -  IgnorÃ©s: {skipped}",
        "status.watcher.enabled": "Watcher : activÃ©",
        "status.watcher.enabledScoped": "Watcher : activÃ© ({scope})",
        "status.watcher.disabled": "Watcher : dÃ©sactivÃ©",
        "status.watcher.disabledScoped": "Watcher : dÃ©sactivÃ© ({scope})",
        "status.apiNotFound": "Endpoints API Majoor introuvables (404)",
        "status.apiNotFoundHint": "Les routes backend ne sont pas chargÃ©es. RedÃ©marrez ComfyUI et vÃ©rifiez le terminal pour les erreurs d'import Majoor.",
        "status.errorChecking": "Erreur lors de la vÃ©rification",
        "status.dbCorrupted": "Base de donnÃ©es corrompue",
        "status.dbCorruptedHint": "Utilisez le bouton Â« Supprimer la BDD Â» ci-dessous pour forcer la suppression et reconstruire l'index.",
        "status.retryFailed": "Ã‰chec de la relance",

        // â”€â”€â”€ Scopes â”€â”€â”€
        "scope.all": "EntrÃ©es + Sorties",
        "scope.allFull": "Tout (EntrÃ©es + Sorties)",
        "scope.input": "EntrÃ©es",
        "scope.output": "Sorties",
        "scope.custom": "PersonnalisÃ©",

        // â”€â”€â”€ Outils â”€â”€â”€
        "tool.exiftool": "MÃ©tadonnÃ©es ExifTool",
        "tool.exiftool.hint": "DonnÃ©es workflow PNG/WEBP (via ExifTool)",
        "tool.ffprobe": "Stats vidÃ©o FFprobe",
        "tool.ffprobe.hint": "DurÃ©e, FPS et rÃ©solution vidÃ©o (via FFprobe)",

        // â”€â”€â”€ Panel: Messages â”€â”€â”€
        "msg.noCollections": "Aucune collection.",
        "msg.addCustomFolder": "Ajoutez un dossier personnalisÃ© Ã  parcourir.",
        "msg.noResults": "Aucun rÃ©sultat.",
        "msg.loading": "Chargement...",
        "msg.errorLoading": "Erreur de chargement",
        "msg.errorLoadingFolders": "Erreur de chargement des dossiers",
        "msg.noGenerationData": "Aucune donnÃ©e de gÃ©nÃ©ration pour ce fichier.",
        "msg.rawMetadata": "MÃ©tadonnÃ©es brutes",

        // â”€â”€â”€ Visionneuse â”€â”€â”€
        "viewer.genInfo": "Infos de gÃ©nÃ©ration",
        "viewer.workflow": "Workflow",
        "viewer.metadata": "MÃ©tadonnÃ©es",
        "viewer.noWorkflow": "Pas de workflow",
        "viewer.noMetadata": "Aucune mÃ©tadonnÃ©e disponible",
        "viewer.copySuccess": "CopiÃ© dans le presse-papier !",
        "viewer.copyFailed": "Ã‰chec de la copie",

        // â”€â”€â”€ Sidebar â”€â”€â”€
        "sidebar.details": "DÃ©tails",
        "sidebar.preview": "AperÃ§u",
        "sidebar.rating": "Note",
        "sidebar.tags": "Tags",
        "sidebar.addTag": "Ajouter un tag...",
        "sidebar.noTags": "Aucun tag",
        "sidebar.filename": "Nom du fichier",
        "sidebar.dimensions": "Dimensions",
        "sidebar.date": "Date",
        "sidebar.size": "Taille",
        "sidebar.genTime": "Temps de gÃ©nÃ©ration",

        // â”€â”€â”€ Menu contextuel â”€â”€â”€
        "ctx.openViewer": "Ouvrir dans la visionneuse",
        "ctx.loadWorkflow": "Charger le workflow",
        "ctx.copyPath": "Copier le chemin",
        "ctx.openInFolder": "Ouvrir dans le dossier",
        "ctx.rename": "Renommer",
        "ctx.delete": "Supprimer",
        "ctx.addToCollection": "Ajouter Ã  la collection",
        "ctx.removeFromCollection": "Retirer de la collection",
        "ctx.newCollection": "Nouvelle collection...",
        "ctx.rescanMetadata": "Rescanner les mÃ©tadonnÃ©es",
        "ctx.createCollection": "CrÃ©er une collection...",
        "ctx.exitCollection": "Quitter la vue collection",

        // â”€â”€â”€ Dialogues â”€â”€â”€
        "dialog.confirm": "Confirmer",
        "dialog.cancel": "Annuler",
        "dialog.delete.title": "Supprimer le fichier ?",
        "dialog.delete.msg": "ÃŠtes-vous sÃ»r de vouloir supprimer ce fichier ? Cette action est irrÃ©versible.",
        "dialog.rename.title": "Renommer le fichier",
        "dialog.rename.placeholder": "Nouveau nom",
        "dialog.newCollection.title": "Nouvelle collection",
        "dialog.newCollection.placeholder": "Nom de la collection",
        "dialog.resetIndex.title": "RÃ©initialiser l'index ?",
        "dialog.resetIndex.msg": "Cela supprimera la base de donnÃ©es et rescannera tous les fichiers. Continuer ?",
        "dialog.securityWarning": "Cela ressemble Ã  un dossier systÃ¨me ou trÃ¨s large.\n\nL'ajouter peut exposer des fichiers sensibles via la fonctionnalitÃ© de dossiers personnalisÃ©s.\n\nContinuer ?",
        "dialog.securityWarningTitle": "Majoor: Avertissement de sÃ©curitÃ©",
        "dialog.enterFolderPath": "Entrez le chemin d'un dossier Ã  ajouter comme racine personnalisÃ©e :",
        "dialog.customFoldersTitle": "Majoor: Dossiers personnalisÃ©s",
        "dialog.removeFolder": "Supprimer le dossier personnalisÃ© \"{name}\" ?",
        "dialog.deleteCollection": "Supprimer la collection \"{name}\" ?",
        "dialog.createCollection": "CrÃ©er une collection",
        "dialog.collectionPlaceholder": "Ma collection",

        // â”€â”€â”€ Toasts â”€â”€â”€
        "toast.scanStarted": "Scan dÃ©marrÃ©",
        "toast.scanComplete": "Scan terminÃ©",
        "toast.scanFailed": "Ã‰chec du scan",
        "toast.resetTriggered": "RÃ©initialisation : RÃ©indexation de tous les fichiers...",
        "toast.resetStarted": "RÃ©initialisation dÃ©marrÃ©e. Les fichiers seront rÃ©indexÃ©s en arriÃ¨re-plan.",
        "toast.resetFailed": "Ã‰chec de la rÃ©initialisation de l'index",
        "toast.resetFailedCorrupt": "Ã‰chec de la rÃ©initialisation â€” base de donnÃ©es corrompue. Utilisez le bouton Â« Supprimer la BDD Â» pour forcer la suppression et reconstruire.",
        "toast.dbDeleteTriggered": "Suppression de la base et reconstruction...",
        "toast.dbDeleteSuccess": "Base supprimÃ©e et reconstruite. Les fichiers sont en cours de rÃ©indexation.",
        "toast.dbDeleteFailed": "Ã‰chec de la suppression de la base",
        "dialog.dbDelete.confirm": "Cela supprimera dÃ©finitivement la base de donnÃ©es d'index et la reconstruira. Toutes les notes, tags et mÃ©tadonnÃ©es seront perdus.\n\nContinuer ?",
        "toast.deleted": "Fichier supprimÃ©",
        "toast.renamed": "Fichier renommÃ©",
        "toast.addedToCollection": "AjoutÃ© Ã  la collection",
        "toast.removedFromCollection": "RetirÃ© de la collection",
        "toast.collectionCreated": "Collection crÃ©Ã©e",
        "toast.permissionDenied": "Permission refusÃ©e",
        "toast.tagAdded": "Tag ajoutÃ©",
        "toast.tagRemoved": "Tag supprimÃ©",
        "toast.ratingSaved": "Note enregistrÃ©e",
        "toast.failedAddFolder": "Ã‰chec de l'ajout du dossier personnalisÃ©",
        "toast.failedRemoveFolder": "Ã‰chec de la suppression du dossier personnalisÃ©",
        "toast.folderLinked": "Dossier liÃ© avec succÃ¨s",
        "toast.folderRemoved": "Dossier supprimÃ©",
        "toast.nativeBrowserUnavailable": "Explorateur natif indisponible. Veuillez entrer le chemin manuellement.",
        "toast.errorAddingFolder": "Erreur lors de l'ajout du dossier personnalisÃ©",
        "toast.errorRemovingFolder": "Erreur lors de la suppression du dossier personnalisÃ©",
        "toast.failedCreateCollection": "Ã‰chec de la crÃ©ation de la collection",
        "toast.failedDeleteCollection": "Ã‰chec de la suppression de la collection",
        "toast.languageChanged": "Langue modifiÃ©e. Rechargez la page pour une application complÃ¨te.",
        "toast.ratingUpdateFailed": "Ã‰chec de la mise Ã  jour de la note",
        "toast.ratingUpdateError": "Erreur lors de la mise Ã  jour de la note",
        "toast.tagsUpdateFailed": "Ã‰chec de la mise Ã  jour des tags",
        "toast.watcherToggleFailed": "Ã‰chec de l'activation/dÃ©sactivation du watcher",
        "toast.noValidAssetsSelected": "Aucun asset valide sÃ©lectionnÃ©.",
        "toast.failedCreateCollectionDot": "Ã‰chec de la crÃ©ation de la collection.",
        "toast.failedAddAssetsToCollection": "Ã‰chec de l'ajout des assets Ã  la collection.",
        "toast.removeFromCollectionFailed": "Ã‰chec du retrait de la collection.",
        "toast.copyClipboardFailed": "Ã‰chec de la copie dans le presse-papiers",
        "toast.metadataRefreshFailed": "Ã‰chec du rafraÃ®chissement des mÃ©tadonnÃ©es.",
        "toast.ratingCleared": "Note effacÃ©e",
        "toast.ratingSetN": "Note rÃ©glÃ©e Ã  {n} Ã©toiles",
        "toast.tagsUpdated": "Tags mis Ã  jour",
        "toast.fileRenamedSuccess": "Fichier renommÃ© avec succÃ¨s !",
        "toast.fileRenameFailed": "Ã‰chec du renommage du fichier.",
        "toast.fileDeletedSuccess": "Fichier supprimÃ© avec succÃ¨s !",
        "toast.fileDeleteFailed": "Ã‰chec de la suppression du fichier.",
        "toast.openedInFolder": "Ouvert dans le dossier",
        "toast.openFolderFailed": "Ã‰chec de l'ouverture du dossier.",
        "toast.pathCopied": "Chemin copiÃ© dans le presse-papiers",
        "toast.pathCopyFailed": "Ã‰chec de la copie du chemin",
        "toast.noFilePath": "Aucun chemin de fichier disponible pour cet asset.",
        "toast.downloadingFile": "TÃ©lÃ©chargement de {filename}...",
        "toast.playbackRate": "Lecture {rate}x",
        "toast.metadataRefreshed": "MÃ©tadonnÃ©es rafraÃ®chies{suffix}",
        "toast.enrichmentComplete": "Enrichissement des mÃ©tadonnÃ©es terminÃ©",
        "toast.errorRenaming": "Erreur de renommage du fichier : {error}",
        "toast.errorDeleting": "Erreur de suppression du fichier : {error}",
        "toast.tagMergeFailed": "Ã‰chec de fusion des tags : {error}",
        "toast.deleteFailed": "Ã‰chec de suppression : {error}",
        "toast.analysisNotStarted": "Analyse non dÃ©marrÃ©e : {error}",
        "toast.dupAnalysisStarted": "Analyse de doublons dÃ©marrÃ©e",
        "toast.tagsMerged": "Tags fusionnÃ©s",
        "toast.duplicatesDeleted": "Doublons supprimÃ©s",
        "toast.playbackVideoOnly": "La vitesse de lecture est disponible uniquement pour les vidÃ©os",
        "toast.filesDeletedSuccessN": "{n} fichiers supprimÃ©s avec succÃ¨s !",
        "toast.filesDeletedPartial": "{success} fichiers supprimÃ©s, {failed} en Ã©chec.",
        "toast.filesDeletedShort": "{n} fichiers supprimÃ©s",
        "toast.filesDeletedShortPartial": "{success} supprimÃ©s, {failed} en Ã©chec",
        "toast.copiedToClipboardNamed": "{name} copiÃ© dans le presse-papiers !",
        "toast.rescanningFile": "Rescan du fichierâ€¦",

        // â”€â”€â”€ Raccourcis â”€â”€â”€
        // Clés manquantes remontées par le runtime
        "cat.search": "Recherche",
        "setting.badgeDuplicateAlertColor": "Couleur badge alerte doublon",
        "setting.badgeDuplicateAlertColor.tooltip": "Couleur d'alerte utilisée quand un badge d'extension dupliquée est affiché (ex. PNG+).",
        "setting.grid.videoAutoplayMode.name": "Majoor : Lecture auto vidéo",
        "setting.grid.videoAutoplayMode.desc": "Contrôle la lecture des miniatures vidéo dans la grille. Off : image fixe. Hover : lecture au survol. Always : boucle tant que visible.",
        "setting.grid.videoAutoplayMode.off": "Off",
        "setting.grid.videoAutoplayMode.hover": "Survol",
        "setting.grid.videoAutoplayMode.always": "Toujours",
        "setting.watcher.enabled.label": "Watcher activé",
        "setting.watcher.debounce.label": "Délai watcher (ms)",
        "setting.watcher.dedupe.label": "Fenêtre déduplication watcher (ms)",
        "setting.search.maxResults.name": "Majoor : Résultats max de recherche",
        "setting.search.maxResults.desc": "Nombre maximum de résultats renvoyés par les endpoints de recherche.",
        "btn.dbSave": "Sauvegarder BDD",
        "btn.dbRestore": "Restaurer BDD",
        "status.dbBackupSelectHint": "Sélectionnez une sauvegarde BDD à restaurer",
        "status.dbBackupLoading": "Chargement des sauvegardes BDD...",
        "status.dbSaveHint": "Créer maintenant un snapshot de sauvegarde de la BDD.",
        "status.dbRestoreHint": "Restaurer la sauvegarde BDD sélectionnée et relancer l'indexation.",
        "status.dbHealthOk": "Santé BDD : OK",
        "status.indexHealthOk": "Santé index : OK",
        "status.toast.info": "État index : vérification",
        "status.toast.success": "État index : prêt",
        "status.toast.warning": "État index : attention requise",
        "status.toast.error": "État index : erreur",
        "hotkey.scan": "Scanner (S)",
        "hotkey.search": "Rechercher (Ctrl+F)",
        "hotkey.details": "Afficher dÃ©tails (D)",
        "hotkey.delete": "Supprimer (Suppr)",
        "hotkey.viewer": "Ouvrir visionneuse (EntrÃ©e)",
        "hotkey.escape": "Fermer (Ã‰chap)",
    }
};

const LANGUAGE_NAMES = Object.freeze({
    "en-US": "English",
    "fr-FR": "FranÃ§ais",
    "zh-CN": "Chinese (Simplified)",
    "ja-JP": "Japanese",
    "ko-KR": "Korean",
    "hi-IN": "Hindi",
    "pt-PT": "Portuguese",
    "es-ES": "Spanish",
    "ru-RU": "Russian",
});

// Register additional locales with safe fallback to English until translated keys are added.
[
    "zh-CN",
    "ja-JP",
    "ko-KR",
    "hi-IN",
    "pt-PT",
    "es-ES",
    "ru-RU",
].forEach((code) => {
    if (!DICTIONARY[code]) DICTIONARY[code] = {};
});

const CORE_TRANSLATIONS = {
    "en-US": {
        "tab.custom": "Browser",
        "scope.custom": "Browser",
        "scope.customBrowser": "Browser",
    },
    "fr-FR": {
        "tab.custom": "Navigateur",
        "scope.custom": "Navigateur",
        "scope.customBrowser": "Navigateur",
    },
    "zh-CN": {
        "cat.grid": "ç½‘æ ¼",
        "cat.cards": "å¡ç‰‡",
        "cat.badges": "å¾½ç« ",
        "cat.viewer": "æŸ¥çœ‹å™¨",
        "cat.scanning": "æ‰«æ",
        "cat.advanced": "é«˜çº§",
        "cat.security": "å®‰å…¨",
        "cat.remote": "è¿œç¨‹è®¿é—®",
        "setting.language.name": "Majoor: è¯­è¨€",
        "setting.language.desc": "é€‰æ‹© Assets Manager ç•Œé¢è¯­è¨€ã€‚å®Œæ•´åº”ç”¨éœ€é‡æ–°åŠ è½½ã€‚",
        "tab.output": "è¾“å‡º",
        "tab.input": "è¾“å…¥",
        "tab.custom": "è‡ªå®šä¹‰",
        "btn.add": "æ·»åŠ â€¦",
        "btn.remove": "ç§»é™¤",
        "btn.retry": "é‡è¯•",
        "btn.clear": "æ¸…é™¤",
        "btn.refresh": "åˆ·æ–°",
        "btn.scan": "æ‰«æ",
        "btn.close": "å…³é—­",
        "label.folder": "æ–‡ä»¶å¤¹",
        "label.type": "ç±»åž‹",
        "label.workflow": "å·¥ä½œæµ",
        "label.rating": "è¯„åˆ†",
        "label.dateRange": "æ—¥æœŸèŒƒå›´",
        "label.sort": "æŽ’åº",
        "label.filters": "ç­›é€‰",
        "filter.all": "å…¨éƒ¨",
        "filter.images": "å›¾ç‰‡",
        "filter.videos": "è§†é¢‘",
        "filter.onlyWithWorkflow": "ä»…æœ‰å·¥ä½œæµ",
        "filter.anyRating": "ä»»æ„è¯„åˆ†",
        "filter.anytime": "ä»»ä½•æ—¶é—´",
        "filter.today": "ä»Šå¤©",
        "filter.yesterday": "æ˜¨å¤©",
        "sort.newest": "æœ€æ–°ä¼˜å…ˆ",
        "sort.oldest": "æœ€æ—§ä¼˜å…ˆ",
        "sort.nameAZ": "åç§° A-Z",
        "sort.nameZA": "åç§° Z-A",
        "status.ready": "å°±ç»ª",
        "status.scanning": "æ‰«æä¸­...",
        "status.error": "é”™è¯¯",
        "msg.noResults": "æœªæ‰¾åˆ°ç»“æžœã€‚",
        "msg.loading": "åŠ è½½ä¸­...",
        "msg.addCustomFolder": "æ·»åŠ ä¸€ä¸ªè‡ªå®šä¹‰æ–‡ä»¶å¤¹ä»¥æµè§ˆã€‚",
        "msg.errorLoading": "åŠ è½½é”™è¯¯",
        "sidebar.details": "è¯¦æƒ…",
        "sidebar.preview": "é¢„è§ˆ",
        "sidebar.rating": "è¯„åˆ†",
        "sidebar.tags": "æ ‡ç­¾",
        "ctx.openViewer": "åœ¨æŸ¥çœ‹å™¨ä¸­æ‰“å¼€",
        "ctx.copyPath": "å¤åˆ¶è·¯å¾„",
        "ctx.openInFolder": "åœ¨æ–‡ä»¶å¤¹ä¸­æ‰“å¼€",
        "ctx.rename": "é‡å‘½å",
        "ctx.delete": "åˆ é™¤",
        "toast.ratingUpdateFailed": "æ›´æ–°è¯„åˆ†å¤±è´¥",
        "toast.tagsUpdated": "æ ‡ç­¾å·²æ›´æ–°",
        "toast.pathCopied": "è·¯å¾„å·²å¤åˆ¶åˆ°å‰ªè´´æ¿",
    },
    "ja-JP": {
        "cat.grid": "ã‚°ãƒªãƒƒãƒ‰",
        "cat.cards": "ã‚«ãƒ¼ãƒ‰",
        "cat.badges": "ãƒãƒƒã‚¸",
        "cat.viewer": "ãƒ“ãƒ¥ãƒ¼ã‚¢",
        "cat.scanning": "ã‚¹ã‚­ãƒ£ãƒ³",
        "cat.advanced": "è©³ç´°è¨­å®š",
        "cat.security": "ã‚»ã‚­ãƒ¥ãƒªãƒ†ã‚£",
        "cat.remote": "ãƒªãƒ¢ãƒ¼ãƒˆã‚¢ã‚¯ã‚»ã‚¹",
        "setting.language.name": "Majoor: è¨€èªž",
        "setting.language.desc": "Assets Manager ã®è¡¨ç¤ºè¨€èªžã‚’é¸æŠžã—ã¾ã™ã€‚å®Œå…¨é©ç”¨ã«ã¯å†èª­ã¿è¾¼ã¿ãŒå¿…è¦ã§ã™ã€‚",
        "tab.output": "å‡ºåŠ›",
        "tab.input": "å…¥åŠ›",
        "tab.custom": "ã‚«ã‚¹ã‚¿ãƒ ",
        "btn.add": "è¿½åŠ â€¦",
        "btn.remove": "å‰Šé™¤",
        "btn.retry": "å†è©¦è¡Œ",
        "btn.clear": "ã‚¯ãƒªã‚¢",
        "btn.refresh": "æ›´æ–°",
        "btn.scan": "ã‚¹ã‚­ãƒ£ãƒ³",
        "btn.close": "é–‰ã˜ã‚‹",
        "label.folder": "ãƒ•ã‚©ãƒ«ãƒ€",
        "label.type": "ç¨®é¡ž",
        "label.workflow": "ãƒ¯ãƒ¼ã‚¯ãƒ•ãƒ­ãƒ¼",
        "label.rating": "è©•ä¾¡",
        "label.dateRange": "æ—¥ä»˜ç¯„å›²",
        "label.sort": "ä¸¦ã³æ›¿ãˆ",
        "label.filters": "ãƒ•ã‚£ãƒ«ã‚¿ãƒ¼",
        "filter.all": "ã™ã¹ã¦",
        "filter.images": "ç”»åƒ",
        "filter.videos": "å‹•ç”»",
        "filter.onlyWithWorkflow": "ãƒ¯ãƒ¼ã‚¯ãƒ•ãƒ­ãƒ¼ã‚ã‚Šã®ã¿",
        "filter.anyRating": "ã™ã¹ã¦ã®è©•ä¾¡",
        "filter.anytime": "æœŸé–“æŒ‡å®šãªã—",
        "filter.today": "ä»Šæ—¥",
        "filter.yesterday": "æ˜¨æ—¥",
        "sort.newest": "æ–°ã—ã„é †",
        "sort.oldest": "å¤ã„é †",
        "sort.nameAZ": "åå‰ A-Z",
        "sort.nameZA": "åå‰ Z-A",
        "status.ready": "æº–å‚™å®Œäº†",
        "status.scanning": "ã‚¹ã‚­ãƒ£ãƒ³ä¸­...",
        "status.error": "ã‚¨ãƒ©ãƒ¼",
        "msg.noResults": "çµæžœãŒè¦‹ã¤ã‹ã‚Šã¾ã›ã‚“ã€‚",
        "msg.loading": "èª­ã¿è¾¼ã¿ä¸­...",
        "msg.addCustomFolder": "å‚ç…§ã™ã‚‹ã‚«ã‚¹ã‚¿ãƒ ãƒ•ã‚©ãƒ«ãƒ€ã‚’è¿½åŠ ã—ã¦ãã ã•ã„ã€‚",
        "msg.errorLoading": "èª­ã¿è¾¼ã¿ã‚¨ãƒ©ãƒ¼",
        "sidebar.details": "è©³ç´°",
        "sidebar.preview": "ãƒ—ãƒ¬ãƒ“ãƒ¥ãƒ¼",
        "sidebar.rating": "è©•ä¾¡",
        "sidebar.tags": "ã‚¿ã‚°",
        "ctx.openViewer": "ãƒ“ãƒ¥ãƒ¼ã‚¢ã§é–‹ã",
        "ctx.copyPath": "ãƒ‘ã‚¹ã‚’ã‚³ãƒ”ãƒ¼",
        "ctx.openInFolder": "ãƒ•ã‚©ãƒ«ãƒ€ã§é–‹ã",
        "ctx.rename": "åå‰å¤‰æ›´",
        "ctx.delete": "å‰Šé™¤",
        "toast.ratingUpdateFailed": "è©•ä¾¡ã®æ›´æ–°ã«å¤±æ•—ã—ã¾ã—ãŸ",
        "toast.tagsUpdated": "ã‚¿ã‚°ã‚’æ›´æ–°ã—ã¾ã—ãŸ",
        "toast.pathCopied": "ãƒ‘ã‚¹ã‚’ã‚¯ãƒªãƒƒãƒ—ãƒœãƒ¼ãƒ‰ã«ã‚³ãƒ”ãƒ¼ã—ã¾ã—ãŸ",
    },
    "ko-KR": {
        "cat.grid": "ê·¸ë¦¬ë“œ",
        "cat.cards": "ì¹´ë“œ",
        "cat.badges": "ë°°ì§€",
        "cat.viewer": "ë·°ì–´",
        "cat.scanning": "ìŠ¤ìº”",
        "cat.advanced": "ê³ ê¸‰",
        "cat.security": "ë³´ì•ˆ",
        "cat.remote": "ì›ê²© ì•¡ì„¸ìŠ¤",
        "setting.language.name": "Majoor: ì–¸ì–´",
        "setting.language.desc": "Assets Manager ì¸í„°íŽ˜ì´ìŠ¤ ì–¸ì–´ë¥¼ ì„ íƒí•©ë‹ˆë‹¤. ì™„ì „ ì ìš©í•˜ë ¤ë©´ ìƒˆë¡œê³ ì¹¨ì´ í•„ìš”í•©ë‹ˆë‹¤.",
        "tab.output": "ì¶œë ¥",
        "tab.input": "ìž…ë ¥",
        "tab.custom": "ì‚¬ìš©ìž ì§€ì •",
        "btn.add": "ì¶”ê°€â€¦",
        "btn.remove": "ì œê±°",
        "btn.retry": "ë‹¤ì‹œ ì‹œë„",
        "btn.clear": "ì§€ìš°ê¸°",
        "btn.refresh": "ìƒˆë¡œê³ ì¹¨",
        "btn.scan": "ìŠ¤ìº”",
        "btn.close": "ë‹«ê¸°",
        "label.folder": "í´ë”",
        "label.type": "ìœ í˜•",
        "label.workflow": "ì›Œí¬í”Œë¡œìš°",
        "label.rating": "í‰ì ",
        "label.dateRange": "ë‚ ì§œ ë²”ìœ„",
        "label.sort": "ì •ë ¬",
        "label.filters": "í•„í„°",
        "filter.all": "ì „ì²´",
        "filter.images": "ì´ë¯¸ì§€",
        "filter.videos": "ë™ì˜ìƒ",
        "filter.onlyWithWorkflow": "ì›Œí¬í”Œë¡œìš°ë§Œ",
        "filter.anyRating": "ëª¨ë“  í‰ì ",
        "filter.anytime": "ì „ì²´ ê¸°ê°„",
        "filter.today": "ì˜¤ëŠ˜",
        "filter.yesterday": "ì–´ì œ",
        "sort.newest": "ìµœì‹ ìˆœ",
        "sort.oldest": "ì˜¤ëž˜ëœìˆœ",
        "sort.nameAZ": "ì´ë¦„ A-Z",
        "sort.nameZA": "ì´ë¦„ Z-A",
        "status.ready": "ì¤€ë¹„ë¨",
        "status.scanning": "ìŠ¤ìº” ì¤‘...",
        "status.error": "ì˜¤ë¥˜",
        "msg.noResults": "ê²°ê³¼ê°€ ì—†ìŠµë‹ˆë‹¤.",
        "msg.loading": "ë¡œë”© ì¤‘...",
        "msg.addCustomFolder": "ì°¾ì•„ë³¼ ì‚¬ìš©ìž ì§€ì • í´ë”ë¥¼ ì¶”ê°€í•˜ì„¸ìš”.",
        "msg.errorLoading": "ë¡œë“œ ì˜¤ë¥˜",
        "sidebar.details": "ì„¸ë¶€ì •ë³´",
        "sidebar.preview": "ë¯¸ë¦¬ë³´ê¸°",
        "sidebar.rating": "í‰ì ",
        "sidebar.tags": "íƒœê·¸",
        "ctx.openViewer": "ë·°ì–´ì—ì„œ ì—´ê¸°",
        "ctx.copyPath": "ê²½ë¡œ ë³µì‚¬",
        "ctx.openInFolder": "í´ë”ì—ì„œ ì—´ê¸°",
        "ctx.rename": "ì´ë¦„ ë°”ê¾¸ê¸°",
        "ctx.delete": "ì‚­ì œ",
        "toast.ratingUpdateFailed": "í‰ì  ì—…ë°ì´íŠ¸ ì‹¤íŒ¨",
        "toast.tagsUpdated": "íƒœê·¸ê°€ ì—…ë°ì´íŠ¸ë˜ì—ˆìŠµë‹ˆë‹¤",
        "toast.pathCopied": "ê²½ë¡œê°€ í´ë¦½ë³´ë“œì— ë³µì‚¬ë˜ì—ˆìŠµë‹ˆë‹¤",
    },
    "hi-IN": {
        "cat.grid": "à¤—à¥à¤°à¤¿à¤¡",
        "cat.cards": "à¤•à¤¾à¤°à¥à¤¡",
        "cat.badges": "à¤¬à¥ˆà¤œ",
        "cat.viewer": "à¤µà¥à¤¯à¥‚à¤…à¤°",
        "cat.scanning": "à¤¸à¥à¤•à¥ˆà¤¨à¤¿à¤‚à¤—",
        "cat.advanced": "à¤‰à¤¨à¥à¤¨à¤¤",
        "cat.security": "à¤¸à¥à¤°à¤•à¥à¤·à¤¾",
        "cat.remote": "à¤°à¤¿à¤®à¥‹à¤Ÿ à¤à¤•à¥à¤¸à¥‡à¤¸",
        "setting.language.name": "Majoor: à¤­à¤¾à¤·à¤¾",
        "setting.language.desc": "Assets Manager à¤‡à¤‚à¤Ÿà¤°à¤«à¤¼à¥‡à¤¸ à¤•à¥€ à¤­à¤¾à¤·à¤¾ à¤šà¥à¤¨à¥‡à¤‚à¥¤ à¤ªà¥‚à¤°à¥€ à¤¤à¤°à¤¹ à¤²à¤¾à¤—à¥‚ à¤•à¤°à¤¨à¥‡ à¤¹à¥‡à¤¤à¥ à¤°à¥€à¤²à¥‹à¤¡ à¤†à¤µà¤¶à¥à¤¯à¤• à¤¹à¥ˆà¥¤",
        "tab.output": "à¤†à¤‰à¤Ÿà¤ªà¥à¤Ÿ",
        "tab.input": "à¤‡à¤¨à¤ªà¥à¤Ÿ",
        "tab.custom": "à¤•à¤¸à¥à¤Ÿà¤®",
        "btn.add": "à¤œà¥‹à¤¡à¤¼à¥‡à¤‚â€¦",
        "btn.remove": "à¤¹à¤Ÿà¤¾à¤à¤‚",
        "btn.retry": "à¤ªà¥à¤¨à¤ƒ à¤ªà¥à¤°à¤¯à¤¾à¤¸",
        "btn.clear": "à¤¸à¤¾à¤«à¤¼ à¤•à¤°à¥‡à¤‚",
        "btn.refresh": "à¤°à¤¿à¤«à¥à¤°à¥‡à¤¶",
        "btn.scan": "à¤¸à¥à¤•à¥ˆà¤¨",
        "btn.close": "à¤¬à¤‚à¤¦ à¤•à¤°à¥‡à¤‚",
        "label.folder": "à¤«à¤¼à¥‹à¤²à¥à¤¡à¤°",
        "label.type": "à¤ªà¥à¤°à¤•à¤¾à¤°",
        "label.workflow": "à¤µà¤°à¥à¤•à¤«à¤¼à¥à¤²à¥‹",
        "label.rating": "à¤°à¥‡à¤Ÿà¤¿à¤‚à¤—",
        "label.dateRange": "à¤¤à¤¿à¤¥à¤¿ à¤¸à¥€à¤®à¤¾",
        "label.sort": "à¤•à¥à¤°à¤®à¤¬à¤¦à¥à¤§ à¤•à¤°à¥‡à¤‚",
        "label.filters": "à¤«à¤¼à¤¿à¤²à¥à¤Ÿà¤°",
        "filter.all": "à¤¸à¤­à¥€",
        "filter.images": "à¤›à¤µà¤¿à¤¯à¤¾à¤‚",
        "filter.videos": "à¤µà¥€à¤¡à¤¿à¤¯à¥‹",
        "filter.onlyWithWorkflow": "à¤¸à¤¿à¤°à¥à¤«à¤¼ à¤µà¤°à¥à¤•à¤«à¤¼à¥à¤²à¥‹ à¤µà¤¾à¤²à¥‡",
        "filter.anyRating": "à¤•à¥‹à¤ˆ à¤­à¥€ à¤°à¥‡à¤Ÿà¤¿à¤‚à¤—",
        "filter.anytime": "à¤•à¤­à¥€ à¤­à¥€",
        "filter.today": "à¤†à¤œ",
        "filter.yesterday": "à¤•à¤²",
        "sort.newest": "à¤¨à¤µà¥€à¤¨à¤¤à¤® à¤ªà¤¹à¤²à¥‡",
        "sort.oldest": "à¤ªà¥à¤°à¤¾à¤¨à¤¾ à¤ªà¤¹à¤²à¥‡",
        "sort.nameAZ": "à¤¨à¤¾à¤® A-Z",
        "sort.nameZA": "à¤¨à¤¾à¤® Z-A",
        "status.ready": "à¤¤à¥ˆà¤¯à¤¾à¤°",
        "status.scanning": "à¤¸à¥à¤•à¥ˆà¤¨ à¤¹à¥‹ à¤°à¤¹à¤¾ à¤¹à¥ˆ...",
        "status.error": "à¤¤à¥à¤°à¥à¤Ÿà¤¿",
        "msg.noResults": "à¤•à¥‹à¤ˆ à¤ªà¤°à¤¿à¤£à¤¾à¤® à¤¨à¤¹à¥€à¤‚ à¤®à¤¿à¤²à¤¾à¥¤",
        "msg.loading": "à¤²à¥‹à¤¡ à¤¹à¥‹ à¤°à¤¹à¤¾ à¤¹à¥ˆ...",
        "msg.addCustomFolder": "à¤¬à¥à¤°à¤¾à¤‰à¤œà¤¼ à¤•à¤°à¤¨à¥‡ à¤•à¥‡ à¤²à¤¿à¤ à¤à¤• à¤•à¤¸à¥à¤Ÿà¤® à¤«à¤¼à¥‹à¤²à¥à¤¡à¤° à¤œà¥‹à¤¡à¤¼à¥‡à¤‚à¥¤",
        "msg.errorLoading": "à¤²à¥‹à¤¡ à¤•à¤°à¤¨à¥‡ à¤®à¥‡à¤‚ à¤¤à¥à¤°à¥à¤Ÿà¤¿",
        "sidebar.details": "à¤µà¤¿à¤µà¤°à¤£",
        "sidebar.preview": "à¤ªà¥‚à¤°à¥à¤µà¤¾à¤µà¤²à¥‹à¤•à¤¨",
        "sidebar.rating": "à¤°à¥‡à¤Ÿà¤¿à¤‚à¤—",
        "sidebar.tags": "à¤Ÿà¥ˆà¤—",
        "ctx.openViewer": "à¤µà¥à¤¯à¥‚à¤…à¤° à¤®à¥‡à¤‚ à¤–à¥‹à¤²à¥‡à¤‚",
        "ctx.copyPath": "à¤ªà¤¾à¤¥ à¤•à¥‰à¤ªà¥€ à¤•à¤°à¥‡à¤‚",
        "ctx.openInFolder": "à¤«à¤¼à¥‹à¤²à¥à¤¡à¤° à¤®à¥‡à¤‚ à¤–à¥‹à¤²à¥‡à¤‚",
        "ctx.rename": "à¤¨à¤¾à¤® à¤¬à¤¦à¤²à¥‡à¤‚",
        "ctx.delete": "à¤¹à¤Ÿà¤¾à¤à¤‚",
        "toast.ratingUpdateFailed": "à¤°à¥‡à¤Ÿà¤¿à¤‚à¤— à¤…à¤ªà¤¡à¥‡à¤Ÿ à¤µà¤¿à¤«à¤²",
        "toast.tagsUpdated": "à¤Ÿà¥ˆà¤— à¤…à¤ªà¤¡à¥‡à¤Ÿ à¤¹à¥‹ à¤—à¤",
        "toast.pathCopied": "à¤ªà¤¾à¤¥ à¤•à¥à¤²à¤¿à¤ªà¤¬à¥‹à¤°à¥à¤¡ à¤®à¥‡à¤‚ à¤•à¥‰à¤ªà¥€ à¤¹à¥‹ à¤—à¤¯à¤¾",
    },
    "pt-PT": {
        "cat.grid": "Grelha",
        "cat.cards": "CartÃµes",
        "cat.badges": "Emblemas",
        "cat.viewer": "Visualizador",
        "cat.scanning": "AnÃ¡lise",
        "cat.advanced": "AvanÃ§ado",
        "cat.security": "SeguranÃ§a",
        "cat.remote": "Acesso remoto",
        "setting.language.name": "Majoor: Idioma",
        "setting.language.desc": "Escolha o idioma da interface do Assets Manager. Recarregar para aplicar totalmente.",
        "tab.output": "SaÃ­da",
        "tab.input": "Entrada",
        "tab.custom": "Personalizado",
        "btn.add": "Adicionarâ€¦",
        "btn.remove": "Remover",
        "btn.retry": "Tentar novamente",
        "btn.clear": "Limpar",
        "btn.refresh": "Atualizar",
        "btn.scan": "Analisar",
        "btn.close": "Fechar",
        "label.folder": "Pasta",
        "label.type": "Tipo",
        "label.workflow": "Fluxo",
        "label.rating": "ClassificaÃ§Ã£o",
        "label.dateRange": "Intervalo de datas",
        "label.sort": "Ordenar",
        "label.filters": "Filtros",
        "filter.all": "Todos",
        "filter.images": "Imagens",
        "filter.videos": "VÃ­deos",
        "filter.onlyWithWorkflow": "Apenas com workflow",
        "filter.anyRating": "Qualquer classificaÃ§Ã£o",
        "filter.anytime": "Qualquer altura",
        "filter.today": "Hoje",
        "filter.yesterday": "Ontem",
        "sort.newest": "Mais recentes primeiro",
        "sort.oldest": "Mais antigos primeiro",
        "sort.nameAZ": "Nome A-Z",
        "sort.nameZA": "Nome Z-A",
        "status.ready": "Pronto",
        "status.scanning": "A analisar...",
        "status.error": "Erro",
        "msg.noResults": "Sem resultados.",
        "msg.loading": "A carregar...",
        "msg.addCustomFolder": "Adicione uma pasta personalizada para navegar.",
        "msg.errorLoading": "Erro ao carregar",
        "sidebar.details": "Detalhes",
        "sidebar.preview": "PrÃ©-visualizaÃ§Ã£o",
        "sidebar.rating": "ClassificaÃ§Ã£o",
        "sidebar.tags": "Etiquetas",
        "ctx.openViewer": "Abrir no visualizador",
        "ctx.copyPath": "Copiar caminho",
        "ctx.openInFolder": "Abrir na pasta",
        "ctx.rename": "Renomear",
        "ctx.delete": "Eliminar",
        "toast.ratingUpdateFailed": "Falha ao atualizar classificaÃ§Ã£o",
        "toast.tagsUpdated": "Etiquetas atualizadas",
        "toast.pathCopied": "Caminho copiado para a Ã¡rea de transferÃªncia",
    },
    "es-ES": {
        "cat.grid": "CuadrÃ­cula",
        "cat.cards": "Tarjetas",
        "cat.badges": "Insignias",
        "cat.viewer": "Visor",
        "cat.scanning": "Escaneo",
        "cat.advanced": "Avanzado",
        "cat.security": "Seguridad",
        "cat.remote": "Acceso remoto",
        "setting.language.name": "Majoor: Idioma",
        "setting.language.desc": "Elige el idioma de la interfaz de Assets Manager. Recarga para aplicar completamente.",
        "tab.output": "Salida",
        "tab.input": "Entrada",
        "tab.custom": "Personalizado",
        "btn.add": "Agregarâ€¦",
        "btn.remove": "Eliminar",
        "btn.retry": "Reintentar",
        "btn.clear": "Limpiar",
        "btn.refresh": "Actualizar",
        "btn.scan": "Escanear",
        "btn.close": "Cerrar",
        "label.folder": "Carpeta",
        "label.type": "Tipo",
        "label.workflow": "Workflow",
        "label.rating": "ValoraciÃ³n",
        "label.dateRange": "Rango de fechas",
        "label.sort": "Ordenar",
        "label.filters": "Filtros",
        "filter.all": "Todo",
        "filter.images": "ImÃ¡genes",
        "filter.videos": "VÃ­deos",
        "filter.onlyWithWorkflow": "Solo con workflow",
        "filter.anyRating": "Cualquier valoraciÃ³n",
        "filter.anytime": "En cualquier momento",
        "filter.today": "Hoy",
        "filter.yesterday": "Ayer",
        "sort.newest": "MÃ¡s nuevos primero",
        "sort.oldest": "MÃ¡s antiguos primero",
        "sort.nameAZ": "Nombre A-Z",
        "sort.nameZA": "Nombre Z-A",
        "status.ready": "Listo",
        "status.scanning": "Escaneando...",
        "status.error": "Error",
        "msg.noResults": "No se encontraron resultados.",
        "msg.loading": "Cargando...",
        "msg.addCustomFolder": "Agrega una carpeta personalizada para explorar.",
        "msg.errorLoading": "Error al cargar",
        "sidebar.details": "Detalles",
        "sidebar.preview": "Vista previa",
        "sidebar.rating": "ValoraciÃ³n",
        "sidebar.tags": "Etiquetas",
        "ctx.openViewer": "Abrir en visor",
        "ctx.copyPath": "Copiar ruta",
        "ctx.openInFolder": "Abrir en carpeta",
        "ctx.rename": "Renombrar",
        "ctx.delete": "Eliminar",
        "toast.ratingUpdateFailed": "Error al actualizar la valoraciÃ³n",
        "toast.tagsUpdated": "Etiquetas actualizadas",
        "toast.pathCopied": "Ruta copiada al portapapeles",
    },
    "ru-RU": {
        "cat.grid": "Ð¡ÐµÑ‚ÐºÐ°",
        "cat.cards": "ÐšÐ°Ñ€Ñ‚Ð¾Ñ‡ÐºÐ¸",
        "cat.badges": "Ð—Ð½Ð°Ñ‡ÐºÐ¸",
        "cat.viewer": "ÐŸÑ€Ð¾ÑÐ¼Ð¾Ñ‚Ñ€Ñ‰Ð¸Ðº",
        "cat.scanning": "Ð¡ÐºÐ°Ð½Ð¸Ñ€Ð¾Ð²Ð°Ð½Ð¸Ðµ",
        "cat.advanced": "Ð Ð°ÑÑˆÐ¸Ñ€ÐµÐ½Ð½Ñ‹Ðµ",
        "cat.security": "Ð‘ÐµÐ·Ð¾Ð¿Ð°ÑÐ½Ð¾ÑÑ‚ÑŒ",
        "cat.remote": "Ð£Ð´Ð°Ð»ÐµÐ½Ð½Ñ‹Ð¹ Ð´Ð¾ÑÑ‚ÑƒÐ¿",
        "setting.language.name": "Majoor: Ð¯Ð·Ñ‹Ðº",
        "setting.language.desc": "Ð’Ñ‹Ð±ÐµÑ€Ð¸Ñ‚Ðµ ÑÐ·Ñ‹Ðº Ð¸Ð½Ñ‚ÐµÑ€Ñ„ÐµÐ¹ÑÐ° Assets Manager. Ð”Ð»Ñ Ð¿Ð¾Ð»Ð½Ð¾Ð³Ð¾ Ð¿Ñ€Ð¸Ð¼ÐµÐ½ÐµÐ½Ð¸Ñ Ñ‚Ñ€ÐµÐ±ÑƒÐµÑ‚ÑÑ Ð¿ÐµÑ€ÐµÐ·Ð°Ð³Ñ€ÑƒÐ·ÐºÐ°.",
        "tab.output": "Ð’Ñ‹Ñ…Ð¾Ð´",
        "tab.input": "Ð’Ñ…Ð¾Ð´",
        "tab.custom": "ÐŸÐ¾Ð»ÑŒÐ·Ð¾Ð²Ð°Ñ‚ÐµÐ»ÑŒÑÐºÐ¸Ð¹",
        "btn.add": "Ð”Ð¾Ð±Ð°Ð²Ð¸Ñ‚ÑŒâ€¦",
        "btn.remove": "Ð£Ð´Ð°Ð»Ð¸Ñ‚ÑŒ",
        "btn.retry": "ÐŸÐ¾Ð²Ñ‚Ð¾Ñ€Ð¸Ñ‚ÑŒ",
        "btn.clear": "ÐžÑ‡Ð¸ÑÑ‚Ð¸Ñ‚ÑŒ",
        "btn.refresh": "ÐžÐ±Ð½Ð¾Ð²Ð¸Ñ‚ÑŒ",
        "btn.scan": "Ð¡ÐºÐ°Ð½Ð¸Ñ€Ð¾Ð²Ð°Ñ‚ÑŒ",
        "btn.close": "Ð—Ð°ÐºÑ€Ñ‹Ñ‚ÑŒ",
        "label.folder": "ÐŸÐ°Ð¿ÐºÐ°",
        "label.type": "Ð¢Ð¸Ð¿",
        "label.workflow": "Ð’Ð¾Ñ€ÐºÑ„Ð»Ð¾Ñƒ",
        "label.rating": "Ð ÐµÐ¹Ñ‚Ð¸Ð½Ð³",
        "label.dateRange": "Ð”Ð¸Ð°Ð¿Ð°Ð·Ð¾Ð½ Ð´Ð°Ñ‚",
        "label.sort": "Ð¡Ð¾Ñ€Ñ‚Ð¸Ñ€Ð¾Ð²ÐºÐ°",
        "label.filters": "Ð¤Ð¸Ð»ÑŒÑ‚Ñ€Ñ‹",
        "filter.all": "Ð’ÑÐµ",
        "filter.images": "Ð˜Ð·Ð¾Ð±Ñ€Ð°Ð¶ÐµÐ½Ð¸Ñ",
        "filter.videos": "Ð’Ð¸Ð´ÐµÐ¾",
        "filter.onlyWithWorkflow": "Ð¢Ð¾Ð»ÑŒÐºÐ¾ Ñ workflow",
        "filter.anyRating": "Ð›ÑŽÐ±Ð¾Ð¹ Ñ€ÐµÐ¹Ñ‚Ð¸Ð½Ð³",
        "filter.anytime": "Ð—Ð° Ð²ÑÑ‘ Ð²Ñ€ÐµÐ¼Ñ",
        "filter.today": "Ð¡ÐµÐ³Ð¾Ð´Ð½Ñ",
        "filter.yesterday": "Ð’Ñ‡ÐµÑ€Ð°",
        "sort.newest": "Ð¡Ð½Ð°Ñ‡Ð°Ð»Ð° Ð½Ð¾Ð²Ñ‹Ðµ",
        "sort.oldest": "Ð¡Ð½Ð°Ñ‡Ð°Ð»Ð° ÑÑ‚Ð°Ñ€Ñ‹Ðµ",
        "sort.nameAZ": "Ð˜Ð¼Ñ A-Z",
        "sort.nameZA": "Ð˜Ð¼Ñ Z-A",
        "status.ready": "Ð“Ð¾Ñ‚Ð¾Ð²Ð¾",
        "status.scanning": "Ð¡ÐºÐ°Ð½Ð¸Ñ€Ð¾Ð²Ð°Ð½Ð¸Ðµ...",
        "status.error": "ÐžÑˆÐ¸Ð±ÐºÐ°",
        "msg.noResults": "Ð ÐµÐ·ÑƒÐ»ÑŒÑ‚Ð°Ñ‚Ñ‹ Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½Ñ‹.",
        "msg.loading": "Ð—Ð°Ð³Ñ€ÑƒÐ·ÐºÐ°...",
        "msg.addCustomFolder": "Ð”Ð¾Ð±Ð°Ð²ÑŒÑ‚Ðµ Ð¿Ð¾Ð»ÑŒÐ·Ð¾Ð²Ð°Ñ‚ÐµÐ»ÑŒÑÐºÑƒÑŽ Ð¿Ð°Ð¿ÐºÑƒ Ð´Ð»Ñ Ð¿Ñ€Ð¾ÑÐ¼Ð¾Ñ‚Ñ€Ð°.",
        "msg.errorLoading": "ÐžÑˆÐ¸Ð±ÐºÐ° Ð·Ð°Ð³Ñ€ÑƒÐ·ÐºÐ¸",
        "sidebar.details": "ÐŸÐ¾Ð´Ñ€Ð¾Ð±Ð½Ð¾ÑÑ‚Ð¸",
        "sidebar.preview": "ÐŸÑ€ÐµÐ´Ð¿Ñ€Ð¾ÑÐ¼Ð¾Ñ‚Ñ€",
        "sidebar.rating": "Ð ÐµÐ¹Ñ‚Ð¸Ð½Ð³",
        "sidebar.tags": "Ð¢ÐµÐ³Ð¸",
        "ctx.openViewer": "ÐžÑ‚ÐºÑ€Ñ‹Ñ‚ÑŒ Ð² Ð¿Ñ€Ð¾ÑÐ¼Ð¾Ñ‚Ñ€Ñ‰Ð¸ÐºÐµ",
        "ctx.copyPath": "ÐšÐ¾Ð¿Ð¸Ñ€Ð¾Ð²Ð°Ñ‚ÑŒ Ð¿ÑƒÑ‚ÑŒ",
        "ctx.openInFolder": "ÐžÑ‚ÐºÑ€Ñ‹Ñ‚ÑŒ Ð² Ð¿Ð°Ð¿ÐºÐµ",
        "ctx.rename": "ÐŸÐµÑ€ÐµÐ¸Ð¼ÐµÐ½Ð¾Ð²Ð°Ñ‚ÑŒ",
        "ctx.delete": "Ð£Ð´Ð°Ð»Ð¸Ñ‚ÑŒ",
        "toast.ratingUpdateFailed": "ÐÐµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ Ð¾Ð±Ð½Ð¾Ð²Ð¸Ñ‚ÑŒ Ñ€ÐµÐ¹Ñ‚Ð¸Ð½Ð³",
        "toast.tagsUpdated": "Ð¢ÐµÐ³Ð¸ Ð¾Ð±Ð½Ð¾Ð²Ð»ÐµÐ½Ñ‹",
        "toast.pathCopied": "ÐŸÑƒÑ‚ÑŒ ÑÐºÐ¾Ð¿Ð¸Ñ€Ð¾Ð²Ð°Ð½ Ð² Ð±ÑƒÑ„ÐµÑ€ Ð¾Ð±Ð¼ÐµÐ½Ð°",
    },
};

Object.entries(GENERATED_TRANSLATIONS || {}).forEach(([code, entries]) => {
    DICTIONARY[code] = { ...(DICTIONARY[code] || {}), ...(entries || {}) };
});

Object.entries(CORE_TRANSLATIONS).forEach(([code, entries]) => {
    DICTIONARY[code] = { ...(DICTIONARY[code] || {}), ...entries };
});

// Ensure complete key coverage for all registered locales:
// any missing key falls back to the English string inside each locale pack.
const EN_US_DICT = DICTIONARY["en-US"] || {};
Object.keys(DICTIONARY).forEach((code) => {
    if (code === "en-US") return;
    DICTIONARY[code] = { ...EN_US_DICT, ...(DICTIONARY[code] || {}) };
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// API
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Map various locale codes to our supported languages.
 */
function mapLocale(locale) {
    if (!locale) return DEFAULT_LANG;
    const raw = String(locale || "").trim();
    const lower = raw.toLowerCase();
    
    // French variants
    if (lower.startsWith("fr")) return "fr-FR";
    
    // English variants
    if (lower.startsWith("en")) return "en-US";

    // Chinese variants
    if (lower.startsWith("zh")) return "zh-CN";

    // Japanese variants
    if (lower.startsWith("ja")) return "ja-JP";

    // Korean variants
    if (lower.startsWith("ko")) return "ko-KR";

    // Hindi variants
    if (lower.startsWith("hi")) return "hi-IN";

    // Portuguese variants
    if (lower.startsWith("pt")) return "pt-PT";

    // Spanish variants
    if (lower.startsWith("es")) return "es-ES";

    // Russian variants
    if (lower.startsWith("ru")) return "ru-RU";
    
    // Direct match
    if (DICTIONARY[raw]) return raw;
    
    return DEFAULT_LANG;
}

function _readStoredLang() {
    try {
        if (typeof localStorage === "undefined") return "";
        for (const key of LANG_STORAGE_KEYS) {
            const value = String(localStorage.getItem(key) || "").trim();
            if (value) return value;
        }
    } catch {}
    return "";
}

function _persistLang(lang) {
    try {
        if (typeof localStorage === "undefined") return;
        // Keep legacy and new key in sync for smooth upgrades.
        localStorage.setItem(LANG_STORAGE_KEYS[0], lang);
        localStorage.setItem(LANG_STORAGE_KEYS[1], lang);
    } catch {}
}

function _readComfyLocaleCandidates(app) {
    const out = [];
    const pushCandidate = (value) => {
        if (typeof value !== "string") return;
        const v = value.trim();
        if (v) out.push(v);
    };
    const settingKeys = [
        "AGL.Locale",
        "Comfy.Locale",
        "Comfy.LocaleCode",
        "ComfyUI.Locale",
        "ComfyUI.Frontend.Locale",
    ];
    for (const key of settingKeys) {
        pushCandidate(getSettingValue(app, key));
    }

    // Additional frontend locale surfaces (if present).
    pushCandidate(app?.ui?.locale);
    pushCandidate(app?.locale);
    pushCandidate(app?.ui?.i18n?.locale);

    return out;
}

function _readPlatformLocaleCandidates() {
    const out = [];
    const pushCandidate = (value) => {
        if (typeof value !== "string") return;
        const v = value.trim();
        if (v) out.push(v);
    };
    try {
        if (typeof document !== "undefined") {
            pushCandidate(document?.documentElement?.lang);
        }
    } catch {}
    try {
        if (typeof navigator !== "undefined") {
            pushCandidate(navigator?.language);
            const langs = Array.isArray(navigator?.languages) ? navigator.languages : [];
            for (const lang of langs) pushCandidate(lang);
        }
    } catch {}
    return out;
}

/**
 * Detect and set language from ComfyUI settings.
 * Tries multiple sources compatible with legacy and modern ComfyUI frontends.
 */
export const initI18n = (app) => {
    try {
        // 1) Respect explicit user choice first.
        const stored = _readStoredLang();
        const storedMapped = mapLocale(stored);
        if (stored && DICTIONARY[storedMapped]) {
            setLang(storedMapped);
            return;
        }

        // 2) Try ComfyUI settings / runtime locale surfaces.
        const comfyCandidates = _readComfyLocaleCandidates(app);
        for (const candidate of comfyCandidates) {
            const mapped = mapLocale(candidate);
            if (DICTIONARY[mapped]) {
                setLang(mapped);
                return;
            }
        }

        // 3) Browser / document locale fallback.
        const platformCandidates = _readPlatformLocaleCandidates();
        for (const candidate of platformCandidates) {
            const mapped = mapLocale(candidate);
            if (DICTIONARY[mapped]) {
                setLang(mapped);
                return;
            }
        }

        // 4) Guaranteed fallback.
        setLang(DEFAULT_LANG);
    } catch (err) {
        console.warn("[Majoor i18n] Failed to detect language:", err);
        setLang(DEFAULT_LANG);
    }
};

/**
 * Set the current language.
 */
export const setLang = (lang) => {
    if (!DICTIONARY[lang]) {
        console.warn(`[Majoor i18n] Unknown language: ${lang}, falling back to ${DEFAULT_LANG}`);
        lang = DEFAULT_LANG;
    }
    
    if (currentLang === lang) return;
    
    currentLang = lang;
    
    // Persist preference
    _persistLang(lang);
    
    // Notify listeners
    _langChangeListeners.forEach(cb => {
        try { cb(lang); } catch {}
    });
};

/**
 * Get the current language code.
 */
export const getCurrentLang = () => currentLang;

/**
 * Get list of supported languages.
 */
export const getSupportedLanguages = () => Object.keys(DICTIONARY).map(code => ({
    code,
    name: LANGUAGE_NAMES[code] || code
}));

/**
 * Translate a key.
 * @param {string} key - Translation key
 * @param {string|object} defaultOrParams - Default text or params object
 * @param {object} params - Parameters for interpolation (e.g., {n: 5})
 */
export const t = (key, defaultOrParams, params) => {
    const dict = DICTIONARY[currentLang] || DICTIONARY[DEFAULT_LANG];
    const fallbackDict = DICTIONARY[DEFAULT_LANG];
    
    let text = dict[key] || fallbackDict[key];
    
    if (!text) {
        const missingId = `${currentLang}:${String(key || "")}`;
        if (!_missingTranslationKeys.has(missingId)) {
            _missingTranslationKeys.add(missingId);
            try {
                console.warn(`[Majoor i18n] Missing translation key "${key}" for locale "${currentLang}"`);
            } catch {}
            try {
                if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
                    window.dispatchEvent(new CustomEvent("mjr-i18n-missing-key", {
                        detail: { key: String(key || ""), locale: currentLang }
                    }));
                }
            } catch {}
        }
        // Return default or key
        if (typeof defaultOrParams === "string") return defaultOrParams;
        return key;
    }
    
    // Handle params
    const actualParams = typeof defaultOrParams === "object" ? defaultOrParams : params;
    if (actualParams && typeof actualParams === "object") {
        // Replace {key} with values
        Object.entries(actualParams).forEach(([k, v]) => {
            text = text.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
        });
    }
    
    return text;
};

/**
 * Subscribe to language changes.
 */
export const onLangChange = (callback) => {
    if (typeof callback === "function") {
        _langChangeListeners.push(callback);
    }
    return () => {
        _langChangeListeners = _langChangeListeners.filter(cb => cb !== callback);
    };
};

/**
 * Check if a language is supported.
 */
export const isLangSupported = (lang) => !!DICTIONARY[lang];
