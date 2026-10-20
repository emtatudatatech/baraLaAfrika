"""`python -m pipelines gold-official-reserves`: central bank gold holdings into
db/seeds/gold_reserves.json.

Source: the IMF's International Liquidity dataflow (IMF.STA/IL, the former IFS reserve series),
one targeted call for the 54 countries, cached. Per month: gold volume in fine troy ounces
(RGV_REVS), gold at market value in SDRs (RGOLDMV_REVS) and total reserves in SDRs
(TRGMV_REVS). Volume is converted to tonnes with the shared constant; the US dollar value is
computed as volume × that month's average price (valuation = computed), and the run fails if a
month has no price (never filled). Gold's share of reserves uses the IMF's own SDR values for
both parts, so it needs no conversion. Countries that report late or irregularly are listed.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
from dataclasses import dataclass, field
from typing import Any

from .gold_common import (
    GOLD_RAW,
    PRICE_SEED,
    RESERVES_SEED,
    GoldValidationError,
    SourceRecord,
    config,
    countries,
    generated,
    imf_month,
    imf_series,
    month_end,
    months_between,
    read_seed,
    records,
    table,
    tonnes_from_troy_oz,
    write_seed,
)
from .http import fetch_bytes

IMF_IL = SourceRecord(
    "imf-il",
    "IMF International Liquidity (IL): official reserve assets, gold and total reserves",
    "https://data.imf.org/",
)


@dataclass(frozen=True)
class Holding:
    iso3: str
    month: dt.date
    troy_oz: float
    gold_xdr: float | None
    total_xdr: float | None

    @property
    def tonnes(self) -> float:
        return tonnes_from_troy_oz(self.troy_oz)

    def share_pct(self) -> float | None:
        if self.gold_xdr is None or not self.total_xdr:
            return None
        return self.gold_xdr / self.total_xdr * 100


@dataclass(frozen=True)
class Reporting:
    iso3: str
    status: str  # current | late | stale | pooled | none
    first: dt.date | None
    last: dt.date | None
    months_behind: int | None
    gaps_in_window: int
    note: str


@dataclass
class ReservesResult:
    holdings: list[Holding]
    reporting: list[Reporting]
    latest: dt.date
    warnings: list[str] = field(default_factory=list)


def parse_holdings(payload: dict[str, Any]) -> list[Holding]:
    settings = config()["official_reserves"]
    volume_key = tuple(settings["volume"])
    gold_key = tuple(settings["gold_value"])
    total_key = tuple(settings["total_reserves"])
    by_country: dict[str, dict[tuple[str, str], dict[str, float]]] = {}
    for (country, indicator, unit, frequency), values in imf_series(payload).items():
        if frequency == "M":
            by_country.setdefault(country, {})[(indicator, unit)] = values
    holdings = []
    for iso3, series in sorted(by_country.items()):
        volume = series.get(volume_key, {})
        gold = series.get(gold_key, {})
        total = series.get(total_key, {})
        for period, troy_oz in volume.items():
            if troy_oz < 0:
                raise GoldValidationError([f"{iso3} {period}: negative gold volume {troy_oz}"])
            holdings.append(
                Holding(iso3, imf_month(period), troy_oz, gold.get(period), total.get(period))
            )
    return sorted(holdings, key=lambda h: (h.iso3, h.month))


def reporting_status(holdings: list[Holding], today: dt.date) -> tuple[list[Reporting], dt.date]:
    settings = config()["official_reserves"]
    pooled = set(settings["pooled_reserves"]["members"])
    late_after = int(settings["late_after_months"])
    window = int(settings["irregular_window_months"])
    by_country: dict[str, list[dt.date]] = {}
    for holding in holdings:
        by_country.setdefault(holding.iso3, []).append(holding.month)
    latest = max(h.month for h in holdings) if holdings else today.replace(day=1)
    statuses = []
    for country in countries():
        months = sorted(by_country.get(country.iso3, []))
        if not months:
            if country.iso3 in pooled:
                note = settings["pooled_reserves"]["note"]
                statuses.append(Reporting(country.iso3, "pooled", None, None, None, 0, note))
            else:
                note = "The IMF publishes no gold holding for this country."
                statuses.append(Reporting(country.iso3, "none", None, None, None, 0, note))
            continue
        behind = months_between(months[-1], latest)
        window_start = max(months[0], _add_months(months[-1], -(window - 1)))
        expected = months_between(window_start, months[-1]) + 1
        present = sum(1 for m in months if m >= window_start)
        gaps = expected - present
        if behind <= late_after:
            status = "current"
        elif behind <= 24:
            status = "late"
        else:
            status = "stale"
        note = (
            f"Latest {months[-1]:%Y-%m}, {behind} months behind the newest report ({latest:%Y-%m})"
        )
        if gaps:
            note += f"; {gaps} missing months in its last {window}"
        statuses.append(
            Reporting(country.iso3, status, months[0], months[-1], behind, gaps, note + ".")
        )
    return statuses, latest


def _add_months(month: dt.date, count: int) -> dt.date:
    index = month.year * 12 + month.month - 1 + count
    return dt.date(index // 12, index % 12 + 1, 1)


def prices_by_month() -> dict[dt.date, float]:
    seed = read_seed(PRICE_SEED, producer="gold-price")
    return {
        dt.date.fromisoformat(row["month"]): float(row["usd_per_troy_oz"])
        for row in records(seed["prices"])
    }


def check_prices(holdings: list[Holding], prices: dict[dt.date, float]) -> None:
    """Every holding is valued at its own month's price; a missing price stops the run."""
    missing = sorted({h.month for h in holdings if h.month not in prices})
    if missing:
        raise GoldValidationError(
            [
                f"No gold price for {m:%Y-%m}, needed to value central bank holdings "
                "(run `python -m pipelines gold-price` first; prices are never filled in)."
                for m in missing
            ]
        )


def build(*, refresh: bool, today: dt.date | None = None) -> ReservesResult:
    settings = config()["official_reserves"]
    url = settings["url"].format(
        countries="+".join(c.iso3 for c in countries()), start=settings["start"]
    )
    body = fetch_bytes(url, GOLD_RAW / "imf_il_gold.json", refresh=refresh, timeout=180)
    holdings = parse_holdings(json.loads(body))
    check_prices(holdings, prices_by_month())
    reporting, latest = reporting_status(holdings, today or dt.date.today())
    warnings = []
    for holding in holdings:
        share = holding.share_pct()
        if share is not None and share > 100:
            warnings.append(
                f"{holding.iso3} {holding.month:%Y-%m}: gold is {share:.1f}% of total reserves "
                "(above 100%; the share is left empty)."
            )
    return ReservesResult(holdings, reporting, latest, warnings)


def rows(result: ReservesResult, prices: dict[dt.date, float]) -> list[list[Any]]:
    out = []
    for h in result.holdings:
        share = h.share_pct()
        out.append(
            [
                h.iso3,
                month_end(h.month).isoformat(),
                round(h.tonnes, 3),
                round(h.troy_oz * prices[h.month], 2),
                round(share, 2) if share is not None and share <= 100 else None,
                "computed",
                IMF_IL.source_key,
            ]
        )
    return out


def dataset(result: ReservesResult) -> dict[str, Any]:
    months = [h.month for h in result.holdings]
    return {
        "key": "gold-official-reserves",
        "name": "IMF International Liquidity: central bank gold holdings",
        "provider": "International Monetary Fund",
        "license": "IMF Copyright and Usage terms (statistical data)",
        "attribution": (
            "Source: International Monetary Fund, International Liquidity (IL), "
            "https://data.imf.org/. Transformed by Bara La Afrika: fine troy ounces converted to "
            "tonnes; US dollar values computed from the World Bank monthly average gold price; "
            "share of reserves computed."
        ),
        "coverage_start": month_end(min(months)).isoformat(),
        "coverage_end": month_end(max(months)).isoformat(),
        "as_of": month_end(max(months)).isoformat(),
        "refresh_cadence": "monthly",
    }


def payload(result: ReservesResult) -> dict[str, Any]:
    prices = prices_by_month()
    return {
        "$generated": generated("gold-official-reserves", warnings=result.warnings),
        "datasets": [dataset(result)],
        "sources": [IMF_IL.seed()],
        "reserves": table(
            [
                "iso3",
                "as_of",
                "tonnes",
                "value_usd",
                "pct_of_total_reserves",
                "valuation",
                "source",
            ],
            rows(result, prices),
        ),
        "reporting": table(
            ["iso3", "status", "first", "last", "months_behind", "gaps_in_window", "note"],
            [
                [
                    r.iso3,
                    r.status,
                    r.first.isoformat() if r.first else None,
                    r.last.isoformat() if r.last else None,
                    r.months_behind,
                    r.gaps_in_window,
                    r.note,
                ]
                for r in result.reporting
            ],
        ),
    }


def configure(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--refresh", action="store_true", help="re-fetch instead of the cache")


def run(args: argparse.Namespace) -> int:
    try:
        result = build(refresh=bool(args.refresh))
    except GoldValidationError as error:
        print(f"Validation failed ({len(error.problems)} problems):\n{error}")
        return 1
    write_seed(RESERVES_SEED, payload(result))
    counts: dict[str, int] = {}
    for r in result.reporting:
        counts[r.status] = counts.get(r.status, 0) + 1
    print(
        f"Central bank gold: {len(result.holdings)} monthly holdings for "
        f"{len({h.iso3 for h in result.holdings})} countries, newest {result.latest:%Y-%m}. "
        + ", ".join(f"{k} {v}" for k, v in sorted(counts.items()))
    )
    for warning in result.warnings:
        print(f"  {warning}")
    return 0
