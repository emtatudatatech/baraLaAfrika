"""Geography checks for Harim against the map's own Natural Earth boundaries
(apps/web/public/geo/africa.topo.json): which countries a point lies in, and how far it is from
a country's border, so border peaks can be checked with a tolerance."""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from functools import cached_property
from pathlib import Path
from typing import Any

from .boundaries import decode_arcs, point_in_ring, polygons_of, ring_points
from .settings import WEB_PUBLIC_DIR

TOPOLOGY_FILE = WEB_PUBLIC_DIR / "geo" / "africa.topo.json"
EARTH_RADIUS_KM = 6371.0088

Ring = list[tuple[float, float]]


def haversine_km(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def _segment_distance_km(
    lon: float, lat: float, a: tuple[float, float], b: tuple[float, float]
) -> float:
    """Distance from a point to a short segment, on a local equirectangular plane."""
    kx = math.cos(math.radians(lat)) * math.pi * EARTH_RADIUS_KM / 180
    ky = math.pi * EARTH_RADIUS_KM / 180
    ax, ay = (a[0] - lon) * kx, (a[1] - lat) * ky
    bx, by = (b[0] - lon) * kx, (b[1] - lat) * ky
    dx, dy = bx - ax, by - ay
    length2 = dx * dx + dy * dy
    t = 0.0 if length2 == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / length2))
    return math.hypot(ax + t * dx, ay + t * dy)


@dataclass(frozen=True)
class CountryPolygons:
    iso3: str
    polygons: tuple[tuple[Ring, ...], ...]  # outer ring first, then holes

    @cached_property
    def bbox(self) -> tuple[float, float, float, float]:
        lons = [x for polygon in self.polygons for x, _ in polygon[0]]
        lats = [y for polygon in self.polygons for _, y in polygon[0]]
        return min(lons), min(lats), max(lons), max(lats)

    def contains(self, lon: float, lat: float) -> bool:
        for polygon in self.polygons:
            if point_in_ring(lon, lat, polygon[0]) and not any(
                point_in_ring(lon, lat, hole) for hole in polygon[1:]
            ):
                return True
        return False

    def distance_km(self, lon: float, lat: float) -> float:
        """0 inside the country, else the distance to its nearest border or coast."""
        if self.contains(lon, lat):
            return 0.0
        best = math.inf
        for polygon in self.polygons:
            for ring in polygon:
                for a, b in zip(ring, ring[1:] + ring[:1], strict=True):
                    best = min(best, _segment_distance_km(lon, lat, a, b))
        return best


class Countries:
    """The 54 countries' polygons (Somaliland is part of Somalia, as on the map)."""

    def __init__(self, topology: dict[str, Any]) -> None:
        arcs = decode_arcs(topology)
        grouped: dict[str, list[tuple[Ring, ...]]] = {}
        for geometry in next(iter(topology["objects"].values()))["geometries"]:
            iso3 = (geometry.get("properties") or {}).get("iso3")
            if not iso3 or (geometry.get("properties") or {}).get("disputed"):
                continue
            for polygon in polygons_of(geometry):
                grouped.setdefault(iso3, []).append(
                    tuple(ring_points(ring, arcs) for ring in polygon)
                )
        self.by_iso3 = {
            iso3: CountryPolygons(iso3, tuple(polygons)) for iso3, polygons in grouped.items()
        }

    @classmethod
    def load(cls, path: Path = TOPOLOGY_FILE) -> Countries:
        return cls(json.loads(path.read_text()))

    def containing(self, lon: float, lat: float) -> list[str]:
        return sorted(
            iso3
            for iso3, shape in self.by_iso3.items()
            if _in_bbox(shape.bbox, lon, lat, margin=0.0) and shape.contains(lon, lat)
        )

    def near(self, lon: float, lat: float, *, within_km: float) -> dict[str, float]:
        """Countries within `within_km` of the point, with their distance (0 = inside)."""
        margin = within_km / 100 + 0.05  # degrees; generous
        found: dict[str, float] = {}
        for iso3, shape in self.by_iso3.items():
            if not _in_bbox(shape.bbox, lon, lat, margin=margin):
                continue
            distance = shape.distance_km(lon, lat)
            if distance <= within_km:
                found[iso3] = distance
        return found


def _in_bbox(
    bbox: tuple[float, float, float, float], lon: float, lat: float, *, margin: float
) -> bool:
    west, south, east, north = bbox
    return west - margin <= lon <= east + margin and south - margin <= lat <= north + margin
