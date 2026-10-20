"""`python -m pipelines gold-profiles`: each country's gold summary and profile notes into
db/seeds/gold_profiles.json (spec 5.6.7), then the whole Dhahabu validation and its two reports.

Summaries are built only from the sourced figures and tiers. Notes come from two places: the
footnotes the USGS attaches to a country's gold figures (quoted verbatim, attributed and dated),
and the curated notes in db/seeds/gold_profile_notes.json, each of which must cite a source with
the exact quote it relies on (otherwise it is loaded as needs_review). Nothing unsourced.
"""

from __future__ import annotations

import argparse
import datetime as dt
from typing import Any

from . import gold_report
from .gold_citations import Checker, source_row
from .gold_common import (
    PRODUCTION_SEED,
    PROFILE_NOTES,
    PROFILES_SEED,
    GoldValidationError,
    country_names,
    generated,
    read_seed,
    table,
    write_seed,
)
from .gold_presence import read_presence

NONE_IDENTIFIED = "No significant gold deposits identified in the sources consulted."


def summary(name: str, presence: dict[str, Any]) -> str:
    tier = presence["presence_tier"]
    share = presence["asm_share_pct_estimate"]
    if tier in {"major_producer", "producer"}:
        text = f"{name} produces gold. {presence['presence_basis']}"
        if share is not None:
            text += (
                f" Artisanal and small-scale mining accounted for about {share:g}% of "
                "recorded output in the latest year the USGS splits it."
            )
        elif presence["asm_present"]:
            text += " The USGS also reports artisanal gold mining."
        return text
    if tier == "occurrences_known":
        lead = (
            "Artisanal gold mining is reported in"
            if presence["asm_present"]
            else "Gold occurrences are documented in"
        )
        return (
            f"{lead} {name}, but the sources consulted give no current production figure. "
            f"{presence['presence_basis']}"
        )
    if tier == "none_identified":
        return NONE_IDENTIFIED
    return "Not enough information in the sources consulted to say whether gold is mined here."


def usgs_notes(chapters: list[dict[str, Any]]) -> list[list[Any]]:
    """The footnotes on each country's gold figures, from its newest chapter that has any."""
    rows: list[list[Any]] = []
    for iso3 in sorted({c["iso3"] for c in chapters}):
        mine = sorted(
            (c for c in chapters if c["iso3"] == iso3 and c["gold_notes"]),
            key=lambda c: -c["edition_year"],
        )
        if not mine:
            continue
        chapter = mine[0]
        as_of = chapter["data_through"] or f"{chapter['edition_year']}-12-31"
        for note in chapter["gold_notes"]:
            text = f"USGS gold production figures (Minerals Yearbook {chapter['edition']}): {note}"
            rows.append([iso3, text, chapter["source"], as_of, False, None])
    return rows


def curated_notes(
    checker: Checker,
) -> tuple[list[list[Any]], list[dict[str, Any]], list[str]]:
    """Curated notes, each re-checked against its source's text."""
    data = read_seed(PROFILE_NOTES, producer="gold-profiles")
    rows: list[list[Any]] = []
    sources: dict[str, dict[str, Any]] = {}
    problems: list[str] = []
    names = country_names()
    for index, entry in enumerate(data["notes"], start=1):
        iso3 = entry.get("iso3")
        if iso3 not in names:
            problems.append(f"Curated note {index}: unknown country {iso3!r}")
            continue
        source = entry.get("source") or {}
        if not (source.get("title") and source.get("url") and entry.get("quote")):
            problems.append(
                f"Curated note {index} ({iso3}) has no full citation; a note needs a "
                "source and the exact quote (spec 5.6.7)."
            )
            continue
        try:
            as_of = dt.date.fromisoformat(entry["as_of"]).isoformat()
        except KeyError, ValueError:
            problems.append(f"Curated note {index} ({iso3}) needs an as_of date (YYYY-MM-DD)")
            continue
        check = checker.check(source["url"], entry["quote"])
        if check.found is False:
            problems.append(f"Curated note {index} ({iso3}): the quote is not in {source['url']}")
            continue
        review_notes = None
        if check.found is None:
            review_notes = f"The quote could not be re-checked ({check.detail})."
        row = source_row(source, "secondary")
        sources[row["source_key"]] = row
        rows.append([iso3, entry["note"], row["source_key"], as_of, review_notes is not None,
                     review_notes])  # fmt: skip
    return rows, list(sources.values()), problems


def build() -> dict[str, Any]:
    names = country_names()
    presence = {p["iso3"]: p for p in read_presence()}
    chapters = read_seed(PRODUCTION_SEED, producer="gold-production")["chapters"]
    curated, sources, problems = curated_notes(Checker())
    if problems:
        raise GoldValidationError(problems)
    by_country: dict[str, list[list[Any]]] = {}
    for row in usgs_notes(chapters) + curated:
        by_country.setdefault(row[0], []).append(row)
    notes = [
        [iso3, order, *row[1:]]
        for iso3, rows in sorted(by_country.items())
        for order, row in enumerate(rows, start=1)
    ]
    return {
        "$generated": generated("gold-profiles"),
        "sources": sources,
        "profiles": table(
            ["iso3", "summary"], [[iso3, summary(names[iso3], presence[iso3])] for iso3 in names]
        ),
        "notes": table(
            ["iso3", "sort_order", "note", "source", "as_of", "needs_review", "review_notes"], notes
        ),
    }


def configure(parser: argparse.ArgumentParser) -> None:
    del parser  # no options


def run(args: argparse.Namespace) -> int:
    del args
    try:
        write_seed(PROFILES_SEED, build())
        report = gold_report.validate_and_report()
    except GoldValidationError as error:
        print(f"Validation failed ({len(error.problems)} problems):\n{error}")
        return 1
    print(report)
    return 0
