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
