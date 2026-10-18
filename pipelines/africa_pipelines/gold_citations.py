"""Curated gold citations: every override and profile note quotes its source exactly, and each
run re-checks the quote against the source's text (as the Harim curation does).

Sources are fetched once and cached under data/raw/gold/citations/ (HTML pages, PDF reports and
.xlsx tables are all read as text). Comparison ignores case, punctuation and spacing, so PDF line
breaks, hyphenation and typographic quotes do not matter, but every word must be there in order.
A quote that is not found stops the run (the source changed, or the quote is wrong); a source
that cannot be fetched marks the entry for review instead, so an outage never deletes a note.
"""

from __future__ import annotations

import hashlib
import html
import io
import re
import warnings
from dataclasses import dataclass
from typing import Any

import openpyxl
import pymupdf

from .gold_common import GOLD_RAW
from .http import FetchError, fetch_bytes

CACHE_DIR = GOLD_RAW / "citations"


def source_key(url: str) -> str:
    """A stable key for a cited URL, so several notes citing one report share one source row."""
    return "cite-" + hashlib.sha256(url.encode()).hexdigest()[:12]


def normalise(text: str) -> str:
    return re.sub(r"[^0-9a-z]", "", text.lower())


def document_text(body: bytes) -> str:
    if body[:4] == b"%PDF":
        with pymupdf.open(stream=body, filetype="pdf") as document:
            return " ".join(page.get_text() for page in document)
    if body[:2] == b"PK":
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            book = openpyxl.load_workbook(io.BytesIO(body), read_only=True, data_only=True)
            return " ".join(
                str(cell)
                for sheet in book.worksheets
                for row in sheet.iter_rows(values_only=True)
                for cell in row
                if cell is not None
            )
    page = body.decode("utf-8", errors="replace")
    page = re.sub(r"(?is)<(script|style|noscript)\b.*?</\1>", " ", page)
    return html.unescape(re.sub(r"<[^>]+>", " ", page))


@dataclass(frozen=True)
class Check:
    found: bool | None  # None when the source could not be fetched
    detail: str = ""


class Checker:
    """Fetches each cited source once per run and checks quotes against it."""

    def __init__(self, *, refresh: bool = False) -> None:
        self.refresh = refresh
        self._texts: dict[str, str | None] = {}
        self._errors: dict[str, str] = {}

    def text(self, url: str) -> str | None:
        if url not in self._texts:
            try:
                body = fetch_bytes(url, CACHE_DIR / f"{source_key(url)}.bin",
                                   refresh=self.refresh, timeout=120)  # fmt: skip
                self._texts[url] = normalise(document_text(body))
            except FetchError as error:
                self._texts[url] = None
                self._errors[url] = str(error)
        return self._texts[url]

    def check(self, url: str, quote: str) -> Check:
        text = self.text(url)
        if text is None:
            return Check(None, self._errors.get(url, "not fetched"))
        return Check(normalise(quote) in text)


def source_row(source: dict[str, Any], default_tier: str) -> dict[str, Any]:
    return {
        "source_key": source_key(source["url"]),
        "ref_no": None,
        "title": source["title"],
        "url": source["url"],
        "source_type": source.get("source_type", "report"),
        "reliability_tier": source.get("reliability_tier", default_tier),
    }
