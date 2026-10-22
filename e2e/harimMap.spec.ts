import { type Page, expect, test } from './fixtures';

import {
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  useTheme,
  waitForFonts,
  waitForMap,
} from './helpers';

const peaks = (page: Page) => page.getByTestId('harim-map-peak');
const groups = (page: Page) => page.getByTestId('harim-map-group');

async function openMap(page: Page, query = '') {
  await page.goto(`/harim${query}`);
  await expect(peaks(page).first()).toBeAttached();
  const section = page.getByTestId('harim-map-section');
  await section.scrollIntoViewIfNeeded();
  await waitForMap(page);
  return section;
}

/** A peak on the map, drawn alone or leading a group of close peaks. */
function onMap(page: Page, slug: string) {
  return page.locator(
    `[data-testid="harim-map"] [data-id="${slug}"], [data-testid="harim-map"] [data-id="group:${slug}"]`,
  );
}

/** Selects a peak on the map (through its group's list when it leads one). */
async function selectOnMap(page: Page, slug: string, name: string) {
  const item = onMap(page, slug);
  await expect(item).toBeAttached();
  await item.dispatchEvent('click');
  if ((await item.getAttribute('data-id'))?.startsWith('group:')) {
    await page
      .getByTestId('harim-map-group-card')
      .getByRole('button', { name: new RegExp(`^${name}`) })
      .click();
  }
  await expect(page.getByTestId('harim-map-card').getByRole('heading')).toHaveText(name);
}

async function zoomOf(page: Page): Promise<number> {
  return Number(await page.getByTestId('harim-map').getAttribute('data-zoom'));
}

test('the map draws the catalogue as height-coded peaks with a legend', async ({ page }) => {
  const section = await openMap(page);
  expect(await peaks(page).count()).toBeGreaterThan(5);
  // The legend counts every catalogued mountain by height band.
  const legend = section.getByTestId('harim-map-legend');
  const counts = await legend
    .locator('li')
    .evaluateAll((items) =>
      items
        .map((item) => Number(item.lastElementChild?.textContent ?? 'NaN'))
        .filter(Number.isFinite),
    );
  expect(counts.reduce((sum, n) => sum + n, 0)).toBe(337);
  // Peaks are named for screen readers: "Mount Kilimanjaro, 5,895 metres, Tanzania".
  await expect(
    page.getByRole('button', { name: 'Kediet ej Jill, 915 metres, Mauritania' }),
  ).toBeAttached();
  await expect(section.getByTestId('harim-map-status')).toContainText('Zoom in to see more');
});

test('the region filter applies to the map and zooms to the region', async ({ page }) => {
  await openMap(page);
  await expect(onMap(page, 'jbel-toubkal')).toBeAttached();
  await page
    .getByRole('group', { name: 'Region' })
    .getByRole('button', { name: /Eastern Africa/ })
    .click();
  await expect(onMap(page, 'jbel-toubkal')).toHaveCount(0);
  await expect.poll(() => zoomOf(page)).toBeGreaterThan(1);
});

test('the minimum height applies to the map', async ({ page }) => {
  await openMap(page, '?view=peaks&minHeight=4001');
  await expect
    .poll(async () => {
      const heights = await peaks(page).evaluateAll((els) =>
        els.map((el) => Number(el.getAttribute('data-metres'))),
      );
      const groupMins = await groups(page).evaluateAll((els) =>
        els.map((el) => Number(el.getAttribute('data-min-metres'))),
      );
      return [...heights, ...groupMins].every((m) => m > 4000) && heights.length > 0;
    })
    .toBe(true);
});

test('selecting a peak on the map highlights and reveals its table row', async ({ page }) => {
  await openMap(page, '?country=TZA');
  await selectOnMap(page, 'mount-kilimanjaro', 'Mount Kilimanjaro');
  const card = page.getByTestId('harim-map-card');
  await expect(card).toContainText('5,895 m');
  await card.getByRole('button', { name: 'Show in the table' }).click();
  const row = page.locator('#harim-results [data-slug="mount-kilimanjaro"]');
  await expect(row).toHaveAttribute('data-selected', 'true');
  await expect(row).toBeInViewport();
  await expect(row.getByRole('button', { name: 'Mount Kilimanjaro', exact: true })).toBeFocused();
  // The card's "Full details" opens the same drawer as the table.
  await page.getByTestId('harim-map-section').scrollIntoViewIfNeeded();
  await selectOnMap(page, 'mount-kilimanjaro', 'Mount Kilimanjaro');
  await page.getByTestId('harim-map-card').getByRole('button', { name: 'Full details' }).click();
  await expect(page).toHaveURL(/peak=mount-kilimanjaro/);
});

test('a table row shows its peak on the map', async ({ page }) => {
  await page.goto('/harim?country=KEN');
  const row = page.locator('#harim-results [data-slug="mount-kenya"]');
  await row.getByTestId('show-on-map').click();
  await expect(page.getByTestId('harim-map-section')).toBeInViewport();
  await expect(page.getByTestId('harim-map-card').getByRole('heading')).toHaveText('Mount Kenya');
  await expect.poll(() => zoomOf(page)).toBeGreaterThanOrEqual(3.9);
  await expect(
    page.locator('[data-testid="harim-map-peak"][data-slug="mount-kenya"]'),
  ).toHaveAttribute('data-emphasised', 'true');
  await expect(row).toHaveAttribute('data-selected', 'true');
});

test('hovering a row highlights its peak on the map', async ({ page, isMobile }) => {
  test.skip(isMobile, 'pointer hover');
  await page.goto('/harim?country=KEN');
  await page.locator('#harim-results [data-slug="mount-kenya"]').hover();
  await expect(
    page.locator('[data-testid="harim-map-peak"][data-slug="mount-kenya"]'),
  ).toHaveAttribute('data-emphasised', 'true');
});

test('a group of close peaks opens a list of its members', async ({ page }) => {
  await openMap(page);
  const group = groups(page).first();
  const count = Number(await group.getAttribute('data-count'));
  expect(count).toBeGreaterThan(1);
  await group.dispatchEvent('click');
  const card = page.getByTestId('harim-map-group-card');
  await expect(card.getByRole('listitem')).toHaveCount(count);
  await card.getByRole('button').nth(1).click();
  await expect(page.getByTestId('harim-map-card')).toBeVisible();
});

test('peaks are keyboard accessible: one tab stop, arrows, Enter and Escape', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'keyboard flow');
  await openMap(page);
  const first = page.locator('[data-testid="harim-map"] [role="button"][tabindex="0"]');
  await expect(first).toHaveCount(1);
  await first.focus();
  const firstId = await first.getAttribute('data-id');
  await page.keyboard.press('ArrowRight');
  const focusedId = await page.evaluate(() => document.activeElement?.getAttribute('data-id'));
  expect(focusedId).not.toBe(firstId);
  await expect(page.getByTestId('harim-map-tooltip')).toBeVisible();
  await page.keyboard.press('Enter');
  const card = page.getByTestId('harim-map-card').or(page.getByTestId('harim-map-group-card'));
  await expect(card).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement?.getAttribute('data-id'))).toBe(
    focusedId,
  );
});

test('labels never overlap and stay inside the map', async ({ page }) => {
  await openMap(page);
  for (const zoom of [0, 2]) {
    for (let i = 0; i < zoom; i += 1) await page.getByRole('button', { name: 'Zoom in' }).click();
    await page.waitForTimeout(500);
    const result = await page.evaluate(() => {
      const svg = document.querySelector('[data-testid="harim-map"]');
      const frame = svg?.getBoundingClientRect();
      const boxes = [
        ...document.querySelectorAll('[data-testid="harim-map"] text[data-label]'),
      ].map((el) => el.getBoundingClientRect());
      const inside = boxes.every(
        (b) =>
          frame !== undefined &&
          b.left >= frame.left - 1 &&
          b.right <= frame.right + 1 &&
          b.top >= frame.top - 1 &&
          b.bottom <= frame.bottom + 1,
      );
      let overlaps = 0;
      boxes.forEach((a, i) => {
        for (const b of boxes.slice(i + 1)) {
          const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (x > 1 && y > 1) overlaps += 1;
        }
      });
      return { count: boxes.length, inside, overlaps };
    });
    expect(result.count).toBeGreaterThan(3);
    expect(result.inside).toBe(true);
    expect(result.overlaps).toBe(0);
  }
  await expectNoHorizontalOverflow(page);
});

test('the halo layer is off by default and labelled illustrative', async ({ page }) => {
  const section = await openMap(page);
  await expect(page.locator('[data-testid="harim-map"] circle[r]').first()).toBeAttached();
  const halo = section.getByTestId('harim-map-halo');
  await expect(halo).not.toBeChecked();
  await halo.check();
  await expect(section).toContainText('not a geological or administrative boundary');
});

test('“Fit to” a country zooms the map to it', async ({ page }) => {
  await openMap(page, '?country=ETH');
  const fit = page.getByTestId('harim-map-fit');
  await expect(fit).toHaveAccessibleName('Fit the map to Ethiopia');
  await page.getByRole('button', { name: 'Reset the map' }).click();
  await expect.poll(() => zoomOf(page)).toBe(1);
  await fit.click();
  await expect.poll(() => zoomOf(page)).toBeGreaterThan(1.5);
});

test('the chart shows the highest peak of every country, sortable and filtered by region', async ({
  page,
}) => {
  await page.goto('/harim');
  const chart = page.getByTestId('harim-chart');
  const bars = chart.getByTestId('harim-chart-bar');
  await expect(bars).toHaveCount(54);
  await expect(bars.first()).toHaveAttribute('data-iso3', 'TZA');
  await expect(chart).toContainText('Kilimanjaro 5,895 m');
  await chart.getByTestId('harim-chart-sort-name').click();
  await expect(bars.first()).toHaveAttribute('data-iso3', 'DZA');
  await page
    .getByRole('group', { name: 'Region' })
    .getByRole('button', { name: /Eastern Africa/ })
    .click();
  await expect(bars).toHaveCount(18);
  await chart.getByText('Show the data as a table').click();
  await expect(chart.getByTestId('harim-chart-table').locator('tbody tr')).toHaveCount(18);
  await bars.first().dispatchEvent('click');
  await expect(chart.getByTestId('harim-chart-tooltip')).toBeVisible();
});

test('the Countries drawer links to the country’s peaks', async ({ page }) => {
  await page.goto('/countries?country=KEN');
  const link = page.getByTestId('drawer-highest-peak').getByRole('link');
  await expect(link).toHaveText('Mount Kenya, 5,199 m');
  await link.click();
  await expect(page).toHaveURL(/\/harim\?country=KEN$/);
  await expect(page.getByTestId('country-peak').first()).toContainText('Mount Kenya');
});

test('the geology card is open on larger screens and collapsed on phones', async ({
  page,
  isMobile,
}) => {
  await page.goto('/harim');
  const card = page.getByTestId('harim-geology');
  if (isMobile) await expect(card).not.toHaveAttribute('open', '');
  else await expect(card).toHaveAttribute('open', '');
  await card.locator('summary').click();
  if (isMobile) await expect(card).toHaveAttribute('open', '');
  else await expect(card).not.toHaveAttribute('open', '');
});

for (const theme of ['light', 'dark'] as const) {
  test(`the map, card and chart pass axe checks (${theme})`, async ({ page }) => {
    await useTheme(page, theme);
    await openMap(page, '?country=TZA');
    await waitForFonts(page);
    await selectOnMap(page, 'mount-kilimanjaro', 'Mount Kilimanjaro');
    await waitForMap(page);
    await expectNoAxeViolations(page);
  });
}
