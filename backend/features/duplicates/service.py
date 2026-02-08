"""
Background duplicate/similarity analysis.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
from pathlib import Path
from typing import Any, Dict, List, Optional

from PIL import Image

from ...adapters.db.sqlite import Sqlite
from ...shared import Result, get_logger

logger = get_logger(__name__)


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _compute_file_hash(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            chunk = f.read(1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def _compute_phash_hex(path: Path) -> Optional[str]:
    try:
        with Image.open(path) as im:
            g = im.convert("L").resize((8, 8), Image.Resampling.LANCZOS)
            px = list(g.tobytes())
        if not px:
            return None
        avg = sum(px) / len(px)
        bits = 0
        for i, v in enumerate(px):
            if v >= avg:
                bits |= (1 << i)
        return f"{bits:016x}"
    except Exception:
        return None


def _hamming_hex(a: str, b: str) -> int:
    try:
        return (int(a, 16) ^ int(b, 16)).bit_count()
    except Exception:
        return 64


class DuplicatesService:
    def __init__(self, db: Sqlite):
        self.db = db
        self._lock = asyncio.Lock()
        self._task: Optional[asyncio.Task] = None
        self._status: Dict[str, Any] = {
            "running": False,
            "processed": 0,
            "updated": 0,
            "errors": 0,
            "last_error": None,
        }

    def _set_status(self, **kwargs) -> None:
        try:
            self._status.update(kwargs)
        except Exception:
            pass

    async def start_background_analysis(self, limit: int = 250) -> Result[Dict[str, Any]]:
        async with self._lock:
            if self._task and not self._task.done():
                return Result.Ok({"started": False, "running": True, "status": self._status})
            self._set_status(running=True, processed=0, updated=0, errors=0, last_error=None)
            self._task = asyncio.create_task(self._run_background(limit=max(10, min(5000, int(limit or 250)))))
            return Result.Ok({"started": True, "running": True, "status": self._status})

    async def get_status(self) -> Result[Dict[str, Any]]:
        running = bool(self._task and not self._task.done())
        self._set_status(running=running)
        return Result.Ok(dict(self._status))

    async def _run_background(self, limit: int) -> None:
        try:
            rows_res = await self.db.aquery(
                """
                SELECT id, filepath, kind, size, mtime, content_hash, phash, hash_state
                FROM assets
                ORDER BY indexed_at DESC, id DESC
                LIMIT ?
                """,
                (int(limit),),
            )
            if not rows_res.ok:
                self._set_status(running=False, last_error=rows_res.error or "Query failed")
                return

            rows = rows_res.data or []
            for row in rows:
                aid = _safe_int((row or {}).get("id"))
                fp = str((row or {}).get("filepath") or "")
                kind = str((row or {}).get("kind") or "").lower()
                size = _safe_int((row or {}).get("size"))
                mtime = _safe_int((row or {}).get("mtime"))
                current_state = f"{mtime}:{size}"
                known_state = str((row or {}).get("hash_state") or "")
                known_content = str((row or {}).get("content_hash") or "")
                known_phash = str((row or {}).get("phash") or "")
                path = Path(fp)

                self._status["processed"] = _safe_int(self._status.get("processed")) + 1
                if not aid or not fp or not path.exists() or not path.is_file():
                    self._status["errors"] = _safe_int(self._status.get("errors")) + 1
                    continue
                if known_state == current_state and known_content and (kind != "image" or known_phash):
                    continue

                try:
                    content_hash = await asyncio.to_thread(_compute_file_hash, path)
                    phash = None
                    if kind == "image":
                        phash = await asyncio.to_thread(_compute_phash_hex, path)
                    upd = await self.db.aexecute(
                        """
                        UPDATE assets
                        SET content_hash = ?, phash = ?, hash_state = ?
                        WHERE id = ?
                        """,
                        (content_hash, phash, current_state, aid),
                    )
                    if upd.ok:
                        self._status["updated"] = _safe_int(self._status.get("updated")) + 1
                    else:
                        self._status["errors"] = _safe_int(self._status.get("errors")) + 1
                except Exception as exc:
                    self._status["errors"] = _safe_int(self._status.get("errors")) + 1
                    self._status["last_error"] = str(exc)
        except Exception as exc:
            self._set_status(last_error=str(exc))
        finally:
            self._set_status(running=False)

    async def get_alerts(
        self,
        roots: Optional[List[str]] = None,
        max_groups: int = 6,
        max_pairs: int = 10,
        phash_distance: int = 6,
    ) -> Result[Dict[str, Any]]:
        roots = roots or []
        max_groups = max(1, min(50, int(max_groups or 6)))
        max_pairs = max(1, min(100, int(max_pairs or 10)))
        phash_distance = max(0, min(32, int(phash_distance or 6)))

        where = ""
        params: List[Any] = []
        if roots:
            clauses = []
            for r in roots:
                clauses.append("a.filepath LIKE ?")
                params.append(str(Path(str(r)).resolve(strict=False)) + "%")
            where = f"WHERE ({' OR '.join(clauses)})"

        dup_q = f"""
            SELECT a.id, a.filepath, a.filename, a.content_hash, m.tags
            FROM assets a
            LEFT JOIN asset_metadata m ON m.asset_id = a.id
            {where}
            AND a.content_hash IS NOT NULL
            AND a.content_hash IN (
                SELECT content_hash
                FROM assets
                WHERE content_hash IS NOT NULL
                GROUP BY content_hash
                HAVING COUNT(1) > 1
            )
            ORDER BY a.content_hash, a.id
        """ if where else """
            SELECT a.id, a.filepath, a.filename, a.content_hash, m.tags
            FROM assets a
            LEFT JOIN asset_metadata m ON m.asset_id = a.id
            WHERE a.content_hash IS NOT NULL
            AND a.content_hash IN (
                SELECT content_hash
                FROM assets
                WHERE content_hash IS NOT NULL
                GROUP BY content_hash
                HAVING COUNT(1) > 1
            )
            ORDER BY a.content_hash, a.id
        """
        dup_rows = await self.db.aquery(dup_q, tuple(params))
        if not dup_rows.ok:
            return Result.Err("DB_ERROR", dup_rows.error or "Duplicate query failed")

        groups: Dict[str, List[Dict[str, Any]]] = {}
        for row in dup_rows.data or []:
            key = str((row or {}).get("content_hash") or "")
            if not key:
                continue
            groups.setdefault(key, []).append({
                "id": _safe_int((row or {}).get("id")),
                "filepath": (row or {}).get("filepath"),
                "filename": (row or {}).get("filename"),
                "tags": (row or {}).get("tags") or "[]",
            })

        exact_groups = []
        for h, items in groups.items():
            if len(items) < 2:
                continue
            exact_groups.append({"hash": h, "count": len(items), "assets": items[:25]})
        exact_groups.sort(key=lambda g: g.get("count", 0), reverse=True)
        exact_groups = exact_groups[:max_groups]

        sim_q = f"""
            SELECT a.id, a.filepath, a.filename, a.phash
            FROM assets a
            {where}
            AND a.kind = 'image'
            AND a.phash IS NOT NULL
            ORDER BY a.id DESC
            LIMIT 800
        """ if where else """
            SELECT a.id, a.filepath, a.filename, a.phash
            FROM assets a
            WHERE a.kind = 'image'
            AND a.phash IS NOT NULL
            ORDER BY a.id DESC
            LIMIT 800
        """
        sim_rows = await self.db.aquery(sim_q, tuple(params))
        if not sim_rows.ok:
            return Result.Err("DB_ERROR", sim_rows.error or "Similarity query failed")

        images = sim_rows.data or []
        similar_pairs = []
        for i in range(len(images)):
            left = images[i] or {}
            lp = str(left.get("phash") or "")
            if not lp:
                continue
            for j in range(i + 1, len(images)):
                right = images[j] or {}
                rp = str(right.get("phash") or "")
                if not rp:
                    continue
                d = _hamming_hex(lp, rp)
                if d <= phash_distance:
                    similar_pairs.append({
                        "distance": d,
                        "left": {"id": _safe_int(left.get("id")), "filepath": left.get("filepath"), "filename": left.get("filename")},
                        "right": {"id": _safe_int(right.get("id")), "filepath": right.get("filepath"), "filename": right.get("filename")},
                    })
                    if len(similar_pairs) >= max_pairs:
                        break
            if len(similar_pairs) >= max_pairs:
                break

        similar_pairs.sort(key=lambda p: p.get("distance", 64))

        return Result.Ok({
            "exact_groups": exact_groups,
            "similar_pairs": similar_pairs,
            "status": dict(self._status),
        })

    async def merge_tags_for_group(self, keep_asset_id: int, merge_asset_ids: List[int]) -> Result[Dict[str, Any]]:
        keep_asset_id = int(keep_asset_id or 0)
        merge_ids = [int(x) for x in (merge_asset_ids or []) if int(x or 0) > 0 and int(x or 0) != keep_asset_id]
        if not keep_asset_id or not merge_ids:
            return Result.Err("INVALID_INPUT", "Invalid keep/merge asset ids")

        ids = [keep_asset_id] + merge_ids
        rows = await self.db.aquery_in(
            "SELECT asset_id, tags FROM asset_metadata WHERE {IN_CLAUSE}",
            "asset_id",
            ids,
        )
        if not rows.ok:
            return Result.Err("DB_ERROR", rows.error or "Failed to load tags")

        merged: List[str] = []
        seen = set()
        for row in rows.data or []:
            raw = (row or {}).get("tags")
            tags = []
            if isinstance(raw, str):
                try:
                    parsed = json.loads(raw)
                    if isinstance(parsed, list):
                        tags = parsed
                except Exception:
                    tags = []
            elif isinstance(raw, list):
                tags = raw
            for t in tags:
                if not isinstance(t, str):
                    continue
                v = t.strip()
                if not v:
                    continue
                k = v.lower()
                if k in seen:
                    continue
                seen.add(k)
                merged.append(v)

        upd = await self.db.aexecute(
            "UPDATE asset_metadata SET tags = ?, tags_text = ? WHERE asset_id = ?",
            (json.dumps(merged, ensure_ascii=False), " ".join(merged), keep_asset_id),
        )
        if not upd.ok:
            return Result.Err("DB_ERROR", upd.error or "Failed to update tags")
        return Result.Ok({"asset_id": keep_asset_id, "tags": merged, "merged_from": merge_ids})
