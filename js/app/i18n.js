/**
 * Internationalization support for Majoor Assets Manager.
 * Detects ComfyUI language and provides translations for the entire UI.
 */

const DEFAULT_LANG = "en-US";
let currentLang = DEFAULT_LANG;
let _langChangeListeners = [];

// ─────────────────────────────────────────────────────────────────────────────
// DICTIONARY - Full UI translations
// ─────────────────────────────────────────────────────────────────────────────
const DICTIONARY = {
    "en-US": {
        // ─── Settings Categories ───
        "cat.grid": "Grid",
        "cat.viewer": "Viewer",
        "cat.scanning": "Scanning",
        "cat.advanced": "Advanced",
        "cat.security": "Security",
        "cat.remote": "Remote Access",

        // ─── Settings: Grid ───
        "setting.grid.minsize.name": "Majoor: Thumbnail Size (px)",
        "setting.grid.minsize.desc": "Minimum size of thumbnails in the grid. May require reopening the panel.",
        "setting.grid.gap.name": "Majoor: Gap (px)",
        "setting.grid.gap.desc": "Space between thumbnails.",
        "setting.sidebar.pos.name": "Majoor: Sidebar Position",
        "setting.sidebar.pos.desc": "Show details sidebar on the left or the right. Reload required.",
        "setting.siblings.hide.name": "Majoor: Hide PNG Siblings",
        "setting.siblings.hide.desc": "If a video has a corresponding .png preview, hide the .png from the grid.",
        "setting.nav.infinite.name": "Majoor: Infinite Scroll",
        "setting.nav.infinite.desc": "Automatically load more files when scrolling.",

        // ─── Settings: Viewer ───
        "setting.viewer.pan.name": "Majoor: Pan without Zoom",
        "setting.viewer.pan.desc": "Allow panning the image even at zoom level 1.",
        "setting.minimap.enabled.name": "Majoor: Enable Minimap",
        "setting.minimap.enabled.desc": "Global activation of the workflow minimap.",

        // ─── Settings: Scanning ───
        "setting.scan.startup.name": "Majoor: Auto-scan on Startup",
        "setting.scan.startup.desc": "Start a background scan as soon as ComfyUI loads.",
        "setting.watcher.name": "Majoor: File Watcher",
        "setting.watcher.desc": "Watch output and custom folders for manually added files and auto-index them in real time.",
        "setting.sync.rating.name": "Majoor: Sync Rating/Tags to Files",
        "setting.sync.rating.desc": "Write ratings and tags into file metadata (ExifTool).",

        // ─── Settings: Advanced ───
        "setting.obs.enabled.name": "Majoor: Enable Detailed Logs",
        "setting.obs.enabled.desc": "Enable detailed backend logs for debugging.",
        "setting.probe.mode.name": "Majoor: Metadata Backend",
        "setting.probe.mode.desc": "Choose the tool used directly to extract metadata.",
        "setting.language.name": "Majoor: Language",
        "setting.language.desc": "Choose the language for the Assets Manager interface. Reload required to fully apply.",

        // ─── Settings: Security ───
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

        // ─── Panel: Tabs ───
        "tab.output": "Output",
        "tab.input": "Input",
        "tab.custom": "Custom",

        // ─── Panel: Buttons ───
        "btn.add": "Add…",
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
        "btn.retryServices": "Retry services",
        "btn.retrying": "Retrying...",
        "btn.loadWorkflow": "Load Workflow",
        "btn.copyPrompt": "Copy Prompt",
        "btn.close": "Close",

        // ─── Panel: Labels ───
        "label.folder": "Folder",
        "label.type": "Type",
        "label.workflow": "Workflow",
        "label.rating": "Rating",
        "label.dateRange": "Date range",
        "label.agenda": "Agenda",
        "label.sort": "Sort",
        "label.collections": "Collections",
        "label.filters": "Filters",
        "label.selectFolder": "Select folder…",
        "label.thisFolder": "this folder",

        // ─── Panel: Filters ───
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

        // ─── Panel: Sort ───
        "sort.newest": "Newest first",
        "sort.oldest": "Oldest first",
        "sort.nameAZ": "Name A-Z",
        "sort.nameZA": "Name Z-A",
        "sort.ratingHigh": "Rating (high)",
        "sort.ratingLow": "Rating (low)",
        "sort.sizeDesc": "Size (large)",
        "sort.sizeAsc": "Size (small)",

        // ─── Panel: Status ───
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
        "status.lastScan": "Last scan: {date}",
        "status.scanStats": "Added: {added}  -  Updated: {updated}  -  Skipped: {skipped}",
        "status.watcher.enabled": "Watcher: enabled",
        "status.watcher.enabledScoped": "Watcher: enabled ({scope})",
        "status.watcher.disabled": "Watcher: disabled",
        "status.watcher.disabledScoped": "Watcher: disabled ({scope})",
        "status.apiNotFound": "Majoor API endpoints not found (404)",
        "status.apiNotFoundHint": "Backend routes are not loaded. Restart ComfyUI and check the terminal for Majoor import errors.",
        "status.errorChecking": "Error checking status",
        "status.retryFailed": "Retry failed",

        // ─── Scopes ───
        "scope.all": "Inputs + Outputs",
        "scope.allFull": "All (Inputs + Outputs)",
        "scope.input": "Inputs",
        "scope.output": "Outputs",
        "scope.custom": "Custom",

        // ─── Tools ───
        "tool.exiftool": "ExifTool metadata",
        "tool.exiftool.hint": "PNG/WEBP workflow data (uses ExifTool)",
        "tool.ffprobe": "FFprobe video stats",
        "tool.ffprobe.hint": "Video duration, FPS, and resolution (uses FFprobe)",

        // ─── Panel: Messages ───
        "msg.noCollections": "No collections yet.",
        "msg.addCustomFolder": "Add a custom folder to browse.",
        "msg.noResults": "No results found.",
        "msg.loading": "Loading...",
        "msg.errorLoading": "Error loading",
        "msg.errorLoadingFolders": "Error loading folders",
        "msg.noGenerationData": "No generation data found for this file.",
        "msg.rawMetadata": "Raw metadata",

        // ─── Viewer ───
        "viewer.genInfo": "Generation Info",
        "viewer.workflow": "Workflow",
        "viewer.metadata": "Metadata",
        "viewer.noWorkflow": "No workflow data",
        "viewer.noMetadata": "No metadata available",
        "viewer.copySuccess": "Copied to clipboard!",
        "viewer.copyFailed": "Failed to copy",

        // ─── Sidebar ───
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

        // ─── Context Menu ───
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

        // ─── Dialogs ───
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

        // ─── Toasts ───
        "toast.scanStarted": "Scan started",
        "toast.scanComplete": "Scan complete",
        "toast.scanFailed": "Scan failed",
        "toast.resetTriggered": "Reset triggered: Reindexing all files...",
        "toast.resetStarted": "Index reset started. Files will be reindexed in the background.",
        "toast.resetFailed": "Failed to reset index",
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

        // ─── Hotkeys ───
        "hotkey.scan": "Scan (S)",
        "hotkey.search": "Search (Ctrl+F)",
        "hotkey.details": "Toggle details (D)",
        "hotkey.delete": "Delete (Del)",
        "hotkey.viewer": "Open viewer (Enter)",
        "hotkey.escape": "Close (Esc)",
    },

    "fr-FR": {
        // ─── Catégories Settings ───
        "cat.grid": "Grille",
        "cat.viewer": "Visionneuse",
        "cat.scanning": "Scan",
        "cat.advanced": "Avancé",
        "cat.security": "Sécurité",
        "cat.remote": "Accès distant",

        // ─── Settings: Grille ───
        "setting.grid.minsize.name": "Majoor: Taille des vignettes (px)",
        "setting.grid.minsize.desc": "Taille minimale des vignettes. Peut nécessiter de réouvrir le panneau.",
        "setting.grid.gap.name": "Majoor: Espacement (px)",
        "setting.grid.gap.desc": "Espace entre les vignettes.",
        "setting.sidebar.pos.name": "Majoor: Position sidebar",
        "setting.sidebar.pos.desc": "Afficher la sidebar à gauche ou à droite. Recharger la page pour appliquer.",
        "setting.siblings.hide.name": "Majoor: Masquer aperçus PNG",
        "setting.siblings.hide.desc": "Si une vidéo a un fichier .png correspondant, masquer le .png de la grille.",
        "setting.nav.infinite.name": "Majoor: Défilement infini",
        "setting.nav.infinite.desc": "Charger automatiquement plus de fichiers en scrollant.",

        // ─── Settings: Visionneuse ───
        "setting.viewer.pan.name": "Majoor: Pan sans zoom",
        "setting.viewer.pan.desc": "Permet de déplacer l'image même sans zoom.",
        "setting.minimap.enabled.name": "Majoor: Activer Minimap",
        "setting.minimap.enabled.desc": "Activation globale de la minimap du workflow.",

        // ─── Settings: Scan ───
        "setting.scan.startup.name": "Majoor: Auto-scan au démarrage",
        "setting.scan.startup.desc": "Lancer un scan en arrière-plan dès le chargement de ComfyUI.",
        "setting.watcher.name": "Majoor: Surveillance fichiers",
        "setting.watcher.desc": "Surveiller les dossiers output et custom pour indexer automatiquement les fichiers ajoutés manuellement.",
        "setting.sync.rating.name": "Majoor: Sync rating/tags vers fichiers",
        "setting.sync.rating.desc": "Écrire les notes et tags dans les métadonnées des fichiers (ExifTool).",

        // ─── Settings: Avancé ───
        "setting.obs.enabled.name": "Majoor: Activer logs détaillés",
        "setting.obs.enabled.desc": "Active les logs détaillés côté backend pour le debugging.",
        "setting.probe.mode.name": "Majoor: Backend métadonnées",
        "setting.probe.mode.desc": "Choisir l'outil pour extraire les métadonnées des fichiers.",
        "setting.language.name": "Majoor: Langue",
        "setting.language.desc": "Choisir la langue de l'interface Assets Manager. Rechargement requis pour appliquer entièrement.",

        // ─── Settings: Sécurité ───
        "setting.sec.safe.name": "Majoor: Mode sécurisé",
        "setting.sec.safe.desc": "Quand activé, les écritures rating/tags sont bloquées sauf autorisation explicite.",
        "setting.sec.remote.name": "Majoor: Autoriser l'accès distant complet",
        "setting.sec.remote.desc": "Autorise les clients non locaux à écrire. Désactiver bloque les écritures sauf si un token est configuré.",
        "setting.sec.write.name": "Majoor: Autoriser écriture",
        "setting.sec.write.desc": "Autorise l'écriture des notes et tags.",
        "setting.sec.del.name": "Majoor: Autoriser suppression",
        "setting.sec.del.desc": "Active la suppression de fichiers.",
        "setting.sec.ren.name": "Majoor: Autoriser renommage",
        "setting.sec.ren.desc": "Active le renommage de fichiers.",
        "setting.sec.open.name": "Majoor: Autoriser ouvrir dans dossier",
        "setting.sec.open.desc": "Active l'ouverture dans le dossier.",
        "setting.sec.reset.name": "Majoor: Autoriser reset index",
        "setting.sec.reset.desc": "Reset le cache d'index et relance un scan complet.",
        "setting.sec.token.name": "Majoor: Token API",
        "setting.sec.token.desc": "Stocke le token d'autorisation pour les écritures. Majoor l'envoie via les en-têtes Authorization et X-MJR-Token.",
        "setting.sec.token.placeholder": "Laisser vide pour désactiver.",

        // ─── Panel: Onglets ───
        "tab.output": "Sortie",
        "tab.input": "Entrée",
        "tab.custom": "Personnalisé",

        // ─── Panel: Boutons ───
        "btn.add": "Ajouter…",
        "btn.remove": "Supprimer",
        "btn.adding": "Ajout...",
        "btn.removing": "Suppression...",
        "btn.retry": "Réessayer",
        "btn.clear": "Effacer",
        "btn.refresh": "Actualiser",
        "btn.scan": "Scanner",
        "btn.scanning": "Scan...",
        "btn.resetIndex": "Réinitialiser l'index",
        "btn.resetting": "Réinitialisation...",
        "btn.retryServices": "Réessayer services",
        "btn.retrying": "Réessai...",
        "btn.loadWorkflow": "Charger le workflow",
        "btn.copyPrompt": "Copier le prompt",
        "btn.close": "Fermer",

        // ─── Panel: Labels ───
        "label.folder": "Dossier",
        "label.type": "Type",
        "label.workflow": "Workflow",
        "label.rating": "Note",
        "label.dateRange": "Période",
        "label.agenda": "Agenda",
        "label.sort": "Trier",
        "label.collections": "Collections",
        "label.filters": "Filtres",
        "label.selectFolder": "Sélectionner un dossier…",
        "label.thisFolder": "ce dossier",

        // ─── Panel: Filtres ───
        "filter.all": "Tout",
        "filter.images": "Images",
        "filter.videos": "Vidéos",
        "filter.onlyWithWorkflow": "Avec workflow uniquement",
        "filter.anyRating": "Toutes notes",
        "filter.minStars": "{n}+ étoiles",
        "filter.anytime": "Toutes dates",
        "filter.today": "Aujourd'hui",
        "filter.yesterday": "Hier",
        "filter.thisWeek": "Cette semaine",
        "filter.thisMonth": "Ce mois",
        "filter.last7days": "7 derniers jours",
        "filter.last30days": "30 derniers jours",

        // ─── Panel: Tri ───
        "sort.newest": "Plus récent",
        "sort.oldest": "Plus ancien",
        "sort.nameAZ": "Nom A-Z",
        "sort.nameZA": "Nom Z-A",
        "sort.ratingHigh": "Note (haute)",
        "sort.ratingLow": "Note (basse)",
        "sort.sizeDesc": "Taille (grand)",
        "sort.sizeAsc": "Taille (petit)",

        // ─── Panel: Statut ───
        "status.checking": "Vérification...",
        "status.ready": "Prêt",
        "status.scanning": "Scan en cours...",
        "status.error": "Erreur",
        "status.capabilities": "Capacités",
        "status.toolStatus": "État des outils",
        "status.selectCustomFolder": "Sélectionnez d'abord un dossier personnalisé",
        "status.errorGetConfig": "Erreur: Impossible d'obtenir la config",
        "status.discoveringTools": "Capacités: découverte des outils...",
        "status.indexStatus": "État de l'index",
        "status.toolStatusChecking": "État des outils: vérification...",
        "status.resetIndexHint": "Réinitialiser le cache d'index (nécessite allowResetIndex dans les paramètres).",
        "status.scanningHint": "Cela peut prendre un moment",
        "status.toolAvailable": "{tool} disponible",
        "status.toolUnavailable": "{tool} indisponible",
        "status.unknown": "inconnu",
        "status.available": "disponible",
        "status.missing": "manquant",
        "status.path": "Chemin",
        "status.pathAuto": "auto / non configuré",
        "status.noAssets": "Aucun asset indexé ({scope})",
        "status.clickToScan": "Cliquez sur le point pour lancer un scan",
        "status.assetsIndexed": "{count} assets indexés ({scope})",
        "status.imagesVideos": "Images: {images}  -  Vidéos: {videos}",
        "status.withWorkflows": "Avec workflows: {workflows}  -  Données de génération: {gendata}",
        "status.lastScan": "Dernier scan: {date}",
        "status.scanStats": "Ajoutés: {added}  -  Mis à jour: {updated}  -  Ignorés: {skipped}",
        "status.watcher.enabled": "Watcher : activé",
        "status.watcher.enabledScoped": "Watcher : activé ({scope})",
        "status.watcher.disabled": "Watcher : désactivé",
        "status.watcher.disabledScoped": "Watcher : désactivé ({scope})",
        "status.apiNotFound": "Endpoints API Majoor introuvables (404)",
        "status.apiNotFoundHint": "Les routes backend ne sont pas chargées. Redémarrez ComfyUI et vérifiez le terminal pour les erreurs d'import Majoor.",
        "status.errorChecking": "Erreur lors de la vérification",
        "status.retryFailed": "Échec de la relance",

        // ─── Scopes ───
        "scope.all": "Entrées + Sorties",
        "scope.allFull": "Tout (Entrées + Sorties)",
        "scope.input": "Entrées",
        "scope.output": "Sorties",
        "scope.custom": "Personnalisé",

        // ─── Outils ───
        "tool.exiftool": "Métadonnées ExifTool",
        "tool.exiftool.hint": "Données workflow PNG/WEBP (via ExifTool)",
        "tool.ffprobe": "Stats vidéo FFprobe",
        "tool.ffprobe.hint": "Durée, FPS et résolution vidéo (via FFprobe)",

        // ─── Panel: Messages ───
        "msg.noCollections": "Aucune collection.",
        "msg.addCustomFolder": "Ajoutez un dossier personnalisé à parcourir.",
        "msg.noResults": "Aucun résultat.",
        "msg.loading": "Chargement...",
        "msg.errorLoading": "Erreur de chargement",
        "msg.errorLoadingFolders": "Erreur de chargement des dossiers",
        "msg.noGenerationData": "Aucune donnée de génération pour ce fichier.",
        "msg.rawMetadata": "Métadonnées brutes",

        // ─── Visionneuse ───
        "viewer.genInfo": "Infos de génération",
        "viewer.workflow": "Workflow",
        "viewer.metadata": "Métadonnées",
        "viewer.noWorkflow": "Pas de workflow",
        "viewer.noMetadata": "Aucune métadonnée disponible",
        "viewer.copySuccess": "Copié dans le presse-papier !",
        "viewer.copyFailed": "Échec de la copie",

        // ─── Sidebar ───
        "sidebar.details": "Détails",
        "sidebar.preview": "Aperçu",
        "sidebar.rating": "Note",
        "sidebar.tags": "Tags",
        "sidebar.addTag": "Ajouter un tag...",
        "sidebar.noTags": "Aucun tag",
        "sidebar.filename": "Nom du fichier",
        "sidebar.dimensions": "Dimensions",
        "sidebar.date": "Date",
        "sidebar.size": "Taille",
        "sidebar.genTime": "Temps de génération",

        // ─── Menu contextuel ───
        "ctx.openViewer": "Ouvrir dans la visionneuse",
        "ctx.loadWorkflow": "Charger le workflow",
        "ctx.copyPath": "Copier le chemin",
        "ctx.openInFolder": "Ouvrir dans le dossier",
        "ctx.rename": "Renommer",
        "ctx.delete": "Supprimer",
        "ctx.addToCollection": "Ajouter à la collection",
        "ctx.removeFromCollection": "Retirer de la collection",
        "ctx.newCollection": "Nouvelle collection...",
        "ctx.rescanMetadata": "Rescanner les métadonnées",
        "ctx.createCollection": "Créer une collection...",
        "ctx.exitCollection": "Quitter la vue collection",

        // ─── Dialogues ───
        "dialog.confirm": "Confirmer",
        "dialog.cancel": "Annuler",
        "dialog.delete.title": "Supprimer le fichier ?",
        "dialog.delete.msg": "Êtes-vous sûr de vouloir supprimer ce fichier ? Cette action est irréversible.",
        "dialog.rename.title": "Renommer le fichier",
        "dialog.rename.placeholder": "Nouveau nom",
        "dialog.newCollection.title": "Nouvelle collection",
        "dialog.newCollection.placeholder": "Nom de la collection",
        "dialog.resetIndex.title": "Réinitialiser l'index ?",
        "dialog.resetIndex.msg": "Cela supprimera la base de données et rescannera tous les fichiers. Continuer ?",
        "dialog.securityWarning": "Cela ressemble à un dossier système ou très large.\n\nL'ajouter peut exposer des fichiers sensibles via la fonctionnalité de dossiers personnalisés.\n\nContinuer ?",
        "dialog.securityWarningTitle": "Majoor: Avertissement de sécurité",
        "dialog.enterFolderPath": "Entrez le chemin d'un dossier à ajouter comme racine personnalisée :",
        "dialog.customFoldersTitle": "Majoor: Dossiers personnalisés",
        "dialog.removeFolder": "Supprimer le dossier personnalisé \"{name}\" ?",
        "dialog.deleteCollection": "Supprimer la collection \"{name}\" ?",
        "dialog.createCollection": "Créer une collection",
        "dialog.collectionPlaceholder": "Ma collection",

        // ─── Toasts ───
        "toast.scanStarted": "Scan démarré",
        "toast.scanComplete": "Scan terminé",
        "toast.scanFailed": "Échec du scan",
        "toast.resetTriggered": "Réinitialisation : Réindexation de tous les fichiers...",
        "toast.resetStarted": "Réinitialisation démarrée. Les fichiers seront réindexés en arrière-plan.",
        "toast.resetFailed": "Échec de la réinitialisation de l'index",
        "toast.deleted": "Fichier supprimé",
        "toast.renamed": "Fichier renommé",
        "toast.addedToCollection": "Ajouté à la collection",
        "toast.removedFromCollection": "Retiré de la collection",
        "toast.collectionCreated": "Collection créée",
        "toast.permissionDenied": "Permission refusée",
        "toast.tagAdded": "Tag ajouté",
        "toast.tagRemoved": "Tag supprimé",
        "toast.ratingSaved": "Note enregistrée",
        "toast.failedAddFolder": "Échec de l'ajout du dossier personnalisé",
        "toast.failedRemoveFolder": "Échec de la suppression du dossier personnalisé",
        "toast.folderLinked": "Dossier lié avec succès",
        "toast.folderRemoved": "Dossier supprimé",
        "toast.nativeBrowserUnavailable": "Explorateur natif indisponible. Veuillez entrer le chemin manuellement.",
        "toast.errorAddingFolder": "Erreur lors de l'ajout du dossier personnalisé",
        "toast.errorRemovingFolder": "Erreur lors de la suppression du dossier personnalisé",
        "toast.failedCreateCollection": "Échec de la création de la collection",
        "toast.failedDeleteCollection": "Échec de la suppression de la collection",
        "toast.languageChanged": "Langue modifiée. Rechargez la page pour une application complète.",

        // ─── Raccourcis ───
        "hotkey.scan": "Scanner (S)",
        "hotkey.search": "Rechercher (Ctrl+F)",
        "hotkey.details": "Afficher détails (D)",
        "hotkey.delete": "Supprimer (Suppr)",
        "hotkey.viewer": "Ouvrir visionneuse (Entrée)",
        "hotkey.escape": "Fermer (Échap)",
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map various locale codes to our supported languages.
 */
function mapLocale(locale) {
    if (!locale) return DEFAULT_LANG;
    const lower = locale.toLowerCase();
    
    // French variants
    if (lower.startsWith("fr")) return "fr-FR";
    
    // English variants
    if (lower.startsWith("en")) return "en-US";
    
    // Direct match
    if (DICTIONARY[locale]) return locale;
    
    return DEFAULT_LANG;
}

/**
 * Detect and set language from ComfyUI settings.
 * Tries multiple sources: AGL.Locale, Comfy.Locale, localStorage.
 */
export const initI18n = (app) => {
    try {
        // 1. Try AGL.Locale (ComfyUI-Translation extension)
        const aglLocale = app?.ui?.settings?.getSettingValue?.("AGL.Locale");
        if (aglLocale && typeof aglLocale === "string" && DICTIONARY[mapLocale(aglLocale)]) {
            setLang(mapLocale(aglLocale));
            return;
        }

        // 2. Try generic Comfy.Locale
        const comfyLocale = app?.ui?.settings?.getSettingValue?.("Comfy.Locale");
        if (comfyLocale && typeof comfyLocale === "string") {
            const mapped = mapLocale(comfyLocale);
            if (DICTIONARY[mapped]) {
                setLang(mapped);
                return;
            }
        }

        // 3. Try localStorage for persisted Majoor language preference
        try {
            const stored = localStorage.getItem("mjr_lang");
            if (stored && DICTIONARY[stored]) {
                setLang(stored);
                return;
            }
        } catch {}

    } catch (err) {
        console.warn("[Majoor i18n] Failed to detect language:", err);
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
    try {
        localStorage.setItem("mjr_lang", lang);
    } catch {}
    
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
    name: code === "en-US" ? "English" : code === "fr-FR" ? "Français" : code
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
