/**
 * Internationalization support for Majoor Assets Manager.
 * Tries to detect ComfyUI language (e.g. from AGL.Locale) and falls back to browser/English.
 */

const DEFAULT_LANG = "en-US";
let currentLang = DEFAULT_LANG;

const DICTIONARY = {
    "en-US": {
        "cat.display": "Display",
        "cat.layout": "Layout",
        "cat.navigation": "Navigation",
        "cat.scan": "Scanning",
        "cat.debug": "Debug",
        "cat.tools": "Tools",
        "cat.viewer": "Viewer",
        "cat.security": "Security",

        "setting.grid.minsize.name": "Majoor: Thumbnail Size (px)",
        "setting.grid.minsize.desc": "Minimum size of thumbnails in the grid. May require reopening the panel.",
        "setting.grid.gap.name": "Majoor: Gap (px)",
        "setting.grid.gap.desc": "Space between thumbnails.",
        "setting.sidebar.pos.name": "Majoor: Sidebar Position",
        "setting.sidebar.pos.desc": "Show details sidebar on the left or the right. Reload required.",
        "setting.siblings.hide.name": "Majoor: Hide PNG Siblings",
        "setting.siblings.hide.desc": "If a video has a corresponding .png preview, hide the .png from the grid.",
        "setting.grid.pagesize.name": "Majoor: Files per Page",
        "setting.grid.pagesize.desc": "Number of files loaded per request. More = faster scrolling but more memory.",
        "setting.nav.infinite.name": "Majoor: Infinite Scroll",
        "setting.nav.infinite.desc": "Automatically load more files when scrolling.",
        "setting.viewer.pan.name": "Majoor: Pan without Zoom",
        "setting.viewer.pan.desc": "Allow panning the image even at zoom level 1.",
        "setting.scan.open.name": "Majoor: Auto-scan on Open",
        "setting.scan.open.desc": "Automatically scan folders when opening the panel.",
        "setting.scan.startup.name": "Majoor: Auto-scan on Startup",
        "setting.scan.startup.desc": "Start a background scan as soon as ComfyUI loads.",
        "setting.sync.rating.name": "Majoor: Sync Rating/Tags to Files",
        "setting.sync.rating.desc": "Write ratings and tags into file metadata (ExifTool).",
        "setting.obs.enabled.name": "Majoor: Enable Detailed Logs",
        "setting.obs.enabled.desc": "Enable detailed backend logs for debugging.",
        "setting.probe.mode.name": "Majoor: Metadata Backend",
        "setting.probe.mode.desc": "Choose the tool used directly to extract metadata.",
        "setting.minimap.enabled.name": "Majoor: Enable Minimap",
        "setting.minimap.enabled.desc": "Global activation of the workflow minimap.",
        
        "setting.sec.safe.name": "Majoor: Safe Mode",
        "setting.sec.safe.desc": "When enabled, rating/tags writes are blocked unless explicitly authorized.",
        "setting.sec.write.name": "Majoor: Allow Write",
        "setting.sec.write.desc": "Allow writing ratings and tags.",
        "setting.sec.del.name": "Majoor: Allow Delete",
        "setting.sec.del.desc": "Allow deleting files.",
        "setting.sec.ren.name": "Majoor: Allow Rename",
        "setting.sec.ren.desc": "Allow renaming files.",
        "setting.sec.open.name": "Majoor: Allow Open in Folder",
        "setting.sec.open.desc": "Allow opening file location in OS file manager.",
        "setting.sec.reset.name": "Majoor: Allow Index Reset",
        "setting.sec.reset.desc": "Allow resetting the index cache and triggering a full rescan."
    },
    "fr-FR": {
        "cat.display": "Affichage",
        "cat.layout": "Mise en page",
        "cat.navigation": "Navigation",
        "cat.scan": "Scan",
        "cat.debug": "Debug",
        "cat.tools": "Outils",
        "cat.viewer": "Visionneuse",
        "cat.security": "Sécurité",

        "setting.grid.minsize.name": "Majoor: Taille des vignettes (px)",
        "setting.grid.minsize.desc": "Taille minimale des vignettes. Peut nécessiter de réouvrir le panneau.",
        "setting.grid.gap.name": "Majoor: Espacement (px)",
        "setting.grid.gap.desc": "Espace entre les vignettes.",
        "setting.sidebar.pos.name": "Majoor: Position sidebar",
        "setting.sidebar.pos.desc": "Afficher la sidebar à gauche ou à droite. Recharger la page pour appliquer.",
        "setting.siblings.hide.name": "Majoor: Masquer aperçus PNG",
        "setting.siblings.hide.desc": "Si une vidéo a un fichier .png correspondant, masquer le .png de la grille.",
        "setting.grid.pagesize.name": "Majoor: Fichiers par page",
        "setting.grid.pagesize.desc": "Nombre de fichiers chargés par requête. Plus = plus rapide mais plus de mémoire.",
        "setting.nav.infinite.name": "Majoor: Défilement infini",
        "setting.nav.infinite.desc": "Charger automatiquement plus de fichiers en scrollant.",
        "setting.viewer.pan.name": "Majoor: Pan sans zoom",
        "setting.viewer.pan.desc": "Permet de déplacer l'image même sans zoom.",
        "setting.scan.open.name": "Majoor: Auto-scan à l'ouverture",
        "setting.scan.open.desc": "Scanner automatiquement les dossiers à l'ouverture du panneau.",
        "setting.scan.startup.name": "Majoor: Auto-scan au démarrage",
        "setting.scan.startup.desc": "Lancer un scan en arrière-plan dès le chargement de ComfyUI.",
        "setting.sync.rating.name": "Majoor: Sync rating/tags vers fichiers",
        "setting.sync.rating.desc": "Écrire les notes et tags dans les métadonnées des fichiers (ExifTool).",
        "setting.obs.enabled.name": "Majoor: Activer logs détaillés",
        "setting.obs.enabled.desc": "Active les logs détaillés côté backend pour le debugging.",
        "setting.probe.mode.name": "Majoor: Backend métadonnées",
        "setting.probe.mode.desc": "Choisir l'outil pour extraire les métadonnées des fichiers.",
        "setting.minimap.enabled.name": "Majoor: Activer Minimap",
        "setting.minimap.enabled.desc": "Activation globale de la minimap du workflow.",

        "setting.sec.safe.name": "Majoor: Mode sécurisé",
        "setting.sec.safe.desc": "Quand activé, les écritures rating/tags sont bloquées sauf autorisation explicite.",
        "setting.sec.write.name": "Majoor: Autoriser écriture",
        "setting.sec.write.desc": "Autorise l'écriture des notes et tags.",
        "setting.sec.del.name": "Majoor: Autoriser suppression",
        "setting.sec.del.desc": "Active la suppression de fichiers.",
        "setting.sec.ren.name": "Majoor: Autoriser renommage",
        "setting.sec.ren.desc": "Active le renommage de fichiers.",
        "setting.sec.open.name": "Majoor: Autoriser ouvrir dans dossier",
        "setting.sec.open.desc": "Active l'ouverture dans le dossier.",
        "setting.sec.reset.name": "Majoor: Autoriser reset index",
        "setting.sec.reset.desc": "Reset le cache d'index et relance un scan complet."
    }
};

export const initI18n = (app) => {
    try {
        // 1. Try AGL.Locale (ComfyUI-Translation)
        const aglWrapper = app?.ui?.settings?.getSettingValue ? app.ui.settings.getSettingValue("AGL.Locale") : null;
        if (aglWrapper && typeof aglWrapper === "string") {
            currentLang = aglWrapper;
            return;
        }

        // 2. Try Comfy Settings (generic) if exists?
        // ...

        // 3. Fallback to browser - DISABLED by user request (prefer English)
        /*
        if (typeof navigator !== "undefined" && navigator.language) {
            // Map "fr-CA" to "fr-FR" if needed, or just use strict match or prefix match
            if (navigator.language.startsWith("fr")) {
                currentLang = "fr-FR";
                return;
            }
        }
        */
    } catch {}
};

export const t = (key, defaultText) => {
    const dict = DICTIONARY[currentLang] || DICTIONARY[DEFAULT_LANG];
    // Fallback to English if key missing in current lang
    const fallbackDict = DICTIONARY[DEFAULT_LANG];
    
    return dict[key] || fallbackDict[key] || defaultText || key;
};

export const getCurrentLang = () => currentLang;
