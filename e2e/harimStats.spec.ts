import { type Page, expect, test } from './fixtures';

import {
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  useTheme,
  waitForFonts,
  waitForStats,
} from './helpers';

function card(page: Page, key: string) {
  return page.locator(`[data-testid="stat-card"][data-stat="${key}"]`);
}

async function openHarim(page: Page, query = '') {
  await page.goto(`/harim${query}`);
  await waitForStats(page);
}

test('the band shows the nine cards for All Africa, hero cards first', async ({ page }) => {
  await openHarim(page);
  const cards = page.getByTestId('stat-card');
  await expect(cards).toHaveCount(9);
  expect(await cards.evaluateAll((els) => els.map((el) => el.getAttribute('data-stat')))).toEqual([
    'mountains_catalogued',
    'volcanic_mountains',
    'tallest_mountain',
    'lowest_national_high_point',
    'peaks_above_4000',
    'most_mountainous_country',
    'busiest_range',
    'lowest_point',
    'greatest_relief',
  ]);
  // Prominence is known for too few peaks, so that card is hidden.
  await expect(card(page, 'most_prominent_peak')).toHaveCount(0);
  await expect(page.getByTestId('stats-scope')).toContainText('All Africa');
  await expect(card(page, 'mountains_catalogued')).toContainText('337');
  await expect(card(page, 'mountains_catalogued')).toContainText('across 54 countries');
  await expect(card(page, 'tallest_mountain')).toContainText('5,895 m');
  await expect(card(page, 'tallest_mountain')).toContainText('Mount Kilimanjaro');
  // Tanzania's flag beside its name (decorative: the name is the text).
  await expect(card(page, 'tallest_mountain').locator('img[alt=""]')).toHaveAttribute(
    'src',
    /\/tz\.png$/,
  );
  await expect(card(page, 'lowest_national_high_point')).toContainText(
    'Africa’s lowest “highest point”',
  );
  await expect(card(page, 'lowest_national_high_point')).not.toContainText('shortest');
  await expect(card(page, 'lowest_point')).toContainText('−155 m');
  await expect(card(page, 'lowest_point')).toContainText('155 m below sea level');
  // Each card is an article named by its heading, with the scope for screen readers.
  await expect(page.getByRole('article', { name: 'Tallest mountain (All Africa)' })).toBeVisible();
});

test('the band recomputes for the selected region and always shows the scope', async ({ page }) => {
  await openHarim(page);
  await page
    .getByRole('group', { name: 'Region' })
    .getByRole('button', { name: /East Africa/ })
    .click();
  await expect(page.getByTestId('stats-scope')).toContainText('East Africa');
  await expect(card(page, 'mountains_catalogued')).toContainText('142');
  await expect(card(page, 'mountains_catalogued')).toContainText('across 16 countries');
  // A regional figure never reads as Africa's.
  await expect(card(page, 'lowest_point').getByRole('heading')).toContainText(
    'Lowest point in East Africa',
  );
  await expect(page.getByRole('article', { name: /\(East Africa\)$/ })).toHaveCount(9);
});

test('“How is this calculated?” shows the definition and closes with Escape', async ({ page }) => {
  await openHarim(page);
  const info = card(page, 'lowest_national_high_point').getByTestId('stat-info');
  await expect(info).toHaveAccessibleName(/How is this calculated: Lowest national high point/);
  await info.click();
  await expect(info).toHaveAttribute('aria-expanded', 'true');
  const definition = page.getByTestId('stat-definition');
  await expect(definition).toContainText('It is not "the shortest mountain"');
  await expect(definition).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(definition).toHaveCount(0);
  await expect(info).toBeFocused();
  // The close button works too, and only one card's definition is open at a time.
  await info.click();
  await page.getByTestId('stat-definition').getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('stat-definition')).toHaveCount(0);
});

test('cards act: volcanoes and peaks above 4,000 m filter All peaks to the card’s count', async ({
  page,
  isMobile,
}) => {
  await openHarim(page);
  await card(page, 'volcanic_mountains')
    .getByRole('button', { name: 'Show the volcanoes' })
    .click();
  await expect(page).toHaveURL(/view=peaks/);
  await expect(page).toHaveURL(/volcanic=1/);
  const peaks = page
    .getByTestId(isMobile ? 'harim-peak-list' : 'harim-peaks-table')
    .locator('[data-slug]');
  await expect(peaks).toHaveCount(86);

  await card(page, 'peaks_above_4000').getByRole('button', { name: 'Show these peaks' }).click();
  // Strict bands: Abuye Meda (exactly 4,000 m) is not "above 4,000 m".
  await expect(page).toHaveURL(/minHeight=4001/);
  await expect(page).not.toHaveURL(/volcanic=/);
  await expect(peaks).toHaveCount(36);
  await expect(
    page.getByTestId('harim-peak-list').or(page.getByTestId('harim-peaks-table')),
  ).not.toContainText('Abuye Meda');
});

test('cards act: the tallest opens its drawer, countries open their row', async ({ page }) => {
  await openHarim(page);
  await card(page, 'tallest_mountain').getByRole('button', { name: 'Open the peak' }).click();
  await expect(page).toHaveURL(/peak=mount-kilimanjaro/);
  await expect(
    page.getByTestId('peak-drawer').getByRole('heading', { level: 2, name: 'Mount Kilimanjaro' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await card(page, 'lowest_point').getByRole('button', { name: 'Show the country' }).click();
  await expect(page).toHaveURL(/country=DJI/);
  await expect(page.getByTestId('country-peak').first()).toContainText('Mousa Ali');
  await card(page, 'most_mountainous_country')
    .getByRole('button', { name: 'Show its peaks' })
    .click();
  await expect(page).toHaveURL(/view=peaks/);
  await expect(page).toHaveURL(/country=UGA/);
  await expect(page).toHaveURL(/minHeight=3000/);
});

test('a card’s action works from the keyboard', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard flow');
  await openHarim(page);
  const action = card(page, 'busiest_range').getByRole('button', { name: 'Show the range' });
  await action.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/range=drakensberg/);
});

test('heights follow the metres/feet toggle', async ({ page }) => {
  await openHarim(page);
  await page.getByTestId('harim-unit-ft').click();
  await expect(card(page, 'tallest_mountain')).toContainText('19,341 ft');
  await expect(card(page, 'lowest_point')).toContainText('−509 ft');
});

test('no count-up animation with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/harim');
  await expect(page.getByTestId('stat-card').first()).toBeVisible();
  await expect(page.locator('[data-counting]')).toHaveCount(0);
  await expect(card(page, 'mountains_catalogued')).toContainText('337');
});

test('a failed load shows an error with a working retry', async ({ page }) => {
  let fail = true;
  await page.route('**/api/mountains/stats*', async (route) => {
    if (fail) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal_error', message: 'boom' } }),
      });
    } else {
      await route.continue();
    }
  });
  await page.goto('/harim');
  const band = page.getByTestId('stats-band');
  await expect(band.getByRole('alert')).toContainText('could not be loaded');
  fail = false;
  await band.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByTestId('stat-card')).toHaveCount(9);
});

test('phones: a carousel with dots that scrolls inside itself', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone layout');
  await openHarim(page);
  await expectNoHorizontalOverflow(page);
  const track = page.getByRole('region', { name: 'Statistics cards' });
  await expect(track).toBeVisible();
  const dots = page.getByRole('group', { name: 'Choose a card' }).getByRole('button');
  await expect(dots).toHaveCount(9);
  await expect(dots.first()).toHaveAttribute('aria-current', 'true');
  await dots.nth(2).click();
  await expect(dots.nth(2)).toHaveAttribute('aria-current', 'true');
  // The third card (the tallest mountain) is now in view; the page still does not scroll sideways.
  await expect(card(page, 'tallest_mountain')).toBeInViewport({ ratio: 0.9 });
  await expectNoHorizontalOverflow(page);
  await page.setViewportSize({ width: 320, height: 640 });
  await expectNoHorizontalOverflow(page);
});

test('desktop: four hero cards in the first row, the rest below', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop grid');
  await openHarim(page);
  const tops = await page
    .getByTestId('stat-card')
    .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
  expect(new Set(tops.slice(0, 4)).size).toBe(1);
  expect(new Set(tops.slice(4)).size).toBe(1);
  expect(tops[4]).toBeGreaterThan(tops[0] ?? 0);
  // 720–1279px: three columns.
  await page.setViewportSize({ width: 1024, height: 800 });
  const left = await page
    .getByTestId('stat-card')
    .evaluateAll(
      (els) => new Set(els.map((el) => Math.round(el.getBoundingClientRect().left))).size,
    );
  expect(left).toBe(3);
});

for (const theme of ['light', 'dark'] as const) {
  test(`the band passes axe checks with a definition open (${theme})`, async ({ page }) => {
    await useTheme(page, theme);
    await openHarim(page);
    await waitForFonts(page);
    await card(page, 'mountains_catalogued').getByTestId('stat-info').click();
    await expect(page.getByTestId('stat-definition')).toBeVisible();
    await expectNoAxeViolations(page);
  });
}
