import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/*
 * The web app imports plain constants and helpers from these @bla/shared modules. A zod import
 * (or an import of a module that builds schemas at load time) in one of them would pull the
 * schema library into the app's bundles, as happened once with the Harim page (131 kB instead of
 * 37 kB).
 */
const SHARED = join(import.meta.dirname, '..', 'packages', 'shared', 'src');
const ZOD_FREE = ['constants.ts', 'datasets.ts', 'regions.ts', 'harimConstants.ts'];

describe('@bla/shared modules the web app imports values from', () => {
  for (const file of ZOD_FREE) {
    it(`${file} does not depend on zod`, () => {
      const source = readFileSync(join(SHARED, file), 'utf8');
      expect(source).not.toMatch(/from ['"]zod['"]/);
      expect(source).not.toMatch(/from ['"]\.\/(schemas|api|harim)\.ts['"]/);
    });
  }
});
