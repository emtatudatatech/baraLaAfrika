from __future__ import annotations

import datetime as dt
import io
import json
from pathlib import Path
from typing import Any

import openpyxl
import pytest

from pipelines.africa_pipelines import (
    gold_citations,
    gold_common,
    gold_presence,
    gold_price,
    gold_production,
    gold_report,
    gold_reserves,
    gold_trade,
)
from pipelines.africa_pipelines.gold_common import GoldError, GoldValidationError
from pipelines.africa_pipelines.http import FetchError
from pipelines.africa_pipelines.settings import ROOT, troy_oz_per_tonne

NAMES = gold_production.name_index()


def workbook(*sheets: tuple[str, list[list[Any]]]) -> bytes:
    book = openpyxl.Workbook()
    book.remove(book.active)  # type: ignore[arg-type]
    for title, rows in sheets:
        sheet = book.create_sheet(title)
        for row in rows:
            sheet.append(row)
    buffer = io.BytesIO()
    book.save(buffer)
    return buffer.getvalue()


def chapter(iso3: str = "GHA", edition: str = "2022", year: int = 2022) -> gold_production.Chapter:
    return gold_production.Chapter(
        iso3, edition, year, "test.xlsx", "https://example.test/x.xlsx", title="Test"
    )


HEADER = [
    "Commodity2",
    None,
    None,
    None,
    2018,
    None,
    2019,
    None,
    2020,
    None,
    2021,
    None,
    2022,
    None,
]


# ── Constants and seed files ─────────────────────────────────────────────────


def test_the_tonne_constant_has_one_source() -> None:
    constants = json.loads(ROOT.joinpath("config/constants.json").read_text())
    assert troy_oz_per_tonne() == constants["TROY_OZ_PER_TONNE"] == 32150.7466
    assert gold_common.tonnes_from_troy_oz(32150.7466) == 1.0
    sql = ROOT.joinpath("db/migrations/0007_dhahabu.sql").read_text()
    assert "SELECT 32150.7466::numeric" in sql


def test_compact_seed_files_round_trip(tmp_path: Path) -> None:
    payload: dict[str, Any] = {
        "$generated": {"by": "x"},
        "items": [{"a": 1}],
        "rows": gold_common.table(["a", "b"], [[1, "x"], [2, None]]),
        "empty": gold_common.table(["a"], []),
    }
    path = tmp_path / "seed.json"
    path.write_text(gold_common._render(payload, 0) + "\n")
    assert json.loads(path.read_text()) == payload
    assert '    [1, "x"],' in path.read_text()  # one row per line
    assert gold_common.records(payload["rows"]) == [{"a": 1, "b": "x"}, {"a": 2, "b": None}]


# ── Price ────────────────────────────────────────────────────────────────────


def pink_sheet(rows: list[list[Any]]) -> bytes:
    return workbook(
        (
            "Monthly Prices",
            [
                ["World Bank Commodity Price Data (The Pink Sheet)"],
                ["Updated on October 02, 2026"],
                [None],
                [None],
                [None, "Copper", "Gold"],
                [None, "($/mt)", "($/troy oz)"],
                *rows,
            ],
        ),
        ("Description", [["Gold, spot average of daily rates, from June 2025"]]),
    )


def test_pink_sheet_parsing_reads_the_gold_column_and_update_date() -> None:
    body = pink_sheet([["2026M08", 9000, 4411], ["2026M09", 9100, 4319], ["note", None, None]])
    sheet = gold_price.parse_pink_sheet(
        body, sheet="Monthly Prices", column="Gold", unit="($/troy oz)"
    )
    assert sheet.prices == {dt.date(2026, 8, 1): 4411.0, dt.date(2026, 9, 1): 4319.0}
    assert sheet.updated == dt.date(2026, 10, 2)
    assert sheet.description == "Gold, spot average of daily rates, from June 2025"


def test_pink_sheet_parsing_rejects_a_changed_unit() -> None:
    with pytest.raises(GoldError, match="unit"):
        gold_price.parse_pink_sheet(
            pink_sheet([["2026M08", 1, 2]]), sheet="Monthly Prices", column="Gold", unit="($/kg)"
        )


def test_price_gaps_are_reported_and_cross_checks_flag_large_differences() -> None:
    prices = {dt.date(2026, 1, 1): 100.0, dt.date(2026, 3, 1): 110.0}
    assert gold_price.gaps(prices) == [dt.date(2026, 2, 1)]
    warnings = gold_price.cross_check(
        prices, {dt.date(2026, 1, 1): 101.0, dt.date(2026, 3, 1): 120.0}, 2.0
    )
    assert len(warnings) == 1 and warnings[0].startswith("2026-03")


def test_monthly_file_link_is_read_from_the_page() -> None:
    page = '<a href="https://thedocs.worldbank.org/en/doc/abc/related/CMO-Historical-Data-Monthly.xlsx">x</a>'
    assert gold_price.monthly_file_url(page, "CMO-Historical-Data-Monthly.xlsx").endswith(
        "/abc/related/CMO-Historical-Data-Monthly.xlsx"
    )
    with pytest.raises(GoldError):
        gold_price.monthly_file_url("<p>no link</p>", "CMO-Historical-Data-Monthly.xlsx")


# ── IMF ──────────────────────────────────────────────────────────────────────


def imf_payload(series: dict[tuple[str, str, str, str], dict[str, float | None]]) -> dict[str, Any]:
    dims: list[list[str]] = [[], [], [], []]
    periods = sorted({p for values in series.values() for p in values})
    data: dict[str, Any] = {}
    for key, values in series.items():
        index = []
        for d, value in enumerate(key):
            if value not in dims[d]:
                dims[d].append(value)
            index.append(str(dims[d].index(value)))
        data[":".join(index)] = {
            "observations": {
                str(periods.index(p)): [None if v is None else str(v)] for p, v in values.items()
            }
        }
    names = ["COUNTRY", "INDICATOR", "UNIT", "FREQUENCY"]
    return {
        "data": {
            "dataSets": [{"series": data}],
            "structures": [
                {
                    "dimensions": {
                        "series": [
                            {"id": n, "values": [{"id": v} for v in dims[i]]}
                            for i, n in enumerate(names)
                        ],
                        "observation": [
                            {"id": "TIME_PERIOD", "values": [{"value": p} for p in periods]}
                        ],
                    }
                }
            ],
        }
    }


def test_imf_holdings_convert_ounces_to_tonnes_and_share_in_one_currency() -> None:
    payload = imf_payload(
        {
            ("GHA", "RGV_REVS", "FTO", "M"): {"2026-M07": 790264.206, "2026-M08": None},
            ("GHA", "RGOLDMV_REVS", "XDR", "M"): {"2026-M07": 2_000_000_000.0},
            ("GHA", "TRGMV_REVS", "XDR", "M"): {"2026-M07": 8_000_000_000.0},
            ("GHA", "TRGMV_REVS", "USD", "M"): {"2026-M07": 11_000_000_000.0},
        }
    )
    holdings = gold_reserves.parse_holdings(payload)
    assert len(holdings) == 1  # the empty August observation is no data, not zero
    holding = holdings[0]
    assert holding.month == dt.date(2026, 7, 1)
    assert round(holding.tonnes, 2) == 24.58
    assert holding.share_pct() == 25.0


def test_holdings_without_a_price_stop_the_run() -> None:
    holding = gold_reserves.Holding("GHA", dt.date(2026, 7, 1), 1000.0, None, None)
    with pytest.raises(GoldValidationError, match="2026-07"):
        gold_reserves.check_prices([holding], {dt.date(2026, 6, 1): 4000.0})


def test_reporting_status_marks_late_stale_pooled_and_missing_countries() -> None:
    def months(iso3: str, last: dt.date) -> list[gold_reserves.Holding]:
        return [
            gold_reserves.Holding(iso3, dt.date(last.year, m, 1), 1.0, None, None)
            for m in range(1, last.month + 1)
        ]

    holdings = (
        months("GHA", dt.date(2026, 9, 1))
        + months("KEN", dt.date(2026, 3, 1))
        + months("TZA", dt.date(2020, 12, 1))
    )
    statuses, latest = gold_reserves.reporting_status(holdings, dt.date(2026, 10, 18))
    by = {s.iso3: s for s in statuses}
    assert latest == dt.date(2026, 9, 1)
    assert by["GHA"].status == "current"
    assert by["KEN"].status == "late" and by["KEN"].months_behind == 6
    assert by["TZA"].status == "stale"
    assert by["MLI"].status == "pooled"
    assert by["AGO"].status == "none"


# ── USGS Mineral Commodity Summaries ─────────────────────────────────────────

MCS_TEXT = """World Mine Production and Reserves: Reserves for Ghana were revised.
Mine production
Reserves10
2024
2025e
United States
163
160
3,000
Australia
284
280
1113,000
Ghana
149
150
1,000
Mali
e67
70
800
Burkina Faso
57
60
NA
Other countries
1,020
1,000
 11,000
World total (rounded)
3,280
"""


def test_mcs_world_table_parsing() -> None:
    edition = gold_production.parse_mcs(MCS_TEXT, 2026, NAMES)
    assert edition.years == (2024, 2025)
    ghana = edition.production["GHA"]
    assert ghana[0].tonnes == 149 and not ghana[0].estimate
    assert ghana[1].tonnes == 150 and ghana[1].estimate  # the second year is always estimated
    assert edition.production["MLI"][0].estimate  # "e67"
    assert edition.reserves == {"GHA": 1000.0, "MLI": 800.0}  # NA is no data, not zero
    assert edition.other_countries == (1020.0, 1000.0)
    assert "AUS" not in edition.production  # non-African rows (with footnote markers) are skipped


def test_mcs_values_with_a_glued_footnote_are_refused_for_african_rows() -> None:
    with pytest.raises(GoldError, match="footnote"):
        gold_production.parse_mcs(
            MCS_TEXT.replace("Ghana\n149\n150\n1,000", "Ghana\n149\n150\n1013,000"), 2026, NAMES
        )


# ── USGS Minerals Yearbook chapters ──────────────────────────────────────────


def production_table(title: str, body: list[list[Any]], notes: list[str]) -> list[list[Any]]:
    return [
        ["TABLE 1"],
        [f"{title}: PRODUCTION OF MINERAL COMMODITIES1"],
        [None],
        ["(Metric tons, gross weight, unless otherwise specified)"],
        [None],
        HEADER,
        ["METALS"],
        *body,
        ["eEstimated.  rRevised.  -- Zero."],
        ["1Table includes data available through January 16, 2024. All data are reported."],
        *[[n] for n in notes],
    ]


def test_yearbook_artisanal_and_large_scale_rows_are_summed_with_the_split_kept() -> None:
    body: list[list[Any]] = [
        ["Aluminum:"],
        ["Gold, mine, Au content:"],
        [
            "Artisanal and small-scale producers",
            None,
            "kilograms",
            None,
            61000,
            "e",
            49000,
            "e",
            37000,
            "e",
            3048,
            None,
            20393,
            None,
        ],
        [
            "Large-scale producers",
            None,
            "do.",
            None,
            87336,
            None,
            92982,
            None,
            88552,
            None,
            84601,
            None,
            95786,
            None,
        ],
        [
            "Lead, refinery, secondary",
            None,
            None,
            None,
            1000,
            "e",
            900,
            None,
            900,
            None,
            "--",
            None,
            "--",
            None,
        ],
    ]
    c = chapter()
    gold_production.parse_chapter(
        c, workbook(("Table 1", production_table("GHANA", body, []))), NAMES
    )
    assert c.covered and c.gold_listed
    assert c.figures[2022].tonnes == pytest.approx(116.179)
    assert not c.figures[2022].estimate and c.figures[2018].estimate
    assert c.asm_split[2022] == pytest.approx((20.393, 116.179))
    assert c.data_through == dt.date(2024, 1, 16)


def test_yearbook_gold_heading_with_a_mine_row_estimates_and_footnotes() -> None:
    body: list[list[Any]] = [
        ["Gold:"],
        [
            "Mine, Au contente, 3",
            None,
            "kilograms",
            None,
            "--",
            None,
            1500,
            "r",
            "NA",
            None,
            2400,
            None,
            2500,
            None,
        ],
        ["Refinery", None, "do.", None, 9, None, 9, None, 9, None, 9, None, 9, None],
        ["Barite4", None, None, None, 1, None, 1, None, 1, None, 1, None, 1, None],
    ]
    notes = ["3Does not include artisanal gold production.", "4Barite was also produced."]
    c = chapter("UGA")
    gold_production.parse_chapter(
        c, workbook(("Table 1", production_table("UGANDA", body, notes))), NAMES
    )
    assert c.figures[2018].tonnes == 0.0  # "--" is a reported zero
    assert 2020 not in c.figures  # NA is no data, never zero
    assert c.figures[2019].tonnes == 1.5 and c.figures[2019].estimate  # "contente": estimated
    assert c.figures[2022].notes == ("Does not include artisanal gold production.",)
    assert c.figures[2021].tonnes == 2.4  # the refinery row is not mine production


def test_yearbook_may_have_been_produced_notes_must_list_gold_itself() -> None:
    assert gold_production.mentions_gold(
        "In addition to the commodities listed, clay, gold, and salt may have been produced, but "
        "available information was inadequate to make reliable estimates of output."
    )
    assert not gold_production.mentions_gold(
        "In addition to the commodities listed, diamond and silver as a byproduct of gold mining "
        "may have been produced, but available information was inadequate."
    )
    assert gold_production.mentions_gold(
        "In addition to the commodities listed, crude construction materials (for example, clay, "
        "sand and gravel, and stone), gold, and lime may have been produced, but information..."
    )


def test_yearbook_multi_country_tables_use_only_the_countrys_section() -> None:
    rows: list[list[Any]] = [
        ["TABLE 1"],
        ["MAURITIUS, REUNION, AND SEYCHELLES: PRODUCTION OF MINERAL COMMODITIES1"],
        [None],
        ["(Metric tons, gross weight, unless otherwise specified)"],
        [None],
        HEADER,
        ["MAURITIUS"],
        ["Salt", None, None, None, 1, None, 1, None, 1, None, 1, None, 1, None],
        ["REUNION"],
        [
            "Gold, mine, Au content",
            None,
            "kilograms",
            None,
            5,
            None,
            5,
            None,
            5,
            None,
            5,
            None,
            5,
            None,
        ],
        ["SEYCHELLES"],
        ["Granite", None, None, None, 1, None, 1, None, 1, None, 1, None, 1, None],
        ["eEstimated."],
    ]
    mauritius = chapter("MUS")
    gold_production.parse_chapter(mauritius, workbook(("Table 1", rows)), NAMES)
    assert mauritius.covered and not mauritius.figures and not mauritius.gold_listed
    comoros = chapter("COM")
    gold_production.parse_chapter(comoros, workbook(("Table 1", rows)), NAMES)
    assert not comoros.covered


def test_yearbook_figures_attributed_to_the_world_gold_council_are_left_out() -> None:
    body: list[list[Any]] = [
        ["Gold:"],
        [
            "Mine, Au content3",
            None,
            "kilograms",
            None,
            8800,
            "r",
            76700,
            "r",
            78000,
            "r",
            81800,
            None,
            85100,
            None,
        ],
    ]
    c = chapter("SDN")
    gold_production.parse_chapter(
        c,
        workbook(("Table 1", production_table("SUDAN", body, ["3Source: World Gold Council"]))),
        NAMES,
    )
    assert c.figures == {} and len(c.excluded) == 5


def test_chapter_links_prefer_final_releases_and_skip_old_or_unrelated_files() -> None:
    page = " ".join(
        f'<a href="https://x.test/{name}">'
        for name in [
            "myb3-2022-Ghana-adv.xlsx",
            "myb3-2022-ghana.xlsx",
            "myb3-2020-21-Ghana-advrel.xlsx",
            "myb3-2014-gh.xlsx",
            "enduse_imports.xlsx",
            "myb3-2019-ghana.xls",
        ]
    )
    links = gold_production.chapter_links(page, 2016)
    assert sorted(links) == ["2020-21", "2022"]
    assert links["2022"][0] == "myb3-2022-ghana.xlsx"
    assert gold_production.edition_of("myb3-2020-21-Mali-advrel.xlsx") == ("2020-21", 2021)


def test_preferred_figure_order_matches_the_view() -> None:
    rows = [
        ["GHA", 2022, None, "included_in_other", "usgs-mcs-2026-gold", None],
        ["GHA", 2022, 88.0, "estimate", "usgs-mcs-2024-gold", None],
        ["GHA", 2022, 116.179, "reported", "usgs-myb-2022-gha", None],
        ["GHA", 2023, 126.0, "reported", "usgs-mcs-2025-gold", None],
        ["GHA", 2023, 90.0, "reported", "usgs-mcs-2024-gold", None],
        ["MLI", 2025, None, "included_in_other", "usgs-mcs-2026-gold", None],
    ]
    priority = [
        "usgs-mcs-2026-gold",
        "usgs-mcs-2025-gold",
        "usgs-mcs-2024-gold",
        "usgs-myb-2022-gha",
    ]
    best = gold_production.preferred(rows, priority)
    assert best[("GHA", 2022)][2] == 116.179  # reported beats an estimate from a newer edition
    assert best[("GHA", 2023)][2] == 126.0  # then the newer edition
    assert best[("MLI", 2025)][3] == "included_in_other"  # only when nothing else exists


# ── Presence tiers ───────────────────────────────────────────────────────────

TITLES = {"mcs": "MCS", "myb-22": "MYB 2022", "myb-19": "MYB 2019"}


def evidence(**overrides: Any) -> dict[str, Any]:
    base = {
        "iso3": "XXX",
        "source": "myb-22",
        "edition": "2022",
        "edition_year": 2022,
        "covered": True,
        "data_through": None,
        "gold_listed": False,
        "latest_year": None,
        "latest_tonnes": None,
        "may_have_been_produced": None,
        "gold_notes": [],
        "operations": [],
        "asm_split": {},
        "excludes_artisanal": False,
        "excluded_figures": [],
    }
    return {**base, **overrides}


TODAY = dt.date(2026, 10, 18)


@pytest.mark.parametrize(
    ("tonnes", "tier"), [(20.0, "major_producer"), (19.9, "producer"), (0.04, "producer")]
)
def test_presence_tiers_from_the_latest_figure(tonnes: float, tier: str) -> None:
    best = {("XXX", 2022): ["XXX", 2022, tonnes, "reported", "myb-22", None]}
    presence = gold_presence.classify("XXX", best, [evidence()], TITLES, TODAY)
    assert presence.tier == tier
    assert presence.source == "myb-22" and presence.as_of_year == 2022


def test_occurrences_known_from_a_may_have_been_produced_note() -> None:
    presence = gold_presence.classify(
        "XXX",
        {},
        [evidence(may_have_been_produced="... gold ... may have been produced")],
        TITLES,
        TODAY,
    )
    assert presence.tier == "occurrences_known" and presence.source == "myb-22"


def test_a_figure_newer_chapters_no_longer_report_is_past_production() -> None:
    best = {("XXX", 2016): ["XXX", 2016, 0.014, "estimate", "myb-19", None]}
    presence = gold_presence.classify("XXX", best, [evidence()], TITLES, TODAY)
    assert presence.tier == "occurrences_known"
    assert "Past mine production" in presence.basis


def test_a_reported_zero_is_not_production() -> None:
    best = {
        ("XXX", 2016): ["XXX", 2016, 0.5, "reported", "myb-22", None],
        ("XXX", 2022): ["XXX", 2022, 0.0, "reported", "myb-22", None],
    }
    presence = gold_presence.classify("XXX", best, [evidence()], TITLES, TODAY)
    assert presence.tier == "occurrences_known"
    assert "zero in 2022" in presence.basis


def test_none_identified_and_unknown() -> None:
    assert gold_presence.classify("XXX", {}, [evidence()], TITLES, TODAY).tier == "none_identified"
    unknown = gold_presence.classify("XXX", {}, [evidence(covered=False)], TITLES, TODAY)
    assert unknown.tier == "unknown" and unknown.source is None


def test_transit_figures_are_flagged_for_review() -> None:
    note = (
        "Data reported by the Government of Togo as exports predominately include gold "
        "transiting Togo."
    )
    best = {("XXX", 2021): ["XXX", 2021, 20.0, "reported", "myb-22", None]}
    presence = gold_presence.classify("XXX", best, [evidence(gold_notes=[note])], TITLES, TODAY)
    assert presence.tier == "major_producer"
    assert presence.needs_review and "transiting" in presence.basis


def test_mining_context_from_the_artisanal_split_and_operators() -> None:
    presence = gold_presence.Presence("XXX", "producer", "b", "high", 2022, "myb-22")
    gold_presence.mining_context(
        presence,
        [
            evidence(
                asm_split={"2022": [20.393, 116.179]},
                operations=["Golden Star Resources Ltd. Wassa Mine"],
            )
        ],
    )
    assert presence.asm_present and presence.commercial_mining
    assert presence.asm_share_pct == 17.6


# ── UN Comtrade ──────────────────────────────────────────────────────────────


def comtrade_row(**fields: Any) -> dict[str, Any]:
    base = {
        "reporterCode": 288,
        "partnerCode": 0,
        "flowCode": "X",
        "period": "2023",
        "cmdCode": "7108",
        "primaryValue": 0.0,
        "netWgt": None,
        "partnerDesc": "World",
        "partnerISO": "W00",
        "reporterDesc": "Ghana",
        "reporterISO": "GHA",
    }
    return {**base, **fields}


def test_reported_trade_subtracts_monetary_gold_and_ranks_partners() -> None:
    rows = [
        comtrade_row(primaryValue=1000.0, netWgt=None),
        comtrade_row(cmdCode="710820", primaryValue=100.0, netWgt=None),
        comtrade_row(
            partnerCode=757,
            partnerDesc="Switzerland",
            partnerISO="CHE",
            primaryValue=600.0,
            netWgt=10.0,
        ),
        comtrade_row(
            partnerCode=784,
            partnerDesc="United Arab Emirates",
            partnerISO="ARE",
            primaryValue=300.0,
            netWgt=5.0,
        ),
        comtrade_row(
            partnerCode=899,
            partnerDesc="Areas, nes",
            partnerISO="_X ",
            primaryValue=0.0,
            netWgt=0.0,
        ),
    ]
    summary = gold_trade.summarise_reported("GHA", 288, rows)
    (total,) = summary.trade
    assert total[5] == 900.0  # 7108 minus 7108.20
    assert total[4] == 15.0 and "summed from the partner rows" in total[9]
    assert [p[5] for p in summary.partners] == ["Switzerland", "United Arab Emirates"]
    assert summary.partners[0][6] == "CHE"


def test_mirror_trade_sums_partners_and_needs_every_weight_for_a_total() -> None:
    rows = [
        comtrade_row(
            reporterCode=757,
            reporterDesc="Switzerland",
            reporterISO="CHE",
            partnerCode=288,
            flowCode="M",
            primaryValue=500.0,
            netWgt=8.0,
        ),
        comtrade_row(
            reporterCode=699,
            reporterDesc="India",
            reporterISO="IND",
            partnerCode=288,
            flowCode="M",
            primaryValue=200.0,
            netWgt=None,
        ),
        comtrade_row(
            reporterCode=97,
            reporterDesc="European Union",
            reporterISO="EUR",
            partnerCode=288,
            flowCode="M",
            primaryValue=999.0,
            netWgt=1.0,
        ),
    ]
    summary = gold_trade.summarise_mirror("GHA", 288, rows)
    (mirror,) = summary.trade
    assert mirror[2] == "export" and mirror[6] == "mirror"
    assert mirror[5] == 700.0 and mirror[7] == 2  # the EU aggregate is excluded
    assert mirror[4] is None and "so no total weight" in mirror[9]


def test_the_call_budget_stops_new_calls_but_not_cached_ones(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(gold_trade, "CACHE_DIR", tmp_path)
    (tmp_path / "cached.json").write_text(json.dumps({"data": [comtrade_row()], "error": ""}))
    caller = gold_trade.Caller("key", refresh=False, budget=0)
    assert len(caller.get({}, "cached")) == 1
    with pytest.raises(gold_trade.BudgetExhaustedError):
        caller.get({}, "not-cached")
    assert caller.skipped == ["not-cached"]


def test_comtrade_errors_are_not_cached(tmp_path: Path) -> None:
    path = tmp_path / "x.json"
    path.write_text("{}")
    with pytest.raises(GoldError, match="quota"):
        gold_trade.parse_response(json.dumps({"error": "quota exceeded"}).encode(), "x", path)
    assert not path.exists()


# ── Validation ───────────────────────────────────────────────────────────────


def minimal_seeds() -> dict[str, Any]:
    iso3s = [c.iso3 for c in gold_common.countries()]
    prices = [[f"2024-{m:02d}-01", 2000.0, "wb"] for m in range(1, 13)]
    presence_columns = [
        "iso3",
        "presence_tier",
        "presence_basis",
        "presence_confidence",
        "presence_as_of_year",
        "presence_source",
        "commercial_mining",
        "asm_present",
        "asm_share_pct_estimate",
        "asm_source",
        "needs_review",
        "review_notes",
        "override",
    ]
    return {
        "price": {
            "sources": [{"source_key": "wb"}],
            "prices": gold_common.table(["month", "usd_per_troy_oz", "source"], prices),
        },
        "production": {
            "sources": [{"source_key": "mcs"}],
            "production": gold_common.table(
                ["iso3", "year", "tonnes", "basis", "source", "notes"],
                [["GHA", 2024, 149.0, "reported", "mcs", None]],
            ),
            "inground_reserves": gold_common.table(
                ["iso3", "year", "tonnes_contained", "definition", "source"], []
            ),
        },
        "reserves": {
            "sources": [{"source_key": "imf"}],
            "reserves": gold_common.table(
                [
                    "iso3",
                    "as_of",
                    "tonnes",
                    "value_usd",
                    "pct_of_total_reserves",
                    "valuation",
                    "source",
                ],
                [
                    [
                        "GHA",
                        "2024-06-30",
                        10.0,
                        round(10 * troy_oz_per_tonne() * 2000.0, 2),
                        20.0,
                        "computed",
                        "imf",
                    ]
                ],
            ),
        },
        "trade": {
            "sources": [],
            "trade": gold_common.table(["iso3", "year", "value_usd", "source"], []),
            "partners": gold_common.table(
                ["iso3", "year", "flow", "basis", "rank", "value_usd"], []
            ),
            "total_exports": gold_common.table(["iso3", "year", "value_usd"], []),
        },
        "presence": {
            "sources": [],
            "presence": gold_common.table(
                presence_columns,
                [
                    [
                        i,
                        "major_producer" if i == "GHA" else "unknown",
                        "b",
                        "low",
                        None,
                        "mcs" if i == "GHA" else None,
                        None,
                        None,
                        None,
                        None,
                        False,
                        None,
                        False,
                    ]
                    for i in iso3s
                ],
            ),
        },
        "profiles": {
            "sources": [],
            "profiles": gold_common.table(["iso3", "summary"], [[i, "s"] for i in iso3s]),
            "notes": gold_common.table(["iso3", "sort_order", "note", "source"], []),
        },
        "mines": {},
    }


def test_validation_passes_a_consistent_set() -> None:
    assert gold_report.validate(minimal_seeds()) == []


def test_validation_fails_when_a_production_year_has_no_price() -> None:
    seeds = minimal_seeds()
    seeds["production"]["production"]["rows"].append(["GHA", 2023, 120.0, "reported", "mcs", None])
    assert any("2023" in p and "prices" in p for p in gold_report.validate(seeds))


def test_validation_keeps_null_zero_and_included_in_other_apart() -> None:
    seeds = minimal_seeds()
    seeds["production"]["production"]["rows"] += [
        ["MLI", 2024, 0.0, "included_in_other", "mcs", None],
        ["BFA", 2024, -1.0, "reported", "mcs", None],
    ]
    problems = gold_report.validate(seeds)
    assert any("MLI" in p and "included_in_other" in p for p in problems)
    assert any("BFA" in p and "negative" in p for p in problems)


def test_validation_requires_production_evidence_for_producers_and_known_sources() -> None:
    seeds = minimal_seeds()
    seeds["presence"]["presence"]["rows"][1][1] = "producer"
    seeds["presence"]["presence"]["rows"][1][5] = "ghost"
    problems = gold_report.validate(seeds)
    assert any("without production evidence" in p for p in problems)
    assert any("'ghost'" in p for p in problems)


def test_validation_checks_holdings_use_their_own_months_price() -> None:
    seeds = minimal_seeds()
    seeds["reserves"]["reserves"]["rows"][0][3] *= 1.05
    assert any("that month's price" in p for p in gold_report.validate(seeds))


def test_none_identified_summaries_use_the_agreed_wording() -> None:
    seeds = minimal_seeds()
    seeds["presence"]["presence"]["rows"][1][1] = "none_identified"
    assert any("must read" in p for p in gold_report.validate(seeds))


def test_year_ranges() -> None:
    assert (
        gold_report.year_ranges({2015, 2016, 2017, 2019, 2021, 2022})
        == "2015–2017, 2019, 2021–2022"
    )
    assert gold_report.year_ranges(set()) == "—"


# ── Curated citations ────────────────────────────────────────────────────────


def fake_sources(monkeypatch: pytest.MonkeyPatch, pages: dict[str, bytes | None]) -> None:
    def fetch(url: str, cache_path: Path, **_: Any) -> bytes:
        body = pages.get(url)
        if body is None:
            raise FetchError(f"{url}: HTTP 403")
        return body

    monkeypatch.setattr(gold_citations, "fetch_bytes", fetch)


def test_quotes_are_found_whatever_the_spacing_quotes_and_hyphenation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    page = (
        b"<html><script>var x;</script><p>Milxo is a tiny mining settlement in a remote "
        b"and contested region of north-\neastern Somalia &#8217;s gold</p></html>"
    )
    fake_sources(monkeypatch, {"https://a.test": page})
    checker = gold_citations.Checker()
    quote = "Milxo is a tiny mining settlement in a remote and contested region of north-eastern"
    assert checker.check("https://a.test", quote).found is True
    assert checker.check("https://a.test", "Milxo is a large settlement").found is False
    assert gold_citations.source_key("https://a.test") == gold_citations.source_key(
        "https://a.test"
    )


def test_overrides_need_their_quote_in_the_source(monkeypatch: pytest.MonkeyPatch) -> None:
    pages: dict[str, bytes | None] = {
        "https://ok.test": b"<p>Gold anomalies exist here.</p>",
        "https://down.test": None,
    }
    fake_sources(monkeypatch, pages)
    entry: dict[str, Any] = {
        "iso3": "GNB",
        "presence_tier": "occurrences_known",
        "presence_basis": "b",
        "presence_confidence": "low",
        "source": {"title": "T", "url": "https://ok.test"},
        "quote": "Gold anomalies exist",
    }
    checker = gold_citations.Checker()

    def fresh() -> gold_presence.Presence:
        return gold_presence.Presence("GNB", "unknown", "b", "low", None, None, needs_review=True)

    problems: list[str] = []
    cited = fresh()
    row = gold_presence.apply_override(cited, entry, checker, problems)
    assert row is not None and cited.source == row["source_key"]
    assert problems == [] and not cited.needs_review and cited.tier == "occurrences_known"

    wrong = {**entry, "quote": "Gold was mined here"}
    gold_presence.apply_override(fresh(), wrong, checker, problems)
    assert problems and "quote is not in" in problems[0]

    unreachable = fresh()
    later: list[str] = []
    down = {**entry, "source": {"title": "T", "url": "https://down.test"}}
    gold_presence.apply_override(unreachable, down, checker, later)
    assert later == [] and unreachable.needs_review
    assert "could not be re-checked" in unreachable.review_notes[0]

    uncited = fresh()
    assert gold_presence.apply_override(uncited, {**entry, "quote": None}, checker, later) is None
    assert uncited.source is None and uncited.needs_review


def test_a_refused_comtrade_key_says_what_to_fix(monkeypatch: pytest.MonkeyPatch) -> None:
    def refused(url: str, *_args: Any, **_kwargs: Any) -> bytes:
        raise FetchError(f"{url}: HTTP 401 (Access denied)", status=401)

    monkeypatch.setattr(gold_trade, "fetch_bytes", refused)
    caller = gold_trade.Caller("not-a-real-key", refresh=True, budget=5)
    with pytest.raises(GoldError, match="refused COMTRADE_API_KEY") as error:
        caller.get({"reporterCode": "404"}, "test-refused")
    # The key itself is never repeated in the message.
    assert "not-a-real-key" not in str(error.value)
