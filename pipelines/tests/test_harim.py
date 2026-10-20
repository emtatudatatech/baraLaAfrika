"""Harim pipeline: prototype parsing, source parsing, matching, the elevation rules, low-point
classification, geography checks, and the committed seeds' invariants."""

from __future__ import annotations

import json
from collections import defaultdict
from typing import Any

import pytest

from pipelines.africa_pipelines import harim_baseline as baseline
from pipelines.africa_pipelines import harim_sources as sources
from pipelines.africa_pipelines import harim_wikidata
from pipelines.africa_pipelines.harim_geo import Countries, haversine_km
from pipelines.africa_pipelines.harim_reconcile import (
    Elevation,
    choose_elevation,
    names_match,
    one_edit_apart,
    peak_type_of,
    slugify,
)
from pipelines.africa_pipelines.harim_wikidata import parse_peak, parse_point
from pipelines.africa_pipelines.settings import SEEDS_DIR
from pipelines.africa_pipelines.sources import Tier

NAMES = {
    "tanzania": "TZA",
    "uganda": "UGA",
    "kenya": "KEN",
    "guinea": "GIN",
    "cote d ivoire": "CIV",
}

HTML = """
const mountainsData = [
    { name: "Mount Kilimanjaro (Kibo Peak)", country: "Tanzania", height: 5895, lat: -3.0674, long: 37.3558 },
    { name: "Margherita Peak (Rwenzori Mountains)", country: "Uganda / DRC", height: 5109, lat: 0.3894, long: 29.8731 },
    { name: "Piton des Neiges", country: "Réunion (France)", height: 3069, lat: -21.0995, long: 55.4851 },
    { name: "Mount Elgon", country: "Uganda / Kenya", height: 4321, lat: 1.1333, long: 34.5500 },
];
"""  # noqa: E501

README = """
### African Mountains Featured in this Project:

* **Mount Stanley (Margherita Peak):**
    * **Height:** 5,109 meters
    * **Location:** Uganda / Democratic Republic of Congo
    * **Notes:** The highest peak in the Rwenzori Mountains.

### Geological Significance
"""


# ── Prototype ────────────────────────────────────────────────────────────────


def test_parses_the_html_array_strictly() -> None:
    entries = baseline.parse_html(HTML, NAMES)
    assert [e.base_name for e in entries] == [
        "Mount Kilimanjaro",
        "Margherita Peak",
        "Piton des Neiges",
        "Mount Elgon",
    ]
    assert entries[0].qualifier == "Kibo Peak"
    assert entries[1].countries == ["UGA", "COD"]  # "Uganda / DRC" is shared
    assert entries[2].countries == [] and entries[2].territory == "Réunion"
    with pytest.raises(baseline.BaselineError, match="cannot parse"):
        baseline.parse_html(HTML.replace("height: 5895", "height: tall"), NAMES)
    with pytest.raises(baseline.BaselineError, match="Unknown country"):
        baseline.parse_html(HTML.replace('"Tanzania"', '"Atlantis"'), NAMES)


def test_parses_the_readme_list() -> None:
    [entry] = baseline.parse_readme(README, NAMES)
    assert (entry.base_name, entry.qualifier, entry.height_m) == (
        "Mount Stanley",
        "Margherita Peak",
        5109,
    )
    assert entry.countries == ["UGA", "COD"]


def test_records_that_the_array_is_not_sorted() -> None:
    snapshot = baseline.BaselineSnapshot("abc", "2025-07-21", HTML, README)
    entries = baseline.parse_snapshot(snapshot, NAMES)
    elgon = next(e for e in entries if e.base_name == "Mount Elgon")
    assert elgon.claims and "not sorted by height" in elgon.claims[0]


# ── Sources ──────────────────────────────────────────────────────────────────


def test_reads_factbook_elevation_texts() -> None:
    assert sources.parse_elevation_text("Mount Kenya 5,199 m") == ("Mount Kenya", 5199)
    assert sources.parse_elevation_text("Lac Assal -155 m") == ("Lac Assal", -155)
    assert sources.parse_elevation_text(
        "unnamed elevation 63 m; 3 km southeast of the town of Sabi"
    ) == ("unnamed elevation", 63)
    with pytest.raises(sources.SourceError):
        sources.parse_elevation_text("no number here")


def test_every_country_has_a_factbook_code() -> None:
    countries = json.loads((SEEDS_DIR / "countries.json").read_text())["countries"]
    assert {c["iso3"] for c in countries} == set(sources.GEC_CODES)
    assert len(set(sources.GEC_CODES.values())) == 54


def test_quotes_match_despite_typography() -> None:
    text = "The peak\u2019s name means \u201cbeautiful little mountain\u201d \u2014 in  Sesotho."
    assert sources.quote_in_text(
        'The peak\'s name means "beautiful little mountain" - in Sesotho', text
    )
    assert not sources.quote_in_text("an invented etymology", text)


def test_parses_wikidata_peaks_and_converts_units() -> None:
    row = {
        "item": "http://www.wikidata.org/entity/Q1",
        "label": "Test Peak",
        "amount": "10000",
        "unit": "http://www.wikidata.org/entity/Q3710",  # feet
        "coord": "Point(37.3 -3.07)",
        "prom": "5",
        "promUnit": "http://www.wikidata.org/entity/Q99999",  # unknown unit: dropped
        "types": "http://www.wikidata.org/entity/Q8502",
        "links": "3",
    }
    peak = parse_peak(row)
    assert peak.elevation_m == pytest.approx(3048.0)
    assert (peak.lon, peak.lat) == (37.3, -3.07)
    assert peak.prominence_m is None and peak.dropped_units
    assert parse_point("Point(1.5E-1 2)") == (0.15, 2.0)
    assert parse_point(None) is None


# ── Matching and slugs ───────────────────────────────────────────────────────


def test_matches_names_across_spellings() -> None:
    assert names_match("Inyangani", ["Mount Nyangani"])
    assert names_match("Loma Mansa (Bintimani)", ["Mount Bintumani"])
    assert names_match("Fako on Mont Cameroun", ["Mount Cameroon"])
    assert names_match("Monts Nimba", ["Mount Richard-Molard", "Mont Nimba"])
    assert not names_match("Manyelanong Hill", ["Otse Hill"])
    assert not names_match("unnamed elevation", ["Mount Heha"])
    assert one_edit_apart("bintimani", "bintumani") and not one_edit_apart("abc", "xyz")
    assert slugify("Mont Idoukal-n-Taghès") == "mont-idoukal-n-taghes"


# ── Elevation rules ──────────────────────────────────────────────────────────


def choose(values: list[Elevation]) -> tuple[Elevation, str, list[str]]:
    return choose_elevation(values, agree_m=10, review_m=10, low_m=50, priority=PRIORITY)


def e(metres: float, family: str, tier: Tier = "reference") -> Elevation:
    return Elevation(metres, f"src-{family}", family, tier, family)


PRIORITY = ["wikidata", "factbook", "wikipedia", "geonames", "harim-prototype"]


def test_agreement_gives_high_confidence() -> None:
    chosen, confidence, notes = choose([e(3018, "wikidata"), e(3013, "geonames")])
    assert (chosen.metres, confidence, notes) == (3018, "high", [])


def test_disagreement_above_10_m_needs_review_and_above_50_m_is_low() -> None:
    _, confidence, notes = choose([e(4533, "wikidata"), e(4550, "factbook")])
    assert confidence == "medium" and notes and "17 m" in notes[0]
    chosen, confidence, _ = choose([e(4231, "wikidata"), e(4120, "geonames")])
    assert (chosen.metres, confidence) == (4231, "low")


def test_consensus_beats_priority_and_outliers_only_lower_to_medium() -> None:
    values = [e(4095, "wikidata"), e(4045, "factbook"), e(4040, "geonames")]
    chosen, confidence, notes = choose(values)
    assert (chosen.metres, confidence) == (4045, "medium")  # two sources agree on ~4,040
    assert notes  # the 55 m spread is flagged for review


def test_a_less_reliable_source_flags_review_without_lowering_confidence() -> None:
    values = [e(3018, "wikidata"), e(3018, "factbook"), e(2586, "harim-prototype", "secondary")]
    chosen, confidence, notes = choose(values)
    assert (chosen.metres, confidence) == (3018, "high")
    assert notes and "432 m" in notes[0]


def test_single_sources_are_medium_or_low() -> None:
    assert choose([e(3500, "wikidata")])[1] == "medium"
    assert choose([e(3500, "geonames")])[1] == "low"
    # Two values from one family count once.
    _, confidence, _ = choose(
        [e(3500, "wikidata"), Elevation(3400, "other", "wikidata", "reference", "wd2")]
    )
    assert confidence == "medium"


# ── Geography ────────────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def countries() -> Countries:
    return Countries.load()


def test_point_in_country_with_border_distances(countries: Countries) -> None:
    assert countries.containing(37.3558, -3.0674) == ["TZA"]  # Kilimanjaro
    margherita = countries.near(29.8725, 0.3867, within_km=5)
    assert set(margherita) == {"COD", "UGA"}  # on the border
    assert min(margherita.values()) == 0
    assert countries.near(0.0, 0.0, within_km=5) == {}  # the Gulf of Guinea
    assert haversine_km(0, 0, 0, 1) == pytest.approx(111.19, rel=1e-3)


# ── The committed seeds ──────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def seeds() -> dict[str, Any]:
    return {
        "mountains": json.loads((SEEDS_DIR / "mountains.json").read_text())["mountains"],
        "lows": json.loads((SEEDS_DIR / "country_low_points.json").read_text())["low_points"],
        "countries": json.loads((SEEDS_DIR / "countries.json").read_text())["countries"],
    }


def test_seeds_give_every_country_one_high_point_above_its_low_point(
    seeds: dict[str, Any],
) -> None:
    mountains: list[dict[str, Any]] = seeds["mountains"]
    lows = {p["iso3"]: p for p in seeds["lows"]}
    high: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for m in mountains:
        for c in m["countries"]:
            if c["is_country_high_point"]:
                high[c["iso3"]].append(m)
    iso3s = {c["iso3"] for c in seeds["countries"]}
    assert set(high) == iso3s and all(len(v) == 1 for v in high.values())
    assert set(lows) == iso3s
    for iso3, [m] in high.items():
        assert m["summit_kind"] != "summit"
        assert lows[iso3]["elevation_m"] < m["elevation_m"]
        if lows[iso3]["feature_type"] == "coast":
            assert lows[iso3]["elevation_m"] == 0


def test_seeds_respect_the_hierarchy_and_counting_rules(seeds: dict[str, Any]) -> None:
    mountains: list[dict[str, Any]] = seeds["mountains"]
    by_slug = {m["slug"]: m for m in mountains}
    assert len(by_slug) == len(mountains)  # unique slugs
    assert len({m["wikidata_qid"] for m in mountains}) == len(mountains)
    for m in mountains:
        assert 0 <= m["elevation_m"] <= 6000
        assert -47 <= m["latitude"] <= 38 and -26 <= m["longitude"] <= 64
        if m["summit_kind"] == "summit":
            assert by_slug[m["parent"]]["summit_kind"] == "massif"
        else:
            assert m["parent"] is None
        if m["summit_kind"] == "massif":
            summits = [s for s in mountains if s["parent"] == m["slug"]]
            assert summits and m["elevation_m"] == max(s["elevation_m"] for s in summits)
        if m["territory_name"]:
            assert m["countries"] == []
        else:
            assert m["countries"]
            shared = len(m["countries"]) > 1
            assert all(c["is_shared"] == shared for c in m["countries"])
        if m["name_origin"]:
            assert m["name_origin_source"]


def test_seeds_resolve_the_known_prototype_issues(seeds: dict[str, Any]) -> None:
    by_name = {m["name"]: m for m in seeds["mountains"]}
    assert by_name["Emba Soira"]["elevation_m"] == 3018
    mafadi = by_name["Mafadi"]
    assert {c["iso3"] for c in mafadi["countries"] if c["is_country_high_point"]} == {"ZAF"}
    nimba = by_name["Mount Richard-Molard"]
    assert {c["iso3"] for c in nimba["countries"]} == {"GIN", "CIV"}
    assert all(c["is_country_high_point"] for c in nimba["countries"])
    assert by_name["Piton des Neiges"]["territory_name"] == "Réunion"
    kilimanjaro = by_name["Mount Kilimanjaro"]
    assert kilimanjaro["summit_kind"] == "massif"
    assert {m["name"] for m in seeds["mountains"] if m["parent"] == kilimanjaro["slug"]} == {
        "Mount Kibo",
        "Mawenzi",
        "Shira",
    }


def test_peak_type_counts_global_volcanism_program_volcanoes() -> None:
    assert peak_type_of(["Q8502"], "standalone") == "peak"
    assert peak_type_of(["Q8502"], "standalone", gvp_volcano=True) == "volcano"
    # A more specific class still wins, and a listed massif is a volcano (its summit kind
    # already says massif).
    assert peak_type_of(["Q169358"], "standalone", gvp_volcano=True) == "stratovolcano"
    assert peak_type_of(["Q1061151"], "massif", gvp_volcano=True) == "volcano"
    assert peak_type_of(["Q1061151"], "massif") == "massif"


def test_fetch_volcano_ids_keeps_one_number_per_item(monkeypatch: pytest.MonkeyPatch) -> None:
    queries: list[str] = []

    def fake_sparql(query: str, *, refresh: bool = False) -> list[dict[str, str]]:
        queries.append(query)
        entity = "http://www.wikidata.org/entity/"
        return [
            {"item": f"{entity}Q309098", "vn": "222160"},
            {"item": f"{entity}Q7296", "vn": "222150"},
            {"item": f"{entity}Q7296", "vn": "222149"},
        ]

    monkeypatch.setattr(harim_wikidata, "sparql", fake_sparql)
    assert harim_wikidata.fetch_volcano_ids(["Q7296", "Q309098", "Q7296"]) == {
        "Q309098": "222160",
        "Q7296": "222149",
    }
    assert len(queries) == 1 and "wdt:P1886" in queries[0]
