"""`python -m pipelines mountains`: build the Harim catalogue.

Steps (each cached under data/raw/, so re-runs are reproducible and offline):
  mountains-baseline   the Harim prototype at a pinned commit (harim_baseline)
  mountains-wikidata   peaks per country, P610/P1589 country extremes, curated items
  factbook             the World Factbook's final edition, for country extremes
  mountains-geonames   GeoNames dumps, to cross-check elevations
  mountains-reconcile  selection, elevations, hierarchy, ranges, low points, names (harim_reconcile)
Outputs: db/seeds/mountains.json, db/seeds/mountain_ranges.json, db/seeds/country_low_points.json
and data/mountains_review_report.md. Validation failures stop the run with a list of problems.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import zipfile
from pathlib import Path
from typing import Any

from . import harim_baseline, harim_report, harim_sources, harim_wikidata, wikidata
from .harim_geo import Countries
from .harim_reconcile import Inputs, ReconcileError, Result, reconcile
from .settings import DATA_DIR, ROOT, SEEDS_DIR

CURATION_FILE = Path(__file__).parent / "reference" / "harim_curation.json"
NAMES_FILE = SEEDS_DIR / "mountain_names.json"
MOUNTAINS_SEED = SEEDS_DIR / "mountains.json"
RANGES_SEED = SEEDS_DIR / "mountain_ranges.json"
LOW_POINTS_SEED = SEEDS_DIR / "country_low_points.json"
REPORT_PATH = DATA_DIR / "mountains_review_report.md"
PROTOTYPE_SOURCE = "harim-prototype"


def curated_urls(curation: dict[str, Any], names: dict[str, Any]) -> set[str]:
    urls: set[str] = set()
    for section in ("massifs", "elevations", "ranges", "merges"):
        urls |= {entry["source"] for entry in curation[section] if entry.get("source")}
    for section in ("high_points", "low_points"):
        urls |= {entry["source"] for entry in curation[section].values() if entry.get("source")}
    urls |= {entry["source"] for entry in names["entries"] if entry.get("source")}
    return urls


def curated_qids(curation: dict[str, Any], names: dict[str, Any]) -> set[str]:
    qids: set[str] = set(curation["baseline_matches"].values())
    qids |= set(curation["include"])
    for massif in curation["massifs"]:
        qids |= {massif["qid"], *massif["summits"]}
    for merge in curation["merges"]:
        qids |= {merge["qid"], merge["into"]}
    for territory in curation["territories"]:
        qids |= set(territory["peaks"])
    qids |= {entry["qid"] for entry in curation["high_points"].values()}
    qids |= {entry["qid"] for entry in curation["low_points"].values() if entry.get("qid")}
    qids |= {entry["qid"] for entry in curation["elevations"]}
    qids |= {entry["qid"] for entry in names["entries"]}
    return qids


def snapshot_date(paths: set[Path]) -> str:
    """The date of the oldest cached response used: when the snapshot was taken."""
    stamps = [p.stat().st_mtime for p in paths if p.exists()]
    if not stamps:
        return dt.date.today().isoformat()
    return dt.datetime.fromtimestamp(min(stamps), tz=dt.UTC).date().isoformat()


def geonames_dump_date(iso2s: list[str]) -> str | None:
    """The newest modification date of the country files inside the cached GeoNames zips."""
    dates: list[dt.date] = []
    for iso2 in iso2s:
        path = harim_sources.GEONAMES_CACHE / f"{iso2.upper()}.zip"
        if path.exists():
            with zipfile.ZipFile(path) as archive:
                info = archive.getinfo(f"{iso2.upper()}.txt")
                dates.append(dt.date(*info.date_time[:3]))
    return max(dates).isoformat() if dates else None


def gather(
    args: argparse.Namespace,
) -> tuple[Inputs, dict[str, Any], dict[str, Any], dict[str, str]]:
    curation: dict[str, Any] = json.loads(CURATION_FILE.read_text(encoding="utf-8"))
    names: dict[str, Any] = json.loads(NAMES_FILE.read_text(encoding="utf-8"))
    seed = json.loads((SEEDS_DIR / "countries.json").read_text(encoding="utf-8"))
    countries = seed["countries"]
    iso3s = [c["iso3"] for c in countries]
    country_names = {c["iso3"]: c["name"] for c in countries}
    refresh = bool(args.refresh)
    limit = int(curation["selection"]["candidate_limit"])

    print("Wikidata: checking class IDs, countries, extremes and peaks…")
    harim_wikidata.verify_classes(refresh=refresh)
    country_qids = harim_wikidata.fetch_country_qids(iso3s, refresh=refresh)
    extremes = harim_wikidata.fetch_extremes(iso3s, refresh=refresh)
    candidates = {
        iso3: harim_wikidata.fetch_country_peaks(country_qids[iso3], limit=limit, refresh=refresh)
        for iso3 in iso3s
    }
    items = {peak.qid: peak for peaks in candidates.values() for peak in peaks}
    wanted = curated_qids(curation, names) | {e.point_qid for e in extremes if e.kind == "high"}
    items.update(harim_wikidata.fetch_items(sorted(wanted - set(items)), refresh=refresh))
    volcano_ids = harim_wikidata.fetch_volcano_ids(sorted(items), refresh=refresh)
    wikidata_as_of = snapshot_date(wikidata.USED_CACHE_FILES)

    print("World Factbook (final edition)…")
    factbook = harim_sources.fetch_factbook(curation["factbook"]["ref"], iso3s, refresh=refresh)

    print("Harim prototype…")
    snapshot = harim_baseline.fetch_snapshot(curation["baseline"]["ref"], refresh=refresh)
    name_index = {harim_baseline.fold(c["name"]): c["iso3"] for c in countries}
    baseline = harim_baseline.parse_snapshot(snapshot, name_index)

    print("GeoNames…")
    geonames = {
        c["iso3"]: harim_sources.fetch_geonames(c["iso2"], refresh=refresh) for c in countries
    }

    print("Cited sources (for quote checks)…")
    texts = {
        url: harim_sources.fetch_wikipedia_text(url, refresh=refresh)
        for url in sorted(curated_urls(curation, names))
    }

    inputs = Inputs(
        country_names=country_names,
        country_qids=country_qids,
        candidates=candidates,
        items=items,
        volcano_ids=volcano_ids,
        extremes=extremes,
        factbook=factbook,
        baseline=baseline,
        baseline_source=PROTOTYPE_SOURCE,
        baseline_commit=snapshot.commit,
        geonames=geonames,
        geography=Countries.load(),
        source_texts=texts,
        island_states=set(curation["island_states"]),
    )
    dates = {
        "baseline_commit": snapshot.commit,
        "baseline_as_of": snapshot.committed_at,
        "wikidata_as_of": wikidata_as_of,
        "geonames_as_of": geonames_dump_date([c["iso2"] for c in countries]) or wikidata_as_of,
        "factbook_commit": factbook.commit,
        "factbook_as_of": factbook.committed_at,
    }
    return inputs, curation, names, dates


def datasets(dates: dict[str, str]) -> list[dict[str, Any]]:
    return [
        {
            "key": "mountains-baseline",
            "name": f"Harim prototype (emtatudatatech/harim@{dates['baseline_commit'][:7]})",
            "provider": "emtatudatatech/harim (the project's prototype)",
            "license": "The project owner's prototype, used with permission (no licence file)",
            "attribution": "Harim prototype by emtatudatatech (github.com/emtatudatatech/harim).",
            "coverage_start": None,
            "coverage_end": None,
            "as_of": dates["baseline_as_of"],
            "refresh_cadence": "manual",
        },
        {
            "key": "mountains-wikidata",
            "name": "Wikidata: mountains and country high and low points",
            "provider": "Wikidata (Wikimedia Foundation)",
            "license": "CC0 1.0",
            "attribution": "Mountain data from Wikidata (CC0).",
            "coverage_start": None,
            "coverage_end": None,
            "as_of": dates["wikidata_as_of"],
            "refresh_cadence": "monthly",
        },
        {
            "key": "mountains-geonames",
            "name": "GeoNames gazetteer (mountains, peaks and hills)",
            "provider": "GeoNames",
            "license": "CC BY 4.0",
            "attribution": "GeoNames (geonames.org), licensed under CC BY 4.0.",
            "coverage_start": None,
            "coverage_end": None,
            "as_of": dates["geonames_as_of"],
            "refresh_cadence": "monthly",
        },
    ]


def seed_payloads(result: Result, dates: dict[str, str]) -> dict[Path, Any]:
    by_key = {m.key: m for m in result.mountains}
    range_slugs = {r.slug for r in result.ranges}
    mountains = []
    for m in result.mountains:
        parent = by_key[m.parent].slug if m.parent else None
        pairs = sorted(
            {
                (round(e.metres), e.source)
                for e in m.elevations
                if e.source != m.elevation_source or round(e.metres) != m.elevation_m
            },
            key=lambda pair: (-pair[0], pair[1]),
        )
        alternatives = [{"m": metres, "source": source} for metres, source in pairs]
        mountains.append(
            {
                "slug": m.slug,
                "name": m.name,
                "alt_names": sorted(dict.fromkeys(m.alt_names)),
                "wikidata_qid": m.key,
                "geonames_id": m.geonames_id,
                "range": m.range_slug if m.range_slug in range_slugs else None,
                "elevation_m": m.elevation_m,
                "elevation_source": m.elevation_source,
                "elevation_confidence": m.confidence,
                "elevation_alternatives": alternatives,
                "latitude": round(m.lat, 6),
                "longitude": round(m.lon, 6),
                "peak_type": m.peak_type,
                "volcanic_status": m.volcanic_status,
                "prominence_m": round(m.prominence_m) if m.prominence_m is not None else None,
                "isolation_km": round(m.isolation_km, 2) if m.isolation_km is not None else None,
                "summit_kind": m.summit_kind,
                "parent": parent,
                "countries": [
                    {
                        "iso3": iso3,
                        "is_country_high_point": iso3 in m.high_point_of,
                        "is_shared": len(m.countries) > 1,
                    }
                    for iso3 in sorted(m.countries)
                ]
                if not m.territory
                else [],
                "territory_name": m.territory,
                "local_names": m.local_names,
                "name_origin": m.name_origin,
                "name_origin_source": m.name_origin_source,
                "notes": " ".join(m.notes) or None,
                "needs_review": bool(m.review),
                "review_notes": "\n".join(m.review) or None,
                "sources": [{"source": s, "field": f} for s, f in sorted(m.sources)],
            }
        )
    generated = {"by": "python -m pipelines mountains", **dates}
    return {
        MOUNTAINS_SEED: {
            "$generated": generated,
            "datasets": datasets(dates),
            "sources": [
                {
                    "source_key": r.key,
                    "title": r.title,
                    "url": r.url,
                    "source_type": r.source_type,
                    "reliability_tier": r.tier,
                }
                for r in sorted(result.sources.records.values(), key=lambda r: r.key)
            ],
            "mountains": mountains,
        },
        RANGES_SEED: {
            "$generated": generated,
            "ranges": [
                {
                    "slug": r.slug,
                    "name": r.name,
                    "wikidata_qid": r.qid,
                    "range_type": r.range_type,
                    "description": r.description,
                    "length_km": r.length_km,
                    "formation_note": r.formation_note,
                    "source": r.source,
                    "needs_review": bool(r.review),
                    "review_notes": "\n".join(r.review) or None,
                }
                for r in sorted(result.ranges, key=lambda r: r.slug)
            ],
        },
        LOW_POINTS_SEED: {
            "$generated": generated,
            "low_points": [
                {
                    "iso3": p.iso3,
                    "name": p.name,
                    "elevation_m": p.elevation_m,
                    "latitude": round(p.lat, 6) if p.lat is not None else None,
                    "longitude": round(p.lon, 6) if p.lon is not None else None,
                    "feature_type": p.feature_type,
                    "source": p.source,
                    "wikidata_qid": p.qid,
                    "needs_review": bool(p.review),
                    "review_notes": "\n".join(p.review) or None,
                }
                for p in sorted(result.low_points.values(), key=lambda p: p.iso3)
            ],
        },
    }


def write_seeds(payloads: dict[Path, Any]) -> None:
    for path, payload in payloads.items():
        body = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
        path.write_text(body, encoding="utf-8")
        digest = hashlib.sha256(body.encode()).hexdigest()[:12]
        print(f"Wrote {path.relative_to(ROOT)} ({digest})")


def configure(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--refresh", action="store_true", help="re-fetch every source instead of using the cache"
    )


def run(args: argparse.Namespace) -> int:
    inputs, curation, names, dates = gather(args)
    try:
        result = reconcile(inputs, curation, names)
    except ReconcileError as error:
        print(f"Validation failed ({len(error.problems)} problems):\n{error}")
        return 1
    write_seeds(seed_payloads(result, dates))
    harim_report.write(REPORT_PATH, result, inputs, curation, dates)
    counted = [m for m in result.mountains if m.summit_kind != "summit" and not m.territory]
    print(
        f"{len(counted)} mountains in the 54 countries, "
        f"{sum(1 for m in result.mountains if m.summit_kind == 'summit')} summits, "
        f"{sum(1 for m in result.mountains if m.territory)} territory peaks; "
        f"{sum(1 for m in result.mountains if m.review)} need review. "
        f"Report: {REPORT_PATH.relative_to(ROOT)}"
    )
    return 0
