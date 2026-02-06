# AGENTS — Directives pour Majoor Assets Manager

Updated: 2026-02-03

> **Status (as of 2026-02-03):** OPTIMIZED & STABLE. Critical performance audits complete. Virtual Scrolling & WebGL Player implemented. 
> Support added for Qwen (Edit), Flux (Advanced/GGUF), WanVideo (Kijai), HunyuanVideo (Kijai), Marigold (Depth).

## Objectif
Créer un **Assets Manager pour ComfyUI** qui indexe, recherche et gère les assets (images/vidéos) avec **ratings**, **tags**, **workflows**, et **metadata de génération**, sans faire planter l’UI.

## Règle d’or (Anti-crash)
- **Aucune exception ne doit remonter jusqu’à l’UI**.
- Côté Python: toujours retourner un `Result`.
- Côté JS: le client API ne doit pas throw (retourne `{ ok, data, error, code, meta }`).

### Pattern `Result`
```py
Result(ok=True/False, data=..., error=..., code="OK"|"DEGRADED"|"DB_ERROR"|..., meta={...})
```

### Routes HTTP
- Les routes doivent **retourner 200** pour les erreurs métier (ex: tool missing, metadata partielle).
- Status != 200 uniquement pour bug serveur réel (exception non gérée).

## Structure (actuelle)

```
ComfyUI-Majoor-AssetsManager/
  __init__.py
  comfyui_extension.json
  pyproject.toml
  requirements.txt
  README.md

  ressources/
    icon.png               # project icon (used by comfy metadata + header UI)

  backend/
    routes.py
    deps.py
    config.py
    adapters/
      db/                  # sqlite wrapper + schema + repos
      tools/               # exiftool/ffprobe wrappers
      fs/                  # scan helpers
    features/
      index/               # scan + search + incremental indexing
      metadata/            # extraction metadata + caching
      geninfo/             # parsing generation info (workflow/prompt)
      tags/
      collections/
      health/
      viewer/

  shared/
    result.py              # Result pattern (Ok/Err)
    log.py                 # structured logging
    types.py               # enums/constants

  js/
    entry.js               # entry point ComfyUI (registerSidebarTab)
    api/                   # client.js + endpoints.js
    app/                   # settings/dialogs/style/bootstrap
    components/
      Card.js              # cards + thumbs
      Viewer.js            # main viewer component
      VideoControls.js     # video player controls
      RatingEditor.js      # rating widget
      TagsEditor.js        # tags widget
      SidebarView.js       # shim → components/sidebar/SidebarView.js
      sidebar/             # modular sidebar implementation
        SidebarView.js
        sections/
        parsers/
        utils/
    features/
      panel/               # AssetsManagerPanel (controllers/views/state)
      grid/                # GridView.js
      viewer/              # viewer tools (panzoom, scopes, abCompare, etc.)
      dnd/                 # DragDrop (targets/utils/staging)
      status/              # StatusDot
      filters/             # calendar, attribute filters
      collections/         # collection management UI
    utils/                 # debounce, extractOutputFiles, safeCall
    theme/                 # theme-comfy.css

  tests/                   # ALL test files (pytest)
    conftest.py            # pytest fixtures
    README.md              # tests documentation
    test_*.py              # unit & integration tests

  docs/                    # Documentation & audit reports
    AGENTS.md              # docs-scope directives (this file applies globally)
    AUDIT_ISSUES.md        # issues tracking
    AUDIT_*.md             # various audit reports
    VIEWER_*.md            # viewer-specific audits
```

## Conventions de dev

### Backend (Python)
- **1 feature = 1 module** (`backend/features/<feature>/...`).
- Les services font le métier; les adapters encapsulent les dépendances externes (sqlite, exiftool, ffprobe).
- En cas d’erreur tool/parse: renvoyer `Result.Err(..., code="DEGRADED")` et continuer.
- Ne jamais faire remonter une exception jusqu’aux handlers HTTP (status != 200 uniquement si bug serveur réel).

### Frontend (JS)
- Garder les **points d’entrée stables**:
  - `js/entry.js`
  - `js/features/panel/AssetsManagerPanel.js` exporte `renderAssetsManager()` + `getActiveGridContainer()`
  - `js/components/SidebarView.js` exporte `createSidebar/showAssetInSidebar/closeSidebar` (shim OK)
  - `js/features/dnd/DragDrop.js` exporte `initDragDrop/enableAssetDrag`
- Refactor “safe” : déplacer helpers dans `controllers/`, `views/`, `utils/` sans casser imports/exports.

### Tests
- **Tous les tests doivent être dans `tests/`** (pas de `test_*.py` dans `backend/`).
- Lancer avec: `python -m pytest -q` ou `python -m pytest tests/`

### Git / hygiene
- Ne pas versionner: caches (`__pycache__/`, `.pytest_cache/`, etc.), DBs runtime, outputs ComfyUI.
- Les fixtures DB utilisées par les tests restent dans `tests/` (voir `.gitignore`).
