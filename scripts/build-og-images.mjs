/*
 * Builds the social share images (Open Graph / Twitter cards, 1200×630):
 *
 *   node scripts/build-og-images.mjs
 *
 * Writes apps/web/public/og/site.png (the site and /countries), og/harim.png (Harim and every
 * mountain and range page), og/dhahabu.png (Dhahabu) and og/vinara.png (Vinara), rendered with the Chromium that Playwright installs and the site's own fonts and
 * Africa silhouette. Committed like the favicon; re-run when the design changes. Per-peak images
 * are not generated: rendering ~90 images needs a headless browser at build time, which the
 * deploy build does not have (see the README).
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'apps/web/public/og');
const FONTS = join(ROOT, 'node_modules/@fontsource-variable');

async function dataUrl(path, type) {
  return `data:${type};base64,${(await readFile(path)).toString('base64')}`;
}

const fraunces = await dataUrl(
  join(FONTS, 'fraunces/files/fraunces-latin-full-normal.woff2'),
  'font/woff2',
);
const instrument = await dataUrl(
  join(FONTS, 'instrument-sans/files/instrument-sans-latin-standard-normal.woff2'),
  'font/woff2',
);
const silhouette = (await readFile(join(ROOT, 'apps/web/public/favicon.svg'), 'utf8'))
  .replace(/<style>.*<\/style>/, '')
  .replace('<svg ', '<svg class="africa" ');

const CARDS = [
  {
    file: 'site.png',
    kicker: 'Bara La Afrika',
    title: 'Fifty-four states, one continent',
    lead: 'What Africa’s country names mean, what their flags and national animals symbolise, how high their mountains rise and where their gold is found.',
  },
  {
    file: 'harim.png',
    kicker: 'Bara La Afrika · Harim',
    title: 'Mountains of Africa',
    lead: 'Every national high point and every peak of 3,000 m or more, country by country: heights, sources, ranges and names.',
  },
  {
    file: 'dhahabu.png',
    kicker: 'Bara La Afrika · Dhahabu',
    title: 'Gold in Africa',
    lead: 'Where gold is found, how much is mined and traded, and how much central banks hold, for all 54 states, each figure with its year.',
  },
  {
    file: 'vinara.png',
    kicker: 'Bara La Afrika · Vinara',
    title: 'The Cardinals of Africa',
    lead: 'The leading state and the runner-up on thirteen measures, in Africa and in each region, and whether the lead is narrowing.',
  },
];

function page({ kicker, title, lead }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: Fraunces; src: url(${fraunces}) format('woff2'); font-weight: 100 900; }
@font-face { font-family: Instrument; src: url(${instrument}) format('woff2'); font-weight: 400 700; }
html, body { margin: 0; }
body { width: 1200px; height: 630px; box-sizing: border-box; padding: 72px 80px; display: flex;
  align-items: center; gap: 56px; color: #291910; font-family: Instrument, sans-serif;
  background: radial-gradient(900px 600px at 0% 0%, #f6c9a4 0%, transparent 60%),
    radial-gradient(800px 600px at 100% 100%, #cfe3c6 0%, transparent 60%), #f6efe4; }
.text { flex: 1; display: grid; gap: 22px; }
.kicker { font-size: 28px; font-weight: 600; letter-spacing: 0.04em; color: #a33c13; }
h1 { margin: 0; font-family: Fraunces, serif; font-size: 82px; line-height: 1.02; font-weight: 600; }
p { margin: 0; font-size: 30px; line-height: 1.35; color: #5b4636; }
.africa { width: 360px; height: 360px; flex: none; }
.africa path { fill: #291910; }
</style></head><body><div class="text"><div class="kicker">${kicker}</div><h1>${title}</h1><p>${lead}</p></div>${silhouette}</body></html>`;
}

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1200, height: 630 } });
  const tab = await context.newPage();
  for (const card of CARDS) {
    await tab.setContent(page(card));
    // Runs in the page: wait until the embedded fonts are in use.
    await tab.evaluate(async () => {
      await globalThis.document.fonts.ready;
    });
    await writeFile(join(OUT, card.file), await tab.screenshot({ type: 'png' }));
    console.log(`Wrote apps/web/public/og/${card.file}`);
  }
} finally {
  await browser.close();
}
