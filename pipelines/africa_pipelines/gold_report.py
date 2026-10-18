"""Dhahabu validation (spec 5.6.9) and its two reports: data/gold_coverage_matrix.md
(country × metric, with the years available) and data/gold_review_report.md (conflicts and
gaps, listed rather than fixed).

Validation fails loudly, listing every problem: every country has a presence tier; no negative
quantities; included_in_other rows have no tonnes; no producer tier without a production figure;
every US dollar value uses the price of its own year or month (a missing price is an error, never
filled); every cited source exists.
"""

from __future__ import annotations

import datetime as dt
import json
from collections import defaultdict
from typing import Any

from .gold_common import (
    MINES_SEED,
    PRESENCE_SEED,
    PRICE_SEED,
    PRODUCTION_SEED,
    PROFILES_SEED,
    RESERVES_SEED,
    TRADE_SEED,
    GoldValidationError,
    config,
    countries,
    read_seed,
    records,
)
from .gold_production import preferred
from .settings import DATA_DIR, ROOT, troy_oz_per_tonne

MATRIX_PATH = DATA_DIR / "gold_coverage_matrix.md"
REPORT_PATH = DATA_DIR / "gold_review_report.md"
TIERS = ["major_producer", "producer", "occurrences_known", "none_identified", "unknown"]
TIER_LABELS = {
    "major_producer": "Major producer",
    "producer": "Producer",
    "occurrences_known": "Occurrences known",
    "none_identified": "None identified",
    "unknown": "Unknown",
}
NONE_IDENTIFIED = "No significant gold deposits identified in the sources consulted."


def load_all() -> dict[str, Any]:
    return {
        "price": read_seed(PRICE_SEED, producer="gold-price"),
        "production": read_seed(PRODUCTION_SEED, producer="gold-production"),
        "reserves": read_seed(RESERVES_SEED, producer="gold-official-reserves"),
        "trade": read_seed(TRADE_SEED, producer="gold-trade"),
        "presence": read_seed(PRESENCE_SEED, producer="gold-presence"),
        "profiles": read_seed(PROFILES_SEED, producer="gold-profiles"),
        "mines": read_seed(MINES_SEED, producer="gold-mines"),
    }


def price_tables(seeds: dict[str, Any]) -> tuple[dict[str, float], dict[int, float]]:
    """Monthly prices (YYYY-MM → price) and complete-year means (only years with 12 months)."""
    monthly = {
        r["month"][:7]: float(r["usd_per_troy_oz"]) for r in records(seeds["price"]["prices"])
    }
    by_year: dict[int, list[float]] = defaultdict(list)
    for month, price in monthly.items():
        by_year[int(month[:4])].append(price)
    annual = {year: sum(p) / len(p) for year, p in by_year.items() if len(p) == 12}
    return monthly, annual


def validate(seeds: dict[str, Any]) -> list[str]:
    problems: list[str] = []
    iso3s = [c.iso3 for c in countries()]
    monthly, annual = price_tables(seeds)

    presence = records(seeds["presence"]["presence"])
    tiers = {p["iso3"]: p for p in presence}
    if sorted(tiers) != sorted(iso3s) or len(presence) != len(iso3s):
        missing = sorted(set(iso3s) - set(tiers))
        problems.append(f"Presence tiers must cover the 54 countries once (missing: {missing})")
    for p in presence:
        if p["presence_tier"] not in TIERS:
            problems.append(f"{p['iso3']}: unknown presence tier {p['presence_tier']!r}")

    production = records(seeds["production"]["production"])
    positive = {r["iso3"] for r in production if r["tonnes"] is not None and r["tonnes"] > 0}
    for r in production:
        if (r["basis"] == "included_in_other") != (r["tonnes"] is None):
            problems.append(
                f"{r['iso3']} {r['year']} ({r['source']}): included_in_other must have "
                "no tonnes and every other row must have tonnes"
            )
        if r["tonnes"] is not None and r["tonnes"] < 0:
            problems.append(f"{r['iso3']} {r['year']}: negative production {r['tonnes']}")
        if r["tonnes"] is not None and r["year"] not in annual:
            problems.append(
                f"{r['iso3']} {r['year']}: no complete year of gold prices to value "
                "production (prices are never filled in)"
            )
    for p in presence:
        if (
            p["presence_tier"] in {"major_producer", "producer"}
            and p["iso3"] not in positive
            and not p["override"]
        ):
            problems.append(f"{p['iso3']}: tier {p['presence_tier']} without production evidence")
    for r in records(seeds["production"]["inground_reserves"]):
        if r["tonnes_contained"] < 0:
            problems.append(f"{r['iso3']} {r['year']}: negative in-ground reserves")

    troy = troy_oz_per_tonne()
    for r in records(seeds["reserves"]["reserves"]):
        month = r["as_of"][:7]
        if month not in monthly:
            problems.append(f"{r['iso3']} {month}: central bank holding without that month's price")
            continue
        if r["tonnes"] < 0 or r["value_usd"] < 0:
            problems.append(f"{r['iso3']} {month}: negative holding")
        expected = r["tonnes"] * troy * monthly[month]
        # Tonnes are stored to 3 decimals; the value comes from the unrounded ounces.
        tolerance = max(0.001 * expected, 0.0005 * troy * monthly[month]) + 0.01
        if abs(r["value_usd"] - expected) > tolerance:
            problems.append(
                f"{r['iso3']} {month}: value {r['value_usd']:,.0f} is not tonnes × "
                f"troy ounces × that month's price ({expected:,.0f})"
            )

    for name in ("trade", "partners", "total_exports"):
        for r in records(seeds["trade"][name]):
            if r["value_usd"] < 0 or (r.get("net_weight_kg") or 0) < 0:
                problems.append(f"{r['iso3']} {r['year']}: negative trade value or weight")
    ranks: dict[tuple[Any, ...], list[int]] = defaultdict(list)
    for r in records(seeds["trade"]["partners"]):
        ranks[(r["iso3"], r["year"], r["flow"], r["basis"])].append(r["rank"])
    for key, values in ranks.items():
        if sorted(values) != list(range(1, len(values) + 1)):
            problems.append(f"{key}: partner ranks are not 1..n")

    profiles = records(seeds["profiles"]["profiles"])
    for p in profiles:
        tier = tiers.get(p["iso3"], {}).get("presence_tier")
        if tier == "none_identified" and p["summary"] != NONE_IDENTIFIED:
            problems.append(f"{p['iso3']}: a none_identified summary must read {NONE_IDENTIFIED!r}")

    known = {s["source_key"] for seed in seeds.values() for s in seed.get("sources", [])}
    used = {r["source"] for r in production} | {
        r["source"] for r in records(seeds["price"]["prices"])
    }
    used |= {r["source"] for r in records(seeds["reserves"]["reserves"])}
    used |= {r["source"] for r in records(seeds["trade"]["trade"])}
    used |= {p["presence_source"] for p in presence if p["presence_source"]}
    used |= {p["asm_source"] for p in presence if p["asm_source"]}
    used |= {n["source"] for n in records(seeds["profiles"]["notes"])}
    for key in sorted(used - known):
        problems.append(f"Source {key!r} is cited but not defined in any gold seed")
    if troy != 32150.7466:
        problems.append(f"TROY_OZ_PER_TONNE is {troy}, expected 32150.7466")
    return problems


# ── Reports ──────────────────────────────────────────────────────────────────


def year_ranges(years: set[int]) -> str:
    if not years:
        return "—"
    ordered = sorted(years)
    spans: list[str] = []
    start = previous = ordered[0]
    following: list[int | None] = [*ordered[1:], None]
    for year in following:
        if year is not None and year == previous + 1:
            previous = year
            continue
        spans.append(str(start) if start == previous else f"{start}–{previous}")
        if year is not None:
            start = previous = year
    return ", ".join(spans)


def fmt_t(tonnes: float) -> str:
    return f"{tonnes:,.1f} t" if tonnes >= 1 else f"{tonnes * 1000:,.0f} kg"


def fmt_usd(value: float) -> str:
    if value >= 1e9:
        return f"US${value / 1e9:,.2f} bn"
    if value >= 1e6:
        return f"US${value / 1e6:,.1f} m"
    return f"US${value:,.0f}"


def _cell(text: str) -> str:
    return text.replace("|", "\\|").replace("\n", " ")


def coverage_matrix(seeds: dict[str, Any]) -> str:
    production = seeds["production"]
    best = preferred(production["production"]["rows"], production["priority"])
    presence = {p["iso3"]: p for p in records(seeds["presence"]["presence"])}
    inground: defaultdict[str, set[int]] = defaultdict(set)
    for r in records(production["inground_reserves"]):
        inground[r["iso3"]].add(r["year"])
    reserves: dict[str, list[str]] = defaultdict(list)
    for r in records(seeds["reserves"]["reserves"]):
        reserves[r["iso3"]].append(r["as_of"][:7])
    reporting = {r["iso3"]: r for r in records(seeds["reserves"]["reporting"])}
    trade: dict[tuple[str, str, str], set[int]] = defaultdict(set)
    for r in records(seeds["trade"]["trade"]):
        trade[(r["iso3"], r["flow"], r["basis"])].add(r["year"])
    totals: defaultdict[str, set[int]] = defaultdict(set)
    for r in records(seeds["trade"]["total_exports"]):
        totals[r["iso3"]].add(r["year"])
    notes: defaultdict[str, int] = defaultdict(int)
    for r in records(seeds["profiles"]["notes"]):
        notes[r["iso3"]] += 1

    lines = [
        "# Dhahabu coverage matrix",
        "",
        f"Generated by `python -m pipelines gold-profiles` on {dt.date.today().isoformat()}. "
        "One row per country; each cell lists the years (or months) with data. "
        'Production years count only figures (not "included in other countries"); '
        "**e** marks an estimate. Holdings status: current (reported within "
        f"{config()['official_reserves']['late_after_months']} months of the newest report), "
        "late (within 2 years), stale (older), pooled (held by the BCEAO), none (no IMF series).",
        "",
        "| Country | Presence tier | Mine production | Latest production | In-ground reserves | "
        "Central bank holdings | Exports (reported) | Exports (mirror) | Imports (reported) | "
        "Imports (mirror) | Total exports | Notes |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for c in countries():
        figures = {
            year: row for (iso3, year), row in best.items() if iso3 == c.iso3 and row[2] is not None
        }
        latest = ""
        if figures:
            year = max(figures)
            row = figures[year]
            latest = f"{fmt_t(row[2])} ({year}{' e' if row[3] == 'estimate' else ''})"
        months = reserves.get(c.iso3, [])
        status = reporting[c.iso3]["status"]
        holdings = f"{min(months)} to {max(months)} ({status})" if months else status
        lines.append(
            f"| {c.name} | {TIER_LABELS[presence[c.iso3]['presence_tier']]} | "
            f"{year_ranges(set(figures))} | {latest or '—'} | {year_ranges(inground[c.iso3])} | "
            f"{holdings} | {year_ranges(trade[(c.iso3, 'export', 'reported')])} | "
            f"{year_ranges(trade[(c.iso3, 'export', 'mirror')])} | "
            f"{year_ranges(trade[(c.iso3, 'import', 'reported')])} | "
            f"{year_ranges(trade[(c.iso3, 'import', 'mirror')])} | "
            f"{year_ranges(totals[c.iso3])} | {notes[c.iso3] or '—'} |"
        )
    counts = {t: sum(1 for p in presence.values() if p["presence_tier"] == t) for t in TIERS}
    lines += [
        "",
        "**Presence tiers:** "
        + ", ".join(f"{TIER_LABELS[t]} {n}" for t, n in counts.items())
        + ".",
    ]
    return "\n".join(lines) + "\n"


def trade_checks(seeds: dict[str, Any], annual: dict[int, float]) -> dict[str, list[str]]:
    production = seeds["production"]
    best = preferred(production["production"]["rows"], production["priority"])
    presence = {p["iso3"]: p for p in records(seeds["presence"]["presence"])}
    names = {c.iso3: c.name for c in countries()}
    rows = records(seeds["trade"]["trade"])
    by_key = {(r["iso3"], r["year"], r["flow"], r["basis"]): r for r in rows}
    out: dict[str, list[str]] = {
        "no_production": [],
        "weight_vs_production": [],
        "gaps": [],
        "unit_value": [],
        "no_reports": [],
    }
    troy = troy_oz_per_tonne()
    for c in countries():
        exports = sorted(
            (r for r in rows if r["iso3"] == c.iso3 and r["flow"] == "export"),
            key=lambda r: r["year"],
        )
        reported_years = {r["year"] for r in exports if r["basis"] == "reported"}
        if not reported_years:
            out["no_reports"].append(names[c.iso3])
        tier = presence[c.iso3]["presence_tier"]
        if tier in {"occurrences_known", "none_identified", "unknown"} and exports:
            latest = exports[-1]["year"]
            values = [r for r in exports if r["year"] == latest]
            top = max(values, key=lambda r: r["value_usd"])
            if top["value_usd"] >= 10e6:
                out["no_production"].append(
                    f"{names[c.iso3]} ({TIER_LABELS[tier]}): gold exports of "
                    f"{fmt_usd(top['value_usd'])} "
                    f"in {latest} ({top['basis']}) without a current production figure. Gold can "
                    "transit a country or come from unrecorded artisanal output; the tier is not "
                    "changed by trade data."
                )
        # Partners report late, so the newest year's mirror is incomplete: compare a year at
        # least two years back.
        settled = [y for y in reported_years if y <= dt.date.today().year - 2]
        for year in sorted(settled, reverse=True):
            reported = by_key.get((c.iso3, year, "export", "reported"))
            mirror = by_key.get((c.iso3, year, "export", "mirror"))
            if reported and mirror:
                high = max(reported["value_usd"], mirror["value_usd"])
                gap = abs(reported["value_usd"] - mirror["value_usd"])
                if high and gap / high > 0.5 and gap > 50e6:
                    out["gaps"].append(
                        f"{names[c.iso3]} {year}: reported exports "
                        f"{fmt_usd(reported['value_usd'])}, "
                        f"partners report {fmt_usd(mirror['value_usd'])} "
                        f"({mirror['partner_count']} "
                        f"partner{'s' if mirror['partner_count'] != 1 else ''})."
                    )
                break
        for r in exports:
            if r["basis"] != "reported" or not r["net_weight_kg"]:
                continue
            figure = best.get((c.iso3, r["year"]))
            if figure is not None and figure[2] and r["net_weight_kg"] / 1000 > 1.5 * figure[2]:
                out["weight_vs_production"].append(
                    f"{names[c.iso3]} {r['year']}: exports of {fmt_t(r['net_weight_kg'] / 1000)} "
                    f"against mine production of {fmt_t(figure[2])}."
                )
    for r in rows:
        if not r["net_weight_kg"] or r["year"] not in annual or r["value_usd"] < 1e6:
            continue
        per_oz = r["value_usd"] / (r["net_weight_kg"] / 1000 * troy)
        ratio = per_oz / annual[r["year"]]
        if ratio < 0.5 or ratio > 1.5:
            out["unit_value"].append(
                f"{names[r['iso3']]} {r['year']} {r['flow']} ({r['basis']}): "
                f"{fmt_usd(r['value_usd'])} "
                f"for {fmt_t(r['net_weight_kg'] / 1000)} is US${per_oz:,.0f}/oz against an average "
                f"price of US${annual[r['year']]:,.0f}/oz (doré or ore content, or a weight error)."
            )
    return out


def review_report(seeds: dict[str, Any]) -> str:
    _, annual = price_tables(seeds)
    names = {c.iso3: c.name for c in countries()}
    production = seeds["production"]
    titles = {
        s["source_key"]: s["title"] for seed in seeds.values() for s in seed.get("sources", [])
    }
    presence = records(seeds["presence"]["presence"])
    lines = [
        "# Dhahabu data review report",
        "",
        f"Generated by `python -m pipelines gold-profiles` on {dt.date.today().isoformat()}. "
        "Conflicts and gaps are listed here, not fixed silently. Sources and licences: "
        "[docs/dhahabu-sources.md](../docs/dhahabu-sources.md). Per-country coverage: "
        "[gold_coverage_matrix.md](gold_coverage_matrix.md).",
        "",
        "## Sources used in this build",
        "",
        "- **Price:** World Bank Pink Sheet monthly average (IMF PCPS as cross-check). "
        + "; ".join(seeds["price"]["$generated"]["warnings"]),
        "- **Production and in-ground reserves:** USGS Mineral Commodity Summaries "
        f"{', '.join(str(e) for e in config()['production']['mcs_editions'])} (gold chapter) and "
        "the USGS Minerals Yearbook country chapters (.xlsx editions since 2016). The British "
        "Geological Survey and the World Gold Council are not used (owner's decision, "
        "2026-10-18).",
        "- **Central bank holdings:** IMF International Liquidity (one call for 54 countries).",
        "- **Trade:** UN Comtrade, HS 7108 without 7108.20 "
        f"({seeds['trade']['$generated']['calls']} API calls in the last run).",
        "",
        "## Presence tiers",
        "",
        "Rules: major producer ≥ "
        f"{config()['presence']['major_producer_min_tonnes']} t in the latest year with a figure; "
        "producer > 0 t; occurrences known when a cited source documents gold without a current "
        "figure; none identified when the USGS chapters consulted show no gold; unknown when no "
        "USGS production table covers the country. Trade is never used as evidence of deposits.",
        "",
        "| Country | Tier | Confidence | Basis | Commercial mining | Artisanal mining | Review |",
        "|---|---|---|---|---|---|---|",
    ]
    yes_no = {True: "yes", False: "no", None: "—"}
    for p in presence:
        asm = yes_no[p["asm_present"]]
        if p["asm_share_pct_estimate"] is not None:
            asm += f" (~{p['asm_share_pct_estimate']:g}% of output)"
        review = (p["review_notes"] or "yes") if p["needs_review"] else ""
        if p["override"]:
            review = (review + " " if review else "") + "curated override"
        lines.append(
            f"| {names[p['iso3']]} | {TIER_LABELS[p['presence_tier']]} | "
            f"{p['presence_confidence']} | {_cell(p['presence_basis'])} | "
            f"{yes_no[p['commercial_mining']]} | {asm} | {review} |"
        )

    lines += [
        "",
        "## Production: sources that disagree",
        "",
        "Each edition is kept; the site shows one figure per country-year (a figure over "
        '"included in other", reported over estimated, then the newer edition). Differences '
        "above 10% (and 0.5 t):",
        "",
    ]
    lines += [f"- {c}" for c in production["conflicts"]] or ["- None."]

    lines += [
        "",
        '## Countries lumped into "Other countries"',
        "",
        "MCS lists only some producers by name. A country is stored as included in other "
        "(no tonnes) only where the USGS yearbook shows it producing gold in the five years "
        "before; its own yearbook figure, where there is one, is shown instead.",
        "",
    ]
    lumped: dict[str, list[str]] = defaultdict(list)
    for r in records(production["production"]):
        if r["basis"] == "included_in_other":
            lumped[r["source"]].append(f"{r['iso3']} {r['year']}")
    for source, items in sorted(lumped.items()):
        countries_in = sorted({i.split()[0] for i in items})
        lines.append(
            f"- {titles.get(source, source)}: {', '.join(names[c] for c in countries_in)}."
        )
    for edition, other in sorted(production["mcs_other_countries"].items()):
        years = other["years"]
        tonnes = other["tonnes"]
        lines.append(
            f'- MCS {edition} "Other countries" (world, not only Africa): '
            f"{tonnes[0]:,.0f} t in {years[0]}, {tonnes[1]:,.0f} t in {years[1]}."
        )

    lines += ["", "## In-ground reserves (geological, not central bank holdings)", ""]
    inground = defaultdict(list)
    for r in records(production["inground_reserves"]):
        inground[r["iso3"]].append(r)
    for iso3, entries in sorted(inground.items()):
        latest = max(entries, key=lambda r: r["year"])
        lines.append(
            f"- {names[iso3]}: {latest['tonnes_contained']:,.0f} t ({latest['year']}, "
            f"{titles.get(latest['source'], latest['source'])})."
        )
    lines.append("- Every other country: no in-ground reserve figure in the sources consulted.")

    lines += [
        "",
        "## Central bank holdings: late, irregular and missing reporters",
        "",
        "| Country | Status | Latest month | Note |",
        "|---|---|---|---|",
    ]
    for r in sorted(
        records(seeds["reserves"]["reporting"]),
        key=lambda r: (
            ["current", "late", "stale", "pooled", "none"].index(r["status"]),
            r["iso3"],
        ),
    ):
        if r["status"] == "current":
            continue
        lines.append(
            f"| {names[r['iso3']]} | {r['status']} | {(r['last'] or '—')[:7]} | "
            f"{_cell(r['note'])} |"
        )
    current = [
        names[r["iso3"]]
        for r in records(seeds["reserves"]["reporting"])
        if r["status"] == "current"
    ]
    lines += ["", f"Current reporters ({len(current)}): {', '.join(current)}."]
    for warning in seeds["reserves"]["$generated"].get("warnings", []):
        lines.append(f"- {warning}")

    checks = trade_checks(seeds, annual)
    lines += ["", "## Trade", "", "### Exports without a current production figure", ""]
    lines += [f"- {x}" for x in checks["no_production"]] or ["- None."]
    lines += [
        "",
        "### Reported exports versus partners' reports (latest settled year with both)",
        "",
        "Compared in the latest year at least two years back, since partners report late. Gaps "
        "are normal and informative (valuation, timing, classification, transit, unrecorded "
        "flows); they are shown, not corrected.",
        "",
    ]
    lines += [f"- {x}" for x in checks["gaps"]] or ["- None above 50%."]
    lines += ["", "### Exported weight above 1.5 × mine production (same year)", ""]
    lines += [f"- {x}" for x in checks["weight_vs_production"]] or ["- None."]
    lines += ["", "### Unit values far from the gold price", ""]
    lines += [f"- {x}" for x in checks["unit_value"][:60]] or ["- None."]
    if len(checks["unit_value"]) > 60:
        lines.append(f"- … and {len(checks['unit_value']) - 60} more.")
    lines += [
        "",
        "### Countries with no gold trade reported by themselves",
        "",
        (", ".join(checks["no_reports"]) or "None") + ". Their mirror figures still show "
        "what partners recorded.",
    ]

    mines = seeds["mines"]
    evaluation = mines["evaluation"]
    lines += [
        "",
        "## Mines layer (optional)",
        "",
        f"**{'Enabled' if mines['layer_enabled'] else 'Not enabled'}.** Quality bar "
        "(gold_config.json):",
        "",
    ]
    for check, (value, threshold, passed) in evaluation["checks"].items():
        lines.append(
            f"- {check.replace('_', ' ')}: {value} (bar {threshold}) — "
            f"{'passes' if passed else 'fails'}"
        )
    lines += [
        f"- Producers without any mine in Wikidata: "
        f"{', '.join(names[i] for i in evaluation['producers_missing']) or 'none'}.",
        f"- Mines per country: {json.dumps(evaluation['per_country'])}.",
        "",
        "Dropped items:",
        "",
    ]
    for qid, iso3, name, reason in mines["dropped"]["rows"]:
        lines.append(f"- {qid} {name} ({names[iso3]}): {reason}")

    excluded = [
        f"{names[c['iso3']]}, Minerals Yearbook {c['edition']}: {x}"
        for c in production["chapters"]
        for x in c.get("excluded_figures", [])
    ]
    lines += [
        "",
        "## Figures left out",
        "",
        "Figures the USGS attributes to the World Gold Council (owner's decision to leave "
        "WGC data out, 2026-10-18); the other editions' figures are used instead:",
        "",
    ]
    lines += [f"- {x}" for x in excluded] or ["- None."]

    lines += ["", "## Parse warnings and notes", ""]
    warnings = production["$generated"].get("warnings", [])
    lines += [f"- {w}" for w in warnings] or ["- None."]
    for note in seeds["trade"]["$generated"].get("notes", []):
        lines.append(f"- Trade: {note}")
    missing = seeds["price"]["$generated"].get("missing_months", [])
    lines.append(f"- Price months missing inside the series: {', '.join(missing) or 'none'}.")

    lines += ["", "## Needs review", ""]
    review = [p for p in presence if p["needs_review"] or p["presence_tier"] == "unknown"]
    for p in review:
        reason = p["review_notes"] or "No USGS production table; a cited source is needed."
        lines.append(f"- {names[p['iso3']]} ({TIER_LABELS[p['presence_tier']]}): {reason}")
    notes = [n for n in records(seeds["profiles"]["notes"]) if n["needs_review"]]
    for n in notes:
        lines.append(f"- {names[n['iso3']]} note {n['sort_order']}: {n['review_notes']}")
    if not review and not notes:
        lines.append("- Nothing.")
    return "\n".join(lines) + "\n"


def validate_and_report() -> str:
    seeds = load_all()
    problems = validate(seeds)
    if problems:
        raise GoldValidationError(problems)
    MATRIX_PATH.write_text(coverage_matrix(seeds), encoding="utf-8")
    REPORT_PATH.write_text(review_report(seeds), encoding="utf-8")
    return (
        f"Validation passed. Wrote {MATRIX_PATH.relative_to(ROOT)} and "
        f"{REPORT_PATH.relative_to(ROOT)}."
    )
