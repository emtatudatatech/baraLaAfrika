/*
 * sRGB ↔ OKLCH conversion (Björn Ottosson's OKLab) for theme-aware region colours: the dark
 * theme may lift a colour's lightness for contrast but never changes its hue (spec §7.1).
 */

export interface Oklch {
  l: number;
  c: number;
  h: number;
}

function toLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function fromLinear(value: number): number {
  const v = value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
  return v * 255;
}

export function hexToRgb(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match?.[1]) throw new Error(`Expected #rrggbb, got ${hex}`);
  const value = parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b]
    .map((channel) =>
      Math.round(Math.min(255, Math.max(0, channel)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

export function hexToOklch(hex: string): Oklch {
  const [r, g, b] = hexToRgb(hex).map(toLinear) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const hue = (Math.atan2(B, A) * 180) / Math.PI;
  return { l: L, c: Math.hypot(A, B), h: hue < 0 ? hue + 360 : hue };
}

/** Linear-light sRGB for an OKLCH colour (may be outside 0–1 when out of gamut). */
function oklchToLinear({ l: L, c, h }: Oklch): [number, number, number] {
  const A = c * Math.cos((h * Math.PI) / 180);
  const B = c * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function oklchToHex(colour: Oklch): string {
  return rgbToHex(oklchToLinear(colour).map(fromLinear) as [number, number, number]);
}

const inGamut = (rgb: [number, number, number]) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

/** CIELAB (D65) from sRGB hex, for CIEDE2000. */
export function hexToLab(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map(toLinear) as [number, number, number];
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (radians: number) => (radians * 180) / Math.PI;

/** CIEDE2000 colour difference (Sharma, Wu & Dalal 2005), kL = kC = kH = 1. */
export function ciede2000(
  [l1, a1, b1]: [number, number, number],
  [l2, a2, b2]: [number, number, number],
): number {
  const cMean = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const g = 0.5 * (1 - Math.sqrt(cMean ** 7 / (cMean ** 7 + 25 ** 7)));
  const a1p = (1 + g) * a1;
  const a2p = (1 + g) * a2;
  const c1p = Math.hypot(a1p, b1);
  const c2p = Math.hypot(a2p, b2);
  const h1p = a1p === 0 && b1 === 0 ? 0 : (deg(Math.atan2(b1, a1p)) + 360) % 360;
  const h2p = a2p === 0 && b2 === 0 ? 0 : (deg(Math.atan2(b2, a2p)) + 360) % 360;
  const zeroChroma = c1p * c2p === 0;
  let dh = h2p - h1p;
  if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  if (zeroChroma) dh = 0;
  const deltaLp = l2 - l1;
  const deltaCp = c2p - c1p;
  const deltaHp = 2 * Math.sqrt(c1p * c2p) * Math.sin(rad(dh) / 2);
  const lpMean = (l1 + l2) / 2;
  const cpMean = (c1p + c2p) / 2;
  const hSum = h1p + h2p;
  const hpMean = zeroChroma
    ? hSum
    : Math.abs(h1p - h2p) <= 180
      ? hSum / 2
      : hSum < 360
        ? (hSum + 360) / 2
        : (hSum - 360) / 2;
  const t =
    1 -
    0.17 * Math.cos(rad(hpMean - 30)) +
    0.24 * Math.cos(rad(2 * hpMean)) +
    0.32 * Math.cos(rad(3 * hpMean + 6)) -
    0.2 * Math.cos(rad(4 * hpMean - 63));
  const deltaTheta = 30 * Math.exp(-(((hpMean - 275) / 25) ** 2));
  const rC = 2 * Math.sqrt(cpMean ** 7 / (cpMean ** 7 + 25 ** 7));
  const sL = 1 + (0.015 * (lpMean - 50) ** 2) / Math.sqrt(20 + (lpMean - 50) ** 2);
  const sC = 1 + 0.045 * cpMean;
  const sH = 1 + 0.015 * cpMean * t;
  const rT = -Math.sin(rad(2 * deltaTheta)) * rC;
  return Math.sqrt(
    (deltaLp / sL) ** 2 +
      (deltaCp / sC) ** 2 +
      (deltaHp / sH) ** 2 +
      rT * (deltaCp / sC) * (deltaHp / sH),
  );
}

export function deltaE(first: string, second: string): number {
  return ciede2000(hexToLab(first), hexToLab(second));
}

/** The colour at OKLCH lightness `lightness`, same hue, chroma reduced only to fit sRGB. */
export function withLightness(hex: string, lightness: number): string {
  const colour = { ...hexToOklch(hex), l: lightness };
  while (colour.c > 0 && !inGamut(oklchToLinear(colour))) colour.c -= 0.002;
  return oklchToHex({ ...colour, c: Math.max(0, colour.c) });
}

/** The dark theme's map ocean (--map-ocean in tokens.css): fills must reach 3:1 against it. */
export const DARK_MAP_BACKGROUND = '#0f1520';
export const MIN_FILL_CONTRAST = 3; // WCAG 1.4.11 non-text contrast
export const MIN_REGION_DELTA_E = 30; // same distinctness bar as the region colour report
const MAX_LIGHTNESS = 0.85;

/**
 * Dark-theme region colours. Hue never changes (spec §7.1):
 * 1. a colour under 3:1 against the dark map background is lifted just enough to reach it;
 * 2. while two regions are closer than ΔE 30, the lighter of the pair is lifted a little.
 */
export function darkThemePalette(
  colours: Readonly<Record<string, string>>,
  background = DARK_MAP_BACKGROUND,
): Record<string, string> {
  const keys = Object.keys(colours).sort();
  const out: Record<string, string> = {};
  const colourOf = (key: string) => out[key] ?? '#000000';
  for (const key of keys) {
    const hex = (colours[key] ?? '#000000').toLowerCase();
    if (contrastRatio(hex, background) >= MIN_FILL_CONTRAST) {
      out[key] = hex;
      continue;
    }
    let low = hexToOklch(hex).l;
    let high = MAX_LIGHTNESS;
    for (let i = 0; i < 30; i += 1) {
      const mid = (low + high) / 2;
      if (contrastRatio(withLightness(hex, mid), background) >= MIN_FILL_CONTRAST) high = mid;
      else low = mid;
    }
    out[key] = withLightness(hex, high);
  }
  for (let guard = 0; guard < 200; guard += 1) {
    let closest: [string, string, number] | null = null;
    for (const [i, a] of keys.entries()) {
      for (const b of keys.slice(i + 1)) {
        const distance = deltaE(colourOf(a), colourOf(b));
        if (distance < MIN_REGION_DELTA_E && (!closest || distance < closest[2])) {
          closest = [a, b, distance];
        }
      }
    }
    if (!closest) break;
    const [a, b] = closest;
    const lighter = hexToOklch(colourOf(a)).l >= hexToOklch(colourOf(b)).l ? a : b;
    const next = Math.min(MAX_LIGHTNESS, hexToOklch(colourOf(lighter)).l + 0.01);
    if (next === MAX_LIGHTNESS) break; // cannot separate further without changing hue
    out[lighter] = withLightness(colourOf(lighter), next);
  }
  return out;
}

/** WCAG relative luminance and contrast ratio. */
export function contrastRatio(first: string, second: string): number {
  const luminance = (hex: string) => {
    const [r, g, b] = hexToRgb(hex).map(toLinear) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [high, low] = [luminance(first), luminance(second)].sort((a, b) => b - a) as [
    number,
    number,
  ];
  return (high + 0.05) / (low + 0.05);
}
