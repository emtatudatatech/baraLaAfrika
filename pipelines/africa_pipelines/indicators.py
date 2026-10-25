"""`python -m pipelines indicators`: Vinara's annual indicators into db/seeds/indicators.json and
db/seeds/external_debt_creditors.json, with data/indicators_coverage_matrix.md and
data/indicators_review_report.md.

Sources (docs/vinara-sources.md): World Bank WDI for population, area, GDP (US$ and PPP), GDP
per capita (PPP), growth, inflation and GNI; SIPRI's military spending read through WDI (only
its latest 10 years are kept: fair use); IMF WEO for government debt and, where WDI has no
figure for the year before the WEO edition, that year's IMF figure labelled an estimate; UNDP's
Human Development Index; World Bank International Debt Statistics for external debt and its
creditors. Projections and future years are never stored; a missing figure is a missing row.
"""

from __future__ import annotations

import argparse
import datetime as dt
from collections import Counter
from dataclasses import dataclass, field
from typing import Any

from . import indicators_report
from .gold_common import countries, generated, table, write_seed
from .http import FetchError, fetch_bytes
from .indicators_sources import (
    HDR,
    HDR_VIA_OWID,
    IDS,
    INDICATORS_RAW,
    SIPRI,
    WDI,
    WEO,
    IdsRow,
    IndicatorsError,
    IndicatorsValidationError,
    Value,
    WeoEdition,
    config,
    parse_hdr,
    parse_hdr_owid,
    parse_ids,
    parse_wdi,
    parse_weo,
)
from .settings import DATA_DIR, SEEDS_DIR

INDICATORS_SEED = SEEDS_DIR / "indicators.json"
CREDITORS_SEED = SEEDS_DIR / "external_debt_creditors.json"
COVERAGE_PATH = DATA_DIR / "indicators_coverage_matrix.md"
REPORT_PATH = DATA_DIR / "indicators_review_report.md"

DATASET_KEYS = {
    "wdi": "vinara-wdi",
    "weo": "vinara-imf-weo",
    "sipri": "vinara-sipri",
    "hdr": "vinara-hdr",
    "ids": "vinara-ids",
}
LEVEL_UNITS = {"people", "km2", "current_usd", "current_intl_usd"}

# Plausible ranges: a value outside them stops the run (a unit or parsing error, not a fact).
RANGES: dict[str, tuple[float, float]] = {
    "people": (1, 2e9),
    "km2": (1, 3e7),
    "current_usd": (0, 5e13),
    "current_intl_usd": (0, 5e13),
    "percent_of_gdp": (0, 1000),
    "index": (0, 1),
}
PERCENT_RANGES: dict[str, tuple[float, float]] = {
    "population_growth": (-20, 20),
    "gdp_growth": (-80, 150),
    "inflation": (-50, 100_000),
}


@dataclass(frozen=True)
class Observation:
    indicator: str
    iso3: str
    year: int
    value: float
    basis: str  # reported | estimate
    source: str  # source_key


@dataclass(frozen=True)
class Creditor:
    iso3: str
    year: int
    kind: str
    code: str
    name: str
    amount_usd: float


@dataclass(frozen=True)
class CrossCheck:
    indicator: str
    iso3: str
    year: int
    wdi: float
    imf: float


@dataclass
class Build:
    observations: list[Observation]
    creditors: list[Creditor]
    editions: dict[str, str]  # source_key → edition label
    updated: dict[str, str]  # source_key → the source's own update or publication date
    weo: WeoEdition
    hdr_source: str
    cross_checks: list[CrossCheck] = field(default_factory=list)
    trimmed: dict[str, tuple[int, int]] = field(default_factory=dict)  # SIPRI years kept
    warnings: list[str] = field(default_factory=list)
    today: dt.date = field(default_factory=dt.date.today)


def indicator_specs() -> list[dict[str, Any]]:
    specs: list[dict[str, Any]] = config()["indicators"]
    return specs


def _rounded(value: float, decimals: int) -> float:
    rounded = round(value, decimals)
    return float(int(rounded)) if decimals == 0 else rounded


# ── Fetching ─────────────────────────────────────────────────────────────────


def _countries_param(separator: str) -> str:
    return separator.join(c.iso3 for c in countries())


def fetch_wdi(code: str, *, refresh: bool, today: dt.date) -> bytes:
    url = config()["wdi"]["url"].format(
        countries=_countries_param(";"), code=code, start=config()["start_year"], end=today.year
    )
    return fetch_bytes(url, INDICATORS_RAW / f"wdi_{code}.json", refresh=refresh, timeout=120)


def fetch_weo(codes: list[str], *, refresh: bool) -> bytes:
    url = config()["weo"]["url"].format(countries=_countries_param("+"), codes="+".join(codes))
    return fetch_bytes(url, INDICATORS_RAW / "imf_weo.json", refresh=refresh, timeout=240)


def fetch_hdr(*, refresh: bool) -> tuple[bytes, str]:
    """UNDP's own file; if UNDP's site does not answer, Our World in Data's copy of it. Without
    --refresh, whichever copy is already cached is used."""
    settings = config()["hdr"]
    undp_cache = INDICATORS_RAW / "undp_hdr.csv"
    owid_cache = INDICATORS_RAW / "owid_hdi.csv"
    if not refresh and not undp_cache.exists() and owid_cache.exists():
        return owid_cache.read_bytes(), HDR_VIA_OWID.source_key
    try:
        body = fetch_bytes(settings["url"], undp_cache, refresh=refresh, timeout=30)
        return body, HDR.source_key
    except FetchError as error:
        print(f"  UNDP did not answer ({error}); using Our World in Data's copy of the HDI.")
    body = fetch_bytes(settings["fallback_url"], owid_cache, refresh=refresh, timeout=180)
    return body, HDR_VIA_OWID.source_key


def fetch_ids_totals(code: str, *, refresh: bool, today: dt.date) -> bytes:
    url = config()["ids"]["totals_url"].format(
        code=code,
        countries=_countries_param(";"),
        # A semicolon list: the IDS API does not accept YR…:YR… ranges here.
        years=";".join(f"YR{y}" for y in range(int(config()["start_year"]), today.year)),
    )
    return fetch_bytes(url, INDICATORS_RAW / f"ids_{code}.json", refresh=refresh, timeout=120)


def fetch_ids_creditors(code: str, year: int, *, refresh: bool) -> bytes:
    url = config()["ids"]["creditors_url"].format(
        code=code, countries=_countries_param(";"), year=year
    )
    path = INDICATORS_RAW / f"ids_{code}_creditors_{year}.json"
    return fetch_bytes(url, path, refresh=refresh, timeout=120)


# ── Merging ──────────────────────────────────────────────────────────────────


def merge_imf(
    spec: dict[str, Any],
    wdi: list[Observation],
    imf: list[Value],
    edition: WeoEdition,
) -> tuple[list[Observation], list[CrossCheck]]:
    """Add the IMF figure for the year before the edition where WDI has none, and list where
    the two sources disagree beyond the tolerance (the report shows them)."""
    estimate_year = edition.year - 1
    have = {(o.iso3, o.year): o.value for o in wdi}
    fills = [
        Observation(spec["key"], v.iso3, v.year, v.value, "estimate", WEO.source_key)
        for v in imf
        if v.year == estimate_year and (v.iso3, v.year) not in have
    ]
    tolerance = config()["cross_check"]
    checks = []
    for v in imf:
        if v.year >= estimate_year or (v.iso3, v.year) not in have:
            continue
        reference = have[(v.iso3, v.year)]
        if spec["unit"] == "percent":
            differs = abs(reference - v.value) > tolerance["points_tolerance"]
        else:
            differs = abs(reference - v.value) > tolerance["relative_tolerance"] * abs(reference)
        if differs:
            checks.append(CrossCheck(spec["key"], v.iso3, v.year, reference, v.value))
    return fills, checks


def weo_observations(
    spec: dict[str, Any], imf: list[Value], edition: WeoEdition
) -> list[Observation]:
    """A WEO-sourced indicator: past years as reported, the year before the edition as an
    estimate, the edition's year and later (projections) dropped."""
    return [
        Observation(
            spec["key"],
            v.iso3,
            v.year,
            v.value,
            "estimate" if v.year == edition.year - 1 else "reported",
            WEO.source_key,
        )
        for v in imf
        if config()["start_year"] <= v.year < edition.year
    ]


def keep_latest_years(
    observations: list[Observation], years: int
) -> tuple[list[Observation], tuple[int, int] | None]:
    """SIPRI fair use: keep only the latest `years` years that have data."""
    if not observations:
        return observations, None
    last = max(o.year for o in observations)
    first = last - years + 1
    return [o for o in observations if o.year >= first], (first, last)


def creditor_rows(
    by_kind: dict[str, list[IdsRow]], bondholders: list[IdsRow], years: set[int]
) -> list[Creditor]:
    """Each kind's creditors (the series a creditor appears in gives its kind); bondholders are
    one creditor, from the bonds total."""
    rows = [
        Creditor(r.iso3, r.year, kind, r.counterpart, r.counterpart_name, r.value)
        for kind, records in by_kind.items()
        for r in records
        if r.counterpart != "WLD" and r.value > 0 and r.year in years
    ]
    rows += [
        Creditor(r.iso3, r.year, "bondholders", "BND", "Bondholders", r.value)
        for r in bondholders
        if r.counterpart == "WLD" and r.value > 0 and r.year in years
    ]
    return sorted(rows, key=lambda c: (c.iso3, c.year, c.kind, -c.amount_usd, c.code))


# ── Validation ───────────────────────────────────────────────────────────────


def validate(result: Build) -> list[str]:
    problems: list[str] = []
    specs = {s["key"]: s for s in indicator_specs()}
    iso3s = {c.iso3 for c in countries()}
    seen: set[tuple[str, str, int]] = set()
    for o in result.observations:
        key = (o.indicator, o.iso3, o.year)
        if key in seen:
            problems.append(f"Duplicate observation {key}")
        seen.add(key)
        if o.iso3 not in iso3s:
            problems.append(f"{key}: unknown country")
        if o.year >= result.today.year:
            problems.append(f"{key}: the year has not ended (future or current year)")
        if o.basis == "estimate" and o.year != result.weo.year - 1:
            problems.append(f"{key}: an estimate must be for {result.weo.year - 1}")
        if o.source == WEO.source_key and o.year >= result.weo.year:
            problems.append(f"{key}: a WEO projection (year {o.year})")
        spec = specs[o.indicator]
        low, high = PERCENT_RANGES.get(o.indicator) or RANGES.get(spec["unit"], (-1e18, 1e18))
        if not low <= o.value <= high:
            problems.append(f"{key}: {o.value} is outside the plausible range [{low}, {high}]")
    for spec in indicator_specs():
        if not any(o.indicator == spec["key"] for o in result.observations):
            problems.append(f"{spec['key']}: no observations at all")
        if "max_years" in spec:
            years = {o.year for o in result.observations if o.indicator == spec["key"]}
            if len(years) > spec["max_years"]:
                problems.append(
                    f"{spec['key']}: {len(years)} years kept (fair use allows {spec['max_years']})"
                )
    creditor_keys: set[tuple[str, int, str, str]] = set()
    for c in result.creditors:
        key4 = (c.iso3, c.year, c.kind, c.code)
        if key4 in creditor_keys:
            problems.append(f"Duplicate creditor row {key4}")
        creditor_keys.add(key4)
    return problems


def debt_consistency(result: Build) -> list[str]:
    """Warnings (not failures): creditor-type totals against public debt, and creditors against
    their type's total, where they differ by more than 1% and US$1 million."""
    notes = []
    value = {(o.indicator, o.iso3, o.year): o.value for o in result.observations}
    parts = (
        "external_debt_multilateral",
        "external_debt_bilateral",
        "external_debt_bondholders",
        "external_debt_commercial_banks",
        "external_debt_other_private",
    )
    for (indicator, iso3, year), total in value.items():
        if indicator != "external_debt_public":
            continue
        summed = sum(value.get((p, iso3, year), 0.0) for p in parts)
        if abs(summed - total) > max(0.01 * total, 1e6):
            notes.append(
                f"{iso3} {year}: creditor types sum to {summed:,.0f} US$ against public external "
                f"debt of {total:,.0f}"
            )
    kind_totals: dict[tuple[str, int, str], float] = {}
    for c in result.creditors:
        kind_totals[(c.iso3, c.year, c.kind)] = (
            kind_totals.get((c.iso3, c.year, c.kind), 0) + c.amount_usd
        )
    indicator_of = {
        "multilateral": "external_debt_multilateral",
        "bilateral": "external_debt_bilateral",
        "bondholders": "external_debt_bondholders",
        "commercial_banks": "external_debt_commercial_banks",
        "other_private": "external_debt_other_private",
    }
    for (iso3, year, kind), summed in sorted(kind_totals.items()):
        kind_total = value.get((indicator_of[kind], iso3, year))
        if kind_total is not None and abs(summed - kind_total) > max(0.01 * kind_total, 1e6):
            notes.append(
                f"{iso3} {year}: {kind.replace('_', ' ')} creditors sum to {summed:,.0f} US$ "
                f"against the total of {kind_total:,.0f}"
            )
    return notes


# ── Build ────────────────────────────────────────────────────────────────────


def build(*, refresh: bool, today: dt.date | None = None) -> Build:
    today = today or dt.date.today()
    iso3s = {c.iso3 for c in countries()}
    start = int(config()["start_year"])
    specs = indicator_specs()
    editions: dict[str, str] = {}
    updated_on: dict[str, str] = {}
    observations: list[Observation] = []
    trimmed: dict[str, tuple[int, int]] = {}

    weo_codes = sorted(
        {s["code"] for s in specs if s["source"] == "weo"}
        | {s["imf_fill"] for s in specs if "imf_fill" in s}
    )
    weo_values, weo_edition = parse_weo(fetch_weo(weo_codes, refresh=refresh), iso3s)
    editions[WEO.source_key] = weo_edition.label
    updated_on[WEO.source_key] = weo_edition.published.isoformat()
    cross_checks: list[CrossCheck] = []

    for spec in specs:
        if spec["source"] in {"wdi", "sipri"}:
            values, updated = parse_wdi(
                fetch_wdi(spec["code"], refresh=refresh, today=today), spec["code"], iso3s
            )
            source = WDI if spec["source"] == "wdi" else SIPRI
            label = "World Bank WDI" if spec["source"] == "wdi" else "SIPRI, via World Bank WDI"
            editions[source.source_key] = f"{label}, updated {updated}"
            updated_on[source.source_key] = updated
            rows = [
                Observation(spec["key"], v.iso3, v.year, v.value, "reported", source.source_key)
                for v in values
                if start <= v.year < today.year
            ]
            if "imf_fill" in spec:
                fills, checks = merge_imf(
                    spec, rows, weo_values.get(spec["imf_fill"], []), weo_edition
                )
                rows += fills
                cross_checks += checks
            if "max_years" in spec:
                rows, kept = keep_latest_years(rows, int(spec["max_years"]))
                if kept:
                    trimmed[spec["key"]] = kept
            observations += rows
        elif spec["source"] == "weo":
            observations += weo_observations(spec, weo_values.get(spec["code"], []), weo_edition)

    body, hdr_source = fetch_hdr(refresh=refresh)
    settings = config()["hdr"]
    hdi = (
        parse_hdr(body, iso3s)
        if hdr_source == HDR.source_key
        else parse_hdr_owid(body, settings["fallback_column"], iso3s)
    )
    editions[hdr_source] = settings["edition"] + (
        "" if hdr_source == HDR.source_key else " (via Our World in Data)"
    )
    observations += [
        Observation("hdi", v.iso3, v.year, v.value, "reported", hdr_source)
        for v in hdi
        if start <= v.year < today.year
    ]

    ids_settings = config()["ids"]
    totals: dict[str, list[IdsRow]] = {}
    for spec in specs:
        if spec["source"] != "ids":
            continue
        rows_, updated = parse_ids(
            fetch_ids_totals(spec["code"], refresh=refresh, today=today), iso3s
        )
        editions[IDS.source_key] = f"World Bank International Debt Statistics, updated {updated}"
        updated_on[IDS.source_key] = updated
        totals[spec["code"]] = rows_
        observations += [
            Observation(spec["key"], r.iso3, r.year, r.value, "reported", IDS.source_key)
            for r in rows_
            if r.counterpart == "WLD" and start <= r.year < today.year
        ]
    public = [o for o in observations if o.indicator == "external_debt_public"]
    if not public:
        raise IndicatorsError("IDS returned no public external debt; cannot place creditor years")
    latest = max(o.year for o in public)
    creditor_years = set(range(latest - int(ids_settings["creditor_years"]) + 1, latest + 1))
    by_kind: dict[str, list[IdsRow]] = {}
    for kind, code in ids_settings["creditor_series"].items():
        for year in sorted(creditor_years):
            rows_, _ = parse_ids(fetch_ids_creditors(code, year, refresh=refresh), iso3s)
            by_kind.setdefault(kind, []).extend(rows_)
    creditors = creditor_rows(by_kind, totals[ids_settings["bondholders_series"]], creditor_years)

    decimals = {s["key"]: int(s["decimals"]) for s in specs}
    observations = sorted(
        (
            Observation(
                o.indicator,
                o.iso3,
                o.year,
                _rounded(o.value, decimals[o.indicator]),
                o.basis,
                o.source,
            )
            for o in observations
        ),
        key=lambda o: ([s["key"] for s in specs].index(o.indicator), o.iso3, o.year),
    )
    result = Build(
        observations=observations,
        creditors=creditors,
        editions=editions,
        updated=updated_on,
        weo=weo_edition,
        hdr_source=hdr_source,
        cross_checks=cross_checks,
        trimmed=trimmed,
        today=today,
    )
    result.warnings += debt_consistency(result)
    problems = validate(result)
    if problems:
        raise IndicatorsValidationError(problems)
    return result


# ── Seeds ────────────────────────────────────────────────────────────────────


def _year_span(result: Build, sources: set[str]) -> tuple[int, int]:
    years = [o.year for o in result.observations if o.source in sources]
    return min(years), max(years)


def datasets(result: Build) -> list[dict[str, Any]]:
    def dataset(key: str, sources: set[str], **fields: Any) -> dict[str, Any]:
        first, last = _year_span(result, sources)
        dates = [result.updated[s] for s in sources if s in result.updated]
        return {
            "key": key,
            **fields,
            "coverage_start": f"{first}-01-01",
            "coverage_end": f"{last}-12-31",
            # The source's own update date; HDR publishes no machine-readable one.
            "as_of": max(dates) if dates else f"{last}-12-31",
            "refresh_cadence": "monthly",
        }

    hdr_attribution = (
        "Source: UNDP, Human Development Report 2025, Human Development Index (CC BY 3.0 IGO). "
        "Values are shown as published."
    )
    if result.hdr_source == HDR_VIA_OWID.source_key:
        hdr_attribution += " Retrieved from Our World in Data's copy of the UNDP series."
    rows = [
        dataset(
            DATASET_KEYS["wdi"],
            {WDI.source_key},
            name="World Bank World Development Indicators",
            provider="World Bank",
            license="CC BY 4.0",
            attribution="Source: World Bank, World Development Indicators (CC BY 4.0).",
        ),
        dataset(
            DATASET_KEYS["weo"],
            {WEO.source_key},
            name=f"{result.weo.label}: government debt and recent-year estimates",
            provider="International Monetary Fund",
            license="IMF Copyright and Usage terms (statistical data)",
            attribution=(
                "Source: International Monetary Fund, World Economic Outlook database "
                f"({result.weo.label.removeprefix('IMF WEO ')}), https://data.imf.org/. "
                f"Figures for {result.weo.year - 1} are IMF staff estimates; projections are "
                "not used."
            ),
        ),
        dataset(
            DATASET_KEYS["sipri"],
            {SIPRI.source_key},
            name="SIPRI Military Expenditure Database (via the World Bank)",
            provider="Stockholm International Peace Research Institute",
            license="SIPRI terms: non-commercial fair use (under 10% of the data set)",
            attribution=(
                "Source: SIPRI Military Expenditure Database, "
                "https://www.sipri.org/databases/milex (read through the World Bank's World "
                "Development Indicators). Used under SIPRI's fair-use terms; only the latest ten "
                "years are shown."
            ),
        ),
        dataset(
            DATASET_KEYS["hdr"],
            {HDR.source_key, HDR_VIA_OWID.source_key},
            name="UNDP Human Development Index",
            provider="United Nations Development Programme",
            license="CC BY 3.0 IGO",
            attribution=hdr_attribution,
        ),
        dataset(
            DATASET_KEYS["ids"],
            {IDS.source_key},
            name="World Bank International Debt Statistics",
            provider="World Bank",
            license="CC BY 4.0",
            attribution="Source: World Bank, International Debt Statistics (CC BY 4.0).",
        ),
    ]
    return rows


def sources_used(result: Build) -> list[dict[str, Any]]:
    used = {o.source for o in result.observations}
    return [s.seed() for s in (WDI, WEO, SIPRI, HDR, HDR_VIA_OWID, IDS) if s.source_key in used]


def _seed_value(observation: Observation, decimals: dict[str, int]) -> float | int:
    return int(observation.value) if decimals[observation.indicator] == 0 else observation.value


def indicators_payload(result: Build) -> dict[str, Any]:
    decimals = {s["key"]: int(s["decimals"]) for s in indicator_specs()}
    return {
        "$generated": generated(
            "indicators", weo_edition=result.weo.label, warnings=result.warnings
        ),
        "datasets": datasets(result),
        "sources": sources_used(result),
        "editions": dict(sorted(result.editions.items())),
        "indicators": table(
            [
                "key",
                "name",
                "unit",
                "decimals",
                "definition",
                "source_code",
                "dataset",
                "sort_order",
            ],
            [
                [
                    s["key"],
                    s["name"],
                    s["unit"],
                    s["decimals"],
                    s["definition"],
                    s["code"] if s["source"] != "hdr" else None,
                    DATASET_KEYS[s["source"]],
                    order,
                ]
                for order, s in enumerate(indicator_specs(), start=1)
            ],
        ),
        "observations": table(
            ["indicator", "iso3", "year", "value", "basis", "source"],
            [
                [o.indicator, o.iso3, o.year, _seed_value(o, decimals), o.basis, o.source]
                for o in result.observations
            ],
        ),
    }


def creditor_names(creditors: list[Creditor]) -> dict[str, str]:
    """Each creditor code's name (stored once in the seed); a code with two names is an error."""
    names: dict[str, str] = {}
    for c in creditors:
        if names.setdefault(c.code, c.name) != c.name:
            raise IndicatorsValidationError(
                [f"Creditor code {c.code} has two names: {names[c.code]!r} and {c.name!r}"]
            )
    return dict(sorted(names.items()))


def creditors_payload(result: Build) -> dict[str, Any]:
    return {
        "$generated": generated("indicators"),
        "creditor_names": creditor_names(result.creditors),
        "creditors": table(
            ["iso3", "year", "kind", "code", "amount_usd"],
            [[c.iso3, c.year, c.kind, c.code, round(c.amount_usd, 1)] for c in result.creditors],
        ),
    }


def configure(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--refresh", action="store_true", help="re-fetch instead of the cache")


def run(args: argparse.Namespace) -> int:
    try:
        result = build(refresh=bool(args.refresh))
    except IndicatorsValidationError as error:
        print(f"Validation failed ({len(error.problems)} problems):\n{error}")
        return 1
    write_seed(INDICATORS_SEED, indicators_payload(result))
    write_seed(CREDITORS_SEED, creditors_payload(result))
    indicators_report.write(result, COVERAGE_PATH, REPORT_PATH)
    counts = Counter(o.indicator for o in result.observations)
    estimates = sum(1 for o in result.observations if o.basis == "estimate")
    print(
        f"Indicators: {len(result.observations)} observations across {len(counts)} indicators "
        f"({estimates} IMF estimates for {result.weo.year - 1}), {len(result.creditors)} creditor "
        f"rows; {result.weo.label}. Wrote {COVERAGE_PATH.name} and {REPORT_PATH.name}."
    )
    for warning in result.warnings[:10]:
        print(f"  {warning}")
    if len(result.warnings) > 10:
        print(f"  … and {len(result.warnings) - 10} more in the review report.")
    return 0
