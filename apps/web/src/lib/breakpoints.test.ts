import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BREAKPOINTS } from './breakpoints';

// Read from disk: Vitest does not process CSS, so a `?raw` import of a .css file is empty.
// Vitest runs from the repo root (jsdom's import.meta.url is not a file: URL).
const mediaCss = readFileSync(resolve(process.cwd(), 'apps/web/src/styles/media.css'), 'utf8');

describe('breakpoints', () => {
  it('match the @custom-media tokens in media.css', () => {
    const fromCss: Record<string, number> = {};
    for (const match of mediaCss.matchAll(/@custom-media --bp-([a-z0-9]+) \(width >= (\d+)px\)/g)) {
      fromCss[match[1] ?? ''] = Number(match[2]);
    }
    expect(fromCss).toEqual(BREAKPOINTS);
  });
});
