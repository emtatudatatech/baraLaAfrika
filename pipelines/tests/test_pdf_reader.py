from __future__ import annotations

from pipelines.africa_pipelines.pdf_reader import CellLine, is_mid_word_break, join_cell

COLUMN = 76.0  # widest line observed in the column


def line(text: str, width: float) -> CellLine:
    return CellLine(text=text, token_count=len(text.split()), width=width)


def test_heals_a_word_broken_mid_way() -> None:
    assert join_cell(
        [line("Red/Black/Gre", 71), line("en with", 36), line("Crescent", 45)], COLUMN
    ) == ("Red/Black/Green with Crescent")
    assert join_cell([line("Guinea-Bissa", 70), line("u", 7)], 70) == "Guinea-Bissau"


def test_keeps_a_normal_wrap_at_a_space() -> None:
    # A single full word that wrapped normally does not fill the cell width.
    assert join_cell([line("Green/White", 64), line("with Crescent", 69)], COLUMN) == (
        "Green/White with Crescent"
    )
    assert join_cell(
        [line("Carthaginian", 63), line("Galley/Lion/Bal", 72), line("ance", 24)], COLUMN
    ) == ("Carthaginian Galley/Lion/Balance")


def test_multi_token_lines_always_wrap_at_a_space() -> None:
    assert (
        join_cell([line("Fennec Fox (De", 76), line("Facto)", 31)], COLUMN)
        == "Fennec Fox (De Facto)"
    )


def test_joins_after_a_slash_and_before_a_closing_parenthesis() -> None:
    assert join_cell([line("Orange/White/", 73), line("Green + Sun", 61)], COLUMN) == (
        "Orange/White/Green + Sun"
    )
    assert join_cell(
        [line("Saints (St.", 48), line("Thomas/Prince", 73), line(")", 4)], COLUMN
    ) == ("Saints (St. Thomas/Prince)")


def test_is_mid_word_break_needs_alphanumeric_continuation() -> None:
    assert not is_mid_word_break(line("Pan-African", 76), line("+ Star", 30), COLUMN)
