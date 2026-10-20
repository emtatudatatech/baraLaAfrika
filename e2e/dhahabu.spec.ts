import { readFile } from 'node:fs/promises';

import { type Page, expect, test } from './fixtures';

import {
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  useTheme,
  waitForFonts,
  waitForStats,
} from './helpers';

const rows = (page: Page) => page.getByTestId('gold-row');
const names = (page: Page) => page.getByTestId('gold-country-name');
const card = (page: Page, key: string) =>
  page.locator(`[data-testid="stat-card"][data-stat="${key}"]`);

async function openDhahabu(page: Page, query = '') {
  await page.goto(`/dhahabu${query}`);
  await expect(rows(page).first()).toBeVisible();
  await waitForStats(page);
}

test('lists all 54 countries, the largest producer first, every figure dated', async ({
  page,
  isMobile,
}) => {
  await openDhahabu(page);
  await expect(rows(page)).toHaveCount(54);
  await expect(page.getByTestId(isMobile ? 'gold-cards' : 'gold-table')).toBeVisible();
  await expect(names(page).first()).toHaveText('Ghana');
  await expect(page.getByTestId('gold-reference')).toContainText(
    'Latest available figures; each shows its own year or date.',
  );
  const ghana = rows(page).first();
  await expect(ghana.getByTestId('presence-badge')).toContainText('Major producer');
  await expect(ghana).toContainText('2025');
  await expect(ghana).toContainText('computed');
  // A country without production shows "no data", not a zero.
  const libya = page.locator('[data-testid="gold-row"][data-iso3="LBY"]');
  await expect(libya.getByText('No data').first()).toBeAttached();
  await expectNoHorizontalOverflow(page);
});

test('the band shows the eleven cards, each with its year or month', async ({ page }) => {
  await openDhahabu(page);
  const cards = page.getByTestId('stat-card');
  await expect(cards).toHaveCount(11);
  await expect(card(page, 'gold_producing_countries')).toContainText('of 54');
  await expect(card(page, 'africa_production').getByTestId('stat-period')).toHaveText('2021');
  await expect(card(page, 'production_value')).toContainText('Computed, not reported');
  await expect(card(page, 'largest_producer')).toContainText('South Africa');
  await expect(card(page, 'gold_price')).toContainText('not live');
  await expect(card(page, 'biggest_reporting_gap')).toContainText('not evidence of wrongdoing');
  // The headline and its detail agree.
  await expect(card(page, 'largest_net_buyer')).toContainText(/\+6\.87\st\b.*\+6\.87\st in/s);
  await expect(page.getByRole('article', { name: 'Largest producer (All Africa)' })).toBeVisible();
  // The price effect: its two parts are shown, and its action brings the holdings chart into view.
  await expect(card(page, 'price_effect')).toContainText('Tonnes bought or sold');
  await card(page, 'price_effect').getByRole('button', { name: 'See the holdings chart' }).click();
  await expect(page.getByTestId('gold-holdings-chart')).toBeFocused();
});

test('region, search and presence filters update the URL, the rows and the band', async ({
  page,
}) => {
  await openDhahabu(page);
  await page
    .getByRole('group', { name: 'Region' })
    .getByRole('button', { name: /West Africa/ })
    .click();
  await expect(page).toHaveURL(/region=west/);
  await expect(rows(page)).toHaveCount(15);
  await expect(page.getByTestId('stats-scope')).toContainText('West Africa');
  await expect(card(page, 'largest_producer')).toContainText('Ghana');

  await page.getByTestId('gold-presence-filter').selectOption('major_producer');
  await expect(page).toHaveURL(/presence=major_producer/);
  await expect(rows(page)).toHaveCount(4);

  await page.getByTestId('gold-search').fill('zzz');
  await expect(page).toHaveURL(/q=zzz/);
  await expect(page.getByTestId('gold-empty')).toBeVisible();
  await page.getByTestId('gold-empty').getByRole('button', { name: 'Clear filters' }).click();
  await expect(page).toHaveURL(/\/dhahabu$/);
  await expect(rows(page)).toHaveCount(54);
  await expect(page.getByTestId('gold-search')).toHaveValue('');
});

test('desktop: the headers sort the table, and the URL keeps the order', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'desktop table');
  await openDhahabu(page);
  const holdings = page.getByTestId('gold-sort-holdings');
  await holdings.click();
  await expect(page).toHaveURL(/sort=holdings/);
  await expect(page.locator('th[aria-sort="descending"]')).toContainText('Central bank gold');
  await expect(names(page).first()).toHaveText('Algeria');
  await holdings.click();
  await expect(page).toHaveURL(/sort=-holdings/);
  await expect(page.locator('th[aria-sort="ascending"]')).toContainText('Central bank gold');
  await page.getByTestId('gold-sort-name').click();
  await expect(page).toHaveURL(/sort=name/);
  await expect(names(page).first()).toHaveText('Algeria');
  await expect(names(page).last()).toHaveText('Zimbabwe');
  await page.reload();
  await expect(page.locator('th[aria-sort="ascending"]')).toContainText('Country');
});

test('phones: cards with key figures first, the rest on request, and a Sort menu', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'phone layout');
  await openDhahabu(page);
  const first = rows(page).first();
  const more = first.getByRole('button', { name: 'More figures' });
  await expect(first.getByText('Gold exports')).toBeHidden();
  await more.click();
  await expect(first.getByRole('button', { name: 'Fewer figures' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(first.getByText('Gold exports')).toBeVisible();
  await page.getByTestId('gold-sort').selectOption('name');
  await expect(page).toHaveURL(/sort=name/);
  await expect(names(page).first()).toHaveText('Algeria');
  await expectNoHorizontalOverflow(page);
});

test('the ribbon’s year range sets the reference year for the URL, cards and table', async ({
  page,
}) => {
  await openDhahabu(page);
  const ribbon = page.getByRole('complementary', { name: 'Data behind this view' });
  await ribbon.getByRole('button', { name: /Years shown/ }).click();
  await ribbon
    .getByRole('group', { name: 'Years shown' })
    .getByRole('combobox', { name: 'To' })
    .selectOption('2015');
  await expect(page).toHaveURL(/to=2015/);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('gold-stats-year')).toHaveText('Up to 2015');
  await expect(card(page, 'africa_production').getByTestId('stat-period')).toHaveText('2015');
  await expect(card(page, 'largest_producer')).toContainText('South Africa');
  await expect(page.getByTestId('gold-reference')).toContainText('Figures up to 2015');
  await expect(names(page).first()).toHaveText('South Africa');
  await expect(rows(page).first()).toContainText('2015');

  // A shared link restores the same view.
  await page.reload();
  await waitForStats(page);
  await expect(page.getByTestId('gold-stats-year')).toHaveText('Up to 2015');
});

test('a card’s action sorts the table or brings its country into view', async ({ page }) => {
  await openDhahabu(page);
  await card(page, 'largest_holder').getByRole('button', { name: 'Show the country' }).click();
  await expect(
    page.locator('#gold-results [data-iso3="DZA"] [data-testid="gold-country-name"]'),
  ).toBeFocused();
  await card(page, 'central_bank_gold').getByRole('button', { name: 'Sort by holdings' }).click();
  await expect(page).toHaveURL(/sort=holdings/);
  await expect(names(page).first()).toHaveText('Algeria');
});

test('mass units switch between tonnes, kilograms and ounces and persist', async ({ page }) => {
  await openDhahabu(page);
  await page.getByTestId('gold-unit-oz').click();
  await expect(page.getByTestId('gold-unit-oz')).toHaveAttribute('aria-pressed', 'true');
  await expect(rows(page).first()).toContainText(/million\soz/);
  await expect(card(page, 'africa_production')).toContainText('oz');
  await page.reload();
  await expect(page.getByTestId('gold-unit-oz')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('gold-unit-kg').click();
  await expect(rows(page).first()).toContainText(/\skg/);
});

test('Export downloads the current view as CSV with its attribution block', async ({ page }) => {
  await openDhahabu(page, '?region=west');
  await page.getByTestId('gold-export').click();
  const downloading = page.waitForEvent('download');
  await page.getByTestId('gold-export-view').click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(
    /^dhahabu-countries-filtered-\d{4}-\d{2}-\d{2}\.csv$/,
  );
  const body = await readFile(await download.path(), 'utf8');
  expect(body).toContain('# Filters: region=west');
  expect(body).toContain('International Monetary Fund');
  expect(body).toContain('nominal US dollars');
  const lines = body.split('\r\n').filter((line) => line !== '' && !line.startsWith('#'));
  // The header plus one row per country in the view.
  expect(lines.length - 1).toBe(15);
  await expect(page.getByTestId('gold-export-toast')).toContainText('Downloaded dhahabu-countries');
});

test('the presence badge explains its evidence; “How to read this page” opens and closes', async ({
  page,
}) => {
  await openDhahabu(page);
  await rows(page).first().getByTestId('presence-badge').focus();
  await expect(page.getByRole('tooltip')).toContainText('Evidence for Ghana');
  await page.keyboard.press('Escape');
  await page.getByTestId('gold-how-to-read').click();
  const panel = page.getByTestId('gold-how-to-read-panel');
  await expect(panel).toBeVisible();
  // Fully on screen, and above the cards that follow the header.
  await expect(panel.getByRole('listitem').last()).toBeVisible();
  await panel.getByRole('listitem').last().click({ trial: true });
  const box = await panel.boundingBox();
  const viewport = page.viewportSize();
  expect(box && viewport && box.x >= 0 && box.x + box.width <= viewport.width).toBe(true);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(page.getByTestId('gold-how-to-read')).toBeFocused();
});

test('no horizontal overflow at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openDhahabu(page);
  await expectNoHorizontalOverflow(page);
});

for (const theme of ['light', 'dark'] as const) {
  test(`Dhahabu passes axe checks in ${theme} mode`, async ({ page }) => {
    await useTheme(page, theme);
    await openDhahabu(page);
    await waitForFonts(page);
    await expectNoAxeViolations(page);
  });
}

test('the map switches metric with the URL and opens a country’s drawer', async ({
  page,
  isMobile,
}) => {
  await openDhahabu(page);
  const map = page.getByTestId('gold-map');
  await expect(map.locator('[data-testid="gold-map-country"]')).toHaveCount(54);
  const legend = page.getByTestId('gold-map-legend');
  await expect(legend).toContainText('Mine production');
  await expect(legend).toContainText('No data');
  if (isMobile) await page.getByTestId('gold-map-metric').selectOption('presence');
  else await page.getByTestId('gold-map-metric-presence').click();
  await expect(page).toHaveURL(/metric=presence/);
  await expect(legend).toContainText('Major producer');
  await expect(legend).toContainText('None identified');
  // Every country has a name, the metric and its value for screen readers.
  await expect(map.locator('[data-iso3="GHA"][role="button"]')).toHaveAccessibleName(
    'Ghana, Presence: Major producer',
  );

  // A shared link restores the metric; Enter on a focused country opens its drawer.
  await page.reload();
  await expect(page.getByTestId('gold-map-legend')).toContainText('Presence of gold');
  await map.locator('[data-iso3="GHA"][role="button"]').focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/country=GHA/);
  await expect(page.getByTestId('gold-drawer')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('gold-drawer')).toBeHidden();
  await expect(page).not.toHaveURL(/country=/);
});

test('desktop: hovering the map shows each figure with its year', async ({ page, isMobile }) => {
  test.skip(isMobile, 'hover');
  await openDhahabu(page, '?metric=holdings');
  await page.getByTestId('gold-map').locator('[data-iso3="DZA"][role="button"]').hover();
  const tooltip = page.getByTestId('gold-map-tooltip');
  await expect(tooltip).toContainText('Algeria');
  await expect(tooltip).toContainText(/Central bank gold: \d+/);
  await expect(tooltip).toContainText(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) 20\d\d/);
});

test('a row opens the drawer: figures, histories, in-ground reserves apart, sources', async ({
  page,
}) => {
  await openDhahabu(page);
  await page
    .locator('[data-testid="gold-row"][data-iso3="ZAF"]')
    .getByTestId('gold-country-name')
    .click();
  await expect(page).toHaveURL(/country=ZAF/);
  const drawer = page.getByTestId('gold-drawer');
  await expect(drawer.getByRole('heading', { name: 'South Africa' })).toBeVisible();
  await expect(drawer.getByTestId('gold-drawer-production')).toContainText('2021');
  await expect(drawer.getByTestId('gold-drawer-trade')).toBeVisible();
  await expect(drawer.getByTestId('gold-drawer-holdings')).toBeVisible();
  await expect(drawer).toContainText('not evidence of wrongdoing');
  const inground = drawer.getByTestId('gold-drawer-inground');
  await expect(inground).toContainText('illustrative at a given price, not a realisable sum');
  await expect(drawer.getByRole('heading', { name: 'Sources' })).toBeVisible();
  await expect(
    drawer.getByRole('link', { name: /U\.S\. Geological Survey/ }).first(),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('cross-links: the drawer opens the country profile, which links back to its gold', async ({
  page,
}) => {
  await page.goto('/dhahabu?country=GHA');
  await page.getByTestId('gold-drawer-profile').click();
  await expect(page).toHaveURL(/\/countries\?country=GHA$/);
  const back = page.getByTestId('country-drawer').getByTestId('drawer-gold');
  await expect(back).toContainText('Gold in Ghana: Major producer');
  await back.getByRole('link').click();
  await expect(page).toHaveURL(/\/dhahabu\?country=GHA$/);
  await expect(page.getByTestId('gold-drawer')).toBeVisible();
});

test('the charts follow the ribbon’s year range', async ({ page }) => {
  await openDhahabu(page, '?from=2005&to=2015');
  const producers = page.getByTestId('gold-producers-chart');
  await expect(producers).toContainText('Mine production in 2015');
  await expect(page.getByTestId('gold-producers-bar').first()).toHaveAttribute('data-iso3', 'ZAF');
  // Production bars only within the range; the price line spans it.
  const years = await page
    .getByTestId('gold-production-bar')
    .evaluateAll((bars) => bars.map((bar) => Number(bar.getAttribute('data-year'))));
  expect(years.length).toBeGreaterThan(0);
  expect(Math.max(...years)).toBeLessThanOrEqual(2015);
  await expect(page.getByTestId('gold-price-line')).toHaveAttribute('d', /^M/);
  // The holdings lines and the price-or-tonnes split stay inside the range too.
  await expect(page.getByTestId('gold-holdings-line')).toHaveCount(5);
  await expect(page.getByTestId('gold-split-summary')).toContainText(
    /to (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) 2015/,
  );
});

test('holdings switch to US dollars, and the split names its two parts', async ({ page }) => {
  await openDhahabu(page);
  await page.getByTestId('gold-holdings-mode-usd').click();
  await expect(page.getByTestId('gold-holdings-mode-usd')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('gold-holdings-chart')).toContainText('computed at each month');
  const split = page.getByTestId('gold-split');
  await split.getByTestId('gold-split-country').selectOption({ label: 'Libya' });
  await expect(page.getByTestId('gold-split-summary')).toContainText('Libya');
  await expect(split.locator('[data-step="price"]')).toBeAttached();
  await expect(split.locator('[data-step="volume"]')).toBeAttached();
});

for (const theme of ['light', 'dark'] as const) {
  test(`the open drawer passes axe checks in ${theme} mode`, async ({ page }) => {
    await useTheme(page, theme);
    await page.goto('/dhahabu?country=TZA');
    await expect(page.getByTestId('gold-drawer-production')).toBeVisible();
    await waitForFonts(page);
    await expectNoAxeViolations(page);
  });
}
