"""Cited sources: reliability tiers and helpers."""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

Tier = Literal["primary", "reference", "secondary", "low"]
TIER_ORDER: dict[Tier, int] = {"primary": 0, "reference": 1, "secondary": 2, "low": 3}

RULES_FILE = Path(__file__).parent / "reference" / "source_tiers.json"


@dataclass(frozen=True)
class TierRule:
    domain: str
    tier: Tier
    source_type: str
    note: str | None = None
    # Optional URL path prefix, for hosts that serve sources of different kinds (e.g. GitHub).
    path: str | None = None


class UnclassifiedSourceError(ValueError):
    pass


@cache
def tier_rules() -> tuple[TierRule, ...]:
    data = json.loads(RULES_FILE.read_text())
    return tuple(
        TierRule(r["domain"], r["tier"], r["source_type"], r.get("note"), r.get("path"))
        for r in data["rules"]
    )


def classify(url: str) -> TierRule:
    """The first tier rule whose domain matches the URL's host (exact or subdomain) and, if the
    rule has one, whose path prefix matches the URL's path."""
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    for rule in tier_rules():
        if not (host == rule.domain or host.endswith("." + rule.domain)):
            continue
        if rule.path is None or parsed.path.startswith(rule.path):
            return rule
    raise UnclassifiedSourceError(
        f"No reliability tier rule matches {url!r}; add one to {RULES_FILE.name}"
    )


def mainly_low_tier(tiers: list[Tier]) -> bool:
    """A claim 'relies mainly on low-tier sources' when it has no citation, or at least half of
    its cited sources are low tier."""
    if not tiers:
        return True
    return sum(1 for t in tiers if t == "low") * 2 >= len(tiers)
