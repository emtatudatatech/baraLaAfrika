import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const toml = readFileSync(join(ROOT, 'netlify.toml'), 'utf8');

/** The `publish` value inside a `[section]` of netlify.toml (a deliberately small parser). */
function publishIn(section: string): string | undefined {
  const start = toml.indexOf(`[${section}]\n`);
  if (start === -1) return undefined;
  const body = toml.slice(start + section.length + 3).split(/\n\[/)[0] ?? '';
  return /^\s*publish\s*=\s*"([^"]+)"/m.exec(body)?.[1];
}

describe('netlify.toml', () => {
  it('keeps the production CSP out of `netlify dev`', () => {
    // Netlify merges <publish>/_headers into the config, and the build writes the production CSP
    // to dist/_headers; under `netlify dev` that CSP blocks Vite's inline scripts (blank page).
    const build = publishIn('build');
    const dev = publishIn('context.dev');
    expect(build).toBe('apps/web/dist');
    expect(dev).toBeDefined();
    expect(dev).not.toBe(build);
    expect(publishIn('dev')).toBe(dev);
    expect(existsSync(join(ROOT, dev ?? '', '_headers'))).toBe(false);
  });
});
