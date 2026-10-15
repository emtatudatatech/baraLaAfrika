"""data/region_colors_report.md: the region-colour result for review and approval."""

from __future__ import annotations

from itertools import combinations
from pathlib import Path
from typing import Any

from .colour import contrast_ratio, delta_e_hex, simulate_cvd
from .region_colors import Candidate, FlagPalette, Params, RegionResult

# Page backgrounds from apps/web/src/styles/tokens.css (light and dark themes).
PAGE_BACKGROUNDS = {"light page": "#f6efe4", "dark page": "#11131d"}
MIN_DISTINCT_DELTA_E = 30.0  # below this, two map fills may be hard to tell apart
MIN_CVD_DELTA_E = 10.0  # below this under simulated colour-vision deficiency
MIN_FILL_CONTRAST = 1.5  # very low contrast against the page makes a fill hard to see
NEAR_TIE_POINTS = 1.0  # top two colours closer than this (percentage points) = no clear mode
WEAK_SHARE = 0.10  # a pick covering less than this share of its region is weakly representative

REGION_NAMES = {
    "north": "North Africa",
    "west": "West Africa",
    "central": "Central Africa",
    "east": "East Africa",
    "southern": "Southern Africa",
}


def _swatch(directory: Path, hex_value: str) -> str:
    """Write a small SVG swatch and return its path relative to the report."""
    swatches = directory / "swatches"
    swatches.mkdir(parents=True, exist_ok=True)
    name = f"{hex_value.lstrip('#')}.svg"
    (swatches / name).write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="18" viewBox="0 0 36 18">'
        f'<rect x="0.5" y="0.5" width="35" height="17" rx="3" fill="{hex_value}" '
        'stroke="#8a8a8a"/></svg>\n',
        encoding="utf-8",
    )
    return f"{directory.name}/swatches/{name}"


def _overview(directory: Path, name: str, picks: dict[str, Candidate]) -> str:
    width = 150 * len(picks)
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="96" '
        f'viewBox="0 0 {width} 96" font-family="Helvetica, Arial, sans-serif" font-size="13">'
    ]
    for index, (region, candidate) in enumerate(picks.items()):
        x = index * 150
        parts.append(
            f'<rect x="{x + 4}" y="4" width="142" height="58" rx="8" fill="{candidate.hex}" '
            'stroke="#8a8a8a"/>'
            f'<text x="{x + 6}" y="78" fill="#222">{REGION_NAMES.get(region, region)}</text>'
            f'<text x="{x + 6}" y="93" fill="#555">{candidate.hex}</text>'
        )
    parts.append("</svg>\n")
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{name}.svg"
    path.write_text("".join(parts), encoding="utf-8")
    return f"{directory.name}/{path.name}"


def legibility_issues(picks: dict[str, Candidate]) -> list[str]:
    issues: list[str] = []
    for (r1, c1), (r2, c2) in combinations(picks.items(), 2):
        distance = delta_e_hex(c1.hex, c2.hex)
        if distance < MIN_DISTINCT_DELTA_E:
            issues.append(
                f"{REGION_NAMES[r1]} ({c1.hex}) and {REGION_NAMES[r2]} ({c2.hex}) differ by only "
                f"ΔE {distance:.1f}; adjacent regions may be hard to tell apart on the map."
            )
        for kind in ("protanopia", "deuteranopia", "tritanopia"):
            simulated = delta_e_hex(simulate_cvd(c1.hex, kind), simulate_cvd(c2.hex, kind))
            if simulated < MIN_CVD_DELTA_E:
                issues.append(
                    f"With {kind}, {REGION_NAMES[r1]} and {REGION_NAMES[r2]} look nearly the same "
                    f"(simulated ΔE {simulated:.1f}); the legend and map need a non-colour cue."
                )
    for region, candidate in picks.items():
        for label, background in PAGE_BACKGROUNDS.items():
            ratio = contrast_ratio(candidate.hex, background)
            if ratio < MIN_FILL_CONTRAST:
                issues.append(
                    f"{REGION_NAMES[region]} ({candidate.hex}) has contrast {ratio:.2f}:1 against "
                    f"the {label}; country boundaries will need a stronger stroke there."
                )
    return issues


def representativeness_issues(result: RegionResult, palettes: list[FlagPalette]) -> list[str]:
    issues: list[str] = []
    for region, pick in result.picks.items():
        eligible = result.eligible[region]
        name = REGION_NAMES[region]
        flags_in_region = sum(1 for p in palettes if p.region == region)
        rank = [c.hex for c in eligible].index(pick.hex) + 1
        if rank > 1 and (rank >= 3 or pick.share < WEAK_SHARE):
            issues.append(
                f"{name}'s pick ({pick.hex}) is its #{rank} colour after the uniqueness rule: it "
                f"covers {pick.share:.1%} of the region's flag area and appears in "
                f"{len(pick.flags)} of {flags_in_region} flags, so it represents the region weakly."
            )
        if len(eligible) >= 2:
            first, second = eligible[0], eligible[1]
            if (first.share - second.share) * 100 < NEAR_TIE_POINTS:
                issues.append(
                    f"{name} has no clear mode: its top colours {first.hex} ({first.share:.1%}) "
                    f"and {second.hex} ({second.share:.1%}) are within {NEAR_TIE_POINTS:g} "
                    "percentage point of each other."
                )
    return issues


def _names(iso3s: tuple[str, ...], names: dict[str, str]) -> str:
    return ", ".join(names[i] for i in iso3s)


def _candidates_table(
    out: list[str],
    directory: Path,
    *,
    candidates: list[Candidate],
    pick: Candidate | None,
    names: dict[str, str],
    limit: int = 5,
) -> None:
    out.append("| Rank | Colour | Hex | Share of region | Neutral | Flags |")
    out.append("|---|---|---|---|---|---|")
    for rank, candidate in enumerate(candidates[:limit], start=1):
        marker = " **← pick**" if pick is not None and candidate.hex == pick.hex else ""
        out.append(
            f"| {rank} | ![{candidate.hex}]({_swatch(directory, candidate.hex)}) | "
            f"`{candidate.hex}`{marker} | {candidate.share:.1%} | "
            f"{'yes' if candidate.neutral else ''} | {_names(candidate.flags, names)} |"
        )
    if pick is not None and pick.hex not in {c.hex for c in candidates[:limit]}:
        rank = [c.hex for c in candidates].index(pick.hex) + 1
        out.append(
            f"| {rank} | ![{pick.hex}]({_swatch(directory, pick.hex)}) | `{pick.hex}` **← pick** | "
            f"{pick.share:.1%} |  | {_names(pick.flags, names)} |"
        )


def write_report(
    path: Path,
    swatch_dir: Path,
    *,
    countries: list[dict[str, Any]],
    palettes: list[FlagPalette],
    params: Params,
    primary: RegionResult,
    alternate: RegionResult,
    extra_codes: set[str],
    as_of: str,
) -> str:
    names = {c["iso3"]: c["name"] for c in countries}
    # Regenerate swatches from scratch so no stale files linger between runs.
    for old in (swatch_dir / "swatches").glob("*.svg"):
        old.unlink()
    strict, neutral = (alternate, primary) if params.include_neutrals else (primary, alternate)
    regions = list(strict.ranked)
    out: list[str] = []
    w = out.append

    w("# Region colours: report for approval")
    w("")
    w(
        "> **Status: awaiting approval.** These colours are not used in the app yet. Approve "
        "them (or choose the with-neutrals result, or different parameters) before they are "
        "wired into the map, legend, filters and table accents."
    )
    w("")
    w(
        f"Generated by `python -m pipelines flags` from the Flagpedia (flagcdn.com) SVGs of the 54 "
        f"countries, fetched {as_of}. Colours are reported exactly as computed; nothing has been "
        "adjusted by hand."
    )
    w("")
    w("## Result")
    w("")
    w(f"![Strict picks]({_overview(swatch_dir, 'picks-strict', strict.picks)})")
    w("")
    w("| Region | Pick (neutrals excluded) | Share of region | Pick if neutrals may win |")
    w("|---|---|---|---|")
    for region in regions:
        s = strict.picks.get(region)
        n = neutral.picks.get(region)
        strict_cell = f"![{s.hex}]({_swatch(swatch_dir, s.hex)}) `{s.hex}`" if s else "—"
        strict_share = f"{s.share:.1%}" if s else "—"
        neutral_cell = (
            f"![{n.hex}]({_swatch(swatch_dir, n.hex)}) `{n.hex}` ({n.share:.1%})" if n else "—"
        )
        w(f"| {REGION_NAMES[region]} | {strict_cell} | {strict_share} | {neutral_cell} |")
    w("")

    issues = representativeness_issues(strict, palettes) + legibility_issues(strict.picks)
    w("### Checks on the strict result")
    w("")
    for problem in strict.unresolved:
        w(f"- **Problem:** {problem}")
    for issue in issues:
        w(f"- **Issue:** {issue}")
    if not strict.unresolved and not issues:
        w("- No problems found.")
    w("")
    neutral_issues = representativeness_issues(neutral, palettes) + legibility_issues(neutral.picks)
    w("### Checks on the with-neutrals result")
    w("")
    for problem in neutral.unresolved:
        w(f"- **Problem:** {problem}")
    for issue in neutral_issues:
        w(f"- **Issue:** {issue}")
    if not neutral.unresolved and not neutral_issues:
        w("- No problems found.")
    w("")
    w(
        "Checks: picks closer than ΔE "
        f"{MIN_DISTINCT_DELTA_E:g} (or ΔE {MIN_CVD_DELTA_E:g} under simulated protanopia, "
        "deuteranopia or tritanopia) may be hard to tell apart; fills under "
        f"{MIN_FILL_CONTRAST:g}:1 against a page background are hard to see; a pick demoted to "
        f"its third colour or below, or covering under {WEAK_SHARE:.0%} of its region, "
        "represents the region weakly. Per the spec (§7.1), the dark theme may adjust a region "
        "colour's lightness and chroma in OKLCH (never its hue) where contrast is low; that is "
        "a display adjustment, not a change to these colours."
    )
    w("")
    w("Pairwise CIEDE2000 differences between the strict picks:")
    w("")
    w("| | " + " | ".join(REGION_NAMES[r] for r in regions) + " |")
    w("|---|" + "---|" * len(regions))
    for r1 in regions:
        row = []
        for r2 in regions:
            if r1 == r2 or r1 not in strict.picks or r2 not in strict.picks:
                row.append("—")
            else:
                row.append(f"{delta_e_hex(strict.picks[r1].hex, strict.picks[r2].hex):.1f}")
        w(f"| **{REGION_NAMES[r1]}** | " + " | ".join(row) + " |")
    w("")
    w(
        "Contrast of each strict pick against the page backgrounds (WCAG ratio; map fills are "
        "outlined by boundary strokes, so this is a visibility guide, not a text-contrast rule):"
    )
    w("")
    w("| Region | " + " | ".join(PAGE_BACKGROUNDS) + " |")
    w("|---|" + "---|" * len(PAGE_BACKGROUNDS))
    for region, candidate in strict.picks.items():
        w(
            f"| {REGION_NAMES[region]} | "
            + " | ".join(
                f"{contrast_ratio(candidate.hex, bg):.2f}:1" for bg in PAGE_BACKGROUNDS.values()
            )
            + " |"
        )
    w("")

    w("## How it was computed")
    w("")
    w(f"1. Each flag SVG was rasterised at {params.raster_width}px wide; only opaque pixels count.")
    w(
        f"2. Each flag was clustered into at most {params.max_clusters} colours (k-means in CIELAB "
        "over its distinct pixel colours, weighted by pixel count, fixed seed). Each cluster is "
        "represented by its most frequent exact pixel colour, so the hex values are the flags' "
        "own colours. Anti-aliasing blends were removed first: a colour under "
        f"{params.blend_anchor_share:.0%} of a flag lying within {params.blend_tolerance:g} RGB "
        "units of the line between two of the flag's main colours was folded into the nearer "
        f"one, and any colour still under {params.min_colour_share:.1%} into the nearest "
        "remaining colour."
    )
    w(
        "3. Clusters were merged across all 54 flags when their CIEDE2000 difference was below "
        f"{params.merge_delta_e:g} (largest clusters first; each joins the closest existing "
        "colour). A region's colour is shown in the shade most common in its own flags."
    )
    w(
        "4. For each region, "
        + (
            "the pixel areas"
            if params.weight == "pixels"
            else "the per-flag area shares (each flag weighted equally)"
        )
        + " of each merged colour were summed across the region's flags; the largest total is "
        "the region's mode colour."
    )
    w(
        f"5. Neutral colours (CIELAB chroma below {params.neutral_chroma:g}: whites, blacks, "
        "greys) are "
        + ("allowed to win" if params.include_neutrals else "excluded from the ranking by default")
        + "; the other result is reported too."
    )
    w(
        "6. Uniqueness: while two regions' picks were the same merged colour or closer than "
        f"ΔE {params.uniqueness_delta_e:g}, the region where that colour has the larger share "
        "kept it and the other moved to its next-ranked colour."
    )
    w("")
    w("Every parameter is a command-line option (`python -m pipelines flags --help`).")
    w("")

    for title, result in (("strict (neutrals excluded)", strict), ("with neutrals", neutral)):
        w(f"### Uniqueness decisions: {title}")
        w("")
        if result.steps:
            for step in result.steps:
                w(f"- {step}")
        else:
            w("- None needed: the regions' top colours were already distinct.")
        w("")

    w("## Top candidates per region")
    w("")
    w(
        "Ranked by share of each region's total flag area (neutral colours included in the "
        "list and marked; the strict pick skips them)."
    )
    w("")
    for region in regions:
        flags_in_region = [n for p in palettes if p.region == region for n in [names[p.iso3]]]
        w(f"### {REGION_NAMES[region]} ({len(flags_in_region)} flags)")
        w("")
        w("Strict pick:")
        w("")
        _candidates_table(
            out,
            swatch_dir,
            candidates=strict.ranked[region],
            pick=strict.picks.get(region),
            names=names,
        )
        w("")
        n_pick = neutral.picks.get(region)
        if n_pick is not None:
            swatch = _swatch(swatch_dir, n_pick.hex)
            w(
                f"With neutrals the pick would be ![{n_pick.hex}]({swatch}) "
                f"`{n_pick.hex}` ({n_pick.share:.1%})."
            )
            w("")

    w("## Flagpedia cross-check")
    w("")
    w(
        "All 54 countries appear in "
        "[Flagpedia's African list](https://flagpedia.net/continent/africa). "
        f"It also lists {len(extra_codes)} entries that are not among the 54 states and were "
        "not used: "
        + ", ".join(f"`{c}`" for c in sorted(extra_codes))
        + " (territories and Western Sahara)."
    )
    w("")

    w("## Flag palettes")
    w("")
    w("Each flag's colour clusters (largest first), as stored in `flag_palette`.")
    w("")
    w("| Country | Region | Palette (share of flag) |")
    w("|---|---|---|")
    for palette in sorted(palettes, key=lambda p: (regions.index(p.region), names[p.iso3])):
        cells = " ".join(
            f"![{e.hex}]({_swatch(swatch_dir, e.hex)}) `{e.hex}` {palette.share(e):.0%}"
            for e in palette.entries
            if palette.share(e) >= 0.01
        )
        w(f"| {names[palette.iso3]} | {REGION_NAMES[palette.region]} | {cells} |")
    w("")
    w("Clusters under 1% of a flag are omitted from this table (they are kept in the seed).")
    w("")

    path.write_text("\n".join(out), encoding="utf-8")

    lines = ["Region colours (strict, neutrals excluded):"]
    for region in regions:
        pick = strict.picks.get(region)
        lines.append(
            f"  {REGION_NAMES[region]:<16} {pick.hex if pick else '—'}"
            + (f"  ({pick.share:.1%})" if pick else "")
        )
    lines.append("With neutrals:")
    for region in regions:
        pick = neutral.picks.get(region)
        lines.append(f"  {REGION_NAMES[region]:<16} {pick.hex if pick else '—'}")
    if issues or strict.unresolved:
        lines.append(
            f"Strict result: {len(issues) + len(strict.unresolved)} issue(s) noted in the report."
        )
    return "\n".join(lines)
