import AxeBuilder from '@axe-core/playwright';
import { type Page, expect } from '@playwright/test';

export const ROUTES = [
  { path: '/', name: 'home', heading: 'Bara La Afrika' },
  { path: '/countries', name: 'countries', heading: 'Countries' },
  { path: '/harim', name: 'harim', heading: 'Harim · Mountains of Africa' },
  { path: '/dhahabu', name: 'dhahabu', heading: 'Dhahabu · Gold in Africa' },
] as const;

/** Sets the stored theme before any page script runs (as a returning visitor would have). */
export async function useTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.addInitScript((value) => {
    window.localStorage.setItem('bla-theme', value);
  }, theme);
}

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'page must not scroll horizontally').toBeLessThanOrEqual(0);
}

export async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);
}

/** Waits for web fonts so screenshots and layout checks see final metrics. */
export async function waitForFonts(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

/** Waits until the page has finished every running CSS animation (e.g. the map's fade-in). */
export async function waitForAnimations(page: Page): Promise<void> {
  await page.evaluate(async () => {
    // A cancelled animation (its element removed, e.g. a skeleton replaced by data) rejects.
    await Promise.all(
      document.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
    );
  });
}

/** Waits for a route's loaded data (not its skeleton), so checks see the real page. */
export async function waitForContent(page: Page, path: string): Promise<void> {
  if (path === '/') {
    // All 54 country controls of the rendered map.
    await expect(page.getByTestId('africa-map').locator('[role="button"][data-iso3]')).toHaveCount(
      54,
    );
  }
  if (path === '/countries') {
    // The table or cards, with their 54 flag controls.
    await expect(page.getByTestId('flag-button')).toHaveCount(54);
  }
  if (path.startsWith('/harim')) {
    // One expandable row (or card) per country, and the statistics band's final figures.
    await expect(page.getByTestId('harim-country-toggle')).toHaveCount(54);
    await waitForStats(page);
    await waitForMap(page);
  }
}

/** Waits until the statistics band shows its cards and has finished counting up. */
export async function waitForStats(page: Page): Promise<void> {
  await expect(page.getByTestId('stat-card').first()).toBeVisible();
  await expect(page.locator('[data-counting]')).toHaveCount(0);
}

/** Waits until the Harim map shows its peaks and any camera move has finished. */
export async function waitForMap(page: Page): Promise<void> {
  await expect(
    page.getByTestId('harim-map-peak').or(page.getByTestId('harim-map-group')).first(),
  ).toBeAttached();
  let last = '';
  await expect
    .poll(
      async () => {
        await page.waitForTimeout(200);
        const now = (await page.getByTestId('harim-map').getAttribute('data-zoom')) ?? '';
        const settled = now === last;
        last = now;
        return settled;
      },
      { intervals: [0] },
    )
    .toBe(true);
}
