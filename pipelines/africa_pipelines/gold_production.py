"""`python -m pipelines gold-production`: gold mine production and in-ground reserves into
db/seeds/gold_production.json.

Sources (US public domain; the MCS data release is CC0):
  * USGS Mineral Commodity Summaries (MCS), the gold chapter of each edition in
    gold_config.json: the latest two years of mine production and the reserves of the countries
    it lists. Countries it lumps into "Other countries" are stored as included_in_other (tonnes
    NULL), but only where the yearbook shows the country producing gold in recent years; a
    country with no gold output is not "included in other".
  * USGS Minerals Yearbook, volume III (Africa), the country chapters' production tables
    (Table 1), five years per edition, from the editions published as .xlsx since the configured
    first edition. Table 1's footnotes and Table 2 (structure of the industry) are kept as
    evidence for the presence tiers: what each gold figure excludes, whether artisanal mining is
    reported, and whether a chapter says gold "may have been produced" without a figure.

Every edition is its own source; v_gold_production picks one figure per country-year (a figure
over "included in other", reported over estimated, then newer editions first).
"""

from __future__ import annotations

import argparse
import datetime as dt
import io
import re
import warnings
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import quote, unquote

import openpyxl
import pymupdf

from .gold_common import (
    GOLD_RAW,
    PRODUCTION_SEED,
    GoldError,
    SourceRecord,
    config,
    countries,
    fold,
    generated,
    table,
    write_seed,
)
from .http import FetchError, fetch_bytes
from .settings import troy_oz_per_tonne

# No African country has mined more than about 150 t in a year; a larger figure is a unit error.
MAX_PLAUSIBLE_TONNES = 400.0
MAX_PLAUSIBLE_RESERVES_TONNES = 20000.0
MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December"
DATA_THROUGH_RE = re.compile(rf"data available through ({MONTHS}) (\d{{1,2}}), (\d{{4}})")
EDITION_RE = re.compile(r"^myb3-(\d{4})(?:[-_](\d{2}))?[-_]")
SUBROW_RE = re.compile(
    r"^(artisanal|small[- ]scale|large[- ]scale|industrial|semi[- ]industrial|formal|informal|"
    r"total|primary|by-?product|alluvial|placer|lode)",
    re.IGNORECASE,
)
ASM_RE = re.compile(r"artisanal|small[- ]scale", re.IGNORECASE)
LARGE_SCALE_RE = re.compile(r"large[- ]scale|industrial", re.IGNORECASE)
FOOTNOTE_RE = re.compile(r"^(\d{1,2})([A-Z].*)$", re.DOTALL)
MAY_HAVE_BEEN_PRODUCED_RE = re.compile(
    r"In addition to the commodit(?:y|ies) listed,(?P<items>.*?)(?:also )?"
    r"(?:may have been|was|were) produced",
    re.IGNORECASE | re.DOTALL,
)
OTHER_COMMODITY_RE = re.compile(
    r"\b(barite|cement|copper|cobalt|diamond|tin|tantal\w*|coal|petroleum|gas|salt|lime|"
    r"manganese|iron|bauxite|phosphate|uranium|zinc|lead|silver|graphite|chromite)\b",
    re.IGNORECASE,
)
# The owner asked for World Gold Council data to be left out (2026-10-18), including figures the
# USGS attributes to it.
EXCLUDED_ATTRIBUTION_RE = re.compile(r"World Gold Council", re.IGNORECASE)
GROUP_PART_RE = re.compile(r"^(mine|refinery|refined|smelter|metal|bullion)\b", re.IGNORECASE)

UNIT_TONNES = {
    "kilograms": 0.001,
    "kilogram": 0.001,
    "metric tons": 1.0,
    "metric ton": 1.0,
    "grams": 0.000001,
}

# Country names as USGS table titles write them, beyond the seeds' own names.
TITLE_ALIASES = {
    "SWZ": ["swaziland", "eswatini"],
    "COD": ["congo (kinshasa)", "congo, kinshasa"],
    "COG": ["congo (brazzaville)", "congo, brazzaville"],
    "CIV": ["cote d'ivoire"],
    "CPV": ["cabo verde", "cape verde"],
    "GMB": ["the gambia", "gambia"],
    "STP": ["sao tome and principe", "sao tome e principe"],
    "MAR": ["morocco and western sahara", "morocco"],
    "TZA": ["tanzania"],
}


def mcs_source(edition: int) -> SourceRecord:
    url = config()["production"]["mcs_url"].format(edition=edition)
    doi = config()["production"]["mcs_doi"].get(str(edition))
    suffix = f" (data release doi:{doi})" if doi else ""
    return SourceRecord(
        f"usgs-mcs-{edition}-gold",
        f"U.S. Geological Survey, Mineral Commodity Summaries {edition}: Gold{suffix}",
        url,
    )


# ── Mineral Commodity Summaries ──────────────────────────────────────────────


@dataclass(frozen=True)
class McsValue:
    tonnes: float | None  # None for NA
    estimate: bool


@dataclass
class McsEdition:
    edition: int
    years: tuple[int, int]
    production: dict[str, tuple[McsValue, McsValue]]  # iso3 → (first year, second year)
    reserves: dict[str, float]  # iso3 → tonnes (NA omitted)
    other_countries: tuple[float | None, float | None]
    world: tuple[float, float] | None = None  # "World total (rounded)" for the two years


WORLD_TOTAL_RE = re.compile(r"World total(?: \(rounded\))?\s*\n\s*([\d,]+)\s*\n\s*([\d,]+)")


def pdf_text(body: bytes) -> str:
    with pymupdf.open(stream=body, filetype="pdf") as document:
        return "".join(page.get_text() for page in document)


def _mcs_number(token: str, *, strict: bool) -> McsValue:
    token = token.strip()
    if token in {"NA", "—", "--", "W"}:
        return McsValue(None, estimate=False)
    estimate = token.startswith("e")
    digits = token.removeprefix("e")
    pattern = r"^\d{1,3}(,\d{3})*$" if strict else r"^[\d,]+$"
    if not re.match(pattern, digits):
        raise GoldError(f"Unreadable MCS value {token!r} (a footnote marker glued to it?)")
    return McsValue(float(digits.replace(",", "")), estimate)


def parse_mcs(text: str, edition: int, names: dict[str, str]) -> McsEdition:
    """The 'World Mine Production and Reserves' table of an MCS gold chapter."""
    start = text.find("World Mine Production and Reserves")
    end = text.find("World total", start)
    if start < 0 or end < 0:
        raise GoldError(f"MCS {edition}: no world production table found")
    tokens = [t.strip() for t in text[start:end].splitlines() if t.strip()]
    try:
        reserves_at = next(i for i, t in enumerate(tokens) if re.match(r"^Reserves\d*$", t))
    except StopIteration as error:
        raise GoldError(f"MCS {edition}: no 'Reserves' column heading") from error
    years: list[int] = []
    index = reserves_at + 1
    while len(years) < 2:
        match = re.match(r"^(\d{4})e?$", tokens[index])
        if match is None:
            raise GoldError(
                f"MCS {edition}: expected two years after 'Reserves', got {tokens[index]!r}"
            )
        years.append(int(match[1]))
        index += 1
    production: dict[str, tuple[McsValue, McsValue]] = {}
    reserves: dict[str, float] = {}
    other: tuple[float | None, float | None] = (None, None)
    while index < len(tokens):
        name = tokens[index]
        values = []
        index += 1
        while index < len(tokens) and re.match(r"^(e?[\d,]+|NA|—|W)$", tokens[index]):
            values.append(tokens[index])
            index += 1
        if name == "Other countries":
            other = (
                _mcs_number(values[0], strict=False).tonnes,
                _mcs_number(values[1], strict=False).tonnes,
            )
            continue
        iso3 = names.get(fold(name))
        if iso3 is None:
            continue  # not an African country
        if len(values) < 2:
            raise GoldError(f"MCS {edition}: {name} has {len(values)} values, expected 2 or 3")
        first = _mcs_number(values[0], strict=True)
        second = _mcs_number(values[1], strict=True)
        # The second year is always an estimate (its heading reads e.g. "2025e").
        production[iso3] = (first, McsValue(second.tonnes, estimate=True))
        if len(values) > 2:
            reserve = _mcs_number(values[2], strict=True).tonnes
            if reserve is not None:
                reserves[iso3] = reserve
    world = None
    if (match := WORLD_TOTAL_RE.search(text, end)) is not None:
        world = (float(match[1].replace(",", "")), float(match[2].replace(",", "")))
    return McsEdition(edition, (years[0], years[1]), production, reserves, other, world)


def name_index() -> dict[str, str]:
    """Folded country name (and USGS aliases) → ISO3."""
    index = {fold(c.name): c.iso3 for c in countries()}
    for name, iso3 in config()["production"]["name_aliases"].items():
        index[fold(name)] = iso3
    for iso3, aliases in TITLE_ALIASES.items():
        for alias in aliases:
            index[fold(alias)] = iso3
    return index


def fetch_mcs(*, refresh: bool) -> list[McsEdition]:
    names = name_index()
    editions = []
    for edition in config()["production"]["mcs_editions"]:
        url = mcs_source(edition).url
        body = fetch_bytes(
            url, GOLD_RAW / "usgs" / "mcs" / f"mcs{edition}-gold.pdf", refresh=refresh, timeout=90
        )
        editions.append(parse_mcs(pdf_text(body), edition, names))
    return editions


# ── Minerals Yearbook country chapters ───────────────────────────────────────


@dataclass(frozen=True)
class Figure:
    year: int
    tonnes: float
    estimate: bool
    notes: tuple[str, ...] = ()


@dataclass
class Chapter:
    iso3: str
    edition: str  # e.g. "2020-21"
    edition_year: int  # the last year the edition covers in its name
    file_name: str
    url: str
    title: str = ""
    covered: bool = False  # the country has its own production table (or section)
    data_through: dt.date | None = None
    figures: dict[int, Figure] = field(default_factory=dict)
    asm_split: dict[int, tuple[float, float]] = field(default_factory=dict)  # year → (ASM, total)
    gold_listed: bool = False  # Table 1 has a gold row
    may_have_been_produced: str | None = None  # Table 1's footnote naming gold, verbatim
    gold_notes: list[str] = field(default_factory=list)  # footnotes on the gold figures
    operations: list[str] = field(default_factory=list)  # Table 2 gold rows
    warnings: list[str] = field(default_factory=list)
    excluded: list[str] = field(default_factory=list)  # figures left out, with the reason
    downloaded: bool = True

    @property
    def source(self) -> SourceRecord:
        name = self.title or self.iso3
        return SourceRecord(
            f"usgs-myb-{self.edition}-{self.iso3.lower()}",
            f"U.S. Geological Survey, Minerals Yearbook {self.edition}, volume III: {name}",
            self.url,
        )


def fmt_tonnes(tonnes: float) -> str:
    return f"{tonnes:,.3f}".rstrip("0").rstrip(".") + " t"


def edition_of(file_name: str) -> tuple[str, int] | None:
    match = EDITION_RE.match(file_name)
    if match is None:
        return None
    first = int(match[1])
    if match[2] is None:
        return str(first), first
    last = int(str(first)[:2] + match[2])
    return f"{first}-{match[2]}", max(first, last)


def chapter_links(page_html: str, first_edition: int) -> dict[str, tuple[str, str]]:
    """Edition → (file name, URL) of the .xlsx yearbook chapters linked from a country page.
    A final release is preferred to an advance release of the same edition."""
    found: dict[str, tuple[str, str]] = {}
    for link in sorted(set(re.findall(r'href="([^"]+\.xlsx)"', page_html))):
        name = unquote(link.rsplit("/", 1)[1])
        edition = edition_of(name)
        if edition is None or edition[1] < first_edition:
            continue
        url = link if link.startswith("http") else f"https://www.usgs.gov{link}"
        url = quote(url, safe=":/%")
        current = found.get(edition[0])
        if current is None or ("adv" in current[0].lower() and "adv" not in name.lower()):
            found[edition[0]] = (name, url)
    return found


def _title_countries(title_line: str, names: dict[str, str]) -> list[str]:
    """'MAURITIUS, REUNION, AND SEYCHELLES' → ['MUS', 'reunion', 'SYC'] (unknown names kept)."""
    head = fold(title_line)
    for alias in sorted((a for a in names if " and " in a or "," in a), key=len, reverse=True):
        head = head.replace(alias, f"<{names[alias]}>")
    members = []
    for part in (p.strip() for p in re.split(r",|\band\b", head)):
        if not part:
            continue
        match = re.fullmatch(r"<([A-Z]{3})>", part)
        members.append(match[1] if match else names.get(part, part))
    return members


def _year(cell: Any) -> int | None:
    if isinstance(cell, int) and 1990 <= cell <= 2100:
        return cell
    if isinstance(cell, str) and re.fullmatch(r"\s*(19|20)\d{2}\s*", cell):
        return int(cell)
    return None


def _unit_factor(unit: str | None) -> float | None:
    if unit is None:
        return None
    text = fold(unit).strip(" .,:")
    if text in UNIT_TONNES:
        return UNIT_TONNES[text]
    if text in {"troy ounces", "troy ounce"}:
        return 1 / troy_oz_per_tonne()
    return None


def _default_unit(rows: list[tuple[Any, ...]]) -> str | None:
    for row in rows[:6]:
        cell = row[0] if row else None
        if isinstance(cell, str) and (match := re.match(r"^\(([^,)]+)", cell.strip())):
            return match[1]
    return None


def _flags(cell: Any) -> tuple[bool, list[str]]:
    """A value's flag cell: e (estimated), r (revised) and footnote numbers."""
    if cell is None:
        return False, []
    tokens = [t.strip() for t in str(cell).replace(".", ",").split(",") if t.strip()]
    return "e" in tokens, [t for t in tokens if t.isdigit()]


def _label_marks(label: str) -> tuple[str, bool, list[str]]:
    """'Gold, mine, Au contente' → estimate; 'Au content3' or 'content:2, 3' → footnotes."""
    text = label.strip()
    match = re.search(
        r"(?P<word>content|producers|miners|mining|production|scale)"
        r"(?P<e>e)?[:,\s]*(?P<notes>\d[\d,\s]*)?:?$",
        text,
    )
    if match is None:
        return text, False, []
    notes = [n.strip() for n in (match["notes"] or "").split(",") if n.strip()]
    clean = text[: match.start("word")] + match["word"]
    return clean, bool(match["e"]), notes


def _value(cell: Any) -> float | str | None:
    """A number, None for 'not available', or the raw text when unreadable."""
    if isinstance(cell, int | float):
        return float(cell)
    if cell is None:
        return None
    text = str(cell).strip().rstrip(".")
    if text in {"--", "–", "—"}:
        return 0.0
    if text in {"NA", "W", "XX", ""}:
        return None
    if re.fullmatch(r"[\d,]+(\.\d+)?", text):
        return float(text.replace(",", ""))
    return text


def parse_chapter(chapter: Chapter, body: bytes, names: dict[str, str]) -> None:
    # openpyxl warns about Excel extensions it ignores (conditional formatting and the like) while
    # it reads rows lazily, so the whole read is inside the filter.
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        workbook = openpyxl.load_workbook(io.BytesIO(body), read_only=True, data_only=True)
        sheets = [list(sheet.iter_rows(values_only=True)) for sheet in workbook.worksheets]
    for rows in sheets:
        title = " ".join(str(c) for row in rows[:3] for c in row if isinstance(c, str))
        if "PRODUCTION OF MINERAL COMMODITIES" in title.upper():
            _parse_production(chapter, rows, title, names)
        elif "STRUCTURE OF THE MINERAL INDUSTR" in title.upper():
            _parse_structure(chapter, rows, title, names)


def _title_line(title: str) -> str:
    """'TABLE 1 GHANA: PRODUCTION OF ...' → 'GHANA'."""
    head = re.split(r":\s*(?:ESTIMATED\s+)?(?:PRODUCTION|STRUCTURE)", title, maxsplit=1)[0]
    return re.sub(r"^\s*TABLE\s+\d+\s*", "", head).strip()


CATEGORY_HEADINGS = {"metals", "industrial minerals", "mineral fuels and related materials"}


def _sections(
    rows: list[tuple[Any, ...]], start: int, members: list[str], names: dict[str, str]
) -> Iterator[tuple[int, tuple[Any, ...], str | None]]:
    """Rows after `start` with the country section each falls in. A single-country table is all
    one section; a multi-country table switches at each upper-case country heading (one that is
    not ours, such as REUNION, switches to a section that is none of ours)."""
    single = len(members) == 1
    current: str | None = members[0] if single else None
    for index in range(start, len(rows)):
        row = rows[index]
        label = row[0] if row else None
        if (
            not single
            and isinstance(label, str)
            and label.strip().isupper()
            and fold(label) not in CATEGORY_HEADINGS
            and all(c is None or (isinstance(c, str) and not c.strip()) for c in row[1:])
        ):
            current = names.get(fold(label), fold(label))
            continue
        yield index, row, current


def mentions_gold(footnote: str) -> bool:
    """Whether a "may have been produced" footnote lists gold itself as a commodity (not, say,
    "silver as a byproduct of gold mining")."""
    match = MAY_HAVE_BEEN_PRODUCED_RE.search(footnote)
    if match is None:
        return False
    items = re.sub(r"\([^)]*\)", "", match["items"])
    return any(
        re.match(r"^(artisanal |placer |alluvial )?gold\b", item.strip(), re.IGNORECASE)
        for item in re.split(r",|\band\b", items)
    )


Row = tuple[Any, ...]
BlockEntry = tuple[str, bool, list[str], str | None, Row]


def _parse_production(chapter: Chapter, rows: list[Row], title: str, names: dict[str, str]) -> None:
    members = _title_countries(_title_line(title), names)
    if chapter.iso3 not in members:
        return
    single = members == [chapter.iso3]
    header_index = next(
        (
            i
            for i, row in enumerate(rows)
            if row
            and isinstance(row[0], str)
            and "ommodit" in row[0]
            and sum(_year(c) is not None for c in row) >= 2
        ),
        None,
    )
    if header_index is None:
        chapter.warnings.append(f"{chapter.file_name}: no header row with years")
        return
    year_cols = {i: y for i, c in enumerate(rows[header_index]) if (y := _year(c)) is not None}
    first_col = min(year_cols)
    default_unit = _default_unit(rows)
    footnotes: dict[str, str] = {}
    for row in rows[header_index:]:
        cell = row[0] if row else None
        if isinstance(cell, str) and (match := FOOTNOTE_RE.match(cell.strip())):
            footnotes[match[1]] = match[2].strip()
            if match[1] == "1" and (through := DATA_THROUGH_RE.search(cell)):
                chapter.data_through = dt.datetime.strptime(
                    f"{through[1]} {through[2]} {through[3]}", "%B %d %Y"
                ).date()
            if single and mentions_gold(match[2]):
                chapter.may_have_been_produced = match[2].strip()
    sections = list(_sections(rows, header_index + 1, members, names))
    chapter.covered = chapter.covered or any(section == chapter.iso3 for _, _, section in sections)

    # States: "none"; "group" after a bare "Gold:" heading (its "Mine" row is the figure);
    # "components" after a mine heading without values (artisanal, large-scale, total rows).
    state = "none"
    block: list[BlockEntry] = []
    last_unit: str | None = default_unit
    for _, row, section in sections:
        label = row[0] if row else None
        if not isinstance(label, str) or not label.strip():
            continue
        if FOOTNOTE_RE.match(label.strip()) or "Estimated." in label or "Revised." in label:
            break
        has_values = any(row[c] is not None for c in year_cols if c < len(row))
        unit_cell = next((c for c in row[1:first_col] if isinstance(c, str) and c.strip()), None)
        if unit_cell is not None and fold(unit_cell) in {"do.", "do"}:
            unit = last_unit
        else:
            unit = unit_cell.strip() if unit_cell else default_unit
        if has_values:
            last_unit = unit
        if section != chapter.iso3:
            state = "none"
            continue
        clean, estimate, notes = _label_marks(label)
        folded = fold(clean)
        entry: BlockEntry = (clean, estimate, notes, unit, row)
        if folded.startswith("gold") and "refin" not in folded:
            chapter.gold_listed = True
            is_mine = "mine" in folded or "au content" in folded
            if has_values and is_mine:
                block.append(entry)
                state = "none"
            elif not has_values:
                state = "components" if is_mine else "group"
            continue
        if state == "group" and GROUP_PART_RE.match(clean.strip()):
            if folded.startswith("mine"):
                if has_values:
                    block.append(entry)
                    state = "group"
                else:
                    state = "components"
            continue
        if state in {"group", "components"} and SUBROW_RE.match(clean.strip()) and has_values:
            block.append(entry)
            state = "components"
            continue
        state = "none"
    if block:
        _figures_from_block(chapter, block, year_cols, footnotes)


def _figures_from_block(
    chapter: Chapter,
    block: list[tuple[str, bool, list[str], str | None, tuple[Any, ...]]],
    year_cols: dict[int, int],
    footnotes: dict[str, str],
) -> None:
    totals = [entry for entry in block if fold(entry[0]).startswith("total")]
    parts = totals or block
    per_year: dict[int, list[tuple[str, float | None, bool, list[str]]]] = {}
    for label, row_estimate, row_notes, unit, row in parts:
        factor = _unit_factor(unit)
        if factor is None:
            chapter.warnings.append(f"{chapter.file_name}: gold row {label!r} has unit {unit!r}")
            return
        for col, year in year_cols.items():
            value = _value(row[col] if col < len(row) else None)
            flag_cell = row[col + 1] if col + 1 < len(row) and col + 1 not in year_cols else None
            estimate, notes = _flags(flag_cell)
            if isinstance(value, str):
                chapter.warnings.append(f"{chapter.file_name}: {year} {label!r} value {value!r}")
                value = None
            tonnes = None if value is None else value * factor
            per_year.setdefault(year, []).append(
                (label, tonnes, estimate or row_estimate, notes + row_notes)
            )
    for year, entries in per_year.items():
        if any(tonnes is None for _, tonnes, _, _ in entries):
            if any(tonnes is not None for _, tonnes, _, _ in entries) and len(entries) > 1:
                chapter.warnings.append(
                    f"{chapter.file_name}: {year} has a part not available; no total computed"
                )
            continue
        total = sum(tonnes for _, tonnes, _, _ in entries if tonnes is not None)
        if total > MAX_PLAUSIBLE_TONNES:
            chapter.warnings.append(
                f"{chapter.file_name}: {year} total {total:,.0f} t is implausible (unit?); dropped"
            )
            continue
        refs = sorted({n for _, _, _, notes in entries for n in notes}, key=int)
        texts = []
        for ref in refs:
            text = footnotes.get(ref)
            if text is None:
                continue
            if "gold" not in text.lower() and OTHER_COMMODITY_RE.search(text):
                chapter.warnings.append(
                    f"{chapter.file_name}: note {ref} on the {year} gold "
                    f"figure is about another commodity; ignored ({text[:60]})"
                )
                continue
            texts.append(text)
        if any(EXCLUDED_ATTRIBUTION_RE.search(t) for t in texts):
            chapter.excluded.append(f"{year}: {fmt_tonnes(total)} (USGS note: {'; '.join(texts)})")
            continue
        chapter.figures[year] = Figure(year, total, any(e for _, _, e, _ in entries), tuple(texts))
        for text in texts:
            if text not in chapter.gold_notes:
                chapter.gold_notes.append(text)
        if len(entries) > 1:
            asm = sum(t for label, t, _, _ in entries if t is not None and ASM_RE.search(label))
            if any(ASM_RE.search(label) for label, _, _, _ in entries) and total > 0:
                chapter.asm_split[year] = (asm, total)


def _operation_text(row: Row) -> str:
    """Operator and location from a structure-table row (capacities and ditto marks dropped)."""
    parts = []
    for cell in row[1:]:
        if not isinstance(cell, str):
            continue
        text = cell.strip().rstrip(",;")
        if not text or fold(text) in {"do.", "do", "kilograms", "e", "na"}:
            continue
        if re.fullmatch(r"[\d,.]+(e)?(,\s*\d+)?", text):
            continue
        parts.append(text)
    return " ".join(parts)


def _parse_structure(chapter: Chapter, rows: list[Row], title: str, names: dict[str, str]) -> None:
    members = _title_countries(_title_line(title), names)
    if chapter.iso3 not in members:
        return
    in_gold = False
    for _, row, section in _sections(rows, 0, members, names):
        label = row[0] if row else None
        if section != chapter.iso3:
            in_gold = False
            continue
        if isinstance(label, str) and label.strip():
            folded = fold(label)
            if folded.startswith("gold"):
                in_gold = True
            elif not (in_gold and (folded.startswith(("mine", "do")) or SUBROW_RE.match(folded))):
                in_gold = False
                continue
        elif not in_gold:
            continue
        text = _operation_text(row)
        if text and text not in chapter.operations:
            chapter.operations.append(text)


def fetch_chapters(*, refresh: bool) -> list[Chapter]:
    settings = config()["production"]
    names = name_index()
    chapters = []
    for country in countries():
        slug = settings["usgs_slugs"][country.iso3]
        page = fetch_bytes(
            settings["yearbook_page_url"].format(slug=slug),
            GOLD_RAW / "usgs" / "pages" / f"{slug}.html",
            refresh=refresh,
        ).decode("utf-8", errors="replace")
        for edition, (name, url) in sorted(
            chapter_links(page, int(settings["yearbook_first_edition"])).items()
        ):
            label, edition_year = edition_of(name) or (edition, 0)
            chapter = Chapter(country.iso3, label, edition_year, name, url, title=country.name)
            try:
                body = fetch_bytes(url, GOLD_RAW / "usgs" / "yearbook" / name, timeout=90)
            except FetchError as error:
                chapter.warnings.append(f"{name}: not downloadable ({error})")
                chapter.downloaded = False
                chapters.append(chapter)
                continue
            parse_chapter(chapter, body, names)
            chapters.append(chapter)
    return chapters


# ── Combining the sources ────────────────────────────────────────────────────


@dataclass
class ProductionResult:
    mcs: list[McsEdition]
    chapters: list[Chapter]
    rows: list[list[Any]]  # iso3, year, tonnes, basis, source, notes
    inground: list[list[Any]]  # iso3, year, tonnes, definition, source
    sources: list[SourceRecord]
    priority: list[str]
    conflicts: list[str]
    warnings: list[str]


def producing_recently(chapters: list[Chapter], iso3: str, first: int, last: int) -> bool:
    return any(
        figure.tonnes > 0
        for chapter in chapters
        if chapter.iso3 == iso3
        for figure in chapter.figures.values()
        if first <= figure.year <= last
    )


def combine(mcs: list[McsEdition], chapters: list[Chapter]) -> ProductionResult:
    lookback = int(config()["production"]["included_in_other_lookback_years"])
    rows: list[list[Any]] = []
    inground: list[list[Any]] = []
    sources: dict[str, SourceRecord] = {}
    for edition in mcs:
        source = mcs_source(edition.edition)
        sources[source.source_key] = source
        for iso3, values in edition.production.items():
            for year, value in zip(edition.years, values, strict=True):
                if value.tonnes is not None:
                    basis = "estimate" if value.estimate else "reported"
                    rows.append(
                        [iso3, year, round(value.tonnes, 3), basis, source.source_key, None]
                    )
        for iso3, reserve in edition.reserves.items():
            if reserve > MAX_PLAUSIBLE_RESERVES_TONNES:
                raise GoldError(f"MCS {edition.edition}: {iso3} reserves {reserve} t implausible")
            inground.append(
                [
                    iso3,
                    edition.years[1],
                    reserve,
                    "Reserves as reported in the USGS Mineral Commodity Summaries "
                    f"{edition.edition} world table (metric tons of gold content; definitions in "
                    "its Appendix C).",
                    source.source_key,
                ]
            )
        for country in countries():
            if country.iso3 in edition.production:
                continue
            if producing_recently(
                chapters, country.iso3, edition.years[0] - lookback, edition.years[1]
            ):
                for year in edition.years:
                    rows.append(
                        [
                            country.iso3,
                            year,
                            None,
                            "included_in_other",
                            source.source_key,
                            'Included in the source\'s "Other countries" total.',
                        ]
                    )
    for chapter in chapters:
        if chapter.downloaded:
            # Every chapter read is a source: the presence tiers cite those without figures too.
            sources[chapter.source.source_key] = chapter.source
        if not chapter.figures:
            continue
        source = chapter.source
        for figure in sorted(chapter.figures.values(), key=lambda f: f.year):
            rows.append(
                [
                    chapter.iso3,
                    figure.year,
                    round(figure.tonnes, 3),
                    "estimate" if figure.estimate else "reported",
                    source.source_key,
                    " ".join(figure.notes) or None,
                ]
            )
    mcs_keys = [mcs_source(e.edition).source_key for e in sorted(mcs, key=lambda e: -e.edition)]
    chapter_keys = [
        c.source.source_key
        for c in sorted(chapters, key=lambda c: (-c.edition_year, c.iso3))
        if c.figures
    ]
    priority = list(dict.fromkeys(mcs_keys + chapter_keys))
    return ProductionResult(
        mcs,
        chapters,
        sorted(rows, key=lambda r: (r[0], r[1], r[4])),
        sorted(inground, key=lambda r: (r[0], r[1])),
        list(sources.values()),
        priority,
        conflicts(rows),
        [w for c in chapters for w in c.warnings],
    )


def conflicts(rows: list[list[Any]], tolerance: float = 0.10) -> list[str]:
    """Country-years whose sources disagree by more than 10% (and 0.5 t)."""
    by_key: dict[tuple[str, int], list[tuple[float, str]]] = {}
    for iso3, year, tonnes, _basis, source, _notes in rows:
        if tonnes is not None:
            by_key.setdefault((iso3, year), []).append((tonnes, source))
    found = []
    for (iso3, year), values in sorted(by_key.items()):
        low = min(v for v, _ in values)
        high = max(v for v, _ in values)
        if high - low > 0.5 and (low == 0 or (high - low) / high > tolerance):
            listed = ", ".join(f"{v:g} t ({s})" for v, s in sorted(values, key=lambda x: x[1]))
            found.append(f"{iso3} {year}: {listed}")
    return found


def preferred(rows: list[list[Any]], priority: list[str]) -> dict[tuple[str, int], list[Any]]:
    """The row v_gold_production picks per country-year (same order as the view)."""
    rank = {key: i for i, key in enumerate(priority)}
    best: dict[tuple[str, int], list[Any]] = {}
    for row in rows:
        key = (row[0], row[1])
        order = (row[2] is None, row[3] != "reported", rank.get(row[4], len(rank)), row[4])
        current = best.get(key)
        if current is None or order < (
            current[2] is None,
            current[3] != "reported",
            rank.get(current[4], len(rank)),
            current[4],
        ):
            best[key] = row
    return best


def chapter_evidence(chapters: list[Chapter]) -> list[dict[str, Any]]:
    """Per chapter: what it says about gold, for the presence tiers and the review report."""
    out = []
    for c in sorted(chapters, key=lambda c: (c.iso3, c.edition_year)):
        if not c.downloaded:
            continue
        latest = max(c.figures.values(), key=lambda f: f.year) if c.figures else None
        large_scale = any(
            "artisanal" in note.lower() and "not include" in note.lower() for note in c.gold_notes
        )
        out.append(
            {
                "iso3": c.iso3,
                "source": c.source.source_key,
                "edition": c.edition,
                "edition_year": c.edition_year,
                "covered": c.covered,
                "data_through": c.data_through.isoformat() if c.data_through else None,
                "gold_listed": c.gold_listed,
                "latest_year": latest.year if latest else None,
                "latest_tonnes": round(latest.tonnes, 3) if latest else None,
                "may_have_been_produced": c.may_have_been_produced,
                "gold_notes": c.gold_notes,
                "operations": c.operations,
                "asm_split": {
                    str(y): [round(a, 3), round(t, 3)] for y, (a, t) in sorted(c.asm_split.items())
                },
                "excludes_artisanal": large_scale,
                "excluded_figures": c.excluded,
            }
        )
    return out


def dataset(result: ProductionResult) -> dict[str, Any]:
    years = [r[1] for r in result.rows if r[2] is not None]
    latest_edition = max(e.edition for e in result.mcs)
    return {
        "key": "gold-production",
        "name": (
            "USGS gold mine production and reserves "
            "(Mineral Commodity Summaries and Minerals Yearbook)"
        ),
        "provider": "U.S. Geological Survey (National Minerals Information Center)",
        "license": "US public domain (the MCS data release is CC0 1.0)",
        "attribution": (
            "U.S. Geological Survey, Mineral Commodity Summaries "
            f"{min(e.edition for e in result.mcs)}–{latest_edition}: Gold, and Minerals Yearbook, "
            "volume III (Africa)."
        ),
        "coverage_start": f"{min(years)}-01-01",
        "coverage_end": f"{max(years)}-12-31",
        "as_of": f"{latest_edition}-01-31",
        "refresh_cadence": "annual",
    }


def payload(result: ProductionResult) -> dict[str, Any]:
    return {
        "$generated": generated("gold-production", warnings=result.warnings),
        "datasets": [dataset(result)],
        "sources": [s.seed() for s in sorted(result.sources, key=lambda s: s.source_key)],
        "priority": result.priority,
        "production": table(["iso3", "year", "tonnes", "basis", "source", "notes"], result.rows),
        "inground_reserves": table(
            ["iso3", "year", "tonnes_contained", "definition", "source"], result.inground
        ),
        "world_production": table(
            ["year", "tonnes", "basis", "source"],
            [
                [
                    year,
                    tonnes,
                    "estimate" if index == 1 else "reported",
                    mcs_source(e.edition).source_key,
                ]
                for e in result.mcs
                if e.world is not None
                for index, (year, tonnes) in enumerate(zip(e.years, e.world, strict=True))
            ],
        ),
        "mcs_other_countries": {
            str(e.edition): {"years": list(e.years), "tonnes": list(e.other_countries)}
            for e in result.mcs
        },
        "chapters": chapter_evidence(result.chapters),
        "conflicts": result.conflicts,
    }


def configure(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--refresh", action="store_true", help="re-fetch instead of the cache")


def run(args: argparse.Namespace) -> int:
    refresh = bool(args.refresh)
    result = combine(fetch_mcs(refresh=refresh), fetch_chapters(refresh=refresh))
    write_seed(PRODUCTION_SEED, payload(result))
    numbers = [r for r in result.rows if r[2] is not None]
    print(
        f"Gold production: {len(numbers)} figures for {len({r[0] for r in numbers})} countries "
        f"({min(r[1] for r in numbers)}–{max(r[1] for r in numbers)}), "
        f"{sum(1 for r in result.rows if r[2] is None)} 'included in other' rows, "
        f"{len(result.inground)} in-ground reserve figures; {len(result.conflicts)} source "
        f"conflicts and {len(result.warnings)} parse warnings (see the review report)."
    )
    return 0
