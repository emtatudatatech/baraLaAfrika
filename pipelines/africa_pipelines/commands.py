"""Registry of CLI commands. Each milestone adds its pipeline commands here."""

from __future__ import annotations

import argparse

from pipelines.africa_pipelines import (
    boundaries,
    extract_pdf,
    flags,
    gold_mines,
    gold_presence,
    gold_price,
    gold_production,
    gold_profiles,
    gold_reserves,
    gold_trade,
    harim,
    load,
    migrate,
    status,
)
from pipelines.cli import Command

GOLD_STEPS = (
    gold_price,
    gold_production,
    gold_reserves,
    gold_trade,
    gold_mines,
    gold_presence,
    gold_profiles,
)


def _configure_gold(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--refresh", action="store_true", help="re-fetch instead of the cache")


def _run_gold(args: argparse.Namespace) -> int:
    for step in GOLD_STEPS:
        status = int(step.run(args))
        if status:
            return status
    return 0


ALL: list[Command] = [
    Command(
        name="migrate",
        help="Apply pending SQL migrations from db/migrations (uses DATABASE_URL_WRITE).",
        configure=migrate.configure,
        run=migrate.run,
    ),
    Command(
        name="extract-pdf",
        help="Extract the research PDF into validated seeds and data/review_report.md.",
        configure=extract_pdf.configure,
        run=extract_pdf.run,
    ),
    Command(
        name="flags",
        help="Fetch Flagpedia flags, compute flag palettes and region colours, write the report.",
        configure=flags.configure,
        run=flags.run,
    ),
    Command(
        name="boundaries",
        help="Build the map topologies from Natural Earth and compute country anchors/markers.",
        configure=boundaries.configure,
        run=boundaries.run,
    ),
    Command(
        name="mountains",
        help="Build the Harim catalogue (prototype, Wikidata, Factbook, GeoNames) and its report.",
        configure=harim.configure,
        run=harim.run,
    ),
    Command(
        name="gold-price",
        help="Fetch the monthly gold price (World Bank Pink Sheet; IMF fallback) into a seed.",
        configure=gold_price.configure,
        run=gold_price.run,
    ),
    Command(
        name="gold-production",
        help="Gold mine production and in-ground reserves (USGS MCS and Minerals Yearbook).",
        configure=gold_production.configure,
        run=gold_production.run,
    ),
    Command(
        name="gold-official-reserves",
        help="Fetch central bank gold holdings (IMF International Liquidity) into a seed.",
        configure=gold_reserves.configure,
        run=gold_reserves.run,
    ),
    Command(
        name="gold-trade",
        help="Fetch gold trade, reported and mirror, from UN Comtrade (needs COMTRADE_API_KEY).",
        configure=gold_trade.configure,
        run=gold_trade.run,
    ),
    Command(
        name="gold-mines",
        help="Evaluate Wikidata gold mines for the optional map layer (kept only if good enough).",
        configure=gold_mines.configure,
        run=gold_mines.run,
    ),
    Command(
        name="gold-presence",
        help="Classify each country's gold presence tier with its evidence (after production).",
        configure=gold_presence.configure,
        run=gold_presence.run,
    ),
    Command(
        name="gold-profiles",
        help="Write gold summaries and notes, validate all gold seeds and write the two reports.",
        configure=gold_profiles.configure,
        run=gold_profiles.run,
    ),
    Command(
        name="gold",
        help="Run every gold pipeline in order (price, production, reserves, trade, mines, "
        "presence, profiles).",
        configure=_configure_gold,
        run=_run_gold,
    ),
    Command(
        name="load",
        help="Upsert the seeds into the database (uses DATABASE_URL_WRITE).",
        configure=load.configure,
        run=load.run,
    ),
    Command(
        name="status",
        help="Print the freshness of every dataset (uses DATABASE_URL_WRITE).",
        configure=status.configure,
        run=status.run,
    ),
]
