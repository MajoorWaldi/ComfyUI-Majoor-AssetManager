# Keyboard Shortcuts

This document describes all keyboard shortcuts available in the Majoor Assets Manager.

## Design Principles

The shortcuts are designed to be:
- **Mnemonic** - Easy to remember (e.g., `T` for Tags, `B` for Bookmark/Collection)
- **Standard** - Consistent with industry tools (Adobe Lightroom, Windows Explorer, macOS Finder)
- **Non-conflicting** - Don't interfere with browser or ComfyUI defaults

---

## Grid View Shortcuts

These shortcuts work when the asset grid is focused.

### Rating (Lightroom/Bridge Standard)

| Shortcut | Action | Description |
|----------|--------|-------------|
| `1` | Set 1 star | ★☆☆☆☆ |
| `2` | Set 2 stars | ★★☆☆☆ |
| `3` | Set 3 stars | ★★★☆☆ |
| `4` | Set 4 stars | ★★★★☆ |
| `5` | Set 5 stars | ★★★★★ |
| `0` | Reset rating | Remove all stars |

### Viewing

| Shortcut | Action | Description |
|----------|--------|-------------|
| `Enter` or `Space` | Open Viewer | Open selected asset(s) in viewer |
| `D` | Details | Show metadata panel (sidebar) |
| `C` | Compare | Compare A/B mode (2 selected) |
| `G` | Grid/Gallery | Side-by-side 2×2 view (2-4 selected) |

### Organization

| Shortcut | Action | Description |
|----------|--------|-------------|
| `T` | Tags | Open tags editor |
| `B` | Bookmark | Add to collection |
| `Shift+B` | Remove bookmark | Remove from current collection |

### File Operations

| Shortcut | Action | Description |
|----------|--------|-------------|
| `Ctrl+Shift+C` | Copy path | Copy file path to clipboard |
| `Ctrl+S` | Save/Download | Download the file |
| `Ctrl+Shift+E` | Explorer | Open containing folder |
| `F2` | Rename | Rename the file |
| `Delete` / `Backspace` | Delete | Delete the file(s) |

### Search

| Shortcut | Action | Description |
|----------|--------|-------------|
| `Ctrl+F` / `Ctrl+K` | Focus search | Jump focus to the search box |
| `Ctrl+H` | Clear search | Clear the current search query |

### Selection

| Shortcut | Action | Description |
|----------|--------|-------------|
| `Ctrl+A` | Select All | Select all visible assets |
| `Ctrl+D` | Deselect All | Clear selection |
| `Click` | Select | Select single asset |
| `Ctrl+Click` | Toggle | Add/remove from selection |
| `Shift+Click` | Range | Select range of assets |

### Navigation

| Shortcut | Action | Description |
|----------|--------|-------------|
| `↑` `↓` `←` `→` | Navigate | Move focus between cards |

---

## Viewer Shortcuts

These shortcuts work when the viewer is open.

### Rating

| Shortcut | Action | Description |
|----------|--------|-------------|
| `1` - `5` | Set rating | Same as grid view |
| `0` | Reset rating | Remove all stars |

### Navigation

| Shortcut | Action | Description |
|----------|--------|-------------|
| `←` | Previous | Previous asset |
| `→` | Next | Next asset |
| `Escape` | Close | Close viewer |

### View Controls

| Shortcut | Action | Description |
|----------|--------|-------------|
| `G` | Grid overlay | Cycle through grid overlays (Rule of thirds, etc.) |
| `D` | Details | Toggle generation info panel |
| `Z` | Zebra | Toggle zebra stripes (exposure warning) |
| `I` | Info probe | Toggle pixel probe (color picker) |
| `L` | Loupe | Toggle magnifier loupe |
| `F` | Fullscreen | Toggle fullscreen mode |

### Zoom

| Shortcut | Action | Description |
|----------|--------|-------------|
| `+` / `=` | Zoom in | Increase zoom by 25% |
| `-` / `_` | Zoom out | Decrease zoom by 25% |
| `Alt+1` | 1:1 zoom | Toggle 100% pixel zoom |

### Video Playback

| Shortcut | Action | Description |
|----------|--------|-------------|
| `Space` | Play/Pause | Toggle video playback |
| `←` (in player bar) | Frame back | Step one frame backward |
| `→` (in player bar) | Frame forward | Step one frame forward |

### Tools

| Shortcut | Action | Description |
|----------|--------|-------------|
| `C` | Copy color | Copy probed color as hex (#RRGGBB) |

---

## Context Menu Shortcuts

Right-click on assets to see available actions with their shortcuts displayed.

### Grid Context Menu

| Action | Shortcut |
|--------|----------|
| Open Viewer | `Enter` |
| Show metadata panel | `D` |
| Compare A/B | `C` |
| Side-by-side | `G` |
| Open in Folder | `Ctrl+Shift+E` |
| Copy file path | `Ctrl+Shift+C` |
| Download | `Ctrl+S` |
| Add to collection | `B` |
| Edit Tags | `T` |
| Set rating | `1-5` |
| Rename | `F2` |
| Delete | `Del` |

### Viewer Context Menu

| Action | Shortcut |
|--------|----------|
| Copy file path | `Ctrl+Shift+C` |
| Download Original | `Ctrl+S` |
| Open in Folder | `Ctrl+Shift+E` |
| Add to collection | `B` |
| Edit Tags | `T` |
| Set rating | `1-5` |
| Rename | `F2` |
| Delete | `Del` |

---

## Platform Notes

### Windows
- `Ctrl` is used for modifier shortcuts
- `Delete` key for deletion
- `F2` for rename (Windows Explorer standard)

### macOS
- `Cmd` can be used instead of `Ctrl`
- `Backspace` can be used instead of `Delete`
- `F2` still works for rename

### Browser Conflicts

Some shortcuts may conflict with browser defaults:
- `Ctrl+S` (Save page) - We intercept this for download
- `Ctrl+D` (Bookmark page) - We use this for deselect

If conflicts occur, use the context menu (right-click) as an alternative.

---

## Customization

Currently, keyboard shortcuts are not customizable. This feature may be added in a future version.

To request changes or report conflicts, please open an issue on GitHub.

---

## Quick Reference Card

```
┌─────────────────────────────────────────────────────────────┐
│                    RATING (1-5, 0=reset)                    │
├─────────────────────────────────────────────────────────────┤
│  1 ★☆☆☆☆   2 ★★☆☆☆   3 ★★★☆☆   4 ★★★★☆   5 ★★★★★   0 Reset │
├─────────────────────────────────────────────────────────────┤
│                         VIEWING                             │
├─────────────────────────────────────────────────────────────┤
│  Enter/Space = Open Viewer    D = Details    C = Compare    │
│  G = Side-by-side            Esc = Close viewer             │
├─────────────────────────────────────────────────────────────┤
│                      ORGANIZATION                           │
├─────────────────────────────────────────────────────────────┤
│  T = Tags    B = Add to collection    Shift+B = Remove      │
├─────────────────────────────────────────────────────────────┤
│                     FILE OPERATIONS                         │
├─────────────────────────────────────────────────────────────┤
│  Ctrl+Shift+C = Copy path    Ctrl+S = Download              │
│  Ctrl+Shift+E = Open folder  F2 = Rename    Del = Delete    │
├─────────────────────────────────────────────────────────────┤
│                    VIEWER TOOLS                             │
├─────────────────────────────────────────────────────────────┤
│  G = Grid overlay    Z = Zebra    I = Probe    L = Loupe    │
│  +/- = Zoom    Alt+1 = 1:1 zoom    F = Fullscreen           │
└─────────────────────────────────────────────────────────────┘
```
