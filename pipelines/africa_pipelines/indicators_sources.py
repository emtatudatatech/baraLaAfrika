"""Readers for Vinara's annual indicator sources: World Bank WDI (and SIPRI through it), the IMF
World Economic Outlook, UNDP's Human Development Index and the World Bank's International Debt
Statistics. Each reader turns one cached download into plain values; the merge and the rules
live in indicators.py.
"""

from __future__ import annotations

import csv
import datetime as dt
import io
import json
import math
import re
from collections.abc import Iterable
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Any

from .gold_common import SourceRecord, imf_series
from .settings import RAW_DIR

CONFIG_FILE = Path(__file__).parent / "reference" / "indicators_config.json"
INDICATORS_RAW = RAW_DIR / "indicators"

WDI = SourceRecord(
    "wb-wdi",
    "World Bank, World Development Indicators",
    "https://datacatalog.worldbank.org/search/dataset/0037712",
)
WEO = SourceRecord(
    "imf-weo",
    "IMF, World Economic Outlook database",
    "https://data.imf.org/en/datasets/IMF.RES:WEO",
)
SIPRI = SourceRecord(
    "sipri-milex",
    "SIPRI Military Expenditure Database (read through the World Bank WDI)",
    "https://www.sipri.org/databases/milex",
)
HDR = SourceRecord(
    "undp-hdr",
    "UNDP, Human Development Report 2025: Human Development Index time series",
    "https://hdr.undp.org/data-center/documentation-and-downloads",
)
HDR_VIA_OWID = SourceRecord(
    "undp-hdr-owid",
    "UNDP, Human Development Report 2025: Human Development Index, as published by Our World "
    "in Data",
    "https://ourworldindata.org/grapher/human-development-index",
)
IDS = SourceRecord(
    "wb-ids",
    "World Bank, International Debt Statistics",
    "https://datacatalog.worldbank.org/search/dataset/0038015",
)


class IndicatorsError(RuntimeError):
    pass


class IndicatorsValidationError(IndicatorsError):
    """Raised with every problem found, so a run lists them all at once."""

    def __init__(self, problems: list[str]) -> None:
        self.problems = problems
        super().__init__("\n".join(f"  - {p}" for p in problems))


@cache
def config() -> dict[str, Any]:
    data: dict[str, Any] = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    return data


@dataclass(frozen=True)
class Value:
    """One raw value read from a source, before the merge."""

    iso3: str
    year: int
    value: float


def _finite(value: Any) -> float | None:
    if value is None or value == "":
        return None
    number = float(value)
    return number if math.isfinite(number) else None


# ── World Bank WDI (and SIPRI through it) ────────────────────────────────────


def parse_wdi(body: bytes, code: str, countries: set[str]) -> tuple[list[Value], str]:
    """WDI API JSON → values for the 54 countries, and the API's `lastupdated` date."""
    payload = json.loads(body)
    if not isinstance(payload, list) or len(payload) < 2 or not isinstance(payload[0], dict):
        raise IndicatorsError(f"WDI {code}: unexpected response {str(payload)[:200]}")
    meta = payload[0]
    if "message" in meta:
        raise IndicatorsError(f"WDI {code}: {meta['message']}")
    if int(meta.get("pages", 1)) > 1:
        raise IndicatorsError(f"WDI {code}: more than one page; raise per_page")
    values = []
    for row in payload[1] or []:
        if row["indicator"]["id"] != code:
            raise IndicatorsError(f"WDI {code}: row for {row['indicator']['id']}")
        iso3 = row.get("countryiso3code")
        number = _finite(row.get("value"))
        if iso3 in countries and number is not None:
            values.append(Value(iso3, int(row["date"]), number))
    return values, str(meta.get("lastupdated", ""))


# ── IMF World Economic Outlook ───────────────────────────────────────────────


@dataclass(frozen=True)
class WeoEdition:
    published: dt.date

    @property
    def label(self) -> str:
        """April editions are spring; anything later in the year is the October edition."""
        month = "April" if self.published.month <= 6 else "October"
        return f"IMF WEO {month} {self.published.year}"

    @property
    def year(self) -> int:
        return self.published.year


def parse_weo(body: bytes, countries: set[str]) -> tuple[dict[str, list[Value]], WeoEdition]:
    """WEO SDMX-JSON → values per indicator code, and the edition (its publication date)."""
    payload = json.loads(body)
    by_code: dict[str, list[Value]] = {}
    for (country, code, frequency), observations in imf_series(payload).items():
        if frequency != "A" or country not in countries:
            continue
        by_code.setdefault(code, []).extend(
            Value(country, int(period), value) for period, value in observations.items()
        )
    return by_code, WeoEdition(_weo_publication_date(payload))


def _weo_publication_date(payload: dict[str, Any]) -> dt.date:
    try:
        data = payload["data"]
        definitions = data["structures"][0]["attributes"]["dataSet"]
        values = data["dataSets"][0].get("attributes", [])
    except (KeyError, IndexError) as error:
        raise IndicatorsError(f"WEO: unexpected response shape ({error})") from error
    for definition, value in zip(definitions, values, strict=False):
        if definition.get("id") != "PUBLICATION_DATE" or value is None:
            continue
        raw = value[0] if isinstance(value, list) else value
        if isinstance(raw, int) and definition.get("values"):
            raw = definition["values"][raw]
        if isinstance(raw, list):
            raw = raw[0]
        return dt.date.fromisoformat(str(raw)[:10])
    raise IndicatorsError("WEO: the response has no PUBLICATION_DATE; cannot tell the edition")


# ── UNDP Human Development Index ─────────────────────────────────────────────

HDI_COLUMN = re.compile(r"^hdi_(\d{4})$")


def parse_hdr(body: bytes, countries: set[str]) -> list[Value]:
    """UNDP's composite indices time series (wide: iso3, hdi_1990 … hdi_2023)."""
    reader = csv.DictReader(io.StringIO(body.decode("utf-8-sig", errors="replace")))
    if reader.fieldnames is None or "iso3" not in reader.fieldnames:
        raise IndicatorsError("UNDP HDR: no iso3 column; the file layout may have changed")
    years = {
        name: int(match[1])
        for name in reader.fieldnames
        if (match := HDI_COLUMN.match(name)) is not None
    }
    if not years:
        raise IndicatorsError("UNDP HDR: no hdi_YYYY columns; the file layout may have changed")
    values = []
    for row in reader:
        if row["iso3"] not in countries:
            continue
        for column, year in years.items():
            number = _finite(row[column])
            if number is not None:
                values.append(Value(row["iso3"], year, number))
    return values


def parse_hdr_owid(body: bytes, column: str, countries: set[str]) -> list[Value]:
    """Our World in Data's copy of the same series (long: entity, code, year, value)."""
    reader = csv.DictReader(io.StringIO(body.decode("utf-8-sig", errors="replace")))
    fields = reader.fieldnames or []
    if not {"code", "year", column} <= set(fields):
        raise IndicatorsError(f"HDI (Our World in Data): expected code, year and {column}")
    values = []
    for row in reader:
        number = _finite(row[column])
        if row["code"] in countries and number is not None:
            values.append(Value(row["code"], int(row["year"]), number))
    return values


# ── World Bank International Debt Statistics ─────────────────────────────────


@dataclass(frozen=True)
class IdsRow:
    series: str
    iso3: str
    year: int
    counterpart: str
    counterpart_name: str
    value: float


def clean_name(name: str) -> str:
    """IDS pads names with non-breaking spaces ("World Bank-IDA\\xa0\\xa0…")."""
    return re.sub(r"\s+", " ", name.replace("\xa0", " ")).strip()


def parse_ids(body: bytes, countries: set[str]) -> tuple[list[IdsRow], str]:
    """IDS API JSON (source 6, with counterpart areas) → non-empty rows, and `lastupdated`."""
    payload = json.loads(body)
    if isinstance(payload, list):
        raise IndicatorsError(f"IDS: {str(payload)[:300]}")
    if int(payload.get("pages", 1)) > 1:
        raise IndicatorsError("IDS: more than one page; raise per_page")
    rows = []
    for record in payload["source"]["data"]:
        number = _finite(record.get("value"))
        if number is None:
            continue
        variables = {v["concept"]: v for v in record["variable"]}
        iso3 = variables["Country"]["id"]
        if iso3 not in countries:
            continue
        rows.append(
            IdsRow(
                series=variables["Series"]["id"],
                iso3=iso3,
                year=int(variables["Time"]["id"].removeprefix("YR")),
                counterpart=variables["Counterpart-Area"]["id"],
                counterpart_name=clean_name(variables["Counterpart-Area"]["value"]),
                value=number,
            )
        )
    return rows, str(payload.get("lastupdated", ""))


def years_in(values: Iterable[Value]) -> set[int]:
    return {v.year for v in values}
