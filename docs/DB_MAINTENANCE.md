# Database Maintenance

Majoor Assets Manager stores its index in an SQLite database at `<output>/_mjr_index/assets.sqlite`. This document covers the maintenance tools available in the UI and the recovery procedures for corruption scenarios.

## Buttons in the Status Panel

Open the Assets Manager panel and expand the **Index Status** section. Two action buttons appear at the bottom:

| Button | Purpose |
|---|---|
| **Reset index** | Clears cached data inside the existing database and triggers a background rescan. Requires the database to be readable. |
| **Delete DB** | Force-deletes the database files from disk (bypassing all DB-dependent checks) and rebuilds from scratch. Works even when the database is corrupted. |

## Reset Index

The **Reset index** button calls `POST /mjr/am/scan/reset` with flags to clear assets, metadata, FTS index, and scan journal, then triggers a full rescan.

If the database is corrupted, the reset will fail because security-preference queries cannot execute on a malformed database. When this happens:

- The status dot turns red.
- A toast appears: *"Reset failed -- database is corrupted. Use the Delete DB button to force-delete and rebuild."*

## Delete DB (Emergency Recovery)

The **Delete DB** button calls `POST /mjr/am/db/force-delete`. It is designed to work even when the database is completely unreadable.

### How it works

1. **CSRF check only** -- no database-dependent security queries are run.
2. **Adapter reset (fast path)** -- tries `db.areset()` first. If this succeeds the database is wiped through the adapter and a rescan starts immediately.
3. **Manual file deletion (fallback)** -- if the adapter reset fails (typical for severe corruption):
   - Calls `db.close()` to release connections.
   - Runs `gc.collect()` twice with a short delay to release Windows file handles.
   - Deletes `assets.sqlite`, `assets.sqlite-wal`, `assets.sqlite-shm`, and `assets.sqlite-journal` with up to 6 retries per file.
4. **Re-initialization** -- creates a fresh database with all tables, indexes, and triggers.
5. **Background rescan** -- triggers a full non-incremental scan of the output directory.

### Confirmation dialog

Before proceeding, a native browser `confirm()` dialog warns:

> This will permanently delete the index database and rebuild it from scratch. All ratings, tags, and cached metadata will be lost.

### What is lost

- Star ratings
- Custom tags
- Cached metadata (prompts, models, generation parameters)
- Scan journal / history

### What is preserved

- Original image/video/audio files (never touched)
- Collections (stored as separate JSON files in `_mjr_index/collections/`)
- Custom roots configuration (`_mjr_index/custom_roots.json`)
- All ComfyUI settings (stored in `localStorage`)

## Automatic Corruption Detection

The status polling loop (every few seconds) checks health counters via `GET /mjr/am/health/counters`. If the response error contains keywords like "malformed", "corrupt", or "disk image":

- The status dot turns red.
- The status text shows **"Database is corrupted"** with a hint to use the Delete DB button.
- A one-time toast notification appears with the same guidance.

The toast fires only once per session to avoid spamming. It resets after a successful Delete DB operation.

## Database Optimize

An additional endpoint `POST /mjr/am/db/optimize` runs `PRAGMA optimize` and `ANALYZE` on the database. This is useful after large scans or bulk deletes to keep query performance optimal. It is best-effort and never throws errors to the UI.

## Manual Recovery

If the Delete DB button reports that files could not be deleted (another process holds a lock):

1. Stop ComfyUI completely.
2. Navigate to `<output>/_mjr_index/`.
3. Delete `assets.sqlite` and any sibling files (`-wal`, `-shm`, `-journal`).
4. Restart ComfyUI.
5. The database will be recreated automatically on startup and a scan will populate it.

## Related Files

| File | Role |
|---|---|
| `backend/routes/handlers/db_maintenance.py` | `/db/optimize` and `/db/force-delete` endpoints |
| `backend/adapters/db/sqlite.py` | DB adapter with malformed detection and online recovery |
| `js/features/status/StatusDot.js` | Frontend status polling, corruption detection, Reset/Delete buttons |
| `js/api/client.js` | `forceDeleteDb()` API call |

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `MAJOOR_DB_TIMEOUT` | `30.0` | SQLite busy timeout (seconds) |
| `MAJOOR_DB_MAX_CONNECTIONS` | `8` | Maximum concurrent DB connections |
| `MAJOOR_DB_QUERY_TIMEOUT` | `30.0` | Per-query timeout (seconds) |
