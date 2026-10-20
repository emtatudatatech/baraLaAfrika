from __future__ import annotations

from pipelines.africa_pipelines.text import (
    leftover_citation_digits,
    marker,
    refs_in,
    split_sentences,
    strip_markers,
    tidy,
)


def test_citation_markers_never_merge_with_years() -> None:
    text = f"joined to the mainland in 1525{marker(4)}. The flag"
    assert strip_markers(text) == "joined to the mainland in 1525. The flag"
    assert refs_in(text) == [4]


def test_sentences_keep_their_citations() -> None:
    text = f"First claim{marker(3)}. Second claim.{marker(18)} Third, with “quotes.” Fourth."
    sentences = split_sentences(text)
    assert len(sentences) == 4
    assert refs_in(sentences[0]) == [3]
    assert refs_in(sentences[1]) == [18]  # marker after the period moves into its sentence


def test_split_ignores_abbreviations_and_lowercase_continuations() -> None:
    assert split_sentences("Saints (St. Thomas) arrived. Then e.g. this went on.") == [
        "Saints (St. Thomas) arrived.",
        "Then e.g. this went on.",
    ]


def test_tidy_keeps_click_consonants() -> None:
    assert tidy("the motto !ke e:/xarra //ke in") == "the motto !ke e:/xarra //ke in"
    assert tidy("word , next ( inner ) end .") == "word, next (inner) end."


def test_leftover_citation_digits() -> None:
    assert leftover_citation_digits("the cult of Ptah4. Next") == ["4"]
    assert leftover_citation_digits("the cult of Ptah 4. Next") == ["4"]
    assert leftover_citation_digits("a sun with 31 rays, adopted in 1996, AK-47 rifle") == []
