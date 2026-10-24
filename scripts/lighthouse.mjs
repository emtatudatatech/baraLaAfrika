/*
 * `npm run lighthouse`: Lighthouse (mobile) on the production build for /, /countries, /harim,
 * /dhahabu and /vinara (spec §9: Performance, Accessibility, Best Practices and SEO ≥ 90). It serves
 * apps/web/dist with `vite preview` (run `npm run build` first) and the real API handlers on the
 * committed seeds (e2e/api-server.ts), runs Playwright's Chromium headless, writes HTML reports
 * to ./lighthouse and fails when any score is below the threshold.
 *
 * Local numbers are a floor, not the deployed figure: `vite preview` serves uncompressed files
 * (Netlify's CDN adds Brotli) and the API is a local process.
 *
 * `LIGHTHOUSE_URL=https://… npm run lighthouse` audits a deployed site instead (no local build or
 * servers).
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';
import * as chromeLauncher from 'chrome-launcher';
import lighthouse from 'lighthouse';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = join(ROOT, 'apps/web');
const OUT = join(ROOT, 'lighthouse');
const API_PORT = '4177';
const WEB_PORT = '4178';
const REMOTE = process.env.LIGHTHOUSE_URL?.replace(/\/$/, '');
const BASE = REMOTE ?? `http://localhost:${WEB_PORT}`;
const ROUTES = ['/', '/countries', '/harim', '/dhahabu', '/vinara'];
const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];
const THRESHOLD = Number(process.env.LIGHTHOUSE_MIN ?? 90);
const VITE_BIN = join(
  dirname(createRequire(join(WEB, 'package.json')).resolve('vite/package.json')),
  'bin/vite.js',
);

if (!REMOTE && !existsSync(join(WEB, 'dist/index.html'))) {
  console.error('No production build: run `npm run build` first.');
  process.exit(1);
}

const children = [];
function start(args, cwd, env) {
  const child = spawn(process.execPath, args, {
    cwd,
    stdio: 'ignore',
    env: { ...process.env, ...env },
  });
  children.push(child);
  return child;
}
function stopAll() {
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
}
process.on('exit', stopAll);

async function waitFor(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Nothing answered at ${url}`);
}

if (!REMOTE) {
  start(['e2e/api-server.ts'], ROOT, { E2E_API_PORT: API_PORT });
  await waitFor(`http://127.0.0.1:${API_PORT}/api/regions`);
  start([VITE_BIN, 'preview', '--port', WEB_PORT, '--strictPort'], WEB, {
    BLA_API_PROXY: `http://127.0.0.1:${API_PORT}`,
  });
}
await waitFor(BASE);

const chrome = await chromeLauncher.launch({
  chromePath: chromium.executablePath(),
  chromeFlags: ['--headless=new', '--no-sandbox'],
});
await mkdir(OUT, { recursive: true });

const rows = [];
let failed = false;
try {
  for (const route of ROUTES) {
    const result = await lighthouse(`${BASE}${route}`, {
      port: chrome.port,
      output: ['html', 'json'],
      onlyCategories: CATEGORIES,
      logLevel: 'error',
    });
    if (!result) throw new Error(`Lighthouse returned nothing for ${route}`);
    const name = route === '/' ? 'home' : route.slice(1);
    const [html, json] = result.report;
    await writeFile(join(OUT, `${name}.html`), html ?? '');
    await writeFile(join(OUT, `${name}.json`), json ?? '');
    const scores = Object.fromEntries(
      CATEGORIES.map((key) => [key, Math.round((result.lhr.categories[key]?.score ?? 0) * 100)]),
    );
    const audits = result.lhr.audits;
    rows.push({
      route,
      ...scores,
      LCP: audits['largest-contentful-paint']?.displayValue ?? '',
      CLS: audits['cumulative-layout-shift']?.displayValue ?? '',
      TBT: audits['total-blocking-time']?.displayValue ?? '',
    });
    if (Object.values(scores).some((score) => score < THRESHOLD)) failed = true;
  }
} finally {
  await chrome.kill();
  stopAll();
}

console.table(rows);
console.log(`Reports: ${OUT}`);
if (failed) {
  console.error(`A score is below ${String(THRESHOLD)}.`);
  process.exitCode = 1;
}
