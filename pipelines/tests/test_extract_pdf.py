from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

import pytest

from pipelines.africa_pipelines import extract_pdf, settings
from pipelines.africa_pipelines.extract_pdf import Extraction, SeedOverwriteError
from pipelines.africa_pipelines.text import leftover_citation_digits


@pytest.fixture(scope="module")
def extraction() -> Extraction:
    return extract_pdf.extract()


def by_iso3(extraction: Extraction, iso3: str) -> extract_pdf.CountryRecord:
    return next(c for c in extraction.countries if c.iso3 == iso3)


def test_validation_passes_with_54_countries_in_m49_regions(extraction: Extraction) -> None:
    assert len(extraction.countries) == 54
    counts = dict.fromkeys(extract_pdf.EXPECTED_REGION_COUNTS, 0)
    for country in extraction.countries:
        counts[country.region] += 1
    assert counts == extract_pdf.EXPECTED_REGION_COUNTS
    assert [r["slug"] for r in extraction.regions] == [
        "north",
        "west",
        "central",
        "east",
        "southern",
    ]


def test_regions_follow_un_m49_not_the_document(extraction: Extraction) -> None:
    regions = {c.iso3: c.region for c in extraction.countries}
    # The five states the research document groups differently.
    assert regions["MRT"] == "west"
    assert regions["SDN"] == "north"
    assert regions["MOZ"] == "east"
    assert regions["ZMB"] == "east"
    assert regions["ZWE"] == "east"
    # M49's Middle Africa, shown as Central Africa.
    assert regions["TCD"] == "central"
    assert regions["AGO"] == "central"
    names = {r["slug"]: r["name"] for r in extraction.regions}
    assert names == {
        "north": "Northern Africa",
        "west": "Western Africa",
        "central": "Central Africa",
        "east": "Eastern Africa",
        "southern": "Southern Africa",
    }


def test_document_grouping_still_matches_the_pdf_headings() -> None:
    states = json.loads(extract_pdf.STATES_FILE.read_text(encoding="utf-8"))
    counts = Counter(extract_pdf.document_region(c) for c in states["countries"])
    assert dict(counts) == extract_pdf.DOCUMENT_REGION_COUNTS
    moved = {c["iso3"] for c in states["countries"] if "document_region" in c}
    assert moved == {"MRT", "SDN", "MOZ", "ZMB", "ZWE"}


def test_every_country_has_all_summary_fields(extraction: Extraction) -> None:
    for country in extraction.countries:
        for key in (
            "etymology_summary",
            "flag_design_summary",
            "national_symbol_summary",
            "national_animal_name",
        ):
            assert country.profile[key], (country.name, key)


def test_no_citation_digits_leak_into_text(extraction: Extraction) -> None:
    for country in extraction.countries:
        for key, value in country.profile.items():
            if isinstance(value, str) and key != "review_notes":
                assert leftover_citation_digits(value) == [], (country.name, key)
    # The PDF's "1525" is followed by a superscript citation (ref 4); they stay separate.
    raw = next(p.text for p in extraction.document.prose if p.label == "Algeria")
    assert "mainland in 1525⟦4⟧." in raw
    algeria = by_iso3(extraction, "DZA").profile["etymology_detail"]
    assert "15254" not in algeria
    egypt = by_iso3(extraction, "EGY").profile["etymology_detail"]
    assert egypt.endswith("the creator god Ptah.")


def test_table_cells_are_rejoined(extraction: Extraction) -> None:
    assert (
        by_iso3(extraction, "LBY").profile["flag_design_summary"] == "Red/Black/Green with Crescent"
    )
    assert by_iso3(extraction, "NER").profile["etymology_summary"] == "River Niger / Flowing Water"
    assert by_iso3(extraction, "NER").profile["national_animal_name"] == "West African Giraffe"
    assert by_iso3(extraction, "STP").profile["etymology_summary"] == "Saints (St. Thomas/Prince)"
    assert by_iso3(extraction, "TUN").profile["national_symbol_summary"] == (
        "Carthaginian Galley/Lion/Balance"
    )


def test_canonical_names_and_citations(extraction: Extraction) -> None:
    names = {c.name for c in extraction.countries}
    assert {"São Tomé and Príncipe", "Côte d'Ivoire", "The Gambia"} <= names
    uganda = by_iso3(extraction, "UGA")
    assert ("national_animal", "symbology-ref-19") in uganda.citations
    crane = "the supreme national symbol and animal: the Grey Crowned Crane."
    for key in ("flag_design_detail", "national_symbol_detail", "national_animal_detail"):
        assert crane in uganda.profile[key]


def test_scientific_names_are_italic_binomials(extraction: Extraction) -> None:
    assert by_iso3(extraction, "DZA").profile["national_animal_scientific"] == "Vulpes zerda"
    assert by_iso3(extraction, "CAF").profile["national_animal_scientific"] == (
        "Forest Elephant: Loxodonta cyclotis"
    )
    assert by_iso3(extraction, "COD").profile["national_animal_scientific"] == (
        "Leopard: Panthera pardus"
    )
    assert by_iso3(extraction, "KEN").profile["national_animal_scientific"] is None


def test_animal_status_never_presents_inference_as_official(extraction: Extraction) -> None:
    status = {c.iso3: c.profile["animal_status"] for c in extraction.countries}
    for iso3 in ("MRT", "DJI", "SYC", "STP", "MDG", "SWZ"):
        assert status[iso3] == "inferred", iso3
    for iso3 in ("CPV", "MLI"):
        assert status[iso3] == "sports_nickname", iso3
    assert status["GMB"] == "contested"  # hyena (folklore) and scorpion (football)
    assert status["LBY"] == "de_facto"
    assert by_iso3(extraction, "LBY").profile["national_animal_name"] == "Fennec Fox"


def test_reviewed_status_changes(extraction: Extraction) -> None:
    status = {c.iso3: c.profile["animal_status"] for c in extraction.countries}
    # Coat-of-arms or official-list basis verified on review.
    for iso3 in ("MUS", "LSO", "NAM", "KEN", "GAB", "BEN", "ZAF", "SDN"):
        assert status[iso3] == "official", iso3
    assert status["CMR"] == "sports_nickname"  # the coat of arms has no lion


def test_needs_review_reflects_sources_and_known_issues(extraction: Extraction) -> None:
    drc = by_iso3(extraction, "COD").profile
    assert drc["needs_review"] is True  # still relies on low-tier sources
    assert "[corrected] etymology detail" in drc["review_notes"]
    assert drc["etymology_category"] == "geographic_feature"
    assert by_iso3(extraction, "BFA").profile["etymology_category"] is None  # none fits


def test_verified_corrections_are_applied_and_cited(extraction: Extraction) -> None:
    drc = by_iso3(extraction, "COD")
    assert drc.profile["etymology_summary"] == "Congo River (Kongo Kingdom)"
    assert "former name, Zaire" in drc.profile["etymology_detail"]
    assert ("etymology", "wikipedia-zaire") in drc.citations
    rwanda = by_iso3(extraction, "RWA").profile["flag_design_detail"]
    assert 'red, yellow and green tricolour with a black "R"' in rwanda
    assert "red-black-green" not in rwanda
    motto = by_iso3(extraction, "ZAF").profile["national_symbol_detail"]
    assert "\u01c3ke e\ua789 \u01c0xarra \u01c1ke" in motto  # official motto with click letters
    assert by_iso3(extraction, "GNQ").profile["national_animal_name"] == "Not established"
    assert "1529" in by_iso3(extraction, "DZA").profile["etymology_detail"]
    assert len(extraction.corrections) == 31


def test_a_correction_that_no_longer_matches_fails_loudly(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    curation = json.loads(extract_pdf.CURATION_FILE.read_text(encoding="utf-8"))
    curation["corrections"]["RWA"][0]["replace"] = "text that is not in the PDF"
    patched = tmp_path / "curation.json"
    patched.write_text(json.dumps(curation, ensure_ascii=False), encoding="utf-8")
    monkeypatch.setattr(extract_pdf, "CURATION_FILE", patched)
    with pytest.raises(extract_pdf.ValidationError, match="RWA: correction for flag_design_detail"):
        extract_pdf.extract()


def test_sources_have_tiers_and_low_tier_social_sites(extraction: Extraction) -> None:
    document_sources = [s for s in extraction.sources if s["ref_no"] is not None]
    assert len(document_sources) == 39
    review_sources = [s for s in extraction.sources if s["ref_no"] is None]
    assert review_sources and all(s["reliability_tier"] == "reference" for s in review_sources)
    tiers = {s["ref_no"]: s["reliability_tier"] for s in document_sources}
    for ref in (13, 20, 22, 24, 25, 32, 35, 38):  # reddit, facebook, quora, fan wikis
        assert tiers[ref] == "low", ref
    assert extraction.uncited_refs == [6, 7, 8, 9, 10, 12, 13, 14, 15, 21, 25, 28, 34, 37]


def test_committed_seeds_match_a_fresh_extraction(extraction: Extraction) -> None:
    args = argparse.Namespace(
        pdf=extract_pdf.PDF_PATH, seeds_dir=settings.SEEDS_DIR, check=True,
        report=extract_pdf.REPORT_PATH, force=False,
    )  # fmt: skip
    assert extract_pdf.run(args) == 0


def test_hand_edited_seeds_are_not_overwritten(extraction: Extraction, tmp_path: Path) -> None:
    extract_pdf.write_seeds(extraction, extract_pdf.PDF_PATH, tmp_path, force=False)
    countries_file = tmp_path / "countries.json"
    data = json.loads(countries_file.read_text(encoding="utf-8"))
    data["countries"][0]["profile"]["needs_review"] = False
    countries_file.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

    assert extract_pdf.is_hand_edited(countries_file)
    with pytest.raises(SeedOverwriteError, match=r"countries\.json"):
        extract_pdf.write_seeds(extraction, extract_pdf.PDF_PATH, tmp_path, force=False)
    extract_pdf.write_seeds(extraction, extract_pdf.PDF_PATH, tmp_path, force=True)
    assert not extract_pdf.is_hand_edited(countries_file)


def test_changed_pdf_fails_validation_loudly(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    curation = json.loads(extract_pdf.CURATION_FILE.read_text(encoding="utf-8"))
    curation["countries"]["KEN"]["sentence_count"] = 99
    patched = tmp_path / "curation.json"
    patched.write_text(json.dumps(curation), encoding="utf-8")
    monkeypatch.setattr(extract_pdf, "CURATION_FILE", patched)
    with pytest.raises(extract_pdf.ValidationError, match="Kenya: prose now splits into 6"):
        extract_pdf.extract()


def test_report_lists_brief_issues_and_proposals(extraction: Extraction) -> None:
    from pipelines.africa_pipelines.report import build_report

    report = build_report(extraction)
    for phrase in (
        "River swallowing rivers",
        "Land of Vexation",
        "hippopotamus",
        "red, yellow and green tricolour",
        "Silvery-cheeked Hornbill",
        "fan wiki (ref 38)",
        "Etymology categories",
        "Corrections applied",
        "Retracted:",
    ):
        assert phrase in report, phrase
