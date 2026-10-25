from __future__ import annotations

import json
import re
from collections import Counter

from pipelines.africa_pipelines.extract_pdf import CURATION_FILE, STATES_FILE

STATES = json.loads(STATES_FILE.read_text(encoding="utf-8"))
CURATION = json.loads(CURATION_FILE.read_text(encoding="utf-8"))


# UN M49 membership of the 54 states (https://unstats.un.org/unsd/methodology/m49/overview/,
# read 2026-10-22), written out independently of the reference file it checks.
M49_MEMBERS = {
    "north": "DZA EGY LBY MAR SDN TUN",
    "west": "BEN BFA CIV CPV GHA GIN GMB GNB LBR MLI MRT NER NGA SEN SLE TGO",
    "central": "AGO CAF CMR COD COG GAB GNQ STP TCD",
    "east": "BDI COM DJI ERI ETH KEN MDG MOZ MUS MWI RWA SOM SSD SYC TZA UGA ZMB ZWE",
    "southern": "BWA LSO NAM SWZ ZAF",
}


def test_fifty_four_states_in_the_un_m49_regions() -> None:
    countries = STATES["countries"]
    assert len(countries) == 54
    assert Counter(c["region"] for c in countries) == {
        "north": 6, "west": 16, "central": 9, "east": 18, "southern": 5,
    }  # fmt: skip
    for region, members in M49_MEMBERS.items():
        assert {c["iso3"] for c in countries if c["region"] == region} == set(members.split())


def test_iso_codes_are_well_formed_and_unique() -> None:
    countries = STATES["countries"]
    for key, pattern in (("iso2", r"[A-Z]{2}"), ("iso3", r"[A-Z]{3}")):
        values = [c[key] for c in countries]
        assert all(re.fullmatch(pattern, v) for v in values)
        assert len(set(values)) == 54
    assert len({c["iso_numeric"] for c in countries}) == 54


def test_names_keep_diacritics() -> None:
    names = {c["name"] for c in STATES["countries"]}
    assert {"Côte d'Ivoire", "São Tomé and Príncipe"} <= names


def test_curation_covers_every_country() -> None:
    iso3s = {c["iso3"] for c in STATES["countries"]}
    assert set(CURATION["countries"]) == iso3s
    assert set(CURATION["etymology_categories"]) == iso3s
    assert set(CURATION["corrections"]) <= iso3s
