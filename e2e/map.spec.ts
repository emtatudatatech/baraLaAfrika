import { type Page, expect, test } from './fixtures';

import { expectNoHorizontalOverflow, useTheme, waitForAnimations } from './helpers';

const LIGHT = {
  north: 'rgb(193, 39, 45)',
  west: 'rgb(0, 158, 73)',
  central: 'rgb(252, 209, 22)',
  east: 'rgb(65, 143, 222)',
  southern: 'rgb(0, 20, 137)',
};
const DARK = { ...LIGHT, east: 'rgb(114, 182, 254)', southern: 'rgb(43, 90, 205)' };

async function openMap(page: Page) {
  await page.goto('/');
  const map = page.getByTestId('africa-map');
  await expect(map.locator('[role="button"][data-iso3]')).toHaveCount(54);
  await waitForAnimations(page);
  return map;
}

async function fillOf(page: Page, selector: string): Promise<string> {
  return page
    .locator(selector)
    .first()
    .evaluate((element) => getComputedStyle(element).fill);
}

test('draws all 54 countries in their approved region colours', async ({ page }) => {
  const map = await openMap(page);
  for (const [slug, rgb] of Object.entries(LIGHT)) {
    expect(await fillOf(page, `path[data-region="${slug}"]`)).toBe(rgb);
  }
  // Somaliland is merged into Somalia; Western Sahara is hatched and not a country button.
  await expect(map.locator('path[data-iso3="SOM"]')).toHaveCount(1);
  const westernSahara = map.locator('path[data-iso3="ESH"]');
  await expect(westernSahara).toHaveAttribute('aria-label', /Disputed territory/);
  await expect(westernSahara).not.toHaveAttribute('role', 'button');
  // Small states are reachable through markers.
  for (const iso3 of ['CPV', 'STP', 'COM', 'MUS', 'SYC', 'GMB', 'SWZ']) {
    await expect(map.locator(`g[data-iso3="${iso3}"][role="button"]`)).toHaveCount(1);
  }
});

test('dark theme lifts only the colours that need it, keeping their hue', async ({ page }) => {
  await useTheme(page, 'dark');
  await openMap(page);
  for (const [slug, rgb] of Object.entries(DARK)) {
    expect(await fillOf(page, `path[data-region="${slug}"]`)).toBe(rgb);
  }
});

test('the legend isolates a region and links to the table', async ({ page }) => {
  const map = await openMap(page);
  const legend = page.getByRole('region', { name: 'Regions' });
  const west = legend.getByRole('button', { name: /West Africa/ });
  await west.click();
  await expect(west).toHaveAttribute('aria-pressed', 'true');
  await expect(map.locator('path[data-region="east"]').first()).toHaveClass(/dimmed/);
  await expect(map.locator('path[data-region="west"]').first()).not.toHaveClass(/dimmed/);
  await expect(legend.getByRole('link', { name: 'View in table' })).toHaveAttribute(
    'href',
    '/countries?region=west',
  );
  await west.click();
  await expect(west).toHaveAttribute('aria-pressed', 'false');
  await expect(map.locator('path[data-region="east"]').first()).not.toHaveClass(/dimmed/);
});

test('clicking a country opens its profile; Escape closes it', async ({ page }) => {
  const map = await openMap(page);
  await map.locator('path[data-iso3="KEN"]').click();
  const popover = page.getByTestId('country-popover');
  await expect(popover.getByRole('heading', { name: 'Kenya' })).toBeVisible();
  await expect(popover).toContainText('Spotted Mountain');
  // The flag actually loads (from flagcdn.com, or the self-hosted fallback if the CDN fails).
  const flag = popover.getByRole('img', { name: 'Flag of Kenya' });
  await expect
    .poll(() => flag.evaluate((img) => (img as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  await expect(popover.getByRole('link', { name: 'See in table' })).toHaveAttribute(
    'href',
    '/countries?country=KEN',
  );
  const box = await popover.boundingBox();
  const viewport = page.viewportSize();
  expect(box && viewport && box.x >= 0 && box.x + box.width <= viewport.width).toBe(true);
  await page.keyboard.press('Escape');
  await expect(popover).toBeHidden();
  await expect(map.locator('path[data-iso3="KEN"]')).toBeFocused();
});

test('hovering shows a tooltip with the flag, name and region', async ({ page, isMobile }) => {
  test.skip(isMobile, 'hover only applies to pointers');
  const map = await openMap(page);
  await map.locator('path[data-iso3="NER"]').hover();
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toContainText('Niger');
  await expect(tooltip).toContainText('West Africa');
  const flag = tooltip.getByRole('img', { name: 'Flag of Niger' });
  await expect(flag).toBeVisible();
  await expect
    .poll(() => flag.evaluate((img) => (img as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
});

test('Somalia explains that its shape includes Somaliland', async ({ page, isMobile }) => {
  const map = await openMap(page);
  const somalia = map.locator('path[data-iso3="SOM"]');
  await expect(somalia).toHaveAccessibleDescription(/Includes Somaliland/);
  if (!isMobile) {
    await somalia.hover();
    await expect(page.getByRole('tooltip')).toContainText('Includes Somaliland');
    // Other countries carry no such note.
    await map.locator('path[data-iso3="ETH"]').hover();
    await expect(page.getByRole('tooltip')).toContainText('Ethiopia');
    await expect(page.getByRole('tooltip')).not.toContainText('Somaliland');
  }
  await somalia.click();
  const popover = page.getByTestId('country-popover');
  await expect(popover.getByRole('heading', { name: 'Somalia' })).toBeVisible();
  await expect(popover).toContainText('Includes Somaliland');
  await expect(page.locator('[data-iso3="ETH"]')).not.toHaveAttribute('aria-describedby');
});

test('countries are keyboard navigable with one tab stop', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard flow');
  const map = await openMap(page);
  const first = map.locator('[role="button"][tabindex="0"]');
  await expect(first).toHaveCount(1);
  await expect(first).toHaveAttribute('aria-label', 'Algeria, North Africa');
  await first.focus();
  await page.keyboard.press('ArrowRight');
  await expect(map.locator('[data-iso3="AGO"]')).toBeFocused();
  await expect(page.getByRole('tooltip')).toContainText('Angola');
  await page.keyboard.press('End');
  await expect(map.locator('[data-iso3="ZWE"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('country-popover')).toContainText('Zimbabwe');
});

test('zoom buttons zoom in, out and reset', async ({ page }) => {
  const map = await openMap(page);
  const layer = map.locator(':scope > g');
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(layer).toHaveAttribute('transform', /scale\(1\.6\)/);
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await page.getByRole('button', { name: 'Reset the map' }).click();
  await expect(layer).toHaveAttribute('transform', 'translate(0,0) scale(1)');
  await expect(page.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
});

test('on phones the legend is a chip row and the profile a bottom sheet', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'mobile layout');
  const map = await openMap(page);
  await expectNoHorizontalOverflow(page);
  const legend = page.getByRole('region', { name: 'Regions' });
  const mapBox = await map.boundingBox();
  const legendBox = await legend.boundingBox();
  expect(mapBox && legendBox && legendBox.y >= mapBox.y + mapBox.height).toBe(true);
  await map.locator('path[data-iso3="TCD"]').tap();
  const sheet = page.getByTestId('country-popover');
  await expect(sheet).toContainText('Chad');
  const sheetBox = await sheet.boundingBox();
  const viewport = page.viewportSize();
  expect(sheetBox && viewport && Math.round(sheetBox.y + sheetBox.height)).toBe(viewport?.height);
  await expectNoHorizontalOverflow(page);
});
