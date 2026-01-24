import sys
from pathlib import Path

import pytest


from .repo_root import REPO_ROOT

if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


@pytest.fixture
def services(tmp_path):
    from backend.deps import build_services

    db_path = str(tmp_path / "test_services.db")
    svc = build_services(db_path)
    try:
        yield svc
    finally:
        try:
            svc.get("db").close()
        except Exception:
            pass
