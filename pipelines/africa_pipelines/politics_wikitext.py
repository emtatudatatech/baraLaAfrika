"""Readers for the two Wikipedia lists behind Vinara's leaders and elections:
"List of current heads of state and government" and "List of next general elections".

Both are read as wikitext. Only what the site needs is kept: per country, each office holder's
title and name (and whether the list marks the office as holding executive power), and the
last and next legislative and presidential elections with their dates.
"""

from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass

# ── Wikitext helpers ─────────────────────────────────────────────────────────

COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)
REF_RE = re.compile(r"<ref[^>/]*/>|<ref[^>]*>.*?</ref>", re.DOTALL)
LINK_RE = re.compile(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]")


def _matching_close(text: str, start: int) -> int:
    """Index just after the `}}` closing the template that opens at `start`."""
    depth = 0
    i = start
    while i < len(text) - 1:
        pair = text[i : i + 2]
        if pair == "{{":
            depth += 1
            i += 2
        elif pair == "}}":
            depth -= 1
            i += 2
            if depth == 0:
                return i
        else:
            i += 1
    return len(text)


def remove_templates(text: str, names: tuple[str, ...]) -> str:
    """Drop whole templates by name (footnotes and the like), however deeply nested."""
    pattern = re.compile(r"\{\{\s*(" + "|".join(re.escape(n) for n in names) + r")\b", re.I)
    while (match := pattern.search(text)) is not None:
        text = text[: match.start()] + text[_matching_close(text, match.start()) :]
    return text


def clean(text: str) -> str:
    text = COMMENT_RE.sub("", text)
    text = REF_RE.sub("", text)
    return remove_templates(text, ("efn", "refn", "cite", "sfn", "Collapsible list"))


def unwrap(text: str) -> str:
    """Strip wrapper templates ({{success |align=left |…}}, {{small|…}}) to their content."""
    previous = None
    while previous != text:
        previous = text
        text = re.sub(
            r"\{\{\s*(?:success|operational|small|smalldiv|nowrap)\s*"
            r"((?:\|\s*(?:align|1)\s*=[^|{}]*)*)\|((?:[^{}]|\{\{[^{}]*\}\})*)\}\}",
            r"\2",
            text,
        )
    return text.strip()


def plain(text: str) -> str:
    """Links to their display text, remaining markup dropped, spaces tidied."""
    text = LINK_RE.sub(lambda m: m.group(2) or m.group(1), text)
    text = re.sub(r"'''?|\{\{[^{}]*\}\}", "", text)
    return re.sub(r"\s+", " ", text).strip()


def flag_name(line: str) -> str | None:
    match = re.search(r"\{\{\s*flag\s*\|([^}|]+)", line, re.I)
    return match.group(1).strip() if match else None


# ── Leaders ──────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Office:
    """One cell of the leaders list: an office and its holder."""

    row: int  # 0 = the country's first row; sub-rows (rowspan) follow
    column: int  # 0 = head of state, 1 = head of government (in the first row)
    both: bool  # the cell spans both columns (one person is both)
    executive: bool  # green: the office constitutionally holds executive power
    de_facto: bool  # blue: the de facto executive without de jure power
    provisional: bool  # small font: acting, interim or transitional
    title: str
    person: str | None
    article: str | None  # the person's Wikipedia article, when linked


def _office(cell: str, row: int, column: int) -> Office:
    both = "colspan=2" in cell.replace(" ", "")
    executive = re.search(r"\{\{\s*success", cell) is not None
    de_facto = re.search(r"\{\{\s*operational", cell) is not None
    provisional = re.search(r"\{\{\s*small", cell) is not None
    body = re.sub(r"^\|\s*(?:(?:colspan|rowspan)=\d+\s*)*\|?", "", cell).strip()
    body = unwrap(body)
    if " – " in body:
        title_part, person_part = body.split(" – ", 1)
    else:
        # "[[Abdel Fattah al-Burhan]] (President)", or a collective body with no person.
        match = re.match(r"(\[\[[^\]]+\]\])\s*\(([^)]+)\)", body)
        title_part, person_part = (match.group(2), match.group(1)) if match else (body, "")
    link = LINK_RE.search(person_part)
    person = plain(person_part) or None
    return Office(
        row=row,
        column=column,
        both=both,
        executive=executive,
        de_facto=de_facto,
        provisional=provisional,
        title=plain(title_part),
        person=person,
        article=link.group(1).strip() if link and person else None,
    )


def parse_leaders(wikitext: str, names: set[str]) -> dict[str, list[Office]]:
    """Offices per country (by its name in the list) for the countries asked for. Only the
    first table (UN member states) is read, so rival governments listed further down are not
    mixed in."""
    text = clean(wikitext)
    table_end = text.find("\n|}", text.find("{{flag"))
    lines = text[:table_end].split("\n")
    result: dict[str, list[Office]] = {}
    current: str | None = None
    row = 0
    column = 0
    for line in lines:
        if line.startswith("!"):
            name = flag_name(line)
            current = name if name in names else None
            row, column = 0, 0
            if current is not None:
                result[current] = []
            continue
        if current is None:
            continue
        if line.startswith("|-"):
            row += 1
            column = 0
            continue
        if line.startswith("|") and not line.startswith("|}"):
            office = _office(line, row, column)
            if office.title or office.person:
                result[current].append(office)
            column += 2 if office.both else 1
    return result


# ── Elections ────────────────────────────────────────────────────────────────

MONTHS = {
    name: index
    for index, names in enumerate(
        (
            ("jan", "january"),
            ("feb", "february"),
            ("mar", "march"),
            ("apr", "april"),
            ("may",),
            ("jun", "june"),
            ("jul", "july"),
            ("aug", "august"),
            ("sep", "sept", "september"),
            ("oct", "october"),
            ("nov", "november"),
            ("dec", "december"),
        ),
        start=1,
    )
    for name in names
}


@dataclass(frozen=True)
class ElectionDate:
    """A date as the list gives it: a day, or only a month or a year (then the latest
    possible date, by the list's own convention)."""

    year: int
    month: int | None
    day: int | None

    @property
    def precision(self) -> str:
        return "day" if self.day else "month" if self.month else "year"

    def date(self) -> dt.date:
        """The date itself, or the last day of its month or year."""
        if self.day and self.month:
            return dt.date(self.year, self.month, self.day)
        if self.month:
            following = dt.date(self.year + self.month // 12, self.month % 12 + 1, 1)
            return following - dt.timedelta(days=1)
        return dt.date(self.year, 12, 31)


def parse_dts(text: str) -> ElectionDate | None:
    match = re.search(r"\{\{\s*dts\s*\|([^}]+)\}\}", text)
    if match is None:
        return None
    parts = [p.strip() for p in re.split(r"[\s|]+", match.group(1)) if p.strip()]
    day = month = None
    year = None
    for part in parts:
        if part.isdigit() and len(part) == 4:
            year = int(part)
        elif part.isdigit():
            day = int(part)
        elif part.lower().rstrip(".") in MONTHS:
            month = MONTHS[part.lower().rstrip(".")]
    if year is None:
        return None
    return ElectionDate(year, month, day if month else None)


@dataclass(frozen=True)
class ElectionCell:
    text: str  # the cell's wikitext, for the review report
    date: ElectionDate | None
    article: str | None
    applicable: bool  # False for "n/a" (no such election)


@dataclass(frozen=True)
class ElectionRow:
    legislative_last: ElectionCell
    legislative_next: ElectionCell
    presidential_last: ElectionCell
    presidential_next: ElectionCell
    note: str  # the list's fairness / remarks cell


def _cell(text: str) -> ElectionCell:
    body = text.lstrip("|").strip()
    link = LINK_RE.search(body)
    return ElectionCell(
        text=body,
        date=parse_dts(body),
        article=link.group(1).strip() if link else None,
        applicable="n/a" not in body,
    )


NOT_APPLICABLE = ElectionCell("{{n/a}}", None, None, applicable=False)


def parse_elections(wikitext: str, names: set[str]) -> dict[str, ElectionRow]:
    """The Africa table: per country, legislative (term, last, next) and presidential (term,
    last, next); `colspan=3 {{n/a}}` marks a country without that election."""
    text = clean(wikitext)
    start = text.index("===Africa===")
    body = text[start : text.index("\n|}", start)]
    rows: dict[str, ElectionRow] = {}
    for block in body.split("\n|-\n"):
        cells = [c for c in block.split("\n") if c.startswith("|") and not c.startswith("|-")]
        if not cells:
            continue
        name = flag_name(cells[0])
        if name not in names:
            continue
        expanded: list[ElectionCell | None] = []
        for cell in cells[1:]:
            if re.match(r"\|\s*colspan=3", cell):
                expanded += [None, NOT_APPLICABLE, NOT_APPLICABLE]
            else:
                expanded.append(_cell(cell))
        legislative = expanded[0:3]
        presidential = expanded[3:6]
        note = plain(cells[7].lstrip("|")) if len(cells) > 7 else ""
        rows[name] = ElectionRow(
            legislative_last=legislative[1] or NOT_APPLICABLE,
            legislative_next=legislative[2] or NOT_APPLICABLE,
            presidential_last=presidential[1] or NOT_APPLICABLE,
            presidential_next=presidential[2] or NOT_APPLICABLE,
            note=note,
        )
    return rows
