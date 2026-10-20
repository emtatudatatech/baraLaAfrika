/*
 * Builds the favicon: a dark-filled silhouette of Africa from the site's own Natural Earth
 * boundaries (public domain), so it matches the map exactly and needs no attribution.
 *
 *   node scripts/build-favicon.mjs
 *
 * Writes apps/web/public/favicon.svg (the icon browsers use) and favicon.ico (16/32/48 px, for
 * browsers without SVG favicons and the default /favicon.ico request), rasterised with the
 * Chromium that Playwright installs. Re-run only if the boundaries change.
 *
 * It also stamps the icon links in apps/web/index.html with `?v=<hash of both files>`, so
 * browsers that cached an older icon for the same address (e.g. another project on localhost,
 * or a previous deploy) fetch the new one. scripts/favicon.test.ts checks the stamp.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';
import { geoEqualEarth } from 'd3-geo';
import { merge } from 'topojson-client';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC = join(ROOT, 'apps/web/public');
const SIZE = 64;
const PADDING = 2;
/** Simplification tolerance in viewBox units (64 = icon width). */
const TOLERANCE = 0.3;
/** Drop islands smaller than this (viewBox units²): keeps the mainland and Madagascar. */
const MIN_AREA = 4;
/** --color-ink in the light theme (oklch 23% 0.03 48) and the dark theme (95% 0.012 82). */
const INK_LIGHT = '#291910';
const INK_DARK = '#f2eee6';

const topology = JSON.parse(await readFile(join(PUBLIC, 'geo/africa.topo.json'), 'utf8'));
const object = Object.values(topology.objects)[0];
// Every shape (the 54 countries, Somaliland and Western Sahara) merged into one landmass.
const africa = merge(topology, object.geometries);

const projection = geoEqualEarth().fitExtent(
  [
    [PADDING, PADDING],
    [SIZE - PADDING, SIZE - PADDING],
  ],
  africa,
);

/** Douglas–Peucker on projected points. */
function simplify(points, tolerance) {
  if (points.length < 3) return points;
  const [ax, ay] = points[0];
  const [bx, by] = points.at(-1);
  const length = Math.hypot(bx - ax, by - ay) || 1;
  let worst = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const [px, py] = points[i];
    const distance = Math.abs((by - ay) * px - (bx - ax) * py + bx * ay - by * ax) / length;
    if (distance > worst) {
      worst = distance;
      index = i;
    }
  }
  if (worst <= tolerance) return [points[0], points.at(-1)];
  return [
    ...simplify(points.slice(0, index + 1), tolerance).slice(0, -1),
    ...simplify(points.slice(index), tolerance),
  ];
}

function ringArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

const round = (value) => Math.round(value * 10) / 10;
const rings = [];
for (const polygon of africa.coordinates) {
  // Outer ring only: the merged landmass has no holes worth drawing at icon size.
  const projected = polygon[0].map((coordinate) => projection(coordinate));
  if (ringArea(projected) < MIN_AREA) continue;
  // Split the closed ring in two so the simplifier has distinct end points.
  const half = Math.floor(projected.length / 2);
  const simplified = [
    ...simplify(projected.slice(0, half + 1), TOLERANCE).slice(0, -1),
    ...simplify(projected.slice(half), TOLERANCE).slice(0, -1),
  ];
  rings.push(simplified.map(([x, y]) => [round(x), round(y)]));
}
if (rings.length !== 2)
  throw new Error(`Expected mainland + Madagascar, got ${rings.length} rings`);

const d = rings
  .map((ring) => `M${ring.map(([x, y]) => `${x} ${y}`).join('L')}Z`)
  .join('')
  .replace(/L(-?\d)/g, ' $1');
const svg = (dark) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}">` +
  (dark
    ? `<style>path{fill:${INK_LIGHT}}@media (prefers-color-scheme:dark){path{fill:${INK_DARK}}}</style>`
    : '') +
  `<path${dark ? '' : ` fill="${INK_LIGHT}"`} d="${d}"/></svg>\n`;

// The SVG favicon follows the browser's colour scheme so it stays visible on dark tab strips.
await writeFile(join(PUBLIC, 'favicon.svg'), svg(true));

// ICO fallback: always the dark fill.
const browser = await chromium.launch();
const page = await browser.newPage();
const pngs = [];
for (const size of [16, 32, 48]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg(false)}`,
  );
  pngs.push({ size, data: await page.screenshot({ omitBackground: true }) });
}
await browser.close();

// ICO container with PNG images (supported by every current browser).
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(pngs.length, 4);
let offset = 6 + 16 * pngs.length;
const entries = pngs.map(({ size, data }) => {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size, 0);
  entry.writeUInt8(size, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(data.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += data.length;
  return entry;
});
await writeFile(
  join(PUBLIC, 'favicon.ico'),
  Buffer.concat([header, ...entries, ...pngs.map(({ data }) => data)]),
);

// Cache-busting version: the first 8 hex digits of SHA-256(favicon.svg + favicon.ico).
const version = createHash('sha256')
  .update(await readFile(join(PUBLIC, 'favicon.svg')))
  .update(await readFile(join(PUBLIC, 'favicon.ico')))
  .digest('hex')
  .slice(0, 8);
const indexPath = join(ROOT, 'apps/web/index.html');
const index = await readFile(indexPath, 'utf8');
const stamped = index.replace(
  /href="\/favicon\.(svg|ico)(?:\?v=[0-9a-f]+)?"/g,
  (_match, extension) => `href="/favicon.${extension}?v=${version}"`,
);
if ((stamped.match(/\/favicon\.(?:svg|ico)\?v=/g) ?? []).length !== 2) {
  throw new Error('index.html must link both /favicon.svg and /favicon.ico');
}
await writeFile(indexPath, stamped);

const points = rings.reduce((sum, ring) => sum + ring.length, 0);
console.log(
  `favicon.svg: ${String(points)} points; favicon.ico: 16, 32, 48 px; index.html ?v=${version}`,
);
