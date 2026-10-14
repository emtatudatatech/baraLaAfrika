"""Registry of CLI commands. Each milestone adds its pipeline commands here."""

from __future__ import annotations

from pipelines.africa_pipelines import extract_pdf, migrate
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
]
