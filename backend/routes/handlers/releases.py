"""
Expose repository refs (tags/branches) and a ZIP template for programmatic installs.

Endpoint: GET /mjr/am/releases
Query params:
  - owner (default: MajoorWaldi)
  - repo (default: ComfyUI-Majoor-AssetsManager)
  - per_page (default: 100)

Returns a `Result` with `data` containing `tags`, `branches`, and `zip_url_template`.
If GitHub is unreachable, returns a `Result.Err` with code `DEGRADED`.
"""
from __future__ import annotations

import os
import asyncio
from typing import Any

from aiohttp import web, ClientSession

from backend.shared import Result, get_logger
from ..core import _json_response

logger = get_logger(__name__)


def register_releases_routes(routes: web.RouteTableDef) -> None:
    @routes.get("/mjr/am/releases")
    async def get_releases(request: web.Request) -> web.Response:
        owner = (request.query.get("owner") or "MajoorWaldi").strip()
        repo = (request.query.get("repo") or "ComfyUI-Majoor-AssetsManager").strip()
        try:
            per_page = int(request.query.get("per_page") or "100")
        except Exception:
            per_page = 100

        token = os.environ.get("GITHUB_TOKEN") or os.environ.get("MAJOOR_GITHUB_TOKEN")
        headers = {"Accept": "application/vnd.github.v3+json"}
        if token:
            headers["Authorization"] = f"token {token}"

        tags_url = f"https://api.github.com/repos/{owner}/{repo}/tags?per_page={per_page}"
        branches_url = f"https://api.github.com/repos/{owner}/{repo}/branches?per_page={per_page}"

        try:
            async with ClientSession() as session:
                async def fetch(url: str) -> Any:
                    async with session.get(url, headers=headers, timeout=30) as resp:
                        if resp.status != 200:
                            text = await resp.text()
                            raise RuntimeError(f"GitHub API returned {resp.status}: {text}")
                        return await resp.json()

                tags_json, branches_json = await asyncio.gather(fetch(tags_url), fetch(branches_url))

            tags = [t.get("name") for t in (tags_json or []) if isinstance(t, dict) and t.get("name")]
            branches = [b.get("name") for b in (branches_json or []) if isinstance(b, dict) and b.get("name")]

            zip_url_template = f"https://github.com/{owner}/{repo}/archive/refs/{{ref}}.zip"

            data = {
                "owner": owner,
                "repo": repo,
                "tags": tags,
                "branches": branches,
                "zip_url_template": zip_url_template,
            }
            return _json_response(Result.Ok(data))
        except asyncio.TimeoutError:
            logger.debug("Timeout fetching GitHub refs for %s/%s", owner, repo)
            return _json_response(Result.Err("DEGRADED", "Timeout while contacting GitHub"))
        except Exception as exc:
            logger.debug("Failed to fetch GitHub refs for %s/%s: %s", owner, repo, exc)
            return _json_response(Result.Err("DEGRADED", "Failed to fetch repository refs", meta={"details": str(exc)}))
