"""The reconciler end to end on a small, hand-made world (Kenya and Tanzania on the real map
boundaries): selection, hierarchy, shared peaks, subsidiary points, and its loud failures."""

from __future__ import annotations

import copy
from typing import Any

import pytest

from pipelines.africa_pipelines.harim_geo import Countries
from pipelines.africa_pipelines.harim_reconcile import Inputs, ReconcileError, reconcile
from pipelines.africa_pipelines.harim_sources import FactbookExtreme, FactbookSnapshot
from pipelines.africa_pipelines.harim_wikidata import CountryExtreme, WikidataPeak

ARTICLE = "https://en.wikipedia.org/wiki/Test_Massif"
ARTICLE_TEXT = "The Test Massif's highest point is Kibo Test. It means 'spotted'."


def peak(qid: str, label: str, metres: float, lon: float, lat: float, **extra: Any) -> WikidataPeak:
    fields: dict[str, Any] = {
        "qid": qid,
        "label": label,
        "alt_labels": [],
        "elevation_m": metres,
        "lon": lon,
        "lat": lat,
        "classes": ["Q8502"],
        "country_qids": ["Q924"],
        "range_qids": [],
        "part_of_qids": [],
        "prominence_m": None,
        "isolation_km": None,
        "geonames_id": None,
        "sitelinks": 10,
        "enwiki": None,
    }
    fields.update(extra)
    return WikidataPeak(**fields)


@pytest.fixture(scope="module")
def geography() -> Countries:
    return Countries.load()


def world(geography: Countries) -> tuple[Inputs, dict[str, Any], dict[str, Any]]:
    massif = peak("Q100", "Test Massif", 5895, 37.3558, -3.0674, classes=["Q1061151"])
    summit = peak("Q101", "Kibo Test", 5890, 37.356, -3.066, sitelinks=2)
    nearby = peak("Q102", "Bot Point", 5100, 37.40, -3.07, sitelinks=1)  # inside the massif
    meru = peak("Q103", "Meru Test", 4562, 36.7578, -3.2458, range_qids=["Q900"])
    kenya = peak("Q200", "Kenya Test", 5199, 37.3072, -0.1522, country_qids=["Q114"])
    # Mount Elgon sits on the Kenya-Uganda border; here it is shared by Kenya and Tanzania's
    # neighbour list only to exercise is_shared, so give it two countries we know.
    shared = peak("Q300", "Shared Test", 2000, 33.9, -1.0, country_qids=["Q114", "Q924"])
    hill = peak("Q400", "Small Hill", 900, 36.0, -5.0, sitelinks=1)  # not notable
    items = {p.qid: p for p in (massif, summit, nearby, meru, kenya, shared, hill)}
    inputs = Inputs(
        country_names={"KEN": "Kenya", "TZA": "Tanzania"},
        country_qids={"KEN": "Q114", "TZA": "Q924"},
        candidates={"KEN": [kenya, shared], "TZA": [massif, summit, nearby, meru, shared, hill]},
        items=items,
        volcano_ids={"Q103": "222160"},
        extremes=[
            CountryExtreme(
                "TZA", "high", "Q101", "Kibo Test", None, 5890, 37.356, -3.066, "NormalRank"
            ),
            CountryExtreme(
                "KEN", "high", "Q200", "Kenya Test", None, 5199, 37.3, -0.15, "NormalRank"
            ),
            CountryExtreme("TZA", "low", "Q9", "Indian Ocean", None, 0, None, None, "NormalRank"),
            CountryExtreme("KEN", "low", "Q9", "Indian Ocean", None, 0, None, None, "NormalRank"),
        ],
        factbook=FactbookSnapshot(
            commit="f" * 40,
            committed_at="2026-01-22",
            extremes={
                ("TZA", "high"): FactbookExtreme(
                    "TZA", "high", "Kibo Test 5,895 m", "Kibo Test", 5895
                ),
                ("KEN", "high"): FactbookExtreme(
                    "KEN", "high", "Kenya Test 5,199 m", "Kenya Test", 5199
                ),
                ("TZA", "low"): FactbookExtreme(
                    "TZA", "low", "Indian Ocean 0 m", "Indian Ocean", 0
                ),
                ("KEN", "low"): FactbookExtreme(
                    "KEN", "low", "Indian Ocean 0 m", "Indian Ocean", 0
                ),
            },
            names={"KEN": "Kenya", "TZA": "Tanzania"},
        ),
        baseline=[],
        baseline_source="harim-prototype",
        baseline_commit="a" * 40,
        geonames={},
        geography=geography,
        source_texts={ARTICLE: ARTICLE_TEXT},
        island_states=set(),
    )
    curation: dict[str, Any] = {
        "selection": {
            "always_include_m": 3000,
            "notable_per_country": 8,
            "notable_min_sitelinks": 3,
            "notable_min_prominence_m": 500,
            "subsidiary_km": 1.5,
            "match_km": 10,
            "border_tolerance_km": 5,
            "island_tolerance_km": 15,
            "agree_m": 10,
            "review_m": 10,
            "low_m": 50,
            "priority": ["wikidata", "factbook", "wikipedia", "geonames", "harim-prototype"],
        },
        "exclude_classes": {"Q46831": "mountain range"},
        "exclude_label_pattern": r"\b(range)\b",
        "exclude": {},
        "include": {},
        "labels": {},
        "baseline_matches": {},
        "merges": [],
        "massifs": [
            {
                "qid": "Q100",
                "radius_km": 12,
                "top": "Q101",
                "summits": ["Q101"],
                "source": ARTICLE,
                "quote": "The Test Massif's highest point is Kibo Test.",
            }
        ],
        "elevations": [],
        "high_points": {},
        "low_points": {},
        "ranges": [{"slug": "test-range", "name": "Test Range", "qid": "Q900"}],
        "range_aliases": {},
        "range_assignments": {},
        "territories": [],
    }
    names: dict[str, Any] = {
        "entries": [
            {
                "qid": "Q101",
                "name_origin": "“Spotted”.",
                "source": ARTICLE,
                "quote": "It means 'spotted'.",
            }
        ]
    }
    return inputs, curation, names


def test_builds_the_catalogue(geography: Countries) -> None:
    inputs, curation, names = world(geography)
    result = reconcile(inputs, curation, names)
    by_name = {m.name: m for m in result.mountains}
    massif, summit = by_name["Test Massif"], by_name["Kibo Test"]
    # P610 named the summit; the high point is its massif, at the summit's consensus height.
    assert massif.high_point_of == {"TZA"} and summit.high_point_of == set()
    assert summit.parent == massif.key and massif.summit_kind == "massif"
    assert massif.elevation_m == summit.elevation_m
    assert summit.name_origin == "“Spotted”."
    # A little-known point inside the massif is part of it, not a separate mountain.
    assert "Bot Point" not in by_name
    assert any(e.name == "Bot Point" and "Test Massif" in e.reason for e in result.exclusions)
    # Shared peaks keep both countries; ranges come only from curated range items.
    assert by_name["Shared Test"].countries == {"KEN", "TZA"}
    assert by_name["Meru Test"].range_slug == "test-range"
    # Typed only as a mountain in Wikidata but listed by the Global Volcanism Program: a volcano,
    # sourced to the GVP, with no status (none is stated).
    meru = by_name["Meru Test"]
    assert meru.peak_type == "volcano" and meru.volcanic_status is None
    assert ("gvp-222160", "volcanic_status") in meru.sources
    assert result.sources.records["gvp-222160"].url.startswith("https://volcano.si.edu/")
    assert by_name["Kenya Test"].peak_type == "peak"
    # Not notable (one Wikipedia edition, no prominence): left out.
    assert "Small Hill" not in by_name
    assert {p.iso3: p.elevation_m for p in result.low_points.values()} == {"KEN": 0, "TZA": 0}


def test_fails_when_sources_name_different_high_points(geography: Countries) -> None:
    inputs, curation, names = world(geography)
    inputs.factbook.extremes[("KEN", "high")] = FactbookExtreme(
        "KEN", "high", "Some Other Hill 1,000 m", "Some Other Hill", 1000
    )
    with pytest.raises(ReconcileError, match="Kenya: Wikidata's high point Kenya Test"):
        reconcile(inputs, curation, names)
    # A recorded decision resolves it (and the disagreement is still reported).
    curation = copy.deepcopy(curation)
    curation["high_points"]["KEN"] = {"qid": "Q200", "factbook": "different", "reason": "test"}
    result = reconcile(inputs, curation, names)
    assert any("Kenya" in c for c in result.conflicts)


def test_fails_on_an_invented_quote(geography: Countries) -> None:
    inputs, curation, names = world(geography)
    names["entries"][0]["quote"] = "It means 'the white one'."
    with pytest.raises(
        ReconcileError, match=r"is not in https://en\.wikipedia\.org/wiki/Test_Massif"
    ):
        reconcile(inputs, curation, names)


def test_fails_loudly_when_a_country_has_no_high_point(geography: Countries) -> None:
    inputs, curation, names = world(geography)
    inputs.extremes = [e for e in inputs.extremes if not (e.iso3 == "KEN" and e.kind == "high")]
    with pytest.raises(ReconcileError, match="Kenya: Wikidata gives 0 high points"):
        reconcile(inputs, curation, names)
