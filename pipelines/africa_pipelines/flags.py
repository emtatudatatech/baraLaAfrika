"""`flags`: Flagpedia flag assets and region colours (spec §5.2).

* Cross-checks the 54 countries against Flagpedia's African list.
* Downloads each flag SVG from flagcdn.com (cached under data/raw/flags/) and copies it to
  apps/web/public/flags/ as the app's offline fallback.
* Computes each flag's palette and each region's mode colour (see region_colors.py), with and
  without neutral colours, and writes db/seeds/flags.json and data/region_colors_report.md.

Region colours are not wired into the app until they are approved.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import sys
from dataclasses import asdict, replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np

from . import http
from .flags_report import write_report
from .region_colors import (
    FlagPalette,
    Params,
    RegionResult,
    choose_region_colours,
    cluster_flag,
    merge_palettes,
)
from .settings import DATA_DIR, RAW_DIR, ROOT, SEEDS_DIR, WEB_PUBLIC_DIR

FLAGPEDIA_AFRICA_URL = "https://flagpedia.net/continent/africa"
FLAG_SVG_URL = "https://flagcdn.com/{code}.svg"
RAW_FLAGS_DIR = RAW_DIR / "flags"
PUBLIC_FLAGS_DIR = WEB_PUBLIC_DIR / "flags"
SEED_PATH = SEEDS_DIR / "flags.json"
REPORT_PATH = DATA_DIR / "region_colors_report.md"
SWATCH_DIR = DATA_DIR / "region_colors"
MANIFEST_PATH = RAW_FLAGS_DIR / "manifest.json"
MIN_STORED_SHARE = 0.00001  # palette entries below this round to 0 in flag_palette.area_share


class FlagsError(RuntimeError):
    pass


def _import_cairosvg() -> Any:
    """cairocffi looks for libcairo by name; on macOS add Homebrew's lib dirs to the dyld
    fallback path first (read by ctypes.util.find_library at call time)."""
    if sys.platform == "darwin":
        extra = [p for p in ("/opt/homebrew/lib", "/usr/local/lib") if Path(p).is_dir()]
        current = os.environ.get("DYLD_FALLBACK_LIBRARY_PATH", "")
        os.environ["DYLD_FALLBACK_LIBRARY_PATH"] = ":".join([*extra, current]).strip(":")
    import cairosvg

    return cairosvg


def rasterise(svg: bytes, width: int) -> np.ndarray[Any, np.dtype[np.uint8]]:
    """Render an SVG at `width` px and return its opaque pixels as an N x 3 uint8 array."""
    from PIL import Image

    cairosvg = _import_cairosvg()
    png = cairosvg.svg2png(bytestring=svg, output_width=width)
    image = Image.open(io.BytesIO(png)).convert("RGBA")
    rgba = np.asarray(image, dtype=np.uint8).reshape(-1, 4)
    return rgba[rgba[:, 3] >= 128, :3]


def flagpedia_african_codes(html: str) -> set[str]:
    codes = set(
        re.findall(
            r'href="/[a-z-]+"[^>]*>\s*<img[^>]*src="[^"]*?/([a-z]{2})\.(?:png|webp|svg)', html
        )
    )
    if len(codes) < 54:
        raise FlagsError(
            f"Parsed only {len(codes)} flags from Flagpedia's African list; "
            "the page layout may have changed"
        )
    return codes


def _load_countries() -> list[dict[str, Any]]:
    seed = json.loads((SEEDS_DIR / "countries.json").read_text(encoding="utf-8"))
    return [
        {"iso3": c["iso3"], "iso2": c["iso2"], "name": c["name"], "region": c["region"]}
        for c in seed["countries"]
    ]


def _region_order() -> list[str]:
    seed = json.loads((SEEDS_DIR / "countries.json").read_text(encoding="utf-8"))
    return [r["slug"] for r in sorted(seed["regions"], key=lambda r: r["sort_order"])]


def _manifest() -> dict[str, str]:
    if MANIFEST_PATH.exists():
        data: dict[str, str] = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        return data
    return {}


def fetch_flags(
    countries: list[dict[str, Any]], *, refresh: bool
) -> tuple[dict[str, bytes], set[str], str]:
    """Download (or read cached) SVGs; return them, Flagpedia's extra codes and the as-of date."""
    manifest = _manifest()
    today = datetime.now(UTC).date().isoformat()

    def get(url: str, path: Path) -> bytes:
        cached = path.exists() and not refresh
        body = http.fetch_bytes(url, path, refresh=refresh)
        if not cached:
            manifest[path.name] = today
        return body

    listing = get(FLAGPEDIA_AFRICA_URL, RAW_FLAGS_DIR / "flagpedia-africa.html").decode("utf-8")
    listed = flagpedia_african_codes(listing)
    ours = {c["iso2"].lower() for c in countries}
    missing = sorted(ours - listed)
    if missing:
        raise FlagsError(f"Not in Flagpedia's African list: {', '.join(missing)}")
    svgs = {
        c["iso3"]: get(
            FLAG_SVG_URL.format(code=c["iso2"].lower()), RAW_FLAGS_DIR / f"{c['iso2'].lower()}.svg"
        )
        for c in countries
    }
    for iso3, svg in svgs.items():
        if b"<svg" not in svg[:2048]:
            raise FlagsError(f"{iso3}: flagcdn did not return an SVG")
    MANIFEST_PATH.write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    as_of = max(manifest.get(f"{c['iso2'].lower()}.svg", today) for c in countries)
    return svgs, listed - ours, as_of


def copy_public_flags(countries: list[dict[str, Any]], svgs: dict[str, bytes]) -> int:
    PUBLIC_FLAGS_DIR.mkdir(parents=True, exist_ok=True)
    written = 0
    for country in countries:
        target = PUBLIC_FLAGS_DIR / f"{country['iso2'].lower()}.svg"
        body = svgs[country["iso3"]]
        if not target.exists() or target.read_bytes() != body:
            target.write_bytes(body)
            written += 1
    return written


def build_palettes(
    countries: list[dict[str, Any]], svgs: dict[str, bytes], params: Params
) -> list[FlagPalette]:
    palettes: list[FlagPalette] = []
    for country in sorted(countries, key=lambda c: c["iso3"]):
        pixels = rasterise(svgs[country["iso3"]], params.raster_width)
        entries, total = cluster_flag(pixels, params)
        palettes.append(FlagPalette(country["iso3"], country["region"], total, entries))
    return palettes


def run_algorithm(
    regions: list[str], palettes: list[FlagPalette], params: Params
) -> tuple[RegionResult, RegionResult]:
    """(result with the chosen params, result with include_neutrals flipped)."""
    groups = merge_palettes(palettes, params)
    primary = choose_region_colours(regions, palettes, groups, params)
    alternate = choose_region_colours(
        regions, palettes, groups, replace(params, include_neutrals=not params.include_neutrals)
    )
    return primary, alternate


def seed_payload(
    *,
    countries: list[dict[str, Any]],
    svgs: dict[str, bytes],
    palettes: list[FlagPalette],
    params: Params,
    primary: RegionResult,
    alternate: RegionResult,
    as_of: str,
) -> dict[str, Any]:
    by_iso3 = {c["iso3"]: c for c in countries}
    strict, with_neutrals = (
        (alternate, primary) if params.include_neutrals else (primary, alternate)
    )
    return {
        "dataset": {
            "key": "flags-flagpedia",
            "name": "Flag images (Flagpedia, flagcdn.com)",
            "provider": "Flagpedia.net",
            "license": "Flag images are in the public domain; served by the free flagcdn.com CDN",
            "attribution": "Flags: Flagpedia.net (flagcdn.com)",
            "coverage_start": None,
            "coverage_end": None,
            "as_of": as_of,
            "refresh_cadence": "monthly",
        },
        "params": asdict(params),
        "flags": [
            {
                "iso3": p.iso3,
                "iso2": by_iso3[p.iso3]["iso2"],
                "source_url": FLAG_SVG_URL.format(code=by_iso3[p.iso3]["iso2"].lower()),
                "svg_sha256": hashlib.sha256(svgs[p.iso3]).hexdigest(),
                "palette": [
                    {"hex": e.hex, "area_share": round(p.share(e), 5)}
                    for e in p.entries
                    if round(p.share(e), 5) >= MIN_STORED_SHARE
                ],
            }
            for p in palettes
        ],
        "region_colors": {
            "selected": "with_neutrals" if params.include_neutrals else "strict",
            "approved": False,
            "strict": {r: c.hex for r, c in strict.picks.items()},
            "with_neutrals": {r: c.hex for r, c in with_neutrals.picks.items()},
        },
    }


def configure(parser: argparse.ArgumentParser) -> None:
    defaults = Params()
    parser.add_argument(
        "--refresh", action="store_true", help="re-download instead of using the cache"
    )
    parser.add_argument(
        "--include-neutrals",
        action="store_true",
        help="let white, black and grey win (both results are always reported)",
    )
    parser.add_argument("--raster-width", type=int, default=defaults.raster_width)
    parser.add_argument("--max-clusters", type=int, default=defaults.max_clusters)
    parser.add_argument(
        "--min-colour-share",
        type=float,
        default=defaults.min_colour_share,
        help="fold colours below this share of a flag (edge blends) into the nearest",
    )
    parser.add_argument(
        "--blend-anchor-share",
        type=float,
        default=defaults.blend_anchor_share,
        help="minimum share for a colour to count as a blend endpoint",
    )
    parser.add_argument(
        "--blend-tolerance",
        type=float,
        default=defaults.blend_tolerance,
        help="max RGB distance from the line between two endpoints for a blend",
    )
    parser.add_argument("--merge-delta-e", type=float, default=defaults.merge_delta_e)
    parser.add_argument("--neutral-chroma", type=float, default=defaults.neutral_chroma)
    parser.add_argument("--uniqueness-delta-e", type=float, default=defaults.uniqueness_delta_e)
    parser.add_argument(
        "--weight",
        choices=["pixels", "flag_share"],
        default=defaults.weight,
        help="sum raw pixel areas (spec default) or give every flag equal weight",
    )


def run(args: argparse.Namespace) -> int:
    params = Params(
        raster_width=args.raster_width,
        max_clusters=args.max_clusters,
        min_colour_share=args.min_colour_share,
        blend_anchor_share=args.blend_anchor_share,
        blend_tolerance=args.blend_tolerance,
        merge_delta_e=args.merge_delta_e,
        neutral_chroma=args.neutral_chroma,
        uniqueness_delta_e=args.uniqueness_delta_e,
        include_neutrals=args.include_neutrals,
        weight=args.weight,
    )
    countries = _load_countries()
    regions = _region_order()
    svgs, extra_codes, as_of = fetch_flags(countries, refresh=args.refresh)
    copied = copy_public_flags(countries, svgs)
    palettes = build_palettes(countries, svgs, params)
    primary, alternate = run_algorithm(regions, palettes, params)

    payload = seed_payload(
        countries=countries,
        svgs=svgs,
        palettes=palettes,
        params=params,
        primary=primary,
        alternate=alternate,
        as_of=as_of,
    )
    SEED_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    summary = write_report(
        REPORT_PATH,
        SWATCH_DIR,
        countries=countries,
        palettes=palettes,
        params=params,
        primary=primary,
        alternate=alternate,
        extra_codes=extra_codes,
        as_of=as_of,
    )
    print(summary)
    print(
        f"\nWrote {SEED_PATH.relative_to(ROOT)}, {REPORT_PATH.relative_to(ROOT)}; "
        f"{copied} flag SVGs updated in {PUBLIC_FLAGS_DIR.relative_to(ROOT)}."
    )
    problems = primary.unresolved + alternate.unresolved
    return 1 if problems else 0
