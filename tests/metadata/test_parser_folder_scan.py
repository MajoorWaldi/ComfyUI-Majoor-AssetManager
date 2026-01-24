"""
Ensure metadata extraction safely handles every file under tests/parser (recursively).

This is meant to be future-proof: when new sample files are added (even in subfolders),
they are automatically included in this test.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from tests.repo_root import REPO_ROOT
from shared.types import classify_file


def test_metadata_extraction_scans_tests_parser_tree(services):
    metadata_service = services["metadata"]

    # Target folder resolution:
    # - Prefer explicit env override (lets you point to any parser folder).
    # - Else use repo-local tests/parser (intended location for sample assets).
    parser_env = str(os.environ.get("MJR_TEST_PARSER_DIR") or "").strip()
    tests_parser = REPO_ROOT / "tests" / "parser"

    parser_root = Path(parser_env) if parser_env else tests_parser
    if not parser_root.exists():
        raise AssertionError(
            f"Parser folder not found: {parser_root}. "
            "Create tests/parser/ and drop sample assets there, "
            "or set MJR_TEST_PARSER_DIR to an existing folder."
        )

    files = sorted([p for p in parser_root.rglob("*") if p.is_file()])
    if not files:
        pytest.skip(
            f"No sample files found in: {parser_root}. "
            "Drop your PNG/WEBP/MP4 samples there (including subfolders) to enable this scan."
        )

    failures: list[tuple[Path, str, str]] = []
    for path in files:
        kind = classify_file(str(path))
        result = metadata_service.get_metadata(str(path))

        # Unknown file types should be rejected cleanly.
        if kind == "unknown":
            if result.ok or result.code != "UNSUPPORTED":
                failures.append((path, result.code, result.error or ""))
            continue

        # Supported file types must not error (tools may be missing, but service should still Ok()).
        if not result.ok:
            failures.append((path, result.code, result.error or ""))
            continue

        data = result.data or {}
        if not isinstance(data, dict) or "file_info" not in data:
            failures.append((path, "INVALID_RESULT", "Missing file_info in metadata payload"))

    assert not failures, "Metadata extraction failures:\n" + "\n".join(
        f"- {p} [{code}] {err}" for (p, code, err) in failures
    )
