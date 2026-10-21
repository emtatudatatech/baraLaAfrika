"""Paths, environment and shared constants for the pipelines."""

from __future__ import annotations

import json
import os
from functools import cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data"
SOURCE_DIR = DATA_DIR / "source"
RAW_DIR = DATA_DIR / "raw"
SEEDS_DIR = ROOT / "db" / "seeds"
MIGRATIONS_DIR = ROOT / "db" / "migrations"
WEB_PUBLIC_DIR = ROOT / "apps" / "web" / "public"
CONSTANTS_FILE = ROOT / "config" / "constants.json"

USER_AGENT = (
    "BaraLaAfrika-pipelines/0.1 (+https://github.com/emtatudatatech; educational open-data project)"
)


@cache
def _constants() -> dict[str, float]:
    data: dict[str, float] = json.loads(CONSTANTS_FILE.read_text())
    return data


def troy_oz_per_tonne() -> float:
    """Troy ounces per metric tonne, from config/constants.json (single source of truth)."""
    return _constants()["TROY_OZ_PER_TONNE"]


def load_dotenv(path: Path | None = None) -> None:
    """Load KEY=VALUE lines from ``.env`` without overriding variables already set."""
    env_file = path or ROOT / ".env"
    if not env_file.is_file():
        return
    for line in env_file.read_text().splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, _, value = stripped.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


def env_flag(name: str, *, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None or value == "":
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


class MissingSettingError(RuntimeError):
    pass


def require_env(name: str, *, purpose: str) -> str:
    """A required setting's value. Surrounding quotes are dropped, as in .env, so a value set
    with quotes (in .env or a CI secret) reads the same everywhere."""
    value = os.environ.get(name, "").strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
        value = value[1:-1].strip()
    if value.startswith(f"{name}="):
        raise MissingSettingError(
            f"{name} holds '{name}=…': set it to the value alone, without the name "
            f"(check the GitHub Actions secret or .env)."
        )
    if not value:
        raise MissingSettingError(
            f"{name} is not set. It is needed to {purpose}. "
            f"Add it to .env (local) or the GitHub Actions secrets (CI); see .env.example."
        )
    return value
