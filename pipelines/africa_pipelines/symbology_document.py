"""Structure of the state-symbology research PDF.

Turns the raw lines and tables from :mod:`pdf_reader` into regions, per-country prose
paragraphs (with citation markers), per-country table rows and the works-cited list. All
layout assumptions are checked; anything unexpected raises :class:`DocumentStructureError`.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

import pymupdf

from . import pdf_reader
from .text import marker, normalise_space, tidy

REGION_HEADING_SIZE = 18.0
COUNTRY_NAME_SIZE = 11.0
LEFT_MARGIN_X = 72.0
TABLE_HEADER = ["Country", "Name Etymology", "Flag Design", "National Symbol", "National Animal"]


class DocumentStructureError(RuntimeError):
    """The PDF does not have the structure the extractor relies on."""


@dataclass
class CountryProse:
    label: str  # bold name as printed, e.g. "Democratic Republic of the Congo (DRC)"
    region_heading: str
    text: str  # prose with ⟦n⟧ citation markers
    pages: list[int] = field(default_factory=list)


@dataclass
class CountryTableRow:
    label: str  # as printed in the table, e.g. "Congo (Rep.)"
    region_heading: str
    etymology: str
    flag_design: str
    national_symbol: str
    national_animal: str
    page: int


@dataclass
class RegionSection:
    heading: str
    description: str  # with ⟦n⟧ markers


@dataclass
class WorkCited:
    ref_no: int
    title: str
    url: str


@dataclass
class SymbologyDocument:
    title: str
    regions: list[RegionSection]
    prose: list[CountryProse]
    table_rows: list[CountryTableRow]
    works_cited: list[WorkCited]
    superscripts: list[str]  # every superscript span's text, for validation
    italic_texts: set[str]  # italic span texts (scientific names, foreign words)


def _line_text_with_markers(line: pdf_reader.Line, superscripts: list[str]) -> str:
    parts: list[str] = []
    for span in line.spans:
        if span.superscript and span.text.strip():
            value = span.text.strip()
            superscripts.append(value)
            if not value.isdigit():
                raise DocumentStructureError(
                    f"Non-numeric superscript {value!r} on page {span.page}"
                )
            parts.append(marker(int(value)))
        else:
            parts.append(span.text)
    return "".join(parts)


def _italic_runs(lines: list[pdf_reader.Line]) -> set[str]:
    """Texts of consecutive italic spans, joined across line breaks (a binomial such as
    "Loxodonta cyclotis" can wrap onto two lines as two italic spans)."""
    runs: set[str] = set()
    current: list[str] = []
    for line in lines:
        for span in line.spans:
            if span.italic:
                current.append(span.text)
            elif span.text.strip():
                if current:
                    runs.add(normalise_space(" ".join(current)))
                current = []
    if current:
        runs.add(normalise_space(" ".join(current)))
    return runs


def _join_lines(texts: list[str]) -> str:
    # PDF lines carry their own trailing spaces; a line ending in a hyphen without a space is a
    # wrapped compound ("Pan-" + "African") and is joined directly.
    out = ""
    for text in texts:
        if out.endswith("-") and not out.endswith(" -"):
            out += text.lstrip()
        else:
            out += (" " if out and not out.endswith(" ") else "") + text
    return normalise_space(out)


def _is_region_heading(line: pdf_reader.Line) -> bool:
    first = line.spans[0]
    return first.bold and first.size == REGION_HEADING_SIZE and bool(line.text.strip())


def _is_country_start(line: pdf_reader.Line) -> bool:
    first = line.spans[0]
    return (
        first.bold
        and first.size == COUNTRY_NAME_SIZE
        and abs(first.x - LEFT_MARGIN_X) < 1
        and bool(first.text.strip())
    )


def _parse_works_cited(doc: pymupdf.Document, lines: list[str]) -> list[WorkCited]:
    text = "\n".join(lines)
    entries = re.split(r"(?m)^\s*(\d+)\.\u200b?\s*", text)
    # re.split yields ['preamble', '1', 'entry', '2', 'entry', ...]
    link_uris = {
        str(link["uri"])
        for index in range(doc.page_count)
        for link in doc[index].get_links()
        if link.get("uri")
    }
    works: list[WorkCited] = []
    for number, body in zip(entries[1::2], entries[2::2], strict=True):
        url_at = body.find("http")
        if url_at < 0:
            raise DocumentStructureError(f"Work cited {number} has no URL")
        title = normalise_space(body[:url_at]).rstrip(", ").strip()
        url = "".join(body[url_at:].split())
        if url not in link_uris:
            raise DocumentStructureError(
                f"Work cited {number}: URL rebuilt from text ({url}) matches no link annotation"
            )
        works.append(WorkCited(ref_no=int(number), title=title, url=url))
    numbers = [w.ref_no for w in works]
    if numbers != list(range(1, len(numbers) + 1)):
        raise DocumentStructureError(f"Works cited are not numbered 1..n: {numbers}")
    return works


def _parse_tables(doc: pymupdf.Document, region_by_page: dict[int, str]) -> list[CountryTableRow]:
    raw_rows = pdf_reader.read_tables(doc)
    column_widths = [0.0] * len(TABLE_HEADER)
    for row in raw_rows:
        if len(row.cells) != len(TABLE_HEADER):
            raise DocumentStructureError(f"Table row on page {row.page} has {len(row.cells)} cells")
        for index, cell in enumerate(row.cells):
            for line in cell:
                column_widths[index] = max(column_widths[index], line.width)

    merged: list[pdf_reader.TableRow] = []
    for row in raw_rows:
        header = [pdf_reader.join_cell(c, column_widths[i]) for i, c in enumerate(row.cells)]
        if header == TABLE_HEADER:
            continue
        if not row.cells[0]:
            # Continuation of the previous row across a page break (e.g. Niger, pages 8-9).
            if not merged:
                raise DocumentStructureError(
                    f"Continuation row with no predecessor, page {row.page}"
                )
            for index, cell in enumerate(row.cells):
                merged[-1].cells[index].extend(cell)
            continue
        merged.append(pdf_reader.TableRow(page=row.page, cells=[list(c) for c in row.cells]))

    result: list[CountryTableRow] = []
    for row in merged:
        values = [pdf_reader.join_cell(c, column_widths[i]) for i, c in enumerate(row.cells)]
        result.append(
            CountryTableRow(
                label=values[0],
                region_heading=region_by_page[row.page],
                etymology=values[1],
                flag_design=values[2],
                national_symbol=values[3],
                national_animal=values[4],
                page=row.page,
            )
        )
    return result


def parse(path: Path) -> SymbologyDocument:
    doc = pdf_reader.open_pdf(path)
    lines = pdf_reader.read_lines(doc)
    superscripts: list[str] = []
    italic_texts = _italic_runs(lines)

    title = str(doc.metadata.get("title") or "") if doc.metadata else ""
    regions: list[RegionSection] = []
    prose: list[CountryProse] = []
    works_lines: list[str] = []
    region_by_page: dict[int, str] = {}

    mode = "intro"  # intro | region | country | conclusion | works
    current_region = ""
    region_text: list[str] = []
    country_text: list[str] = []

    def close_country() -> None:
        if prose and country_text:
            prose[-1].text = tidy(_join_lines(country_text))
        country_text.clear()

    def close_region_description() -> None:
        if mode == "region" and regions:
            regions[-1].description = tidy(_join_lines(region_text))
        region_text.clear()

    for line in lines:
        text = _line_text_with_markers(line, superscripts)
        if not text.strip():
            continue
        stripped = text.strip()
        if _is_region_heading(line):
            close_country()
            close_region_description()
            if stripped.startswith("Regional Analysis:"):
                mode = "region"
                current_region = stripped
                regions.append(RegionSection(heading=stripped, description=""))
            elif stripped.startswith("Conclusion"):
                mode = "conclusion"
            elif stripped.startswith(("Introduction", "State Symbology")):
                mode = "intro"
            continue
        if line.spans[0].bold and stripped.startswith("Works cited"):
            close_country()
            mode = "works"
            continue
        if mode in {"region", "country"} and _is_country_start(line):
            close_region_description() if mode == "region" else close_country()
            mode = "country"
            label = line.spans[0].text.strip()
            prose.append(CountryProse(label=label, region_heading=current_region, text=""))
            prose[-1].pages.append(line.page)
            country_text.append(text)
            continue
        if mode == "region":
            region_text.append(text)
            region_by_page.setdefault(line.page, current_region)
        elif mode == "country":
            country_text.append(text)
            if line.page not in prose[-1].pages:
                prose[-1].pages.append(line.page)
            region_by_page.setdefault(line.page, current_region)
        elif mode == "works":
            works_lines.append(stripped)
    close_country()

    # Table pages sit between a region heading and its first country; map them to the region.
    heading_pages = {
        line.page: line.text.strip()
        for line in lines
        if _is_region_heading(line) and line.text.strip().startswith("Regional Analysis:")
    }
    active = ""
    for page in range(1, doc.page_count + 1):
        active = heading_pages.get(page, active)
        if active:
            region_by_page.setdefault(page, active)

    return SymbologyDocument(
        title=title,
        regions=regions,
        prose=prose,
        table_rows=_parse_tables(doc, region_by_page),
        works_cited=_parse_works_cited(doc, works_lines),
        superscripts=superscripts,
        italic_texts=italic_texts,
    )
