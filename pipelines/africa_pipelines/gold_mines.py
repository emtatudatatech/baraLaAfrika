"""`python -m pipelines gold-mines`: candidate gold mines from Wikidata (CC0) for the optional map
layer, into db/seeds/gold_mines.json.

Items in the 54 countries whose "product or material produced" (P1056) is gold or gold ore,
kept when they are a mine (the classes in gold_config.json) with coordinates. The layer is
enabled only if it passes the quality bar in gold_config.json (coverage of producing countries,
known operating status, no single country dominating); otherwise nothing is loaded and the review
report says why. Every dropped item is listed with its reason.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from typing import Any

from . import harim_wikidata, wikidata
from .gold_common import (
    MINES_SEED,
    PRODUCTION_SEED,
    SourceRecord,
    config,
    countries,
    generated,
    read_seed,
    table,
    write_seed,
)
from .gold_production import preferred
from .harim import snapshot_date

WIKIDATA = SourceRecord(
    "wikidata-gold-mines",
    "Wikidata: gold mines (CC0)",
    "https://www.wikidata.org/",
    "database",
    "reference",
)


def mines_query(country_qids: list[str], gold_items: list[str]) -> str:
    return f"""
SELECT ?item ?itemLabel ?country ?coord ?class ?statusLabel ?operatorLabel ?dissolved WHERE {{
  {wikidata.values_clause("country", country_qids, literal=False)}
  {wikidata.values_clause("gold", gold_items, literal=False)}
  ?item wdt:P17 ?country; wdt:P1056 ?gold .
  OPTIONAL {{ ?item wdt:P625 ?coord }}
  OPTIONAL {{ ?item wdt:P31 ?class }}
  OPTIONAL {{ ?item wdt:P5817 ?status }}
  OPTIONAL {{ ?item wdt:P137 ?operator }}
  OPTIONAL {{ ?item wdt:P576 ?dissolved }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
}}"""


@dataclass
class Candidate:
    qid: str
    name: str
    iso3: str
    lat: float | None
    lon: float | None
    classes: set[str]
    status: str | None
    operator: str | None


def candidates(rows: list[dict[str, str]], qid_to_iso3: dict[str, str]) -> list[Candidate]:
    found: dict[str, Candidate] = {}
    for row in rows:
        qid = wikidata.qid(row["item"])
        point = harim_wikidata.parse_point(row.get("coord"))
        candidate = found.setdefault(
            qid,
            Candidate(
                qid,
                row.get("itemLabel", qid),
                qid_to_iso3[wikidata.qid(row["country"])],
                point[1] if point else None,
                point[0] if point else None,
                set(),
                None,
                None,
            ),
        )
        if row.get("class"):
            candidate.classes.add(wikidata.qid(row["class"]))
        if row.get("statusLabel"):
            candidate.status = row["statusLabel"]
        elif row.get("dissolved") and candidate.status is None:
            candidate.status = "closed"
        if row.get("operatorLabel") and candidate.operator is None:
            candidate.operator = row["operatorLabel"]
    return sorted(found.values(), key=lambda c: (c.iso3, c.name))


def screen(found: list[Candidate]) -> tuple[list[Candidate], list[list[str]]]:
    classes: dict[str, str] = config()["mines"]["mine_classes"]
    kept, dropped = [], []
    for c in found:
        if c.name == c.qid:
            dropped.append([c.qid, c.iso3, c.name, "no English label"])
        elif not c.classes & set(classes):
            dropped.append(
                [
                    c.qid,
                    c.iso3,
                    c.name,
                    f"not a mine (instance of {', '.join(sorted(c.classes)) or 'nothing'})",
                ]
            )
        elif c.lat is None or c.lon is None:
            dropped.append([c.qid, c.iso3, c.name, "no coordinates"])
        else:
            kept.append(c)
    return kept, dropped


def producing_countries() -> set[str]:
    seed = read_seed(PRODUCTION_SEED, producer="gold-production")
    best = preferred(seed["production"]["rows"], seed["priority"])
    latest: dict[str, tuple[int, float | None]] = {}
    for (iso3, year), row in best.items():
        if row[2] is not None and year >= latest.get(iso3, (0, None))[0]:
            latest[iso3] = (year, row[2])
    return {iso3 for iso3, (_, tonnes) in latest.items() if tonnes}


def evaluate(kept: list[Candidate], producers: set[str]) -> dict[str, Any]:
    bar = config()["mines"]["quality_bar"]
    covered = {c.iso3 for c in kept} & producers
    by_country: dict[str, int] = {}
    for c in kept:
        by_country[c.iso3] = by_country.get(c.iso3, 0) + 1
    coverage = 100 * len(covered) / len(producers) if producers else 0.0
    status_known = 100 * sum(1 for c in kept if c.status) / len(kept) if kept else 0.0
    top_iso3, top_count = max(by_country.items(), key=lambda kv: kv[1], default=("", 0))
    top_share = 100 * top_count / len(kept) if kept else 0.0
    checks = {
        "producer_coverage_pct": [
            round(coverage, 1),
            bar["min_producer_coverage_pct"],
            coverage >= bar["min_producer_coverage_pct"],
        ],
        "status_known_pct": [
            round(status_known, 1),
            bar["min_status_known_pct"],
            status_known >= bar["min_status_known_pct"],
        ],
        "largest_country_share_pct": [
            round(top_share, 1),
            bar["max_single_country_share_pct"],
            top_share <= bar["max_single_country_share_pct"],
        ],
    }
    return {
        "layer_enabled": all(passed for _, _, passed in checks.values()),
        "checks": checks,
        "producers": len(producers),
        "producers_covered": sorted(covered),
        "producers_missing": sorted(producers - covered),
        "largest_country": top_iso3,
        "per_country": dict(sorted(by_country.items())),
    }


def payload(
    kept: list[Candidate], dropped: list[list[str]], evaluation: dict[str, Any], as_of: str
) -> dict[str, Any]:
    enabled = evaluation["layer_enabled"]
    return {
        "$generated": generated("gold-mines", wikidata_as_of=as_of),
        "layer_enabled": enabled,
        "evaluation": evaluation,
        "datasets": [
            {
                "key": "gold-mines",
                "name": "Wikidata: gold mines",
                "provider": "Wikidata (Wikimedia Foundation)",
                "license": "CC0 1.0",
                "attribution": "Gold mine locations from Wikidata (CC0).",
                "coverage_start": None,
                "coverage_end": None,
                "as_of": as_of,
                "refresh_cadence": "manual",
            }
        ]
        if enabled
        else [],
        "sources": [WIKIDATA.seed()] if enabled else [],
        "mines": table(
            ["wikidata_qid", "iso3", "name", "latitude", "longitude", "status", "operator"],
            [
                [
                    c.qid,
                    c.iso3,
                    c.name,
                    round(c.lat or 0, 6),
                    round(c.lon or 0, 6),
                    c.status,
                    c.operator,
                ]
                for c in kept
            ],
        ),
        "dropped": table(["wikidata_qid", "iso3", "name", "reason"], dropped),
    }


def configure(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--refresh", action="store_true", help="re-query instead of the cache")


def run(args: argparse.Namespace) -> int:
    refresh = bool(args.refresh)
    iso3s = [c.iso3 for c in countries()]
    country_qids = harim_wikidata.fetch_country_qids(iso3s, refresh=refresh)
    query = mines_query(sorted(country_qids.values()), config()["mines"]["gold_items"])
    rows = wikidata.sparql(query, refresh=refresh)
    found = candidates(rows, {qid: iso3 for iso3, qid in country_qids.items()})
    kept, dropped = screen(found)
    evaluation = evaluate(kept, producing_countries())
    write_seed(
        MINES_SEED, payload(kept, dropped, evaluation, snapshot_date(wikidata.USED_CACHE_FILES))
    )
    verdict = "enabled" if evaluation["layer_enabled"] else "NOT enabled (below the quality bar)"
    print(
        f"Gold mines: {len(found)} Wikidata items, {len(kept)} kept, {len(dropped)} dropped; "
        f"layer {verdict}. {json.dumps(evaluation['checks'])}"
    )
    return 0
