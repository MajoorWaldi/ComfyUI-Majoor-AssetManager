"""
Collections endpoints.

Collections are small JSON files that store a user-curated list of assets (by filepath + basic fields).
"""

from pathlib import Path
from typing import Any, Dict, List

from aiohttp import web

from backend.shared import Result, classify_file, get_logger, sanitize_error_message
from backend.features.collections import CollectionsService

from ..core import _json_response, _require_services, _read_json

logger = get_logger(__name__)

_collections = CollectionsService()


def _as_list(value: Any) -> List[Any]:
    if isinstance(value, list):
        return value
    return []


def _safe_assets_payload(value: Any) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for item in _as_list(value):
        if not isinstance(item, dict):
            continue
        fp = str(item.get("filepath") or "").strip()
        if not fp:
            continue
        out.append(item)
    return out


def _minimal_asset_from_item(item: Dict[str, Any]) -> Dict[str, Any]:
    fp = str(item.get("filepath") or "")
    p = Path(fp)
    kind = str(item.get("kind") or classify_file(fp) or "unknown").lower()
    filename = str(item.get("filename") or p.name)
    subfolder = str(item.get("subfolder") or "")
    asset_type = str(item.get("type") or "output").lower()
    root_id = item.get("root_id") or item.get("rootId") or item.get("custom_root_id") or None

    stat = None
    try:
        stat = p.stat()
    except Exception:
        stat = None

        return {
            "id": None,
            "filename": filename,
            "subfolder": subfolder,
            "filepath": fp,
            "kind": kind,
            "ext": p.suffix.lower(),
            "size": int(getattr(stat, "st_size", 0) or 0) if stat else 0,
            "mtime": int(getattr(stat, "st_mtime", 0) or 0) if stat else 0,
            "width": None,
            "height": None,
            "duration": None,
            "rating": 0,
            "tags": [],
            "has_workflow": None,
            "has_generation_data": None,
            "type": asset_type,
            "root_id": root_id,
        }


def register_collections_routes(routes: web.RouteTableDef) -> None:
    """Register collection management routes."""
    @routes.get("/mjr/am/collections")
    async def list_collections(request):
        try:
            result = _collections.list()
        except Exception as exc:
            result = Result.Err(
                "COLLECTIONS_FAILED",
                sanitize_error_message(exc, "Failed to list collections"),
            )
        return _json_response(result)

    @routes.post("/mjr/am/collections")
    async def create_collection(request):
        body_res = await _read_json(request)
        body = body_res.data if body_res.ok else {}
        name = str((body or {}).get("name") or "").strip()
        result = _collections.create(name)
        return _json_response(result)

    @routes.get(r"/mjr/am/collections/{collection_id}")
    async def get_collection(request):
        cid = str(request.match_info.get("collection_id") or "").strip()
        result = _collections.get(cid)
        return _json_response(result)

    @routes.post(r"/mjr/am/collections/{collection_id}/delete")
    async def delete_collection(request):
        cid = str(request.match_info.get("collection_id") or "").strip()
        result = _collections.delete(cid)
        return _json_response(result)

    @routes.post(r"/mjr/am/collections/{collection_id}/add")
    async def add_to_collection(request):
        cid = str(request.match_info.get("collection_id") or "").strip()
        body_res = await _read_json(request)
        body = body_res.data if body_res.ok else {}
        assets = _safe_assets_payload((body or {}).get("assets"))
        result = _collections.add_assets(cid, assets)
        return _json_response(result)

    @routes.post(r"/mjr/am/collections/{collection_id}/remove")
    async def remove_from_collection(request):
        cid = str(request.match_info.get("collection_id") or "").strip()
        body_res = await _read_json(request)
        body = body_res.data if body_res.ok else {}
        filepaths = [str(x) for x in _as_list((body or {}).get("filepaths")) if x]
        result = _collections.remove_filepaths(cid, filepaths)
        return _json_response(result)

    @routes.get(r"/mjr/am/collections/{collection_id}/assets")
    async def get_collection_assets(request):
        """
        Return the collection entries as asset-like objects for the grid,
        enriched from the index DB when possible.
        """
        cid = str(request.match_info.get("collection_id") or "").strip()
        col_res = _collections.get(cid)
        if not col_res.ok:
            return _json_response(col_res)

        collection = col_res.data or {}
        items = collection.get("items") if isinstance(collection, dict) else None
        items_list = items if isinstance(items, list) else []

        assets = []
        filepaths: List[str] = []
        for it in items_list:
            if not isinstance(it, dict):
                continue
            fp = str(it.get("filepath") or "").strip()
            if not fp:
                continue
            filepaths.append(fp)
            assets.append(_minimal_asset_from_item(it))

        # Enrich with DB fields when available
        try:
            svc, error_result = await _require_services()
            if not error_result and svc and "index" in svc:
                lookup = getattr(svc["index"], "lookup_assets_by_filepaths", None)
                if callable(lookup) and filepaths:
                    enrich = await lookup(filepaths)
                    if enrich and getattr(enrich, "ok", False) and isinstance(enrich.data, dict):
                        mapping = enrich.data
                        for a in assets:
                            fp = str(a.get("filepath") or "")
                            db_row = mapping.get(fp)
                            if not isinstance(db_row, dict):
                                continue
                            a["id"] = db_row.get("id")
                            a["rating"] = int(db_row.get("rating") or 0)
                            a["tags"] = db_row.get("tags") or []
                            a["has_workflow"] = db_row.get("has_workflow")
                            a["has_generation_data"] = db_row.get("has_generation_data")
                            if db_row.get("root_id"):
                                a["root_id"] = db_row.get("root_id")
        except Exception as exc:
            logger.debug("Collections assets enrichment skipped: %s", exc)

        return _json_response(Result.Ok({"id": cid, "name": collection.get("name"), "assets": assets}))

