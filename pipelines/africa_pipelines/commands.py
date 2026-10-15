"""Registry of CLI commands. Each milestone adds its pipeline commands here."""

from __future__ import annotations

from pipelines.africa_pipelines import boundaries, extract_pdf, flags, load, migrate, status
from pipelines.cli import Command

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
