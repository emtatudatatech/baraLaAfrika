import { describe, expect, it } from 'vitest';

import { strings } from './strings';

describe('strings', () => {
  it('describes a peak page exactly as its build-time page shell does', () => {
    // apps/web/build/pageShells.ts writes the same sentence for link previews.
    expect(strings.harim.peakPage.description('Mount Kenya', '5,199 m', 'Kenya')).toBe(
      'Mount Kenya (5,199 m) in Kenya: height, sources, names and nearby peaks.',
    );
  });
});
