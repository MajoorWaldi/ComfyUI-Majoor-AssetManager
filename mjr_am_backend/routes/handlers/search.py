"""
Search and list endpoints.
"""
import datetime
import asyncio
import re
import os
import json
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

from mjr_am_backend.config import OUTPUT_ROOT, TO_THREAD_TIMEOUT_S
from mjr_am_backend.custom_roots import resolve_custom_root
from mjr_am_backend.shared import Result, get_logger
from mjr_am_backend.features.index.metadata_helpers import MetadataHelpers
from ..core import _json_response, _require_services, _read_json, safe_error_message
from ..core.security import _check_rate_limit
from .filesystem import _list_filesystem_assets, _kickoff_background_scan

DEFAULT_LIST_LIMIT = 50
DEFAULT_LIST_OFFSET = 0
MAX_LIST_LIMIT = 5000
MAX_LIST_OFFSET = 1_000_000
MAX_RATING = 5
VALID_KIND_FILTERS = {"image", "video", "audio", "model3d"}
VALID_SORT_KEYS = {"mtime_desc", "mtime_asc", "name_asc", "name_desc", "none"}

LIST_RATE_LIMIT_MAX_REQUESTS = 50
LIST_RATE_LIMIT_WINDOW_SECONDS = 60

SEARCH_CHUNK_MIN = 50
SEARCH_CHUNK_MAX = 500
SEARCH_MERGE_TRIM_START = 256
SEARCH_MERGE_TRIM_RATIO = 2
SEARCH_MAX_BATCH_IDS = 200
AUTOCOMPLETE_RATE_LIMIT_MAX_REQUESTS = 40
AUTOCOMPLETE_RATE_LIMIT_WINDOW_SECONDS = 60

logger = get_logger(__name__)


def _asset_dedupe_key(asset: dict) -> str:
    fp = str((asset or {}).get("filepath") or "").strip()
    if not fp:
        return ""
    # Windows paths are case-insensitive: normalize casing/slashes for stable dedupe.
    if os.name == "nt":
        try:
            return os.path.normcase(os.path.normpath(fp))
        except Exception:
            return fp.lower()
    return fp


def _dedupe_assets_by_filepath(assets: list[dict]) -> list[dict]:
    out: list[dict] = []
    seen: set[str] = set()
    for asset in assets or []:
        if not isinstance(asset, dict):
            continue
        key = _asset_dedupe_key(asset)
        if key:
            if key in seen:
                continue
            seen.add(key)
        out.append(asset)
    return out


def _dedupe_result_assets_payload(payload: dict | None) -> dict:
    data = dict(payload or {})
    assets = data.get("assets")
    if isinstance(assets, list):
        deduped = _dedupe_assets_by_filepath(assets)
        data["assets"] = deduped
        # Keep total consistent with visible results for stable pagination UI.
        try:
            data["total"] = len(deduped) if int(data.get("total") or 0) < len(deduped) else int(data.get("total") or 0)
        except Exception:
            data["total"] = len(deduped)
    return data


def _norm_fp(fp: str) -> str:
    try:
        if os.name == "nt":
            return os.path.normcase(os.path.normpath(str(fp or "")))
    except Exception:
        pass
    return str(fp or "")


async def _hydrate_browser_assets_from_db(svc: dict | None, assets: list[dict]) -> list[dict]:
    if not isinstance(assets, list) or not assets:
        return assets or []
    db = (svc or {}).get("db") if isinstance(svc, dict) else None
    if not db:
        return assets

    filepaths = []
    for a in assets:
        if not isinstance(a, dict):
            continue
        if str((a or {}).get("kind") or "").lower() == "folder":
            continue
        fp = str((a or {}).get("filepath") or "").strip()
        if fp:
            filepaths.append(fp)
    if not filepaths:
        return assets

    try:
        rows_res = await db.aquery_in(
            """
            SELECT a.id, a.filepath, COALESCE(m.rating, 0) AS rating, COALESCE(m.tags, '[]') AS tags
            FROM assets a
            LEFT JOIN asset_metadata m ON m.asset_id = a.id
            WHERE {IN_CLAUSE}
            """,
            "a.filepath",
            filepaths,
        )
        if not rows_res.ok:
            return assets
        rows = rows_res.data or []
    except Exception:
        return assets

    by_fp: dict[str, dict] = {}
    for row in rows:
        try:
            key = _norm_fp(str((row or {}).get("filepath") or ""))
            if not key:
                continue
            by_fp[key] = row or {}
        except Exception:
            continue

    for a in assets:
        try:
            if str((a or {}).get("kind") or "").lower() == "folder":
                continue
            key = _norm_fp(str((a or {}).get("filepath") or ""))
            row = by_fp.get(key)
            if not row:
                continue
            rid = (row or {}).get("id")
            if rid is not None:
                a["id"] = int(rid)
            a["rating"] = int((row or {}).get("rating") or 0)
            raw_tags = (row or {}).get("tags")
            tags = []
            if isinstance(raw_tags, str):
                try:
                    parsed = json.loads(raw_tags)
                    if isinstance(parsed, list):
                        tags = [str(t) for t in parsed if isinstance(t, str)]
                except Exception:
                    tags = []
            elif isinstance(raw_tags, list):
                tags = [str(t) for t in raw_tags if isinstance(t, str)]
            a["tags"] = tags
        except Exception:
            continue
    return assets


async def _runtime_output_root(svc: dict | None) -> str:
    try:
        settings_service = (svc or {}).get("settings") if isinstance(svc, dict) else None
        if settings_service:
            override = await settings_service.get_output_directory()
            if override:
                return str(Path(override).resolve(strict=False))
    except Exception:
        pass
    return str(Path(OUTPUT_ROOT).resolve(strict=False))


def _touch_enrichment_pause(services: dict | None, seconds: float = 1.5) -> None:
    try:
        idx = (services or {}).get("index") if isinstance(services, dict) else None
        if idx and hasattr(idx, "pause_enrichment_for_interaction"):
            idx.pause_enrichment_for_interaction(seconds=seconds)
    except Exception:
        pass


def _is_under_root(root: str, fp: str) -> bool:
    try:
        root_p = Path(str(root)).resolve()
        fp_p = Path(str(fp)).resolve()
        common = os.path.commonpath([str(fp_p), str(root_p)])
        return Path(common).resolve() == root_p
    except Exception:
        return False


def _exclude_assets_under_root(assets: list[dict], root: str) -> list[dict]:
    out: list[dict] = []
    for a in assets or []:
        if not isinstance(a, dict):
            continue
        fp = str((a or {}).get("filepath") or "")
        if fp and _is_under_root(root, fp):
            continue
        out.append(a)
    return out


def _date_bounds_for_range(range_name, reference=None):
    if not range_name:
        return (None, None)
    now = _reference_as_utc(reference)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    if range_name == "today":
        start = today
        end = start + datetime.timedelta(days=1)
    elif range_name == "this_week":
        start = today - datetime.timedelta(days=today.weekday())
        end = start + datetime.timedelta(days=7)
    elif range_name == "this_month":
        start = today.replace(day=1)
        next_month = (start.replace(day=28) + datetime.timedelta(days=4)).replace(day=1)
        end = next_month
    else:
        return (None, None)
    return int(start.timestamp()), int(end.timestamp())


def _date_bounds_for_exact(value):
    try:
        parsed = datetime.datetime.strptime(value, "%Y-%m-%d")
    except Exception:
        return (None, None)
    start = parsed.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=datetime.timezone.utc)
    end = start + datetime.timedelta(days=1)
    return int(start.timestamp()), int(end.timestamp())


def _reference_as_utc(reference=None):
    """
    Normalize a datetime reference to an aware UTC timestamp.
    """
    if reference is None:
        return datetime.datetime.now(datetime.timezone.utc)
    if reference.tzinfo is None:
        return reference.replace(tzinfo=datetime.timezone.utc)
    return reference.astimezone(datetime.timezone.utc)


def _normalize_extension(value):
    """
    Normalize an extension token (drop leading dots, lowercase, trim punctuation).
    """
    if value is None:
        return ""
    try:
        text = str(value).strip()
    except Exception:
        return ""
    if not text:
        return ""
    text = text.lstrip(".").strip(",;")
    return text.lower()


def _parse_inline_query_filters(raw_query):
    """
    Extract inline filters like `ext:png`, `rating:5`, or `kind:video` from the raw query.
    Returns the cleaned query string (without those tokens) and a dictionary of filter hints.
    """
    if not raw_query:
        return "", {}
    tokens = str(raw_query).strip().split()
    cleaned = []
    filters = {}
    for token in tokens:
        if ":" not in token:
            cleaned.append(token)
            continue
        key, _, value = token.partition(":")
        key = (key or "").strip().lower()
        value = (value or "").strip().strip(",;")
        if not key or not value:
            cleaned.append(token)
            continue
        if key in ("ext", "extension"):
            ext = _normalize_extension(value)
            if ext:
                filters.setdefault("extensions", [])
                if ext not in filters["extensions"]:
                    filters["extensions"].append(ext)
            continue
        if key == "kind":
            kind_value = (value or "").strip().lower()
            if kind_value in VALID_KIND_FILTERS:
                filters["kind"] = kind_value
                continue
        if key == "rating":
            match = re.match(r"^(\d+)", value)
            if match:
                rating_val = max(0, min(MAX_RATING, int(match.group(1))))
                filters["min_rating"] = rating_val
                continue
        cleaned.append(token)
    return " ".join(cleaned).strip(), filters


def _normalize_sort_key(value: str | None) -> str:
    s = str(value or "").strip().lower()
    if s in VALID_SORT_KEYS:
        return s
    return "mtime_desc"


def register_search_routes(routes: web.RouteTableDef) -> None:
    """Register listing/search routes."""
    @routes.get("/mjr/am/autocomplete")
    async def autocomplete_assets(request):
        """
        Autocomplete tags/terms.
        
        Query params:
          q: prefix to complete
          limit: max results (default 10)
        """
        prefix = (request.query.get("q") or "").strip()
        try:
            limit = int(request.query.get("limit", "10"))
        except Exception:
            limit = 10
        limit = max(1, min(50, limit))

        allowed, retry_after = _check_rate_limit(
            request,
            "autocomplete",
            max_requests=AUTOCOMPLETE_RATE_LIMIT_MAX_REQUESTS,
            window_seconds=AUTOCOMPLETE_RATE_LIMIT_WINDOW_SECONDS,
        )
        if not allowed:
            return _json_response(
                Result.Err(
                    "RATE_LIMITED",
                    "Rate limit exceeded. Please wait before retrying.",
                    retry_after=retry_after,
                )
            )

        services, error = await _require_services()
        if error:
             return _json_response(error)
        _touch_enrichment_pause(services, seconds=1.2)

        # services["index"] is user's IndexService instance
        # IndexService exposes .searcher as a public attribute
        index_service = services["index"]
        if not hasattr(index_service, "searcher"):
             return _json_response(Result.Err("INTERNAL_ERROR", "Search service unavailable"))

        result = await index_service.searcher.autocomplete(prefix, limit)
        return _json_response(result)

    @routes.get("/mjr/am/list")
    async def list_assets(request):
        """
        List assets for a given UI scope.

        Query params:
          scope: output|input|all|custom  (default: output)
          q: search query (default: '*')
          limit: number of items (default: 50)
          offset: pagination offset (default: 0)
          subfolder: for input/custom browsing (default: '')
          custom_root_id: required when scope=custom
        """
        scope = (request.query.get("scope") or "output").strip().lower()
        raw_query = (request.query.get("q") or "").strip()
        parsed_query, inline_filters = _parse_inline_query_filters(raw_query)
        query = parsed_query or "*"

        allowed, retry_after = _check_rate_limit(
            request,
            "list_assets",
            max_requests=LIST_RATE_LIMIT_MAX_REQUESTS,
            window_seconds=LIST_RATE_LIMIT_WINDOW_SECONDS,
        )
        if not allowed:
            return _json_response(Result.Err("RATE_LIMITED", "Rate limit exceeded. Please wait before retrying.", retry_after=retry_after))

        MAX_OFFSET = MAX_LIST_OFFSET
        try:
            limit = int(request.query.get("limit", str(DEFAULT_LIST_LIMIT)))
            offset = int(request.query.get("offset", str(DEFAULT_LIST_OFFSET)))
        except ValueError:
            return _json_response(Result.Err("INVALID_INPUT", "Invalid limit or offset"))

        limit = max(0, min(MAX_LIST_LIMIT, limit))
        offset = max(0, offset)
        if offset > MAX_OFFSET:
            return _json_response(Result.Err("INVALID_INPUT", f"Offset must be less than {MAX_OFFSET}"))
        sort_key = _normalize_sort_key(request.query.get("sort"))

        filters = {}
        if "kind" in request.query:
            valid_kinds = {"image", "video", "audio", "model3d"}
            kind = request.query["kind"].strip().lower()
            if kind not in valid_kinds:
                return _json_response(Result.Err("INVALID_INPUT", f"Invalid kind. Must be one of: {', '.join(sorted(valid_kinds))}"))
            filters["kind"] = kind
        if "min_rating" in request.query:
            try:
                filters["min_rating"] = max(0, min(MAX_RATING, int(request.query["min_rating"])))
            except ValueError:
                return _json_response(Result.Err("INVALID_INPUT", "Invalid min_rating"))
        if "min_size_mb" in request.query:
            try:
                val = float(request.query["min_size_mb"])
                if val > 0:
                    filters["min_size_bytes"] = int(val * 1024 * 1024)
            except ValueError:
                return _json_response(Result.Err("INVALID_INPUT", "Invalid min_size_mb"))
        if "max_size_mb" in request.query:
            try:
                val = float(request.query["max_size_mb"])
                if val > 0:
                    filters["max_size_bytes"] = int(val * 1024 * 1024)
            except ValueError:
                return _json_response(Result.Err("INVALID_INPUT", "Invalid max_size_mb"))
        if "min_width" in request.query:
            try:
                val = int(request.query["min_width"])
                if val > 0:
                    filters["min_width"] = val
            except ValueError:
                return _json_response(Result.Err("INVALID_INPUT", "Invalid min_width"))
        if "min_height" in request.query:
            try:
                val = int(request.query["min_height"])
                if val > 0:
                    filters["min_height"] = val
            except ValueError:
                return _json_response(Result.Err("INVALID_INPUT", "Invalid min_height"))
        if "workflow_type" in request.query:
            wf_type = str(request.query["workflow_type"] or "").strip().upper()
            if wf_type:
                filters["workflow_type"] = wf_type
        if "has_workflow" in request.query:
            filters["has_workflow"] = request.query["has_workflow"].lower() in ("true", "1", "yes")

        date_exact = (request.query.get("date_exact") or "").strip()
        date_range = (request.query.get("date_range") or "").strip().lower()
        mtime_start = None
        mtime_end = None
        if date_exact:
            mtime_start, mtime_end = _date_bounds_for_exact(date_exact)
            if mtime_start is None or mtime_end is None:
                return _json_response(Result.Err("INVALID_INPUT", "Invalid date_exact"))
        elif date_range:
            mtime_start, mtime_end = _date_bounds_for_range(date_range)
            if mtime_start is None or mtime_end is None:
                return _json_response(Result.Err("INVALID_INPUT", "Invalid date_range"))
        if mtime_start is not None:
            filters["mtime_start"] = mtime_start
        if mtime_end is not None:
            filters["mtime_end"] = mtime_end

        if inline_filters:
            filters.update(inline_filters)

        # Keep default aligned with pre-refactor behavior:
        # list endpoints should include total unless explicitly disabled.
        include_total = request.query.get("include_total", "1").strip().lower() not in ("0", "false", "no", "off")

        if scope == "input":
            subfolder = request.query.get("subfolder", "")
            root_dir = Path(folder_paths.get_input_directory())
            svc, _ = await _require_services()
            _touch_enrichment_pause(svc, seconds=1.5)

            # If index service is available, try DB-first approach
            if svc and svc.get("index"):
                # Normalize root path for DB lookup
                root_path = str(root_dir.resolve(strict=False))
                scoped_filters = dict(filters or {})
                scoped_filters["source"] = "input"

                # Call index searcher with filters, limit, and offset
                db_result = await svc["index"].search_scoped(
                    query,
                    roots=[root_path],
                    limit=limit,
                    offset=offset,
                    filters=scoped_filters,
                    include_total=include_total,
                    sort=sort_key,
                )

                if db_result.ok:
                    # Add type to results for consistency
                    for a in db_result.data.get("assets") or []:
                        a["type"] = "input"

                    # Add scope info to response
                    db_result.data["scope"] = "input"

                    db_result.data = _dedupe_result_assets_payload(db_result.data)
                    return _json_response(db_result)

            # Fallback to filesystem if DB approach fails or is unavailable
            if query == "*" and offset == 0 and not filters:
                # Avoid scanning entire input trees just by opening the tab; only scan the current folder.
                await _kickoff_background_scan(str(root_dir), source="input", recursive=False, incremental=True)
            result = await _list_filesystem_assets(
                root_dir,
                subfolder,
                query,
                limit,
                offset,
                asset_type="input",
                filters=filters or None,
                index_service=(svc or {}).get("index") if isinstance(svc, dict) else None,
                sort=sort_key,
            )
            if result.ok and isinstance(result.data, dict):
                result.data = _dedupe_result_assets_payload(result.data)
            return _json_response(result)

        if scope == "custom":
            from mjr_am_backend.features.browser import (
                list_visible_subfolders,
                list_filesystem_browser_entries,
            )
            subfolder = request.query.get("subfolder", "")
            root_id = request.query.get("custom_root_id", "") or request.query.get("root_id", "")
            if not str(root_id or "").strip():
                svc, _ = await _require_services()
                browser_result = await asyncio.to_thread(
                    list_filesystem_browser_entries,
                    subfolder,
                    query,
                    limit,
                    offset,
                    kind_filter=str(filters.get("kind") or "") if filters else "",
                )
                try:
                    if browser_result.ok and isinstance(browser_result.data, dict):
                        assets = browser_result.data.get("assets") or []
                        browser_result.data["assets"] = await _hydrate_browser_assets_from_db(svc, assets)
                except Exception:
                    pass
                return _json_response(browser_result)
            root_result = resolve_custom_root(str(root_id or ""))
            if not root_result.ok:
                return _json_response(root_result)
            root_dir = root_result.data
            svc, _ = await _require_services()
            _touch_enrichment_pause(svc, seconds=1.5)

            # Fallback to filesystem if DB approach fails or is unavailable
            if query == "*" and offset == 0 and not filters:
                # Avoid scanning entire custom trees just by opening the tab; only scan the current folder.
                await _kickoff_background_scan(str(root_dir), source="custom", root_id=str(root_id), recursive=False, incremental=True)
            result = await _list_filesystem_assets(
                root_dir,
                subfolder,
                query,
                limit,
                offset,
                asset_type="custom",
                root_id=str(root_id),
                filters=filters or None,
                index_service=(svc or {}).get("index") if isinstance(svc, dict) else None,
                sort=sort_key,
            )
            if result.ok and isinstance(result.data, dict):
                result.data = _dedupe_result_assets_payload(result.data)
                folder_result = list_visible_subfolders(root_dir, subfolder, str(root_id or ""))
                if not folder_result.ok:
                    return _json_response(folder_result)
                folder_assets = folder_result.data or []
                if query not in ("", "*"):
                    ql = query.lower()
                    folder_assets = [f for f in folder_assets if ql in str(f.get("filename") or "").lower()]
                if filters and filters.get("kind"):
                    folder_assets = []
                file_assets = result.data.get("assets") or []
                hybrid_assets = folder_assets + file_assets if offset == 0 else file_assets
                result.data["assets"] = hybrid_assets
                try:
                    base_total = int(result.data.get("total") or 0)
                except Exception:
                    base_total = len(file_assets)
                result.data["total"] = base_total + (len(folder_assets) if offset == 0 else 0)
                result.data["scope"] = "custom"
            return _json_response(result)

        svc, error_result = await _require_services()
        if error_result:
            return _json_response(error_result)
        _touch_enrichment_pause(svc, seconds=1.5)

        output_root = await _runtime_output_root(svc)
        input_root = str(Path(folder_paths.get_input_directory()).resolve(strict=False))

        if scope == "all":
            # Prefer a single DB query when Inputs have been indexed (fast LIMIT/OFFSET, avoids O(offset) merges).
            # Fallback to the legacy Output(DB)+Input(filesystem) behavior until the Input root is present in DB.
            is_browse_all = query == "*"

            input_indexed = False
            try:
                has_input = await svc["index"].has_assets_under_root(input_root)
                if has_input.ok:
                    input_indexed = bool(has_input.data)
            except Exception:
                input_indexed = False

            if not input_indexed and query == "*" and offset == 0 and not filters:
                # Opportunistically index the input root so `scope=all` can become DB-only on later requests.
                await _kickoff_background_scan(str(Path(input_root)), source="input", recursive=False, incremental=True)

            if input_indexed:
                scoped = await svc["index"].search_scoped(
                    query,
                    roots=[output_root, input_root],
                    limit=limit,
                    offset=offset,
                    filters=filters or None,
                    include_total=include_total,
                    sort=sort_key,
                )
                if not scoped.ok:
                    return _json_response(scoped)
                data = scoped.data or {}
                assets = data.get("assets") or []

                def _under(root: str, fp: str) -> bool:
                    try:
                        import os

                        root_p = Path(str(root)).resolve()
                        fp_p = Path(str(fp)).resolve()
                        # commonpath raises on different drives; treat as not-under.
                        common = os.path.commonpath([str(fp_p), str(root_p)])
                        return Path(common).resolve() == root_p
                    except Exception:
                        return False

                for a in assets:
                    src = str((a or {}).get("source") or "").strip().lower()
                    if src in ("input", "output", "custom"):
                        a["type"] = src
                    else:
                        fp = str((a or {}).get("filepath") or "")
                        if fp and _under(input_root, fp):
                            a["type"] = "input"
                        else:
                            a["type"] = "output"

                payload = _dedupe_result_assets_payload(
                    {
                        "assets": assets,
                        "total": int(data.get("total") or 0),
                        "limit": limit,
                        "offset": offset,
                        "query": query,
                        "scope": scope,
                        "sort": sort_key,
                    }
                )
                return _json_response(Result.Ok(payload))

            if not limit:
                # Keep behavior predictable when limit==0: return empty page but valid total.
                out_count = await svc["index"].search_scoped(
                    query,
                    roots=[output_root],
                    limit=0,
                    offset=0,
                    filters={**(filters or {}), "source": "output"},
                    include_total=True,
                    sort=sort_key,
                )
                if not out_count.ok:
                    return _json_response(out_count)
                in_count = await _list_filesystem_assets(Path(input_root), "", query, 0, 0, asset_type="input", filters=filters or None, sort=sort_key)
                if not in_count.ok:
                    return _json_response(in_count)
                total = int((out_count.data or {}).get("total") or 0) + int((in_count.data or {}).get("total") or 0)
                return _json_response(Result.Ok({"assets": [], "total": total, "limit": 0, "offset": offset, "query": query, "scope": scope, "sort": sort_key}))

            # Non-browse queries keep deterministic concatenation: outputs first, then inputs.
            # This enables cheap pagination by splitting offsets instead of fetching everything.
            if not is_browse_all:
                out_res = await svc["index"].search_scoped(
                    query,
                    roots=[output_root],
                    limit=limit,
                    offset=offset,
                    filters={**(filters or {}), "source": "output"},
                    include_total=True,
                    sort=sort_key,
                )
                if not out_res.ok:
                    return _json_response(out_res)
                out_data = out_res.data or {}
                out_assets = out_data.get("assets") or []
                for a in out_assets:
                    a["type"] = "output"
                out_total = int(out_data.get("total") or 0)

                # If the requested page fits within outputs, we're done.
                if offset + limit <= out_total:
                    in_total_res = await _list_filesystem_assets(Path(input_root), "", query, 0, 0, asset_type="input", filters=filters or None, sort=sort_key)
                    if not in_total_res.ok:
                        return _json_response(in_total_res)
                    total = out_total + int((in_total_res.data or {}).get("total") or 0)
                    payload = _dedupe_result_assets_payload({"assets": out_assets, "total": total, "limit": limit, "offset": offset, "query": query, "scope": scope, "sort": sort_key})
                    return _json_response(Result.Ok(payload))

                # Need to spill over into inputs (or we're already past outputs).
                need = max(0, limit - len(out_assets))
                in_offset = max(0, offset - out_total)
                in_res = await _list_filesystem_assets(Path(input_root), "", query, need, in_offset, asset_type="input", filters=filters or None, sort=sort_key)
                if not in_res.ok:
                    return _json_response(in_res)
                in_data = in_res.data or {}
                in_assets = in_data.get("assets") or []
                total = out_total + int(in_data.get("total") or 0)
                assets = [*out_assets, *in_assets]
                payload = _dedupe_result_assets_payload({"assets": assets, "total": total, "limit": limit, "offset": offset, "query": query, "scope": scope, "sort": sort_key})
                return _json_response(Result.Ok(payload))

            # Browse-all (`*`): merge by mtime for better UX, with chunked streaming merge.
            chunk = max(SEARCH_CHUNK_MIN, min(SEARCH_CHUNK_MAX, int(limit) * 2))
            out_offset = 0
            in_offset = 0
            out_buf = []
            in_buf = []
            out_i = 0
            in_i = 0
            out_total = None
            in_total = None

            def _mtime(item) -> int:
                try:
                    return int((item or {}).get("mtime") or 0)
                except Exception:
                    return 0

            async def _fill_out():
                nonlocal out_total, out_offset
                if out_total is not None and out_offset >= out_total:
                    return
                res = await svc["index"].search_scoped(
                    "*",
                    roots=[output_root],
                    limit=chunk,
                    offset=out_offset,
                    filters={**(filters or {}), "source": "output"},
                    include_total=True,
                    sort=sort_key,
                )
                if not res.ok:
                    return res
                data = res.data or {}
                incoming_total = data.get("total")
                if incoming_total is not None:
                    out_total = int(incoming_total or 0)
                items = data.get("assets") or []
                for a in items:
                    a["type"] = "output"
                out_offset += len(items)
                out_buf.extend(items)
                return None

            async def _fill_in():
                nonlocal in_total, in_offset
                if in_total is not None and in_offset >= in_total:
                    return
                res = await _list_filesystem_assets(Path(input_root), "", "*", chunk, in_offset, asset_type="input", filters=filters or None, sort=sort_key)
                if not res.ok:
                    return res
                data = res.data or {}
                in_total = int(data.get("total") or 0)
                items = data.get("assets") or []
                in_offset += len(items)
                in_buf.extend(items)
                return None

            # Prime buffers (and totals)
            err = await _fill_out()
            if err:
                return _json_response(err)
            err = await _fill_in()
            if err:
                return _json_response(err)

            total = int(out_total or 0) + int(in_total or 0)
            target = offset + limit
            produced = 0
            page = []

            while produced < target:
                if out_i >= len(out_buf) and (out_total is None or out_offset < out_total):
                    err = await _fill_out()
                    if err:
                        return _json_response(err)
                if in_i >= len(in_buf) and (in_total is None or in_offset < in_total):
                    err = await _fill_in()
                    if err:
                        return _json_response(err)

                if out_i >= len(out_buf) and in_i >= len(in_buf):
                    break

                pick_out = False
                out_has = out_i < len(out_buf)
                in_has = in_i < len(in_buf)
                if out_has and in_has:
                    pick_out = _mtime(out_buf[out_i]) >= _mtime(in_buf[in_i])
                elif out_has:
                    pick_out = True

                if pick_out:
                    item = out_buf[out_i]
                    out_i += 1
                else:
                    item = in_buf[in_i]
                    in_i += 1

                # Periodically truncate consumed prefixes to keep buffers small.
                if out_i > SEARCH_MERGE_TRIM_START and out_i >= len(out_buf) // SEARCH_MERGE_TRIM_RATIO:
                    out_buf = out_buf[out_i:]
                    out_i = 0
                if in_i > SEARCH_MERGE_TRIM_START and in_i >= len(in_buf) // SEARCH_MERGE_TRIM_RATIO:
                    in_buf = in_buf[in_i:]
                    in_i = 0

                if produced >= offset:
                    page.append(item)
                    if len(page) >= limit:
                        break
                produced += 1

            if sort_key in ("name_asc", "name_desc", "mtime_asc"):
                reverse = sort_key == "name_desc"
                if sort_key.startswith("name_"):
                    page = sorted(page, key=lambda a: str((a or {}).get("filename") or "").lower(), reverse=reverse)
                elif sort_key == "mtime_asc":
                    page = sorted(page, key=lambda a: int((a or {}).get("mtime") or 0))
            payload = _dedupe_result_assets_payload({"assets": page, "total": total, "limit": limit, "offset": offset, "query": query, "scope": scope, "sort": sort_key})
            return _json_response(Result.Ok(payload))

        if scope not in ("output", "outputs"):
            return _json_response(Result.Err("INVALID_INPUT", f"Unknown scope: {scope}"))

        # Use DB search for output scope
        output_filters = {**(filters or {}), "source": "output", "exclude_root": input_root}
        out_res = await svc["index"].search_scoped(
            query,
            roots=[output_root],
            limit=limit,
            offset=offset,
            filters=output_filters,
            include_total=include_total,
            sort=sort_key,
        )
        # If nothing is indexed yet, fall back to a fast filesystem listing so the grid can populate
        # immediately (old behavior), and kick off a fast background scan to build the DB.
        try:
            is_initial = query == "*" and offset == 0 and not (filters or None)
            total = int((out_res.data or {}).get("total") or 0) if out_res.ok else 0
            if is_initial and out_res.ok and total == 0:
                await _kickoff_background_scan(
                    str(Path(output_root)),
                    source="output",
                    recursive=False,
                    incremental=True,
                    fast=True,
                    background_metadata=True,
                )
                fs_res = await _list_filesystem_assets(
                    Path(output_root),
                    "",
                    query,
                    limit,
                    offset,
                    asset_type="output",
                    filters=filters or None,
                    index_service=svc.get("index"),
                    sort=sort_key,
                )
                if fs_res.ok and isinstance(fs_res.data, dict):
                    filtered_assets = _exclude_assets_under_root(fs_res.data.get("assets") or [], input_root)
                    fs_res.data["assets"] = filtered_assets
                    for a in filtered_assets:
                        if isinstance(a, dict):
                            a["type"] = "output"
                    fs_res.data["scope"] = "output"
                    fs_res.data["mode"] = "filesystem"
                    try:
                        if "total" in fs_res.data:
                            fs_res.data["total"] = len(filtered_assets)
                    except Exception:
                        pass
                    fs_res.data = _dedupe_result_assets_payload(fs_res.data)
                return _json_response(fs_res)
        except Exception:
            pass

        if not out_res.ok:
            return _json_response(out_res)
        filtered_assets = _exclude_assets_under_root((out_res.data or {}).get("assets") or [], input_root)
        out_res.data["assets"] = filtered_assets
        try:
            if "total" in out_res.data:
                out_res.data["total"] = len(filtered_assets)
        except Exception:
            pass
        for a in filtered_assets:
            a["type"] = "output"
        payload = _dedupe_result_assets_payload({**out_res.data, "scope": "output", "sort": sort_key})
        return _json_response(Result.Ok(payload))

    @routes.get("/mjr/am/search")
    async def search_assets(request):
        """
        Search assets using FTS5.

        Query params:
            q: Search query
            limit: Max results (default: 50)
            offset: Pagination offset (default: 0)
            kind: Filter by file kind (image, video, audio, model3d)
            min_rating: Filter by minimum rating (0-5)
            has_workflow: Filter by workflow presence (true/false)
        """
        svc, error_result = await _require_services()
        if error_result:
            return _json_response(error_result)
        _touch_enrichment_pause(svc, seconds=1.5)

        raw_query = request.query.get("q", "").strip()
        parsed_query, inline_filters = _parse_inline_query_filters(raw_query)
        query = parsed_query or "*"

        allowed, retry_after = _check_rate_limit(request, "search_assets", max_requests=50, window_seconds=60)
        if not allowed:
            return _json_response(Result.Err("RATE_LIMITED", "Rate limit exceeded. Please wait before retrying.", retry_after=retry_after))

        # Parse pagination
        MAX_OFFSET = MAX_LIST_OFFSET
        try:
            limit = int(request.query.get("limit", "50"))
            offset = int(request.query.get("offset", "0"))
        except ValueError:
            result = Result.Err("INVALID_INPUT", "Invalid limit or offset")
            return _json_response(result)

        limit = max(0, min(MAX_LIST_LIMIT, limit))
        offset = max(0, offset)
        if offset > MAX_OFFSET:
            return _json_response(Result.Err("INVALID_INPUT", f"Offset must be less than {MAX_OFFSET}"))

        # Parse filters
        filters = {}
        if "kind" in request.query:
            valid_kinds = {"image", "video", "audio", "model3d"}
            kind = request.query["kind"].strip().lower()
            if kind not in valid_kinds:
                return _json_response(Result.Err("INVALID_INPUT", f"Invalid kind. Must be one of: {', '.join(sorted(valid_kinds))}"))
            filters["kind"] = kind
        if "min_rating" in request.query:
            try:
                filters["min_rating"] = max(0, min(5, int(request.query["min_rating"])))
            except ValueError:
                result = Result.Err("INVALID_INPUT", "Invalid min_rating")
                return _json_response(result)
        if "min_size_mb" in request.query:
            try:
                val = float(request.query["min_size_mb"])
                if val > 0:
                    filters["min_size_bytes"] = int(val * 1024 * 1024)
            except ValueError:
                return _json_response(Result.Err("INVALID_INPUT", "Invalid min_size_mb"))
        if "max_size_mb" in request.query:
            try:
                val = float(request.query["max_size_mb"])
                if val > 0:
                    filters["max_size_bytes"] = int(val * 1024 * 1024)
            except ValueError:
                return _json_response(Result.Err("INVALID_INPUT", "Invalid max_size_mb"))
        if "min_width" in request.query:
            try:
                val = int(request.query["min_width"])
                if val > 0:
                    filters["min_width"] = val
            except ValueError:
                return _json_response(Result.Err("INVALID_INPUT", "Invalid min_width"))
        if "min_height" in request.query:
            try:
                val = int(request.query["min_height"])
                if val > 0:
                    filters["min_height"] = val
            except ValueError:
                return _json_response(Result.Err("INVALID_INPUT", "Invalid min_height"))
        if "workflow_type" in request.query:
            wf_type = str(request.query["workflow_type"] or "").strip().upper()
            if wf_type:
                filters["workflow_type"] = wf_type
        if "has_workflow" in request.query:
            filters["has_workflow"] = request.query["has_workflow"].lower() in ("true", "1", "yes")

        if inline_filters:
            filters.update(inline_filters)

        include_total = request.query.get("include_total", "1").strip().lower() not in ("0", "false", "no", "off")
        result = await svc["index"].search(
            query,
            limit,
            offset,
            filters if filters else None,
            include_total=include_total,
        )
        if result.ok and isinstance(result.data, dict):
            result.data = _dedupe_result_assets_payload(result.data)
        return _json_response(result)

    @routes.post("/mjr/am/assets/batch")
    async def get_assets_batch(request):
        """
        Batch fetch assets by ID.

        JSON body:
            asset_ids: [1, 2, 3, ...]
        """
        svc, error_result = await _require_services()
        if error_result:
            return _json_response(error_result)

        body_res = await _read_json(request)
        if not body_res.ok:
            return _json_response(body_res)
        body = body_res.data or {}

        raw_ids = body.get("asset_ids") or body.get("ids") or []
        if not isinstance(raw_ids, list):
            return _json_response(Result.Err("INVALID_INPUT", "asset_ids must be a list"))

        ids = []
        for raw in raw_ids:
            try:
                n = int(raw)
            except Exception:
                continue
            if n <= 0:
                continue
            ids.append(n)
            if len(ids) >= SEARCH_MAX_BATCH_IDS:
                break

        result = await svc["index"].get_assets_batch(ids)
        return _json_response(result)

    @routes.get("/mjr/am/workflow-quick")
    async def get_workflow_quick(request):
        """
        Ultra-fast workflow-only lookup (no self-heal, no metadata extraction).

        Query params:
            filename: Asset filename
            subfolder: Optional subfolder
            type: Asset type (output, input, custom)
            root_id: Optional custom root ID

        Returns just the workflow JSON if available, or null.
        Designed for drag & drop operations where speed is critical.
        """
        # Rate limit to prevent DB spam
        allowed, retry_after = _check_rate_limit(request, "workflow_quick", max_requests=60, window_seconds=60)
        if not allowed:
            return _json_response(Result.Err("RATE_LIMITED", "Rate limit exceeded", retry_after=retry_after))

        svc, error_result = await _require_services()
        if error_result:
            return _json_response(error_result)

        filename = request.query.get("filename", "").strip()
        if not filename:
            return _json_response(Result.Err("INVALID_INPUT", "Missing filename"))

        subfolder = request.query.get("subfolder", "").strip()
        asset_type = request.query.get("type", "output").strip().lower()
        root_id = request.query.get("root_id", "").strip()

        try:
            # Direct SQL query without self-heal for maximum speed
            where_parts = ["a.filename = ?", "a.subfolder = ?", "a.source = ?"]
            params = [filename, subfolder, asset_type]

            if root_id:
                where_parts.append("a.root_id = ?")
                params.append(root_id)

            where_clause = " AND ".join(where_parts)

            result = await svc["index"].db.aquery(
                f"""
                SELECT m.metadata_raw, m.has_workflow
                FROM assets a
                LEFT JOIN asset_metadata m ON a.id = m.asset_id
                WHERE {where_clause}
                LIMIT 1
                """,
                tuple(params),
            )

            if result.ok and result.data and len(result.data) > 0:
                metadata_raw = result.data[0].get("metadata_raw")
                has_workflow = result.data[0].get("has_workflow")

                # Check if we have workflow data in metadata_raw
                if metadata_raw and (has_workflow or has_workflow is None):
                    try:
                        import json
                        metadata = json.loads(metadata_raw) if isinstance(metadata_raw, str) else metadata_raw
                        workflow = metadata.get("workflow") if isinstance(metadata, dict) else None
                        if workflow:
                            return web.json_response({"ok": True, "workflow": workflow})
                    except Exception:
                        pass

            return web.json_response({"ok": True, "workflow": None})

        except Exception as e:
            logger.error(f"workflow-quick lookup failed: {e}")
            return _json_response(Result.Err("QUERY_ERROR", safe_error_message(e, "Query failed")))

    @routes.get("/mjr/am/asset/{asset_id}")
    async def get_asset(request):
        """
        Get a single asset by ID.

        Path params:
            asset_id: Asset database ID
        """
        svc, error_result = await _require_services()
        if error_result:
            return _json_response(error_result)

        try:
            asset_id = int(request.match_info["asset_id"])
        except ValueError:
            result = Result.Err("INVALID_INPUT", "Invalid asset_id")
            return _json_response(result)

        hydrate = (request.query.get("hydrate") or "").strip().lower()

        result = await svc["index"].get_asset(asset_id)
        if not result.ok or not result.data:
            return _json_response(result)

        if hydrate in ("rating_tags", "ratingtags", "rt"):
            try:
                current = result.data or {}
                rating = int(current.get("rating") or 0)
                tags = current.get("tags") or []
                tags_empty = True
                if isinstance(tags, list):
                    tags_empty = len(tags) == 0
                elif isinstance(tags, str):
                    tags_empty = tags.strip() in ("", "[]")

                # Only hydrate when DB doesn't have values yet.
                if rating <= 0 or tags_empty:
                    fp = current.get("filepath")
                    if isinstance(fp, str) and fp:
                        meta_svc = svc.get("metadata")
                        db = svc.get("db")
                        if meta_svc and db:
                            try:
                                meta_res = await asyncio.wait_for(asyncio.to_thread(meta_svc.extract_rating_tags_only, fp), timeout=TO_THREAD_TIMEOUT_S)
                            except asyncio.TimeoutError:
                                meta_res = Result.Err("TIMEOUT", "Rating/tags extraction timed out")
                            if meta_res and meta_res.ok and meta_res.data:
                                try:
                                    await asyncio.wait_for(
                                        MetadataHelpers.write_asset_metadata_row(
                                            db,
                                            asset_id,
                                            Result.Ok(
                                                {
                                                    "rating": meta_res.data.get("rating"),
                                                    "tags": meta_res.data.get("tags") or [],
                                                    "quality": "partial",
                                                }
                                            ),
                                        ),
                                        timeout=TO_THREAD_TIMEOUT_S,
                                    )
                                except Exception:
                                    pass
                                # Re-fetch after best-effort update.
                                result = await svc["index"].get_asset(asset_id)
            except Exception:
                pass

        return _json_response(result)

