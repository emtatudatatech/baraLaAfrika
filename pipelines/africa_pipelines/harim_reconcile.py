"""Reconcile the Harim sources into one curated catalogue.

Inputs: the prototype baseline, Wikidata (peaks, P610/P1589 country extremes), the World
Factbook's final edition (country extremes), GeoNames (elevation cross-checks) and the curation
file (pipelines/africa_pipelines/reference/harim_curation.json), whose every text claim carries a
source and a quote that is re-checked against the cached source text.

Rules (thresholds in the curation file's "selection" block):
- Elevation: among the most reliable tier of sources present, the value that most independent
  source families agree on (within `agree_m`); ties go to the configured family priority. All
  other values are kept as alternatives. Disagreement above `review_m` → needs_review; above
  `low_m` → confidence low. One source only → medium (low if it is a bulk import).
- Country high and low points: Wikidata P610/P1589, cross-checked with the Factbook. When they
  name different features, the run fails unless the curation file records a decision.
- Selection: every country high point, every peak of `always_include_m` or more, every prototype
  peak, curated inclusions and territory high points; then up to `notable_per_country` notable
  peaks per country. A point within a mountain's radius (`subsidiary_km`, or a massif's own) is a
  subsidiary point, not a separate mountain, and is listed in the report.
- Hierarchy: massif → summit, two levels, only as curated (with sources).
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

from .harim_baseline import BaselineEntry, fold
from .harim_geo import Countries, haversine_km
from .harim_sources import FactbookSnapshot, GeoNamesPeak
from .harim_wikidata import (
    VOLCANIC_STATUS_CLASSES,
    VOLCANO_CLASSES,
    CountryExtreme,
    WikidataPeak,
)
from .sources import TIER_ORDER, Tier, classify

# Families of sources whose values are independent of each other.
FAMILIES = ("wikidata", "factbook", "wikipedia", "geonames", "harim-prototype")


class ReconcileError(RuntimeError):
    def __init__(self, problems: list[str]) -> None:
        super().__init__("\n".join(f"- {p}" for p in problems))
        self.problems = problems


# ── Sources ──────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class SourceRecord:
    key: str
    title: str
    url: str
    source_type: str
    tier: Tier


class SourceRegistry:
    def __init__(self) -> None:
        self.records: dict[str, SourceRecord] = {}

    def add(self, key: str, title: str, url: str) -> SourceRecord:
        existing = self.records.get(key)
        if existing is not None:
            return existing
        rule = classify(url)
        record = SourceRecord(key, title, url, rule.source_type, rule.tier)
        self.records[key] = record
        return record

    def wikidata(self, qid: str, label: str) -> SourceRecord:
        return self.add(
            f"wikidata-{qid.lower()}",
            f"Wikidata: {label} ({qid})",
            f"https://www.wikidata.org/wiki/{qid}",
        )

    def geonames(self, geonames_id: int, name: str) -> SourceRecord:
        return self.add(
            f"geonames-{geonames_id}",
            f"GeoNames: {name} ({geonames_id})",
            f"https://www.geonames.org/{geonames_id}",
        )

    def wikipedia(self, url: str) -> SourceRecord:
        from .harim_sources import wikipedia_title

        title = wikipedia_title(url)
        return self.add(f"wikipedia-{slugify(title)}", f"Wikipedia: {title}", url)


# ── Records ──────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Elevation:
    metres: float
    source: str
    family: str
    tier: Tier
    label: str


@dataclass
class Mountain:
    key: str  # Wikidata QID
    name: str
    lon: float
    lat: float
    countries: set[str] = field(default_factory=set)
    territory: str | None = None
    alt_names: list[str] = field(default_factory=list)
    summit_kind: str = "standalone"
    parent: str | None = None
    top_summit: str | None = None  # for massifs
    radius_km: float | None = None
    range_slug: str | None = None
    peak_type: str | None = None
    volcanic_status: str | None = None
    prominence_m: float | None = None
    isolation_km: float | None = None
    geonames_id: int | None = None
    sitelinks: int = 0
    elevations: list[Elevation] = field(default_factory=list)
    sources: set[tuple[str, str]] = field(default_factory=set)
    reasons: list[str] = field(default_factory=list)
    review: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    baseline: list[BaselineEntry] = field(default_factory=list)
    high_point_of: set[str] = field(default_factory=set)
    local_names: list[dict[str, str]] = field(default_factory=list)
    name_origin: str | None = None
    name_origin_source: str | None = None
    # Filled by choose_elevation:
    elevation_m: int | None = None
    elevation_source: str | None = None
    confidence: str | None = None
    slug: str | None = None


@dataclass
class LowPoint:
    iso3: str
    name: str
    elevation_m: int
    lon: float | None
    lat: float | None
    feature_type: str
    source: str
    qid: str | None
    review: list[str] = field(default_factory=list)


@dataclass
class Range:
    slug: str
    name: str
    qid: str | None
    range_type: str | None
    description: str | None
    length_km: float | None
    formation_note: str | None
    source: str | None
    review: list[str] = field(default_factory=list)


@dataclass
class Exclusion:
    qid: str
    name: str
    elevation_m: float | None
    countries: list[str]
    reason: str


@dataclass
class Inputs:
    country_names: dict[str, str]  # iso3 → name
    country_qids: dict[str, str]  # iso3 → Wikidata QID
    candidates: dict[str, list[WikidataPeak]]  # iso3 → the country's peaks
    items: dict[str, WikidataPeak]  # every fetched item by QID
    extremes: list[CountryExtreme]
    factbook: FactbookSnapshot
    baseline: list[BaselineEntry]
    baseline_source: str
    baseline_commit: str
    geonames: dict[str, list[GeoNamesPeak]]  # iso3 → peaks
    geography: Countries
    source_texts: dict[str, str]  # url → cached text (for quote checks)
    island_states: set[str]


@dataclass
class Result:
    mountains: list[Mountain]
    ranges: list[Range]
    low_points: dict[str, LowPoint]
    sources: SourceRegistry
    exclusions: list[Exclusion]
    decisions: list[str]
    conflicts: list[str]
    warnings: list[str]
    baseline_report: list[dict[str, Any]]
    extremes_report: dict[str, dict[str, Any]]
    not_peaks: dict[str, str]


# ── Helpers ──────────────────────────────────────────────────────────────────

GENERIC_WORDS = {
    "mount", "mt", "mont", "monts", "monte", "mountain", "jebel", "jbel", "djebel", "jabal",
    "gebel", "pico", "pic", "peak", "piton", "volcan", "volcano", "hill", "the", "on", "of",
    "de", "du", "la", "le", "des", "el", "ras", "point", "summit", "unnamed", "elevation",
}  # fmt: skip


def slugify(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text)
    plain = "".join(c for c in decomposed if not unicodedata.combining(c)).lower()
    return re.sub(r"[^a-z0-9]+", "-", plain).strip("-")


def significant_words(text: str) -> set[str]:
    return {w for w in fold(text).split() if w not in GENERIC_WORDS and len(w) > 2}


def one_edit_apart(a: str, b: str) -> bool:
    """True when two words differ by at most one substitution, insertion or deletion."""
    if abs(len(a) - len(b)) > 1:
        return False
    if len(a) == len(b):
        return sum(x != y for x, y in zip(a, b, strict=True)) <= 1
    shorter, longer = sorted((a, b), key=len)
    return any(longer[:i] + longer[i + 1 :] == shorter for i in range(len(longer)))


def words_match(a: str, b: str) -> bool:
    """Same word, one contained in the other ("nyangani" in "inyangani"), or a one-letter
    spelling variant of a long word ("bintimani"/"bintumani", "cameroun"/"cameroon")."""
    if a == b:
        return True
    if min(len(a), len(b)) >= 5 and (a in b or b in a):
        return True
    return min(len(a), len(b)) >= 6 and one_edit_apart(a, b)


def names_match(text: str, names: Iterable[str]) -> bool:
    """Whether a free-text name (e.g. the Factbook's "Fako on Mont Cameroun") refers to one of
    the given names: a matching significant word, or one name contained in the other."""
    words = significant_words(text)
    squashed = fold(text).replace(" ", "")
    for name in names:
        other = significant_words(name)
        if any(words_match(a, b) for a in words for b in other):
            return True
        name_squashed = fold(name).replace(" ", "")
        if len(name_squashed) > 4 and (name_squashed in squashed or squashed in name_squashed):
            return True
    return False


def family_of(peak: WikidataPeak) -> str:
    """Bulk-imported items (one sitelink or none, with a GeoNames id) copy GeoNames values."""
    return "geonames" if peak.sitelinks <= 1 and peak.geonames_id else "wikidata"


def peak_type_of(classes: list[str], summit_kind: str) -> str:
    if "Q169358" in classes:
        return "stratovolcano"
    if "Q212057" in classes:
        return "shield_volcano"
    if any(c in VOLCANO_CLASSES for c in classes):
        return "volcano"
    if summit_kind == "massif" or "Q1061151" in classes:
        return "massif"
    return "peak"


def volcanic_status_of(classes: list[str]) -> str | None:
    statuses = {VOLCANIC_STATUS_CLASSES[c] for c in classes if c in VOLCANIC_STATUS_CLASSES}
    return statuses.pop() if len(statuses) == 1 else None


# ── Elevation choice ─────────────────────────────────────────────────────────


def choose_elevation(
    elevations: list[Elevation],
    *,
    agree_m: float,
    review_m: float,
    low_m: float,
    priority: list[str],
) -> tuple[Elevation, str, list[str]]:
    """(chosen value, confidence, review notes). See the module docstring for the rule."""
    if not elevations:
        raise ValueError("no elevation candidates")
    rank = {family: index for index, family in enumerate(priority)}
    # One value per family: its most authoritative source.
    per_family: dict[str, Elevation] = {}
    for candidate in sorted(elevations, key=lambda e: (TIER_ORDER[e.tier], e.label)):
        per_family.setdefault(candidate.family, candidate)
    families = list(per_family.values())
    best_tier = min(TIER_ORDER[e.tier] for e in families)
    top = [e for e in families if TIER_ORDER[e.tier] == best_tier]

    def support(candidate: Elevation) -> int:
        return sum(1 for e in top if abs(e.metres - candidate.metres) <= agree_m)

    chosen = sorted(top, key=lambda e: (-support(e), rank.get(e.family, len(rank)), e.label))[0]
    # Confidence describes how well the most reliable sources agree; any disagreement at all
    # (a less reliable source included) is flagged for review.
    values = [e.metres for e in families]
    spread = max(values) - min(values)
    top_spread = max(e.metres for e in top) - min(e.metres for e in top)
    notes: list[str] = []
    if len(top) == 1:
        confidence = "low" if chosen.family in {"geonames", "harim-prototype"} else "medium"
    elif top_spread <= review_m:
        confidence = "high"
    elif top_spread <= low_m or support(chosen) >= 2:
        # Close enough, or an outlier against a value two independent sources agree on.
        confidence = "medium"
    else:
        confidence = "low"
    if spread > review_m:
        listed = ", ".join(
            f"{round(e.metres)} m ({e.label})" for e in sorted(families, key=lambda e: -e.metres)
        )
        notes.append(f"Sources disagree by {round(spread)} m: {listed}.")
    return chosen, confidence, notes


# ── Reconciliation ───────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Settings:
    always_include_m: float
    notable_per_country: int
    notable_min_sitelinks: int
    notable_min_prominence_m: float
    subsidiary_km: float
    match_km: float
    border_tolerance_km: float
    island_tolerance_km: float
    agree_m: float
    review_m: float
    low_m: float
    priority: list[str]

    @classmethod
    def from_curation(cls, curation: dict[str, Any]) -> Settings:
        s = curation["selection"]
        return cls(
            always_include_m=float(s["always_include_m"]),
            notable_per_country=int(s["notable_per_country"]),
            notable_min_sitelinks=int(s["notable_min_sitelinks"]),
            notable_min_prominence_m=float(s["notable_min_prominence_m"]),
            subsidiary_km=float(s["subsidiary_km"]),
            match_km=float(s["match_km"]),
            border_tolerance_km=float(s["border_tolerance_km"]),
            island_tolerance_km=float(s["island_tolerance_km"]),
            agree_m=float(s["agree_m"]),
            review_m=float(s["review_m"]),
            low_m=float(s["low_m"]),
            priority=list(s["priority"]),
        )


class Reconciler:
    def __init__(self, inputs: Inputs, curation: dict[str, Any]) -> None:
        self.inputs = inputs
        self.curation = curation
        self.settings = Settings.from_curation(curation)
        self.sources = SourceRegistry()
        self.qid_to_iso3 = {qid: iso3 for iso3, qid in inputs.country_qids.items()}
        self.mountains: dict[str, Mountain] = {}
        self.exclusions: list[Exclusion] = []
        self.decisions: list[str] = []
        self.conflicts: list[str] = []
        self.warnings: list[str] = []
        self.problems: list[str] = []
        self.merged_into: dict[str, str] = {}
        self.not_peaks: dict[str, str] = {}  # QID → why it is not a peak (ranges, fields…)
        self.summit_of: dict[str, str] = {}  # summit QID → massif QID
        self.territory_of: dict[str, str] = {}
        self.baseline_report: list[dict[str, Any]] = []
        self.extremes_report: dict[str, dict[str, Any]] = {}
        self.exclude_pattern = re.compile(curation["exclude_label_pattern"], re.IGNORECASE)
        self.exclude_classes = set(curation["exclude_classes"])
        self.sources.add(
            inputs.baseline_source,
            f"Harim prototype (emtatudatatech/harim@{inputs.baseline_commit[:7]})",
            f"https://github.com/emtatudatatech/harim/blob/{inputs.baseline_commit}/harim.html",
        )

    # ── Quotes ──

    def sourced(self, entry: dict[str, Any], what: str) -> SourceRecord | None:
        """A curated claim's source, after checking its quote is in the cached source text."""
        url = entry.get("source")
        if not url:
            return None
        text = self.inputs.source_texts.get(url)
        raw = entry.get("quote", "")
        quotes: list[str] = raw if isinstance(raw, list) else [raw]
        from .harim_sources import quote_in_text

        if text is None:
            self.problems.append(f"{what}: the source {url} was not fetched")
        else:
            for quote in quotes:
                if not quote or not quote_in_text(quote, text):
                    self.problems.append(f"{what}: the quote {quote!r} is not in {url}")
        return (
            self.sources.wikipedia(url)
            if "wikipedia.org" in url
            else self.sources.add(slugify(url)[:60], entry.get("source_title", url), url)
        )

    # ── Building blocks ──

    def peak(self, qid: str) -> WikidataPeak | None:
        return self.inputs.items.get(qid)

    def countries_of(self, peak: WikidataPeak) -> set[str]:
        return {self.qid_to_iso3[c] for c in peak.country_qids if c in self.qid_to_iso3}

    def is_excluded_kind(self, peak: WikidataPeak) -> str | None:
        bad = sorted(set(peak.classes) & self.exclude_classes)
        if bad:
            return (
                f"not a peak (class {', '.join(self.curation['exclude_classes'][c] for c in bad)})"
            )
        if self.exclude_pattern.search(peak.label):
            return "not a peak (its name describes a range, plateau or similar)"
        return None

    def add_mountain(self, qid: str, reason: str) -> Mountain | None:
        qid = self.merged_into.get(qid, qid)
        existing = self.mountains.get(qid)
        if existing is not None:
            if reason not in existing.reasons:
                existing.reasons.append(reason)
            return existing
        peak = self.peak(qid)
        if peak is None:
            self.problems.append(f"{qid} ({reason}) was not fetched from Wikidata")
            return None
        if peak.lon is None or peak.lat is None:
            self.problems.append(f"{qid} {peak.label} ({reason}) has no coordinates in Wikidata")
            return None
        label = self.curation["labels"].get(qid)
        mountain = Mountain(
            key=qid,
            name=label["name"] if label else peak.label,
            lon=peak.lon,
            lat=peak.lat,
            countries=self.countries_of(peak),
            territory=self.territory_of.get(qid),
            alt_names=([peak.label] if label else [])
            + [a for a in peak.alt_labels if a != peak.label][:6],
            prominence_m=peak.prominence_m,
            isolation_km=peak.isolation_km,
            geonames_id=int(peak.geonames_id)
            if peak.geonames_id and peak.geonames_id.isdigit()
            else None,
            sitelinks=peak.sitelinks,
            reasons=[reason],
        )
        mountain.volcanic_status = volcanic_status_of(peak.classes)
        source = self.sources.wikidata(qid, peak.label)
        mountain.sources.add((source.key, "identity"))
        mountain.sources.add((source.key, "coordinates"))
        if peak.elevation_m is not None:
            mountain.elevations.append(
                Elevation(
                    peak.elevation_m, source.key, family_of(peak), source.tier, f"Wikidata {qid}"
                )
            )
            mountain.sources.add((source.key, "elevation"))
        if peak.prominence_m is not None:
            mountain.sources.add((source.key, "prominence"))
        if mountain.volcanic_status:
            mountain.sources.add((source.key, "volcanic_status"))
        if family_of(peak) == "geonames":
            mountain.notes.append("Wikidata item imported in bulk from GeoNames.")
        self.mountains[qid] = mountain
        return mountain

    def elevation_target(self, mountain: Mountain) -> Mountain:
        """Where a value for the mountain's height belongs: a massif's top summit."""
        if mountain.summit_kind == "massif" and mountain.top_summit:
            return self.mountains.get(mountain.top_summit, mountain)
        return mountain

    # ── Steps ──

    def apply_merges_and_territories(self) -> None:
        for merge in self.curation["merges"]:
            self.merged_into[merge["qid"]] = merge["into"]
        for territory in self.curation["territories"]:
            for qid in territory["peaks"]:
                self.territory_of[qid] = territory["name"]

    def build_hierarchy(self) -> None:
        for massif_entry in self.curation["massifs"]:
            massif = self.add_mountain(massif_entry["qid"], "curated massif")
            if massif is None:
                continue
            source = self.sourced(massif_entry, f"massif {massif.name}")
            massif.summit_kind = "massif"
            massif.radius_km = float(massif_entry["radius_km"])
            massif.top_summit = massif_entry["top"]
            if massif_entry["top"] not in massif_entry["summits"]:
                self.problems.append(
                    f"massif {massif.name}: its top summit is not among its summits"
                )
            for summit_qid in massif_entry["summits"]:
                summit = self.add_mountain(summit_qid, f"summit of {massif.name}")
                if summit is None:
                    continue
                summit.summit_kind = "summit"
                summit.parent = massif.key
                summit.countries |= massif.countries if not summit.countries else set()
                self.summit_of[summit.key] = massif.key
                if source:
                    summit.sources.add((source.key, "hierarchy"))
            # The massif's own height is the height of its top summit.
            top = self.mountains.get(massif_entry["top"])
            if top is not None:
                for elevation in massif.elevations:
                    top.elevations.append(
                        Elevation(
                            elevation.metres,
                            elevation.source,
                            elevation.family,
                            elevation.tier,
                            f"{elevation.label} (height of {massif.name})",
                        )
                    )
                massif.elevations = []
            for note in massif_entry.get("notes", []):
                massif.notes.append(note)
        for merge in self.curation["merges"]:
            target = self.mountains.get(merge["into"])
            merged = self.peak(merge["qid"])
            if target is not None and merged is not None and merged.label not in target.alt_names:
                target.alt_names.insert(0, merged.label)
                target.notes.append(
                    f"{merged.label} ({merge['qid']}) is recorded as part of {target.name}: "
                    f"{merge['reason']}"
                )

    def apply_curated_elevations(self) -> None:
        for entry in self.curation["elevations"]:
            mountain = self.mountains.get(entry["qid"])
            if mountain is None:
                self.problems.append(f"curated elevation for {entry['qid']}: not in the catalogue")
                continue
            source = self.sourced(entry, f"elevation of {mountain.name}")
            if source is None:
                self.problems.append(f"curated elevation for {mountain.name} has no source")
                continue
            mountain.elevations.append(
                Elevation(
                    float(entry["metres"]), source.key, "wikipedia", source.tier, source.title
                )
            )
            mountain.sources.add((source.key, "elevation"))

    def names_for(self, mountain: Mountain) -> list[str]:
        """A mountain's names, plus its massif's or summits' (for matching free text)."""
        names = [mountain.name, *mountain.alt_names]
        related = [m for m in self.mountains.values() if m.parent == mountain.key]
        if mountain.parent and mountain.parent in self.mountains:
            related.append(self.mountains[mountain.parent])
        for other in related:
            names += [other.name, *other.alt_names]
        return names

    def factbook_source(self, iso3: str) -> SourceRecord:
        from .harim_sources import FACTBOOK_REPO, GEC_CODES

        snapshot = self.inputs.factbook
        return self.sources.add(
            f"factbook-{GEC_CODES[iso3]}",
            f"The World Factbook (final edition, {snapshot.committed_at}): "
            f"{self.inputs.country_names[iso3]}",
            f"https://github.com/{FACTBOOK_REPO}/blob/{snapshot.commit}/africa/{GEC_CODES[iso3]}.json",
        )

    def resolve_high_points(self) -> None:
        decisions = self.curation["high_points"]
        for iso3, name in sorted(self.inputs.country_names.items()):
            statements = [e for e in self.inputs.extremes if e.iso3 == iso3 and e.kind == "high"]
            preferred = [e for e in statements if e.rank == "PreferredRank"] or statements
            wikidata_qids = sorted({e.point_qid for e in preferred})
            factbook = self.inputs.factbook.extremes[(iso3, "high")]
            decision = decisions.get(iso3)
            report: dict[str, Any] = {
                "wikidata": [f"{e.point_label} ({e.point_qid})" for e in preferred],
                "factbook": factbook.text,
            }
            if decision is not None:
                qid = decision["qid"]
                self.decisions.append(f"{name}: high point {qid} — {decision['reason']}")
                if decision.get("source"):
                    self.sourced(decision, f"high point of {name}")
                report["decision"] = decision["reason"]
            elif len(wikidata_qids) == 1:
                qid = wikidata_qids[0]
            else:
                self.problems.append(
                    f"{name}: Wikidata gives {len(wikidata_qids)} high points "
                    f"({', '.join(wikidata_qids) or 'none'}); add a decision to harim_curation.json"
                )
                continue
            mountain = self.add_mountain(qid, f"high point of {name}")
            if mountain is None:
                continue
            counted = self.mountains[self.summit_of.get(mountain.key, mountain.key)]
            counted.high_point_of.add(iso3)
            counted.countries.add(iso3)
            target = self.elevation_target(counted)
            same_feature = names_match(factbook.name, self.names_for(counted))
            if decision is not None and decision.get("factbook") in {"same", "different"}:
                same_feature = decision["factbook"] == "same"
            elif not same_feature:
                self.problems.append(
                    f"{name}: Wikidata's high point {counted.name} ({qid}) and the Factbook's "
                    f"{factbook.text!r} may be different features; "
                    "add a decision to harim_curation.json"
                )
            source = self.factbook_source(iso3)
            if same_feature:
                target.elevations.append(
                    Elevation(
                        float(factbook.elevation_m),
                        source.key,
                        "factbook",
                        source.tier,
                        "World Factbook",
                    )
                )
                target.sources.add((source.key, "elevation"))
            else:
                counted.review.append(
                    f"The World Factbook names a different high point for {name}: {factbook.text}."
                )
                self.conflicts.append(
                    f"{name}: high point {counted.name} vs Factbook {factbook.text!r}"
                )
            if decision is not None and decision.get("review"):
                counted.review.append(decision["review"])
            report["chosen"] = counted.key
            self.extremes_report.setdefault(iso3, {})["high"] = report

    LOW_POINT_KINDS = (
        ("coast", r"\b(ocean|sea|gulf|bight|channel|oceans)\b"),
        ("depression", r"\b(depression)\b"),
        ("salt_flat", r"\b(chott|shatt|sebkha|sebkhet|sabkhat|salt)\b"),
        ("lake", r"\b(lake|lac)\b"),
        ("river", r"\b(river|nile)\b"),
    )

    def classify_low_point(self, name: str, qualifier_type: str | None) -> str:
        if qualifier_type:
            return qualifier_type
        words = fold(name)
        for kind, pattern in self.LOW_POINT_KINDS:
            if re.search(pattern, words):
                return kind
        return "other"

    def resolve_low_points(self) -> dict[str, LowPoint]:
        decisions = self.curation["low_points"]
        lows: dict[str, LowPoint] = {}
        for iso3, name in sorted(self.inputs.country_names.items()):
            statements = [e for e in self.inputs.extremes if e.iso3 == iso3 and e.kind == "low"]
            preferred = [e for e in statements if e.rank == "PreferredRank"] or statements
            factbook = self.inputs.factbook.extremes[(iso3, "low")]
            fb_source = self.factbook_source(iso3)
            decision = decisions.get(iso3, {})
            report = {
                "wikidata": [
                    f"{e.point_label} ({e.point_qid}): qualifier {e.qualifier_m}, item {e.item_m}"
                    for e in preferred
                ],
                "factbook": factbook.text,
            }
            self.extremes_report.setdefault(iso3, {})["low"] = report
            by_point: dict[str, list[CountryExtreme]] = {}
            for item in preferred:
                by_point.setdefault(item.point_qid, []).append(item)
            if "qid" in decision:
                chosen_qid: str | None = decision["qid"]
            elif len(by_point) == 1:
                chosen_qid = next(iter(by_point))
            elif not by_point:
                chosen_qid = None
            else:
                self.problems.append(f"{name}: Wikidata gives several low points; add a decision")
                continue
            statement = by_point[chosen_qid][0] if chosen_qid in by_point else None
            label = statement.point_label if statement else factbook.name
            factbook_feature = self.classify_low_point(factbook.name, None)
            feature = self.classify_low_point(label, decision.get("feature_type"))
            if feature == "other" and names_match(factbook.name, [label]):
                feature = factbook_feature
            # Elevation: the statement's own qualifier (the value at that place in this country),
            # else the item's elevation for features that have one level (lakes, depressions,
            # salt flats); never a river's own elevation, which describes some other point.
            wikidata_m: float | None = None
            if statement is not None:
                if statement.qualifier_m is not None:
                    wikidata_m = statement.qualifier_m
                elif feature in {"lake", "depression", "salt_flat"}:
                    wikidata_m = statement.item_m
            if feature == "coast":
                wikidata_m = 0.0
            # The same feature: matching names and kinds (a lake is not the river leaving it),
            # or both on the coast at sea level.
            same_feature = (
                names_match(factbook.name, [label])
                and (factbook_feature == feature or "other" in {factbook_feature, feature})
            ) or (feature == "coast" and factbook_feature == "coast")
            if "factbook" in decision:
                same_feature = decision["factbook"] == "same"
            elif not same_feature:
                self.problems.append(
                    f"{name}: low point {label!r} (Wikidata) and {factbook.text!r} (Factbook) may "
                    "differ; add a decision to harim_curation.json"
                )
            values: list[Elevation] = []
            source_key = fb_source.key
            qid = None
            if statement is not None:
                wd = self.sources.wikidata(statement.point_qid, statement.point_label)
                qid = statement.point_qid
                if wikidata_m is not None:
                    values.append(
                        Elevation(wikidata_m, wd.key, "wikidata", wd.tier, f"Wikidata {qid}")
                    )
                    source_key = wd.key
            if same_feature:
                values.append(
                    Elevation(
                        float(factbook.elevation_m),
                        fb_source.key,
                        "factbook",
                        fb_source.tier,
                        "World Factbook",
                    )
                )
            review: list[str] = []
            if "metres" in decision:
                curated = self.sourced(decision, f"low point of {name}")
                if curated is not None:
                    values.append(
                        Elevation(
                            float(decision["metres"]),
                            curated.key,
                            "wikipedia",
                            curated.tier,
                            curated.title,
                        )
                    )
            if not values:
                self.problems.append(f"{name}: no sourced elevation for the low point {label!r}")
                continue
            chosen, confidence, notes = choose_elevation(
                values,
                agree_m=self.settings.agree_m,
                review_m=self.settings.review_m,
                low_m=self.settings.low_m,
                priority=self.settings.priority,
            )
            review += notes
            if not same_feature:
                review.append(
                    f"The World Factbook gives a different lowest point: {factbook.text}."
                )
                self.conflicts.append(f"{name}: low point {label} vs Factbook {factbook.text!r}")
            if confidence == "low":
                review.append(
                    "The sources' elevations for this low point disagree by more than 50 m."
                )
            if decision.get("review"):
                review.append(decision["review"])
            if decision.get("reason"):
                self.decisions.append(f"{name}: low point — {decision['reason']}")
            display = decision.get("name") or (
                f"{label} (sea level)" if feature == "coast" else label
            )
            point = None
            if (
                statement is not None
                and feature in {"lake", "depression", "salt_flat", "other"}
                and statement.lon is not None
                and statement.lat is not None
            ):
                point = (statement.lon, statement.lat)
            lows[iso3] = LowPoint(
                iso3=iso3,
                name=display,
                elevation_m=round(chosen.metres),
                lon=point[0] if point else None,
                lat=point[1] if point else None,
                feature_type=feature,
                source=chosen.source if chosen.source else source_key,
                qid=qid,
                review=review,
            )
            report["chosen"] = f"{display}: {round(chosen.metres)} m ({feature}, {confidence})"
        return lows

    def match_baseline(self) -> None:
        matches: dict[str, str] = self.curation["baseline_matches"]
        prototype = self.inputs.baseline_source
        tier = self.sources.records[prototype].tier
        for entry in self.inputs.baseline:
            key = f"{entry.file}|{entry.raw_name}"
            qid = matches.get(key)
            row: dict[str, Any] = {"entry": entry, "qid": qid, "issues": []}
            self.baseline_report.append(row)
            if qid is None:
                self.problems.append(f"prototype entry {key!r} has no match in harim_curation.json")
                continue
            mountain = self.add_mountain(qid, "in the Harim prototype")
            if mountain is None:
                continue
            mountain.baseline.append(entry)
            target = self.elevation_target(mountain)
            target.elevations.append(
                Elevation(
                    float(entry.height_m),
                    prototype,
                    "harim-prototype",
                    tier,
                    f"Harim prototype ({entry.file})",
                )
            )
            target.sources.add((prototype, "elevation"))
            for name in (entry.base_name,):
                if fold(name) not in {fold(n) for n in [mountain.name, *mountain.alt_names]}:
                    mountain.alt_names.append(name)
            if entry.territory and mountain.territory != entry.territory:
                row["issues"].append(
                    f"territory {entry.territory} vs catalogue {mountain.territory}"
                )
            if entry.countries:
                listed = set(entry.countries)
                if listed != mountain.countries and not mountain.territory:
                    row["issues"].append(
                        f"countries {'/'.join(sorted(listed))} in the prototype, "
                        f"{'/'.join(sorted(mountain.countries)) or 'none'} in Wikidata"
                    )
            if entry.lat is not None and entry.lon is not None:
                distance = haversine_km(entry.lon, entry.lat, mountain.lon, mountain.lat)
                row["distance_km"] = distance
                if distance > self.settings.match_km:
                    row["issues"].append(
                        f"prototype coordinates are {distance:.1f} km from Wikidata's"
                    )
            row["mountain"] = mountain.key

    def geography_issue(self, lon: float, lat: float, countries: Iterable[str]) -> str | None:
        """Why the coordinates contradict the listed countries (None if they fit). Island states
        never fail: small islands may be missing from the 1:50m boundaries."""
        settings = self.settings
        names = self.inputs.country_names
        near = self.inputs.geography.near(lon, lat, within_km=settings.island_tolerance_km)
        for iso3 in sorted(countries):
            if iso3 in self.inputs.island_states:
                continue
            distance = near.get(iso3)
            if distance is None or distance > settings.border_tolerance_km:
                where = "far from" if distance is None else f"{distance:.1f} km outside"
                return f"its coordinates are {where} {names[iso3]}"
        return None

    def is_subsidiary(self, peak: WikidataPeak, chosen: list[Mountain]) -> Mountain | None:
        """The catalogue mountain this point is part of: any point within a curated massif's
        radius, or a bulk-imported, little-known point (fewer than `notable_min_sitelinks`
        language editions) within `subsidiary_km` of another mountain. Well-known neighbours
        (e.g. Njesuthi next to Mafadi) stay separate mountains."""
        assert peak.lon is not None and peak.lat is not None
        little_known = peak.sitelinks < self.settings.notable_min_sitelinks
        for mountain in chosen:
            if mountain.key == peak.qid:
                continue
            owner = self.mountains.get(self.summit_of.get(mountain.key, mountain.key), mountain)
            distance = haversine_km(peak.lon, peak.lat, mountain.lon, mountain.lat)
            if owner.radius_km is not None and distance <= owner.radius_km:
                return owner
            if little_known and distance <= self.settings.subsidiary_km:
                return owner
        return None

    def flag_neighbours(self) -> None:
        """Separate mountains closer than `subsidiary_km`: worth checking their coordinates."""
        counted = [m for m in self.mountains.values() if m.summit_kind != "summit"]
        for index, a in enumerate(counted):
            for b in counted[index + 1 :]:
                distance = haversine_km(a.lon, a.lat, b.lon, b.lat)
                if distance <= self.settings.subsidiary_km:
                    for one, other in ((a, b), (b, a)):
                        one.review.append(
                            f"Its coordinates are {distance:.1f} km from {other.name}'s; "
                            "check they are right."
                        )

    def flag_higher_than_high_points(self) -> None:
        for iso3, name in self.inputs.country_names.items():
            high = [m for m in self.mountains.values() if iso3 in m.high_point_of]
            if len(high) != 1 or high[0].elevation_m is None:
                continue
            top = high[0]
            top_m = high[0].elevation_m
            for m in self.mountains.values():
                if (
                    m.summit_kind != "summit"
                    and iso3 in m.countries
                    and m is not top
                    and (m.elevation_m or 0) > top_m
                ):
                    m.review.append(
                        f"Higher than {name}'s recorded high point, "
                        f"{top.name} ({top.elevation_m:,} m)."
                    )
                    top.review.append(
                        f"{m.name} ({m.elevation_m:,} m) is recorded in {name} and stands higher."
                    )
                    self.conflicts.append(
                        f"{name}: {m.name} ({m.elevation_m:,} m) is higher than the high point "
                        f"{top.name} ({top.elevation_m:,} m)"
                    )

    def select(self) -> None:
        settings = self.settings
        for qid, reason in self.curation["include"].items():
            self.add_mountain(qid, f"curated: {reason}")
        for territory in self.curation["territories"]:
            for qid in territory["peaks"]:
                self.add_mountain(qid, f"territory peak ({territory['name']})")
        excluded: dict[str, str] = self.curation["exclude"]
        # Every country's candidates, highest first, so higher peaks claim their surroundings.
        seen: dict[str, WikidataPeak] = {}
        for peaks in self.inputs.candidates.values():
            for peak in peaks:
                seen.setdefault(peak.qid, peak)
        ordered = sorted(seen.values(), key=lambda p: -(p.elevation_m or 0))
        notable_count: dict[str, int] = {}
        for mountain in self.mountains.values():
            for iso3 in mountain.countries:
                notable_count[iso3] = notable_count.get(iso3, 0)
        pending_notable: list[WikidataPeak] = []
        for peak in ordered:
            qid = self.merged_into.get(peak.qid, peak.qid)
            if (
                qid in self.mountains
                or peak.elevation_m is None
                or peak.lon is None
                or peak.lat is None
            ):
                continue
            countries = sorted(self.countries_of(peak))
            if qid in excluded:
                self.exclusions.append(
                    Exclusion(
                        qid, peak.label, peak.elevation_m, countries, f"curated: {excluded[qid]}"
                    )
                )
                continue
            kind = self.is_excluded_kind(peak)
            if kind:
                self.not_peaks[qid] = kind
                if peak.elevation_m >= settings.always_include_m:
                    self.exclusions.append(
                        Exclusion(qid, peak.label, peak.elevation_m, countries, kind)
                    )
                continue
            issue = self.geography_issue(peak.lon, peak.lat, countries)
            if issue:
                if (
                    peak.elevation_m >= settings.always_include_m
                    or peak.sitelinks >= settings.notable_min_sitelinks
                ):
                    self.exclusions.append(
                        Exclusion(qid, peak.label, peak.elevation_m, countries, issue)
                    )
                continue
            owner = self.is_subsidiary(peak, list(self.mountains.values()))
            if owner is not None:
                if (
                    peak.elevation_m >= settings.always_include_m
                    or peak.sitelinks >= settings.notable_min_sitelinks
                ):
                    self.exclusions.append(
                        Exclusion(
                            qid,
                            peak.label,
                            peak.elevation_m,
                            countries,
                            f"a point of {owner.name} (within its radius), not a separate mountain",
                        )
                    )
                continue
            if peak.elevation_m >= settings.always_include_m:
                self.add_mountain(qid, f"{round(settings.always_include_m)} m or higher")
            else:
                pending_notable.append(peak)

        def notability(peak: WikidataPeak) -> tuple[int, float, float]:
            prominent = 1 if (peak.prominence_m or 0) >= settings.notable_min_prominence_m else 0
            return (-prominent, -peak.sitelinks, -(peak.elevation_m or 0))

        for peak in sorted(pending_notable, key=notability):
            notable = (peak.prominence_m or 0) >= settings.notable_min_prominence_m or (
                peak.sitelinks >= settings.notable_min_sitelinks
            )
            peak_countries = self.countries_of(peak)
            if not notable or not peak_countries:
                continue
            if all(
                notable_count.get(iso3, 0) >= settings.notable_per_country
                for iso3 in peak_countries
            ):
                continue
            if self.is_subsidiary(peak, list(self.mountains.values())) is not None:
                continue
            if self.add_mountain(peak.qid, "notable peak") is not None:
                for iso3 in peak_countries:
                    notable_count[iso3] = notable_count.get(iso3, 0) + 1

    def enrich_geonames(self) -> None:
        for mountain in self.mountains.values():
            if mountain.territory:
                continue
            found: GeoNamesPeak | None = None
            for iso3 in sorted(mountain.countries):
                for candidate in self.inputs.geonames.get(iso3, []):
                    if mountain.geonames_id and candidate.geonames_id == mountain.geonames_id:
                        found = candidate
                        break
                if found:
                    break
            if found is None and mountain.geonames_id is None:
                names = {fold(n) for n in [mountain.name, *mountain.alt_names]}
                for iso3 in sorted(mountain.countries):
                    for candidate in self.inputs.geonames.get(iso3, []):
                        if (
                            fold(candidate.name) in names
                            and haversine_km(
                                candidate.lon, candidate.lat, mountain.lon, mountain.lat
                            )
                            <= 5
                        ):
                            found = candidate
                            break
                    if found:
                        break
            if found is None:
                continue
            mountain.geonames_id = found.geonames_id
            source = self.sources.geonames(found.geonames_id, found.name)
            mountain.sources.add((source.key, "identity"))
            if found.elevation_m is not None:
                mountain.elevations.append(
                    Elevation(
                        float(found.elevation_m),
                        source.key,
                        "geonames",
                        source.tier,
                        f"GeoNames {found.geonames_id}",
                    )
                )
                mountain.sources.add((source.key, "elevation"))

    def build_ranges(self) -> list[Range]:
        ranges: list[Range] = []
        by_qid: dict[str, str] = {}
        for entry in self.curation["ranges"]:
            source = self.sourced(entry, f"range {entry['name']}") if entry.get("source") else None
            review: list[str] = []
            has_text = any(
                entry.get(k) for k in ("description", "formation_note", "length_km", "range_type")
            )
            if has_text and source is None:
                review.append("Description not sourced.")
            ranges.append(
                Range(
                    slug=entry["slug"],
                    name=entry["name"],
                    qid=entry.get("qid"),
                    range_type=entry.get("range_type"),
                    description=entry.get("description"),
                    length_km=entry.get("length_km"),
                    formation_note=entry.get("formation_note"),
                    source=source.key if source else None,
                    review=review,
                )
            )
            if entry.get("qid"):
                by_qid[entry["qid"]] = entry["slug"]
        by_qid.update(self.curation["range_aliases"])
        assignments: dict[str, str] = self.curation["range_assignments"]
        valid = {r.slug for r in ranges}
        for mountain in self.mountains.values():
            if mountain.key in assignments:
                mountain.range_slug = assignments[mountain.key]
            else:
                peak = self.peak(mountain.key)
                slugs = sorted(
                    {by_qid[r] for r in (peak.range_qids if peak else []) if r in by_qid}
                )
                if len(slugs) == 1:
                    mountain.range_slug = slugs[0]
                    if peak is not None:
                        mountain.sources.add(
                            (self.sources.wikidata(peak.qid, peak.label).key, "range")
                        )
                elif len(slugs) > 1:
                    mountain.review.append(
                        f"Wikidata places it in several ranges: {', '.join(slugs)}."
                    )
            if mountain.range_slug is None and mountain.parent:
                mountain.range_slug = self.mountains[mountain.parent].range_slug
            if mountain.range_slug is not None and mountain.range_slug not in valid:
                self.problems.append(f"{mountain.name}: unknown range {mountain.range_slug!r}")
        used = {m.range_slug for m in self.mountains.values()}
        for range_ in ranges:
            if range_.slug not in used:
                self.warnings.append(f"Range {range_.name} has no catalogue peaks.")
        return ranges

    def apply_names(self, names: dict[str, Any]) -> None:
        """Local names and name origins from db/seeds/mountain_names.json. Every entry needs a
        source whose cached text contains its quote; otherwise the run fails (never invented)."""
        for entry in names["entries"]:
            mountain = self.mountains.get(entry["qid"])
            if mountain is None:
                self.warnings.append(f"mountain_names.json: {entry['qid']} is not in the catalogue")
                continue
            source = self.sourced(entry, f"name origin of {mountain.name}")
            if source is None:
                self.problems.append(f"mountain_names.json: {mountain.name} has no source")
                continue
            if entry.get("name_origin"):
                mountain.name_origin = entry["name_origin"]
                mountain.name_origin_source = source.key
                mountain.sources.add((source.key, "name_origin"))
                if entry.get("needs_review"):
                    mountain.review.append(f"Name origin to verify: {entry['needs_review']}")
            for local in entry.get("local_names", []):
                record = {
                    "name": local["name"],
                    "language": local["language"],
                    "source": source.key,
                }
                if local.get("meaning"):
                    record["meaning"] = local["meaning"]
                mountain.local_names.append(record)
                mountain.sources.add((source.key, "local_names"))

    def finalise(self) -> None:
        settings = self.settings
        for mountain in self.mountains.values():
            peak = self.peak(mountain.key)
            classes = peak.classes if peak else []
            mountain.peak_type = peak_type_of(classes, mountain.summit_kind)
            if mountain.summit_kind == "massif":
                continue
            if not mountain.elevations:
                self.problems.append(
                    f"{mountain.name} ({mountain.key}) has no elevation from any source"
                )
                continue
            chosen, confidence, notes = choose_elevation(
                mountain.elevations,
                agree_m=settings.agree_m,
                review_m=settings.review_m,
                low_m=settings.low_m,
                priority=settings.priority,
            )
            mountain.elevation_m = round(chosen.metres)
            mountain.elevation_source = chosen.source
            mountain.confidence = confidence
            mountain.review += notes
        # A massif stands exactly as high as its top summit, which must be its highest.
        for massif in [m for m in self.mountains.values() if m.summit_kind == "massif"]:
            summits = [m for m in self.mountains.values() if m.parent == massif.key]
            top = self.mountains.get(massif.top_summit or "")
            if top is None or top.elevation_m is None:
                self.problems.append(f"massif {massif.name}: its top summit has no elevation")
                continue
            higher = [s for s in summits if (s.elevation_m or 0) > top.elevation_m]
            if higher:
                self.problems.append(
                    f"massif {massif.name}: {higher[0].name} ({higher[0].elevation_m} m) is higher "
                    f"than its top summit {top.name} ({top.elevation_m} m)"
                )
            massif.elevation_m = top.elevation_m
            massif.elevation_source = top.elevation_source
            massif.confidence = top.confidence
            massif.sources |= {(s, f) for s, f in top.sources if f == "elevation"}
            for summit in summits:
                summit.countries |= massif.countries if not summit.countries else set()
        # Stable, unique slugs.
        taken: dict[str, str] = {}
        for mountain in sorted(
            self.mountains.values(), key=lambda m: (-(m.elevation_m or 0), m.key)
        ):
            base = slugify(mountain.name) or slugify(mountain.key)
            slug = base
            if slug in taken:
                where = mountain.territory or "-".join(sorted(mountain.countries)) or mountain.key
                slug = f"{base}-{slugify(where)}"
            if slug in taken:
                slug = f"{base}-{mountain.key.lower()}"
            taken[slug] = mountain.key
            mountain.slug = slug
        for mountain in self.mountains.values():
            if mountain.review:
                mountain.review = list(dict.fromkeys(mountain.review))

    def validate(self, lows: dict[str, LowPoint]) -> None:
        settings = self.settings
        names = self.inputs.country_names
        high_points: dict[str, list[Mountain]] = {}
        for mountain in self.mountains.values():
            for iso3 in mountain.high_point_of:
                high_points.setdefault(iso3, []).append(mountain)
        for iso3, name in sorted(names.items()):
            found = high_points.get(iso3, [])
            if len(found) != 1:
                self.problems.append(f"{name}: {len(found)} high points (exactly one is required)")
            if iso3 not in lows:
                self.problems.append(f"{name}: no low point")
            elif (
                found
                and found[0].elevation_m is not None
                and lows[iso3].elevation_m >= found[0].elevation_m
            ):
                self.problems.append(f"{name}: the low point is not below the high point")
        for mountain in self.mountains.values():
            label = f"{mountain.name} ({mountain.key})"
            if mountain.summit_kind == "summit":
                parent = self.mountains.get(mountain.parent or "")
                if parent is None or parent.summit_kind != "massif":
                    self.problems.append(f"{label}: a summit without a massif")
                if mountain.high_point_of:
                    self.problems.append(f"{label}: a summit cannot be a country's high point")
            if mountain.summit_kind == "massif" and not any(
                m.parent == mountain.key for m in self.mountains.values()
            ):
                self.problems.append(f"{label}: a massif without summits")
            if mountain.elevation_m is not None and not 0 <= mountain.elevation_m <= 6000:
                self.problems.append(
                    f"{label}: elevation {mountain.elevation_m} m is outside 0-6,000 m"
                )
            if not (-47 <= mountain.lat <= 38 and -26 <= mountain.lon <= 64):
                self.problems.append(f"{label}: coordinates outside Africa's bounding box")
            if mountain.territory:
                if mountain.countries:
                    self.problems.append(f"{label}: a territory peak cannot belong to a country")
                continue
            if not mountain.countries:
                self.problems.append(f"{label}: in no country")
                continue
            near = self.inputs.geography.near(
                mountain.lon, mountain.lat, within_km=settings.island_tolerance_km
            )
            for iso3 in sorted(mountain.countries):
                distance = near.get(iso3)
                island = iso3 in self.inputs.island_states
                tolerance = settings.island_tolerance_km if island else settings.border_tolerance_km
                if distance is None or distance > tolerance:
                    where = "far from" if distance is None else f"{distance:.1f} km outside"
                    message = f"{label}: its coordinates are {where} {names[iso3]}"
                    if island:
                        self.warnings.append(
                            message + " (island state; small islands may be missing at 1:50m)"
                        )
                    else:
                        self.problems.append(message)
                elif distance > 0 and not island:
                    mountain.notes.append(
                        f"Coordinates {distance:.1f} km outside {names[iso3]}'s mapped border."
                    )
            inside = [i for i, d in near.items() if d == 0 and i not in mountain.countries]
            if inside:
                self.warnings.append(
                    f"{label}: its coordinates fall inside "
                    f"{', '.join(names.get(i, i) for i in inside)}, "
                    "which the sources do not list"
                )

    def run(self, names: dict[str, Any]) -> Result:
        self.apply_merges_and_territories()
        self.build_hierarchy()
        self.match_baseline()
        self.resolve_high_points()
        self.select()
        self.apply_curated_elevations()
        self.enrich_geonames()
        ranges = self.build_ranges()
        self.apply_names(names)
        self.finalise()
        self.flag_neighbours()
        self.flag_higher_than_high_points()
        lows = self.resolve_low_points()
        self.validate(lows)
        if self.problems:
            raise ReconcileError(self.problems)
        return Result(
            mountains=sorted(
                self.mountains.values(), key=lambda m: (-(m.elevation_m or 0), m.slug or "")
            ),
            ranges=ranges,
            low_points=lows,
            sources=self.sources,
            exclusions=self.exclusions,
            decisions=self.decisions,
            conflicts=self.conflicts,
            warnings=self.warnings,
            baseline_report=self.baseline_report,
            extremes_report=self.extremes_report,
            not_peaks=self.not_peaks,
        )


def reconcile(inputs: Inputs, curation: dict[str, Any], names: dict[str, Any]) -> Result:
    return Reconciler(inputs, curation).run(names)
