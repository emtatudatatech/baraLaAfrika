"""Cross-check sources for Harim besides Wikidata:

- The CIA World Factbook's final edition (public domain; discontinued in February 2026), via
  the factbook.json mirror pinned to a commit: each country's "highest point" and "lowest point".
- GeoNames per-country gazetteer dumps (CC BY 4.0): mountains, peaks, hills and volcanoes, used
  to cross-check elevations of catalogue peaks (only GeoNames' surveyed `elevation`; its `dem`
  column is a 90 m grid average, not a summit height, and is never used).
- Wikipedia article text (CC BY-SA), cached so that every curated quote can be re-checked.
"""

from __future__ import annotations

import csv
import io
import json
import re
import zipfile
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote, urlencode

from .http import fetch_bytes
from .settings import RAW_DIR

# ── World Factbook ───────────────────────────────────────────────────────────

FACTBOOK_REPO = "factbook/factbook.json"
FACTBOOK_URL = "https://raw.githubusercontent.com/{repo}/{commit}/africa/{code}.json"
FACTBOOK_COMMITS_URL = (
    "https://api.github.com/repos/{repo}/commits?path=africa&per_page=1&sha={ref}"
)
FACTBOOK_CACHE = RAW_DIR / "factbook"

# The Factbook keys countries by GEC (formerly FIPS 10-4) codes, not ISO codes.
GEC_CODES: dict[str, str] = {
    "DZA": "ag", "AGO": "ao", "BEN": "bn", "BWA": "bc", "BFA": "uv", "BDI": "by", "CPV": "cv",
    "CMR": "cm", "CAF": "ct", "TCD": "cd", "COM": "cn", "COG": "cf", "COD": "cg", "CIV": "iv",
    "DJI": "dj", "EGY": "eg", "GNQ": "ek", "ERI": "er", "SWZ": "wz", "ETH": "et", "GAB": "gb",
    "GMB": "ga", "GHA": "gh", "GIN": "gv", "GNB": "pu", "KEN": "ke", "LSO": "lt", "LBR": "li",
    "LBY": "ly", "MDG": "ma", "MWI": "mi", "MLI": "ml", "MRT": "mr", "MUS": "mp", "MAR": "mo",
    "MOZ": "mz", "NAM": "wa", "NER": "ng", "NGA": "ni", "RWA": "rw", "STP": "tp", "SEN": "sg",
    "SYC": "se", "SLE": "sl", "SOM": "so", "ZAF": "sf", "SSD": "od", "SDN": "su", "TZA": "tz",
    "TGO": "to", "TUN": "ts", "UGA": "ug", "ZMB": "za", "ZWE": "zi",
}  # fmt: skip

ELEVATION_TEXT_RE = re.compile(r"^(?P<name>.+?)\s+(?P<m>-?[\d,]+)\s*m\b(?P<rest>.*)$")


class SourceError(RuntimeError):
    pass


@dataclass(frozen=True)
class FactbookExtreme:
    iso3: str
    kind: str  # "high" | "low"
    text: str
    name: str
    elevation_m: int


@dataclass(frozen=True)
class FactbookSnapshot:
    commit: str
    committed_at: str
    extremes: dict[tuple[str, str], FactbookExtreme]
    names: dict[str, str]  # iso3 → the Factbook's short country name


def parse_elevation_text(text: str) -> tuple[str, int]:
    """`"Mount Kenya 5,199 m"` → ("Mount Kenya", 5199); `"Lake Assal -155 m"` → (…, -155)."""
    match = ELEVATION_TEXT_RE.match(text.strip())
    if not match:
        raise SourceError(f"Cannot read an elevation from the Factbook text {text!r}")
    return match.group("name").strip().rstrip(","), int(match.group("m").replace(",", ""))


def fetch_factbook(ref: str, iso3s: list[str], *, refresh: bool = False) -> FactbookSnapshot:
    body = fetch_bytes(
        FACTBOOK_COMMITS_URL.format(repo=FACTBOOK_REPO, ref=ref),
        FACTBOOK_CACHE / f"commit-{re.sub(r'[^A-Za-z0-9]', '_', ref)}.json",
        refresh=refresh,
    )
    commits = json.loads(body)
    if not commits:
        raise SourceError(f"factbook.json: no commit found for {ref!r}")
    commit = commits[0]["sha"]
    committed_at = commits[0]["commit"]["committer"]["date"][:10]
    extremes: dict[tuple[str, str], FactbookExtreme] = {}
    names: dict[str, str] = {}
    for iso3 in iso3s:
        code = GEC_CODES.get(iso3)
        if code is None:
            raise SourceError(f"No Factbook (GEC) code for {iso3}")
        data = json.loads(
            fetch_bytes(
                FACTBOOK_URL.format(repo=FACTBOOK_REPO, commit=commit, code=code),
                FACTBOOK_CACHE / commit / f"{code}.json",
                refresh=refresh,
            )
        )
        names[iso3] = (
            data.get("Government", {})
            .get("Country name", {})
            .get("conventional short form", {})
            .get("text", "")
        )
        elevation = data.get("Geography", {}).get("Elevation", {})
        for kind, key in (("high", "highest point"), ("low", "lowest point")):
            text = elevation.get(key, {}).get("text")
            if not text:
                raise SourceError(f"Factbook {code} ({iso3}) has no {key!r}")
            name, metres = parse_elevation_text(text)
            extremes[(iso3, kind)] = FactbookExtreme(iso3, kind, text, name, metres)
    return FactbookSnapshot(commit, committed_at, extremes, names)


# ── GeoNames ─────────────────────────────────────────────────────────────────

GEONAMES_URL = "https://download.geonames.org/export/dump/{iso2}.zip"
GEONAMES_CACHE = RAW_DIR / "geonames"
# Feature codes for single summits (not ranges, MTS, or hill groups, HLLS).
GEONAMES_PEAK_CODES = {"MT", "PK", "PKS", "VLC", "HLL", "CRTR", "CLDA", "SMU", "DOME", "RDGE"}


@dataclass(frozen=True)
class GeoNamesPeak:
    geonames_id: int
    name: str
    alternate_names: tuple[str, ...]
    lat: float
    lon: float
    feature_code: str
    country: str  # ISO2
    elevation_m: int | None  # surveyed elevation only


def parse_geonames(data: bytes, iso2: str) -> list[GeoNamesPeak]:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        text = archive.read(f"{iso2}.txt").decode("utf-8")
    peaks: list[GeoNamesPeak] = []
    for row in csv.reader(io.StringIO(text), delimiter="\t", quoting=csv.QUOTE_NONE):
        if len(row) < 19 or row[6] != "T" or row[7] not in GEONAMES_PEAK_CODES:
            continue
        elevation = row[15].strip()
        peaks.append(
            GeoNamesPeak(
                geonames_id=int(row[0]),
                name=row[1],
                alternate_names=tuple(a for a in row[3].split(",") if a),
                lat=float(row[4]),
                lon=float(row[5]),
                feature_code=row[7],
                country=row[8],
                elevation_m=int(elevation)
                if elevation and elevation.lstrip("-").isdigit()
                else None,
            )
        )
    return peaks


def fetch_geonames(iso2: str, *, refresh: bool = False) -> list[GeoNamesPeak]:
    data = fetch_bytes(
        GEONAMES_URL.format(iso2=iso2.upper()),
        GEONAMES_CACHE / f"{iso2.upper()}.zip",
        refresh=refresh,
        timeout=120.0,
    )
    return parse_geonames(data, iso2.upper())


# ── Wikipedia ────────────────────────────────────────────────────────────────

WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php"
WIKIPEDIA_CACHE = RAW_DIR / "wikipedia"
WIKI_URL_RE = re.compile(r"^https://en\.wikipedia\.org/wiki/(?P<title>[^#?]+)")


def wikipedia_title(url: str) -> str:
    match = WIKI_URL_RE.match(url)
    if not match:
        raise SourceError(f"Not an English Wikipedia article URL: {url!r}")
    from urllib.parse import unquote

    return unquote(match.group("title")).replace("_", " ")


def fetch_wikipedia_text(
    url: str, *, refresh: bool = False, cache_dir: Path = WIKIPEDIA_CACHE
) -> str:
    """The article's plain text (redirects followed), cached by title."""
    title = wikipedia_title(url)
    query = urlencode(
        {
            "action": "query",
            "prop": "extracts",
            "explaintext": "1",
            "redirects": "1",
            "titles": title,
            "format": "json",
            "formatversion": "2",
        }
    )
    safe = quote(title.replace(" ", "_"), safe="")
    body = fetch_bytes(f"{WIKIPEDIA_API}?{query}", cache_dir / f"{safe}.json", refresh=refresh)
    pages = json.loads(body)["query"]["pages"]
    if not pages or pages[0].get("missing"):
        raise SourceError(f"Wikipedia has no article {title!r}")
    text: str = pages[0].get("extract", "")
    return text


def normalise_text(text: str) -> str:
    """For quote checks: unify quotes/dashes and collapse whitespace."""
    replacements = {
        "\u2018": "'",
        "\u2019": "'",
        "\u201c": '"',
        "\u201d": '"',
        "\u2013": "-",
        "\u2014": "-",
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    return re.sub(r"\s+", " ", text).strip().lower()


def quote_in_text(quote_text: str, source_text: str) -> bool:
    return normalise_text(quote_text) in normalise_text(source_text)
