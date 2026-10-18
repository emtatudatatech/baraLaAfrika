"""`python -m pipelines gold-trade`: annual gold trade from UN Comtrade into
db/seeds/gold_trade.json.

For each of the 54 countries (calls use the subscription key in COMTRADE_API_KEY, sent as a
header and never logged or cached):
  * reported: the country's own exports and imports of HS 7108 by partner (and World);
  * mirror: what every other reporter says it imported from (or exported to) the country;
plus total merchandise exports for gold's share. Gold is non-monetary gold: heading 7108 minus
monetary gold 7108.20, which is fetched in the same calls. Every call pins the totals over
customs procedure and transport mode (otherwise each value comes back once per breakdown), uses
net weight (the `qty` field is unreliable), waits between calls, caches every response and stops
at the daily call budget; the next run resumes from the cache.

Terms: UN Comtrade allows publishing limited amounts (well under 100,000 records) without
permission; see docs/dhahabu-sources.md.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

from .gold_common import (
    GOLD_RAW,
    TRADE_SEED,
    GoldError,
    SourceRecord,
    config,
    countries,
    generated,
    table,
    write_seed,
)
from .http import fetch_bytes
from .settings import require_env

COMTRADE = SourceRecord(
    "un-comtrade",
    "UN Comtrade Database (United Nations Statistics Division): HS 7108 gold and total "
    "merchandise trade, annual",
    "https://comtradeplus.un.org/",
)
HS_CODE = "7108.1"  # non-monetary gold: 7108 without 7108.20
CACHE_DIR = GOLD_RAW / "comtrade"
FLOWS = {"X": "export", "M": "import"}
MIRROR_FLOWS = {"M": "export", "X": "import"}  # a partner's import is the country's export


class BudgetExhaustedError(GoldError):
    pass


@dataclass
class Caller:
    """Fetches Comtrade responses within the daily budget, from the cache when possible."""

    key: str
    refresh: bool
    budget: int
    calls: int = 0
    skipped: list[str] = field(default_factory=list)

    def get(self, params: dict[str, str], cache_name: str) -> list[dict[str, Any]]:
        settings = config()["trade"]
        query = {**settings["fixed_params"], **params}
        url = f"{settings['url']}?{urlencode(sorted(query.items()))}"
        path = CACHE_DIR / f"{cache_name}.json"
        if self.refresh or not path.exists():
            if self.calls >= self.budget:
                self.skipped.append(cache_name)
                raise BudgetExhaustedError(cache_name)
            self.calls += 1
        body = fetch_bytes(
            url,
            path,
            refresh=self.refresh,
            min_interval=float(settings["min_interval_seconds"]),
            timeout=120,
            headers={"Ocp-Apim-Subscription-Key": self.key},
        )
        return parse_response(body, cache_name, path)


def parse_response(body: bytes, name: str, path: Path) -> list[dict[str, Any]]:
    try:
        payload = json.loads(body)
    except ValueError as error:
        path.unlink(missing_ok=True)
        raise GoldError(f"Comtrade {name}: not JSON ({error})") from error
    if payload.get("error"):
        path.unlink(missing_ok=True)
        raise GoldError(f"Comtrade {name}: {payload['error']}")
    data: list[dict[str, Any]] = payload.get("data") or []
    return data


@dataclass
class Flow:
    value: float = 0.0
    weight: float | None = 0.0
    monetary_value: float = 0.0
    monetary_weight: float | None = 0.0
    seen: bool = False

    def add(self, cmd: str, value: float, weight: float | None, monetary_code: str) -> None:
        if cmd == monetary_code:
            self.monetary_value += value
            self.monetary_weight = _add(self.monetary_weight, weight)
        else:
            self.value += value
            self.weight = _add(self.weight, weight)
            self.seen = True

    @property
    def non_monetary_value(self) -> float:
        return max(self.value - self.monetary_value, 0.0)

    @property
    def non_monetary_weight(self) -> float | None:
        if self.weight is None or self.monetary_weight is None or self.weight <= 0:
            return None
        return max(self.weight - self.monetary_weight, 0.0)


def _add(total: float | None, weight: Any) -> float | None:
    if total is None or not isinstance(weight, int | float):
        return None
    return total + float(weight)


ISO3_RE = re.compile(r"^[A-Z]{3}$")


def partner_iso3(code: Any) -> str | None:
    return code if isinstance(code, str) and ISO3_RE.match(code) else None


@dataclass
class CountryTrade:
    trade: list[list[Any]] = field(default_factory=list)
    partners: list[list[Any]] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


def summarise_reported(iso3: str, m49: int, rows: list[dict[str, Any]]) -> CountryTrade:
    settings = config()["trade"]
    monetary = settings["monetary"]
    top = int(settings["top_partners"])
    flows: dict[tuple[int, str, int], Flow] = {}
    names: dict[int, tuple[str, str | None]] = {}
    for row in rows:
        if row.get("reporterCode") != m49 or row.get("flowCode") not in FLOWS:
            continue
        key = (int(row["period"]), FLOWS[row["flowCode"]], int(row["partnerCode"]))
        flows.setdefault(key, Flow()).add(
            str(row["cmdCode"]), float(row.get("primaryValue") or 0), row.get("netWgt"), monetary
        )
        names[int(row["partnerCode"])] = (
            row.get("partnerDesc") or str(row["partnerCode"]),
            partner_iso3(row.get("partnerISO")),
        )
    result = CountryTrade()
    for year, flow in sorted({(y, f) for y, f, _ in flows}):
        world = flows.get((year, flow, 0))
        partner_flows = {p: fl for (y, f, p), fl in flows.items() if y == year and f == flow and p}
        if world is None or not world.seen:
            if not partner_flows:
                continue
            world = Flow()
            for fl in partner_flows.values():
                world.value += fl.non_monetary_value
                world.weight = _add(world.weight, fl.non_monetary_weight)
                world.seen = True
            result.notes.append(f"{iso3} {year} {flow}: no World row; partners summed")
        weight = world.non_monetary_weight
        note = None
        if weight is None:
            positive = [fl for fl in partner_flows.values() if fl.non_monetary_value > 0]
            partner_weights = [fl.non_monetary_weight for fl in positive]
            if positive and all(w is not None for w in partner_weights):
                weight = sum(w for w in partner_weights if w is not None)
                note = "Net weight summed from the partner rows (the World row has none)."
            else:
                note = "Net weight not reported."
        result.trade.append(
            [
                iso3,
                year,
                flow,
                HS_CODE,
                _kg(weight),
                round(world.non_monetary_value, 2),
                "reported",
                None,
                COMTRADE.source_key,
                note,
            ]
        )
        ranked = sorted(
            ((p, fl) for p, fl in partner_flows.items() if fl.non_monetary_value > 0),
            key=lambda item: (-item[1].non_monetary_value, item[0]),
        )[:top]
        for rank, (partner, fl) in enumerate(ranked, start=1):
            name, code = names[partner]
            result.partners.append(
                [
                    iso3,
                    year,
                    flow,
                    "reported",
                    rank,
                    name,
                    code,
                    round(fl.non_monetary_value, 2),
                    _kg(fl.non_monetary_weight),
                    COMTRADE.source_key,
                ]
            )
    return result


def summarise_mirror(iso3: str, m49: int, rows: list[dict[str, Any]]) -> CountryTrade:
    settings = config()["trade"]
    monetary = settings["monetary"]
    excluded = set(settings["excluded_reporters"]) | {m49}
    top = int(settings["top_partners"])
    flows: dict[tuple[int, str, int], Flow] = {}
    names: dict[int, tuple[str, str | None]] = {}
    for row in rows:
        reporter = int(row.get("reporterCode", 0))
        if row.get("partnerCode") != m49 or reporter in excluded:
            continue
        if row.get("flowCode") not in MIRROR_FLOWS:
            continue
        key = (int(row["period"]), MIRROR_FLOWS[row["flowCode"]], reporter)
        flows.setdefault(key, Flow()).add(
            str(row["cmdCode"]), float(row.get("primaryValue") or 0), row.get("netWgt"), monetary
        )
        names[reporter] = (
            row.get("reporterDesc") or str(reporter),
            partner_iso3(row.get("reporterISO")),
        )
    result = CountryTrade()
    for year, flow in sorted({(y, f) for y, f, _ in flows}):
        reporters = {r: fl for (y, f, r), fl in flows.items() if y == year and f == flow}
        positive = {r: fl for r, fl in reporters.items() if fl.non_monetary_value > 0}
        if not positive:
            continue
        value = sum(fl.non_monetary_value for fl in positive.values())
        weights = [fl.non_monetary_weight for fl in positive.values()]
        missing = sum(1 for w in weights if w is None)
        # A partial sum would understate the total, so a total weight needs every partner's.
        weight = None if missing else sum(w for w in weights if w is not None)
        note = None
        if missing:
            note = (
                f"Net weight missing for {missing} of {len(positive)} partner reports, so no "
                "total weight is given."
            )
        result.trade.append(
            [
                iso3,
                year,
                flow,
                HS_CODE,
                _kg(weight),
                round(value, 2),
                "mirror",
                len(positive),
                COMTRADE.source_key,
                note,
            ]
        )
        ranked = sorted(positive.items(), key=lambda item: (-item[1].non_monetary_value, item[0]))
        for rank, (reporter, fl) in enumerate(ranked[:top], start=1):
            name, code = names[reporter]
            result.partners.append(
                [
                    iso3,
                    year,
                    flow,
                    "mirror",
                    rank,
                    name,
                    code,
                    round(fl.non_monetary_value, 2),
                    _kg(fl.non_monetary_weight),
                    COMTRADE.source_key,
                ]
            )
    return result


def _kg(weight: float | None) -> float | None:
    return round(weight, 3) if weight is not None else None


def total_exports(rows: list[dict[str, Any]], by_m49: dict[int, str]) -> list[list[Any]]:
    out = []
    for row in rows:
        reporter = int(row.get("reporterCode", 0))
        if reporter not in by_m49 or row.get("partnerCode") != 0 or row.get("flowCode") != "X":
            continue
        out.append(
            [
                by_m49[reporter],
                int(row["period"]),
                round(float(row["primaryValue"]), 2),
                COMTRADE.source_key,
            ]
        )
    return sorted(out)


@dataclass
class TradeResult:
    years: list[int]
    trade: list[list[Any]]
    partners: list[list[Any]]
    totals: list[list[Any]]
    calls: int
    skipped: list[str]
    notes: list[str]


def build(*, refresh: bool, today: dt.date | None = None) -> TradeResult:
    settings = config()["trade"]
    key = require_env("COMTRADE_API_KEY", purpose="fetch UN Comtrade data (gold-trade)")
    today = today or dt.date.today()
    years = list(range(int(settings["first_year"]), today.year))
    periods = ",".join(str(y) for y in years)
    span = f"{years[0]}-{years[-1]}"
    caller = Caller(key, refresh, int(settings["daily_call_budget"]))
    cmd = f"{settings['commodity']},{settings['monetary']}"
    trade: list[list[Any]] = []
    partners: list[list[Any]] = []
    notes: list[str] = []
    for country in countries():
        for kind, params in (
            ("reported", {"reporterCode": str(country.m49), "flowCode": "X,M"}),
            ("mirror", {"partnerCode": str(country.m49), "flowCode": "X,M"}),
        ):
            try:
                rows = caller.get(
                    {**params, "period": periods, "cmdCode": cmd}, f"{kind}-{country.iso3}-{span}"
                )
            except BudgetExhaustedError:
                continue
            summary = (summarise_reported if kind == "reported" else summarise_mirror)(
                country.iso3, country.m49, rows
            )
            trade += summary.trade
            partners += summary.partners
            notes += summary.notes
    by_m49 = {c.m49: c.iso3 for c in countries()}
    batch = int(settings["total_exports_batch"])
    m49s = sorted(by_m49)
    totals: list[list[Any]] = []
    for start in range(0, len(m49s), batch):
        chunk = m49s[start : start + batch]
        try:
            rows = caller.get(
                {
                    "reporterCode": ",".join(map(str, chunk)),
                    "partnerCode": "0",
                    "flowCode": "X",
                    "cmdCode": "TOTAL",
                    "period": periods,
                },
                f"total-exports-{start // batch + 1}-{span}",
            )
        except BudgetExhaustedError:
            continue
        totals += total_exports(rows, by_m49)
    return TradeResult(
        years,
        sorted(trade, key=lambda r: (r[0], r[1], r[2], r[6])),
        sorted(partners, key=lambda r: (r[0], r[1], r[2], r[3], r[4])),
        sorted(totals),
        caller.calls,
        caller.skipped,
        notes,
    )


def dataset(result: TradeResult) -> dict[str, Any]:
    years = [r[1] for r in result.trade] or result.years
    return {
        "key": "gold-trade",
        "name": "UN Comtrade: gold trade (HS 7108, non-monetary) and total merchandise exports",
        "provider": "United Nations Statistics Division (UN Comtrade)",
        "license": "UN Comtrade terms of use: limited publication allowed without permission",
        "attribution": "UN Comtrade, United Nations Statistics Division (HS 7108, annual).",
        "coverage_start": f"{min(years)}-01-01",
        "coverage_end": f"{max(years)}-12-31",
        "as_of": dt.date.today().isoformat(),
        "refresh_cadence": "monthly",
    }


def payload(result: TradeResult) -> dict[str, Any]:
    return {
        "$generated": generated(
            "gold-trade", calls=result.calls, skipped=result.skipped, notes=result.notes
        ),
        "datasets": [dataset(result)],
        "sources": [COMTRADE.seed()],
        "trade": table(
            [
                "iso3",
                "year",
                "flow",
                "hs_code",
                "net_weight_kg",
                "value_usd",
                "basis",
                "partner_count",
                "source",
                "notes",
            ],
            result.trade,
        ),
        "partners": table(
            [
                "iso3",
                "year",
                "flow",
                "basis",
                "rank",
                "partner_name",
                "partner_iso3",
                "value_usd",
                "net_weight_kg",
                "source",
            ],
            result.partners,
        ),
        "total_exports": table(["iso3", "year", "value_usd", "source"], result.totals),
    }


def configure(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--refresh", action="store_true", help="re-fetch instead of the cache")


def run(args: argparse.Namespace) -> int:
    result = build(refresh=bool(args.refresh))
    write_seed(TRADE_SEED, payload(result))
    records = len(result.trade) + len(result.partners) + len(result.totals)
    print(
        f"Gold trade: {len(result.trade)} country-year flows, {len(result.partners)} partner "
        f"rows, {len(result.totals)} total-export rows ({records} records; {result.calls} API "
        "calls this run)."
    )
    if result.skipped:
        print(f"  Daily call budget reached; {len(result.skipped)} requests left for the next run.")
    return 0
