"""Download screener.db from the main Stock Scanner app and swap it in place."""

from __future__ import annotations

import json
import logging
import os
import shutil
import sqlite3
import threading
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from large_cap.digest_builder import screener_db_path

logger = logging.getLogger(__name__)

_SYNC_LOCK = threading.Lock()
_STATUS_PATH = Path(os.environ.get("SCREENER_DATA_DIR") or "/app/data") / "python-db-sync-status.json"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def read_sync_status() -> dict[str, Any]:
    if not _STATUS_PATH.is_file():
        return {"state": "idle"}
    try:
        return json.loads(_STATUS_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"state": "idle"}


def _write_sync_status(payload: dict[str, Any]) -> None:
    _STATUS_PATH.parent.mkdir(parents=True, exist_ok=True)
    _STATUS_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _export_variant() -> str:
    raw = (os.environ.get("SCREENER_DB_EXPORT_VARIANT") or "large_cap").strip().lower()
    return raw if raw else "large_cap"


def _prune_sync_artifacts(data_dir: Path) -> None:
    """Drop partial downloads and backups — slim sync needs only one DB file on disk."""
    for staged in data_dir.glob("screener.db.staged.*"):
        try:
            staged.unlink(missing_ok=True)
        except OSError:
            logger.warning("python_db_sync could not remove staged file %s", staged)
    backups_dir = data_dir / "backups"
    if not backups_dir.is_dir():
        return
    for old in backups_dir.glob("screener.db.before-sync.*"):
        try:
            old.unlink(missing_ok=True)
        except OSError:
            logger.warning("python_db_sync could not remove backup %s", old)


def _open_ro_sqlite(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)
    conn.execute("PRAGMA cache_size = -8192")
    return conn


def _validate_sqlite_db(path: Path) -> dict[str, str]:
    """Lightweight validation — no full/quick_check (too heavy on 512MB instances)."""
    header = path.read_bytes()[:15]
    if header != b"SQLite format 3":
        raise ValueError("Downloaded file is not a SQLite database")
    conn = _open_ro_sqlite(path)
    try:
        companies = conn.execute("SELECT COUNT(*) FROM companies").fetchone()
        latest = conn.execute("SELECT MAX(date) FROM daily_bars").fetchone()
        company_count = int(companies[0]) if companies else 0
        latest_date = str(latest[0]) if latest and latest[0] else ""
        if company_count <= 0 or not latest_date:
            raise ValueError(f"DB sanity check failed: companies={company_count}, latest={latest_date}")
        return {"companies": str(company_count), "latest_daily_bars": latest_date}
    finally:
        conn.close()


def _peer_export_config() -> tuple[str, str]:
    base = (os.environ.get("STOCK_SCANNER_APP_URL") or os.environ.get("STOCK_SCANNER_EXPORT_URL") or "").strip()
    if not base:
        raise ValueError(
            "STOCK_SCANNER_APP_URL is not configured on the Python service (main app base URL for DB export)."
        )
    token = (os.environ.get("INTERNAL_API_KEY") or "").strip()
    if not token:
        raise ValueError("INTERNAL_API_KEY is not configured")
    return base.rstrip("/"), token


def _export_url(base: str) -> str:
    variant = _export_variant()
    qs = urllib.parse.urlencode({"variant": variant})
    return f"{base}/api/admin/screener-db-export?{qs}"


def sync_screener_db_from_peer(*, wait: bool = False) -> dict[str, Any]:
    """
    Pull screener.db from the main app export endpoint and replace the local copy.

    Default variant ``large_cap`` downloads a slim DB (~300–800 MB) suitable for
    Render Starter (512 MB RAM). Set SCREENER_DB_EXPORT_VARIANT=full for the 6 GB export.
    """
    if not _SYNC_LOCK.acquire(blocking=False):
        running = read_sync_status()
        return {"ok": False, "status": "already_running", "running": running}

    dest = screener_db_path()
    data_dir = dest.parent
    data_dir.mkdir(parents=True, exist_ok=True)
    _prune_sync_artifacts(data_dir)

    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    staged = data_dir / f"screener.db.staged.{ts}"
    variant = _export_variant()

    running_status: dict[str, Any] = {
        "state": "running",
        "startedAt": _now_iso(),
        "completedAt": None,
        "error": None,
        "exportVariant": variant,
    }
    _write_sync_status(running_status)

    def _run() -> dict[str, Any]:
        try:
            base, token = _peer_export_config()
            export_url = _export_url(base)
            logger.info("python_db_sync downloading variant=%s from %s", variant, export_url)

            if dest.is_file():
                dest.unlink(missing_ok=True)
            for suffix in ("-wal", "-shm"):
                sidecar = Path(str(dest) + suffix)
                if sidecar.is_file():
                    sidecar.unlink(missing_ok=True)

            req = urllib.request.Request(
                export_url,
                headers={"Authorization": f"Bearer {token}", "Accept": "application/octet-stream"},
                method="GET",
            )
            with urllib.request.urlopen(req, timeout=7200) as resp:
                with staged.open("wb") as out:
                    shutil.copyfileobj(resp, out, length=1024 * 1024)

            if not staged.is_file() or staged.stat().st_size <= 0:
                raise ValueError("Downloaded staged DB is empty")

            stats = _validate_sqlite_db(staged)
            staged.replace(dest)

            completed = {
                **running_status,
                "state": "completed",
                "completedAt": _now_iso(),
                "dbSizeMb": round(dest.stat().st_size / (1024 * 1024)),
                "latestDailyBars": stats.get("latest_daily_bars"),
                "companies": stats.get("companies"),
                "error": None,
            }
            _write_sync_status(completed)
            logger.info(
                "python_db_sync complete variant=%s latest=%s companies=%s size_mb=%s",
                variant,
                stats.get("latest_daily_bars"),
                stats.get("companies"),
                completed["dbSizeMb"],
            )
            return {"ok": True, "status": "completed", **completed}
        except Exception as e:
            msg = str(e).strip() or e.__class__.__name__
            logger.error("python_db_sync failed: %s", msg)
            if staged.is_file():
                staged.unlink(missing_ok=True)
            failed = {
                **running_status,
                "state": "failed",
                "completedAt": _now_iso(),
                "error": msg,
            }
            _write_sync_status(failed)
            return {"ok": False, "status": "failed", "error": msg}
        finally:
            _SYNC_LOCK.release()

    if wait:
        return _run()
    thread = threading.Thread(target=_run, name="screener-db-sync", daemon=True)
    thread.start()
    return {"ok": True, "status": "started", "startedAt": running_status["startedAt"], "exportVariant": variant}
