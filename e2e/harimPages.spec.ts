import { readFile } from 'node:fs/promises';

import { type Page, expect, test } from '@playwright/test';

import {
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  useTheme,
  waitForFonts,
  waitForMap,
} from './helpers';

const cards = (page: Page) => page.getByTestId('harim-range-cards').locator(':scope > li');

test('By range lists range cards, filterable, searchable and sortable', async ({ page }) => {
  await page.goto('/harim');
  await page.getByTestId('harim-view-ranges').click();
  await expect(page).toHaveURL(/view=ranges/);
  await expect(cards(page).first()).toBeVisible();
  expect(await cards(page).count()).toBeGreaterThan(20);
  // Tallest peak first: the Rwenzori (Mount Stanley, 5,109 m).
  await expect(cards(page).first()).toHaveAttribute('data-slug', 'rwenzori');
  await expect(cards(page).first()).toContainText('Tallest: Mount Stanley, 5,109 m');
  await expect(
    page.getByRole('status').filter({ hasText: /Showing all \d+ ranges/ }),
  ).toBeVisible();
  // Each card has a tint: a region, or "split".
  expect(
    await cards(page).evaluateAll((items) => items.every((item) => item.getAttribute('data-tint'))),
  ).toBe(true);
  await page
    .getByRole('group', { name: 'Region' })
    .getByRole('button', { name: /North Africa/ })
    .click();
  await expect(page.locator('[data-slug="high-atlas"]')).toBeVisible();
  await expect(page.locator('[data-slug="rwenzori"]')).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Search mountains' }).fill('toubkal');
  await expect(cards(page)).toHaveCount(1);
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByTestId('harim-sort').selectOption('peaks');
  await expect(page).toHaveURL(/sort=peaks/);
  // Most mountains first once the list has re-rendered.
  await expect
    .poll(async () => {
      const counts = await cards(page).evaluateAll((items) =>
        items.map((item) => Number(/(\d+) mountains?/.exec(item.textContent)?.[1] ?? 0)),
      );
      return counts.length > 20 && counts.every((n, k) => k === 0 || (counts[k - 1] ?? 0) >= n);
    })
    .toBe(true);
});

test('a range page shows its sourced text, facts, map and mountains', async ({ page }) => {
  await page.goto('/harim?view=ranges');
  await cards(page).first().getByRole('link').click();
  await expect(page).toHaveURL(/\/harim\/ranges\/rwenzori$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Rwenzori Mountains');
  await expect(page).toHaveTitle(/^Rwenzori Mountains · Harim/);
  await expect(page.getByTestId('range-description')).toContainText('sources of the Nile');
  await expect(page.getByRole('link', { name: /Wikipedia: Rwenzori Mountains/ })).toHaveAttribute(
    'href',
    'https://en.wikipedia.org/wiki/Rwenzori_Mountains',
  );
  await expect(page.getByTestId('range-page')).toContainText('120 km');
  await expect(page.getByRole('link', { name: 'Uganda’s mountains' })).toHaveAttribute(
    'href',
    '/harim?country=UGA',
  );
  await waitForMap(page);
  const rows = page.locator('#range-peaks [data-slug]');
  await expect(rows).toHaveCount(5);
  await rows.first().getByRole('button', { name: 'Mount Stanley', exact: true }).click();
  await expect(page).toHaveURL(/\/harim\/peaks\/mount-stanley$/);
});

test('a range without a sourced description says so; an unknown range is not found', async ({
  page,
}) => {
  await page.goto('/harim/ranges/tunisian-dorsal');
  await expect(page.getByTestId('range-page')).toContainText('No sourced description is recorded');
  await expect(page.locator('#range-peaks [data-slug]').first()).toBeVisible();
  await page.goto('/harim/ranges/no-such-range');
  await expect(page.getByRole('alert')).toContainText('We could not find that range.');
});

test('a peak page shows the height, facts, names, locator map, nearby peaks and sources', async ({
  page,
  context,
  browserName,
}) => {
  await page.goto('/harim/peaks/mount-kenya');
  const article = page.getByTestId('peak-page');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mount Kenya');
  await expect(page).toHaveTitle('Mount Kenya · Harim · Mountains of Africa · Bara La Afrika');
  await expect(article).toContainText('5,199 m');
  await expect(article).toContainText('17,057 ft');
  await expect(page.getByTestId('peak-volcanic')).toContainText('Extinct');
  await expect(article.getByRole('link', { name: 'Kenya', exact: true })).toHaveAttribute(
    'href',
    '/harim?country=KEN',
  );
  await expect(page.getByTestId('peak-alternatives')).toContainText('GeoNames');
  await expect(article.getByRole('link', { name: 'Batian', exact: true })).toHaveAttribute(
    'href',
    '/harim/peaks/batian',
  );
  await expect(article).toContainText('Kĩrĩmanyaga');
  await expect(page.getByRole('img', { name: 'Map of Africa marking Mount Kenya' })).toBeVisible();
  await expect(page.getByTestId('peak-nearby').getByRole('listitem').first()).toContainText(
    'km away',
  );
  await expect(article).toContainText('Sources');
  if (browserName === 'chromium') {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByTestId('peak-copy-coordinates').click();
    await expect(page.getByTestId('peak-copy-coordinates')).toHaveText('Copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('-0.10000, 37.20000');
  }
});

test('a peak with no prominence or names says so, and an unknown peak is not found', async ({
  page,
}) => {
  await page.goto('/harim/peaks/mount-emin');
  await expect(page.getByTestId('peak-prominence')).toHaveText('Prominence not known');
  await expect(page.getByTestId('peak-no-names')).toBeVisible();
  await page.goto('/harim/peaks/no-such-peak');
  await expect(page.getByRole('alert')).toContainText('We could not find that mountain.');
});

test('the peak drawer opens the full page', async ({ page }) => {
  await page.goto('/harim?peak=mount-kilimanjaro');
  await page.getByTestId('peak-full-page').click();
  await expect(page).toHaveURL(/\/harim\/peaks\/mount-kilimanjaro$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mount Kilimanjaro');
});

test('Export downloads the current view as CSV with its attribution block', async ({ page }) => {
  await page.goto('/harim?view=peaks&region=east&minHeight=4001');
  await expect(page.getByTestId('peak-name').first()).toBeVisible();
  await page.getByTestId('harim-export').click();
  const downloading = page.waitForEvent('download');
  await page.getByTestId('harim-export-view-csv').click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^harim-mountains-filtered-\d{4}-\d{2}-\d{2}\.csv$/);
  const body = await readFile(await download.path(), 'utf8');
  expect(body).toContain('# Filters: region=east, minHeight=4001');
  expect(body).toContain('Contains data from GeoNames (geonames.org), CC BY 4.0');
  const rows = body.split('\r\n').filter((line) => line !== '' && !line.startsWith('#'));
  // The header plus one row per peak in the view.
  expect(rows.length - 1).toBe(await page.getByTestId('peak-name').count());
  await expect(page.getByTestId('harim-export-toast')).toContainText('Downloaded harim-mountains');
});

test('Export of the whole catalogue as GeoJSON, and a failed export shows an error', async ({
  page,
}) => {
  await page.goto('/harim?region=east');
  await page.getByTestId('harim-export').click();
  const downloading = page.waitForEvent('download');
  await page.getByTestId('harim-export-all-geojson').click();
  const download = await downloading;
  const body = JSON.parse(await readFile(await download.path(), 'utf8')) as {
    features: unknown[];
    metadata: { filters: object };
  };
  expect(body.features).toHaveLength(337);
  expect(body.metadata.filters).toEqual({});
  await page.route('**/api/mountains/export*', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
  );
  await page.getByTestId('harim-export').click();
  await page.getByTestId('harim-export-view-csv').click();
  await expect(page.getByTestId('harim-export-toast')).toHaveAttribute('role', 'alert');
  await expect(page.getByTestId('harim-export-toast')).toContainText('The export failed');
});

test('peak and range pages have link-preview shells built in', async ({ request }) => {
  const peak = await (await request.get('/harim/peaks/mount-kenya')).text();
  expect(peak).toContain(
    '<title>Mount Kenya · Harim · Mountains of Africa · Bara La Afrika</title>',
  );
  expect(peak).toContain(
    'content="Mount Kenya (5,199 m) in Kenya: height, sources, names and nearby peaks."',
  );
  expect(peak).toMatch(/property="og:image" content="[^"]*\/og\/harim\.png"/);
  const range = await (await request.get('/harim/ranges/high-atlas')).text();
  expect(range).toContain('<title>High Atlas · Harim');
  const og = await request.get('/og/harim.png');
  expect(og.headers()['content-type']).toBe('image/png');
});

for (const theme of ['light', 'dark'] as const) {
  test(`ranges, a range page and a peak page pass axe checks (${theme})`, async ({ page }) => {
    await useTheme(page, theme);
    await page.goto('/harim?view=ranges');
    await expect(cards(page).first()).toBeVisible();
    await waitForFonts(page);
    await expectNoAxeViolations(page);
    await page.goto('/harim/ranges/virunga');
    await waitForMap(page);
    await expectNoAxeViolations(page);
    await page.goto('/harim/peaks/mount-kenya');
    await expect(page.getByTestId('peak-alternatives')).toBeVisible();
    await expectNoAxeViolations(page);
  });
}

test('no horizontal overflow at 320px on the new pages', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  for (const path of [
    '/harim?view=ranges',
    '/harim/ranges/drakensberg',
    '/harim/peaks/mount-kilimanjaro',
  ]) {
    await page.goto(path);
    await expect(page.locator('h1')).toBeVisible();
    await page.waitForTimeout(400);
    await expectNoHorizontalOverflow(page);
  }
});
