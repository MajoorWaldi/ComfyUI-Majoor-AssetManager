"""
Version reporting endpoint.
"""
from aiohttp import web

from backend.shared import Result
from shared.version import get_version_info
from ..core import _json_response


def register_version_routes(routes: web.RouteTableDef) -> None:
    """
    Expose the currently installed Majoor Assets Manager version.
    """
    @routes.get("/majoor/version")
    async def get_version(request: web.Request) -> web.Response:
        data = get_version_info()
        return _json_response(Result.Ok(data))
