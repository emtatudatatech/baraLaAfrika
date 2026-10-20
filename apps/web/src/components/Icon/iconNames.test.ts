import { describe, expect, it } from 'vitest';

import lock from './icon-subset.lock.json';
import { ICON_NAMES } from './iconNames';

const sources = import.meta.glob<string>('../../**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
});

describe('icon subset', () => {
  it('is up to date with ICON_NAMES (re-run scripts/build_icon_font.py if this fails)', () => {
    expect(lock.names).toEqual([...ICON_NAMES]);
  });

  it('keeps ICON_NAMES sorted and unique', () => {
    expect([...ICON_NAMES]).toEqual([...new Set(ICON_NAMES)].sort());
  });

  it('covers every literal icon name used in components', () => {
    const used = new Set<string>();
    for (const source of Object.values(sources)) {
      const patterns = [
        /<Icon\b[^>]*?\bname="([a-z0-9_]+)"/g,
        /\bicon="([a-z0-9_]+)"/g,
        /\bicon: '([a-z0-9_]+)'/g,
      ];
      for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) used.add(match[1] ?? '');
      }
    }
    const known = new Set<string>(ICON_NAMES);
    expect([...used].filter((name) => !known.has(name))).toEqual([]);
  });
});
