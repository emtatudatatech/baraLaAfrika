"""`boundaries`: Natural Earth country geometry for the map (spec §5.3).

Source: Natural Earth 1:50m admin-0 countries, as TopoJSON from the `world-atlas` package. The
output is two lean topologies for the web app:

* apps/web/public/geo/africa.topo.json: the 54 countries (by ISO numeric code), Somaliland
  (Natural Earth's code -99 is dropped by world-atlas, so it is matched by name and carries
  Somalia's iso3 so the app styles and merges it as Somalia) and Western Sahara (disputed, not
  one of the 54).
* apps/web/public/geo/africa-context.topo.json: neighbouring land (southern Europe, the Middle
  East, and territories such as the Canary Islands, Réunion and Saint Helena), drawn muted and
  loaded after the countries.

It also computes each country's area (km², on the equal-area Equal Earth projection), a label/
marker anchor, and whether the country is small enough to need a clickable circle marker, and
writes db/seeds/boundaries.json and data/boundaries_report.md.
"""

from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from . import http
from .settings import DATA_DIR, RAW_DIR, ROOT, SEEDS_DIR, WEB_PUBLIC_DIR

WORLD_ATLAS_VERSION = "2.0.2"
NATURAL_EARTH_VERSION = "4.1.0"
SOURCE_URL = f"https://cdn.jsdelivr.net/npm/world-atlas@{WORLD_ATLAS_VERSION}/countries-50m.json"
CACHE_PATH = RAW_DIR / "boundaries" / "countries-50m.json"
GEO_DIR = WEB_PUBLIC_DIR / "geo"
COUNTRIES_TOPOLOGY = GEO_DIR / "africa.topo.json"
CONTEXT_TOPOLOGY = GEO_DIR / "africa-context.topo.json"
SEED_PATH = SEEDS_DIR / "boundaries.json"
REPORT_PATH = DATA_DIR / "boundaries_report.md"

SOMALILAND_NAME = "Somaliland"  # world-atlas: no id (Natural Earth ISO code -99)
WESTERN_SAHARA_ID = "732"

# Neighbouring countries and territories drawn as muted context land (ISO 3166-1 numeric).
CONTEXT_IDS = {
    "724", "620", "250", "380", "470", "300", "196", "792", "760", "422", "376", "275", "400",
    "682", "887", "512", "784", "634", "048", "414", "368", "364", "654", "086", "008", "807",
    "688", "191", "705", "070", "499", "642", "100", "268", "051", "031",
}  # fmt: skip
# Context polygons are kept only if they reach into this lon/lat window around Africa.
CONTEXT_BBOX = (-35.0, -50.0, 75.0, 47.0)

EARTH_RADIUS_KM = 6371.0088
DEFAULT_MARKER_AREA_KM2 = 20_000.0


class BoundariesError(RuntimeError):
    pass


# ── Equal Earth projection (Šavrič, Patterson & Jenny 2018), unit sphere ───────

_A1, _A2, _A3, _A4 = 1.340264, -0.081106, 0.000893, 0.003796
_M = math.sqrt(3) / 2


def equal_earth(lon: float, lat: float) -> tuple[float, float]:
    lam, phi = math.radians(lon), math.radians(lat)
    theta = math.asin(_M * math.sin(phi))
    t2 = theta * theta
    t6 = t2 * t2 * t2
    x = lam * math.cos(theta) / (_M * (_A1 + 3 * _A2 * t2 + t6 * (7 * _A3 + 9 * _A4 * t2)))
    y = theta * (_A1 + _A2 * t2 + t6 * (_A3 + _A4 * t2))
    return x, y


# ── TopoJSON helpers ───────────────────────────────────────────────────────────


def decode_arcs(topology: dict[str, Any]) -> list[list[tuple[float, float]]]:
    """Delta-decoded, de-quantised arcs as lon/lat points."""
    (sx, sy), (tx, ty) = topology["transform"]["scale"], topology["transform"]["translate"]
    decoded: list[list[tuple[float, float]]] = []
    for arc in topology["arcs"]:
        x = y = 0
        points: list[tuple[float, float]] = []
        for dx, dy in arc:
            x += dx
            y += dy
            points.append((x * sx + tx, y * sy + ty))
        decoded.append(points)
    return decoded


def ring_points(
    ring: list[int], arcs: list[list[tuple[float, float]]]
) -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = []
    for index in ring:
        arc = arcs[index] if index >= 0 else list(reversed(arcs[~index]))
        points.extend(arc if not points else arc[1:])
    return points


def polygons_of(geometry: dict[str, Any]) -> list[list[list[int]]]:
    if geometry["type"] == "Polygon":
        return [geometry["arcs"]]
    if geometry["type"] == "MultiPolygon":
        return list(geometry["arcs"])
    raise BoundariesError(f"Unexpected geometry type {geometry['type']}")


def planar_area_and_centroid(points: list[tuple[float, float]]) -> tuple[float, float, float]:
    """Signed shoelace area and centroid of a closed ring in the given plane."""
    area = cx = cy = 0.0
    for (x0, y0), (x1, y1) in zip(points, points[1:] + points[:1], strict=True):
        cross = x0 * y1 - x1 * y0
        area += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    area /= 2
    if area == 0:
        xs, ys = zip(*points, strict=True)
        return 0.0, sum(xs) / len(xs), sum(ys) / len(ys)
    return area, cx / (6 * area), cy / (6 * area)


def polygon_area_km2(polygon: list[list[int]], arcs: list[list[tuple[float, float]]]) -> float:
    """Area (km²) of a polygon (outer ring minus holes) on the equal-area Equal Earth plane."""
    total = 0.0
    for ring_index, ring in enumerate(polygon):
        projected = [equal_earth(lon, lat) for lon, lat in ring_points(ring, arcs)]
        area = abs(planar_area_and_centroid(projected)[0]) * EARTH_RADIUS_KM**2
        total += area if ring_index == 0 else -area
    return total


def point_in_ring(lon: float, lat: float, ring: list[tuple[float, float]]) -> bool:
    inside = False
    for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1], strict=True):
        if (y0 > lat) != (y1 > lat) and lon < (x1 - x0) * (lat - y0) / (y1 - y0) + x0:
            inside = not inside
    return inside


def interior_point(ring: list[tuple[float, float]]) -> tuple[float, float]:
    """The ring's centroid if it lies inside; otherwise the inside point (on a fine grid) that
    is farthest from the ring's vertices, a cheap 'pole of inaccessibility'."""
    _, cx, cy = planar_area_and_centroid(ring)
    if point_in_ring(cx, cy, ring):
        return cx, cy
    xs, ys = zip(*ring, strict=True)
    best: tuple[float, float, float] | None = None
    steps = 60
    for i in range(1, steps):
        for j in range(1, steps):
            x = min(xs) + (max(xs) - min(xs)) * i / steps
            y = min(ys) + (max(ys) - min(ys)) * j / steps
            if not point_in_ring(x, y, ring):
                continue
            clearance = min((x - px) ** 2 + (y - py) ** 2 for px, py in ring)
            if best is None or clearance > best[0]:
                best = (clearance, x, y)
    if best is None:
        return cx, cy
    return best[1], best[2]


@dataclass(frozen=True)
class CountryShape:
    iso3: str
    area_km2: float
    polygons: int
    anchor_lon: float
    anchor_lat: float
    is_microstate_marker: bool


def measure_country(
    iso3: str,
    geometries: list[dict[str, Any]],
    arcs: list[list[tuple[float, float]]],
    marker_area_km2: float,
) -> CountryShape:
    """Area, and an anchor: the interior point of the largest polygon for mainland states, the
    area-weighted centre of all islands for small (marker) states."""
    parts = [(p, polygon_area_km2(p, arcs)) for g in geometries for p in polygons_of(g)]
    total = sum(area for _, area in parts)
    is_marker = total < marker_area_km2
    if is_marker:
        weighted = [
            (area, planar_area_and_centroid(ring_points(p[0], arcs))[1:]) for p, area in parts
        ]
        lon = sum(area * c[0] for area, c in weighted) / total
        lat = sum(area * c[1] for area, c in weighted) / total
    else:
        largest = max(parts, key=lambda part: part[1])[0]
        lon, lat = interior_point(ring_points(largest[0], arcs))
    return CountryShape(iso3, total, len(parts), round(lon, 4), round(lat, 4), is_marker)


def subset_topology(
    topology: dict[str, Any], objects: dict[str, list[dict[str, Any]]]
) -> dict[str, Any]:
    """A new topology with only these geometries and the arcs they use (arcs re-indexed)."""
    used: dict[int, int] = {}

    def remap(index: int) -> int:
        original = index if index >= 0 else ~index
        if original not in used:
            used[original] = len(used)
        new = used[original]
        return new if index >= 0 else ~new

    def remap_geometry(geometry: dict[str, Any]) -> dict[str, Any]:
        if geometry["type"] == "Polygon":
            arcs: Any = [[remap(i) for i in ring] for ring in geometry["arcs"]]
        else:
            arcs = [[[remap(i) for i in ring] for ring in polygon] for polygon in geometry["arcs"]]
        out: dict[str, Any] = {"type": geometry["type"], "arcs": arcs}
        if "properties" in geometry:
            out["properties"] = geometry["properties"]
        return out

    new_objects = {
        name: {"type": "GeometryCollection", "geometries": [remap_geometry(g) for g in geoms]}
        for name, geoms in objects.items()
    }
    ordered = sorted(used, key=used.__getitem__)
    return {
        "type": "Topology",
        "transform": topology["transform"],
        "objects": new_objects,
        "arcs": [topology["arcs"][i] for i in ordered],
    }


def _polygon_in_bbox(
    polygon: list[list[int]], arcs: list[list[tuple[float, float]]], bbox: tuple[float, ...]
) -> bool:
    west, south, east, north = bbox
    return any(
        west <= lon <= east and south <= lat <= north for lon, lat in ring_points(polygon[0], arcs)
    )


def build(
    world: dict[str, Any], countries: list[dict[str, Any]], marker_area_km2: float
) -> tuple[dict[str, Any], dict[str, Any], list[CountryShape], list[str]]:
    """(countries topology, context topology, measured shapes, notes)."""
    geometries = world["objects"]["countries"]["geometries"]
    arcs = decode_arcs(world)
    by_id: dict[str, list[dict[str, Any]]] = {}
    for geometry in geometries:
        by_id.setdefault(str(geometry.get("id")), []).append(geometry)
    notes: list[str] = []

    country_geoms: list[dict[str, Any]] = []
    shapes: list[CountryShape] = []
    for country in sorted(countries, key=lambda c: c["iso3"]):
        key = f"{country['iso_numeric']:03d}"
        matches = by_id.get(key, [])
        if len(matches) != 1:
            raise BoundariesError(
                f"{country['name']} (ISO numeric {key}): expected one Natural Earth geometry, "
                f"found {len(matches)}"
            )
        geometry = matches[0]
        parts = [geometry]
        if country["iso3"] == "SOM":
            somaliland = [g for g in geometries if g["properties"].get("name") == SOMALILAND_NAME]
            if len(somaliland) != 1:
                raise BoundariesError("Somaliland geometry not found by name in world-atlas")
            parts.append(somaliland[0])
            country_geoms.append({**somaliland[0], "properties": {"iso3": "SOM"}})
            notes.append(
                "Somaliland (no ISO code in Natural Earth) is drawn and styled as Somalia; the "
                "line between them is not drawn."
            )
        country_geoms.append({**geometry, "properties": {"iso3": country["iso3"]}})
        shapes.append(measure_country(country["iso3"], parts, arcs, marker_area_km2))

    western_sahara = by_id.get(WESTERN_SAHARA_ID, [])
    if len(western_sahara) != 1:
        raise BoundariesError("Western Sahara (732) not found")
    country_geoms.append({**western_sahara[0], "properties": {"iso3": "ESH", "disputed": True}})
    notes.append("Western Sahara is drawn as a disputed territory (hatched), not one of the 54.")

    context_geoms: list[dict[str, Any]] = []
    for key in sorted(CONTEXT_IDS):
        for geometry in by_id.get(key, []):
            polygons = [p for p in polygons_of(geometry) if _polygon_in_bbox(p, arcs, CONTEXT_BBOX)]
            if polygons:
                context_geoms.append({"type": "MultiPolygon", "arcs": polygons})
    if not context_geoms:
        raise BoundariesError("No context land selected")

    return (
        subset_topology(world, {"countries": country_geoms}),
        subset_topology(world, {"land": context_geoms}),
        shapes,
        notes,
    )


def _write_json(path: Path, payload: Any) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    path.write_text(text, encoding="utf-8")
    return len(text.encode("utf-8"))


def write_report(
    path: Path,
    *,
    shapes: list[CountryShape],
    names: dict[str, str],
    notes: list[str],
    sizes: dict[str, int],
    marker_area_km2: float,
) -> None:
    lines = [
        "# Boundaries report",
        "",
        f"Natural Earth {NATURAL_EARTH_VERSION} admin-0 countries at 1:50m, via world-atlas "
        f"{WORLD_ATLAS_VERSION}. Generated by `python -m pipelines boundaries`.",
        "",
        "## Edge cases",
        "",
        *[f"- {note}" for note in notes],
        f"- Countries under {marker_area_km2:,.0f} km² get a clickable circle marker so they "
        "stay visible and easy to tap at the default zoom.",
        "",
        "## Output",
        "",
        *[f"- `{name}`: {size / 1024:.0f} KiB" for name, size in sizes.items()],
        "",
        "## Countries by area",
        "",
        "Area on the equal-area Equal Earth projection (generalised 1:50m data, so smaller than "
        "official figures for intricate coastlines).",
        "",
        "| Country | Area (km²) | Polygons | Anchor (lon, lat) | Marker |",
        "|---|---|---|---|---|",
    ]
    for shape in sorted(shapes, key=lambda s: s.area_km2):
        lines.append(
            f"| {names[shape.iso3]} | {shape.area_km2:,.0f} | {shape.polygons} | "
            f"{shape.anchor_lon}, {shape.anchor_lat} | "
            f"{'yes' if shape.is_microstate_marker else ''} |"
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def configure(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--refresh", action="store_true", help="re-download the source TopoJSON")
    parser.add_argument(
        "--marker-area-km2",
        type=float,
        default=DEFAULT_MARKER_AREA_KM2,
        help="countries smaller than this get a circle marker",
    )


def run(args: argparse.Namespace) -> int:
    world = json.loads(http.fetch_bytes(SOURCE_URL, CACHE_PATH, refresh=args.refresh))
    seed = json.loads((SEEDS_DIR / "countries.json").read_text(encoding="utf-8"))
    countries = seed["countries"]
    countries_topology, context_topology, shapes, notes = build(
        world, countries, args.marker_area_km2
    )
    sizes = {
        str(COUNTRIES_TOPOLOGY.relative_to(ROOT)): _write_json(
            COUNTRIES_TOPOLOGY, countries_topology
        ),
        str(CONTEXT_TOPOLOGY.relative_to(ROOT)): _write_json(CONTEXT_TOPOLOGY, context_topology),
    }
    payload = {
        "dataset": {
            "key": "boundaries-natural-earth",
            "name": f"Country boundaries (Natural Earth {NATURAL_EARTH_VERSION}, 1:50m)",
            "provider": "Natural Earth (via the world-atlas package)",
            "license": "Public domain (Natural Earth); world-atlas packaging ISC",
            "attribution": "Made with Natural Earth. Boundaries do not imply endorsement of any "
            "border or territorial claim.",
            "coverage_start": None,
            "coverage_end": None,
            "as_of": "2018-05-23",  # Natural Earth v4.1.0 release (GitHub, 2018-05-23)
            "refresh_cadence": "static",
        },
        "source_url": SOURCE_URL,
        "marker_area_km2": args.marker_area_km2,
        "countries": [
            {
                "iso3": s.iso3,
                "area_km2": round(s.area_km2),
                "centroid_lon": s.anchor_lon,
                "centroid_lat": s.anchor_lat,
                "is_microstate_marker": s.is_microstate_marker,
            }
            for s in shapes
        ],
    }
    SEED_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    names = {c["iso3"]: c["name"] for c in countries}
    write_report(
        REPORT_PATH,
        shapes=shapes,
        names=names,
        notes=notes,
        sizes=sizes,
        marker_area_km2=args.marker_area_km2,
    )
    markers = [names[s.iso3] for s in shapes if s.is_microstate_marker]
    print(
        f"Wrote {len(shapes)} countries ("
        + ", ".join(f"{k} {v / 1024:.0f} KiB" for k, v in sizes.items())
        + ").\n"
        f"Markers: {', '.join(sorted(markers))}."
    )
    return 0
