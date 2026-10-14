"""Command-line entry point: ``python -m pipelines <command> [options]``.

Each pipeline module registers a command here. Commands are idempotent and can be re-run.
"""

from __future__ import annotations

import argparse
import logging
import sys
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from pipelines.africa_pipelines.settings import load_dotenv


@dataclass(frozen=True)
class Command:
    name: str
    help: str
    configure: Callable[[argparse.ArgumentParser], None]
    run: Callable[[argparse.Namespace], int]


def _commands() -> list[Command]:
    # Imported lazily so `--help` works without optional native dependencies.
    from pipelines.africa_pipelines import commands

    return commands.ALL


def build_parser(commands: Sequence[Command]) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m pipelines",
        description="Bara La Afrika data pipelines.",
    )
    parser.add_argument("-v", "--verbose", action="store_true", help="debug logging")
    sub = parser.add_subparsers(dest="command", required=True, metavar="<command>")
    for command in commands:
        command_parser = sub.add_parser(command.name, help=command.help, description=command.help)
        command.configure(command_parser)
        command_parser.set_defaults(_run=command.run)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    load_dotenv()
    parser = build_parser(_commands())
    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(name)s: %(message)s",
        stream=sys.stderr,
    )
    run: Callable[[argparse.Namespace], int] = args._run
    return run(args)
