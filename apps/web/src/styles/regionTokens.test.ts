import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DARK_MAP_BACKGROUND, darkThemePalette } from '../lib/colour';

// Vitest runs from the repo root.
const tokens = readFileSync(resolve(process.cwd(), 'apps/web/src/styles/tokens.css'), 'utf8');
const approval = JSON.parse(
  readFileSync(
    resolve(process.cwd(), 'pipelines/africa_pipelines/reference/region_colors_approval.json'),
    'utf8',
  ),
) as { colors: Record<string, string> };

function fallbacks(variant: 'light' | 'dark'): Record<string, string> {
  return Object.fromEntries(
    [
      ...tokens.matchAll(
        new RegExp(`--region-(\\w+): var\\(--region-\\w+-${variant}, (#[0-9a-f]{6})\\)`, 'g'),
      ),
    ].map((m) => [m[1], m[2]]),
  ) as Record<string, string>;
}

describe('region colour tokens', () => {
  it('use the approved colours as light-theme fallbacks', () => {
    expect(fallbacks('light')).toEqual(approval.colors);
  });

  it('use darkThemePalette() of the approved colours as dark-theme fallbacks', () => {
    expect(fallbacks('dark')).toEqual(darkThemePalette(approval.colors));
  });

  it('compute the dark palette against the dark map ocean token', () => {
    expect(tokens).toContain(`--map-ocean: ${DARK_MAP_BACKGROUND};`);
  });
});
