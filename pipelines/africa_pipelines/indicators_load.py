"""Load Vinara's indicator seeds (db/seeds/indicators.json, db/seeds/external_debt_creditors.json)
inside `load`'s transaction, with the same row-by-row synchronisation as the gold tables: rows
are inserted, updated only when a value changed and deleted when they left the seed, so a second
run reports zero changes.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any, LiteralString

import psycopg

from .gold_load import TableSpec, rows_of, sync, upsert_sources

INDICATOR_SEEDS = ("indicators.json", "external_debt_creditors.json")
TABLES = ("indicators", "indicator_observations", "external_debt_creditors")
# Every Vinara indicator dataset shares these tables; each ingestion run counts all of them.
DATASET_TABLES = dict.fromkeys(
    ("vinara-wdi", "vinara-imf-weo", "vinara-sipri", "vinara-hdr", "vinara-ids"), TABLES
)

SPECS = {
    "indicators": TableSpec(
        "indicators",
        ("key",),
        ("name", "unit", "decimals", "definition", "source_code", "dataset_id", "sort_order"),
        {
            "key": "text",
            "name": "text",
            "unit": "text",
            "decimals": "int",
            "definition": "text",
            "source_code": "text",
            "dataset_id": "int",
            "sort_order": "int",
        },
    ),
    "observations": TableSpec(
        "indicator_observations",
        ("indicator_id", "country_id", "year"),
        ("value", "basis", "source_id", "edition"),
        {
            "indicator_id": "int",
            "country_id": "int",
            "year": "int",
            # Values carry at most 6 decimals (indicators.decimals); compare at that precision.
            "value": "num:6",
            "basis": "enum:observation_basis",
            "source_id": "int",
            "edition": "text",
        },
    ),
    "creditors": TableSpec(
        "external_debt_creditors",
        ("country_id", "year", "creditor_kind", "creditor_code"),
        ("creditor_name", "amount_usd", "source_id", "edition"),
        {
            "country_id": "int",
            "year": "int",
            "creditor_kind": "enum:creditor_kind",
            "creditor_code": "text",
            "creditor_name": "text",
            "amount_usd": "num:1",
            "source_id": "int",
            "edition": "text",
        },
    ),
}


class IndicatorsLoadError(RuntimeError):
    pass


def read(seeds_dir: Path) -> dict[str, Any] | None:
    """The indicator seeds, or None when the indicators pipeline has not run yet."""
    paths = [seeds_dir / name for name in INDICATOR_SEEDS]
    if not any(p.exists() for p in paths):
        return None
    missing = [p.name for p in paths if not p.exists()]
    if missing:
        raise IndicatorsLoadError(
            f"Missing {', '.join(missing)}; run `python -m pipelines indicators`."
        )
    main, creditors = (json.loads(p.read_text(encoding="utf-8")) for p in paths)
    return {
        "seed": main,
        "creditors": creditors,
        "datasets": main["datasets"],
        "sources": main["sources"],
    }


def _lookup(cur: psycopg.Cursor[Any], query: LiteralString) -> dict[str, int]:
    cur.execute(query)
    return {str(key): int(i) for key, i in cur.fetchall()}


def load(cur: psycopg.Cursor[Any], data: dict[str, Any], add: Callable[[str, int], None]) -> None:
    """Load the sources, indicators, observations and creditors; `add(table, n)` counts changes."""
    seed = data["seed"]
    add("sources", upsert_sources(cur, data["sources"]))
    countries = _lookup(cur, "SELECT iso3, id FROM countries")
    sources = _lookup(cur, "SELECT source_key, id FROM sources")
    datasets = _lookup(cur, "SELECT key, id FROM datasets")

    def ref(kind: str, table: dict[str, int], key: str) -> int:
        if key not in table:
            raise IndicatorsLoadError(f"Indicator seeds reference an unknown {kind} {key!r}")
        return table[key]

    add(
        "indicators",
        sync(
            cur,
            SPECS["indicators"],
            [
                {**r, "dataset_id": ref("dataset", datasets, r["dataset"])}
                for r in rows_of(seed["indicators"])
            ],
        ),
    )
    indicators = _lookup(cur, "SELECT key, id FROM indicators")
    editions: dict[str, str] = seed["editions"]
    add(
        "indicator_observations",
        sync(
            cur,
            SPECS["observations"],
            [
                {
                    "indicator_id": ref("indicator", indicators, r["indicator"]),
                    "country_id": ref("country", countries, r["iso3"]),
                    "year": r["year"],
                    "value": r["value"],
                    "basis": r["basis"],
                    "source_id": ref("source", sources, r["source"]),
                    "edition": editions[r["source"]],
                }
                for r in rows_of(seed["observations"])
            ],
        ),
    )
    names: dict[str, str] = data["creditors"]["creditor_names"]
    ids_source = ref("source", sources, "wb-ids")
    add(
        "external_debt_creditors",
        sync(
            cur,
            SPECS["creditors"],
            [
                {
                    "country_id": ref("country", countries, r["iso3"]),
                    "year": r["year"],
                    "creditor_kind": r["kind"],
                    "creditor_code": r["code"],
                    "creditor_name": names[r["code"]],
                    "amount_usd": r["amount_usd"],
                    "source_id": ids_source,
                    "edition": editions["wb-ids"],
                }
                for r in rows_of(data["creditors"]["creditors"])
            ],
        ),
    )
