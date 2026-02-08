"""
Duplicate and similarity detection endpoints.
"""
from pathlib import Path
from aiohttp import web

try:
    import folder_paths  # type: ignore
except Exception:
    class _FolderPathsStub:
        @staticmethod
        def get_input_directory() -> str:
            return str((Path(__file__).resolve().parents[3] / "input").resolve())

    folder_paths = _FolderPathsStub()  # type: ignore

from backend.config import OUTPUT_ROOT
from backend.custom_roots import resolve_custom_root
from backend.shared import Result
from ..core import _json_response, _require_services, _csrf_error, _read_json


def _roots_for_scope(scope: str, custom_root_id: str = "") -> Result[list[str]]:
    s = str(scope or "output").strip().lower()
    if s in ("output", "outputs"):
        return Result.Ok([str(Path(OUTPUT_ROOT).resolve(strict=False))])
    if s in ("input", "inputs"):
        return Result.Ok([str(Path(folder_paths.get_input_directory()).resolve(strict=False))])
    if s == "all":
        return Result.Ok([
            str(Path(OUTPUT_ROOT).resolve(strict=False)),
            str(Path(folder_paths.get_input_directory()).resolve(strict=False)),
        ])
    if s == "custom":
        root = resolve_custom_root(str(custom_root_id or ""))
        if not root.ok:
            return Result.Err("INVALID_INPUT", root.error or "Invalid custom root")
        return Result.Ok([str(Path(str(root.data)).resolve(strict=False))])
    return Result.Err("INVALID_INPUT", f"Unknown scope: {scope}")


def register_duplicates_routes(routes: web.RouteTableDef) -> None:
    @routes.post("/mjr/am/duplicates/analyze")
    async def start_duplicates_analysis(request):
        csrf = _csrf_error(request)
        if csrf:
            return _json_response(Result.Err("CSRF", csrf))

        svc, error_result = await _require_services()
        if error_result:
            return _json_response(error_result)
        dup = svc.get("duplicates")
        if not dup:
            return _json_response(Result.Err("SERVICE_UNAVAILABLE", "Duplicate service unavailable"))

        body_res = await _read_json(request)
        if not body_res.ok:
            return _json_response(body_res)
        body = body_res.data or {}
        try:
            limit = int(body.get("limit", 250))
        except Exception:
            limit = 250
        result = await dup.start_background_analysis(limit=limit)
        return _json_response(result)

    @routes.get("/mjr/am/duplicates/status")
    async def duplicates_status(request):
        svc, error_result = await _require_services()
        if error_result:
            return _json_response(error_result)
        dup = svc.get("duplicates")
        if not dup:
            return _json_response(Result.Err("SERVICE_UNAVAILABLE", "Duplicate service unavailable"))
        return _json_response(await dup.get_status())

    @routes.get("/mjr/am/duplicates/alerts")
    async def duplicates_alerts(request):
        svc, error_result = await _require_services()
        if error_result:
            return _json_response(error_result)
        dup = svc.get("duplicates")
        if not dup:
            return _json_response(Result.Err("SERVICE_UNAVAILABLE", "Duplicate service unavailable"))

        scope = (request.query.get("scope") or "output").strip().lower()
        custom_root_id = request.query.get("custom_root_id") or request.query.get("root_id") or ""
        roots_res = _roots_for_scope(scope, str(custom_root_id))
        if not roots_res.ok:
            return _json_response(roots_res)

        try:
            max_groups = int(request.query.get("max_groups", "6"))
        except Exception:
            max_groups = 6
        try:
            max_pairs = int(request.query.get("max_pairs", "10"))
        except Exception:
            max_pairs = 10
        try:
            phash_distance = int(request.query.get("phash_distance", "6"))
        except Exception:
            phash_distance = 6
        result = await dup.get_alerts(
            roots=roots_res.data,
            max_groups=max_groups,
            max_pairs=max_pairs,
            phash_distance=phash_distance,
        )
        return _json_response(result)

    @routes.post("/mjr/am/duplicates/merge-tags")
    async def duplicates_merge_tags(request):
        csrf = _csrf_error(request)
        if csrf:
            return _json_response(Result.Err("CSRF", csrf))

        svc, error_result = await _require_services()
        if error_result:
            return _json_response(error_result)
        dup = svc.get("duplicates")
        if not dup:
            return _json_response(Result.Err("SERVICE_UNAVAILABLE", "Duplicate service unavailable"))

        body_res = await _read_json(request)
        if not body_res.ok:
            return _json_response(body_res)
        body = body_res.data or {}
        keep_asset_id = body.get("keep_asset_id")
        merge_asset_ids = body.get("merge_asset_ids") or []
        try:
            keep_asset_id = int(keep_asset_id)
        except Exception:
            return _json_response(Result.Err("INVALID_INPUT", "Invalid keep_asset_id"))
        if not isinstance(merge_asset_ids, list):
            return _json_response(Result.Err("INVALID_INPUT", "merge_asset_ids must be a list"))
        result = await dup.merge_tags_for_group(keep_asset_id, merge_asset_ids)
        return _json_response(result)
