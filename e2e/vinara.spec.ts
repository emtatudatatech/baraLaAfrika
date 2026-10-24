import { type Page, expect, test } from './fixtures';

import { expectNoAxeViolations, expectNoHorizontalOverflow, waitForContent } from './helpers';

const row = (page: Page, key: string) =>
  page.locator(`[data-testid="vinara-row"][data-metric="${key}"]`);
const card = (page: Page, key: string) =>
  page.locator(`[data-testid="stat-card"][data-stat="${key}"]`);

async function openVinara(page: Page, query = '') {
  await page.goto(`/vinara${query}`);
  await waitForContent(page, '/vinara');
}

test('names the cardinal and the silent contender for each of the 13 measures', async ({
  page,
  isMobile,
}) => {
  await openVinara(page);
  await expect(page.getByTestId(isMobile ? 'vinara-cards' : 'vinara-table')).toBeVisible();
  const population = row(page, 'population');
  await expect(population).toContainText('Nigeria');
  await expect(population).toContainText('Ethiopia');
  await expect(population).toContainText('2016–2025');
  await expect(population).toContainText('54 of 54 states ranked');
  await expect(population.getByTestId('vinara-signal')).toContainText('Lead holding');
  // Ties are all named, and have no signal.
  const stability = row(page, 'currency_stability');
  await expect(stability).toContainText('Tie of 2');
  await expect(stability).toContainText('Djibouti');
  await expect(stability).toContainText('Eritrea');
  await expect(stability.getByTestId('vinara-signal')).toContainText('No signal: a tie');
  // The contender closing in, and ahead in the window's last year.
  const inflation = row(page, 'inflation');
  await expect(inflation.getByTestId('vinara-signal')).toContainText('Gap closing');
  await expect(inflation.getByTestId('vinara-ahead')).toContainText('Djibouti was ahead in 2025');
  // An IMF estimate says so.
  await expect(row(page, 'government_debt')).toContainText('IMF estimate');
  await expect(page.getByTestId('vinara-window')).toContainText(
    'Each measure covers its own last ten complete years.',
  );
  await expectNoHorizontalOverflow(page);
});

test('compares the regions for Africa, and ranks within a region on its own', async ({ page }) => {
  await openVinara(page);
  await expect(page.getByTestId('vinara-region-row')).toHaveCount(13);
  await expect(card(page, 'leadingRegion')).toContainText('Northern Africa');
  await page.locator('[data-region="east"]').click();
  await expect(page).toHaveURL(/region=east/);
  await expect(row(page, 'gdp_usd')).toContainText('Kenya');
  await expect(row(page, 'population')).toContainText('18 of 18 states ranked');
  await expect(page.getByTestId('vinara-regions')).toHaveCount(0);
  await expect(card(page, 'leadingRegion')).toHaveCount(0);
  await expect(page.getByTestId('vinara-election').first()).toBeVisible();
  // Every election shown is in the region.
  const shown = await page
    .getByTestId('vinara-election')
    .evaluateAll((items) => items.map((item) => item.getAttribute('data-iso3')));
  expect(shown).toContain('KEN');
  expect(shown).not.toContain('NGA');
});

test('follows a range chosen in the ribbon', async ({ page }) => {
  await openVinara(page);
  await expect(page.getByTestId('ribbon-years')).toContainText('Last 10 complete years');
  await openVinara(page, '?from=2018&to=2022');
  await expect(page.getByTestId('vinara-window')).toContainText(
    'Years chosen: 2018–2022. Each measure keeps to the years it has data for.',
  );
  await expect(row(page, 'gdp_usd')).toContainText('2018–2022');
  // The currency measures keep to the years they have data for.
  await expect(row(page, 'currency_performance')).toContainText('2020–2022');
  await expect(page.getByTestId('ribbon-years')).toContainText('2018–2022');
});

test('explains each measure and each signal', async ({ page }) => {
  await openVinara(page);
  await row(page, 'inflation').getByTestId('vinara-definition').focus();
  await expect(page.getByRole('tooltip')).toContainText('the mean of the absolute annual rates');
  await card(page, 'gapsClosing').getByTestId('stat-info').click();
  await expect(page.getByTestId('stat-definition')).toContainText('gap-closing signal');
});

test('has no accessibility violations, in Africa and in a region', async ({ page }) => {
  await openVinara(page);
  await expectNoAxeViolations(page);
  await openVinara(page, '?region=west');
  await expectNoAxeViolations(page);
});
