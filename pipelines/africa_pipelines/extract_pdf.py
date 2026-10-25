"""`extract-pdf`: research PDF → structured, validated seed data and a review report.

Inputs:
  data/source/africa-state-symbology.pdf          the research document
  reference/african_states.json                   canonical names, ISO codes, regions, aliases
  reference/symbology_curation.json               reviewed sentence→field mapping, animal status,
                                                  known issues, proposed etymology categories
  reference/source_tiers.json                     reliability tier per cited domain

Outputs:
  db/seeds/countries.json, db/seeds/sources.json, db/seeds/datasets.json
  data/review_report.md

The seeds are meant to be corrected by hand (edit → `load`). To protect those edits, an
existing seed whose content no longer matches the hash recorded when it was generated is never
overwritten unless `--force` is given.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from . import sources as source_tiers
from .report import write_review_report
from .settings import DATA_DIR, ROOT, SEEDS_DIR, SOURCE_DIR
from .symbology_document import SymbologyDocument, parse
from .text import leftover_citation_digits, refs_in, split_sentences, strip_markers, tidy

PDF_PATH = SOURCE_DIR / "africa-state-symbology.pdf"
REFERENCE_DIR = Path(__file__).parent / "reference"
STATES_FILE = REFERENCE_DIR / "african_states.json"
CURATION_FILE = REFERENCE_DIR / "symbology_curation.json"
REPORT_PATH = DATA_DIR / "review_report.md"

FIELDS = ("etymology", "flag_design", "national_symbol", "national_animal")
# UN M49 membership (the site's regions) and the research document's own grouping, which
# differs for five states and is still what the PDF's headings follow.
EXPECTED_REGION_COUNTS = {"north": 6, "west": 16, "central": 9, "east": 18, "southern": 5}
DOCUMENT_REGION_COUNTS = {"north": 6, "west": 15, "central": 9, "east": 16, "southern": 8}
ANIMAL_STATUSES = {"official", "de_facto", "inferred", "sports_nickname", "contested"}
ETYMOLOGY_CATEGORIES = {
    "geographic_feature",
    "ethnic_group",
    "kingdom_or_ruler",
    "colonial_or_translation",
}
STATUS_QUALIFIER_RE = re.compile(r"\s*\((?:Inferred|De Facto)\)", re.IGNORECASE)
SCIENTIFIC_RE = re.compile(r"((?:[A-Z][\w'-]*\s){1,3})\(([A-Z][a-z]+ [a-z]+(?: [a-z]+)?)\)")
FLAG_URL_TEMPLATE = "https://flagcdn.com/w{width}/{code}.png"

SYMBOLOGY_DATASET = {
    "key": "symbology-pdf",
    "name": "State symbology of the African continent (research document)",
    "provider": "Bara La Afrika project research",
    "license": "Project research document; each cited source keeps its own terms",
    "attribution": "State Symbology of the African Continent: Etymology, Vexillology, and "
    "Heraldic Fauna (project research document), with the sources it cites.",
    "coverage_start": None,
    "coverage_end": None,
    # The document is undated; this is the date it was added to the repository. Confirm.
    "as_of": "2026-10-14",
    "refresh_cadence": "manual",
}


class ValidationError(RuntimeError):
    def __init__(self, problems: list[str]) -> None:
        self.problems = problems
        super().__init__(
            "PDF extraction failed validation:\n" + "\n".join(f"  - {p}" for p in problems)
        )


class SeedOverwriteError(RuntimeError):
    pass


@dataclass
class CountryRecord:
    iso3: str
    iso2: str
    iso_numeric: int
    name: str
    official_name: str | None
    region: str
    profile: dict[str, Any]
    citations: list[tuple[str, str]]  # (field, source_key)
    review_notes: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class AppliedCorrection:
    iso3: str
    field: str  # profile key, e.g. "etymology_detail"
    before: str | None
    after: str
    reason: str
    source_key: str | None


@dataclass
class Extraction:
    regions: list[dict[str, Any]]
    countries: list[CountryRecord]
    sources: list[dict[str, Any]]
    uncited_refs: list[int]
    curation: dict[str, Any]
    document: SymbologyDocument
    corrections: list[AppliedCorrection] = field(default_factory=list)


def ref_key(ref_no: int) -> str:
    return f"symbology-ref-{ref_no}"


def profile_field_of(key: str) -> str:
    """The profile_field ('etymology', 'flag_design', ...) a profile column belongs to."""
    for name in FIELDS:
        if key.startswith(name):
            return name
    raise KeyError(key)


def apply_corrections(
    iso3: str, profile: dict[str, Any], corrections: list[dict[str, Any]]
) -> tuple[list[AppliedCorrection], list[str]]:
    """Apply reviewed corrections in place. Each 'replace' must match the extracted text
    exactly once, so a changed PDF or extractor cannot silently skip a correction."""
    applied: list[AppliedCorrection] = []
    problems: list[str] = []
    for correction in corrections:
        key = correction["field"]
        before = profile.get(key)
        if key not in profile or (before is not None and not isinstance(before, str)):
            problems.append(f"{iso3}: correction targets unknown text field {key!r}")
            continue
        if "replace" in correction:
            old = correction["replace"]
            count = (before or "").count(old)
            if count != 1:
                problems.append(
                    f"{iso3}: correction for {key} expected its text once, "
                    f"found {count}: {old[:60]!r}"
                )
                continue
            after = (before or "").replace(old, correction["with"])
        else:
            after = f"{before} {correction['append']}" if before else correction["append"]
        profile[key] = after
        applied.append(
            AppliedCorrection(
                iso3, key, before, after, correction["reason"], correction.get("source_key")
            )
        )
    return applied, problems


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _alias_index(states: dict[str, Any]) -> dict[str, dict[str, Any]]:
    index: dict[str, dict[str, Any]] = {}
    for country in states["countries"]:
        for alias in country["aliases"]:
            if alias in index:
                raise ValidationError([f"Alias {alias!r} maps to two countries"])
            index[alias] = country
    return index


def _scientific_name(
    sentences: list[str], multi_animal: bool, italic_texts: set[str]
) -> tuple[str | None, list[str]]:
    """Binomial in parentheses after a common name, e.g. 'Fennec Fox (Vulpes zerda)'."""
    problems: list[str] = []
    for sentence in sentences:
        match = SCIENTIFIC_RE.search(strip_markers(sentence))
        if match is None:
            continue
        common = re.sub(r"^(?:The|the|A|An)\s+", "", match.group(1).strip())
        binomial = match.group(2)
        if binomial not in italic_texts:
            problems.append(f"'{binomial}' matched the scientific-name pattern but is not italic")
            continue
        return (f"{common}: {binomial}" if multi_animal else binomial), problems
    return None, problems


def document_region(country: dict[str, Any]) -> str:
    """The region the research document files the country under (its M49 region unless noted)."""
    return str(country.get("document_region", country["region"]))


def extract(pdf_path: Path = PDF_PATH) -> Extraction:
    document = parse(pdf_path)
    states = _load_json(STATES_FILE)
    curation = _load_json(CURATION_FILE)
    aliases = _alias_index(states)
    region_by_heading = {r["pdf_heading"]: r["slug"] for r in states["regions"]}
    problems: list[str] = []

    # ── Works cited → sources ────────────────────────────────────────────────
    sources: list[dict[str, Any]] = []
    tier_by_key: dict[str, source_tiers.Tier] = {}
    cited_works: list[tuple[str, int | None, str, str]] = [
        (ref_key(w.ref_no), w.ref_no, w.title, w.url) for w in document.works_cited
    ]
    # Reference sources used to verify the reviewed corrections (no ref_no in the PDF).
    cited_works += [
        (s["source_key"], None, s["title"], s["url"]) for s in curation["correction_sources"]
    ]
    for key, ref_no, title, url in cited_works:
        try:
            rule = source_tiers.classify(url)
        except source_tiers.UnclassifiedSourceError as error:
            problems.append(str(error))
            continue
        tier_by_key[key] = rule.tier
        sources.append(
            {
                "source_key": key,
                "ref_no": ref_no,
                "title": title,
                "url": url,
                "source_type": rule.source_type,
                "reliability_tier": rule.tier,
            }
        )
    max_ref = len(document.works_cited)
    for value in document.superscripts:
        if not value.isdigit() or not 1 <= int(value) <= max_ref:
            problems.append(f"Citation numeral {value!r} does not match a work cited (1-{max_ref})")

    # ── Regions ───────────────────────────────────────────────────────────────
    regions: list[dict[str, Any]] = []
    for reference_region in states["regions"]:
        section = next(
            (r for r in document.regions if r.heading == reference_region["pdf_heading"]), None
        )
        if section is None:
            problems.append(f"Region heading {reference_region['pdf_heading']!r} not found")
            continue
        regions.append(
            {
                "slug": reference_region["slug"],
                "name": reference_region["name"],
                "description": strip_markers(section.description),
                "sort_order": reference_region["sort_order"],
                "color_hex": None,
            }
        )

    # ── Match prose paragraphs and table rows to countries ───────────────────
    prose_by_iso3: dict[str, Any] = {}
    for paragraph in document.prose:
        country = aliases.get(paragraph.label)
        if country is None:
            problems.append(f"Prose heading {paragraph.label!r} matches no known country alias")
            continue
        if country["iso3"] in prose_by_iso3:
            problems.append(f"Two prose paragraphs for {country['name']}")
        prose_by_iso3[country["iso3"]] = paragraph
        if region_by_heading.get(paragraph.region_heading) != document_region(country):
            problems.append(
                f"{country['name']}: prose sits under {paragraph.region_heading!r}, "
                f"the document's region is {document_region(country)!r}"
            )
    table_by_iso3: dict[str, Any] = {}
    for row in document.table_rows:
        country = aliases.get(row.label)
        if country is None:
            problems.append(f"Table row {row.label!r} matches no known country alias")
            continue
        if country["iso3"] in table_by_iso3:
            problems.append(f"Two table rows for {country['name']}")
        table_by_iso3[country["iso3"]] = row
        if region_by_heading.get(row.region_heading) != document_region(country):
            problems.append(
                f"{country['name']}: table row sits under {row.region_heading!r}, "
                f"the document's region is {document_region(country)!r}"
            )

    # ── Build country records ────────────────────────────────────────────────
    known_issues = curation["known_issues"]
    records: list[CountryRecord] = []
    corrections_applied: list[AppliedCorrection] = []
    for country in states["countries"]:
        iso3 = country["iso3"]
        prose = prose_by_iso3.get(iso3)
        table_row = table_by_iso3.get(iso3)
        curated = curation["countries"].get(iso3)
        if prose is None or table_row is None or curated is None:
            missing = [
                name
                for name, value in (
                    ("prose", prose),
                    ("table row", table_row),
                    ("curation", curated),
                )
                if value is None
            ]
            problems.append(f"{country['name']}: missing {', '.join(missing)}")
            continue

        sentences = split_sentences(prose.text)
        if len(sentences) != curated["sentence_count"]:
            problems.append(
                f"{country['name']}: prose now splits into {len(sentences)} sentences, curation "
                f"expects {curated['sentence_count']}; re-review its segments"
            )
            continue
        segments: dict[str, list[int]] = curated["segments"]
        assigned = {index for indices in segments.values() for index in indices}
        if assigned != set(range(len(sentences))):
            unassigned = sorted(set(range(len(sentences))) - assigned)
            out_of_range = sorted(assigned - set(range(len(sentences))))
            problems.append(
                f"{country['name']}: sentences {unassigned} unassigned, "
                f"{out_of_range} out of range in curation segments"
            )
            continue

        details: dict[str, str | None] = {}
        citations: list[tuple[str, str]] = []
        for field_name in FIELDS:
            chosen = [sentences[i] for i in segments[field_name]]
            details[field_name] = strip_markers(" ".join(chosen)) if chosen else None
            refs = sorted({ref for s in chosen for ref in refs_in(s)})
            citations += [(field_name, ref_key(ref)) for ref in refs]

        status = curated["animal_status"]
        if status not in ANIMAL_STATUSES:
            problems.append(f"{country['name']}: unknown animal_status {status!r}")
        animal_table = tidy(table_row.national_animal)
        animal_name = tidy(STATUS_QUALIFIER_RE.sub("", animal_table))
        animal_sentences = [sentences[i] for i in segments["national_animal"]]
        scientific, sci_problems = _scientific_name(
            animal_sentences, "/" in animal_name, document.italic_texts
        )
        problems += [f"{country['name']}: {p}" for p in sci_problems]

        category = curation["etymology_categories"][iso3][0]
        if category is not None and category not in ETYMOLOGY_CATEGORIES:
            problems.append(f"{country['name']}: unknown etymology category {category!r}")

        profile: dict[str, Any] = {
            "etymology_summary": tidy(table_row.etymology),
            "etymology_detail": details["etymology"],
            "etymology_category": category,
            "flag_design_summary": tidy(table_row.flag_design),
            "flag_design_detail": details["flag_design"],
            "national_symbol_summary": tidy(table_row.national_symbol),
            "national_symbol_detail": details["national_symbol"],
            "national_animal_name": animal_name,
            "national_animal_scientific": scientific,
            "national_animal_detail": details["national_animal"],
            "animal_status": status,
            "needs_review": False,
            "review_notes": None,
        }

        applied, correction_problems = apply_corrections(
            iso3, profile, curation["corrections"].get(iso3, [])
        )
        problems += correction_problems
        corrections_applied += applied
        for correction in applied:
            if correction.source_key is None:
                continue
            if correction.source_key not in tier_by_key:
                problems.append(f"{iso3}: correction cites unknown source {correction.source_key}")
            link = (profile_field_of(correction.field), correction.source_key)
            if link not in citations:
                citations.append(link)

        # Review notes: weak sourcing and open issues keep the record flagged; corrections
        # and status changes are recorded for transparency.
        flagged: list[str] = []
        for field_name in FIELDS:
            label = field_name.replace("_", " ")
            keys = [k for f, k in citations if f == field_name]
            if not segments[field_name]:
                flagged.append(
                    f"No prose in the document describes the {label}; only the table "
                    "summary is available."
                )
            elif source_tiers.mainly_low_tier([tier_by_key[k] for k in keys if k in tier_by_key]):
                ref_labels = [k.removeprefix("symbology-ref-") for k in keys]
                flagged.append(
                    f"The {label} relies mainly on low-reliability or no sources "
                    f"(refs: {', '.join(ref_labels) or 'none'})."
                )
        info: list[str] = []
        for issue in known_issues:
            if issue["iso3"] != iso3:
                continue
            label = issue["field"].replace("_", " ")
            if issue["resolution"] == "open":
                flagged.append(f"[{issue['severity']}] {label}: {issue['note']}")
        for correction in applied:
            info.append(
                f"[corrected] {correction.field.replace('_', ' ')}: {correction.reason}"
                + (f" (source: {correction.source_key})" if correction.source_key else "")
            )
        if any(i["iso3"] == iso3 and i["resolution"] == "status_changed" for i in known_issues):
            info.append(f"[status] national animal: {curated['animal_status_reason']}")
        notes = flagged + info
        profile["needs_review"] = bool(flagged)
        profile["review_notes"] = "\n".join(notes) if notes else None

        records.append(
            CountryRecord(
                iso3=iso3,
                iso2=country["iso2"],
                iso_numeric=country["iso_numeric"],
                name=country["name"],
                official_name=country.get("official_name"),
                region=country["region"],
                profile=profile,
                citations=citations,
                review_notes=notes,
            )
        )

    iso3s = {c["iso3"] for c in states["countries"]}
    for issue in known_issues:
        if issue["iso3"] not in iso3s:
            problems.append(f"Known issue for unknown country {issue['iso3']!r}")
        if issue["field"] not in FIELDS:
            problems.append(f"Known issue with unknown field {issue['field']!r}")
        if issue.get("resolution") not in {"corrected", "status_changed", "open"}:
            problems.append(f"Known issue {issue['iso3']}/{issue['field']} has no valid resolution")
    for iso3 in curation["corrections"]:
        if iso3 not in iso3s:
            problems.append(f"Corrections for unknown country {iso3!r}")

    cited = {key for record in records for _, key in record.citations}
    uncited = [n for n in range(1, max_ref + 1) if ref_key(n) not in cited]
    extraction = Extraction(
        regions, records, sources, uncited, curation, document, corrections_applied
    )
    problems += validate(extraction, states)
    if problems:
        raise ValidationError(problems)
    return extraction


def validate(extraction: Extraction, states: dict[str, Any]) -> list[str]:
    """The checks the spec requires to fail loudly, plus consistency checks."""
    problems: list[str] = []
    countries = extraction.countries
    if len(countries) != 54:
        problems.append(f"Expected 54 countries, extracted {len(countries)}")
    counts = Counter(c.region for c in countries)
    if dict(counts) != EXPECTED_REGION_COUNTS:
        problems.append(f"Region counts {dict(counts)} != expected {EXPECTED_REGION_COUNTS}")
    document_counts = Counter(document_region(c) for c in states["countries"])
    if dict(document_counts) != DOCUMENT_REGION_COUNTS:
        problems.append(
            f"Document region counts {dict(document_counts)} != expected {DOCUMENT_REGION_COUNTS}"
        )
    for country in states["countries"]:
        if country.get("document_region") == country["region"]:
            problems.append(f"{country['name']}: document_region repeats the M49 region")
    for key in ("iso2", "iso3", "iso_numeric", "name"):
        duplicates = [v for v, n in Counter(getattr(c, key) for c in countries).items() if n > 1]
        if duplicates:
            problems.append(f"Duplicate {key}: {duplicates}")
    for country in countries:
        if not re.fullmatch(r"[A-Z]{2}", country.iso2) or not re.fullmatch(
            r"[A-Z]{3}", country.iso3
        ):
            problems.append(f"{country.name}: malformed ISO code")
        for summary in (
            "etymology_summary",
            "flag_design_summary",
            "national_symbol_summary",
            "national_animal_name",
        ):
            if not country.profile[summary]:
                problems.append(f"{country.name}: empty {summary}")
        for key, value in country.profile.items():
            if isinstance(value, str) and key != "review_notes":
                leftovers = leftover_citation_digits(value)
                if leftovers or "⟦" in value:
                    problems.append(
                        f"{country.name}: leftover citation digits in {key}: "
                        f"{leftovers or 'marker'}"
                    )
    for region in extraction.regions:
        if leftover_citation_digits(region["description"]):
            problems.append(f"Region {region['slug']}: leftover citation digits in description")
    known_keys = {s["source_key"] for s in extraction.sources}
    for country in countries:
        for field_name, key in country.citations:
            if key not in known_keys:
                problems.append(f"{country.name}: {field_name} cites unknown source {key}")
    return problems


# ── Seed output ──────────────────────────────────────────────────────────────


def _content_hash(payload: Any) -> str:
    canonical = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def seed_payloads(extraction: Extraction, pdf_path: Path) -> dict[str, dict[str, Any]]:
    countries_payload = {
        "regions": extraction.regions,
        "countries": [
            {
                "iso3": c.iso3,
                "iso2": c.iso2,
                "iso_numeric": c.iso_numeric,
                "name": c.name,
                "official_name": c.official_name,
                "region": c.region,
                "flag_url_template": FLAG_URL_TEMPLATE.replace("{code}", c.iso2.lower()),
                "is_microstate_marker": False,
                "profile": c.profile,
                "sources": [{"field": f, "source_key": k} for f, k in c.citations],
            }
            for c in extraction.countries
        ],
    }
    return {
        "countries.json": countries_payload,
        "sources.json": {"sources": extraction.sources},
        "datasets.json": {"datasets": [SYMBOLOGY_DATASET]},
    }


def _wrap(payload: dict[str, Any], pdf_path: Path) -> dict[str, Any]:
    return {
        "$generated": {
            "by": "python -m pipelines extract-pdf",
            "source_pdf": str(pdf_path.relative_to(ROOT))
            if pdf_path.is_relative_to(ROOT)
            else str(pdf_path),
            "source_pdf_sha256": _file_sha256(pdf_path),
            "content_sha256": _content_hash(payload),
            "note": "Edit freely, then run `python -m pipelines load`. Re-running extract-pdf "
            "will not overwrite edited seeds unless --force is given.",
        },
        **payload,
    }


def is_hand_edited(path: Path) -> bool:
    if not path.exists():
        return False
    existing: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    recorded = existing.get("$generated", {}).get("content_sha256")
    payload = {k: v for k, v in existing.items() if k != "$generated"}
    return bool(recorded != _content_hash(payload))


def write_seeds(extraction: Extraction, pdf_path: Path, seeds_dir: Path, *, force: bool) -> None:
    payloads = seed_payloads(extraction, pdf_path)
    edited = [name for name in payloads if is_hand_edited(seeds_dir / name)]
    if edited and not force:
        raise SeedOverwriteError(
            f"Seeds were edited by hand since they were generated: {', '.join(edited)}. "
            "Re-run with --force to overwrite them (your edits would be lost)."
        )
    seeds_dir.mkdir(parents=True, exist_ok=True)
    for name, payload in payloads.items():
        text = json.dumps(_wrap(payload, pdf_path), indent=2, ensure_ascii=False) + "\n"
        (seeds_dir / name).write_text(text, encoding="utf-8")


# ── CLI ──────────────────────────────────────────────────────────────────────


def configure(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--pdf", type=Path, default=PDF_PATH, help="path to the research PDF")
    parser.add_argument("--seeds-dir", type=Path, default=SEEDS_DIR)
    parser.add_argument("--report", type=Path, default=REPORT_PATH)
    parser.add_argument(
        "--force", action="store_true", help="overwrite seeds even if they were edited by hand"
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="validate only; fail if the committed seeds' recorded content differs from a "
        "fresh extraction (does not write files)",
    )


def _display(path: Path) -> Path:
    return path.relative_to(ROOT) if path.is_relative_to(ROOT) else path


def run(args: argparse.Namespace) -> int:
    extraction = extract(args.pdf)
    if args.check:
        payloads = seed_payloads(extraction, args.pdf)
        stale = []
        for name, payload in payloads.items():
            path = args.seeds_dir / name
            recorded = (
                json.loads(path.read_text(encoding="utf-8")).get("$generated", {})
                if path.exists()
                else {}
            )
            if recorded.get("content_sha256") != _content_hash(payload):
                stale.append(name)
        if stale:
            print(f"Seeds out of date with the extractor: {', '.join(stale)}")
            return 1
        print("extract-pdf --check: validation passed and seeds are up to date.")
        return 0
    write_seeds(extraction, args.pdf, args.seeds_dir, force=args.force)
    write_review_report(extraction, args.report)
    needs_review = sum(1 for c in extraction.countries if c.profile["needs_review"])
    print(
        f"Extracted {len(extraction.countries)} countries, {len(extraction.regions)} regions, "
        f"{len(extraction.sources)} sources; {needs_review} countries flagged needs_review.\n"
        f"Wrote {_display(args.seeds_dir)} and {_display(args.report)}."
    )
    return 0
