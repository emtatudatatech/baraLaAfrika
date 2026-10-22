from __future__ import annotations

import datetime as dt
import json
from typing import Any

import pytest

from pipelines.africa_pipelines import indicators, indicators_report
from pipelines.africa_pipelines.indicators import Build, Creditor, Observation
from pipelines.africa_pipelines.indicators_sources import (
    IdsRow,
    IndicatorsError,
    Value,
    WeoEdition,
    clean_name,
    config,
    parse_hdr,
    parse_hdr_owid,
    parse_ids,
    parse_wdi,
    parse_weo,
)

COUNTRIES = {"KEN", "NGA", "ERI"}
OCTOBER_2026 = WeoEdition(dt.date(2026, 10, 13))


def spec(key: str) -> dict[str, Any]:
    return next(s for s in config()["indicators"] if s["key"] == key)


# ── Sources ──────────────────────────────────────────────────────────────────


def test_wdi_keeps_the_54_and_drops_empty_values() -> None:
    def row(iso3: str, year: str, value: float | None) -> dict[str, Any]:
        return {
            "indicator": {"id": "SP.POP.TOTL"},
            "countryiso3code": iso3,
            "date": year,
            "value": value,
        }

    meta = {"page": 1, "pages": 1, "lastupdated": "2026-10-08"}
    rows = [row("KEN", "2025", 56_000_000), row("KEN", "2024", None), row("FRA", "2025", 1)]
    body = json.dumps([meta, rows]).encode()
    values, updated = parse_wdi(body, "SP.POP.TOTL", COUNTRIES)
    assert values == [Value("KEN", 2025, 56_000_000.0)]
    assert updated == "2026-10-08"


def test_wdi_error_messages_stop_the_run() -> None:
    body = json.dumps([{"message": [{"value": "The indicator was not found"}]}]).encode()
    with pytest.raises(IndicatorsError, match="not found"):
        parse_wdi(body, "NY.GNI.MKTP.CD", COUNTRIES)


def weo_payload(published: str = "2026-10-13T02:00:00Z") -> dict[str, Any]:
    return {
        "data": {
            "structures": [
                {
                    "dimensions": {
                        "series": [
                            {"id": "COUNTRY", "values": [{"id": "KEN"}, {"id": "USA"}]},
                            {"id": "INDICATOR", "values": [{"id": "GGXWDG_NGDP"}]},
                            {"id": "FREQUENCY", "values": [{"id": "A"}]},
                        ],
                        "observation": [
                            {"values": [{"value": "2024"}, {"value": "2025"}, {"value": "2026"}]}
                        ],
                    },
                    "attributes": {"dataSet": [{"id": "DOI"}, {"id": "PUBLICATION_DATE"}]},
                }
            ],
            "dataSets": [
                {
                    "attributes": [None, [published]],
                    "series": {
                        "0:0:0": {"observations": {"0": ["67.3"], "1": ["71.3"], "2": ["72.9"]}},
                        "1:0:0": {"observations": {"0": ["120.0"]}},
                    },
                }
            ],
        }
    }


def test_weo_reads_values_and_the_edition() -> None:
    by_code, edition = parse_weo(json.dumps(weo_payload()).encode(), COUNTRIES)
    assert edition == OCTOBER_2026
    assert edition.label == "IMF WEO October 2026"
    assert [(v.iso3, v.year, v.value) for v in by_code["GGXWDG_NGDP"]] == [
        ("KEN", 2024, 67.3),
        ("KEN", 2025, 71.3),
        ("KEN", 2026, 72.9),
    ]
    assert WeoEdition(dt.date(2027, 4, 14)).label == "IMF WEO April 2027"


def test_weo_without_a_publication_date_is_refused() -> None:
    payload = weo_payload()
    payload["data"]["dataSets"][0]["attributes"] = [None, None]
    with pytest.raises(IndicatorsError, match="PUBLICATION_DATE"):
        parse_weo(json.dumps(payload).encode(), COUNTRIES)


def test_hdr_reads_undp_wide_and_owid_long_files() -> None:
    wide = (
        b"iso3,country,hdi_2022,hdi_2023,gnipc_2023\n"
        b"KEN,Kenya,0.626,0.628,5000\nFRA,France,0.9,0.91,1\n"
    )
    assert parse_hdr(wide, COUNTRIES) == [Value("KEN", 2022, 0.626), Value("KEN", 2023, 0.628)]
    long = (
        b"entity,code,year,hdi__sex_total,owid_region\n"
        b"Kenya,KEN,2023,0.628,Africa\nAfrica,,2023,0.56,\n"
    )
    assert parse_hdr_owid(long, "hdi__sex_total", COUNTRIES) == [Value("KEN", 2023, 0.628)]
    with pytest.raises(IndicatorsError, match="iso3"):
        parse_hdr(b"code,hdi_2023\nKEN,0.6\n", COUNTRIES)


def ids_record(
    series: str, iso3: str, year: int, counterpart: tuple[str, str], value: float | None
) -> dict[str, Any]:
    code, name = counterpart
    return {
        "variable": [
            {"concept": "Series", "id": series, "value": series},
            {"concept": "Time", "id": f"YR{year}", "value": str(year)},
            {"concept": "Country", "id": iso3, "value": iso3},
            {"concept": "Counterpart-Area", "id": code, "value": name},
        ],
        "value": value,
    }  # fmt: skip


def test_ids_rows_and_creditor_kinds() -> None:
    body = json.dumps(
        {
            "page": 1,
            "pages": 1,
            "lastupdated": "2025-12-03",
            "source": {
                "data": [
                    ids_record(
                        "DT.DOD.MLAT.CD", "KEN", 2024, ("905", "World Bank-IDA\xa0\xa0"), 11.9e9
                    ),
                    ids_record("DT.DOD.MLAT.CD", "KEN", 2024, ("WLD", "World"), 20e9),
                    ids_record("DT.DOD.MLAT.CD", "KEN", 2024, ("913", "African Dev. Bank"), None),
                ]
            },
        }
    ).encode()
    rows, updated = parse_ids(body, COUNTRIES)
    assert updated == "2025-12-03"
    assert [(r.counterpart, r.counterpart_name) for r in rows] == [
        ("905", "World Bank-IDA"),
        ("WLD", "World"),
    ]
    bonds = [IdsRow("DT.DOD.PBND.CD", "KEN", 2024, "WLD", "World", 6.6e9)]
    creditors = indicators.creditor_rows({"multilateral": rows}, bonds, {2024})
    assert creditors == [
        Creditor("KEN", 2024, "bondholders", "BND", "Bondholders", 6.6e9),
        Creditor("KEN", 2024, "multilateral", "905", "World Bank-IDA", 11.9e9),
    ]
    assert clean_name("Africa\xa0 Finance  Corp ") == "Africa Finance Corp"


# ── Rules ────────────────────────────────────────────────────────────────────


def test_imf_fills_only_the_year_before_the_edition_where_the_world_bank_has_none() -> None:
    wdi = [Observation("gdp_usd", "KEN", 2025, 135e9, "reported", "wb-wdi")]
    imf = [
        Value("KEN", 2025, 136e9),  # the World Bank has it: not used
        Value("NGA", 2025, 290e9),  # missing: filled as an estimate
        Value("NGA", 2024, 252e9),  # an older gap: never filled
        Value("NGA", 2026, 386e9),  # a projection: never used
    ]
    fills, checks = indicators.merge_imf(spec("gdp_usd"), wdi, imf, OCTOBER_2026)
    assert fills == [Observation("gdp_usd", "NGA", 2025, 290e9, "estimate", "imf-weo")]
    assert checks == []


def test_cross_check_lists_disagreements_beyond_the_tolerance() -> None:
    wdi = [
        Observation("inflation", "KEN", 2023, 7.7, "reported", "wb-wdi"),
        Observation("inflation", "NGA", 2023, 24.7, "reported", "wb-wdi"),
    ]
    imf = [Value("KEN", 2023, 7.6), Value("NGA", 2023, 30.0)]
    _, checks = indicators.merge_imf(spec("inflation"), wdi, imf, OCTOBER_2026)
    assert [(c.iso3, c.wdi, c.imf) for c in checks] == [("NGA", 24.7, 30.0)]


def test_weo_series_drop_projections_and_label_the_last_year_an_estimate() -> None:
    imf = [Value("KEN", 2024, 67.3), Value("KEN", 2025, 71.3), Value("KEN", 2026, 72.9)]
    rows = indicators.weo_observations(spec("government_debt"), imf, OCTOBER_2026)
    assert [(o.year, o.basis) for o in rows] == [(2024, "reported"), (2025, "estimate")]


def test_sipri_keeps_only_the_latest_ten_years() -> None:
    rows = [
        Observation("military_usd", "KEN", year, 1e9, "reported", "sipri-milex")
        for year in range(2005, 2026)
    ]
    kept, span = indicators.keep_latest_years(rows, 10)
    assert span == (2016, 2025)
    assert [o.year for o in kept] == list(range(2016, 2026))


def build_with(observations: list[Observation]) -> Build:
    return Build(
        observations=observations,
        creditors=[],
        editions={},
        updated={},
        weo=OCTOBER_2026,
        hdr_source="undp-hdr",
        today=dt.date(2026, 10, 22),
    )


def test_validation_refuses_current_years_misplaced_estimates_and_implausible_values() -> None:
    every = [
        Observation(s["key"], "KEN", 2020, value, "reported", "wb-wdi")
        for s in config()["indicators"]
        for value in [0.5 if s["unit"] == "index" else 10.0]
    ]
    assert indicators.validate(build_with(every)) == []
    bad = [
        *every,
        Observation("population", "KEN", 2026, 1e6, "reported", "wb-wdi"),
        Observation("inflation", "KEN", 2023, 5.0, "estimate", "imf-weo"),
        Observation("hdi", "KEN", 2021, 1.4, "reported", "undp-hdr"),
    ]
    problems = indicators.validate(build_with(bad))
    assert any("has not ended" in p for p in problems)
    assert any("estimate must be for 2025" in p for p in problems)
    assert any("outside the plausible range" in p for p in problems)


def test_a_complete_year_needs_ninety_percent_of_the_states() -> None:
    from pipelines.africa_pipelines.gold_common import countries

    iso3s = [c.iso3 for c in countries()]
    rows = [Observation("hdi", i, 2022, 0.5, "reported", "undp-hdr") for i in iso3s]
    rows += [Observation("hdi", i, 2023, 0.5, "reported", "undp-hdr") for i in iso3s[:48]]
    assert indicators_report.complete_years(rows, "hdi") == [2022]  # 48 of 54 is under 90%
    assert indicators_report.default_window(rows, "hdi") == (2022, 2022)


# ── The committed seeds ──────────────────────────────────────────────────────


def test_committed_seeds_follow_the_rules() -> None:
    seed = json.loads(indicators.INDICATORS_SEED.read_text(encoding="utf-8"))
    columns = seed["observations"]["columns"]
    rows = [dict(zip(columns, r, strict=True)) for r in seed["observations"]["rows"]]
    generated = dt.date.fromisoformat(seed["$generated"]["generated_on"])
    keys = {s["key"] for s in config()["indicators"]}
    assert {r["indicator"] for r in rows} == keys
    assert all(r["year"] < generated.year for r in rows)
    estimate_years = {r["year"] for r in rows if r["basis"] == "estimate"}
    assert len(estimate_years) <= 1
    assert all(r["source"] == "imf-weo" for r in rows if r["basis"] == "estimate")
    for key in ("military_usd", "military_pct_gdp"):
        assert len({r["year"] for r in rows if r["indicator"] == key}) <= 10
    assert set(seed["editions"]) == {r["source"] for r in rows}
    population = {r["iso3"] for r in rows if r["indicator"] == "population"}
    assert len(population) == 54
    creditors = json.loads(indicators.CREDITORS_SEED.read_text(encoding="utf-8"))
    codes = {r[3] for r in creditors["creditors"]["rows"]}
    assert codes <= set(creditors["creditor_names"])
    assert all(r[4] > 0 for r in creditors["creditors"]["rows"])
