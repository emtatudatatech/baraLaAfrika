from __future__ import annotations

import numpy as np
import pytest

from pipelines.africa_pipelines import colour

# Sharma, Wu & Dalal (2005) CIEDE2000 test data (subset).
SHARMA_PAIRS = [
    ((50, 2.6772, -79.7751), (50, 0, -82.7485), 2.0425),
    ((50, 0, 0), (50, -1, 2), 2.3669),
    ((50, 2.49, -0.001), (50, -2.49, 0.0009), 7.1792),
    ((50, 2.5, 0), (73, 25, -18), 27.1492),
    ((50, 2.5, 0), (58, 24, 15), 19.4535),
    ((50, 2.5, 0), (56, -27, -3), 31.9030),
]


@pytest.mark.parametrize(("lab1", "lab2", "expected"), SHARMA_PAIRS)
def test_ciede2000_matches_published_values(
    lab1: tuple[float, ...], lab2: tuple[float, ...], expected: float
) -> None:
    assert float(colour.ciede2000(lab1, lab2)) == pytest.approx(expected, abs=1e-4)
    assert float(colour.ciede2000(lab2, lab1)) == pytest.approx(expected, abs=1e-4)


def test_lab_of_reference_colours() -> None:
    white = colour.rgb_to_lab((255, 255, 255))
    assert white == pytest.approx([100.0, 0.0, 0.0], abs=1e-3)
    black = colour.rgb_to_lab((0, 0, 0))
    assert black == pytest.approx([0.0, 0.0, 0.0], abs=1e-6)
    assert float(colour.chroma(colour.rgb_to_lab((128, 128, 128)))) < 0.01


def test_hex_round_trip_and_contrast() -> None:
    assert colour.rgb_to_hex(colour.hex_to_rgb("#00a95c")) == "#00a95c"
    assert colour.contrast_ratio("#000000", "#ffffff") == pytest.approx(21.0)
    with pytest.raises(ValueError):
        colour.hex_to_rgb("#abc")


def test_cvd_simulation_keeps_neutrals_and_merges_red_green() -> None:
    for kind in colour.CVD_MATRICES:
        assert colour.simulate_cvd("#ffffff", kind) == "#ffffff"
        assert colour.simulate_cvd("#000000", kind) == "#000000"
    red, green = "#c1272d", "#009e49"
    assert colour.delta_e_hex(red, green) > 60
    simulated = colour.delta_e_hex(
        colour.simulate_cvd(red, "deuteranopia"), colour.simulate_cvd(green, "deuteranopia")
    )
    assert simulated < 20  # red/green confusion, as expected


def test_vectorised_ciede2000() -> None:
    first = np.array([[50, 2.5, 0], [50, 0, 0]], dtype=float)
    second = np.array([[73, 25, -18], [50, -1, 2]], dtype=float)
    assert colour.ciede2000(first, second) == pytest.approx([27.1492, 2.3669], abs=1e-4)
