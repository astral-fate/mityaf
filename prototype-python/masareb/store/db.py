"""DuckDB access layer.

Single-writer by design: the API process owns one connection guarded by a lock,
and batch jobs run as separate processes while the API is down. That is the whole
concurrency story, and it is why DuckDB is sufficient here.
"""
from __future__ import annotations

import json
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

import duckdb

from masareb.config import settings

_SCHEMA = Path(__file__).parent / "schema.sql"
_lock = threading.RLock()
_conn: duckdb.DuckDBPyConnection | None = None


# ── CRS ────────────────────────────────────────────────────────────────────
# DuckDB's ST_Transform honours EPSG:4326 authority axis order (lat, lon) unless
# told otherwise, which silently swaps our coordinates: a 0.01 deg latitude step
# came back as 875 m instead of the true 1109 m. always_xy := true fixes it.
# Every metric operation MUST go through these helpers — never inline
# ST_Transform, or the bug comes back somewhere subtle.
def to_metric(geom_sql: str) -> str:
    """Wrap a geometry expression so it is projected to UTM 37N for metre maths."""
    return (
        f"ST_Transform({geom_sql}, '{settings.crs_geographic}', "
        f"'{settings.crs_metric}', always_xy := true)"
    )


def to_geographic(geom_sql: str) -> str:
    return (
        f"ST_Transform({geom_sql}, '{settings.crs_metric}', "
        f"'{settings.crs_geographic}', always_xy := true)"
    )


def area_m2(geom_sql: str = "geom") -> str:
    return f"ST_Area({to_metric(geom_sql)})"


def length_m(geom_sql: str = "geom") -> str:
    return f"ST_Length({to_metric(geom_sql)})"


def buffer_m(geom_sql: str, metres: float) -> str:
    """Buffer by a true metre distance, returning a 4326 geometry."""
    return to_geographic(f"ST_Buffer({to_metric(geom_sql)}, {metres})")


# ── connection ─────────────────────────────────────────────────────────────
def connect(path: Path | str | None = None, read_only: bool = False):
    db_path = Path(path) if path else settings.db_path
    db_path.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(db_path), read_only=read_only)
    con.execute("INSTALL spatial")
    con.execute("LOAD spatial")
    con.execute("INSTALL json")
    con.execute("LOAD json")
    return con


def get_conn() -> duckdb.DuckDBPyConnection:
    """Process-wide singleton connection."""
    global _conn
    with _lock:
        if _conn is None:
            _conn = connect()
            init_schema(_conn)
        return _conn


@contextmanager
def write() -> Iterator[duckdb.DuckDBPyConnection]:
    """Serialise writers. DuckDB allows one writer; this makes that explicit."""
    con = get_conn()
    with _lock:
        yield con


def split_statements(sql: str) -> list[str]:
    """Split on semicolons that actually terminate a statement.

    A plain sql.split(';') breaks this schema in two places: a ';' inside a `--`
    comment ("ring -> its green; segment -> its catchment") and a ';' inside a
    string literal ("...not published; approximated from..."). So track whether
    we are inside a line comment or a quoted string.
    """
    out: list[str] = []
    buf: list[str] = []
    in_str = False
    in_comment = False
    i = 0
    while i < len(sql):
        ch = sql[i]
        nxt = sql[i + 1] if i + 1 < len(sql) else ""
        if in_comment:
            if ch == "\n":
                in_comment = False
                buf.append(ch)
        elif in_str:
            buf.append(ch)
            if ch == "'":
                if nxt == "'":       # escaped quote
                    buf.append(nxt)
                    i += 1
                else:
                    in_str = False
        elif ch == "-" and nxt == "-":
            in_comment = True
            i += 1
        elif ch == "'":
            in_str = True
            buf.append(ch)
        elif ch == ";":
            stmt = "".join(buf).strip()
            if stmt:
                out.append(stmt)
            buf = []
        else:
            buf.append(ch)
        i += 1
    tail = "".join(buf).strip()
    if tail:
        out.append(tail)
    return out


def init_schema(con: duckdb.DuckDBPyConnection | None = None) -> None:
    con = con or get_conn()
    for stmt in split_statements(_SCHEMA.read_text(encoding="utf-8")):
        con.execute(stmt)


# ── audit ──────────────────────────────────────────────────────────────────
class RunLogger:
    """Append-only job audit. Ported from the palm pipeline's log_tracking, but
    into a table rather than a CSV, and with the coverage fields the honesty
    requirements need."""

    def __init__(self, job_name: str, params: dict[str, Any] | None = None):
        self.job_name = job_name
        self.params = params or {}
        self.run_id = f"{job_name}_{uuid.uuid4().hex[:8]}"
        self.started = datetime.now(timezone.utc)
        self.counts: dict[str, int] = {}

    def __enter__(self) -> "RunLogger":
        with write() as con:
            con.execute(
                "INSERT INTO pipeline_runs (run_id, job_name, started_at, status, params) "
                "VALUES (?,?,?,?,?)",
                [self.run_id, self.job_name, self.started, "running",
                 json.dumps(self.params, default=str)],
            )
        return self

    def add(self, **kw: int) -> None:
        for k, v in kw.items():
            self.counts[k] = self.counts.get(k, 0) + v

    def __exit__(self, exc_type, exc, tb) -> bool:
        finished = datetime.now(timezone.utc)
        duration = (finished - self.started).total_seconds()
        status = "failed" if exc else ("partial" if self.counts.get("errors") else "ok")
        with write() as con:
            con.execute(
                """UPDATE pipeline_runs SET finished_at=?, duration_s=?, status=?,
                       n_units_in=?, n_rows_written=?, n_events=?,
                       n_cloud_blocked=?, n_missed_revisit=?, n_sar_blind=?,
                       coverage_pct=?, gee_calls=?, error=?
                   WHERE run_id=?""",
                [
                    finished, duration, status,
                    self.counts.get("units_in", 0),
                    self.counts.get("rows_written", 0),
                    self.counts.get("events", 0),
                    self.counts.get("cloud_blocked", 0),
                    self.counts.get("missed_revisit", 0),
                    self.counts.get("sar_blind", 0),
                    self.counts.get("coverage_pct", 0) or None,
                    self.counts.get("gee_calls", 0),
                    f"{exc_type.__name__}: {exc}"[:400] if exc else None,
                    self.run_id,
                ],
            )
        print(f"[{self.job_name}] {status} in {duration:.1f}s  {self.counts}")
        return False  # never swallow the exception
