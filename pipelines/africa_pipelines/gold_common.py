"""Shared pieces of the Dhahabu (gold) pipelines: settings, the 54 countries, source records,
compact seed files and the IMF SDMX-JSON reader.

Seeds with many rows store them as {"columns": [...], "rows": [[...], ...]} with one row per
line, so they stay small and diff well. Every gold seed carries the `datasets` and `sources` rows
it relies on, and `load` upserts them with the data.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import re
import unicodedata
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Any

from .settings import RAW_DIR, ROOT, SEEDS_DIR, troy_oz_per_tonne

CONFIG_FILE = Path(__file__).parent / "reference" / "gold_config.json"
GOLD_RAW = RAW_DIR / "gold"

PRICE_SEED = SEEDS_DIR / "gold_price.json"
PRODUCTION_SEED = SEEDS_DIR / "gold_production.json"
RESERVES_SEED = SEEDS_DIR / "gold_reserves.json"
TRADE_SEED = SEEDS_DIR / "gold_trade.json"
PRESENCE_SEED = SEEDS_DIR / "gold_presence.json"
PROFILES_SEED = SEEDS_DIR / "gold_profiles.json"
MINES_SEED = SEEDS_DIR / "gold_mines.json"
PRESENCE_OVERRIDES = SEEDS_DIR / "gold_presence_overrides.json"
PROFILE_NOTES = SEEDS_DIR / "gold_profile_notes.json"


class GoldError(RuntimeError):
    pass


class GoldValidationError(GoldError):
    """Raised with every problem found, so a run lists them all at once."""

    def __init__(self, problems: list[str]) -> None:
        self.problems = problems
        super().__init__("\n".join(f"  - {p}" for p in problems))


@cache
def config() -> dict[str, Any]:
    data: dict[str, Any] = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    return data


@dataclass(frozen=True)
class Country:
    iso3: str
    iso2: str
    m49: int
    name: str
    region: str


@cache
def countries() -> tuple[Country, ...]:
    seed = json.loads((SEEDS_DIR / "countries.json").read_text(encoding="utf-8"))
    return tuple(
        Country(c["iso3"], c["iso2"], int(c["iso_numeric"]), c["name"], c["region"])
        for c in seed["countries"]
    )


def country_names() -> dict[str, str]:
    return {c.iso3: c.name for c in countries()}


def fold(text: str) -> str:
    """Lowercase ASCII with single spaces, for matching names across sources."""
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", ascii_text).strip().lower()


def tonnes_from_troy_oz(troy_oz: float) -> float:
    return troy_oz / troy_oz_per_tonne()


@dataclass(frozen=True)
class SourceRecord:
    """A row of `sources`: every gold figure cites one."""

    source_key: str
    title: str
    url: str
    source_type: str = "statistics"
    reliability_tier: str = "primary"

    def seed(self) -> dict[str, Any]:
        return {
            "source_key": self.source_key,
            "ref_no": None,
            "title": self.title,
            "url": self.url,
            "source_type": self.source_type,
            "reliability_tier": self.reliability_tier,
        }


def table(columns: list[str], rows: list[list[Any]]) -> dict[str, Any]:
    return {"columns": columns, "rows": rows}


def records(seed_table: dict[str, Any]) -> list[dict[str, Any]]:
    """A compact seed table as a list of dicts."""
    columns: list[str] = seed_table["columns"]
    return [dict(zip(columns, row, strict=True)) for row in seed_table["rows"]]


def _render(value: Any, indent: int) -> str:
    pad = " " * indent
    if isinstance(value, dict) and set(value) == {"columns", "rows"}:
        rows = ",\n".join(
            f"{pad}    " + json.dumps(row, ensure_ascii=False) for row in value["rows"]
        )
        columns = json.dumps(value["columns"], ensure_ascii=False)
        body = f"\n{rows}\n{pad}  " if value["rows"] else ""
        return f'{{\n{pad}  "columns": {columns},\n{pad}  "rows": [{body}]\n{pad}}}'
    if isinstance(value, dict) and value:
        items = ",\n".join(
            f"{pad}  {json.dumps(k, ensure_ascii=False)}: {_render(v, indent + 2)}"
            for k, v in value.items()
        )
        return f"{{\n{items}\n{pad}}}"
    if isinstance(value, list) and value and all(isinstance(v, dict) for v in value):
        items = ",\n".join(f"{pad}  {_render(v, indent + 2)}" for v in value)
        return f"[\n{items}\n{pad}]"
    return json.dumps(value, ensure_ascii=False)


def write_seed(path: Path, payload: dict[str, Any]) -> None:
    body = _render(payload, 0) + "\n"
    json.loads(body)  # the renderer must produce valid JSON
    path.write_text(body, encoding="utf-8")
    digest = hashlib.sha256(body.encode()).hexdigest()[:12]
    print(f"Wrote {path.relative_to(ROOT)} ({digest})")


def read_seed(path: Path, *, producer: str) -> dict[str, Any]:
    if not path.exists():
        raise GoldError(f"Missing {path.relative_to(ROOT)}; run `python -m pipelines {producer}`.")
    data: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    return data


def generated(by: str, **extra: Any) -> dict[str, Any]:
    return {"by": f"python -m pipelines {by}", "generated_on": dt.date.today().isoformat(), **extra}


def month_end(month_start: dt.date) -> dt.date:
    next_month = (month_start.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
    return next_month - dt.timedelta(days=1)


def months_between(earlier: dt.date, later: dt.date) -> int:
    return (later.year - earlier.year) * 12 + later.month - earlier.month


# ── IMF SDMX 3.0 JSON ────────────────────────────────────────────────────────

PERIOD_RE = re.compile(r"^(\d{4})-M(\d{2})$")


def imf_month(period: str) -> dt.date:
    """`2026-M07` → 2026-07-01."""
    match = PERIOD_RE.match(period)
    if match is None:
        raise GoldError(f"Unexpected IMF period {period!r} (monthly periods look like 2026-M07)")
    return dt.date(int(match[1]), int(match[2]), 1)


def imf_series(payload: dict[str, Any]) -> dict[tuple[str, ...], dict[str, float]]:
    """Series key (dimension values in key order) → {period: value}; empty observations dropped.

    OBS_VALUE is in units. The series' SCALE attribute (6 for these series) only says how the IMF
    displays them, in millions: Ghana's 790,264.206 fine troy ounces in 2026-M07 is 24.6 t."""
    try:
        data = payload["data"]
        structure = data["structures"][0]
        dataset = data["dataSets"][0]
    except (KeyError, IndexError) as error:
        raise GoldError(f"Unexpected IMF response shape: {error}") from error
    series_dims = structure["dimensions"]["series"]
    times = [_sdmx_id(v) for v in structure["dimensions"]["observation"][0]["values"]]
    result: dict[tuple[str, ...], dict[str, float]] = {}
    for key, series in dataset.get("series", {}).items():
        indices = [int(i) for i in key.split(":")]
        dims = tuple(_sdmx_id(series_dims[d]["values"][i]) for d, i in enumerate(indices))
        observations: dict[str, float] = {}
        for index, observation in series.get("observations", {}).items():
            value = observation[0] if observation else None
            if value is None or value == "":
                continue
            observations[times[int(index)]] = float(value)
        if observations:
            result[dims] = observations
    return result


def _sdmx_id(value: dict[str, Any]) -> str:
    identifier = value.get("id", value.get("value"))
    if not isinstance(identifier, str):
        raise GoldError(f"IMF value without an id: {value!r}")
    return identifier
