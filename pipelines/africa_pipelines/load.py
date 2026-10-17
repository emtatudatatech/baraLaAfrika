"""`load`: upsert the committed seeds into the database (spec §5.4).

Loads regions (with the approved region colours), countries, country profiles, sources,
country↔source citations, flag palettes, map anchors, the Harim catalogue (ranges, mountains,
their countries and sources, country low points) and dataset rows. Idempotent: every upsert
only touches rows whose values actually changed, so a second run reports zero changes. Each run
is logged in `ingestion_runs` (one per dataset); on failure nothing is loaded and the runs are
marked failed.
"""

from __future__ import annotations

import argparse
import json
import os
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, LiteralString

import psycopg

from . import harim_load
from .migrate import applied_checksums, discover, plan
from .settings import SEEDS_DIR, require_env

APPROVAL_PATH = Path(__file__).parent / "reference" / "region_colors_approval.json"


class LoadError(RuntimeError):
    pass


@dataclass
class LoadResult:
    changes: dict[str, int] = field(default_factory=dict)  # table → rows inserted/updated/deleted
    warnings: list[str] = field(default_factory=list)

    @property
    def total(self) -> int:
        return sum(self.changes.values())

    def add(self, table: str, count: int) -> None:
        self.changes[table] = self.changes.get(table, 0) + count


def _read(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise LoadError(f"Missing seed {path}; run the pipeline that generates it first.")
    data: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    return data


def read_seeds(seeds_dir: Path, approval_path: Path = APPROVAL_PATH) -> dict[str, Any]:
    countries = _read(seeds_dir / "countries.json")
    sources = _read(seeds_dir / "sources.json")
    datasets = _read(seeds_dir / "datasets.json")
    flags = _read(seeds_dir / "flags.json") if (seeds_dir / "flags.json").exists() else None
    boundaries = (
        _read(seeds_dir / "boundaries.json") if (seeds_dir / "boundaries.json").exists() else None
    )
    approval = (
        json.loads(approval_path.read_text(encoding="utf-8")) if approval_path.exists() else None
    )
    harim = harim_load.read(seeds_dir)
    if harim is not None:
        harim_load.check_shared_sources(harim, sources["sources"])
    return {
        "countries": countries,
        "sources": sources,
        "datasets": datasets["datasets"]
        + ([flags["dataset"]] if flags else [])
        + ([boundaries["dataset"]] if boundaries else [])
        + (harim["datasets"] if harim else []),
        "harim": harim,
        "flags": flags,
        "boundaries": boundaries,
        "approval": approval,
    }


def _execute_counting(
    cur: psycopg.Cursor[Any], query: LiteralString, params: tuple[Any, ...]
) -> int:
    """Execute a parameterised statement and return the rows it inserted/updated/deleted."""
    cur.execute(query, params)
    return max(cur.rowcount, 0)


def _upsert_datasets(cur: psycopg.Cursor[Any], datasets: list[dict[str, Any]]) -> int:
    changed = 0
    for d in datasets:
        changed += _execute_counting(
            cur,
            """
            INSERT INTO datasets (key, name, provider, license, attribution, coverage_start,
                                  coverage_end, as_of, refresh_cadence)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::refresh_cadence)
            ON CONFLICT (key) DO UPDATE SET
              name = EXCLUDED.name, provider = EXCLUDED.provider, license = EXCLUDED.license,
              attribution = EXCLUDED.attribution, coverage_start = EXCLUDED.coverage_start,
              coverage_end = EXCLUDED.coverage_end, as_of = EXCLUDED.as_of,
              refresh_cadence = EXCLUDED.refresh_cadence
            WHERE (datasets.name, datasets.provider, datasets.license, datasets.attribution,
                   datasets.coverage_start, datasets.coverage_end, datasets.as_of,
                   datasets.refresh_cadence)
              IS DISTINCT FROM
                  (EXCLUDED.name, EXCLUDED.provider, EXCLUDED.license, EXCLUDED.attribution,
                   EXCLUDED.coverage_start, EXCLUDED.coverage_end, EXCLUDED.as_of,
                   EXCLUDED.refresh_cadence)
            """,
            (
                d["key"], d["name"], d["provider"], d["license"], d["attribution"],
                d["coverage_start"], d["coverage_end"], d["as_of"], d["refresh_cadence"],
            ),
        )  # fmt: skip
    return changed


def region_colours(seeds: dict[str, Any], result: LoadResult) -> dict[str, str | None]:
    """The approved colours (never unapproved ones). Missing approval → NULL colours."""
    slugs = [r["slug"] for r in seeds["countries"]["regions"]]
    approval = seeds["approval"]
    if approval is None:
        result.warnings.append("No approved region colours; regions.color_hex left NULL.")
        return dict.fromkeys(slugs)
    colours: dict[str, str] = approval["colors"]
    missing = [s for s in slugs if s not in colours]
    if missing:
        raise LoadError(f"Approved region colours are missing regions: {', '.join(missing)}")
    flags = seeds["flags"]
    if flags is not None and not flags["region_colors"]["approved"]:
        result.warnings.append(
            "The latest flags run computed colours that differ from the approved ones; the "
            "approved colours are loaded (see data/region_colors_report.md)."
        )
    return {slug: colours[slug] for slug in slugs}


def _load_reference_data(
    cur: psycopg.Cursor[Any], seeds: dict[str, Any], result: LoadResult
) -> None:
    colours = region_colours(seeds, result)
    for region in seeds["countries"]["regions"]:
        result.add("regions", _execute_counting(
            cur,
            """
            INSERT INTO regions (slug, name, description, sort_order, color_hex)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (slug) DO UPDATE SET
              name = EXCLUDED.name, description = EXCLUDED.description,
              sort_order = EXCLUDED.sort_order, color_hex = EXCLUDED.color_hex
            WHERE (regions.name, regions.description, regions.sort_order, regions.color_hex)
              IS DISTINCT FROM
                  (EXCLUDED.name, EXCLUDED.description, EXCLUDED.sort_order, EXCLUDED.color_hex)
            """,
            (region["slug"], region["name"], region["description"], region["sort_order"],
             colours[region["slug"]]),
        ))  # fmt: skip

    for source in seeds["sources"]["sources"]:
        result.add("sources", _execute_counting(
            cur,
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
            (source["source_key"], source["ref_no"], source["title"], source["url"],
             source["source_type"], source["reliability_tier"]),
        ))  # fmt: skip

    for country in seeds["countries"]["countries"]:
        changed = _execute_counting(
            cur,
            """
            INSERT INTO countries (iso2, iso3, iso_numeric, name, official_name, region_id,
                                   flag_url_template, is_microstate_marker)
            SELECT %s, %s, %s, %s, %s, r.id, %s, %s FROM regions r WHERE r.slug = %s
            ON CONFLICT (iso3) DO UPDATE SET
              iso2 = EXCLUDED.iso2, iso_numeric = EXCLUDED.iso_numeric, name = EXCLUDED.name,
              official_name = EXCLUDED.official_name, region_id = EXCLUDED.region_id,
              flag_url_template = EXCLUDED.flag_url_template
            WHERE (countries.iso2, countries.iso_numeric, countries.name, countries.official_name,
                   countries.region_id, countries.flag_url_template)
              IS DISTINCT FROM
                  (EXCLUDED.iso2, EXCLUDED.iso_numeric, EXCLUDED.name, EXCLUDED.official_name,
                   EXCLUDED.region_id, EXCLUDED.flag_url_template)
            """,
            (country["iso2"], country["iso3"], country["iso_numeric"], country["name"],
             country["official_name"], country["flag_url_template"],
             country["is_microstate_marker"], country["region"]),
        )  # fmt: skip
        cur.execute("SELECT id FROM countries WHERE iso3 = %s", (country["iso3"],))
        row = cur.fetchone()
        if row is None:
            raise LoadError(f"{country['iso3']}: unknown region {country['region']!r}")
        result.add("countries", changed)
        country_id = row[0]

        p = country["profile"]
        result.add("country_profiles", _execute_counting(
            cur,
            """
            INSERT INTO country_profiles (country_id, etymology_summary, etymology_detail,
              etymology_category, flag_design_summary, flag_design_detail,
              national_symbol_summary, national_symbol_detail, national_animal_name,
              national_animal_scientific, national_animal_detail, animal_status, needs_review,
              review_notes)
            VALUES (%s, %s, %s, %s::etymology_category, %s, %s, %s, %s, %s, %s, %s,
                    %s::animal_status, %s, %s)
            ON CONFLICT (country_id) DO UPDATE SET
              etymology_summary = EXCLUDED.etymology_summary,
              etymology_detail = EXCLUDED.etymology_detail,
              etymology_category = EXCLUDED.etymology_category,
              flag_design_summary = EXCLUDED.flag_design_summary,
              flag_design_detail = EXCLUDED.flag_design_detail,
              national_symbol_summary = EXCLUDED.national_symbol_summary,
              national_symbol_detail = EXCLUDED.national_symbol_detail,
              national_animal_name = EXCLUDED.national_animal_name,
              national_animal_scientific = EXCLUDED.national_animal_scientific,
              national_animal_detail = EXCLUDED.national_animal_detail,
              animal_status = EXCLUDED.animal_status,
              needs_review = EXCLUDED.needs_review,
              review_notes = EXCLUDED.review_notes
            WHERE (country_profiles.etymology_summary, country_profiles.etymology_detail,
                   country_profiles.etymology_category, country_profiles.flag_design_summary,
                   country_profiles.flag_design_detail, country_profiles.national_symbol_summary,
                   country_profiles.national_symbol_detail, country_profiles.national_animal_name,
                   country_profiles.national_animal_scientific,
                   country_profiles.national_animal_detail, country_profiles.animal_status,
                   country_profiles.needs_review, country_profiles.review_notes)
              IS DISTINCT FROM
                  (EXCLUDED.etymology_summary, EXCLUDED.etymology_detail,
                   EXCLUDED.etymology_category, EXCLUDED.flag_design_summary,
                   EXCLUDED.flag_design_detail, EXCLUDED.national_symbol_summary,
                   EXCLUDED.national_symbol_detail, EXCLUDED.national_animal_name,
                   EXCLUDED.national_animal_scientific, EXCLUDED.national_animal_detail,
                   EXCLUDED.animal_status, EXCLUDED.needs_review, EXCLUDED.review_notes)
            """,
            (country_id, p["etymology_summary"], p["etymology_detail"], p["etymology_category"],
             p["flag_design_summary"], p["flag_design_detail"], p["national_symbol_summary"],
             p["national_symbol_detail"], p["national_animal_name"],
             p["national_animal_scientific"], p["national_animal_detail"], p["animal_status"],
             p["needs_review"], p["review_notes"]),
        ))  # fmt: skip

        # Citations: make the set match the seed exactly.
        wanted = {(s["source_key"], s["field"]) for s in country["sources"]}
        cur.execute(
            "SELECT s.source_key, cs.field::text FROM country_sources cs "
            "JOIN sources s ON s.id = cs.source_id WHERE cs.country_id = %s",
            (country_id,),
        )
        existing = {(str(k), str(f)) for k, f in cur.fetchall()}
        for key, field_name in sorted(existing - wanted):
            result.add("country_sources", _execute_counting(
                cur,
                "DELETE FROM country_sources cs USING sources s WHERE cs.source_id = s.id "
                "AND cs.country_id = %s AND s.source_key = %s AND cs.field = %s::profile_field",
                (country_id, key, field_name),
            ))  # fmt: skip
        for key, field_name in sorted(wanted - existing):
            inserted = _execute_counting(
                cur,
                "INSERT INTO country_sources (country_id, source_id, field) "
                "SELECT %s, s.id, %s::profile_field FROM sources s WHERE s.source_key = %s",
                (country_id, field_name, key),
            )
            if inserted == 0:
                raise LoadError(f"{country['iso3']}: cites unknown source {key!r}")
            result.add("country_sources", inserted)


def _load_flag_palettes(
    cur: psycopg.Cursor[Any], flags: dict[str, Any], result: LoadResult
) -> None:
    for flag in flags["flags"]:
        cur.execute("SELECT id FROM countries WHERE iso3 = %s", (flag["iso3"],))
        row = cur.fetchone()
        if row is None:
            raise LoadError(f"Flag palette for unknown country {flag['iso3']!r}")
        country_id = row[0]
        wanted = {(e["hex"], f"{e['area_share']:.5f}") for e in flag["palette"]}
        cur.execute(
            "SELECT hex, area_share::text FROM flag_palette WHERE country_id = %s", (country_id,)
        )
        existing = {(str(h), f"{float(s):.5f}") for h, s in cur.fetchall()}
        if wanted == existing:
            continue
        cur.execute("DELETE FROM flag_palette WHERE country_id = %s", (country_id,))
        for hex_value, share in sorted(wanted):
            cur.execute(
                "INSERT INTO flag_palette (country_id, hex, area_share) VALUES (%s, %s, %s)",
                (country_id, hex_value, share),
            )
        result.add("flag_palette", len(wanted ^ existing))


def _load_boundaries(
    cur: psycopg.Cursor[Any], boundaries: dict[str, Any], result: LoadResult
) -> None:
    """Map anchors and microstate markers computed by the boundaries pipeline."""
    for country in boundaries["countries"]:
        changed = _execute_counting(
            cur,
            """
            UPDATE countries SET centroid_lon = %s, centroid_lat = %s, is_microstate_marker = %s
            WHERE iso3 = %s
              AND (centroid_lon, centroid_lat, is_microstate_marker)
                  IS DISTINCT FROM (%s::double precision, %s::double precision, %s::boolean)
            """,
            (
                country["centroid_lon"], country["centroid_lat"], country["is_microstate_marker"],
                country["iso3"],
                country["centroid_lon"], country["centroid_lat"], country["is_microstate_marker"],
            ),
        )  # fmt: skip
        cur.execute("SELECT 1 FROM countries WHERE iso3 = %s", (country["iso3"],))
        if cur.fetchone() is None:
            raise LoadError(f"Boundaries for unknown country {country['iso3']!r}")
        result.add("country_boundaries", changed)


def check_migrations(conn: psycopg.Connection[Any]) -> None:
    pending = plan(discover(), applied_checksums(conn))
    if pending:
        raise LoadError(
            "Pending migrations: "
            + ", ".join(m.filename for m in pending)
            + ". Run `python -m pipelines migrate` first."
        )


@contextmanager
def ingestion_runs(conn: psycopg.Connection[Any], keys: list[str]) -> Iterator[dict[str, int]]:
    """Open one ingestion run per dataset (committed), and close them as succeeded or failed."""
    run_ids: dict[str, int] = {}
    with conn.cursor() as cur:
        for key in keys:
            cur.execute(
                "INSERT INTO ingestion_runs (dataset_id) SELECT id FROM datasets WHERE key = %s "
                "RETURNING id",
                (key,),
            )
            row = cur.fetchone()
            assert row is not None
            run_ids[key] = row[0]
    conn.commit()
    try:
        yield run_ids
    except Exception as error:
        conn.rollback()
        with conn.cursor() as cur:
            for run_id in run_ids.values():
                cur.execute(
                    "UPDATE ingestion_runs SET status = 'failed', finished_at = now(), log = %s "
                    "WHERE id = %s",
                    (f"{type(error).__name__}: {error}"[:4000], run_id),
                )
        conn.commit()
        raise


def load(conn: psycopg.Connection[Any], seeds_dir: Path = SEEDS_DIR) -> LoadResult:
    seeds = read_seeds(seeds_dir)
    check_migrations(conn)
    result = LoadResult()
    with conn.cursor() as cur:
        result.add("datasets", _upsert_datasets(cur, seeds["datasets"]))
    conn.commit()

    keys = [d["key"] for d in seeds["datasets"]]
    with ingestion_runs(conn, keys) as run_ids:
        with conn.cursor() as cur:
            _load_reference_data(cur, seeds, result)
            if seeds["flags"] is not None:
                _load_flag_palettes(cur, seeds["flags"], result)
            if seeds["boundaries"] is not None:
                _load_boundaries(cur, seeds["boundaries"], result)
            if seeds["harim"] is not None:
                harim_load.load(cur, seeds["harim"], result.add)
            harim_changes = sum(
                result.changes.get(t, 0)
                for t in ("mountain_ranges", "mountains", "mountain_countries",
                          "mountain_sources", "country_low_points")
            )  # fmt: skip
            per_dataset = {
                "symbology-pdf": sum(
                    result.changes.get(t, 0)
                    for t in (
                        "regions",
                        "sources",
                        "countries",
                        "country_profiles",
                        "country_sources",
                    )
                ),
                "flags-flagpedia": result.changes.get("flag_palette", 0),
                "boundaries-natural-earth": result.changes.get("country_boundaries", 0),
                "mountains-baseline": harim_changes,
                "mountains-wikidata": harim_changes,
                "mountains-geonames": harim_changes,
            }
            for key, run_id in run_ids.items():
                cur.execute(
                    "UPDATE ingestion_runs SET status = 'succeeded', finished_at = now(), "
                    "rows_upserted = %s, log = %s WHERE id = %s",
                    (per_dataset.get(key, 0), json.dumps(result.changes, sort_keys=True), run_id),
                )
                cur.execute("UPDATE datasets SET last_refreshed_at = now() WHERE key = %s", (key,))
        conn.commit()
    return result


def configure(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--seeds-dir", type=Path, default=SEEDS_DIR)


def run(args: argparse.Namespace) -> int:
    url = require_env("DATABASE_URL_WRITE", purpose="load seeds with the write role")
    with psycopg.connect(url) as conn:
        result = load(conn, args.seeds_dir)
    for warning in result.warnings:
        print(f"Warning: {warning}")
    summary = ", ".join(f"{table} {n}" for table, n in sorted(result.changes.items()) if n)
    print(f"Loaded seeds: {result.total} rows changed" + (f" ({summary})." if summary else "."))
    github_output = os.environ.get("GITHUB_OUTPUT")
    if github_output:
        with Path(github_output).open("a", encoding="utf-8") as handle:
            handle.write(f"changed={'true' if result.total else 'false'}\n")
    return 0
