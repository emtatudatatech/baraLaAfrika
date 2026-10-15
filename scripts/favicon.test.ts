import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC = join(ROOT, 'apps/web/public');

describe('favicon', () => {
  it('links are stamped with the current icon files (run scripts/build-favicon.mjs)', () => {
    // Same rule as build-favicon.mjs: SHA-256 of favicon.svg then favicon.ico, 8 hex digits.
    const version = createHash('sha256')
      .update(readFileSync(join(PUBLIC, 'favicon.svg')))
      .update(readFileSync(join(PUBLIC, 'favicon.ico')))
      .digest('hex')
      .slice(0, 8);
    const index = readFileSync(join(ROOT, 'apps/web/index.html'), 'utf8');
    expect(index).toContain(`href="/favicon.ico?v=${version}"`);
    expect(index).toContain(`href="/favicon.svg?v=${version}"`);
  });
});
