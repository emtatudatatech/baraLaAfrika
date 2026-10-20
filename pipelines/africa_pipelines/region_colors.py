"""Region colour = the mode colour across the flags of a region (spec §5.2).

1. Each flag is rasterised (~320px wide) and its pixels converted to CIELAB.
2. Each flag is clustered into ≤ max_clusters colours (k-means in Lab over its distinct pixel
   colours, weighted by pixel count). A cluster is represented by its most frequent exact pixel
   colour, so palettes use the flag's real colours rather than blended averages. Before
   clustering, anti-aliasing blends are removed: a minor colour lying on the RGB line between
   two of the flag's main colours (an edge pixel mixing its neighbours) is folded into the
   nearer of the two, and any colour still under min_colour_share is folded into the nearest
   remaining colour.
3. Clusters are merged across all flags when their CIEDE2000 difference is below merge_delta_e
   (greedy, largest clusters first, each joining the closest existing colour group).
4. For each region the pixel area of every merged colour is summed across its flags; the largest
   total is the region's mode colour. A merged colour is shown in the shade that is most common
   within that region's own flags. By default achromatic colours (chroma below
   neutral_chroma: whites, blacks, greys) are excluded from the ranking.
5. Uniqueness: while two regions' picks are the same merged colour or within
   uniqueness_delta_e of each other, the region where that colour has the larger share keeps it
   and the other moves to its next-ranked colour.

Everything is deterministic: inputs are sorted and k-means uses a fixed seed.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

import numpy as np
import numpy.typing as npt
from sklearn.cluster import KMeans

from .colour import chroma, ciede2000, hex_to_rgb, rgb_to_hex, rgb_to_lab


@dataclass(frozen=True)
class Params:
    raster_width: int = 320
    max_clusters: int = 8
    min_colour_share: float = 0.005
    blend_anchor_share: float = 0.03  # colours at least this large can be blend endpoints
    blend_tolerance: float = 12.0  # max RGB distance from the line between two endpoints
    merge_delta_e: float = 10.0
    neutral_chroma: float = 10.0
    uniqueness_delta_e: float = 20.0
    include_neutrals: bool = False
    weight: Literal["pixels", "flag_share"] = "pixels"
    random_state: int = 0


@dataclass(frozen=True)
class PaletteEntry:
    hex: str
    pixels: int

    @property
    def lab(self) -> npt.NDArray[np.float64]:
        return rgb_to_lab(hex_to_rgb(self.hex))


@dataclass
class FlagPalette:
    iso3: str
    region: str
    total_pixels: int
    entries: list[PaletteEntry]  # sorted by pixels, descending

    def share(self, entry: PaletteEntry) -> float:
        return entry.pixels / self.total_pixels


def cluster_flag(
    pixels_rgb: npt.NDArray[np.uint8], params: Params
) -> tuple[list[PaletteEntry], int]:
    """Cluster one flag's opaque pixels (an N x 3 uint8 array) into ≤ max_clusters colours."""
    colours, counts = np.unique(pixels_rgb.reshape(-1, 3), axis=0, return_counts=True)
    total = int(counts.sum())
    colours, counts = fold_edge_blends(
        colours, counts, params.blend_anchor_share, params.blend_tolerance
    )
    colours, counts = fold_minor_colours(colours, counts, params.min_colour_share)
    k = min(params.max_clusters, len(colours))
    if k == len(colours):
        labels = np.arange(len(colours))
    else:
        model = KMeans(n_clusters=k, n_init=4, random_state=params.random_state)
        labels = model.fit_predict(rgb_to_lab(colours), sample_weight=counts)
    entries: list[PaletteEntry] = []
    for label in np.unique(labels):
        members = labels == label
        dominant = colours[members][np.argmax(counts[members])]
        entries.append(PaletteEntry(rgb_to_hex(dominant), int(counts[members].sum())))
    entries.sort(key=lambda e: (-e.pixels, e.hex))
    return entries, total


def fold_edge_blends(
    colours: npt.NDArray[np.uint8],
    counts: npt.NDArray[np.int64],
    anchor_share: float,
    tolerance: float,
) -> tuple[npt.NDArray[np.uint8], npt.NDArray[np.int64]]:
    """Fold anti-aliasing blends: a colour below `anchor_share` that lies within `tolerance`
    (RGB units) of the segment between two anchor colours goes to the nearer anchor."""
    anchors = np.flatnonzero(counts / counts.sum() >= anchor_share)
    if len(anchors) < 2:
        return colours, counts
    rgb = colours.astype(np.float64)
    keep = np.ones(len(colours), dtype=bool)
    folded = counts.copy()
    for index in np.flatnonzero(counts / counts.sum() < anchor_share):
        best: tuple[float, int] | None = None
        for i, p in enumerate(anchors):
            for q in anchors[i + 1 :]:
                start, end = rgb[p], rgb[q]
                span = end - start
                t = float(np.clip(np.dot(rgb[index] - start, span) / np.dot(span, span), 0, 1))
                distance = float(np.linalg.norm(rgb[index] - (start + t * span)))
                if distance <= tolerance and (best is None or distance < best[0]):
                    best = (distance, int(p if t < 0.5 else q))
        if best is not None:
            folded[best[1]] += counts[index]
            keep[index] = False
    return colours[keep], folded[keep]


def fold_minor_colours(
    colours: npt.NDArray[np.uint8], counts: npt.NDArray[np.int64], min_share: float
) -> tuple[npt.NDArray[np.uint8], npt.NDArray[np.int64]]:
    """Add the pixels of colours below `min_share` of the flag to their nearest (CIELAB)
    colour at or above it; these are anti-aliasing blends, not flag colours."""
    major = counts / counts.sum() >= min_share
    if major.all():
        return colours, counts
    if not major.any():
        major = counts == counts.max()
    major_lab = rgb_to_lab(colours[major])
    minor_lab = rgb_to_lab(colours[~major])
    nearest = np.argmin(
        np.linalg.norm(minor_lab[:, None, :] - major_lab[None, :, :], axis=2), axis=1
    )
    folded = counts[major].copy()
    np.add.at(folded, nearest, counts[~major])
    return colours[major], folded


@dataclass
class ColourGroup:
    hex: str  # the founding (largest) cluster's colour
    members: list[tuple[str, PaletteEntry]] = field(default_factory=list)  # (iso3, entry)

    @property
    def lab(self) -> npt.NDArray[np.float64]:
        return rgb_to_lab(hex_to_rgb(self.hex))

    @property
    def chroma(self) -> float:
        return float(chroma(self.lab))


def merge_palettes(flags: list[FlagPalette], params: Params) -> list[ColourGroup]:
    """Greedy cross-flag merge: largest clusters first; each joins the closest group whose
    founding colour is within merge_delta_e, otherwise founds a new group."""
    clusters = sorted(
        ((flag.iso3, entry) for flag in flags for entry in flag.entries),
        key=lambda item: (-item[1].pixels, item[0], item[1].hex),
    )
    groups: list[ColourGroup] = []
    for iso3, entry in clusters:
        best: ColourGroup | None = None
        best_distance = params.merge_delta_e
        for group in groups:
            distance = float(ciede2000(entry.lab, group.lab))
            if distance < best_distance:
                best, best_distance = group, distance
        if best is None:
            best = ColourGroup(hex=entry.hex)
            groups.append(best)
        best.members.append((iso3, entry))
    return groups


@dataclass(frozen=True)
class Candidate:
    hex: str  # the shade of this merged colour that is most common in the region's flags
    group_hex: str  # the merged colour group's founding colour (identifies the group)
    weight: float  # pixels (or summed flag shares) in this region
    share: float  # fraction of the region's total weight
    neutral: bool
    flags: tuple[str, ...]  # iso3 codes contributing


def rank_region(
    region: str, flags: list[FlagPalette], groups: list[ColourGroup], params: Params
) -> list[Candidate]:
    in_region = {f.iso3: f for f in flags if f.region == region}

    def weight_of(iso3: str, entry: PaletteEntry) -> float:
        flag = in_region[iso3]
        return entry.pixels if params.weight == "pixels" else flag.share(entry)

    total = sum(weight_of(f.iso3, e) for f in in_region.values() for e in f.entries)
    candidates: list[Candidate] = []
    for group in groups:
        contributing = [(iso3, e) for iso3, e in group.members if iso3 in in_region]
        if not contributing:
            continue
        weight = sum(weight_of(iso3, e) for iso3, e in contributing)
        by_shade: dict[str, float] = {}
        for iso3, entry in contributing:
            by_shade[entry.hex] = by_shade.get(entry.hex, 0.0) + weight_of(iso3, entry)
        regional_shade = min(by_shade, key=lambda shade: (-by_shade[shade], shade))
        candidates.append(
            Candidate(
                hex=regional_shade,
                group_hex=group.hex,
                weight=weight,
                share=weight / total,
                neutral=group.chroma < params.neutral_chroma,
                flags=tuple(sorted({iso3 for iso3, _ in contributing})),
            )
        )
    candidates.sort(key=lambda c: (-c.weight, c.hex))
    return candidates


@dataclass
class RegionResult:
    ranked: dict[str, list[Candidate]]  # all candidates per region (neutrals included)
    eligible: dict[str, list[Candidate]]  # candidates allowed to win
    picks: dict[str, Candidate]
    steps: list[str]  # uniqueness decisions, in order
    unresolved: list[str]


def choose_region_colours(
    regions: list[str], flags: list[FlagPalette], groups: list[ColourGroup], params: Params
) -> RegionResult:
    ranked = {r: rank_region(r, flags, groups, params) for r in regions}
    eligible = {
        r: [c for c in ranked[r] if params.include_neutrals or not c.neutral] for r in regions
    }
    position = dict.fromkeys(regions, 0)
    steps: list[str] = []
    unresolved: list[str] = []

    def current(region: str) -> Candidate | None:
        options = eligible[region]
        return options[position[region]] if position[region] < len(options) else None

    for _ in range(sum(len(v) for v in eligible.values()) + 1):
        conflict: tuple[float, str, str] | None = None
        for i, first in enumerate(regions):
            for second in regions[i + 1 :]:
                a, b = current(first), current(second)
                if a is None or b is None:
                    continue
                distance = float(
                    ciede2000(rgb_to_lab(hex_to_rgb(a.hex)), rgb_to_lab(hex_to_rgb(b.hex)))
                )
                same_group = a.group_hex == b.group_hex
                if (same_group or distance < params.uniqueness_delta_e) and (
                    conflict is None or distance < conflict[0]
                ):
                    conflict = (distance, first, second)
        if conflict is None:
            break
        distance, first, second = conflict
        a, b = current(first), current(second)
        assert a is not None and b is not None
        first_wins = (a.share, -regions.index(first)) >= (b.share, -regions.index(second))
        keeper, loser = (first, second) if first_wins else (second, first)
        kept, lost = current(keeper), current(loser)
        assert kept is not None and lost is not None
        position[loser] += 1
        replacement = current(loser)
        reason = (
            "are the same merged colour"
            if lost.group_hex == kept.group_hex
            else f"are only ΔE {distance:.1f} apart (< {params.uniqueness_delta_e:g})"
        )
        steps.append(
            f"{loser} ({lost.hex}, {lost.share:.1%} of its flags' area) and {keeper} "
            f"({kept.hex}, {kept.share:.1%}) {reason}; {keeper} keeps its colour and {loser} "
            "moves to "
            + (
                f"{replacement.hex} ({replacement.share:.1%})."
                if replacement
                else "no remaining colour."
            )
        )

    picks: dict[str, Candidate] = {}
    for region in regions:
        pick = current(region)
        if pick is None:
            unresolved.append(f"{region}: no eligible colour left after the uniqueness rule")
        else:
            picks[region] = pick
    return RegionResult(ranked, eligible, picks, steps, unresolved)
