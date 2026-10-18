"""Load the Dhahabu seeds (db/seeds/gold_*.json) inside `load`'s transaction.

Each table is synchronised with its seed: rows are inserted, updated only when a value changed,
and deleted when they left the seed, so a second run reports zero changes. Values are compared
at the column's own precision. The mines table is filled only when the mines layer passed its
quality bar (gold_mines.json says so); otherwise it is emptied.
"""

from __future__ import annotations

import datetime as dt
import json
from collections.abc import Callable
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Any

import psycopg
from psycopg import sql

GOLD_SEEDS = {
    "price": "gold_price.json",
    "production": "gold_production.json",
    "reserves": "gold_reserves.json",
    "trade": "gold_trade.json",
    "presence": "gold_presence.json",
    "profiles": "gold_profiles.json",
    "mines": "gold_mines.json",
}

# Which tables each dataset's ingestion run counts.
DATASET_TABLES = {
    "gold-price": ("gold_price_monthly",),
    "gold-production": (
        "gold_production_annual",
        "gold_production_source_priority",
        "gold_inground_reserves",
    ),
    "gold-official-reserves": ("gold_official_reserves",),
    "gold-trade": ("gold_trade_annual", "gold_trade_partners", "country_total_exports_annual"),
    "gold-presence": ("country_gold_profiles", "gold_profile_notes"),
    "gold-mines": ("gold_mines",),
}


class GoldLoadError(RuntimeError):
    pass


def read(seeds_dir: Path) -> dict[str, Any] | None:
    """The gold seeds, or None when no gold pipeline has run yet."""
    paths = {name: seeds_dir / file for name, file in GOLD_SEEDS.items()}
    present = {name: path.exists() for name, path in paths.items()}
    if not any(present.values()):
        return None
    missing = [GOLD_SEEDS[n] for n, ok in present.items() if not ok]
    if missing:
        raise GoldLoadError(
            f"Missing gold seeds: {', '.join(missing)}; run `python -m pipelines gold`."
        )
    seeds = {name: json.loads(path.read_text(encoding="utf-8")) for name, path in paths.items()}
    datasets = [d for seed in seeds.values() for d in seed.get("datasets", [])]
    sources: dict[str, dict[str, Any]] = {}
    for seed in seeds.values():
        for source in seed.get("sources", []):
            existing = sources.get(source["source_key"])
            if existing is not None and existing != source:
                raise GoldLoadError(f"Source {source['source_key']!r} differs between gold seeds")
            sources[source["source_key"]] = source
    return {"seeds": seeds, "datasets": datasets, "sources": list(sources.values())}


def rows_of(seed_table: dict[str, Any]) -> list[dict[str, Any]]:
    columns: list[str] = seed_table["columns"]
    return [dict(zip(columns, row, strict=True)) for row in seed_table["rows"]]


# ── Value normalisation (seed values and database values compare equal) ─────

Kind = str  # "int", "text", "bool", "date", "num:<scale>", "enum:<type>"


def normalise(kind: Kind, value: Any) -> Any:
    if value is None:
        return None
    if kind.startswith("num:"):
        scale = int(kind.split(":")[1])
        return Decimal(str(value)).quantize(Decimal(1).scaleb(-scale))
    if kind == "date":
        return value if isinstance(value, dt.date) else dt.date.fromisoformat(str(value))
    if kind == "int":
        return int(value)
    if kind == "bool":
        return bool(value)
    return str(value)


@dataclass(frozen=True)
class TableSpec:
    table: str
    key: tuple[str, ...]
    columns: tuple[str, ...]
    kinds: dict[str, Kind]

    def placeholder(self, column: str) -> sql.Composable:
        kind = self.kinds[column]
        if kind.startswith("enum:"):
            return sql.SQL("%s::{}").format(sql.Identifier(kind.split(":")[1]))
        return sql.SQL("%s")


def sync(cur: psycopg.Cursor[Any], spec: TableSpec, desired: list[dict[str, Any]]) -> int:
    """Make the table hold exactly `desired`; return rows inserted, updated or deleted."""
    every = spec.key + spec.columns
    wanted: dict[tuple[Any, ...], tuple[Any, ...]] = {}
    for row in desired:
        key = tuple(normalise(spec.kinds[c], row[c]) for c in spec.key)
        if key in wanted:
            raise GoldLoadError(f"{spec.table}: duplicate key {key}")
        wanted[key] = tuple(normalise(spec.kinds[c], row[c]) for c in spec.columns)
    cur.execute(
        sql.SQL("SELECT {} FROM {}").format(
            sql.SQL(", ").join(
                sql.SQL("{}::text").format(sql.Identifier(c))
                if spec.kinds[c].startswith("enum:")
                else sql.Identifier(c)
                for c in every
            ),
            sql.Identifier(spec.table),
        )
    )
    existing: dict[tuple[Any, ...], tuple[Any, ...]] = {}
    for record in cur.fetchall():
        values = [normalise(spec.kinds[c], v) for c, v in zip(every, record, strict=True)]
        existing[tuple(values[: len(spec.key)])] = tuple(values[len(spec.key) :])
    where = sql.SQL(" AND ").join(
        sql.SQL("{} = {}").format(sql.Identifier(c), spec.placeholder(c)) for c in spec.key
    )
    deletes = [key for key in existing if key not in wanted]
    inserts = [key + values for key, values in wanted.items() if key not in existing]
    updates = [
        values + key
        for key, values in wanted.items()
        if key in existing and existing[key] != values
    ]
    if deletes:
        cur.executemany(
            sql.SQL("DELETE FROM {} WHERE {}").format(sql.Identifier(spec.table), where), deletes
        )
    if updates and spec.columns:
        cur.executemany(
            sql.SQL("UPDATE {} SET {} WHERE {}").format(
                sql.Identifier(spec.table),
                sql.SQL(", ").join(
                    sql.SQL("{} = {}").format(sql.Identifier(c), spec.placeholder(c))
                    for c in spec.columns
                ),
                where,
            ),
            updates,
        )
    if inserts:
        cur.executemany(
            sql.SQL("INSERT INTO {} ({}) VALUES ({})").format(
                sql.Identifier(spec.table),
                sql.SQL(", ").join(sql.Identifier(c) for c in every),
                sql.SQL(", ").join(spec.placeholder(c) for c in every),
            ),
            inserts,
        )
    return len(deletes) + len(inserts) + len(updates)


SPECS = {
    "price": TableSpec(
        "gold_price_monthly",
        ("month",),
        ("usd_per_troy_oz", "source_id"),
        {"month": "date", "usd_per_troy_oz": "num:4", "source_id": "int"},
    ),
    "priority": TableSpec(
        "gold_production_source_priority",
        ("source_id",),
        ("priority",),
        {"source_id": "int", "priority": "int"},
    ),
    "production": TableSpec(
        "gold_production_annual",
        ("country_id", "year", "source_id"),
        ("tonnes", "basis", "notes"),
        {
            "country_id": "int",
            "year": "int",
            "source_id": "int",
            "tonnes": "num:3",
            "basis": "enum:gold_production_basis",
            "notes": "text",
        },
    ),
    "inground": TableSpec(
        "gold_inground_reserves",
        ("country_id", "year", "source_id"),
        ("tonnes_contained", "definition"),
        {
            "country_id": "int",
            "year": "int",
            "source_id": "int",
            "tonnes_contained": "num:1",
            "definition": "text",
        },
    ),
    "reserves": TableSpec(
        "gold_official_reserves",
        ("country_id", "as_of"),
        ("tonnes", "value_usd", "pct_of_total_reserves", "valuation", "source_id"),
        {
            "country_id": "int",
            "as_of": "date",
            "tonnes": "num:3",
            "value_usd": "num:2",
            "pct_of_total_reserves": "num:2",
            "valuation": "enum:gold_valuation",
            "source_id": "int",
        },
    ),
    "trade": TableSpec(
        "gold_trade_annual",
        ("country_id", "year", "flow", "hs_code", "basis"),
        ("net_weight_kg", "value_usd", "partner_count", "source_id", "notes"),
        {
            "country_id": "int",
            "year": "int",
            "flow": "enum:gold_trade_flow",
            "hs_code": "text",
            "basis": "enum:gold_trade_basis",
            "net_weight_kg": "num:3",
            "value_usd": "num:2",
            "partner_count": "int",
            "source_id": "int",
            "notes": "text",
        },
    ),
    "partners": TableSpec(
        "gold_trade_partners",
        ("country_id", "year", "flow", "basis", "rank"),
        ("partner_name", "partner_iso3", "value_usd", "net_weight_kg", "source_id"),
        {
            "country_id": "int",
            "year": "int",
            "flow": "enum:gold_trade_flow",
            "basis": "enum:gold_trade_basis",
            "rank": "int",
            "partner_name": "text",
            "partner_iso3": "text",
            "value_usd": "num:2",
            "net_weight_kg": "num:3",
            "source_id": "int",
        },
    ),
    "totals": TableSpec(
        "country_total_exports_annual",
        ("country_id", "year"),
        ("value_usd", "source_id"),
        {"country_id": "int", "year": "int", "value_usd": "num:2", "source_id": "int"},
    ),
    "profiles": TableSpec(
        "country_gold_profiles",
        ("country_id",),
        (
            "presence_tier",
            "presence_basis",
            "presence_confidence",
            "presence_as_of_year",
            "presence_source_id",
            "commercial_mining",
            "asm_present",
            "asm_share_pct_estimate",
            "asm_source_id",
            "summary",
            "needs_review",
            "review_notes",
        ),
        {
            "country_id": "int",
            "presence_tier": "enum:gold_presence_tier",
            "presence_basis": "text",
            "presence_confidence": "enum:confidence_level",
            "presence_as_of_year": "int",
            "presence_source_id": "int",
            "commercial_mining": "bool",
            "asm_present": "bool",
            "asm_share_pct_estimate": "num:1",
            "asm_source_id": "int",
            "summary": "text",
            "needs_review": "bool",
            "review_notes": "text",
        },
    ),
    "notes": TableSpec(
        "gold_profile_notes",
        ("country_id", "sort_order"),
        ("note", "source_id", "as_of", "needs_review", "review_notes"),
        {
            "country_id": "int",
            "sort_order": "int",
            "note": "text",
            "source_id": "int",
            "as_of": "date",
            "needs_review": "bool",
            "review_notes": "text",
        },
    ),
    "mines": TableSpec(
        "gold_mines",
        ("wikidata_qid",),
        (
            "name",
            "country_id",
            "latitude",
            "longitude",
            "status",
            "operator",
            "source_id",
            "needs_review",
            "review_notes",
        ),
        {
            "wikidata_qid": "text",
            "name": "text",
            "country_id": "int",
            "latitude": "num:6",
            "longitude": "num:6",
            "status": "text",
            "operator": "text",
            "source_id": "int",
            "needs_review": "bool",
            "review_notes": "text",
        },
    ),
}


def _ids(cur: psycopg.Cursor[Any]) -> tuple[dict[str, int], dict[str, int]]:
    cur.execute("SELECT iso3, id FROM countries")
    countries = {str(iso3): int(i) for iso3, i in cur.fetchall()}
    cur.execute("SELECT source_key, id FROM sources")
    sources = {str(key): int(i) for key, i in cur.fetchall()}
    return countries, sources


def upsert_sources(cur: psycopg.Cursor[Any], sources: list[dict[str, Any]]) -> int:
    changed = 0
    for s in sources:
        cur.execute(
            """
            INSERT INTO sources (source_key, ref_no, title, url, source_type, reliability_tier)
            VALUES (%s, %s, %s, %s, %s, %s::reliability_tier)
            ON CONFLICT (source_key) DO UPDATE SET
              ref_no = EXCLUDED.ref_no, title = EXCLUDED.title, url = EXCLUDED.url,
              source_type = EXCLUDED.source_type, reliability_tier = EXCLUDED.reliability_tier
            WHERE (sources.ref_no, sources.title, sources.url, sources.source_type,
                   sources.reliability_tier)
              IS DISTINCT FROM
                  (EXCLUDED.ref_no, EXCLUDED.title, EXCLUDED.url, EXCLUDED.source_type,
                   EXCLUDED.reliability_tier)
            """,
            (
                s["source_key"],
                s["ref_no"],
                s["title"],
                s["url"],
                s["source_type"],
                s["reliability_tier"],
            ),
        )
        changed += max(cur.rowcount, 0)
    return changed


def load(cur: psycopg.Cursor[Any], gold: dict[str, Any], add: Callable[[str, int], None]) -> None:
    """Load the gold sources and every gold table; `add(table, count)` records changed rows."""
    seeds = gold["seeds"]
    add("sources", upsert_sources(cur, gold["sources"]))
    countries, sources = _ids(cur)

    def country(iso3: str) -> int:
        if iso3 not in countries:
            raise GoldLoadError(f"Unknown country {iso3!r} in the gold seeds")
        return countries[iso3]

    def source(key: str | None) -> int | None:
        if key is None:
            return None
        if key not in sources:
            raise GoldLoadError(f"Gold seeds cite an unknown source {key!r}")
        return sources[key]

    def run(name: str, desired: list[dict[str, Any]]) -> None:
        add(SPECS[name].table, sync(cur, SPECS[name], desired))

    run(
        "price",
        [
            {
                "month": r["month"],
                "usd_per_troy_oz": r["usd_per_troy_oz"],
                "source_id": source(r["source"]),
            }
            for r in rows_of(seeds["price"]["prices"])
        ],
    )
    production = seeds["production"]
    # Rows that reference a source go before the priority list is replaced; ranks are unique, so
    # clear changed ranks first by syncing an empty list when the order changed.
    priority = [
        {"source_id": source(key), "priority": rank}
        for rank, key in enumerate(production["priority"], start=1)
    ]
    cur.execute("SELECT source_id, priority FROM gold_production_source_priority")
    if {(int(s), int(p)) for s, p in cur.fetchall()} != {
        (r["source_id"], r["priority"]) for r in priority
    }:
        add("gold_production_source_priority", sync(cur, SPECS["priority"], []))
    run("priority", priority)
    run(
        "production",
        [
            {
                "country_id": country(r["iso3"]),
                "year": r["year"],
                "tonnes": r["tonnes"],
                "basis": r["basis"],
                "source_id": source(r["source"]),
                "notes": r["notes"],
            }
            for r in rows_of(production["production"])
        ],
    )
    run(
        "inground",
        [
            {
                "country_id": country(r["iso3"]),
                "year": r["year"],
                "tonnes_contained": r["tonnes_contained"],
                "definition": r["definition"],
                "source_id": source(r["source"]),
            }
            for r in rows_of(production["inground_reserves"])
        ],
    )
    run(
        "reserves",
        [
            {
                "country_id": country(r["iso3"]),
                "as_of": r["as_of"],
                "tonnes": r["tonnes"],
                "value_usd": r["value_usd"],
                "pct_of_total_reserves": r["pct_of_total_reserves"],
                "valuation": r["valuation"],
                "source_id": source(r["source"]),
            }
            for r in rows_of(seeds["reserves"]["reserves"])
        ],
    )
    trade = seeds["trade"]
    run(
        "trade",
        [
            {
                "country_id": country(r["iso3"]),
                "year": r["year"],
                "flow": r["flow"],
                "hs_code": r["hs_code"],
                "basis": r["basis"],
                "net_weight_kg": r["net_weight_kg"],
                "value_usd": r["value_usd"],
                "partner_count": r["partner_count"],
                "source_id": source(r["source"]),
                "notes": r["notes"],
            }
            for r in rows_of(trade["trade"])
        ],
    )
    run(
        "partners",
        [
            {
                "country_id": country(r["iso3"]),
                "year": r["year"],
                "flow": r["flow"],
                "basis": r["basis"],
                "rank": r["rank"],
                "partner_name": r["partner_name"],
                "partner_iso3": r["partner_iso3"],
                "value_usd": r["value_usd"],
                "net_weight_kg": r["net_weight_kg"],
                "source_id": source(r["source"]),
            }
            for r in rows_of(trade["partners"])
        ],
    )
    run(
        "totals",
        [
            {
                "country_id": country(r["iso3"]),
                "year": r["year"],
                "value_usd": r["value_usd"],
                "source_id": source(r["source"]),
            }
            for r in rows_of(trade["total_exports"])
        ],
    )
    summaries = {r["iso3"]: r["summary"] for r in rows_of(seeds["profiles"]["profiles"])}
    run(
        "profiles",
        [
            {
                "country_id": country(p["iso3"]),
                "presence_tier": p["presence_tier"],
                "presence_basis": p["presence_basis"],
                "presence_confidence": p["presence_confidence"],
                "presence_as_of_year": p["presence_as_of_year"],
                "presence_source_id": source(p["presence_source"]),
                "commercial_mining": p["commercial_mining"],
                "asm_present": p["asm_present"],
                "asm_share_pct_estimate": p["asm_share_pct_estimate"],
                "asm_source_id": source(p["asm_source"]),
                "summary": summaries[p["iso3"]],
                "needs_review": p["needs_review"],
                "review_notes": p["review_notes"],
            }
            for p in rows_of(seeds["presence"]["presence"])
        ],
    )
    run(
        "notes",
        [
            {
                "country_id": country(r["iso3"]),
                "sort_order": r["sort_order"],
                "note": r["note"],
                "source_id": source(r["source"]),
                "as_of": r["as_of"],
                "needs_review": r["needs_review"],
                "review_notes": r["review_notes"],
            }
            for r in rows_of(seeds["profiles"]["notes"])
        ],
    )
    mines = seeds["mines"]
    enabled = bool(mines["layer_enabled"])
    run(
        "mines",
        [
            {
                "wikidata_qid": r["wikidata_qid"],
                "name": r["name"],
                "country_id": country(r["iso3"]),
                "latitude": r["latitude"],
                "longitude": r["longitude"],
                "status": r["status"],
                "operator": r["operator"],
                "source_id": source("wikidata-gold-mines"),
                "needs_review": False,
                "review_notes": None,
            }
            for r in rows_of(mines["mines"])
        ]
        if enabled
        else [],
    )
