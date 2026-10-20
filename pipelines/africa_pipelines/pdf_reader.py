"""Low-level reading of the research PDF with PyMuPDF.

Two products:

* a stream of prose *lines* (spans outside the summary tables), where superscript citation
  numerals are kept as separate, flagged spans so they can be turned into source references
  instead of leaking into the text (e.g. "mainland in 1525" + superscript "4", never "15254");
* the regional summary *tables*, read cell by cell with a geometry-based rule for re-joining
  words that the PDF wrapped mid-word (e.g. "Red/Black/Gre" + "en with").
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import pymupdf

# PyMuPDF span flag bits.
FLAG_SUPERSCRIPT = 1
FLAG_ITALIC = 2
FLAG_BOLD = 16

# A wrapped cell line is a mid-word break when it is a single token that (nearly) fills the
# column: the renderer only breaks inside a word that is wider than the cell. Measured on this
# PDF: mid-word breaks are 70-76pt wide, ordinary single words that wrapped are at most 64pt.
MID_WORD_TOLERANCE_PT = 7.0


@dataclass(frozen=True)
class Span:
    text: str
    page: int  # 1-based
    size: float
    x: float
    bold: bool
    italic: bool
    superscript: bool


@dataclass
class Line:
    spans: list[Span]

    @property
    def text(self) -> str:
        return "".join(s.text for s in self.spans)

    @property
    def page(self) -> int:
        return self.spans[0].page


@dataclass(frozen=True)
class CellLine:
    text: str
    token_count: int
    width: float


@dataclass
class TableRow:
    page: int
    cells: list[list[CellLine]] = field(default_factory=list)


def open_pdf(path: Path) -> pymupdf.Document:
    return pymupdf.open(path)


def _table_rects(page: pymupdf.Page) -> list[pymupdf.Rect]:
    return [pymupdf.Rect(t.bbox) for t in page.find_tables().tables]


def read_lines(doc: pymupdf.Document) -> list[Line]:
    """All text lines outside tables, in reading order, with span-level formatting."""
    lines: list[Line] = []
    for page_index in range(doc.page_count):
        page = doc[page_index]
        tables = _table_rects(page)
        for block in page.get_text("dict")["blocks"]:
            for raw_line in block.get("lines", []):
                spans: list[Span] = []
                for raw in raw_line["spans"]:
                    origin = pymupdf.Point(raw["origin"])
                    if any(rect.contains(origin) for rect in tables):
                        continue
                    flags = int(raw["flags"])
                    spans.append(
                        Span(
                            text=str(raw["text"]),
                            page=page_index + 1,
                            size=round(float(raw["size"]), 1),
                            x=float(raw["origin"][0]),
                            bold=bool(flags & FLAG_BOLD),
                            italic=bool(flags & FLAG_ITALIC),
                            superscript=bool(flags & FLAG_SUPERSCRIPT),
                        )
                    )
                if spans:
                    lines.append(Line(spans))
    return lines


def _cell_lines(page: pymupdf.Page, rect: pymupdf.Rect) -> list[CellLine]:
    words = page.get_text("words", clip=rect)
    grouped: dict[tuple[int, int], list[tuple[float, float, str]]] = {}
    for x0, _y0, x1, _y1, text, block_no, line_no, _word_no in words:
        grouped.setdefault((block_no, line_no), []).append((x0, x1, text))
    result: list[CellLine] = []
    for key in sorted(grouped):
        tokens = grouped[key]
        result.append(
            CellLine(
                text=" ".join(t for _, _, t in tokens),
                token_count=len(tokens),
                width=max(x1 for _, x1, _ in tokens) - min(x0 for x0, _, _ in tokens),
            )
        )
    return result


def read_tables(doc: pymupdf.Document) -> list[TableRow]:
    """Every row of every summary table, cells as lists of wrapped lines (header rows kept)."""
    rows: list[TableRow] = []
    for page_index in range(doc.page_count):
        page = doc[page_index]
        for table in page.find_tables().tables:
            for row in table.rows:
                cells = [
                    _cell_lines(page, pymupdf.Rect(cell)) if cell is not None else []
                    for cell in row.cells
                ]
                rows.append(TableRow(page=page_index + 1, cells=cells))
    return rows


def is_mid_word_break(line: CellLine, following: CellLine, column_width: float) -> bool:
    """True when `line` ends inside a word that continues on `following`."""
    if line.token_count != 1 or not line.text or not following.text:
        return False
    if line.width < column_width - MID_WORD_TOLERANCE_PT:
        return False
    last, first = line.text[-1], following.text[0]
    return (last.isalnum() or last in "/-") and (first.isalnum() or first == ")")


def join_cell(lines: list[CellLine], column_width: float) -> str:
    """Re-join a cell's wrapped lines into one string, healing mid-word breaks."""
    text = ""
    for index, line in enumerate(lines):
        if index == 0:
            text = line.text
            continue
        glue = "" if is_mid_word_break(lines[index - 1], line, column_width) else " "
        text += glue + line.text
    return " ".join(text.split())
