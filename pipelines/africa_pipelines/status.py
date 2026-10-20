"""`status`: print the freshness of every dataset (spec §5.4)."""

from __future__ import annotations

import argparse
from datetime import UTC, datetime, timedelta

import psycopg

from .settings import require_env

# How long after its last refresh a dataset counts as overdue.
CADENCE_LIMITS = {
    "weekly": timedelta(days=8),
    "monthly": timedelta(days=35),
    "quarterly": timedelta(days=100),
    "annual": timedelta(days=380),
}

STATUS_QUERY = """
SELECT d.key, d.as_of, d.coverage_start, d.coverage_end, d.last_refreshed_at,
       d.refresh_cadence::text, r.status::text, r.finished_at, r.rows_upserted
FROM datasets d
LEFT JOIN LATERAL (
  SELECT status, finished_at, rows_upserted FROM ingestion_runs
  WHERE dataset_id = d.id ORDER BY started_at DESC LIMIT 1
) r ON true
ORDER BY d.key
"""


def describe_age(when: datetime | None, now: datetime) -> str:
    if when is None:
        return "never"
    days = (now - when).days
    return "today" if days == 0 else f"{days} day{'s' if days != 1 else ''} ago"


def format_rows(rows: list[tuple[object, ...]], now: datetime) -> list[str]:
    lines = [
        f"{'dataset':<26} {'as of':<11} {'coverage':<23} {'refreshed':<12} {'cadence':<10} last run"
    ]
    for key, as_of, start, end, refreshed, cadence, status, _finished, rows_upserted in rows:
        coverage = f"{start or ''} to {end or ''}" if start or end else "reference data"
        refreshed_at = refreshed if isinstance(refreshed, datetime) else None
        overdue = ""
        limit = CADENCE_LIMITS.get(str(cadence))
        if limit is not None and (refreshed_at is None or now - refreshed_at > limit):
            overdue = "  ⚠ overdue"
        run = f"{status} ({rows_upserted} rows)" if status else "none"
        lines.append(
            f"{key!s:<26} {as_of!s:<11} {coverage:<23} {describe_age(refreshed_at, now):<12} "
            f"{cadence!s:<10} {run}{overdue}"
        )
    return lines


def configure(parser: argparse.ArgumentParser) -> None:
    del parser  # no options


def run(args: argparse.Namespace) -> int:
    del args
    url = require_env("DATABASE_URL_WRITE", purpose="read dataset freshness")
    with psycopg.connect(url) as conn:
        rows = conn.execute(STATUS_QUERY).fetchall()
    for line in format_rows(rows, datetime.now(UTC)):
        print(line)
    return 0
