import { type Page, expect, test } from '@playwright/test';

import {
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  useTheme,
  waitForFonts,
} from './helpers';

/** Gold coverage as the Dhahabu pipelines will report it (they arrive in later milestones). */
const GOLD = {
  datasets: [
    {
      key: 'gold-price',
      name: 'Gold price (monthly average)',
      provider: 'IMF',
      license: 'IMF terms',
      attribution: 'IMF',
      coverageStart: '1990-01-01',
      coverageEnd: '2026-09-30',
      asOf: '2026-10-05',
      lastRefreshedAt: '2026-10-16T03:00:00Z',
      refreshCadence: 'monthly',
    },
    {
      key: 'gold-production',
      name: 'Gold mine production',
      provider: 'USGS',
      license: 'Public domain',
      attribution: 'USGS',
      coverageStart: '2000-01-01',
      coverageEnd: '2024-12-31',
      asOf: '2026-01-31',
      lastRefreshedAt: '2026-10-01T03:00:00Z',
      refreshCadence: 'annual',
    },
    {
      key: 'gold-official-reserves',
      name: 'Central bank gold reserves',
      provider: 'IMF',
      license: 'IMF terms',
      attribution: 'IMF',
      coverageStart: '2000-03-31',
      coverageEnd: '2026-06-30',
      asOf: '2026-09-15',
      lastRefreshedAt: '2026-10-16T03:00:00Z',
      refreshCadence: 'quarterly',
    },
  ],
  missing: ['gold-trade'],
};

async function mockGoldCoverage(page: Page) {
  await page.route('**/api/coverage?*', async (route) => {
    const keys = new URL(route.request().url()).searchParams.get('datasets') ?? '';
    if (keys.includes('gold-')) await route.fulfill({ json: GOLD });
    else await route.fallback();
  });
}

const ribbonOf = (page: Page) => page.getByRole('complementary', { name: 'Data behind this view' });

test.beforeEach(async ({ page }) => {
  // The seeds record their refresh at 2026-10-15T08:00Z; fix "now" two days later.
  await page.clock.setFixedTime(new Date('2026-10-17T12:00:00Z'));
});

test('reference pages show live "as of" dates and refresh times from /api/coverage', async ({
  page,
  isMobile,
}) => {
  await page.goto('/');
  const ribbon = ribbonOf(page);
  await expect(ribbon.getByTestId('ribbon-as-of')).toHaveText('as of 15 Oct 2026');
  if (!isMobile) {
    await expect(ribbon).toContainText('Boundaries: Natural Earth');
    await expect(ribbon).toContainText('Refreshed 2 days ago');
  }
  await ribbon.getByRole('button', { name: 'Show data details' }).click();
  const list = ribbon.getByRole('list', { name: 'Datasets behind this view' });
  const boundaries = list.locator('[data-dataset="boundaries-natural-earth"]');
  await expect(boundaries).toContainText('Country boundaries (Natural Earth 4.1.0, 1:50m)');
  await expect(boundaries).toContainText('23 May 2018');
  await expect(boundaries).toContainText('Does not change');
  await expect(boundaries).toContainText('15 Oct 2026 (2 days ago)');
  await expect(boundaries).toContainText('Public domain');
  await expect(list.locator('[data-dataset]')).toHaveCount(3);
  await expect(ribbon).toContainText("This page's data is not time-dependent.");
  await expectNoHorizontalOverflow(page);
});

test('pages whose data is not loaded yet say so', async ({ page, isMobile }) => {
  await page.goto('/harim');
  const ribbon = ribbonOf(page);
  if (isMobile) {
    await expect(ribbon).toContainText('No data loaded yet');
  } else {
    await expect(ribbon).toContainText('Harim baseline (not loaded yet)');
  }
  await ribbon.getByRole('button', { name: 'Show data details' }).click();
  await expect(ribbon.locator('[data-dataset]')).toHaveCount(3);
  await expect(ribbon.getByText('not loaded yet', { exact: true })).toHaveCount(3);
});

test('a time-series page without data shows a "no data" state, never an invented range', async ({
  page,
  isMobile,
}) => {
  await page.goto('/dhahabu?from=2010&to=2020');
  const control = ribbonOf(page).getByTestId('ribbon-years');
  // (The icon's ligature text is aria-hidden, so the accessible name is the label alone.)
  await expect(control).toHaveAccessibleName('No data yet');
  await expect(control).toHaveAttribute('aria-disabled', 'true');
  if (!isMobile) {
    await control.hover();
    await expect(page.getByRole('tooltip')).toHaveText(
      'No time-series data has been loaded for this page yet.',
    );
  }
});

test('the year range is interactive on Dhahabu and drives the URL', async ({ page, isMobile }) => {
  await mockGoldCoverage(page);
  await page.goto('/dhahabu?from=2016');
  const ribbon = ribbonOf(page);
  const trigger = ribbon.getByRole('button', { name: /Years shown/ });
  await expect(trigger).toHaveText(/2016–2026/);
  if (!isMobile) {
    await expect(ribbon).toContainText('Gold price: Jan 1990–Sep 2026');
    await expect(ribbon).toContainText('Mine production: 2000–2024');
  }

  await trigger.click();
  const panel = ribbon.getByRole('group', { name: 'Years shown' });
  await expect(panel).toBeVisible();
  // Fully on screen at every width.
  const box = await panel.boundingBox();
  const viewport = page.viewportSize();
  expect(box && viewport && box.x >= 0 && box.x + box.width <= viewport.width).toBe(true);

  await panel.getByRole('button', { name: 'Last 5 years' }).click();
  await expect(page).toHaveURL(/\/dhahabu\?from=2022$/);
  await expect(trigger).toHaveText(/2022–2026/);
  await panel.getByRole('combobox', { name: 'To' }).selectOption('2024');
  await expect(page).toHaveURL(/\/dhahabu\?from=2022&to=2024$/);

  // A shared link restores the range.
  await page.reload();
  await expect(ribbon.getByRole('button', { name: /Years shown/ })).toHaveText(/2022–2024/);

  await ribbon.getByRole('button', { name: /Years shown/ }).click();
  await ribbon.getByRole('button', { name: 'All years' }).click();
  await expect(page).toHaveURL(/\/dhahabu$/);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expectNoHorizontalOverflow(page);
});

test('on phones the year control never overlaps the summary', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone layout');
  await mockGoldCoverage(page);
  await page.goto('/dhahabu');
  const ribbon = ribbonOf(page);
  const trigger = ribbon.getByRole('button', { name: /Years shown/ });
  await expect(trigger).toBeVisible();
  const kind = await ribbon.getByText('Time series', { exact: true }).first().boundingBox();
  const control = await trigger.boundingBox();
  expect(kind && control && kind.x + kind.width <= control.x).toBe(true);
  await expect(ribbon.getByTestId('ribbon-as-of')).toBeHidden();
  await page.setViewportSize({ width: 320, height: 640 });
  await expectNoHorizontalOverflow(page);
});

for (const theme of ['light', 'dark'] as const) {
  test(`the open year picker passes axe checks in ${theme} mode`, async ({ page }) => {
    await useTheme(page, theme);
    await mockGoldCoverage(page);
    await page.goto('/dhahabu');
    const ribbon = ribbonOf(page);
    await ribbon.getByRole('button', { name: /Years shown/ }).click();
    await ribbon.getByRole('button', { name: 'Show data details' }).click();
    await waitForFonts(page);
    await expectNoAxeViolations(page);
  });
}
