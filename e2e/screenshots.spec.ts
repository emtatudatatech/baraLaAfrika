import { test } from '@playwright/test';

import { ROUTES, useTheme, waitForAnimations, waitForFonts } from './helpers';

/**
 * Captures every page at desktop (1440×900) and mobile (390×844) in light and dark mode into
 * ./screenshots for visual review. Run with `npm run screenshots`.
 */
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, isMobile: false },
  { name: 'mobile', width: 390, height: 844, isMobile: true },
] as const;

for (const viewport of VIEWPORTS) {
  for (const theme of ['light', 'dark'] as const) {
    for (const route of ROUTES) {
      test(`${route.name} ${viewport.name} ${theme}`, async ({ browser }) => {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          deviceScaleFactor: viewport.isMobile ? 3 : 1,
          isMobile: viewport.isMobile,
          hasTouch: viewport.isMobile,
        });
        const page = await context.newPage();
        await useTheme(page, theme);
        await page.goto(route.path);
        await waitForFonts(page);
        if (route.path === '/') {
          await page.locator('[data-testid="africa-map"] [data-iso3]').first().waitFor();
        }
        if (route.path === '/countries') {
          // The loaded list (the skeleton's sheen would never finish animating).
          await page.getByTestId('flag-button').first().waitFor();
        }
        await waitForAnimations(page);
        // A full-page capture does not scroll, so lazy images below the fold would stay blank.
        await page.evaluate(async () => {
          const images = [...document.images];
          for (const image of images) image.loading = 'eager';
          await Promise.all(images.map((image) => image.decode().catch(() => undefined)));
        });
        await page.screenshot({
          path: `screenshots/${route.name}-${viewport.name}-${theme}.png`,
          fullPage: true,
        });
        await context.close();
      });
    }
  }
}
