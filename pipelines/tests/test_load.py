from __future__ import annotations

import json
import shutil
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import LiteralString

import psycopg
import pytest

from pipelines.africa_pipelines import (
    gold_load,
    indicators_load,
    load,
    migrate,
    politics_load,
    status,
)
from pipelines.africa_pipelines.settings import SEEDS_DIR

APPROVED = json.loads(load.APPROVAL_PATH.read_text(encoding="utf-8"))["colors"]


def migrated(url: str) -> psycopg.Connection[tuple[object, ...]]:
    conn = psycopg.connect(url)
    migrate.apply(conn, migrate.plan(migrate.discover(), migrate.applied_checksums(conn)))
    return conn


def scalar(conn: psycopg.Connection[tuple[object, ...]], query: LiteralString) -> object:
    row = conn.execute(query).fetchone()
    assert row is not None
    return row[0]


def test_first_load_populates_everything_with_approved_colours(pglite_url: str) -> None:
    with migrated(pglite_url) as conn:
        result = load.load(conn)
        assert result.changes["countries"] == 54
        assert result.changes["country_profiles"] == 54
        assert result.changes["country_boundaries"] == 54
        markers = scalar(conn, "SELECT count(*) FROM countries WHERE is_microstate_marker")
        assert markers == 7
        assert scalar(conn, "SELECT count(*) FROM countries WHERE centroid_lon IS NULL") == 0
        symbology_sources = json.loads((SEEDS_DIR / "sources.json").read_text())["sources"]
        harim = json.loads((SEEDS_DIR / "mountains.json").read_text())
        gold = gold_load.read(SEEDS_DIR)
        assert gold is not None
        indicators = indicators_load.read(SEEDS_DIR)
        assert indicators is not None
        politics = politics_load.read(SEEDS_DIR)
        assert politics is not None
        expected_sources = (
            {s["source_key"] for s in symbology_sources}
            | {s["source_key"] for s in harim["sources"]}
            | {s["source_key"] for s in gold["sources"]}
            | {s["source_key"] for s in indicators["sources"]}
            | (
                {s["source_key"] for s in politics["sources"]}
                if politics["seed"]["approved_on"]
                else set()
            )
        )
        assert scalar(conn, "SELECT count(*) FROM sources") == len(expected_sources)
        palette_rows = scalar(conn, "SELECT count(*) FROM flag_palette")
        assert isinstance(palette_rows, int) and palette_rows > 54
        colours = {
            str(slug): str(hex_value)
            for slug, hex_value in conn.execute("SELECT slug, color_hex FROM regions").fetchall()
        }
        assert colours == APPROVED
        assert scalar(conn, "SELECT count(*) FROM country_sources") == sum(
            len(c["sources"])
            for c in json.loads((SEEDS_DIR / "countries.json").read_text())["countries"]
        )
        runs = conn.execute(
            "SELECT d.key, r.status::text FROM ingestion_runs r "
            "JOIN datasets d ON d.id = r.dataset_id"
        ).fetchall()
        gold_runs = [(d["key"], "succeeded") for d in gold["datasets"]]
        indicator_runs = [(d["key"], "succeeded") for d in indicators["datasets"]]
        politics_runs = [(d["key"], "succeeded") for d in politics["datasets"]]
        assert sorted(runs) == sorted(
            [
                ("boundaries-natural-earth", "succeeded"),
                ("flags-flagpedia", "succeeded"),
                ("mountains-baseline", "succeeded"),
                ("mountains-geonames", "succeeded"),
                ("mountains-wikidata", "succeeded"),
                ("symbology-pdf", "succeeded"),
                *gold_runs,
                *indicator_runs,
                *politics_runs,
            ]
        )
        assert scalar(conn, "SELECT count(*) FROM datasets WHERE last_refreshed_at IS NULL") == 0


def test_harim_catalogue_loads_with_its_rules_intact(pglite_url: str) -> None:
    harim = json.loads((SEEDS_DIR / "mountains.json").read_text())["mountains"]
    with migrated(pglite_url) as conn:
        result = load.load(conn)
        assert result.changes["mountains"] == len(harim)
        assert scalar(conn, "SELECT count(*) FROM mountains") == len(harim)
        assert scalar(conn, "SELECT count(*) FROM country_low_points") == 54
        # Exactly one high point per country, never a summit.
        assert (
            scalar(
                conn,
                "SELECT count(DISTINCT country_id) FROM mountain_countries "
                "WHERE is_country_high_point",
            )
            == 54
        )
        assert (
            scalar(
                conn,
                "SELECT count(*) FROM mountain_countries mc JOIN mountains m "
                "ON m.id = mc.mountain_id WHERE mc.is_country_high_point "
                "AND m.summit_kind = 'summit'",
            )
            == 0
        )
        # Every massif equals its highest summit; every summit's parent is a massif.
        assert (
            scalar(
                conn,
                "SELECT count(*) FROM mountains m WHERE summit_kind = 'massif' AND elevation_m <> "
                "(SELECT max(s.elevation_m) FROM mountains s WHERE s.parent_id = m.id)",
            )
            == 0
        )
        assert (
            scalar(
                conn,
                "SELECT count(*) FROM mountains s JOIN mountains p ON p.id = s.parent_id "
                "WHERE p.summit_kind <> 'massif'",
            )
            == 0
        )
        # Territory peaks are in no country; Kilimanjaro is Tanzania's high point.
        assert (
            scalar(
                conn,
                "SELECT count(*) FROM mountain_countries mc JOIN mountains m "
                "ON m.id = mc.mountain_id WHERE m.territory_name IS NOT NULL",
            )
            == 0
        )
        assert (
            scalar(
                conn,
                "SELECT m.slug FROM mountain_countries mc "
                "JOIN mountains m ON m.id = mc.mountain_id "
                "JOIN countries c ON c.id = mc.country_id WHERE c.iso3 = 'TZA' "
                "AND mc.is_country_high_point",
            )
            == "mount-kilimanjaro"
        )


def test_second_load_changes_nothing_and_edits_change_one_row(
    pglite_url: str, tmp_path: Path
) -> None:
    seeds = tmp_path / "seeds"
    shutil.copytree(SEEDS_DIR, seeds)
    with migrated(pglite_url) as conn:
        load.load(conn, seeds)
        assert load.load(conn, seeds).total == 0

        countries_file = seeds / "countries.json"
        data = json.loads(countries_file.read_text(encoding="utf-8"))
        kenya = next(c for c in data["countries"] if c["iso3"] == "KEN")
        kenya["profile"]["needs_review"] = False
        countries_file.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

        result = load.load(conn, seeds)
        assert result.changes.get("country_profiles") == 1
        assert result.total == 1

        # A Harim edit changes one mountain row, and a moved high point keeps one per country.
        mountains_file = seeds / "mountains.json"
        harim = json.loads(mountains_file.read_text(encoding="utf-8"))
        botswana = [
            m for m in harim["mountains"] if any(c["iso3"] == "BWA" for c in m["countries"])
        ]
        old = next(m for m in botswana if m["countries"][0]["is_country_high_point"])
        new = next(m for m in botswana if m is not old)
        old["countries"][0]["is_country_high_point"] = False
        new["countries"][0]["is_country_high_point"] = True
        mountains_file.write_text(json.dumps(harim, ensure_ascii=False), encoding="utf-8")
        result = load.load(conn, seeds)
        assert result.changes.get("mountain_countries") == 2
        assert (
            scalar(
                conn,
                "SELECT m.slug FROM mountain_countries mc "
                "JOIN mountains m ON m.id = mc.mountain_id "
                "JOIN countries c ON c.id = mc.country_id WHERE c.iso3 = 'BWA' "
                "AND mc.is_country_high_point",
            )
            == new["slug"]
        )
        assert (
            scalar(
                conn,
                "SELECT p.needs_review FROM country_profiles p "
                "JOIN countries c ON c.id = p.country_id WHERE c.iso3 = 'KEN'",
            )
            is False
        )


def test_failed_load_rolls_back_and_records_the_failure(pglite_url: str, tmp_path: Path) -> None:
    seeds = tmp_path / "seeds"
    shutil.copytree(SEEDS_DIR, seeds)
    countries_file = seeds / "countries.json"
    data = json.loads(countries_file.read_text(encoding="utf-8"))
    data["countries"][-1]["sources"].append({"field": "etymology", "source_key": "no-such-source"})
    countries_file.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    with migrated(pglite_url) as conn:
        with pytest.raises(load.LoadError, match="cites unknown source 'no-such-source'"):
            load.load(conn, seeds)
        assert scalar(conn, "SELECT count(*) FROM countries") == 0  # nothing partially loaded
        failed = conn.execute("SELECT status::text, log FROM ingestion_runs").fetchall()
        assert failed and all(s == "failed" and "no-such-source" in str(log) for s, log in failed)


def test_load_refuses_to_run_with_pending_migrations(pglite_url: str) -> None:
    with psycopg.connect(pglite_url) as conn, pytest.raises(load.LoadError, match="migrate"):
        load.load(conn)


def test_unapproved_colours_are_never_loaded(tmp_path: Path) -> None:
    seeds = load.read_seeds(SEEDS_DIR, approval_path=tmp_path / "missing.json")
    result = load.LoadResult()
    assert set(load.region_colours(seeds, result).values()) == {None}
    assert "No approved region colours" in result.warnings[0]


def test_status_reports_freshness_and_overdue_datasets() -> None:
    now = datetime(2026, 10, 15, tzinfo=UTC)
    rows: list[tuple[object, ...]] = [
        ("flags-flagpedia", "2026-10-15", None, None, now - timedelta(days=40), "monthly",
         "succeeded", now, 3),
        ("symbology-pdf", "2026-10-14", None, None, now, "manual", "succeeded", now, 0),
    ]  # fmt: skip
    lines = status.format_rows(rows, now)
    assert "40 days ago" in lines[1] and "overdue" in lines[1]
    assert "today" in lines[2] and "overdue" not in lines[2]


def test_indicators_load_their_rules_and_reload_without_changes(pglite_url: str) -> None:
    seed = json.loads((SEEDS_DIR / "indicators.json").read_text())
    creditors = json.loads((SEEDS_DIR / "external_debt_creditors.json").read_text())
    with migrated(pglite_url) as conn:
        first = load.load(conn)
        assert first.changes["indicators"] == len(seed["indicators"]["rows"])
        assert first.changes["indicator_observations"] == len(seed["observations"]["rows"])
        assert first.changes["external_debt_creditors"] == len(creditors["creditors"]["rows"])
        # Estimates are IMF figures for one year only; nothing is stored for a year not ended.
        assert (
            scalar(
                conn,
                "SELECT count(DISTINCT year) FROM indicator_observations o JOIN sources s "
                "ON s.id = o.source_id WHERE o.basis = 'estimate' AND s.source_key = 'imf-weo'",
            )
            == 1
        )
        assert (
            scalar(
                conn,
                "SELECT count(*) FROM indicator_observations "
                "WHERE year >= extract(year FROM now())",
            )
            == 0
        )
        assert scalar(
            conn,
            "SELECT count(*) FROM indicator_observations o JOIN indicators i "
            "ON i.id = o.indicator_id WHERE i.key = 'population'",
        ) == sum(1 for r in seed["observations"]["rows"] if r[0] == "population")
        second = load.load(conn)
        for table in ("indicators", "indicator_observations", "external_debt_creditors"):
            assert second.changes.get(table, 0) == 0, table


def test_leaders_and_elections_load_only_once_approved(pglite_url: str, tmp_path: Path) -> None:
    seeds = tmp_path / "seeds"
    shutil.copytree(SEEDS_DIR, seeds)
    politics_seed = json.loads((seeds / "politics.json").read_text())
    with migrated(pglite_url) as conn:
        politics_seed["approved_on"] = None
        (seeds / "politics.json").write_text(json.dumps(politics_seed))
        skipped = load.load(conn, seeds)
        assert any("awaiting approval" in w for w in skipped.warnings)
        assert scalar(conn, "SELECT count(*) FROM country_leaders") == 0

        politics_seed["approved_on"] = "2026-10-22"
        (seeds / "politics.json").write_text(json.dumps(politics_seed))
        loaded = load.load(conn, seeds)
        assert loaded.changes["country_elections"] == 54
        assert scalar(conn, "SELECT count(*) FROM country_leaders WHERE is_executive") == 54
        assert (
            scalar(
                conn,
                "SELECT count(*) FROM country_elections e JOIN countries c ON c.id = e.country_id "
                "WHERE c.iso3 = 'ERI' AND e.decides = 'none' AND e.note IS NOT NULL",
            )
            == 1
        )
        again = load.load(conn, seeds)
        assert again.changes.get("country_leaders", 0) == 0
        assert again.changes.get("country_elections", 0) == 0
