"""Text helpers: whitespace normalisation, citation markers and sentence splitting."""

from __future__ import annotations

import re

# Citation markers inserted where a superscript reference numeral appeared.
MARKER_RE = re.compile(r"⟦(\d+)⟧")

_ABBREVIATIONS = ("St.", "Mt.", "Dr.", "Mr.", "Mrs.", "No.", "U.S.", "e.g.", "i.e.", "vs.", "c.")


def marker(ref_no: int) -> str:
    return f"⟦{ref_no}⟧"


def normalise_space(text: str) -> str:
    return " ".join(text.split())


def tidy(text: str) -> str:
    """Normalise whitespace and remove spaces before punctuation left by joined spans."""
    text = normalise_space(text)
    # Only true punctuation: "motto !ke e:/xarra //ke" keeps its space (the "!" is a click
    # consonant in the ǀXam motto), because that "!" is followed by a letter.
    text = re.sub(r"\s+([,.;:!?)\]])(?=\s|$|[\"”’⟦])", r"\1", text)
    text = re.sub(r"([(\[])\s+", r"\1", text)
    return text


def refs_in(text: str) -> list[int]:
    return [int(n) for n in MARKER_RE.findall(text)]


def strip_markers(text: str) -> str:
    return tidy(MARKER_RE.sub("", text))


def _move_markers_before_terminal_punctuation(text: str) -> str:
    # "end.⟦4⟧ Next" -> "end⟦4⟧. Next" so the reference stays with the sentence it supports.
    return re.sub(r"([.!?][\"”’]?)((?:⟦\d+⟧)+)", r"\2\1", text)


def split_sentences(text: str) -> list[str]:
    """Split prose into sentences, keeping citation markers inside their sentence."""
    text = _move_markers_before_terminal_punctuation(normalise_space(text))
    sentences: list[str] = []
    start = 0
    for match in re.finditer(r"[.!?][\"”’)]?(?:⟦\d+⟧)*\s+(?=[\"“‘(]?[A-Z0-9ÀÉÎÔÛÇ])", text):
        candidate = text[start : match.end()].strip()
        tail = text[start : match.start() + 1]
        if any(tail.endswith(abbr) for abbr in _ABBREVIATIONS):
            continue
        sentences.append(candidate)
        start = match.end()
    rest = text[start:].strip()
    if rest:
        sentences.append(rest)
    return sentences


# Citation numerals that escaped stripping look like digits glued to a word or punctuation
# ("Ptah4.") or a lone 1-2 digit number before punctuation ("of Ptah 4."). Legitimate numbers
# in the prose are years or are followed by a noun ("31 rays", "66 million").
_GLUED_RE = re.compile(r"(?<=[A-Za-z.,;:)\"”’])\d{1,2}(?=[\s.,;:)]|$)")
_LONE_RE = re.compile(r"(?<=\s)\d{1,2}(?=[.,;:](?:\s|$)|$)")


def leftover_citation_digits(text: str) -> list[str]:
    return _GLUED_RE.findall(text) + _LONE_RE.findall(text)
