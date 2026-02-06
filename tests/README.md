# Tests - Majoor Assets Manager

Test suite for ComfyUI-Majoor-AssetsManager.

---

## Test Structure

```
tests/
├── conftest.py                  # Pytest fixtures & shared setup
├── README.md
├── __init__.py
│
├── core/                        # Core functionality
│   ├── test_mvp.py              # MVP functionality
│   ├── test_index.py            # IndexService (scan/search)
│   ├── test_integration.py      # End-to-end integration
│   └── test_routes.py           # API route handlers
│
├── metadata/                    # Metadata extraction
│   ├── test_extractors.py
│   ├── test_geninfo_parser.py
│   ├── test_geninfo_from_parameters.py
│   ├── test_metadata_flags.py
│   ├── test_metadata_quality_monotonic.py
│   ├── test_exiftool_batch_matching.py
│   ├── test_video_metadata_extraction_encoded.py
│   ├── test_video_metadata_extraction_wrapped_comment.py
│   ├── test_video_generation_extraction.py
│   └── test_image_workflow_extraction_guards.py
│
├── rating_tags/                 # Ratings & tags
│   ├── test_rating_tags_import.py
│   ├── test_rating_tags_os_sync.py
│   ├── test_rating_tags_extractor_variants.py
│   └── test_asset_hydrate_rating_tags.py
│
├── assets/                      # Assets & search
│   ├── test_assets_batch.py
│   ├── test_assets_delete.py
│   ├── test_search_fts_metadata.py
│   └── test_stage_to_input_dedupe.py
│
├── database/                    # Database & schema
│   ├── test_schema_heal.py
│   ├── test_sqlite_query_in.py
│   └── test_index_service_geninfo_self_heal.py
│
├── config/                      # Config & security
│   ├── test_security.py
│   ├── test_settings.py
│   ├── test_observability_settings.py
│   ├── test_comfy_output.py
│   └── test_list_output_fs_fallback.py
│
├── features/                    # Feature tests
│   ├── test_collections_service.py
│   ├── test_batch_zip.py
│   ├── test_fast_scan.py
│   ├── test_date_histogram.py
│   └── test_viewer_grid_mask.py
│
└── regressions/                 # Regression tests
    ├── test_audit_issues_regressions.py
    ├── test_scan_batching.py
    └── test_logs.py
```

---

## Running Tests

### All tests (Windows)

Double-click `run_tests.bat` in the project root, or:

```bash
cd ComfyUI/custom_nodes/ComfyUI-Majoor-AssetsManager
python -m pytest tests/ -q
```

### Single test file

```bash
python -m pytest tests/core/test_index.py -v
```

### Single folder

```bash
python -m pytest tests/metadata/ -v
```

### Single test function

```bash
python -m pytest tests/core/test_index.py::test_scan_recursive -v
```

### With coverage
```bash
pytest tests/ --cov=backend --cov-report=html
```

---

## Test Categories

### `core/` - Core functionality

- Result pattern (Ok/Err)
- IndexService scan/search
- FTS5 full-text search
- API route handlers
- End-to-end integration

### `metadata/` - Metadata extraction

- ExifTool/FFprobe extraction
- PNG/WEBP/video generation info
- Workflow JSON parsing
- Quality score calculations

### `rating_tags/` - Ratings & tags

- Rating/tag extraction from files
- OS file sync
- Import operations

### `assets/` - Assets & search

- Batch operations
- Delete operations
- FTS5 search
- Staging deduplication

### `database/` - Database & schema

- Schema migration/healing
- SQLite query patterns
- Geninfo self-healing

### `config/` - Config & security

- CSRF protection
- Origin validation
- Rate limiting
- Path traversal prevention
- Settings persistence

### `features/` - Feature tests

- Collections CRUD
- Multi-file ZIP export
- Date histogram
- Viewer grid masks

### `regressions/` - Regression tests

- Audit issue fixes
- Scan batching regressions
- Logging system

---

## Writing Tests

### Test isolation
Each test should be independent using in-memory databases:

```python
def test_example():
    db = Sqlite(":memory:")
    migrate_schema(db)
    # ... test logic
    db.close()
```

### Result pattern
Always verify the Result pattern:

```python
def test_service_result():
    result = service.do_something()

    assert isinstance(result, Result)
    if result.ok:
        assert result.data is not None
    else:
        assert result.error is not None
```

### Mock external tools
Don't depend on ExifTool/FFprobe availability:

```python
class MockExifTool:
    def is_available(self):
        return False
```

---

## Fixtures

Common fixtures are defined in `conftest.py`:

- `test_db` - In-memory SQLite with schema
- `temp_dir` - Temporary directory for test files
- `mock_exiftool` - Mocked ExifTool adapter

---

## Resources

- [pytest docs](https://docs.pytest.org/)
- [Coverage.py](https://coverage.readthedocs.io/)

---

Last updated: January 2026
