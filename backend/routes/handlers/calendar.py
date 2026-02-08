"""
Calendar / date histogram endpoints.

Used by the UI to mark days that have assets (per month).
"""
import datetime
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
from backend.shared import Result, sanitize_error_message
from ..core import _json_response, _require_services


def _month_bounds(month_value: str) -> Result[tuple[int, int]]:
    """
    Convert YYYY-MM to [start_ts, end_ts) in local time.
    """
    try:
        dt = datetime.datetime.strptime(month_value, "%Y-%m")
    except Exception:
        return Result.Err("INVALID_INPUT", "Invalid month (expected YYYY-MM)")

    start = dt.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    # First day of next month.
    next_month = (start.replace(day=28) + datetime.timedelta(days=4)).replace(day=1)
    return Result.Ok((int(start.timestamp()), int(next_month.timestamp())))


def register_calendar_routes(routes: web.RouteTableDef) -> None:
    """Register calendar/date-histogram routes."""
    @routes.get("/mjr/am/date-histogram")
    async def date_histogram(request: web.Request):
        """
        Return day->count mapping for a given month.

        Query params:
          scope: output|input|all|custom (default: output)
          month: YYYY-MM (required)
          custom_root_id/root_id: required when scope=custom
          kind: image|video|audio|model3d (optional)
          min_rating: 0..5 (optional)
          has_workflow: true/false (optional)
        """
        month = (request.query.get("month") or "").strip()
        if not month:
            return _json_response(Result.Err("INVALID_INPUT", "Missing month (YYYY-MM)"))

        bounds = _month_bounds(month)
        if not bounds.ok:
            return _json_response(bounds)
        month_start, month_end = bounds.data

        scope = (request.query.get("scope") or "output").strip().lower()

        filters = {}
        if "kind" in request.query:
            valid_kinds = {"image", "video", "audio", "model3d"}
            kind = request.query["kind"].strip().lower()
            if kind not in valid_kinds:
                return _json_response(
                    Result.Err("INVALID_INPUT", f"Invalid kind. Must be one of: {', '.join(sorted(valid_kinds))}")
                )
            filters["kind"] = kind
        if "min_rating" in request.query:
            try:
                filters["min_rating"] = max(0, min(5, int(request.query["min_rating"])))
            except Exception:
                return _json_response(Result.Err("INVALID_INPUT", "Invalid min_rating"))
        if "has_workflow" in request.query:
            filters["has_workflow"] = request.query["has_workflow"].lower() in ("true", "1", "yes")

        svc, error_result = await _require_services()
        if error_result:
            return _json_response(error_result)

        output_root = str(Path(OUTPUT_ROOT).resolve(strict=False))
        input_root = str(Path(folder_paths.get_input_directory()).resolve(strict=False))

        roots: list[str] = []

        if scope == "input":
            roots = [input_root]
        elif scope == "all":
            roots = [output_root, input_root]
        elif scope == "custom":
            root_id = request.query.get("custom_root_id", "") or request.query.get("root_id", "")
            root_result = resolve_custom_root(str(root_id or ""))
            if not root_result.ok:
                return _json_response(root_result)
            roots = [str(Path(root_result.data).resolve(strict=False))]
        else:
            # Default: output
            roots = [output_root]

        try:
            res = await svc["index"].date_histogram_scoped(
                roots,
                month_start,
                month_end,
                filters=filters or None,
            )
        except Exception as exc:
            return _json_response(
                Result.Err("DB_ERROR", sanitize_error_message(exc, "Histogram failed"))
            )

        if not res.ok:
            return _json_response(res)

        return _json_response(Result.Ok({"month": month, "days": res.data or {}}))
