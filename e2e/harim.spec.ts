import { type Locator, type Page, expect, test } from '@playwright/test';

import {
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  useTheme,
  waitForContent,
  waitForFonts,
} from './helpers';

/** One element per country (table rows on desktop, cards on phones), carrying data-iso3. */
function countryItems(page: Page, isMobile: boolean): Locator {
  return isMobile
    ? page.getByTestId('harim-summary-cards').locator(':scope > li[data-iso3]')
    : page.getByTestId('harim-summary-table').locator('tbody tr[data-iso3]');
}

/** One element per mountain in the All peaks view, carrying data-slug. */
function peakItems(page: Page, isMobile: boolean): Locator {
  return page
    .getByTestId(isMobile ? 'harim-peak-list' : 'harim-peaks-table')
    .locator('[data-slug]');
}

/** Each item's main height in metres (the first height it shows). */
async function heights(items: Locator): Promise<number[]> {
  return items.evaluateAll((elements) =>
    elements.map((element) =>
      Number(element.querySelector('[data-metres]')?.getAttribute('data-metres')),
    ),
  );
}

async function openHarim(page: Page, query = '') {
  await page.goto(`/harim${query}`);
  await waitForContent(page, '/harim');
}

test('lists all 54 countries with their high point, highest first', async ({ page, isMobile }) => {
  await openHarim(page);
  const items = countryItems(page, isMobile);
  await expect(items).toHaveCount(54);
  await expect(
    page.getByRole('status').filter({ hasText: 'Showing all 54 countries' }),
  ).toBeVisible();
  await expect(items.first()).toHaveAttribute('data-iso3', 'TZA');
  await expect(items.first()).toContainText('Mount Kilimanjaro');
  // Every country has a catalogued high point.
  await expect(page.getByText('No catalogued high point')).toHaveCount(0);
  const values = await heights(items);
  expect(values.every((value) => Number.isFinite(value) && value > 0)).toBe(true);
  expect(values).toEqual([...values].sort((a, b) => b - a));
  await expect(
    page.getByTestId(isMobile ? 'harim-summary-table' : 'harim-summary-cards'),
  ).toHaveCount(0);
});

test('desktop: headers sort the table and the low-point columns can be toggled', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'desktop table');
  await page.setViewportSize({ width: 1100, height: 800 });
  await openHarim(page);
  const table = page.getByTestId('harim-summary-table');
  const items = countryItems(page, isMobile);
  // Below 1280px the lowest point and relief columns start hidden, behind the toggle.
  const toggle = page.getByTestId('harim-low-columns');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(table.getByRole('columnheader', { name: 'Relief' })).toHaveCount(0);
  await toggle.click();
  await expect(table.getByRole('columnheader', { name: 'Relief' })).toBeVisible();
  await table.getByRole('button', { name: 'Relief' }).click();
  await expect(page).toHaveURL(/sort=relief/);
  await expect(table.getByRole('columnheader', { name: 'Relief' })).toHaveAttribute(
    'aria-sort',
    'descending',
  );
  await table.getByRole('button', { name: 'Height' }).click();
  await expect(page).toHaveURL(/\/harim$/);
  await table.getByRole('button', { name: 'Height' }).click();
  await expect(page).toHaveURL(/sort=-height/);
  const values = await heights(items);
  expect(values).toEqual([...values].sort((a, b) => a - b));
});

test('phones: the Sort by menu sorts the cards', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone layout');
  await openHarim(page);
  await page.getByTestId('harim-sort').selectOption('name');
  await expect(page).toHaveURL(/sort=name/);
  await expect(countryItems(page, isMobile).first()).toHaveAttribute('data-iso3', 'DZA');
});

test('a row expands to the country’s mountains, massif summits nested', async ({
  page,
  isMobile,
}) => {
  await openHarim(page);
  const kenya = countryItems(page, isMobile).and(page.locator('[data-iso3="KEN"]'));
  const toggle = kenya.getByTestId('harim-country-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const panel = page.locator(`#${(await toggle.getAttribute('aria-controls')) ?? 'missing'}`);
  const peaks = panel.getByTestId('country-peak');
  await expect(peaks.first()).toContainText('Mount Kenya');
  await expect(peaks.first()).toContainText('National high point');
  // The massif counts once; its summits are listed beneath it, in m and ft.
  const summits = peaks.first().getByRole('list', { name: 'Summits of Mount Kenya' });
  await expect(summits.getByRole('listitem')).toHaveCount(3);
  await expect(summits).toContainText('Batian');
  await expect(peaks.first()).toContainText('5,199 m');
  await expect(peaks.first()).toContainText('17,057 ft');
  // Shared border peaks say so.
  await expect(panel.getByTestId('country-peak').filter({ hasText: 'Mount Elgon' })).toContainText(
    'Shared with Uganda',
  );
  await expect(panel.getByRole('link', { name: /Country profile/ })).toHaveAttribute(
    'href',
    '/countries?country=KEN',
  );
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(panel).toHaveCount(0);
});

test('a country in the URL is shown expanded (the cross-link from Countries)', async ({
  page,
  isMobile,
}) => {
  await page.goto('/harim?country=DJI');
  const items = countryItems(page, isMobile);
  await expect(items).toHaveCount(1);
  await expect(items.getByTestId('harim-country-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('country-peak').first()).toContainText('Mousa Ali');
  // The lowest point and relief (in the row on desktop, in the expanded card on phones), with a
  // true minus sign.
  const main = page.getByRole('main');
  await expect(main).toContainText('Lake Assal');
  await expect(main).toContainText('\u2212155 m');
  await expect(main).not.toContainText('-155');
});

test('region chips and search filter the table and update the URL', async ({ page, isMobile }) => {
  await openHarim(page);
  const items = countryItems(page, isMobile);
  const east = page
    .getByRole('group', { name: 'Region' })
    .getByRole('button', { name: /East Africa/ });
  await east.click();
  await expect(page).toHaveURL(/\/harim\?region=east$/);
  await expect(items).toHaveCount(16);
  await page.getByRole('searchbox', { name: 'Search mountains' }).fill('rwenzori');
  await expect(page).toHaveURL(/region=east&q=rwenzori/);
  await expect(items).toHaveCount(1);
  await expect(items.first()).toHaveAttribute('data-iso3', 'UGA');
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page).toHaveURL(/\/harim$/);
  await expect(items).toHaveCount(54);
});

test('All peaks filters by region and minimum height, kept in the URL', async ({
  page,
  isMobile,
}) => {
  await openHarim(page);
  await page.getByTestId('harim-view-peaks').click();
  await expect(page).toHaveURL(/\/harim\?view=peaks$/);
  const items = peakItems(page, isMobile);
  await expect(items.first()).toBeVisible();
  const all = await items.count();
  expect(all).toBeGreaterThan(300);
  await page.getByTestId('harim-min-height').fill('4000');
  await expect(page).toHaveURL(/view=peaks&minHeight=4000/);
  await expect(page.getByTestId('harim-min-height')).toHaveAttribute(
    'aria-valuetext',
    '≥ 4,000\u00a0m',
  );
  await expect.poll(async () => (await heights(items)).every((value) => value >= 4000)).toBe(true);
  const high = await items.count();
  expect(high).toBeGreaterThan(5);
  expect(high).toBeLessThan(all);
  await page
    .getByRole('group', { name: 'Region' })
    .getByRole('button', { name: /North Africa/ })
    .click();
  await expect(page).toHaveURL(/region=north/);
  await expect(items.first()).toContainText('Jbel Toubkal');
  const north = await items.count();
  expect(north).toBeLessThan(high);
  // The view survives a reload: it lives in the URL.
  await page.reload();
  await expect(page.getByTestId('harim-view-peaks')).toHaveAttribute('aria-pressed', 'true');
  await expect(items).toHaveCount(north);
});

test('volcanic and range filters narrow All peaks', async ({ page, isMobile }) => {
  await page.goto('/harim?view=peaks');
  const items = peakItems(page, isMobile);
  await expect(items.first()).toBeVisible();
  await page.getByTestId('harim-range-filter').selectOption('rwenzori');
  await expect(page).toHaveURL(/range=rwenzori/);
  await expect(items.first()).toContainText('Mount Stanley');
  await expect(items.filter({ hasNotText: 'Rwenzori' })).toHaveCount(0);
  await page.getByTestId('harim-range-filter').selectOption('');
  await page.getByTestId('harim-volcanic-filter').selectOption('1');
  await expect(page).toHaveURL(/volcanic=1/);
  await expect(items.filter({ hasText: 'Mount Meru' })).toHaveCount(1);
  await expect(items.filter({ hasText: 'Jbel Toubkal' })).toHaveCount(0);
});

test('the most prominent peaks preset sorts by prominence, unknown values last', async ({
  page,
  isMobile,
}) => {
  await openHarim(page);
  const preset = page.getByTestId('harim-prominent');
  await preset.click();
  await expect(page).toHaveURL(/view=peaks&sort=prominence/);
  await expect(preset).toHaveAttribute('aria-pressed', 'true');
  const items = peakItems(page, isMobile);
  await expect(items.first()).toContainText('Mount Kilimanjaro');
  await expect(items.first()).toContainText('Ultra-prominent');
  // Peaks without a known prominence show "—" and come after every known one.
  const unknown = await items.evaluateAll((elements) =>
    elements.map((element) => element.textContent.includes('Prominence not known')),
  );
  const firstUnknown = unknown.indexOf(true);
  expect(firstUnknown).toBeGreaterThan(0);
  expect(unknown.slice(firstUnknown).every(Boolean)).toBe(true);
});

test('the metres/feet toggle converts every height and persists', async ({ page, isMobile }) => {
  await openHarim(page);
  const first = countryItems(page, isMobile).first();
  await expect(first).toContainText('5,895 m');
  await page.getByTestId('harim-unit-ft').click();
  await expect(page.getByTestId('harim-unit-ft')).toHaveAttribute('aria-pressed', 'true');
  await expect(first).toContainText('19,341 ft');
  await page.reload();
  await expect(countryItems(page, isMobile).first()).toContainText('19,341 ft');
  expect(await page.evaluate(() => window.localStorage.getItem('bla-units'))).toBe('ft');
  await page.getByTestId('harim-unit-m').click();
  await expect(countryItems(page, isMobile).first()).toContainText('5,895 m');
});

test('a peak opens in the drawer with sourced heights; Escape closes it', async ({
  page,
  isMobile,
}) => {
  await page.goto('/harim?country=TZA');
  await page
    .getByTestId('country-peak')
    .first()
    .getByRole('button', { name: 'Mount Kilimanjaro', exact: true })
    .click();
  await expect(page).toHaveURL(/peak=mount-kilimanjaro/);
  const drawer = page.getByTestId('peak-drawer');
  await expect(drawer.getByRole('heading', { level: 2, name: 'Mount Kilimanjaro' })).toBeVisible();
  await expect(drawer.getByTestId('elevation-source')).toContainText('Wikidata');
  await expect(drawer).toContainText('19,341 ft');
  await expect(drawer).toContainText('Ultra-prominent');
  await expect(drawer.getByRole('link', { name: /Wikipedia/ }).first()).toBeVisible();
  // A summit opens in the same drawer and links back to its massif.
  await drawer.getByRole('button', { name: 'Mawenzi' }).click();
  await expect(page).toHaveURL(/peak=mawenzi/);
  await expect(drawer.getByRole('heading', { level: 2, name: 'Mawenzi' })).toBeVisible();
  await expect(
    drawer.getByRole('button', { name: 'Mount Kilimanjaro', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(page).not.toHaveURL(/peak=/);
  if (!isMobile) await expectNoHorizontalOverflow(page);
});

test('an unknown peak in the URL shows an error in the drawer, not a crash', async ({ page }) => {
  await page.goto('/harim?peak=no-such-peak');
  await expect(page.getByTestId('peak-drawer').getByRole('alert')).toContainText(
    'could not be loaded',
  );
});

test('territory peaks are listed apart, collapsed and loaded on demand', async ({ page }) => {
  await openHarim(page);
  const group = page.getByTestId('harim-territories');
  await expect(group).not.toHaveAttribute('open', '');
  await group.locator('summary').click();
  const list = group.getByTestId('harim-territory-list');
  await expect(list.locator('[data-slug]')).toHaveCount(8);
  await expect(list).toContainText('Teide');
  await expect(group.locator('summary')).toContainText('(8)');
});

for (const theme of ['light', 'dark'] as const) {
  test(`expanded rows, All peaks and the drawer pass axe checks (${theme})`, async ({ page }) => {
    await useTheme(page, theme);
    await page.goto('/harim?country=KEN');
    await waitForFonts(page);
    await expect(page.getByTestId('country-peak').first()).toBeVisible();
    await expectNoAxeViolations(page);
    await page.goto('/harim?view=peaks&sort=prominence');
    await expect(page.getByTestId('peak-name').first()).toBeVisible();
    await expectNoAxeViolations(page);
    await page.goto('/harim?peak=mount-kenya');
    await expect(page.getByTestId('elevation-source')).toBeVisible();
    await expectNoAxeViolations(page);
  });
}

test('no horizontal overflow at 320px, expanded and in All peaks', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/harim?country=COD');
  await expect(page.getByTestId('country-peak').first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.goto('/harim?view=peaks&minHeight=3000');
  await expect(page.getByTestId('peak-name').first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('desktop: the tables are never wider than their panel (they would be clipped)', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'desktop tables');
  const fits = () =>
    page.evaluate(() => {
      const table = document.querySelector('#harim-results table');
      const panel = table?.parentElement;
      return table && panel ? table.getBoundingClientRect().width <= panel.clientWidth : null;
    });
  for (const width of [720, 900, 1024, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await openHarim(page);
    expect(await fits(), `By country at ${String(width)}px`).toBe(true);
    const toggle = page.getByTestId('harim-low-columns');
    if ((await toggle.count()) > 0 && (await toggle.getAttribute('aria-pressed')) === 'false') {
      await toggle.click();
      expect(await fits(), `with the low-point columns at ${String(width)}px`).toBe(true);
    }
    await page.goto('/harim?view=peaks');
    await expect(page.getByTestId('peak-name').first()).toBeVisible();
    // Below 1024px All peaks is a list, not a table.
    expect(await fits(), `All peaks at ${String(width)}px`).toBe(width >= 1024 ? true : null);
  }
});
