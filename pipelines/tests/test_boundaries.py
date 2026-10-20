from __future__ import annotations

import json
import math
from typing import Any

import pytest

from pipelines.africa_pipelines import boundaries as b
from pipelines.africa_pipelines.settings import SEEDS_DIR

# A tiny quantised topology on a 0.5° grid: arcs are delta-encoded integer steps.
TRANSFORM = {"scale": [0.5, 0.5], "translate": [0.0, 0.0]}


def topology(arcs: list[list[list[int]]], geometries: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "type": "Topology",
        "transform": TRANSFORM,
        "arcs": arcs,
        "objects": {"countries": {"type": "GeometryCollection", "geometries": geometries}},
    }


def square(x: int, y: int, size: int) -> list[list[int]]:
    """A closed square ring as one delta-encoded arc (quantised units)."""
    return [[x, y], [size, 0], [0, size], [-size, 0], [0, -size]]


def test_equal_earth_matches_the_published_projection_bounds() -> None:
    # Unit-sphere Equal Earth: x at 180°E on the equator and y at the pole.
    x, _ = b.equal_earth(180, 0)
    _, y = b.equal_earth(0, 90)
    assert x == pytest.approx(2.706629, abs=1e-6)
    assert y == pytest.approx(1.317363, abs=1e-6)
    assert b.equal_earth(-30, -45) == pytest.approx(tuple(-v for v in b.equal_earth(30, 45)))


def cell_area_km2(lat_south: float, lat_north: float, width_deg: float) -> float:
    """Exact area of a latitude/longitude cell on the sphere."""
    sin_band = math.sin(math.radians(lat_north)) - math.sin(math.radians(lat_south))
    return b.EARTH_RADIUS_KM**2 * math.radians(width_deg) * sin_band


def test_polygon_area_is_equal_area() -> None:
    # Equal Earth preserves area; the only error is joining projected vertices with straight
    # lines where meridians curve slightly (about 1e-5 for a 1 degree cell).
    equator = b.decode_arcs(topology([square(0, 0, 2)], []))  # 1 degree square at the equator
    assert b.polygon_area_km2([[0]], equator) == pytest.approx(cell_area_km2(0, 1, 1), rel=1e-4)
    north = b.decode_arcs(topology([square(0, 120, 2)], []))  # 60-61 degrees N
    assert b.polygon_area_km2([[0]], north) == pytest.approx(cell_area_km2(60, 61, 1), rel=1e-4)


def test_subset_topology_reindexes_used_arcs_and_keeps_direction() -> None:
    world = topology([square(0, 0, 2), square(10, 10, 2), square(20, 20, 2)], [])
    subset = b.subset_topology(
        world, {"countries": [{"type": "Polygon", "arcs": [[~2]], "properties": {"iso3": "AAA"}}]}
    )
    assert subset["arcs"] == [world["arcs"][2]]
    geometry = subset["objects"]["countries"]["geometries"][0]
    assert geometry == {"type": "Polygon", "arcs": [[~0]], "properties": {"iso3": "AAA"}}


def test_interior_point_falls_inside_concave_shapes() -> None:
    # A "C" shape whose centroid lies in the notch.
    ring: list[tuple[float, float]] = [
        (0, 0), (10, 0), (10, 2), (2, 2), (2, 8), (10, 8), (10, 10), (0, 10),
    ]  # fmt: skip
    lon, lat = b.interior_point(ring)
    assert b.point_in_ring(lon, lat, ring)
    _, cx, cy = b.planar_area_and_centroid(ring)
    assert not b.point_in_ring(cx, cy, ring)


def make_world() -> dict[str, Any]:
    # Spain sits at 10-5 degrees W, 36-41 degrees N, inside the context window.
    arcs = [square(0, 0, 40), square(60, 0, 2), square(100, 0, 40), square(0, 100, 40),
            square(-20, 72, 10)]  # fmt: skip
    geometries = [
        {"type": "Polygon", "arcs": [[0]], "id": "706", "properties": {"name": "Somalia"}},
        {"type": "Polygon", "arcs": [[1]], "id": "690", "properties": {"name": "Seychelles"}},
        {"type": "Polygon", "arcs": [[2]], "properties": {"name": "Somaliland"}},
        {"type": "Polygon", "arcs": [[3]], "id": "732", "properties": {"name": "W. Sahara"}},
        {"type": "Polygon", "arcs": [[4]], "id": "724", "properties": {"name": "Spain"}},
    ]
    return topology(arcs, geometries)


COUNTRIES = [
    {"iso3": "SOM", "iso_numeric": 706, "name": "Somalia"},
    {"iso3": "SYC", "iso_numeric": 690, "name": "Seychelles"},
]


def test_build_handles_somaliland_western_sahara_markers_and_context() -> None:
    countries_topo, context_topo, shapes, notes = b.build(make_world(), COUNTRIES, 20_000)
    props = [g["properties"] for g in countries_topo["objects"]["countries"]["geometries"]]
    assert props.count({"iso3": "SOM"}) == 2  # Somalia + Somaliland, both styled as Somalia
    assert {"iso3": "ESH", "disputed": True} in props
    assert len(context_topo["objects"]["land"]["geometries"]) == 1  # Spain is in the window
    by_iso3 = {s.iso3: s for s in shapes}
    assert by_iso3["SYC"].is_microstate_marker
    assert not by_iso3["SOM"].is_microstate_marker
    assert by_iso3["SOM"].polygons == 2  # area includes Somaliland
    assert any("Somaliland" in note for note in notes)


def test_build_fails_loudly_when_a_country_is_missing() -> None:
    with pytest.raises(b.BoundariesError, match="Kenya"):
        b.build(make_world(), [*COUNTRIES, {"iso3": "KEN", "iso_numeric": 404, "name": "Kenya"}], 1)


@pytest.mark.skipif(not b.CACHE_PATH.exists(), reason="world-atlas source not downloaded")
def test_real_natural_earth_data() -> None:
    world = json.loads(b.CACHE_PATH.read_text())
    seed = json.loads((SEEDS_DIR / "countries.json").read_text(encoding="utf-8"))
    countries_topo, _context, shapes, _notes = b.build(world, seed["countries"], 20_000)
    assert len(shapes) == 54
    markers = {s.iso3 for s in shapes if s.is_microstate_marker}
    assert markers == {"CPV", "STP", "COM", "MUS", "SYC", "GMB", "SWZ"}
    areas = {s.iso3: s.area_km2 for s in shapes}
    # Generalised 1:50m outlines come out a little under official areas (d3-geo's spherical
    # geoArea gives the same figures for this geometry), enough to put the DR Congo just
    # above Algeria here although Algeria is officially larger.
    assert areas["DZA"] == pytest.approx(2_381_741, rel=0.04)
    assert areas["COD"] == pytest.approx(2_344_858, rel=0.04)
    assert sorted(areas, key=areas.__getitem__)[-2:] == ["DZA", "COD"]
    geometries = countries_topo["objects"]["countries"]["geometries"]
    assert len(geometries) == 56  # 54 + Somaliland + Western Sahara
