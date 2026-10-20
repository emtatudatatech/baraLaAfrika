"""Wikidata Query Service client: SPARQL over HTTP GET with the pipelines' descriptive
User-Agent, a polite interval between requests, and an on-disk cache keyed by the query text
(raw JSON under data/raw/wikidata/), so re-runs are reproducible and do not re-query."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

from .http import fetch_bytes
from .settings import RAW_DIR

ENDPOINT = "https://query.wikidata.org/sparql"
CACHE_DIR = RAW_DIR / "wikidata"
# WDQS asks clients to keep request rates low; one query every two seconds is well within it.
MIN_INTERVAL_SECONDS = 2.0
# WDQS stops queries after 60 s; wait slightly longer so its own error reaches us.
TIMEOUT_SECONDS = 65.0

ENTITY_PREFIX = "http://www.wikidata.org/entity/"

# Units of length that elevations, prominence and isolation use in Wikidata, in metres.
METRE = "Q11573"
UNIT_METRES: dict[str, float] = {
    METRE: 1.0,
    "Q3710": 0.3048,  # foot
    "Q828224": 1000.0,  # kilometre
}


class WikidataError(RuntimeError):
    pass


# Cache files read or written in this process, so a run can report its snapshot date.
USED_CACHE_FILES: set[Path] = set()


Row = dict[str, str]


def query_cache_path(query: str, *, cache_dir: Path = CACHE_DIR) -> Path:
    digest = hashlib.sha256(query.strip().encode()).hexdigest()[:20]
    return cache_dir / f"{digest}.json"


def sparql(query: str, *, refresh: bool = False, cache_dir: Path = CACHE_DIR) -> list[Row]:
    """Run a SELECT query; each row maps variable names to their string values."""
    url = f"{ENDPOINT}?{urlencode({'query': query.strip(), 'format': 'json'})}"
    cache_path = query_cache_path(query, cache_dir=cache_dir)
    USED_CACHE_FILES.add(cache_path)
    body = fetch_bytes(
        url,
        cache_path,
        refresh=refresh,
        min_interval=MIN_INTERVAL_SECONDS,
        timeout=TIMEOUT_SECONDS,
    )
    try:
        payload: dict[str, Any] = json.loads(body)
        bindings: list[dict[str, dict[str, str]]] = payload["results"]["bindings"]
    except (ValueError, KeyError) as error:
        raise WikidataError(
            f"Unexpected response from the Wikidata Query Service: {error}"
        ) from error
    return [{name: cell["value"] for name, cell in row.items()} for row in bindings]


def qid(uri: str) -> str:
    """`http://www.wikidata.org/entity/Q114` → `Q114`."""
    if not uri.startswith(ENTITY_PREFIX):
        raise WikidataError(f"Not a Wikidata entity URI: {uri!r}")
    return uri.removeprefix(ENTITY_PREFIX)


def is_item(uri: str) -> bool:
    return uri.startswith(ENTITY_PREFIX + "Q")


@dataclass(frozen=True)
class Quantity:
    amount: float
    unit: str


def to_metres(quantity: Quantity) -> float | None:
    """The quantity in metres, or None for a unit we do not recognise (never guessed)."""
    factor = UNIT_METRES.get(quantity.unit)
    return None if factor is None else quantity.amount * factor


def quantity(row: Row, amount_key: str, unit_key: str) -> Quantity | None:
    amount = row.get(amount_key)
    unit = row.get(unit_key)
    if amount is None or unit is None:
        return None
    return Quantity(float(amount), unit.removeprefix(ENTITY_PREFIX))


def values_clause(variable: str, values: list[str], *, literal: bool) -> str:
    rendered = " ".join(json.dumps(v) if literal else f"wd:{v}" for v in values)
    return f"VALUES ?{variable} {{ {rendered} }}"
