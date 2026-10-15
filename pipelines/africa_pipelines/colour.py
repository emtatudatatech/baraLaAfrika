"""Colour science helpers: sRGB ↔ CIELAB (D65), CIEDE2000, chroma, contrast and
colour-vision-deficiency simulation. Vectorised with numpy; no other dependencies."""

from __future__ import annotations

import numpy as np
import numpy.typing as npt

FloatArray = npt.NDArray[np.float64]

# D65 reference white (CIE 1931 2° observer), XYZ scaled to Y = 1.
_WHITE_D65 = np.array([0.95047, 1.0, 1.08883])
_RGB_TO_XYZ = np.array(
    [
        [0.4124564, 0.3575761, 0.1804375],
        [0.2126729, 0.7151522, 0.0721750],
        [0.0193339, 0.1191920, 0.9503041],
    ]
)
_XYZ_TO_RGB = np.linalg.inv(_RGB_TO_XYZ)
_EPSILON = 216 / 24389
_KAPPA = 24389 / 27


def hex_to_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    if len(value) != 6:
        raise ValueError(f"Expected #rrggbb, got {value!r}")
    return int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16)


def rgb_to_hex(rgb: tuple[int, int, int] | npt.ArrayLike) -> str:
    r, g, b = (round(float(c)) for c in np.asarray(rgb).reshape(3))
    return f"#{r:02x}{g:02x}{b:02x}"


def srgb_to_linear(rgb255: npt.ArrayLike) -> FloatArray:
    c = np.asarray(rgb255, dtype=np.float64) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(linear: npt.ArrayLike) -> FloatArray:
    c = np.clip(np.asarray(linear, dtype=np.float64), 0.0, 1.0)
    out = np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)
    return np.asarray(out * 255.0, dtype=np.float64)


def rgb_to_lab(rgb255: npt.ArrayLike) -> FloatArray:
    """sRGB (0-255, shape (..., 3)) → CIELAB (L*, a*, b*), D65."""
    xyz = srgb_to_linear(rgb255) @ _RGB_TO_XYZ.T / _WHITE_D65
    f = np.where(xyz > _EPSILON, np.cbrt(xyz), (_KAPPA * xyz + 16) / 116)
    lightness = 116 * f[..., 1] - 16
    a = 500 * (f[..., 0] - f[..., 1])
    b = 200 * (f[..., 1] - f[..., 2])
    return np.stack([lightness, a, b], axis=-1)


def chroma(lab: npt.ArrayLike) -> FloatArray:
    lab = np.asarray(lab, dtype=np.float64)
    return np.asarray(np.hypot(lab[..., 1], lab[..., 2]), dtype=np.float64)


def ciede2000(lab1: npt.ArrayLike, lab2: npt.ArrayLike) -> FloatArray:
    """CIEDE2000 colour difference (kL = kC = kH = 1), Sharma, Wu & Dalal (2005)."""
    l1, a1, b1 = np.moveaxis(np.asarray(lab1, dtype=np.float64), -1, 0)
    l2, a2, b2 = np.moveaxis(np.asarray(lab2, dtype=np.float64), -1, 0)

    c1 = np.hypot(a1, b1)
    c2 = np.hypot(a2, b2)
    c_mean = (c1 + c2) / 2
    g = 0.5 * (1 - np.sqrt(c_mean**7 / (c_mean**7 + 25.0**7)))
    a1p = (1 + g) * a1
    a2p = (1 + g) * a2
    c1p = np.hypot(a1p, b1)
    c2p = np.hypot(a2p, b2)
    h1p = np.degrees(np.arctan2(b1, a1p)) % 360
    h2p = np.degrees(np.arctan2(b2, a2p)) % 360
    h1p = np.where((a1p == 0) & (b1 == 0), 0.0, h1p)
    h2p = np.where((a2p == 0) & (b2 == 0), 0.0, h2p)

    delta_lp = l2 - l1
    delta_cp = c2p - c1p
    zero_chroma = (c1p * c2p) == 0
    dh = h2p - h1p
    dh = np.where(dh > 180, dh - 360, np.where(dh < -180, dh + 360, dh))
    dh = np.where(zero_chroma, 0.0, dh)
    delta_hp = 2 * np.sqrt(c1p * c2p) * np.sin(np.radians(dh) / 2)

    lp_mean = (l1 + l2) / 2
    cp_mean = (c1p + c2p) / 2
    h_sum = h1p + h2p
    hp_mean = np.where(
        zero_chroma,
        h_sum,
        np.where(
            np.abs(h1p - h2p) <= 180,
            h_sum / 2,
            np.where(h_sum < 360, (h_sum + 360) / 2, (h_sum - 360) / 2),
        ),
    )
    t = (
        1
        - 0.17 * np.cos(np.radians(hp_mean - 30))
        + 0.24 * np.cos(np.radians(2 * hp_mean))
        + 0.32 * np.cos(np.radians(3 * hp_mean + 6))
        - 0.20 * np.cos(np.radians(4 * hp_mean - 63))
    )
    delta_theta = 30 * np.exp(-(((hp_mean - 275) / 25) ** 2))
    r_c = 2 * np.sqrt(cp_mean**7 / (cp_mean**7 + 25.0**7))
    s_l = 1 + (0.015 * (lp_mean - 50) ** 2) / np.sqrt(20 + (lp_mean - 50) ** 2)
    s_c = 1 + 0.045 * cp_mean
    s_h = 1 + 0.015 * cp_mean * t
    r_t = -np.sin(np.radians(2 * delta_theta)) * r_c

    return np.asarray(
        np.sqrt(
            (delta_lp / s_l) ** 2
            + (delta_cp / s_c) ** 2
            + (delta_hp / s_h) ** 2
            + r_t * (delta_cp / s_c) * (delta_hp / s_h)
        ),
        dtype=np.float64,
    )


def delta_e_hex(first: str, second: str) -> float:
    return float(ciede2000(rgb_to_lab(hex_to_rgb(first)), rgb_to_lab(hex_to_rgb(second))))


def relative_luminance(hex_value: str) -> float:
    linear = srgb_to_linear(hex_to_rgb(hex_value))
    return float(linear @ np.array([0.2126, 0.7152, 0.0722]))


def contrast_ratio(first: str, second: str) -> float:
    """WCAG 2.x contrast ratio between two colours."""
    l1, l2 = sorted((relative_luminance(first), relative_luminance(second)), reverse=True)
    return (l1 + 0.05) / (l2 + 0.05)


# Machado, Oliveira & Fernandes (2009) simulation matrices, severity 1.0, in linear RGB.
CVD_MATRICES: dict[str, FloatArray] = {
    "protanopia": np.array(
        [
            [0.152286, 1.052583, -0.204868],
            [0.114503, 0.786281, 0.099216],
            [-0.003882, -0.048116, 1.051998],
        ]
    ),
    "deuteranopia": np.array(
        [
            [0.367322, 0.860646, -0.227968],
            [0.280085, 0.672501, 0.047413],
            [-0.011820, 0.042940, 0.968881],
        ]
    ),
    "tritanopia": np.array(
        [
            [1.255528, -0.076749, -0.178779],
            [-0.078411, 0.930809, 0.147602],
            [0.004733, 0.691367, 0.303900],
        ]
    ),
}


def simulate_cvd(hex_value: str, kind: str) -> str:
    """How a colour appears with the given colour-vision deficiency (full severity)."""
    linear = srgb_to_linear(hex_to_rgb(hex_value))
    return rgb_to_hex(linear_to_srgb(CVD_MATRICES[kind] @ linear))
