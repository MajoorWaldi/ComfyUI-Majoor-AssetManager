# Testing

This project uses `pytest`. On Windows, batch runners are provided for convenience and generate both:
- JUnit XML (`.xml`)
- a styled HTML report (`.html`)

Reports are written to:
- `tests/__reports__/`

Open the index:
- `tests/__reports__/index.html`

## Quick commands

From the repo root:

```bash
python -m pytest -q
```

Run a single folder:

```bash
python -m pytest tests/metadata -q
```

## Batch runners (Windows)

From the repo root:

- Full suite: `run_tests.bat` (delegates to `tests/run_tests_all.bat`)
- Quick suite (skips `test_comfy_output`): `run_tests_quick.bat`
- Metadata / parser suite: `run_tests_parser.bat`

Category runners:

- `tests/config/run_tests_config.bat`
- `tests/core/run_tests_core.bat`
- `tests/database/run_tests_database.bat`
- `tests/features/run_tests_features.bat`
- `tests/metadata/run_tests_metadata.bat`
- `tests/rating_tags/run_tests_rating_tags.bat`
- `tests/regressions/run_tests_regressions.bat`

All batch runners support `/nopause` for non-interactive runs:

```bat
run_tests_quick.bat /nopause
```

## Test artifacts (DB/WAL/SHM)

Some tests create SQLite files. Pytest temp files are stored under:
- `tests/__pytest_tmp__/`

This includes `*.db`, `*.db-wal`, `*.db-shm`, and other runtime artifacts.

## Parser samples (metadata extraction)

`tests/metadata/test_parser_folder_scan.py` scans **every file** under:
- `tests/parser/` (recursive)

If you don't want to commit large samples, you can point the test to an external folder:

```powershell
$env:MJR_TEST_PARSER_DIR = "C:\path\to\parser"
python -m pytest tests/metadata/test_parser_folder_scan.py -q
```

