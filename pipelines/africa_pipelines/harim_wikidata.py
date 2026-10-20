"""Wikidata queries for Harim (mountains): each country's highest and lowest points (P610,
P1589), the peaks located in each country, details for specific items (curated summits,
territory peaks) and their Global Volcanism Program IDs (P1886). Results are normalised into
plain records; nothing is guessed: a value whose unit is unknown is dropped and reported."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .wikidata import Row, is_item, qid, quantity, sparql, to_metres, values_clause

# Kinds of item that can be a peak in the catalogue (P31 values), with their English labels.
# The pipeline checks these labels against Wikidata on every run (verify_classes), so a wrong
# ID fails loudly instead of silently pulling in unrelated items. Ranges, ridges, escarpments
# and plateaus are not peaks and are not listed; hills are kept so that low-relief countries'
# high points and notable hills can appear.
PEAK_CLASSES: dict[str, str] = {
    "Q8502": "mountain",
    "Q8072": "volcano",
    "Q169358": "stratovolcano",
    "Q212057": "shield volcano",
    "Q159954": "caldera",
    "Q1061151": "massif",
    "Q207326": "summit",
    "Q54050": "hill",
    "Q190869": "central volcano",
    "Q1200524": "complex volcano",
    "Q1368970": "volcanic cone",
    "Q534282": "lava dome",
    "Q653139": "volcanic plug",
    "Q1139493": "inselberg",
    "Q1595289": "sacred mountain",
    "Q1197120": "extinct volcano",
    "Q1330974": "active volcano",
    "Q1325302": "dormant volcano",
}

# Volcanic status, only where Wikidata states it as a class (never inferred).
VOLCANIC_STATUS_CLASSES: dict[str, str] = {
    "Q1330974": "active",
    "Q1325302": "dormant",
    "Q1197120": "extinct",
}

# Classes that make an item volcanic (for peak_type).
VOLCANO_CLASSES = {
    "Q8072",
    "Q169358",
    "Q212057",
    "Q159954",
    "Q190869",
    "Q1200524",
    "Q1368970",
    "Q534282",
    "Q653139",
    "Q1197120",
    "Q1330974",
    "Q1325302",
}

# Wikidata's "Global Volcanism Program ID" (the Smithsonian's volcano number). Many volcanoes are
# typed only as "mountain" in P31 (Mount Meru, Ol Doinyo Lengai), so an item with this ID counts
# as a volcano too. The label is checked on every run, like the class IDs.
GVP_PROPERTY = ("P1886", "Global Volcanism Program ID")

COORD_RE = re.compile(r"^Point\((-?[\d.]+(?:E-?\d+)?) (-?[\d.]+(?:E-?\d+)?)\)$")


class HarimWikidataError(RuntimeError):
    pass


def parse_point(wkt: str | None) -> tuple[float, float] | None:
    """`Point(37.3 -3.07)` → (lon, lat); None for missing or non-Earth coordinates."""
    if not wkt:
        return None
    match = COORD_RE.match(wkt.strip())
    if not match:
        return None
    return float(match.group(1)), float(match.group(2))


def _split(value: str | None) -> list[str]:
    return [part for part in (value or "").split("|") if part]


@dataclass
class WikidataPeak:
    qid: str
    label: str
    alt_labels: list[str]
    elevation_m: float | None
    lon: float | None
    lat: float | None
    classes: list[str]
    country_qids: list[str]
    range_qids: list[str]
    part_of_qids: list[str]
    prominence_m: float | None
    isolation_km: float | None
    geonames_id: str | None
    sitelinks: int
    enwiki: str | None
    dropped_units: list[str] = field(default_factory=list)


@dataclass
class CountryExtreme:
    """A country's P610 (high) or P1589 (low) statement."""

    iso3: str
    kind: str  # "high" | "low"
    point_qid: str
    point_label: str
    qualifier_m: float | None
    item_m: float | None
    lon: float | None
    lat: float | None
    rank: str


_PEAK_FIELDS = """
  (SAMPLE(?label) AS ?label)
  (GROUP_CONCAT(DISTINCT ?alt; separator="|") AS ?alts)
  (SAMPLE(?amount) AS ?amount) (SAMPLE(?unit) AS ?unit)
  (SAMPLE(?coord) AS ?coord)
  (GROUP_CONCAT(DISTINCT STR(?type); separator="|") AS ?types)
  (GROUP_CONCAT(DISTINCT STR(?country); separator="|") AS ?countries)
  (GROUP_CONCAT(DISTINCT STR(?range); separator="|") AS ?ranges)
  (GROUP_CONCAT(DISTINCT STR(?partOf); separator="|") AS ?partOfs)
  (SAMPLE(?prom) AS ?prom) (SAMPLE(?promUnit) AS ?promUnit)
  (SAMPLE(?iso) AS ?iso) (SAMPLE(?isoUnit) AS ?isoUnit)
  (SAMPLE(?geonames) AS ?geonames)
  (SAMPLE(?links) AS ?links)
  (SAMPLE(?enwiki) AS ?enwiki)
"""

_PEAK_PATTERNS = """
  ?item rdfs:label ?label . FILTER(LANG(?label) = "en")
  OPTIONAL { ?item skos:altLabel ?alt . FILTER(LANG(?alt) = "en") }
  OPTIONAL {
    ?item p:P2044 ?es . ?es a wikibase:BestRank ;
      psv:P2044 [ wikibase:quantityAmount ?amount ; wikibase:quantityUnit ?unit ] .
  }
  OPTIONAL { ?item wdt:P625 ?coord . }
  OPTIONAL { ?item wdt:P31 ?type . }
  OPTIONAL { ?item wdt:P17 ?country . }
  OPTIONAL { ?item wdt:P4552 ?range . }
  OPTIONAL { ?item wdt:P361 ?partOf . }
  OPTIONAL {
    ?item p:P2660 ?ps . ?ps a wikibase:BestRank ;
      psv:P2660 [ wikibase:quantityAmount ?prom ; wikibase:quantityUnit ?promUnit ] .
  }
  OPTIONAL {
    ?item p:P2659 ?is . ?is a wikibase:BestRank ;
      psv:P2659 [ wikibase:quantityAmount ?iso ; wikibase:quantityUnit ?isoUnit ] .
  }
  OPTIONAL { ?item wdt:P1566 ?geonames . }
  OPTIONAL { ?item wikibase:sitelinks ?links . }
  OPTIONAL { ?enwiki schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . }
"""


def country_qids_query(iso3s: list[str]) -> str:
    return f"""
SELECT ?iso3 ?country WHERE {{
  {values_clause("iso3", iso3s, literal=True)}
  ?country wdt:P298 ?iso3 .
  FILTER NOT EXISTS {{ ?country wdt:P576 ?ended . }}
}}"""


def extremes_query(iso3s: list[str]) -> str:
    return f"""
SELECT ?iso3 ?kind ?point ?pointLabel ?qAmount ?qUnit ?iAmount ?iUnit ?coord ?rank WHERE {{
  {values_clause("iso3", iso3s, literal=True)}
  ?country wdt:P298 ?iso3 .
  VALUES (?prop ?ps ?kind) {{ (p:P610 ps:P610 "high") (p:P1589 ps:P1589 "low") }}
  ?country ?prop ?st . ?st ?ps ?point ; wikibase:rank ?rank .
  FILTER(?rank != wikibase:DeprecatedRank)
  OPTIONAL {{ ?st pqv:P2044 [ wikibase:quantityAmount ?qAmount ; wikibase:quantityUnit ?qUnit ] . }}
  OPTIONAL {{
    ?point p:P2044 ?es . ?es a wikibase:BestRank ;
      psv:P2044 [ wikibase:quantityAmount ?iAmount ; wikibase:quantityUnit ?iUnit ] .
  }}
  OPTIONAL {{ ?point wdt:P625 ?coord . }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
}}"""


def country_candidates_query(country_qid: str, *, limit: int) -> str:
    """Stage 1: the items in a country that are peaks with an elevation and coordinates, highest
    first (raw amounts; a rare non-metre unit only affects the order). Kept light on purpose."""
    classes = " ".join(f"wd:{c}" for c in PEAK_CLASSES)
    return f"""
SELECT ?item (MAX(?height) AS ?top) WHERE {{
  ?item wdt:P17 wd:{country_qid} ; wdt:P31 ?class ; wdt:P2044 ?height ; wdt:P625 ?coord .
  VALUES ?class {{ {classes} }}
}}
GROUP BY ?item
ORDER BY DESC(?top)
LIMIT {limit}"""


def items_query(qids: list[str]) -> str:
    return f"""
SELECT ?item {_PEAK_FIELDS} WHERE {{
  {values_clause("item", qids, literal=False)}
  {_PEAK_PATTERNS}
}}
GROUP BY ?item"""


def _metres(row: Row, amount: str, unit: str, dropped: list[str]) -> float | None:
    value = quantity(row, amount, unit)
    if value is None:
        return None
    metres = to_metres(value)
    if metres is None:
        dropped.append(f"{amount}: {value.amount} {value.unit}")
    return metres


def parse_peak(row: Row) -> WikidataPeak:
    dropped: list[str] = []
    point = parse_point(row.get("coord"))
    isolation_m = _metres(row, "iso", "isoUnit", dropped)
    links = row.get("links")
    enwiki = row.get("enwiki")
    return WikidataPeak(
        qid=qid(row["item"]),
        label=row.get("label", ""),
        alt_labels=_split(row.get("alts")),
        elevation_m=_metres(row, "amount", "unit", dropped),
        lon=point[0] if point else None,
        lat=point[1] if point else None,
        classes=[qid(c) for c in _split(row.get("types")) if is_item(c)],
        country_qids=[qid(c) for c in _split(row.get("countries")) if is_item(c)],
        range_qids=[qid(c) for c in _split(row.get("ranges")) if is_item(c)],
        part_of_qids=[qid(c) for c in _split(row.get("partOfs")) if is_item(c)],
        prominence_m=_metres(row, "prom", "promUnit", dropped),
        isolation_km=None if isolation_m is None else isolation_m / 1000,
        geonames_id=row.get("geonames"),
        sitelinks=int(links) if links else 0,
        enwiki=enwiki,
        dropped_units=dropped,
    )


def fetch_country_qids(iso3s: list[str], *, refresh: bool = False) -> dict[str, str]:
    rows = sparql(country_qids_query(iso3s), refresh=refresh)
    found: dict[str, str] = {}
    for row in rows:
        iso3 = row["iso3"]
        if iso3 in found and found[iso3] != qid(row["country"]):
            raise HarimWikidataError(f"Several current Wikidata items have ISO code {iso3}")
        found[iso3] = qid(row["country"])
    missing = sorted(set(iso3s) - set(found))
    if missing:
        raise HarimWikidataError(f"No Wikidata country item for: {', '.join(missing)}")
    return found


def fetch_extremes(iso3s: list[str], *, refresh: bool = False) -> list[CountryExtreme]:
    """Every non-deprecated P610/P1589 statement (several per country are possible)."""
    extremes: dict[tuple[str, str, str, str], CountryExtreme] = {}
    for row in sparql(extremes_query(iso3s), refresh=refresh):
        point = row["point"]
        if not is_item(point):
            continue  # an unknown or "no value" statement
        dropped: list[str] = []
        coord = parse_point(row.get("coord"))
        key = (row["iso3"], row["kind"], qid(point), row["rank"])
        record = CountryExtreme(
            iso3=row["iso3"],
            kind=row["kind"],
            point_qid=qid(point),
            point_label=row.get("pointLabel", qid(point)),
            qualifier_m=_metres(row, "qAmount", "qUnit", dropped),
            item_m=_metres(row, "iAmount", "iUnit", dropped),
            lon=coord[0] if coord else None,
            lat=coord[1] if coord else None,
            rank=row["rank"].rsplit("#", 1)[-1],
        )
        existing = extremes.get(key)
        # Several qualifier values on one statement: keep the first, it is reported anyway.
        if existing is None:
            extremes[key] = record
    return list(extremes.values())


def fetch_country_peaks(
    country_qid: str, *, limit: int, refresh: bool = False
) -> list[WikidataPeak]:
    """Candidates (stage 1), then their details by QID (stage 2), highest first."""
    rows = sparql(country_candidates_query(country_qid, limit=limit), refresh=refresh)
    qids = [qid(row["item"]) for row in rows if is_item(row["item"])]
    details = fetch_items(qids, refresh=refresh)
    return [details[q] for q in qids if q in details]


def fetch_items(qids: list[str], *, refresh: bool = False) -> dict[str, WikidataPeak]:
    unique = sorted(set(qids))
    found: dict[str, WikidataPeak] = {}
    for start in range(0, len(unique), 40):
        batch = unique[start : start + 40]
        for row in sparql(items_query(batch), refresh=refresh):
            peak = parse_peak(row)
            found[peak.qid] = peak
    return found


def property_label_query(prop: str) -> str:
    return f"""
SELECT ?label WHERE {{
  wd:{prop} rdfs:label ?label . FILTER(LANG(?label) = "en")
}}"""


def volcano_ids_query(qids: list[str]) -> str:
    return f"""
SELECT ?item ?vn WHERE {{
  {values_clause("item", qids, literal=False)}
  ?item wdt:{GVP_PROPERTY[0]} ?vn .
}}"""


def fetch_volcano_ids(qids: list[str], *, refresh: bool = False) -> dict[str, str]:
    """QID → Global Volcanism Program volcano number, for the items that have one (the lowest
    number when an item has several)."""
    unique = sorted(set(qids))
    found: dict[str, str] = {}
    for start in range(0, len(unique), 200):
        for row in sparql(volcano_ids_query(unique[start : start + 200]), refresh=refresh):
            item, number = qid(row["item"]), row["vn"].strip()
            if number and (item not in found or number < found[item]):
                found[item] = number
    return found


def labels_query(qids: list[str]) -> str:
    return f"""
SELECT ?item ?label WHERE {{
  {values_clause("item", qids, literal=False)}
  ?item rdfs:label ?label . FILTER(LANG(?label) = "en")
}}"""


def verify_classes(*, refresh: bool = False) -> None:
    """Fail unless every class QID (and the GVP property) still has the English label the code
    expects."""
    rows = sparql(labels_query(sorted(PEAK_CLASSES)), refresh=refresh)
    actual = {qid(row["item"]): row["label"] for row in rows}
    wrong = [
        f"{key} is {actual.get(key)!r}, expected {label!r}"
        for key, label in PEAK_CLASSES.items()
        if actual.get(key) != label
    ]
    prop, label = GVP_PROPERTY
    found = [row["label"] for row in sparql(property_label_query(prop), refresh=refresh)]
    if found != [label]:
        wrong.append(f"{prop} is {found!r}, expected {label!r}")
    if wrong:
        raise HarimWikidataError("Wikidata class IDs do not match: " + "; ".join(wrong))
