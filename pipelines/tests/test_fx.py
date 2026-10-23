from __future__ import annotations

import datetime as dt
import json

import pytest

from pipelines.africa_pipelines import fx
from pipelines.africa_pipelines.fx import FxValidationError, Monthly


def months(start: str, values: list[float]) -> dict[dt.date, float]:
    year, month = (int(x) for x in start.split("-"))
    out = {}
    for value in values:
        out[dt.date(year, month, 1)] = value
        month += 1
        if month == 13:
            year, month = year + 1, 1
    return out


def test_a_change_given_in_the_old_unit_is_converted() -> None:
    # Zambia rebased 1,000 to 1 on 1 January 2013; this series still has old kwacha before it.
    series = {"USD avg": months("2012-11", [5100.0, 5210.0, 5.29, 5.30])}
    out, converted, checks = fx.apply_changes("ZMB", series)
    assert out["USD avg"][dt.date(2012, 12, 1)] == pytest.approx(5.21)
    assert converted == {dt.date(2012, 11, 1), dt.date(2012, 12, 1)}
    assert checks[0].outcome == "converted"


def test_a_change_the_imf_already_applied_is_left_alone() -> None:
    series = {"USD avg": months("2012-11", [5.1, 5.21, 5.29, 5.30])}
    out, converted, checks = fx.apply_changes("ZMB", series)
    assert out == series and converted == set()
    assert checks[0].outcome == "already_on_new_unit"


def test_a_change_during_a_month_shows_in_that_month_or_the_next() -> None:
    # Zimbabwe: ZiG from 5 April 2024 at 2,498.7242 dollars per ZiG; April is already in ZiG.
    series = {"USD avg": months("2024-02", [12403.73, 18288.37, 13.397, 13.409])}
    out, _, checks = fx.apply_changes("ZWE", series)
    assert checks[0].outcome == "converted"
    assert out["USD avg"][dt.date(2024, 3, 1)] == pytest.approx(18288.37 / 2498.7242)
    assert checks[0].before == pytest.approx(18288.37)  # the report shows the IMF's own value


def test_a_change_outside_the_series_and_an_ambiguous_step() -> None:
    _, _, checks = fx.apply_changes("MRT", {"USD avg": months("2022-06", [36.0, 36.5])})
    assert checks[0].outcome == "outside_series"
    with pytest.raises(FxValidationError, match="matching neither"):
        fx.apply_changes("ZMB", {"USD avg": months("2012-12", [50.0, 5.3])})


def test_pegs_are_checked_on_the_anchor_rate() -> None:
    euro = {"EUR avg": months("2020-01", [655.957, 655.957, 640.0])}
    senegal = fx.check_pegs("SEN", euro, {})
    assert senegal is not None
    assert senegal[:2] == (2, 3)
    assert senegal[2] == pytest.approx(0.0243, abs=1e-3)
    rand = months("2020-01", [15.0, 16.0])
    namibia = fx.check_pegs("NAM", {"USD avg": months("2020-01", [15.0, 16.1])}, rand)
    assert namibia is not None and namibia[:2] == (2, 2)
    assert fx.check_pegs("KEN", {"USD avg": rand}, rand) is None  # no peg


def test_daily_rates_are_derived_at_the_official_parities() -> None:
    day = dt.date(2026, 10, 21)
    daily = {d.currency: d for d in fx.derive_daily({"USD": {day: 1.08}, "ZAR": {day: 19.44}})}
    assert daily["ZAR"].per_usd == pytest.approx(18.0) and daily["ZAR"].basis == "ecb"
    assert daily["XOF"].per_usd == pytest.approx(655.957 / 1.08, rel=1e-6)
    assert daily["CVE"].per_usd == pytest.approx(110.265 / 1.08, rel=1e-6)
    assert daily["NAD"].per_usd == pytest.approx(18.0)
    assert daily["DJF"].per_usd == pytest.approx(177.721)


def test_ecb_csv_is_read_per_currency() -> None:
    body = (
        b"KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE\n"
        b"EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-10-20,1.0825\n"
        b"EXR.D.ZAR.EUR.SP00.A,D,ZAR,EUR,SP00,A,2026-10-20,19.40\n"
    )
    rates = fx.parse_ecb(body)
    assert rates["USD"][dt.date(2026, 10, 20)] == 1.0825


def test_months_not_yet_ended_are_dropped() -> None:
    payload = {
        "data": {
            "structures": [
                {
                    "dimensions": {
                        "series": [
                            {"values": [{"id": "ZWE"}]},
                            {"values": [{"id": "XDC_USD"}]},
                            {"values": [{"id": "PA_RT"}]},
                            {"values": [{"id": "M"}]},
                        ],
                        "observation": [
                            {"values": [{"id": "2026-M09"}, {"id": "2026-M10"}, {"id": "2027-M03"}]}
                        ],
                    }
                }
            ],
            "dataSets": [
                {
                    "series": {
                        "0:0:0:0": {"observations": {"0": ["26.4"], "1": ["26.5"], "2": ["25.5"]}}
                    }
                }
            ],
        }
    }  # fmt: skip
    parsed = fx.parse_imf(payload, dt.date(2026, 10, 22))
    assert list(parsed["ZWE"]["USD avg"]) == [dt.date(2026, 9, 1)]


def test_large_moves_are_listed() -> None:
    rows = [
        Monthly("EGY", dt.date(2016, 10, 1), 8.88, None, False),
        Monthly("EGY", dt.date(2016, 11, 1), 15.9, None, False),
    ]
    assert [(iso3, round(change, 2)) for iso3, _, change in fx.large_moves(rows)] == [("EGY", 0.79)]


def test_committed_seeds_cover_every_state_and_never_a_future_month() -> None:
    seed = json.loads(fx.FX_SEED.read_text(encoding="utf-8"))
    status = [dict(zip(seed["status"]["columns"], r, strict=True)) for r in seed["status"]["rows"]]
    assert len(status) == 54
    generated = dt.date.fromisoformat(seed["$generated"]["generated_on"])
    monthly = seed["monthly"]["rows"]
    assert all(dt.date.fromisoformat(r[1]) < generated.replace(day=1) for r in monthly)
    assert any(r[0] == "ZWE" and r[4] for r in monthly)  # Zimbabwe's dollar months converted
    daily = json.loads(fx.FX_DAILY_SEED.read_text(encoding="utf-8"))["daily"]["rows"]
    settings = fx.reference()["daily"]
    expected = (
        set(settings["ecb_currencies"]) | set(settings["bis"]) | set(fx.usable_central_banks())
    )
    assert {r[0] for r in daily} == expected
    assert all(r[1] >= "2020-01-01" for r in daily)
    assert {r[4] for r in daily} <= {s["source_key"] for s in seed["sources"]}


def test_bis_days_without_a_rate_are_skipped() -> None:
    body = (
        b"FREQ,REF_AREA,CURRENCY,COLLECTION,TIME_PERIOD,OBS_VALUE\n"
        b"D,DZ,DZD,A,2026-10-19,NaN\n"
        b"D,DZ,DZD,A,2026-10-20,134.38\n"
        b"D,MU,MUR,A,2026-10-20,46.85\n"
        b"D,KE,KES,A,2026-10-20,129.8\n"
    )
    rows = fx.parse_bis(body)
    assert [(d.currency, d.per_usd, d.basis) for d in rows] == [
        ("DZD", 134.38, "bis"),
        ("MUR", 46.85, "bis"),
    ]


def test_central_banks_are_used_only_when_their_terms_allow(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    usable = fx.usable_central_banks()
    assert "KES" in usable  # publishes no terms
    assert "MZN" not in usable  # its terms require permission
    assert "NGN" not in usable  # its terms could not be read yet

    def fake(currency: str, year: int, *, refresh: bool, today: dt.date) -> list[dict[str, object]]:
        return [{"date": f"{year}-06-01", "base": "USD", "quote": currency, "rate": 100.0}]

    monkeypatch.setattr(fx, "fetch_central_bank", fake)
    rows = fx.central_bank_daily(refresh=False, today=dt.date(2021, 7, 1))
    kenya = [d for d in rows if d.currency == "KES"]
    assert [(d.date.year, d.basis, d.source) for d in kenya] == [
        (2020, "central_bank", "cb-cbk"),
        (2021, "central_bank", "cb-cbk"),
    ]


def test_a_row_for_another_pair_stops_the_run(monkeypatch: pytest.MonkeyPatch) -> None:
    def wrong(
        currency: str, year: int, *, refresh: bool, today: dt.date
    ) -> list[dict[str, object]]:
        return [{"date": "2020-06-01", "base": "EUR", "quote": currency, "rate": 1.0}]

    monkeypatch.setattr(fx, "fetch_central_bank", wrong)
    with pytest.raises(fx.FxError, match="a row for EUR"):
        fx.central_bank_daily(refresh=False, today=dt.date(2020, 7, 1))


def test_a_bank_that_does_not_answer_keeps_its_committed_rates(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from pipelines.africa_pipelines.http import FetchError

    def down(currency: str, year: int, *, refresh: bool, today: dt.date) -> list[dict[str, object]]:
        raise FetchError("timed out")

    kept = fx.Daily("KES", dt.date(2020, 6, 1), 107.5, "central_bank", "cb-cbk")
    monkeypatch.setattr(fx, "fetch_central_bank", down)
    monkeypatch.setattr(fx, "previous_daily", lambda: {"KES": [kept]})
    warnings: list[str] = []
    rows = fx.central_bank_daily(refresh=True, today=dt.date(2021, 7, 1), warnings=warnings)
    assert [d for d in rows if d.currency == "KES"] == [kept]
    assert any("Central Bank of Kenya did not answer" in w for w in warnings)
