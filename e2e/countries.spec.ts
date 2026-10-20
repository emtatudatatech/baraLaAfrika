import { type Locator, type Page, expect, test } from './fixtures';

import {
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  useTheme,
  waitForFonts,
} from './helpers';

/** Rows (desktop table) or cards (phones): one element per country, carrying data-iso3. */
function items(page: Page, isMobile: boolean): Locator {
  return isMobile
    ? page.getByTestId('country-cards').locator(':scope > li[data-iso3]')
    : page.getByTestId('countries-table').locator('tbody tr[data-iso3]');
}

async function openCountries(page: Page, isMobile: boolean, query = '') {
  await page.goto(`/countries${query}`);
  const list = items(page, isMobile);
  await expect(list.first()).toBeVisible();
  return list;
}

async function names(list: Locator): Promise<string[]> {
  return list.getByTestId('country-name').allInnerTexts();
}

const collator = new Intl.Collator('en', { sensitivity: 'base' });

test('lists all 54 countries with Flagpedia flag images', async ({ page, isMobile }) => {
  const list = await openCountries(page, isMobile);
  await expect(list).toHaveCount(54);
  await expect(
    page.getByRole('status').filter({ hasText: 'Showing all 54 countries' }),
  ).toBeVisible();
  const flag = list.first().getByRole('img', { name: 'Flag of Algeria' });
  await expect(flag).toHaveAttribute('src', /^https:\/\/flagcdn\.com\/w\d+\/dz\.png$/);
  await expect(flag).toHaveAttribute('srcset', /2x/);
  await expect(flag).toHaveAttribute('width', '48');
  await expect(flag).toHaveAttribute('height', '32');
  await expect(flag).toHaveAttribute('loading', 'lazy');
  // Phones get cards, never the squeezed table (and vice versa).
  await expect(page.getByTestId(isMobile ? 'countries-table' : 'country-cards')).toHaveCount(0);
});

test('region chips filter the list and update the URL', async ({ page, isMobile }) => {
  const list = await openCountries(page, isMobile);
  const east = page
    .getByRole('group', { name: 'Region' })
    .getByRole('button', { name: /East Africa/ });
  await east.click();
  await expect(page).toHaveURL(/\/countries\?region=east$/);
  await expect(east).toHaveAttribute('aria-pressed', 'true');
  await expect(list).toHaveCount(16);
  await expect(
    page.getByRole('status').filter({ hasText: 'Showing 16 of 54 countries' }),
  ).toBeVisible();
  // Every remaining row or card carries the East Africa chip.
  await expect(list.filter({ hasText: 'East Africa' })).toHaveCount(16);
  await page.getByRole('button', { name: /^All/ }).click();
  await expect(page).toHaveURL(/\/countries$/);
  await expect(list).toHaveCount(54);
});

test('search ignores accents, updates the URL, and shows an empty state', async ({
  page,
  isMobile,
}) => {
  const list = await openCountries(page, isMobile);
  const search = page.getByRole('searchbox', { name: 'Search countries' });
  await search.fill('cote');
  await expect(page).toHaveURL(/q=cote/);
  await expect(list).toHaveCount(1);
  await expect(list.first()).toHaveAttribute('data-iso3', 'CIV');

  await search.fill('zzzz');
  await expect(page.getByTestId('countries-empty')).toContainText('No countries match');
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(search).toHaveValue('');
  await expect(page).toHaveURL(/\/countries$/);
  await expect(list).toHaveCount(54);
});

test('a shared URL restores region, search and sort', async ({ page, isMobile }) => {
  const list = await openCountries(page, isMobile, '?region=west&q=gu&sort=-name');
  await expect(
    page.getByRole('group', { name: 'Region' }).getByRole('button', { name: /West Africa/ }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('searchbox', { name: 'Search countries' })).toHaveValue('gu');
  const shown = await names(list);
  expect(shown.length).toBeGreaterThanOrEqual(2);
  expect(shown).toContain('Guinea');
  expect(shown).toContain('Guinea-Bissau');
  expect(shown).toEqual([...shown].sort((a, b) => collator.compare(b, a)));
  if (isMobile) {
    await expect(page.getByRole('combobox', { name: 'Sort by' })).toHaveValue('-name');
  } else {
    await expect(page.getByRole('columnheader', { name: 'Country' })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  }
});

test('column headers sort the table and update the URL', async ({ page, isMobile }) => {
  test.skip(isMobile, 'phones sort with the Sort by menu');
  const list = await openCountries(page, false);
  const header = page.getByRole('columnheader', { name: 'National animal' });
  await header.getByRole('button').click();
  await expect(page).toHaveURL(/sort=animal/);
  await expect(header).toHaveAttribute('aria-sort', 'ascending');
  await expect(page.getByRole('columnheader', { name: 'Country' })).not.toHaveAttribute(
    'aria-sort',
  );
  const animals = () =>
    list.evaluateAll((rows) => rows.map((row) => (row.lastElementChild as HTMLElement).innerText));
  // Poll: the rows re-render after the URL changes.
  await expect
    .poll(async () => {
      const firstWords = (await animals()).map((text) => text.split('\n')[0] ?? '');
      return (
        firstWords.join('|') === [...firstWords].sort((a, b) => collator.compare(a, b)).join('|')
      );
    })
    .toBe(true);

  await header.getByRole('button').click();
  await expect(page).toHaveURL(/sort=-animal/);
  await expect(header).toHaveAttribute('aria-sort', 'descending');

  // Regions sort in their display order (North, West, Central, East, Southern).
  await page.getByRole('columnheader', { name: 'Region' }).getByRole('button').click();
  await expect(page).toHaveURL(/sort=region/);
  const regionEnds = async () => {
    const regions = await list.evaluateAll((rows) =>
      rows.map((row) => (row.querySelectorAll('td')[1] as HTMLElement).innerText),
    );
    return [regions[0], regions.at(-1)];
  };
  await expect.poll(regionEnds).toEqual(['North Africa', 'Southern Africa']);
});

test('phones sort with the Sort by menu', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'desktop sorts with the column headers');
  const list = await openCountries(page, true);
  await page.getByRole('combobox', { name: 'Sort by' }).selectOption('-name');
  await expect(page).toHaveURL(/sort=-name/);
  await expect(list.first().getByTestId('country-name')).toHaveText('Zimbabwe');
});

test('the flag shows the document’s flag text on hover and keyboard focus', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'pointer and keyboard flow');
  const list = await openCountries(page, false);
  await expect(list).toHaveCount(54);
  const flag = page.locator('tr[data-iso3="KEN"]').getByTestId('flag-button');
  await flag.hover();
  const tooltip = page.getByRole('tooltip').filter({ hasText: 'Black/Red/Green + Shield' });
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText('traditional Maasai shield');
  const box = await tooltip.boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 1440 && box.y >= 0).toBe(true);
  await page.mouse.move(1400, 880);
  await expect(tooltip).toBeHidden();

  await flag.focus();
  await expect(tooltip).toBeVisible();
  await expect(flag).toHaveAccessibleDescription(/Black\/Red\/Green \+ Shield/);
  await page.keyboard.press('Escape');
  await expect(tooltip).toBeHidden();
  // Hovering or clicking the flag never opens the drawer.
  await flag.click();
  await expect(page.getByTestId('country-drawer')).toHaveCount(0);
});

test('tapping a flag toggles its design text on phones', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'touch flow');
  await openCountries(page, true);
  const card = page.locator('li[data-iso3="KEN"]');
  const flag = card.getByTestId('flag-button');
  await flag.scrollIntoViewIfNeeded();
  await flag.tap();
  const tooltip = page.getByRole('tooltip').filter({ hasText: 'Black/Red/Green + Shield' });
  await expect(tooltip).toBeVisible();
  const box = await tooltip.boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
  await flag.tap();
  await expect(tooltip).toBeHidden();
  // The tap did not expand the card.
  await expect(card.locator('[aria-expanded]')).toHaveAttribute('aria-expanded', 'false');
});

test('a row opens the drawer with the full profile; Escape closes it', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'desktop table flow');
  await openCountries(page, false);
  const name = page
    .locator('tr[data-iso3="KEN"]')
    .getByRole('button', { name: 'Kenya', exact: true });
  await name.focus();
  await page.keyboard.press('Enter');
  const drawer = page.getByRole('dialog', { name: 'Kenya' });
  await expect(drawer).toBeVisible();
  await expect(page).toHaveURL(/country=KEN/);
  await expect(page).toHaveTitle(/^Kenya · Countries/);
  await expect(drawer).toContainText('Republic of Kenya');
  await expect(drawer).toContainText('anglicized corruption of the Kikuyu word Kirinyaga');
  await expect(drawer).toContainText('Category: Geographic feature');
  await expect(drawer.getByText('Official', { exact: true })).toBeVisible();

  // Sources: links that open in a new tab, each with a reliability tier and its fields.
  const sources = drawer.getByRole('listitem').filter({ has: page.locator('a[target="_blank"]') });
  await expect(sources.first()).toBeVisible();
  expect(await sources.count()).toBeGreaterThanOrEqual(2);
  await expect(sources.first()).toContainText('Used for:');
  await expect(drawer.locator('a[target="_blank"]').first()).toHaveAttribute('rel', /noopener/);

  // Needs-verification marker expands to the reasons.
  const review = drawer.getByTestId('needs-review');
  await review.getByText('Needs verification').click();
  await expect(review).toContainText('relies mainly on low-reliability');
  await expect(review).toContainText('Status reviewed');

  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(page).not.toHaveURL(/country=/);
  await expect(name).toBeFocused();
  await expect(page).toHaveTitle(/^Countries · /);
});

test('clicking anywhere on a row opens its drawer; the close button and backdrop close it', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'desktop table flow');
  await openCountries(page, false);
  await page.locator('tr[data-iso3="GHA"] td').nth(3).click();
  const drawer = page.getByRole('dialog', { name: 'Ghana' });
  await expect(drawer).toBeVisible();
  await drawer.getByRole('button', { name: 'Close' }).click();
  await expect(drawer).toBeHidden();
  await page.locator('tr[data-iso3="GHA"] td').nth(3).click();
  await expect(drawer).toBeVisible();
  await page.mouse.click(100, 450); // the backdrop, left of the panel
  await expect(drawer).toBeHidden();
});

test('a deep link opens a drawer (Somalia explains Somaliland)', async ({ page, isMobile }) => {
  await page.goto('/countries?country=som');
  const drawer = page.getByRole('dialog', { name: 'Somalia' });
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText('Includes Somaliland');
  // Poll: the panel slides in.
  const edges = () =>
    drawer.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        right: Math.round(window.innerWidth - rect.right),
        bottom: Math.round(window.innerHeight - rect.bottom),
        width: Math.round(rect.width),
      };
    });
  if (isMobile) {
    // A bottom sheet: full width, reaching the bottom edge.
    await expect.poll(edges).toEqual({ right: 0, bottom: 0, width: 390 });
  } else {
    // A side panel docked to the right edge, full height.
    await expect.poll(async () => (await edges()).right).toBe(0);
    await expect.poll(async () => (await edges()).bottom).toBe(0);
  }
  await expectNoHorizontalOverflow(page);
});

test('unknown country codes in the URL are ignored', async ({ page, isMobile }) => {
  await openCountries(page, isMobile, '?country=XYZ');
  await expect(page.getByTestId('country-drawer')).toHaveCount(0);
});

test('the map links into the table', async ({ page }) => {
  await page.goto('/');
  const map = page.getByTestId('africa-map');
  await map.locator('path[data-iso3="NGA"]').click();
  await page.getByTestId('country-popover').getByRole('link', { name: 'See in table' }).click();
  await expect(page).toHaveURL(/\/countries\?country=NGA$/);
  await expect(page.getByRole('dialog', { name: 'Nigeria' })).toBeVisible();
});

test('phone cards expand to the summaries and open the bottom sheet', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'phone layout');
  await openCountries(page, true);
  const card = page.locator('li[data-iso3="MLI"]');
  const toggle = card.locator('[aria-expanded]');
  await toggle.scrollIntoViewIfNeeded();
  await toggle.tap();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(card).toContainText('Name meaning');
  await expect(card).toContainText('Sports nickname');
  await expectNoHorizontalOverflow(page);
  await card.getByRole('button', { name: 'Full profile and sources' }).tap();
  await expect(page.getByRole('dialog', { name: 'Mali' })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 640 });
  await expectNoHorizontalOverflow(page);
});

test('the table header stays visible below the ribbon while scrolling', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'desktop table');
  await openCountries(page, false);
  await page.mouse.wheel(0, 2000);
  const ribbon = page.getByRole('complementary', { name: 'Data behind this view' });
  const header = page.getByRole('columnheader', { name: 'Country' });
  await expect
    .poll(async () => {
      const [r, h] = await Promise.all([ribbon.boundingBox(), header.boundingBox()]);
      return r && h ? Math.round(h.y - (r.y + r.height)) : null;
    })
    .toBe(0);
});

test('a failed load shows an error with a working retry', async ({ page, isMobile }) => {
  let fail = true;
  await page.route('**/api/countries', async (route) => {
    if (fail) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Boom' } }),
      });
    } else {
      await route.fallback();
    }
  });
  await page.goto('/countries');
  await expect(page.getByRole('alert')).toContainText('The countries could not be loaded.');
  // The development hint never ships in production builds.
  await expect(page.getByTestId('dev-api-hint')).toHaveCount(0);
  fail = false;
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(items(page, isMobile)).toHaveCount(54);
});

for (const theme of ['light', 'dark'] as const) {
  test(`the open drawer passes axe checks in ${theme} mode`, async ({ page }) => {
    await useTheme(page, theme);
    await page.goto('/countries?country=CPV');
    const drawer = page.getByRole('dialog', { name: 'Cabo Verde' });
    await expect(drawer.getByText('Used for:').first()).toBeVisible();
    await drawer.getByText('Needs verification').click();
    await waitForFonts(page);
    await expectNoAxeViolations(page);
  });
}
