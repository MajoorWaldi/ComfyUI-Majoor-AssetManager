import sys
from pathlib import Path
import asyncio
import pytest
import pytest_asyncio

from .repo_root import REPO_ROOT

if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

@pytest_asyncio.fixture
async def services(tmp_path):
    from backend.deps import build_services

    db_path = str(tmp_path / "test_services.db")
    # build_services is now async
    svc_res = await build_services(db_path)
    assert svc_res.ok, svc_res.error
    svc = svc_res.data
    try:
        yield svc
    finally:
        try:
            await svc.get("db").aclose()
        except Exception:
            pass
