"""Load the approved leaders and elections (db/seeds/politics.json) inside `load`'s transaction.
Until a snapshot has been approved, nothing is written and `load` says so."""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import psycopg

from .gold_load import TableSpec, rows_of, sync, upsert_sources

SEED = "politics.json"
DATASET_TABLES = {
    "vinara-leaders": ("country_leaders",),
    "vinara-elections": ("country_elections",),
}

SPECS = {
    "leaders": TableSpec(
        "country_leaders",
        ("country_id", "position"),
        (
            "role",
            "title",
            "person_name",
            "wikipedia_article",
            "wikidata_qid",
            "is_executive",
            "is_transitional",
            "is_de_facto",
            "source_id",
            "approved_on",
        ),
        {
            "country_id": "int",
            "position": "int",
            "role": "enum:leader_role",
            "title": "text",
            "person_name": "text",
            "wikipedia_article": "text",
            "wikidata_qid": "text",
            "is_executive": "bool",
            "is_transitional": "bool",
            "is_de_facto": "bool",
            "source_id": "int",
            "approved_on": "date",
        },
    ),
    "elections": TableSpec(
        "country_elections",
        ("country_id",),
        (
            "decides",
            "kind",
            "next_date",
            "next_precision",
            "next_article",
            "last_date",
            "last_precision",
            "last_article",
            "note",
            "source_id",
            "approved_on",
        ),
        {
            "country_id": "int",
            "decides": "enum:election_decides",
            "kind": "enum:election_kind",
            "next_date": "date",
            "next_precision": "enum:date_precision",
            "next_article": "text",
            "last_date": "date",
            "last_precision": "enum:date_precision",
            "last_article": "text",
            "note": "text",
            "source_id": "int",
            "approved_on": "date",
        },
    ),
}


class PoliticsLoadError(RuntimeError):
    pass


def read(seeds_dir: Path) -> dict[str, Any] | None:
    path = seeds_dir / SEED
    if not path.exists():
        return None
    seed: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    return {"seed": seed, "datasets": seed["datasets"], "sources": seed["sources"]}


def load(
    cur: psycopg.Cursor[Any],
    data: dict[str, Any],
    add: Callable[[str, int], None],
    warn: Callable[[str], None],
) -> None:
    seed = data["seed"]
    approved_on = seed.get("approved_on")
    if not approved_on:
        warn(
            "Leaders and elections are awaiting approval (data/politics_review_report.md); "
            "they were not loaded."
        )
        return
    add("sources", upsert_sources(cur, data["sources"]))
    cur.execute("SELECT iso3, id FROM countries")
    countries = {str(k): int(v) for k, v in cur.fetchall()}
    cur.execute("SELECT source_key, id FROM sources")
    sources = {str(k): int(v) for k, v in cur.fetchall()}

    def ref(table: dict[str, int], key: str, kind: str) -> int:
        if key not in table:
            raise PoliticsLoadError(f"Politics seed references an unknown {kind} {key!r}")
        return table[key]

    notes: dict[str, str] = seed["notes"]
    add(
        "country_leaders",
        sync(
            cur,
            SPECS["leaders"],
            [
                {
                    "country_id": ref(countries, r["iso3"], "country"),
                    "position": r["position"],
                    "role": r["role"],
                    "title": r["title"],
                    "person_name": r["person"],
                    "wikipedia_article": r["article"],
                    "wikidata_qid": r["wikidata_qid"],
                    "is_executive": r["executive"],
                    "is_transitional": r["transitional"],
                    "is_de_facto": r["de_facto"],
                    "source_id": ref(sources, r["source"], "source"),
                    "approved_on": approved_on,
                }
                for r in rows_of(seed["leaders"])
            ],
        ),
    )
    add(
        "country_elections",
        sync(
            cur,
            SPECS["elections"],
            [
                {
                    "country_id": ref(countries, r["iso3"], "country"),
                    "decides": r["decides"],
                    "kind": r["kind"],
                    "next_date": r["next_date"],
                    "next_precision": r["next_precision"],
                    "next_article": r["next_article"],
                    "last_date": r["last_date"],
                    "last_precision": r["last_precision"],
                    "last_article": r["last_article"],
                    "note": notes.get(r["iso3"]),
                    "source_id": ref(sources, r["source"], "source"),
                    "approved_on": approved_on,
                }
                for r in rows_of(seed["elections"])
            ],
        ),
    )
