# Modernization Roadmap: ComfyUI-Majoor-AssetsManager

**Goal:** Align the extension with emerging Comfy-Org standards (`ComfyUI_frontend`, `comfy-cli`) to ensure long-term stability, native look-and-feel, and better maintainability.

---

## Phase 1: Compliance & Quick Wins (Immediate)
*Focus: Discoverability, minor styling, and cleanup.*

- [x] **Registry Metadata**: Update `comfyui_extension.json` with `tags` and strict types for better discoverability in the Manager.
- [x] **Theme Standardization**: Replace hardcoded CSS colors (e.g., `#222`, `#fff`) with ComfyUI native CSS variables (e.g., `var(--comfy-menu-bg)`, `var(--comfy-input-text)`) to support native Themes automatically.
- [x] **Dependency Lock**: Ensure `pyproject.toml` and `requirements.txt` are properly maintained.

## Phase 2: Code Quality & Safety (Short Term)
*Focus: Type safety without a build step.*

- [x] **JSDoc Typing**: Add extensive JSDoc annotations (@type, @param) to core files (`VirtualGrid.js`, `Card.js`, `GridView.js`) to enable "TS-check" in VS Code.
- [x] **Strict Event Cleanup**: Audit `grid` and `viewer` for event listener leaks (using `AbortController` pattern more widely).
  - [x] Patched potential leak in `js/features/viewer/toolbar.js` (fullscreen listener).
  - [x] Verified `videoSync.js` uses `AbortSignal`.

## Phase 3: Modern API Integration (Medium Term)
*Focus: Using the new Extension APIs instead of DOM injection.*

- [x] **Settings API**: Migrate `js/app/settings.js` from a custom HTML dialog to `app.ui.settings.addSetting`. This places Majoor settings inside the standard ComfyUI Settings modal.
- [~] **Context Menu API**: [SKIPPED] Investigation determined that `app.canvas.menu` is irrelevant for DOM overlays. See ADR-0003. Use custom implementation or Vue replacement instead.
- [x] **Standard Metadata Parsing**: Align `geninfo` parsing with the reference implementation in `ComfyUI_frontend` to support new workflow formats (.json embedded).

## Phase 4: Framework Migration (Long Term / Experimental)
*Focus: Aligning with Vue 3 migration of ComfyUI.*

- [x] **Vue Components**: Experiment with rewriting `Card.js` as a `.vue` component (requires build chain).
  - [x] Created `experimental/vue/` proof-of-concept.
  - [x] Implemented Vite build chain (`npm run build` -> `js/vue/majoor-ui.mjs`).
  - [x] Created `js/features/vue_adapter.js` for seamless integration.
- [x] **TypeScript**: Rename `.js` to `.ts` and correct types (requires build chain).
  - [x] Configured TypeScript in Vite build.
  - [x] Created sample TS utility (`experimental/vue/src/utils/formatting.ts`).
  - [x] Integrated TS into `Card.vue`.

---

## Tracking

*Started: 2026-02-01*
