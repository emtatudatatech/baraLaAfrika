from __future__ import annotations

from dataclasses import replace

import numpy as np
import pytest

from pipelines.africa_pipelines import flags
from pipelines.africa_pipelines.region_colors import (
    FlagPalette,
    PaletteEntry,
    Params,
    choose_region_colours,
    cluster_flag,
    merge_palettes,
)


def stripes(colours: list[str], *, vertical: bool = False, extra: str = "") -> bytes:
    """A simple striped test flag (3:2), optionally with extra SVG elements."""
    width, height = 300, 200
    step = (width if vertical else height) / len(colours)
    rect_w, rect_h = (step, height) if vertical else (width, step)
    rects = "".join(
        f'<rect x="{i * step if vertical else 0}" y="{0 if vertical else i * step}" '
        f'width="{rect_w}" height="{rect_h}" fill="{c}"/>'
        for i, c in enumerate(colours)
    )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}">'
        f"{rects}{extra}</svg>"
    ).encode()


def palette_of(iso3: str, region: str, svg: bytes, params: Params) -> FlagPalette:
    entries, total = cluster_flag(flags.rasterise(svg, params.raster_width), params)
    return FlagPalette(iso3, region, total, entries)


def test_rasterise_and_cluster_a_tricolour_exactly() -> None:
    params = Params()
    palette = palette_of("AAA", "x", stripes(["#009e49", "#fcd116", "#ce1126"]), params)
    assert {e.hex for e in palette.entries} == {"#009e49", "#fcd116", "#ce1126"}
    for entry in palette.entries:
        assert palette.share(entry) == pytest.approx(1 / 3, abs=0.01)


def test_cluster_count_is_capped_and_uses_real_colours() -> None:
    params = Params(max_clusters=8)
    circle = '<circle cx="150" cy="100" r="60" fill="#ffffff"/>'  # anti-aliased edge
    many = stripes(
        ["#ff0000", "#00ff00", "#0000ff", "#ffff00", "#00ffff", "#ff00ff", "#800000", "#008000",
         "#000080", "#808000"],
        extra=circle,
    )  # fmt: skip
    palette = palette_of("BBB", "x", many, params)
    assert len(palette.entries) <= 8
    assert sum(e.pixels for e in palette.entries) == palette.total_pixels
    # Every representative is a colour that actually occurs in the flag.
    pixels = {tuple(p) for p in flags.rasterise(many, params.raster_width).tolist()}
    for entry in palette.entries:
        assert tuple(int(entry.hex[i : i + 2], 16) for i in (1, 3, 5)) in pixels


def make(iso3: str, region: str, *entries: tuple[str, int]) -> FlagPalette:
    items = [PaletteEntry(h, n) for h, n in entries]
    return FlagPalette(iso3, region, sum(n for _, n in entries), items)


def test_merge_joins_close_shades_only() -> None:
    palettes = [
        make("AAA", "north", ("#c1272d", 900), ("#ffffff", 100)),
        make("BBB", "north", ("#ce1126", 500), ("#009e49", 500)),  # red within ΔE 10 of #c1272d
    ]
    groups = merge_palettes(palettes, Params())
    reds = next(g for g in groups if g.hex == "#c1272d")
    assert {iso3 for iso3, _ in reds.members} == {"AAA", "BBB"}
    assert len(groups) == 3


def test_neutrals_are_excluded_by_default_and_reported_otherwise() -> None:
    palettes = [make("AAA", "north", ("#ffffff", 700), ("#c1272d", 300))]
    groups = merge_palettes(palettes, Params())
    strict = choose_region_colours(["north"], palettes, groups, Params())
    assert strict.picks["north"].hex == "#c1272d"
    neutral = choose_region_colours(["north"], palettes, groups, Params(include_neutrals=True))
    assert neutral.picks["north"].hex == "#ffffff"


def test_uniqueness_keeps_colour_where_its_share_is_larger() -> None:
    palettes = [
        make("AAA", "north", ("#c1272d", 800), ("#009e49", 200)),  # red 80%
        make("BBB", "west", ("#ce1126", 600), ("#fcd116", 400)),  # red 60%, same group
    ]
    params = Params()
    result = choose_region_colours(
        ["north", "west"], palettes, merge_palettes(palettes, params), params
    )
    assert result.picks["north"].hex == "#c1272d"
    assert result.picks["west"].hex == "#fcd116"
    assert "same merged colour" in result.steps[0]


def test_a_region_is_shown_in_its_own_shade() -> None:
    palettes = [
        make("AAA", "north", ("#00a95c", 900)),  # founds the green group
        make("BBB", "west", ("#009e49", 500), ("#fcd116", 400)),
    ]
    params = Params(uniqueness_delta_e=0)
    groups = merge_palettes(palettes, params)
    ranked = choose_region_colours(["west"], palettes, groups, params).ranked["west"]
    assert ranked[0].hex == "#009e49"  # West's own green, not the group founder
    assert ranked[0].group_hex == "#00a95c"


def test_unresolvable_regions_are_reported_not_guessed() -> None:
    palettes = [make("AAA", "north", ("#c1272d", 1)), make("BBB", "west", ("#c1272d", 1))]
    params = Params()
    result = choose_region_colours(
        ["north", "west"], palettes, merge_palettes(palettes, params), params
    )
    assert "west" not in result.picks
    assert result.unresolved


def test_results_are_deterministic_and_order_independent() -> None:
    params = Params()
    svgs = {
        "AAA": stripes(["#c1272d", "#ffffff", "#006633"], vertical=True),
        "BBB": stripes(["#009e49", "#fcd116", "#ce1126"]),
        "CCC": stripes(["#3a75c4", "#fcd116", "#009e60"]),
    }
    regions = {"AAA": "north", "BBB": "west", "CCC": "central"}

    def run(order: list[str]) -> dict[str, str]:
        palettes = sorted(
            (palette_of(i, regions[i], svgs[i], params) for i in order), key=lambda p: p.iso3
        )
        result = choose_region_colours(
            ["north", "west", "central"], palettes, merge_palettes(palettes, params), params
        )
        return {r: c.hex for r, c in result.picks.items()}

    first = run(["AAA", "BBB", "CCC"])
    assert first == run(["CCC", "AAA", "BBB"])
    assert first == run(["AAA", "BBB", "CCC"])


def test_flagpedia_list_parser() -> None:
    item = '<a href="/{slug}"><img src="https://flagcdn.com/w40/{code}.webp"></a>'
    codes = [f"{a}{b}" for a in "abcdefgh" for b in "abcdefg"][:56]
    html = "".join(item.format(slug=f"c-{c}", code=c) for c in codes)
    assert flags.flagpedia_african_codes(html) == set(codes)
    with pytest.raises(flags.FlagsError, match="layout may have changed"):
        flags.flagpedia_african_codes(item.format(slug="x", code="ke"))


def test_seed_payload_stores_rounded_shares_and_is_unapproved() -> None:
    params = Params()
    palettes = [make("KEN", "east", ("#000000", 99999), ("#bb0000", 1))]
    picks = choose_region_colours(["east"], palettes, merge_palettes(palettes, params), params)
    other = choose_region_colours(
        ["east"], palettes, merge_palettes(palettes, params), replace(params, include_neutrals=True)
    )
    payload = flags.seed_payload(
        countries=[{"iso3": "KEN", "iso2": "KE", "name": "Kenya", "region": "east"}],
        svgs={"KEN": b"<svg/>"},
        palettes=palettes,
        params=params,
        primary=picks,
        alternate=other,
        as_of="2026-10-15",
    )
    assert payload["region_colors"]["approved"] is False
    assert payload["region_colors"]["strict"] == {"east": "#bb0000"}
    stored = payload["flags"][0]["palette"]
    assert stored == [
        {"hex": "#000000", "area_share": 0.99999},
        {"hex": "#bb0000", "area_share": 0.00001},
    ]
    assert np.isclose(sum(e["area_share"] for e in stored), 1.0)


def test_edge_blends_between_stripes_are_folded_away() -> None:
    params = Params()
    # Liberia-like: many thin stripes produce red/white blend rows at a non-integer scale.
    many_stripes = stripes(["#bf0a30", "#ffffff"] * 6 + ["#bf0a30"], extra=(
        '<rect width="120" height="92" fill="#002868"/>'
    ))  # fmt: skip
    palette = palette_of("LBR", "west", many_stripes, params)
    assert {e.hex for e in palette.entries} == {"#bf0a30", "#ffffff", "#002868"}


def test_small_real_details_survive_blend_folding() -> None:
    params = Params()
    # A gold emblem (about 2% of the flag) is not a mix of the black and white around it.
    emblem = '<circle cx="150" cy="100" r="16" fill="#c09300"/>'
    palette = palette_of(
        "EGY", "north", stripes(["#ce1126", "#ffffff", "#000000"], extra=emblem), params
    )
    assert "#c09300" in {e.hex for e in palette.entries}
