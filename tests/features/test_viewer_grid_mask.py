import pytest
from tests.repo_root import REPO_ROOT


@pytest.mark.asyncio
async def test_viewer_grid_format_mask_supports_multi_rect() -> None:
    """
    Regression guard: the viewer's "format mask" must work in multi-media modes
    (side-by-side, A/B) and not assume a single rect/media element.
    """

    grid_js = REPO_ROOT / "js" / "features" / "viewer" / "grid.js"
    s = grid_js.read_text(encoding="utf-8", errors="replace")

    # Side-by-side mode exists and should be handled by the grid overlay logic.
    assert ".mjr-viewer-sidebyside" in s

    # The mask punch-out must support multiple rects (one per pane/media).
    assert "Array.isArray(rect)" in s
    assert "_drawMaskOutside(ctx," in s


@pytest.mark.asyncio
async def test_viewer_grid_format_mask_can_fallback_per_asset_size() -> None:
    """
    Regression guard: ensure the mask rect computation can use per-image asset dims
    (important in multi-image modes while processors are still loading).
    """

    grid_js = REPO_ROOT / "js" / "features" / "viewer" / "grid.js"
    media_factory_js = REPO_ROOT / "js" / "features" / "viewer" / "mediaFactory.js"

    grid_s = grid_js.read_text(encoding="utf-8", errors="replace")
    mf_s = media_factory_js.read_text(encoding="utf-8", errors="replace")

    assert "dataset.mjrAssetId" in mf_s
    assert "dataset?.mjrAssetId" in grid_s or "dataset.mjrAssetId" in grid_s
    assert "assetHint?.width" in grid_s


@pytest.mark.asyncio
async def test_viewer_close_button_triggers_full_dispose() -> None:
    """
    Regression guard: the top-right close button should fully dispose the viewer
    (not just hide the overlay), to avoid ghost listeners / stuck fixed elements.
    """

    viewer_js = REPO_ROOT / "js" / "components" / "Viewer.js"
    s = viewer_js.read_text(encoding="utf-8", errors="replace")

    assert "_requestCloseFromButton" in s
    assert "_requestCloseFromButton = () => api.dispose()" in s


@pytest.mark.asyncio
async def test_viewer_default_fit_is_height() -> None:
    """
    Regression guard: viewer default sizing should be fit-by-height (no tiny images).
    """

    panzoom_js = REPO_ROOT / "js" / "features" / "viewer" / "panzoom.js"
    s = panzoom_js.read_text(encoding="utf-8", errors="replace")

    # computeContainBaseSize now uses viewport height as the base dimension.
    assert "return { w: Vh * aspect, h: Vh };" in s


@pytest.mark.asyncio
async def test_viewer_hud_is_bbox_only() -> None:
    """
    Regression guard: the viewer HUD should avoid filename overlays, and render the bbox + image WxH
    via the grid overlay (so it follows zoom/pan consistently).
    """

    viewer_js = REPO_ROOT / "js" / "components" / "Viewer.js"
    grid_js = REPO_ROOT / "js" / "features" / "viewer" / "grid.js"

    viewer_s = viewer_js.read_text(encoding="utf-8", errors="replace")
    grid_s = grid_js.read_text(encoding="utf-8", errors="replace")

    assert "HUD: bbox + image WxH label" in viewer_s
    assert "_drawHudSizeLabel" in grid_s
    assert "strokeRect(r.x + 0.5" in grid_s
    assert "return `${hw}x${hh}`" in grid_s


@pytest.mark.asyncio
async def test_toolbar_help_popup_avoids_innerhtml() -> None:
    toolbar_js = REPO_ROOT / "js" / "features" / "viewer" / "toolbar.js"
    s = toolbar_js.read_text(encoding="utf-8", errors="replace")

    assert "helpPop.innerHTML" not in s


@pytest.mark.asyncio
async def test_context_menu_core_hides_on_pointerdown() -> None:
    """
    Regression guard: viewer pan/zoom handlers can preventDefault() and suppress "click";
    menu dismissal must also listen to pointerdown to avoid stuck menus.
    """

    menu_core_js = REPO_ROOT / "js" / "components" / "contextmenu" / "MenuCore.js"
    s = menu_core_js.read_text(encoding="utf-8", errors="replace")

    assert 'document.addEventListener(\n        "pointerdown"' in s or 'document.addEventListener("pointerdown"' in s


@pytest.mark.asyncio
async def test_viewer_probe_is_disabled_by_default() -> None:
    state_js = REPO_ROOT / "js" / "features" / "viewer" / "state.js"
    s = state_js.read_text(encoding="utf-8", errors="replace")

    assert "probeEnabled: false" in s


@pytest.mark.asyncio
async def test_video_sync_extracted_to_shared_module() -> None:
    viewer_js = REPO_ROOT / "js" / "components" / "Viewer.js"
    sync_js = REPO_ROOT / "js" / "features" / "viewer" / "videoSync.js"

    assert sync_js.exists()
    s = sync_js.read_text(encoding="utf-8", errors="replace")
    assert "installFollowerVideoSync" in s
    # Compare-mode regression: follower videos must keep looping in sync with the leader.
    assert 'Followers can reach "ended"' in s
    assert "installFollowerVideoSync" in viewer_js.read_text(encoding="utf-8", errors="replace")


@pytest.mark.asyncio
async def test_viewer_constants_and_processor_utils_exist() -> None:
    const_js = REPO_ROOT / "js" / "features" / "viewer" / "constants.js"
    proc_js = REPO_ROOT / "js" / "features" / "viewer" / "processorUtils.js"

    assert const_js.exists()
    assert proc_js.exists()


@pytest.mark.asyncio
async def test_media_factory_seeds_canvas_natural_size_from_asset() -> None:
    mf_js = REPO_ROOT / "js" / "features" / "viewer" / "mediaFactory.js"
    s = mf_js.read_text(encoding="utf-8", errors="replace")

    assert "_seedNaturalSizeFromAsset" in s
    assert "canvas._mjrNaturalW" in s
    assert "canvas._mjrNaturalH" in s


@pytest.mark.asyncio
async def test_listener_audit_fixes_present() -> None:
    toolbar_js = REPO_ROOT / "js" / "features" / "viewer" / "toolbar.js"
    viewer_js = REPO_ROOT / "js" / "components" / "Viewer.js"
    ab_js = REPO_ROOT / "js" / "features" / "viewer" / "abCompare.js"
    ctx_js = REPO_ROOT / "js" / "features" / "viewer" / "ViewerContextMenu.js"

    toolbar_s = toolbar_js.read_text(encoding="utf-8", errors="replace")
    viewer_s = viewer_js.read_text(encoding="utf-8", errors="replace")
    ab_s = ab_js.read_text(encoding="utf-8", errors="replace")
    ctx_s = ctx_js.read_text(encoding="utf-8", errors="replace")

    # Hover effects should not be implemented via untracked addEventListener.
    assert 'addEventListener("mouseenter"' not in toolbar_s
    assert 'addEventListener("mouseleave"' not in toolbar_s

    # Nav buttons must be tracked via safeAddListener (cleanup on dispose).
    assert "safeAddListener(prevBtn" in viewer_s
    assert "safeAddListener(nextBtn" in viewer_s

    # A/B slider drag listeners must be abortable.
    assert "_mjrSliderAbort" in ab_s
    assert "{ signal: sliderAC.signal" in ab_s

    # Viewer context menu must clear rating debounce timers on unbind.
    assert "_ratingDebounceTimers.clear" in ctx_s


@pytest.mark.asyncio
async def test_codebase_listeners_audit_fixes_present() -> None:
    sidebar_js = REPO_ROOT / "js" / "components" / "sidebar" / "SidebarView.js"
    rating_js = REPO_ROOT / "js" / "components" / "RatingEditor.js"
    tags_js = REPO_ROOT / "js" / "components" / "TagsEditor.js"

    sidebar_s = sidebar_js.read_text(encoding="utf-8", errors="replace")
    rating_s = rating_js.read_text(encoding="utf-8", errors="replace")
    tags_s = tags_js.read_text(encoding="utf-8", errors="replace")

    # Sidebar fallback (no AbortController) must remove window listeners on dispose.
    assert "unsubs.push" in sidebar_s
    assert "removeEventListener(ASSET_RATING_CHANGED_EVENT" in sidebar_s
    assert "removeEventListener(ASSET_TAGS_CHANGED_EVENT" in sidebar_s

    # Popover fallback should not register delayed document listeners without a way to cancel.
    assert "setTimeout(() => document.addEventListener(\"click\"" not in rating_s
    assert "setTimeout(() => document.addEventListener(\"click\"" not in tags_s
