"""Load the Harim seeds (db/seeds/mountains.json, mountain_ranges.json, country_low_points.json)
inside `load`'s transaction. Idempotent: rows only change when their values do, so a second run
reports zero changes; mountains, ranges, links and citations no longer in the seeds are deleted.
The massif elevation check is deferred to commit, so a whole reload is checked at once."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import psycopg

HARIM_SEEDS = ("mountains.json", "mountain_ranges.json", "country_low_points.json")


class HarimLoadError(RuntimeError):
    pass


def read(seeds_dir: Path) -> dict[str, Any] | None:
    """The three Harim seeds, or None when the mountains pipeline has not been run yet."""
    paths = [seeds_dir / name for name in HARIM_SEEDS]
    present = [p.exists() for p in paths]
    if not any(present):
        return None
    if not all(present):
        missing = ", ".join(p.name for p, ok in zip(paths, present, strict=True) if not ok)
        raise HarimLoadError(
            f"Missing Harim seeds: {missing}; run `python -m pipelines mountains`."
        )
    mountains, ranges, lows = (json.loads(p.read_text(encoding="utf-8")) for p in paths)
    return {
        "datasets": mountains["datasets"],
        "sources": mountains["sources"],
        "mountains": mountains["mountains"],
        "ranges": ranges["ranges"],
        "low_points": lows["low_points"],
    }


def _count(cur: psycopg.Cursor[Any], query: Any, params: tuple[Any, ...]) -> int:
    cur.execute(query, params)
    return max(cur.rowcount, 0)


def check_shared_sources(harim: dict[str, Any], other_sources: list[dict[str, Any]]) -> None:
    """A source key used by both seed sets must describe the same source."""
    others = {s["source_key"]: s for s in other_sources}
    for source in harim["sources"]:
        other = others.get(source["source_key"])
        if other is None:
            continue
        fields = ("title", "url", "source_type", "reliability_tier")
        if any(source[f] != other[f] for f in fields):
            raise HarimLoadError(
                f"Source key {source['source_key']!r} is used by two seeds with different details"
            )


def load(cur: psycopg.Cursor[Any], harim: dict[str, Any], add: Any) -> None:
    """Load everything; `add(table, count)` records changed rows."""
    for s in harim["sources"]:
        add("sources", _count(
            cur,
            """
            INSERT INTO sources (source_key, title, url, source_type, reliability_tier)
            VALUES (%s, %s, %s, %s, %s::reliability_tier)
            ON CONFLICT (source_key) DO UPDATE SET
              title = EXCLUDED.title, url = EXCLUDED.url, source_type = EXCLUDED.source_type,
              reliability_tier = EXCLUDED.reliability_tier
            WHERE (sources.title, sources.url, sources.source_type, sources.reliability_tier)
              IS DISTINCT FROM
                  (EXCLUDED.title, EXCLUDED.url, EXCLUDED.source_type, EXCLUDED.reliability_tier)
            """,
            (s["source_key"], s["title"], s["url"], s["source_type"], s["reliability_tier"]),
        ))  # fmt: skip

    for r in harim["ranges"]:
        add("mountain_ranges", _count(
            cur,
            """
            INSERT INTO mountain_ranges (slug, name, range_type, description, length_km,
              formation_note, source_id, wikidata_qid, needs_review, review_notes)
            VALUES (%s, %s, %s::range_type, %s, %s, %s,
                    (SELECT id FROM sources WHERE source_key = %s), %s, %s, %s)
            ON CONFLICT (slug) DO UPDATE SET
              name = EXCLUDED.name, range_type = EXCLUDED.range_type,
              description = EXCLUDED.description, length_km = EXCLUDED.length_km,
              formation_note = EXCLUDED.formation_note, source_id = EXCLUDED.source_id,
              wikidata_qid = EXCLUDED.wikidata_qid, needs_review = EXCLUDED.needs_review,
              review_notes = EXCLUDED.review_notes
            WHERE (mountain_ranges.name, mountain_ranges.range_type, mountain_ranges.description,
                   mountain_ranges.length_km, mountain_ranges.formation_note,
                   mountain_ranges.source_id, mountain_ranges.wikidata_qid,
                   mountain_ranges.needs_review, mountain_ranges.review_notes)
              IS DISTINCT FROM
                  (EXCLUDED.name, EXCLUDED.range_type, EXCLUDED.description, EXCLUDED.length_km,
                   EXCLUDED.formation_note, EXCLUDED.source_id, EXCLUDED.wikidata_qid,
                   EXCLUDED.needs_review, EXCLUDED.review_notes)
            """,
            (r["slug"], r["name"], r["range_type"], r["description"], r["length_km"],
             r["formation_note"], r["source"], r["wikidata_qid"], r["needs_review"],
             r["review_notes"]),
        ))  # fmt: skip

    mountains = harim["mountains"]
    slugs = [m["slug"] for m in mountains]
    # Remove what left the catalogue: summits first (they reference their massifs).
    add("mountains", _count(
        cur, "DELETE FROM mountains WHERE NOT (slug = ANY(%s)) AND summit_kind = 'summit'", (slugs,)
    ))  # fmt: skip
    add("mountains", _count(cur, "DELETE FROM mountains WHERE NOT (slug = ANY(%s))", (slugs,)))
    # Parents before their summits.
    for m in sorted(mountains, key=lambda m: m["summit_kind"] == "summit"):
        changed = _upsert_mountain(cur, m)
        add("mountains", changed)
    add("mountain_ranges", _count(
        cur,
        "DELETE FROM mountain_ranges WHERE NOT (slug = ANY(%s))",
        ([r["slug"] for r in harim["ranges"]],),
    ))  # fmt: skip

    _sync_links(cur, mountains, add)
    _load_low_points(cur, harim["low_points"], add)


def _upsert_mountain(cur: psycopg.Cursor[Any], m: dict[str, Any]) -> int:
    alternatives = json.dumps(m["elevation_alternatives"], ensure_ascii=False)
    local_names = json.dumps(m["local_names"], ensure_ascii=False)
    params = (
        m["slug"], m["name"], m["alt_names"], m["range"], m["elevation_m"],
        m["elevation_source"], m["elevation_confidence"], alternatives, m["latitude"],
        m["longitude"], m["peak_type"], m["volcanic_status"], m["prominence_m"],
        m["isolation_km"], m["summit_kind"], m["parent"], local_names, m["name_origin"],
        m["name_origin_source"], m["notes"], m["wikidata_qid"], m["geonames_id"],
        m["territory_name"], m["needs_review"], m["review_notes"],
    )  # fmt: skip
    changed = _count(
        cur,
        """
        INSERT INTO mountains (slug, name, alt_names, range_id, elevation_m, elevation_source_id,
          elevation_confidence, elevation_alternatives, latitude, longitude, peak_type,
          volcanic_status, prominence_m, isolation_km, summit_kind, parent_id, local_names,
          name_origin, name_origin_source_id, notes, wikidata_qid, geonames_id, territory_name,
          needs_review, review_notes)
        VALUES (%s, %s, %s,
          (SELECT id FROM mountain_ranges WHERE slug = %s), %s,
          (SELECT id FROM sources WHERE source_key = %s), %s::confidence_level, %s::jsonb,
          %s, %s, %s::peak_type, %s::volcanic_status, %s, %s, %s::summit_kind,
          (SELECT id FROM mountains WHERE slug = %s), %s::jsonb, %s,
          (SELECT id FROM sources WHERE source_key = %s), %s, %s, %s, %s, %s, %s)
        ON CONFLICT (slug) DO UPDATE SET
          name = EXCLUDED.name, alt_names = EXCLUDED.alt_names, range_id = EXCLUDED.range_id,
          elevation_m = EXCLUDED.elevation_m, elevation_source_id = EXCLUDED.elevation_source_id,
          elevation_confidence = EXCLUDED.elevation_confidence,
          elevation_alternatives = EXCLUDED.elevation_alternatives,
          latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
          peak_type = EXCLUDED.peak_type, volcanic_status = EXCLUDED.volcanic_status,
          prominence_m = EXCLUDED.prominence_m, isolation_km = EXCLUDED.isolation_km,
          summit_kind = EXCLUDED.summit_kind, parent_id = EXCLUDED.parent_id,
          local_names = EXCLUDED.local_names, name_origin = EXCLUDED.name_origin,
          name_origin_source_id = EXCLUDED.name_origin_source_id, notes = EXCLUDED.notes,
          wikidata_qid = EXCLUDED.wikidata_qid, geonames_id = EXCLUDED.geonames_id,
          territory_name = EXCLUDED.territory_name, needs_review = EXCLUDED.needs_review,
          review_notes = EXCLUDED.review_notes
        WHERE (mountains.name, mountains.alt_names, mountains.range_id, mountains.elevation_m,
               mountains.elevation_source_id, mountains.elevation_confidence,
               mountains.elevation_alternatives, mountains.latitude, mountains.longitude,
               mountains.peak_type, mountains.volcanic_status, mountains.prominence_m,
               mountains.isolation_km, mountains.summit_kind, mountains.parent_id,
               mountains.local_names, mountains.name_origin, mountains.name_origin_source_id,
               mountains.notes, mountains.wikidata_qid, mountains.geonames_id,
               mountains.territory_name, mountains.needs_review, mountains.review_notes)
          IS DISTINCT FROM
              (EXCLUDED.name, EXCLUDED.alt_names, EXCLUDED.range_id, EXCLUDED.elevation_m,
               EXCLUDED.elevation_source_id, EXCLUDED.elevation_confidence,
               EXCLUDED.elevation_alternatives, EXCLUDED.latitude, EXCLUDED.longitude,
               EXCLUDED.peak_type, EXCLUDED.volcanic_status, EXCLUDED.prominence_m,
               EXCLUDED.isolation_km, EXCLUDED.summit_kind, EXCLUDED.parent_id,
               EXCLUDED.local_names, EXCLUDED.name_origin, EXCLUDED.name_origin_source_id,
               EXCLUDED.notes, EXCLUDED.wikidata_qid, EXCLUDED.geonames_id,
               EXCLUDED.territory_name, EXCLUDED.needs_review, EXCLUDED.review_notes)
        """,
        params,
    )
    cur.execute("SELECT elevation_source_id FROM mountains WHERE slug = %s", (m["slug"],))
    row = cur.fetchone()
    if row is None or row[0] is None:
        raise HarimLoadError(f"{m['slug']}: unknown elevation source {m['elevation_source']!r}")
    return changed


def _sync_links(cur: psycopg.Cursor[Any], mountains: list[dict[str, Any]], add: Any) -> None:
    """mountain_countries and mountain_sources match the seed exactly."""
    wanted_countries = {
        (m["slug"], c["iso3"]): (c["is_country_high_point"], c["is_shared"])
        for m in mountains
        for c in m["countries"]
    }
    cur.execute(
        "SELECT m.slug, c.iso3, mc.is_country_high_point, mc.is_shared FROM mountain_countries mc "
        "JOIN mountains m ON m.id = mc.mountain_id JOIN countries c ON c.id = mc.country_id"
    )
    existing = {(slug, iso3): (bool(hp), bool(shared)) for slug, iso3, hp, shared in cur.fetchall()}
    for slug, iso3 in sorted(set(existing) - set(wanted_countries)):
        add("mountain_countries", _count(
            cur,
            "DELETE FROM mountain_countries mc USING mountains m, countries c "
            "WHERE mc.mountain_id = m.id AND mc.country_id = c.id AND m.slug = %s AND c.iso3 = %s",
            (slug, iso3),
        ))  # fmt: skip
    # Clear high points that move before setting new ones (one high point per country, always).
    for pair, (hp, _) in sorted(existing.items()):
        if hp and pair in wanted_countries and not wanted_countries[pair][0]:
            cur.execute(
                "UPDATE mountain_countries mc SET is_country_high_point = false FROM mountains m, "
                "countries c WHERE mc.mountain_id = m.id AND mc.country_id = c.id "
                "AND m.slug = %s AND c.iso3 = %s",
                pair,
            )
    for (slug, iso3), (hp, shared) in sorted(wanted_countries.items()):
        if existing.get((slug, iso3)) == (hp, shared):
            continue
        changed = _count(
            cur,
            """
            INSERT INTO mountain_countries
              (mountain_id, country_id, is_country_high_point, is_shared)
            SELECT m.id, c.id, %s, %s FROM mountains m, countries c
            WHERE m.slug = %s AND c.iso3 = %s
            ON CONFLICT (mountain_id, country_id) DO UPDATE SET
              is_country_high_point = EXCLUDED.is_country_high_point, is_shared = EXCLUDED.is_shared
            """,
            (hp, shared, slug, iso3),
        )
        if changed == 0:
            raise HarimLoadError(f"{slug}: unknown country {iso3!r}")
        add("mountain_countries", changed)

    wanted_sources = {(m["slug"], s["source"], s["field"]) for m in mountains for s in m["sources"]}
    cur.execute(
        "SELECT m.slug, s.source_key, ms.field::text FROM mountain_sources ms "
        "JOIN mountains m ON m.id = ms.mountain_id JOIN sources s ON s.id = ms.source_id"
    )
    existing_sources = {(str(a), str(b), str(c)) for a, b, c in cur.fetchall()}
    for slug, key, field_name in sorted(existing_sources - wanted_sources):
        add("mountain_sources", _count(
            cur,
            "DELETE FROM mountain_sources ms USING mountains m, sources s "
            "WHERE ms.mountain_id = m.id "
            "AND ms.source_id = s.id AND m.slug = %s AND s.source_key = %s "
            "AND ms.field = %s::mountain_field",
            (slug, key, field_name),
        ))  # fmt: skip
    for slug, key, field_name in sorted(wanted_sources - existing_sources):
        inserted = _count(
            cur,
            "INSERT INTO mountain_sources (mountain_id, source_id, field) "
            "SELECT m.id, s.id, %s::mountain_field FROM mountains m, sources s "
            "WHERE m.slug = %s AND s.source_key = %s",
            (field_name, slug, key),
        )
        if inserted == 0:
            raise HarimLoadError(f"{slug}: cites unknown source {key!r}")
        add("mountain_sources", inserted)


def _load_low_points(cur: psycopg.Cursor[Any], lows: list[dict[str, Any]], add: Any) -> None:
    for p in lows:
        changed = _count(
            cur,
            """
            INSERT INTO country_low_points (country_id, name, elevation_m, latitude, longitude,
              feature_type, source_id, wikidata_qid, needs_review, review_notes)
            SELECT c.id, %s, %s, %s, %s, %s::low_point_feature,
                   (SELECT id FROM sources WHERE source_key = %s), %s, %s, %s
            FROM countries c WHERE c.iso3 = %s
            ON CONFLICT (country_id) DO UPDATE SET
              name = EXCLUDED.name, elevation_m = EXCLUDED.elevation_m,
              latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
              feature_type = EXCLUDED.feature_type, source_id = EXCLUDED.source_id,
              wikidata_qid = EXCLUDED.wikidata_qid, needs_review = EXCLUDED.needs_review,
              review_notes = EXCLUDED.review_notes
            WHERE (country_low_points.name, country_low_points.elevation_m,
                   country_low_points.latitude, country_low_points.longitude,
                   country_low_points.feature_type, country_low_points.source_id,
                   country_low_points.wikidata_qid, country_low_points.needs_review,
                   country_low_points.review_notes)
              IS DISTINCT FROM
                  (EXCLUDED.name, EXCLUDED.elevation_m, EXCLUDED.latitude, EXCLUDED.longitude,
                   EXCLUDED.feature_type, EXCLUDED.source_id, EXCLUDED.wikidata_qid,
                   EXCLUDED.needs_review, EXCLUDED.review_notes)
            """,
            (p["name"], p["elevation_m"], p["latitude"], p["longitude"], p["feature_type"],
             p["source"], p["wikidata_qid"], p["needs_review"], p["review_notes"], p["iso3"]),
        )  # fmt: skip
        cur.execute(
            "SELECT 1 FROM country_low_points l JOIN countries c ON c.id = l.country_id "
            "WHERE c.iso3 = %s",
            (p["iso3"],),
        )
        if cur.fetchone() is None:
            raise HarimLoadError(f"Low point for unknown country {p['iso3']!r}")
        add("country_low_points", changed)
