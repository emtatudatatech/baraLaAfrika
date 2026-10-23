"""`python -m pipelines fx`: Vinara's exchange rates into db/seeds/fx.json and
db/seeds/fx_daily.json, with data/fx_review_report.md.

Monthly: the IMF's exchange rates (IMF.STA/ER), local currency per US dollar, period average and
end of month, for all 54 states from 2020. Every series is put on today's currency unit using
the official conversion of each currency change (`reference/currencies.json`); a change is
never read as a gain or a loss.

Daily, from 2020 to yesterday, from official sources usable without permission: the ECB's euro
reference rates (the rand; and the euro-pegged currencies, the currencies at par with the rand
and the Djiboutian franc, derived at their official parities); the BIS's daily rates (Algeria,
Mauritius); and each state's own central bank where its terms allow reuse or it publishes none,
read through Frankfurter (the bank's rates as published, never Frankfurter's blend). Every peg
and every daily series is checked against the IMF's monthly figures; monthly series that stop
early are marked stale. States without a usable daily source keep the IMF's monthly rates.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import io
import itertools
import json
import math
import xml.etree.ElementTree as ET
from collections import defaultdict
from dataclasses import dataclass, field
from functools import cache
from pathlib import Path
from statistics import fmean
from typing import Any

from .gold_common import (
    SourceRecord,
    countries,
    generated,
    imf_month,
    imf_series,
    table,
    write_seed,
)
from .http import FetchError, fetch_bytes
from .settings import DATA_DIR, RAW_DIR, SEEDS_DIR

REFERENCE_FILE = Path(__file__).parent / "reference" / "currencies.json"
FX_SEED = SEEDS_DIR / "fx.json"
FX_DAILY_SEED = SEEDS_DIR / "fx_daily.json"
REPORT_PATH = DATA_DIR / "fx_review_report.md"
FX_RAW = RAW_DIR / "fx"

IMF_ER_URL = (
    "https://api.imf.org/external/sdmx/3.0/data/dataflow/IMF.STA/ER/+/"
    "{countries}.XDC_USD+XDC_EUR.PA_RT+EOP_RT.M"
)
IMF_ER = SourceRecord(
    "imf-er", "IMF, Exchange Rates (ER): national currency per US dollar", "https://data.imf.org/"
)
ECB_EXR = SourceRecord(
    "ecb-exr",
    "European Central Bank, euro foreign exchange reference rates",
    "https://data.ecb.europa.eu/data/datasets/EXR",
)


class FxError(RuntimeError):
    pass


class FxValidationError(FxError):
    def __init__(self, problems: list[str]) -> None:
        self.problems = problems
        super().__init__("\n".join(f"  - {p}" for p in problems))


@cache
def reference() -> dict[str, Any]:
    data: dict[str, Any] = json.loads(REFERENCE_FILE.read_text(encoding="utf-8"))
    return data


def _month(text: str) -> dt.date:
    year, month = text.split("-")
    return dt.date(int(year), int(month), 1)


def _months_between(earlier: dt.date, later: dt.date) -> int:
    return (later.year - earlier.year) * 12 + later.month - earlier.month


# ── Records ──────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Monthly:
    iso3: str
    month: dt.date
    average: float | None
    end: float | None
    converted: bool  # put on today's unit by the pipeline (the IMF gave the old unit)


@dataclass(frozen=True)
class ChangeCheck:
    iso3: str
    date: str
    old: str
    new: str
    old_per_new: float
    outcome: str  # converted | already_on_new_unit | outside_series
    before: float | None
    after: float | None


@dataclass(frozen=True)
class Status:
    iso3: str
    first: dt.date | None
    last: dt.date | None
    months_behind: int | None
    status: str  # current | late | stale | none


@dataclass(frozen=True)
class Daily:
    currency: str
    date: dt.date
    per_usd: float
    # ecb (the ECB's own rate) | derived (from an ECB rate at an official parity) | bis |
    # central_bank (the state's own central bank, as published)
    basis: str
    source: str  # source_key


@dataclass
class Result:
    monthly: list[Monthly]
    changes: list[ChangeCheck]
    statuses: list[Status]
    daily: list[Daily]
    newest: dt.date
    # iso3 → (months within, months checked, worst): the last ten years, and the whole series.
    peg_checks: dict[str, tuple[int, int, float]] = field(default_factory=dict)
    peg_history: dict[str, tuple[int, int, float]] = field(default_factory=dict)
    daily_checks: dict[str, tuple[int, int, float]] = field(default_factory=dict)  # currency → …
    large_moves: list[tuple[str, dt.date, float]] = field(default_factory=list)
    iso_problems: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    daily_last: dt.date | None = None
    daily_sources: dict[str, str] = field(default_factory=dict)  # currency → source_key
    iso_published: str = ""
    today: dt.date = field(default_factory=dt.date.today)


# ── IMF monthly rates ────────────────────────────────────────────────────────


def fetch_imf(*, refresh: bool) -> bytes:
    url = IMF_ER_URL.format(countries="+".join(c.iso3 for c in countries()))
    url += "?c%5BTIME_PERIOD%5D=ge:" + reference()["start_month"].replace("-", "-M")
    path = FX_RAW / f"imf_er_{reference()['start_month']}.json"
    return fetch_bytes(url, path, refresh=refresh, timeout=240)


def parse_imf(
    payload: dict[str, Any], today: dt.date
) -> dict[str, dict[str, dict[dt.date, float]]]:
    """iso3 → series ("USD avg", "USD end", "EUR avg") → month → value. Months not yet ended
    (the IMF's series can carry future-dated values) are dropped."""
    names = {
        ("XDC_USD", "PA_RT"): "USD avg",
        ("XDC_USD", "EOP_RT"): "USD end",
        ("XDC_EUR", "PA_RT"): "EUR avg",
    }
    this_month = today.replace(day=1)
    result: dict[str, dict[str, dict[dt.date, float]]] = defaultdict(dict)
    for (country, indicator, kind, frequency), values in imf_series(payload).items():
        name = names.get((indicator, kind))
        if frequency != "M" or name is None:
            continue
        result[country][name] = {
            month: value
            for period, value in values.items()
            if (month := imf_month(period)) < this_month and value > 0
        }
    return result


def apply_changes(
    iso3: str, series: dict[str, dict[dt.date, float]]
) -> tuple[dict[str, dict[dt.date, float]], set[dt.date], list[ChangeCheck]]:
    """Put a country's series on today's unit. Where the IMF gives months before a change in
    the old unit (the step across the change matches the official conversion), those months are
    divided by it; where it has already converted them, nothing changes."""
    checks: list[ChangeCheck] = []
    converted: set[dt.date] = set()
    out = {name: dict(values) for name, values in series.items()}
    for change in reference()["changes"]:
        if change["iso3"] != iso3:
            continue
        date = dt.date.fromisoformat(change["date"])
        factor = float(change["old_per_new"])
        averages = out.get("USD avg", {})
        record = {
            "iso3": iso3,
            "date": change["date"],
            "old": change["old"],
            "new": change["new"],
            "old_per_new": factor,
        }
        # A change during a month may show in that month's average or the next one's.
        boundaries = [date.replace(day=1)] + ([] if date.day == 1 else [_next_month(date)])
        steps = []
        for boundary in boundaries:
            before = max((m for m in averages if m < boundary), default=None)
            after = min((m for m in averages if m >= boundary), default=None)
            if before is not None and after is not None and _months_between(before, after) <= 3:
                steps.append((boundary, before, after, averages[before] / averages[after]))
        if not steps:
            checks.append(ChangeCheck(**record, outcome="outside_series", before=None, after=None))
            continue
        matching = [s for s in steps if 0.5 <= s[3] / factor <= 2]
        if matching:
            boundary, before, after, _ = matching[0]
            raw_before, raw_after = averages[before], averages[after]
            for values in out.values():
                for month in [m for m in values if m < boundary]:
                    values[month] /= factor
                    converted.add(month)
            outcome = "converted"
        elif all(0.5 <= s[3] <= 2 for s in steps):
            boundary, before, after, _ = steps[0]
            raw_before, raw_after = averages[before], averages[after]
            outcome = "already_on_new_unit"
        else:
            raise FxValidationError(
                [
                    f"{iso3}: across the {change['old']}→{change['new']} change the rate moves "
                    f"×{steps[0][3]:,.1f}, matching neither the conversion (×{factor:,g}) nor no "
                    "conversion; check the series"
                ]
            )
        checks.append(ChangeCheck(**record, outcome=outcome, before=raw_before, after=raw_after))
    return out, converted, checks


def _add_months(month: dt.date, count: int) -> dt.date:
    index = month.year * 12 + month.month - 1 + count
    return dt.date(index // 12, index % 12 + 1, 1)


def _next_month(day: dt.date) -> dt.date:
    return (day.replace(day=28) + dt.timedelta(days=4)).replace(day=1)


def check_pegs(
    iso3: str,
    series: dict[str, dict[dt.date, float]],
    usd_rand: dict[dt.date, float],
    since_month: dt.date | None = None,
) -> tuple[int, int, float] | None:
    """How many of a pegged currency's months sit at its parity (within the tolerance): euro pegs
    on the IMF's own euro rate, dollar pegs on the dollar rate, rand-linked currencies on South
    Africa's dollar rate. Returns (months within, months checked, worst deviation)."""
    code = reference()["currencies"][iso3]
    peg = reference()["pegs"].get(code)
    if peg is None:
        return None
    since = dt.date.fromisoformat(peg["since"])
    if peg["anchor"] == "EUR":
        actual, expected = (
            series.get("EUR avg", {}),
            dict.fromkeys(series.get("EUR avg", {}), peg["parity"]),
        )
    elif peg["anchor"] == "USD":
        actual, expected = (
            series.get("USD avg", {}),
            dict.fromkeys(series.get("USD avg", {}), peg["parity"]),
        )
    else:
        actual = series.get("USD avg", {})
        expected = {m: usd_rand[m] * peg["parity"] for m in actual if m in usd_rand}
    months = [
        m
        for m in actual
        if m >= since and m in expected and (since_month is None or m >= since_month)
    ]
    if not months:
        return None
    deviations = [abs(actual[m] / expected[m] - 1) for m in months]
    tolerance = float(reference()["peg_tolerance"])
    return sum(d <= tolerance for d in deviations), len(months), max(deviations)


# ── Daily rates: ECB, BIS and central banks ──────────────────────────────────

BIS_XRU = SourceRecord(
    "bis-xru",
    "Bank for International Settlements, US dollar exchange rates (daily)",
    "https://data.bis.org/topics/XRU",
)


def central_bank_source(currency: str) -> SourceRecord:
    bank = reference()["daily"]["central_banks"][currency]
    return SourceRecord(
        f"cb-{bank['provider'].lower()}",
        f"{bank['name']}: official exchange rates (read through frankfurter.dev)",
        bank["url"],
    )


def usable_central_banks() -> dict[str, dict[str, Any]]:
    """The central banks whose terms allow reuse, or which publish none."""
    settings = reference()["daily"]
    return {
        currency: bank
        for currency, bank in settings["central_banks"].items()
        if bank["terms"] in settings["usable_terms"]
    }


def fetch_ecb(*, refresh: bool) -> bytes:
    settings = reference()["daily"]
    url = settings["ecb_url"].format(start=settings["start"])
    return fetch_bytes(
        url, FX_RAW / f"ecb_exr_{settings['start']}.csv", refresh=refresh, timeout=120
    )


def parse_ecb(body: bytes) -> dict[str, dict[dt.date, float]]:
    """currency (USD, ZAR) → day → units per euro."""
    rates: dict[str, dict[dt.date, float]] = defaultdict(dict)
    for row in csv.DictReader(io.StringIO(body.decode("utf-8"))):
        value = row.get("OBS_VALUE", "")
        if not value:
            continue
        rates[row["CURRENCY"]][dt.date.fromisoformat(row["TIME_PERIOD"])] = float(value)
    if not rates.get("USD") or not rates.get("ZAR"):
        raise FxError("ECB: the response has no USD or ZAR rates; the API may have changed")
    return rates


def derive_daily(ecb: dict[str, dict[dt.date, float]]) -> list[Daily]:
    """Local currency per US dollar, each day the ECB published both rates."""
    pegs = reference()["pegs"]
    days = sorted(set(ecb["USD"]) & set(ecb["ZAR"]))
    out: list[Daily] = []
    for currency in reference()["daily"]["ecb_currencies"]:
        for day in days:
            usd_per_eur = ecb["USD"][day]
            rand_per_usd = ecb["ZAR"][day] / usd_per_eur
            if currency == "ZAR":
                value, basis = rand_per_usd, "ecb"
            else:
                peg = pegs[currency]
                if peg["anchor"] == "EUR":
                    value = peg["parity"] / usd_per_eur
                elif peg["anchor"] == "ZAR":
                    value = peg["parity"] * rand_per_usd
                else:
                    value = peg["parity"]
                basis = "derived"
            out.append(Daily(currency, day, round(value, 6), basis, ECB_EXR.source_key))
    return out


def fetch_bis(*, refresh: bool) -> bytes:
    settings = reference()["daily"]
    url = settings["bis_url"].format(
        areas="+".join(settings["bis"].values()), start=settings["start"]
    )
    path = FX_RAW / f"bis_xru_daily_{settings['start']}.csv"
    return fetch_bytes(url, path, refresh=refresh, timeout=180)


def parse_bis(body: bytes) -> list[Daily]:
    """BIS daily rates (local currency per US dollar) for the configured currencies."""
    wanted = {area: currency for currency, area in reference()["daily"]["bis"].items()}
    out = []
    for row in csv.DictReader(io.StringIO(body.decode("utf-8"))):
        currency = wanted.get(row.get("REF_AREA", ""))
        if currency is None or row.get("CURRENCY") != currency:
            continue
        try:
            value = float(row.get("OBS_VALUE") or "nan")
        except ValueError:
            continue
        if not math.isfinite(value) or value <= 0:
            continue  # the BIS marks days without a rate as NaN
        out.append(
            Daily(
                currency,
                dt.date.fromisoformat(row["TIME_PERIOD"]),
                _round(value) or 0.0,
                "bis",
                BIS_XRU.source_key,
            )
        )
    missing = set(wanted.values()) - {d.currency for d in out}
    if missing:
        raise FxError(f"BIS: no daily rates for {', '.join(sorted(missing))}")
    return out


def fetch_central_bank(
    currency: str, year: int, *, refresh: bool, today: dt.date
) -> list[dict[str, Any]]:
    """One calendar year of a central bank's dollar rate, through Frankfurter (the bank's own
    rates, never the blend). Past years are cached; the current year is re-read on refresh."""
    settings = reference()["daily"]
    bank = settings["central_banks"][currency]
    start = max(dt.date(year, 1, 1), dt.date.fromisoformat(settings["start"]))
    end = min(dt.date(year, 12, 31), today - dt.timedelta(days=1))
    url = settings["frankfurter_url"].format(
        provider=bank["provider"], start=start, end=end, currency=currency
    )
    path = FX_RAW / "central_banks" / f"{currency}_{year}.json"
    # Frankfurter's origin can be slow for history not yet cached: allow time.
    body = fetch_bytes(url, path, refresh=refresh and year == today.year, timeout=600)
    rows: list[dict[str, Any]] = json.loads(body)
    if not isinstance(rows, list):
        raise FxError(f"Frankfurter {bank['provider']} {currency} {year}: unexpected response")
    return rows


def previous_daily() -> dict[str, list[Daily]]:
    """The committed daily seed, per currency: kept for a currency whose source did not answer."""
    if not FX_DAILY_SEED.exists():
        return {}
    seed = json.loads(FX_DAILY_SEED.read_text(encoding="utf-8"))["daily"]
    out: dict[str, list[Daily]] = defaultdict(list)
    for currency, day, per_usd, basis, *rest in seed["rows"]:
        source = rest[0] if rest else ECB_EXR.source_key
        out[currency].append(Daily(currency, dt.date.fromisoformat(day), per_usd, basis, source))
    return out


def central_bank_daily(
    *, refresh: bool, today: dt.date, warnings: list[str] | None = None
) -> list[Daily]:
    """Each usable central bank's daily dollar rate. A bank that does not answer keeps its rates
    from the committed seed (and the run says so), so a slow source never empties a series."""
    first_year = dt.date.fromisoformat(reference()["daily"]["start"]).year
    kept = previous_daily()
    out = []
    for currency in usable_central_banks():
        source = central_bank_source(currency).source_key
        rows: list[Daily] = []
        try:
            for year in range(first_year, today.year + 1):
                for row in fetch_central_bank(currency, year, refresh=refresh, today=today):
                    # A year's response can open with the previous year's last rate.
                    if not str(row.get("date", "")).startswith(f"{year}-"):
                        continue
                    if row.get("base") != "USD" or row.get("quote") != currency:
                        raise FxError(
                            f"Frankfurter {currency}: a row for "
                            f"{row.get('base')}/{row.get('quote')}"
                        )
                    rows.append(
                        Daily(
                            currency,
                            dt.date.fromisoformat(row["date"]),
                            _round(float(row["rate"])) or 0.0,
                            "central_bank",
                            source,
                        )
                    )
        except FetchError as error:
            previous = kept.get(currency, [])
            if warnings is not None:
                name = reference()["daily"]["central_banks"][currency]["name"]
                warnings.append(
                    f"{currency}: {name} did not answer ({str(error)[-80:]}); "
                    + (
                        f"kept its {len(previous)} committed daily rates"
                        if previous
                        else "no daily rates yet, so the state shows monthly rates"
                    )
                )
            rows = previous
        out += rows
    return out


def check_daily(daily: list[Daily], monthly: list[Monthly]) -> dict[str, tuple[int, int, float]]:
    """Each daily currency's monthly mean against the IMF's monthly average for a country using
    it: within the peg tolerance for fixed currencies, the daily-check tolerance otherwise."""
    users: dict[str, str] = {}
    for iso3, code in reference()["currencies"].items():
        users.setdefault(code, iso3)
    imf = {(m.iso3, m.month): m.average for m in monthly if m.average is not None}
    by_month: dict[tuple[str, dt.date], list[float]] = defaultdict(list)
    for d in daily:
        by_month[(d.currency, d.date.replace(day=1))].append(d.per_usd)
    results: dict[str, list[float]] = defaultdict(list)
    for (currency, month), values in by_month.items():
        reference_value = imf.get((users[currency], month))
        if reference_value is not None:
            results[currency].append(abs(fmean(values) / reference_value - 1))
    return {
        currency: (
            sum(d <= _daily_tolerance(currency) for d in deviations),
            len(deviations),
            max(deviations),
        )
        for currency, deviations in results.items()
    }


def _daily_tolerance(currency: str) -> float:
    key = (
        "peg_tolerance"
        if currency in reference()["pegs"] or currency == "ZAR"
        else "daily_check_tolerance"
    )
    return float(reference()[key])


# ── ISO 4217 ─────────────────────────────────────────────────────────────────


def check_iso(*, refresh: bool) -> tuple[list[str], str]:
    """Every state's currency is in the current ISO 4217 list under its name, and every changed
    currency's old code was withdrawn on or after the change (within two years)."""
    urls = reference()["iso4217"]
    current = ET.fromstring(
        fetch_bytes(urls["current"], FX_RAW / "iso4217_current.xml", refresh=refresh)
    )
    historic = ET.fromstring(
        fetch_bytes(urls["historic"], FX_RAW / "iso4217_historic.xml", refresh=refresh)
    )
    listed: dict[str, set[str]] = defaultdict(set)
    for entry in current.iter("CcyNtry"):
        listed[entry.findtext("CtryNm") or ""].add(entry.findtext("Ccy") or "")
    names = reference()["iso4217"]["names"]
    problems = []
    for country in countries():
        name = names.get(country.iso3, country.name.upper())
        code = reference()["currencies"][country.iso3]
        if code not in listed.get(name, set()):
            problems.append(
                f"{country.name}: ISO 4217 lists {sorted(listed.get(name, set())) or 'nothing'} "
                f"under {name!r}, not {code}"
            )
    withdrawn: dict[str, list[str]] = defaultdict(list)
    for entry in historic.iter("HstrcCcyNtry"):
        withdrawn[entry.findtext("Ccy") or ""].append(entry.findtext("WthdrwlDt") or "")
    for change in reference()["changes"]:
        dates = [d for d in withdrawn.get(change["old"], []) if len(d) == 7]
        change_month = dt.date.fromisoformat(change["date"]).replace(day=1)
        fits = [d for d in dates if -1 <= _months_between(change_month, _month(d)) <= 24]
        if not fits:
            problems.append(
                f"{change['iso3']}: ISO 4217 withdrew {change['old']} on {dates or 'no date'}, "
                f"not within two years after the change on {change['date']}"
            )
    return problems, current.attrib.get("Pblshd", "")


# ── Build ────────────────────────────────────────────────────────────────────


def build(*, refresh: bool, today: dt.date | None = None) -> Result:
    today = today or dt.date.today()
    raw = parse_imf(json.loads(fetch_imf(refresh=refresh)), today)
    starts = {iso3: _month(s["month"]) for iso3, s in reference().get("series_start", {}).items()}
    first_month = _month(reference()["start_month"])

    monthly: list[Monthly] = []
    change_checks: list[ChangeCheck] = []
    peg_checks: dict[str, tuple[int, int, float]] = {}
    peg_history: dict[str, tuple[int, int, float]] = {}
    usd_rand = raw.get("ZAF", {}).get("USD avg", {})
    latest = max(m for values in raw.values() for s in values.values() for m in s)
    window_start = _add_months(latest, -int(reference()["peg_check_months"]) + 1)
    for country in countries():
        series = {
            name: {m: v for m, v in values.items() if m >= starts.get(country.iso3, first_month)}
            for name, values in raw.get(country.iso3, {}).items()
        }
        series, converted, checks = apply_changes(country.iso3, series)
        change_checks += checks
        peg = check_pegs(country.iso3, series, usd_rand, window_start)
        if peg is not None:
            peg_checks[country.iso3] = peg
        history = check_pegs(country.iso3, series, usd_rand)
        if history is not None:
            peg_history[country.iso3] = history
        months = sorted(set(series.get("USD avg", {})) | set(series.get("USD end", {})))
        monthly += [
            Monthly(
                country.iso3,
                m,
                _round(series.get("USD avg", {}).get(m)),
                _round(series.get("USD end", {}).get(m)),
                m in converted,
            )
            for m in months
        ]

    newest = max(m.month for m in monthly)
    stale_after = int(reference()["stale_after_months"])
    current_within = int(reference()["current_within_months"])
    statuses = []
    for country in countries():
        months = sorted(m.month for m in monthly if m.iso3 == country.iso3)
        if not months:
            statuses.append(Status(country.iso3, None, None, None, "none"))
            continue
        behind = _months_between(months[-1], newest)
        status = (
            "current" if behind <= current_within else "late" if behind <= stale_after else "stale"
        )
        statuses.append(Status(country.iso3, months[0], months[-1], behind, status))

    ecb = parse_ecb(fetch_ecb(refresh=refresh))
    daily = derive_daily(ecb) + parse_bis(fetch_bis(refresh=refresh))
    warnings: list[str] = []
    daily += central_bank_daily(refresh=refresh, today=today, warnings=warnings)
    start = dt.date.fromisoformat(reference()["daily"]["start"])
    daily = sorted(
        (d for d in daily if start <= d.date < today), key=lambda d: (d.currency, d.date)
    )
    result = Result(monthly, change_checks, statuses, daily, newest, today=today)
    result.peg_checks = peg_checks
    result.peg_history = peg_history
    result.daily_checks = check_daily(daily, monthly)
    result.daily_last = max(d.date for d in daily) if daily else None
    result.daily_sources = {d.currency: d.source for d in daily}
    result.warnings += warnings
    result.iso_problems, result.iso_published = check_iso(refresh=refresh)
    result.large_moves = large_moves(monthly)
    validate(result)
    return result


def _round(value: float | None) -> float | None:
    if value is None:
        return None
    digits = max(0, 6 - math.floor(math.log10(abs(value))) - 1) if value else 0
    return round(value, min(digits, 8))


def large_moves(monthly: list[Monthly]) -> list[tuple[str, dt.date, float]]:
    """Month-on-month changes larger than the configured share (after unit conversion)."""
    limit = float(reference()["large_move"])
    by_country: dict[str, list[Monthly]] = defaultdict(list)
    for m in monthly:
        if m.average is not None:
            by_country[m.iso3].append(m)
    moves = []
    for iso3, rows in by_country.items():
        rows.sort(key=lambda m: m.month)
        for previous, current in itertools.pairwise(rows):
            if _months_between(previous.month, current.month) != 1:
                continue
            assert previous.average is not None and current.average is not None
            change = current.average / previous.average - 1
            if abs(change) > limit:
                moves.append((iso3, current.month, change))
    return sorted(moves, key=lambda x: (x[0], x[1]))


def validate(result: Result) -> None:
    problems = list(result.iso_problems)
    tolerance = float(reference()["peg_tolerance"])
    for iso3, (ok, total, worst) in result.peg_checks.items():
        # A peg holds when nearly every month sits at the parity; occasional rounding is allowed.
        if ok < 0.95 * total:
            problems.append(
                f"{iso3}: only {ok} of {total} months are within {tolerance:.0%} of the recorded "
                f"peg (worst {worst:.1%}); check reference/currencies.json"
            )
    for currency, (ok, total, worst) in result.daily_checks.items():
        if ok < 0.9 * total:
            problems.append(
                f"{currency}: the daily rates match the IMF monthly average in only {ok} of "
                f"{total} months (worst {worst:.1%})"
            )
    days: set[tuple[str, dt.date]] = set()
    for d in result.daily:
        if (d.currency, d.date) in days:
            problems.append(f"{d.currency} {d.date}: two daily rates")
        days.add((d.currency, d.date))
    seen: set[tuple[str, dt.date]] = set()
    for m in result.monthly:
        if (m.iso3, m.month) in seen:
            problems.append(f"{m.iso3} {m.month}: duplicate month")
        seen.add((m.iso3, m.month))
        if m.month >= result.today.replace(day=1):
            problems.append(f"{m.iso3} {m.month}: a month that has not ended")
    if problems:
        raise FxValidationError(problems)


# ── Seeds ────────────────────────────────────────────────────────────────────


def payload(result: Result) -> dict[str, Any]:
    ref = reference()
    areaer = SourceRecord(ref["areaer"]["source_key"], ref["areaer"]["title"], ref["areaer"]["url"])
    first = min(m.month for m in result.monthly)
    return {
        "$generated": generated("fx", newest_month=result.newest.isoformat()),
        "datasets": [
            {
                "key": "vinara-fx-imf",
                "name": "IMF exchange rates (monthly)",
                "provider": "International Monetary Fund",
                "license": "IMF Copyright and Usage terms (statistical data)",
                "attribution": (
                    "Source: International Monetary Fund, Exchange Rates (ER), "
                    "https://data.imf.org/. Transformed by Bara La Afrika: months before a "
                    "currency change put on today's unit at the official conversion."
                ),
                "coverage_start": first.isoformat(),
                "coverage_end": result.newest.isoformat(),
                "as_of": result.newest.isoformat(),
                "refresh_cadence": "monthly",
            },
            {
                "key": "vinara-fx-daily",
                "name": "Official daily exchange rates (ECB, BIS and central banks)",
                "provider": "European Central Bank, Bank for International Settlements and "
                "African central banks",
                "license": "ECB and BIS: reuse with the source cited; central banks: official "
                "rates published for public use",
                "attribution": (
                    "Sources: ECB statistics (the rand, and the CFA francs, Comorian franc, "
                    "Cabo Verdean escudo, dobra, loti, lilangeni, Namibian dollar and Djiboutian "
                    "franc derived at their official parities); Bank for International "
                    "Settlements (Algeria, Mauritius); and each state's own central bank as "
                    "published (Kenya, Tanzania, Zambia, Angola, The Gambia, Liberia, Malawi, "
                    "Tunisia, Morocco), read through frankfurter.dev."
                ),
                "coverage_start": ref["daily"]["start"],
                "coverage_end": result.daily_last.isoformat() if result.daily_last else None,
                "as_of": result.daily_last.isoformat()
                if result.daily_last
                else result.today.isoformat(),
                "refresh_cadence": "weekly",
            },
        ],
        "sources": [IMF_ER.seed(), ECB_EXR.seed(), BIS_XRU.seed(), areaer.seed()]
        + [central_bank_source(currency).seed() for currency in sorted(usable_central_banks())],
        "currencies": table(
            ["iso3", "currency", "union_name", "peg_anchor", "peg_parity", "peg_since"],
            [
                [
                    iso3,
                    code,
                    ref["unions"].get(code),
                    ref["pegs"].get(code, {}).get("anchor"),
                    ref["pegs"].get(code, {}).get("parity"),
                    ref["pegs"].get(code, {}).get("since"),
                ]
                for iso3, code in sorted(ref["currencies"].items())
            ],
        ),
        "changes": table(
            ["iso3", "date", "old", "new", "old_per_new", "note", "outcome"],
            [
                [c.iso3, c.date, c.old, c.new, c.old_per_new, change["note"], c.outcome]
                for c in result.changes
                for change in ref["changes"]
                if change["iso3"] == c.iso3 and change["date"] == c.date
            ],
        ),
        "monthly": table(
            ["iso3", "month", "per_usd_avg", "per_usd_end", "converted"],
            [[m.iso3, m.month.isoformat(), m.average, m.end, m.converted] for m in result.monthly],
        ),
        "status": table(
            ["iso3", "first_month", "last_month", "months_behind", "status"],
            [
                [
                    s.iso3,
                    s.first.isoformat() if s.first else None,
                    s.last.isoformat() if s.last else None,
                    s.months_behind,
                    s.status,
                ]
                for s in result.statuses
            ],
        ),
    }


def daily_payload(result: Result) -> dict[str, Any]:
    return {
        "$generated": generated("fx"),
        "daily": table(
            ["currency", "date", "per_usd", "basis", "source"],
            [[d.currency, d.date.isoformat(), d.per_usd, d.basis, d.source] for d in result.daily],
        ),
    }


def configure(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--refresh", action="store_true", help="re-fetch instead of the cache")


def run(args: argparse.Namespace) -> int:
    from . import fx_report

    try:
        result = build(refresh=bool(args.refresh))
    except FxValidationError as error:
        print(f"Validation failed ({len(error.problems)} problems):\n{error}")
        return 1
    write_seed(FX_SEED, payload(result))
    write_seed(FX_DAILY_SEED, daily_payload(result))
    REPORT_PATH.write_text(fx_report.render(result), encoding="utf-8")
    counts: dict[str, int] = defaultdict(int)
    for s in result.statuses:
        counts[s.status] += 1
    print(
        f"FX: {len(result.monthly)} country-months to {result.newest:%Y-%m} "
        f"({', '.join(f'{k} {v}' for k, v in sorted(counts.items()))}); {len(result.daily)} daily "
        f"rates for {len(result.daily_sources)} currencies to {result.daily_last}. "
        f"Wrote {REPORT_PATH.name}."
    )
    return 0
