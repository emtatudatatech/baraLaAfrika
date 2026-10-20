// Builds the Netlify Functions exactly as a deploy does (`netlify build --offline`), then imports
// every bundle in plain Node and calls it without a database. Each must answer with the API's
// own 503 JSON error, which proves the bundle loads (all imports resolved and packaged).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const bundles = join(root, 'apps', 'web', '.netlify', 'functions');

rmSync(bundles, { recursive: true, force: true });
execFileSync('npx', ['netlify', 'build', '--offline', '--filter', '@bla/web'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL_READ: '' },
});

const zips = readdirSync(bundles).filter((file) => file.endsWith('.zip'));
if (zips.length === 0) throw new Error(`No function bundles in ${bundles}`);

delete process.env.DATABASE_URL_READ;

// A valid query for functions with required parameters, so the call reaches the database (and
// its 503) instead of stopping at validation (400).
const QUERIES = { 'gold-series': '?metric=production' };

const failures = [];
for (const zip of zips) {
  const name = zip.replace(/\.zip$/, '');
  const directory = mkdtempSync(join(tmpdir(), `bla-fn-${name}-`));
  try {
    execFileSync('unzip', ['-q', join(bundles, zip), '-d', directory]);
    const module = await import(
      pathToFileURL(join(directory, 'netlify', 'functions', `${name}.mjs`)).href
    );
    const url = `https://bundle.test${module.config.path}${QUERIES[name] ?? ''}`;
    const response = await module.default(new Request(url), {
      params: { iso3: 'KEN', slug: 'mount-kenya' },
    });
    const body = await response.json();
    if (response.status !== 503 || body?.error?.code !== 'service_unavailable') {
      failures.push(`${name}: expected 503 service_unavailable, got ${response.status}`);
    } else {
      console.log(`✓ ${name} bundle loads and answers (${module.config.path})`);
    }
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
