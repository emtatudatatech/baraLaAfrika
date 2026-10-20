"""`python -m pipelines gold-presence`: every country's gold presence tier, with its evidence,
confidence and source, into db/seeds/gold_presence.json (spec 5.6.5).

Rules (thresholds in gold_config.json; overrides in db/seeds/gold_presence_overrides.json):
  major_producer     the latest production figure is at least 20 t;
  producer           the latest production figure is above 0 t;
  occurrences_known  no current production figure, but a cited source documents gold: a USGS
                     table footnote listing gold among commodities that "may have been produced",
                     gold operations in the USGS structure-of-industry table, or past production;
  none_identified    the USGS chapters consulted show no gold at all;
  unknown            no USGS production table covers the country.
Trade is never used as evidence of deposits: gold can transit a country.
"""

from __future__ import annotations

import argparse
import datetime as dt
import re
from dataclasses import dataclass, field
from typing import Any

from .gold_citations import Checker, source_row
from .gold_common import (
    PRESENCE_OVERRIDES,
    PRESENCE_SEED,
    PRODUCTION_SEED,
    GoldValidationError,
    config,
    countries,
    generated,
    read_seed,
    records,
    write_seed,
)
from .gold_production import preferred

# USGS notes that change what a production figure counts.
CAVEAT_RE = re.compile(r"export|sales|transit|does not include|includes artisanal", re.IGNORECASE)
TRANSIT_RE = re.compile(r"transit", re.IGNORECASE)
TIER_ORDER = ["major_producer", "producer", "occurrences_known", "none_identified", "unknown"]


@dataclass
class Presence:
    iso3: str
    tier: str
    basis: str
    confidence: str
    as_of_year: int | None
    source: str | None
    commercial_mining: bool | None = None
    asm_present: bool | None = None
    asm_share_pct: float | None = None
    asm_source: str | None = None
    needs_review: bool = False
    review_notes: list[str] = field(default_factory=list)
    override: bool = False


def _fmt(tonnes: float) -> str:
    return f"{tonnes:,.1f}" if tonnes >= 1 else f"{tonnes:,.3f}".rstrip("0").rstrip(".")


def classify(
    iso3: str,
    best: dict[tuple[str, int], list[Any]],
    chapters: list[dict[str, Any]],
    titles: dict[str, str],
    today: dt.date,
) -> Presence:
    settings = config()["presence"]
    major = float(settings["major_producer_min_tonnes"])
    recent = int(settings["recent_years"])
    stale = int(settings["stale_after_years"])
    figures = sorted(
        (year, row) for (code, year), row in best.items() if code == iso3 and row[2] is not None
    )
    mine = sorted((c for c in chapters if c["iso3"] == iso3), key=lambda c: -c["edition_year"])
    newest_covered = max((c["edition_year"] for c in mine if c["covered"]), default=None)
    if figures:
        year, row = figures[-1]
        tonnes, basis, source = row[2], row[3], row[4]
        # A yearbook edition covers its last five years; a figure older than the newest
        # edition's window means that edition no longer reports gold output.
        superseded = newest_covered is not None and year < newest_covered - 4
        if tonnes > 0 and not superseded:
            age = today.year - year
            if age <= recent and basis == "reported":
                confidence = "high"
            elif age <= stale:
                confidence = "medium"
            else:
                confidence = "low"
            tier = "major_producer" if tonnes >= major else "producer"
            kind = "estimated" if basis == "estimate" else "reported"
            text = f"Mine production {_fmt(tonnes)} t in {year} ({kind}; {titles[source]})."
            # A yearbook figure carries its chapter's notes, or those of the newest earlier
            # chapter that has any (USGS repeats them only some years); MCS figures have none.
            chapter = next((c for c in mine if c["source"] == source), None)
            notes = chapter["gold_notes"] if chapter else []
            if chapter and not notes:
                notes = next(
                    (
                        c["gold_notes"]
                        for c in mine
                        if c["edition_year"] < chapter["edition_year"] and c["gold_notes"]
                    ),
                    [],
                )
            caveat = next((n for n in notes if CAVEAT_RE.search(n)), None)
            presence = Presence(iso3, tier, text, confidence, year, source)
            if caveat:
                presence.basis += f" The USGS notes: {caveat}"
                if TRANSIT_RE.search(caveat):
                    presence.needs_review = True
                    presence.review_notes.append(
                        "The USGS says this figure includes gold transiting the country, so the "
                        "tier may overstate domestic mining."
                    )
            return presence
    past = [(year, row) for year, row in figures if row[2] > 0]
    for chapter in mine:
        if chapter["may_have_been_produced"]:
            return Presence(
                iso3,
                "occurrences_known",
                "A USGS production table note lists gold among commodities that may have been "
                f"produced, without a reliable output estimate ({titles[chapter['source']]}).",
                "medium",
                chapter["edition_year"],
                chapter["source"],
            )
        if chapter["operations"]:
            return Presence(
                iso3,
                "occurrences_known",
                "The USGS lists gold operations in its structure-of-industry table, without a "
                f"production figure ({titles[chapter['source']]}).",
                "medium",
                chapter["edition_year"],
                chapter["source"],
            )
    if past:
        year, row = past[-1]
        latest_year, latest_row = figures[-1]
        if latest_row[2] == 0:
            since = f"reported production was zero in {latest_year} ({titles[latest_row[4]]})"
        else:
            since = f"newer USGS chapters (to {newest_covered}) give no figure"
        return Presence(
            iso3,
            "occurrences_known",
            f"Past mine production of {_fmt(row[2])} t in {year} ({titles[row[4]]}); {since}.",
            "medium",
            latest_year,
            latest_row[4],
        )
    covered = [c for c in mine if c["covered"]]
    if covered:
        newest = covered[0]
        confidence = "medium" if today.year - newest["edition_year"] <= stale else "low"
        editions = ", ".join(sorted({c["edition"] for c in covered}))
        return Presence(
            iso3,
            "none_identified",
            "No gold in the production tables, their notes or the industry tables of the USGS "
            f"Minerals Yearbook chapters consulted (editions {editions}).",
            confidence,
            newest["edition_year"],
            newest["source"],
        )
    return Presence(
        iso3,
        "unknown",
        "No USGS Minerals Yearbook production table covers this country in the editions consulted.",
        "low",
        None,
        None,
    )


def mining_context(presence: Presence, chapters: list[dict[str, Any]]) -> None:
    """Commercial and artisanal mining, as the USGS chapters state them (newest first)."""
    mine = sorted(
        (c for c in chapters if c["iso3"] == presence.iso3), key=lambda c: -c["edition_year"]
    )
    for chapter in mine:
        splits = chapter["asm_split"]
        if splits:
            year = max(splits, key=int)
            asm, total = splits[year]
            presence.asm_present = asm > 0 or presence.asm_present
            if total > asm:
                presence.commercial_mining = True
            if presence.asm_share_pct is None and total > 0:
                presence.asm_share_pct = round(100 * asm / total, 1)
                presence.asm_source = chapter["source"]
        texts = chapter["gold_notes"] + chapter["operations"]
        if any("artisanal" in t.lower() or "small-scale" in t.lower() for t in texts):
            presence.asm_present = True
        if chapter["excludes_artisanal"] and (chapter["latest_tonnes"] or 0) > 0:
            presence.commercial_mining = True
        companies = [
            op
            for op in chapter["operations"]
            if not re.match(r"^(artisanal|small-scale|various|do\b)", op, re.IGNORECASE)
        ]
        if companies:
            presence.commercial_mining = True


def overrides() -> list[dict[str, Any]]:
    data = read_seed(PRESENCE_OVERRIDES, producer="gold-presence")
    entries: list[dict[str, Any]] = data["overrides"]
    problems = []
    for entry in entries:
        if entry.get("presence_tier") not in TIER_ORDER:
            problems.append(
                f"Override {entry.get('iso3')}: unknown tier {entry.get('presence_tier')!r}"
            )
    if problems:
        raise GoldValidationError(problems)
    return entries


def apply_override(presence: Presence, entry: dict[str, Any], checker: Checker,
                   problems: list[str]) -> dict[str, Any] | None:  # fmt: skip
    """Replace the computed tier with a curated one; return its source row when cited."""
    presence.tier = entry["presence_tier"]
    presence.basis = entry["presence_basis"]
    presence.confidence = entry.get("presence_confidence", "medium")
    presence.as_of_year = entry.get("presence_as_of_year")
    presence.override = True
    for flag in ("commercial_mining", "asm_present"):
        if flag in entry:
            setattr(presence, flag, entry[flag])
    # The curated entry supersedes the computed tier's review flags.
    presence.needs_review = False
    presence.review_notes = []
    source = entry.get("source") or {}
    if not (source.get("title") and source.get("url") and entry.get("quote")):
        presence.source = None
        presence.needs_review = True
        presence.review_notes.append("Curated tier without a full citation.")
        return None
    check = checker.check(source["url"], entry["quote"])
    if check.found is False:
        problems.append(f"Override {entry['iso3']}: the quote is not in {source['url']}")
    elif check.found is None:
        presence.needs_review = True
        presence.review_notes.append(f"The quote could not be re-checked ({check.detail}).")
    row = source_row(source, "primary")
    presence.source = row["source_key"]
    return row


def build(
    today: dt.date | None = None, checker: Checker | None = None
) -> tuple[list[Presence], list[dict[str, Any]]]:
    today = today or dt.date.today()
    checker = checker or Checker()
    seed = read_seed(PRODUCTION_SEED, producer="gold-production")
    best = preferred(seed["production"]["rows"], seed["priority"])
    titles = {s["source_key"]: s["title"] for s in seed["sources"]}
    chapters: list[dict[str, Any]] = seed["chapters"]
    sources: dict[str, dict[str, Any]] = {}
    problems: list[str] = []
    result = []
    by_override = {o["iso3"]: o for o in overrides()}
    for country in countries():
        presence = classify(country.iso3, best, chapters, titles, today)
        mining_context(presence, chapters)
        entry = by_override.get(country.iso3)
        if entry is not None:
            row = apply_override(presence, entry, checker, problems)
            if row is not None:
                sources[row["source_key"]] = row
        elif presence.tier in {"major_producer", "producer"} and presence.confidence == "low":
            presence.needs_review = True
            presence.review_notes.append("The latest production figure is old.")
        result.append(presence)
    if problems:
        raise GoldValidationError(problems)
    return result, list(sources.values())


def payload(presences: list[Presence], sources: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "$generated": generated("gold-presence"),
        "datasets": [
            {
                "key": "gold-presence",
                "name": "Gold presence tiers (derived from the cited sources)",
                "provider": "Bara La Afrika (derived from USGS data and curated citations)",
                "license": "Derived data; each tier cites its source",
                "attribution": "Presence tiers derived by Bara La Afrika from the cited sources.",
                "coverage_start": None,
                "coverage_end": None,
                "as_of": dt.date.today().isoformat(),
                "refresh_cadence": "on_release",
            }
        ],
        "sources": sources,
        "presence": {
            "columns": [
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
            ],
            "rows": [
                [
                    p.iso3,
                    p.tier,
                    p.basis,
                    p.confidence,
                    p.as_of_year,
                    p.source,
                    p.commercial_mining,
                    p.asm_present,
                    p.asm_share_pct,
                    p.asm_source,
                    p.needs_review,
                    "\n".join(p.review_notes) or None,
                    p.override,
                ]
                for p in presences
            ],
        },
    }


def read_presence() -> list[dict[str, Any]]:
    return records(read_seed(PRESENCE_SEED, producer="gold-presence")["presence"])


def configure(parser: argparse.ArgumentParser) -> None:
    del parser  # no options


def run(args: argparse.Namespace) -> int:
    del args
    try:
        presences, sources = build()
    except GoldValidationError as error:
        print(f"Validation failed ({len(error.problems)} problems):\n{error}")
        return 1
    write_seed(PRESENCE_SEED, payload(presences, sources))
    counts = {tier: sum(1 for p in presences if p.tier == tier) for tier in TIER_ORDER}
    print("Gold presence: " + ", ".join(f"{tier} {n}" for tier, n in counts.items()) + ".")
    return 0
