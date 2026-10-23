"""Load the exchange-rate seeds (db/seeds/fx.json, db/seeds/fx_daily.json) inside `load`'s
transaction, synchronising each table row by row as the gold tables are."""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import psycopg

from .gold_load import TableSpec, rows_of, sync, upsert_sources

SEEDS = ("fx.json", "fx_daily.json")
DATASET_TABLES = {
    "vinara-fx-imf": ("country_currencies", "currency_changes", "fx_monthly", "fx_reporting"),
    "vinara-fx-daily": ("fx_daily",),
}

SPECS = {
    "currencies": TableSpec(
        "country_currencies",
        ("country_id",),
        ("currency_code", "union_name", "peg_anchor", "peg_parity", "peg_since", "source_id"),
        {
            "country_id": "int",
            "currency_code": "text",
            "union_name": "text",
            "peg_anchor": "text",
            "peg_parity": "num:6",
            "peg_since": "date",
            "source_id": "int",
        },
    ),
    "changes": TableSpec(
        "currency_changes",
        ("country_id", "effective_date"),
        ("old_code", "new_code", "old_per_new", "note", "handling"),
        {
            "country_id": "int",
            "effective_date": "date",
            "old_code": "text",
            "new_code": "text",
            "old_per_new": "num:6",
            "note": "text",
            "handling": "enum:currency_change_handling",
        },
    ),
    "monthly": TableSpec(
        "fx_monthly",
        ("country_id", "month"),
        ("per_usd_avg", "per_usd_end", "converted", "source_id"),
        {
            "country_id": "int",
            "month": "date",
            "per_usd_avg": "num:8",
            "per_usd_end": "num:8",
            "converted": "bool",
            "source_id": "int",
        },
    ),
    "daily": TableSpec(
        "fx_daily",
        ("currency_code", "day"),
        ("per_usd", "basis", "source_id"),
        {
            "currency_code": "text",
            "day": "date",
            "per_usd": "num:6",
            "basis": "enum:fx_daily_basis",
            "source_id": "int",
        },
    ),
    "reporting": TableSpec(
        "fx_reporting",
        ("country_id",),
        ("first_month", "last_month", "months_behind", "status"),
        {
            "country_id": "int",
            "first_month": "date",
            "last_month": "date",
            "months_behind": "int",
            "status": "enum:fx_status",
        },
    ),
}


class FxLoadError(RuntimeError):
    pass


def read(seeds_dir: Path) -> dict[str, Any] | None:
    paths = [seeds_dir / name for name in SEEDS]
    if not any(p.exists() for p in paths):
        return None
    missing = [p.name for p in paths if not p.exists()]
    if missing:
        raise FxLoadError(f"Missing {', '.join(missing)}; run `python -m pipelines fx`.")
    main, daily = (json.loads(p.read_text(encoding="utf-8")) for p in paths)
    return {"seed": main, "daily": daily, "datasets": main["datasets"], "sources": main["sources"]}


def load(cur: psycopg.Cursor[Any], data: dict[str, Any], add: Callable[[str, int], None]) -> None:
    seed = data["seed"]
    add("sources", upsert_sources(cur, data["sources"]))
    cur.execute("SELECT iso3, id FROM countries")
    countries = {str(k): int(v) for k, v in cur.fetchall()}
    cur.execute("SELECT source_key, id FROM sources")
    sources = {str(k): int(v) for k, v in cur.fetchall()}

    def country(iso3: str) -> int:
        if iso3 not in countries:
            raise FxLoadError(f"Exchange-rate seed references an unknown country {iso3!r}")
        return countries[iso3]

    def run(name: str, rows: list[dict[str, Any]]) -> None:
        add(SPECS[name].table, sync(cur, SPECS[name], rows))

    run(
        "currencies",
        [
            {
                "country_id": country(r["iso3"]),
                "currency_code": r["currency"],
                "union_name": r["union_name"],
                "peg_anchor": r["peg_anchor"],
                "peg_parity": r["peg_parity"],
                "peg_since": r["peg_since"],
                "source_id": sources["imf-areaer"] if r["peg_anchor"] else None,
            }
            for r in rows_of(seed["currencies"])
        ],
    )
    run(
        "changes",
        [
            {
                "country_id": country(r["iso3"]),
                "effective_date": r["date"],
                "old_code": r["old"],
                "new_code": r["new"],
                "old_per_new": r["old_per_new"],
                "note": r["note"],
                "handling": r["outcome"],
            }
            for r in rows_of(seed["changes"])
        ],
    )
    imf = sources["imf-er"]
    run(
        "monthly",
        [
            {
                "country_id": country(r["iso3"]),
                "month": r["month"],
                "per_usd_avg": r["per_usd_avg"],
                "per_usd_end": r["per_usd_end"],
                "converted": r["converted"],
                "source_id": imf,
            }
            for r in rows_of(seed["monthly"])
        ],
    )
    run(
        "reporting",
        [
            {
                "country_id": country(r["iso3"]),
                "first_month": r["first_month"],
                "last_month": r["last_month"],
                "months_behind": r["months_behind"],
                "status": r["status"],
            }
            for r in rows_of(seed["status"])
        ],
    )

    def source(key: str) -> int:
        if key not in sources:
            raise FxLoadError(f"Exchange-rate seed cites an unknown source {key!r}")
        return sources[key]

    run(
        "daily",
        [
            {
                "currency_code": r["currency"],
                "day": r["date"],
                "per_usd": r["per_usd"],
                "basis": r["basis"],
                "source_id": source(r["source"]),
            }
            for r in rows_of(data["daily"]["daily"])
        ],
    )
