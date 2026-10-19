import { test } from '@playwright/test';

import {
  ROUTES,
  useTheme,
  waitForAnimations,
  waitForContent,
  waitForFonts,
  waitForMap,
  waitForStats,
} from './helpers';

/**
 * Captures every page at desktop (1440×900) and mobile (390×844) in light and dark mode into
 * ./screenshots for visual review. Run with `npm run screenshots`.
 */
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, isMobile: false },
  { name: 'mobile', width: 390, height: 844, isMobile: true },
] as const;

/** Harim states worth reviewing beyond the default view. */
const HARIM_STATES = [
  { path: '/harim?region=east', name: 'harim-band-east', ready: 'stat-card' },
  { path: '/harim?country=TZA', name: 'harim-expanded', ready: 'country-peak' },
  { path: '/harim?view=peaks&sort=prominence', name: 'harim-peaks', ready: 'peak-name' },
  { path: '/harim?peak=mount-kilimanjaro', name: 'harim-drawer', ready: 'elevation-source' },
  { path: '/harim?view=ranges', name: 'harim-ranges', ready: 'harim-range-cards' },
  { path: '/harim/ranges/rwenzori', name: 'harim-range-page', ready: 'range-description' },
  { path: '/harim/peaks/mount-kenya', name: 'harim-peak-page', ready: 'peak-alternatives' },
] as const;

/** Dhahabu states worth reviewing beyond the default view. */
const DHAHABU_STATES = [
  { path: '/dhahabu?region=west', name: 'dhahabu-west', ready: 'gold-row' },
  { path: '/dhahabu?sort=holdings', name: 'dhahabu-holdings', ready: 'gold-row' },
  { path: '/dhahabu?from=2000&to=2015', name: 'dhahabu-2015', ready: 'gold-row' },
] as const;

const SHOTS = [
  ...ROUTES.map((route) => ({ path: route.path, name: route.name, ready: null })),
  ...HARIM_STATES,
  ...DHAHABU_STATES,
];

for (const viewport of VIEWPORTS) {
  for (const theme of ['light', 'dark'] as const) {
    for (const route of SHOTS) {
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
        // The loaded page (a skeleton's sheen would never finish animating).
        if (route.ready === null) await waitForContent(page, route.path);
        else await page.getByTestId(route.ready).first().waitFor();
        if (route.path.startsWith('/harim?') || route.path === '/harim') {
          await waitForStats(page);
          await waitForMap(page);
        }
        if (route.path.startsWith('/harim/ranges/')) await waitForMap(page);
        if (route.path.startsWith('/dhahabu')) await waitForStats(page);
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

/** The statistics bands alone, for review: desktop, and the phone carousel at several cards. */
const BANDS = [
  { name: 'harim-band', path: '/harim', testId: 'stats-band' },
  { name: 'dhahabu-band', path: '/dhahabu', testId: 'gold-stats-band' },
] as const;

for (const viewport of VIEWPORTS) {
  for (const theme of ['light', 'dark'] as const) {
    for (const shot of BANDS) {
      test(`${shot.name} ${viewport.name} ${theme}`, async ({ browser }) => {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          deviceScaleFactor: viewport.isMobile ? 3 : 1,
          isMobile: viewport.isMobile,
          hasTouch: viewport.isMobile,
        });
        const page = await context.newPage();
        await useTheme(page, theme);
        await page.goto(shot.path);
        await waitForFonts(page);
        await waitForStats(page);
        const band = page.getByTestId(shot.testId);
        // Flags in cards outside the carousel's view are lazy: load them before capturing.
        await band.evaluate(async (element) => {
          const images = [...element.querySelectorAll('img')];
          for (const image of images) image.loading = 'eager';
          await Promise.all(images.map((image) => image.decode().catch(() => undefined)));
        });
        const file = `screenshots/${shot.name}-${viewport.name}-${theme}`;
        if (!viewport.isMobile) {
          await band.screenshot({ path: `${file}.png` });
        } else {
          const dots = page.getByRole('group', { name: 'Choose a card' }).getByRole('button');
          for (const index of [0, 2, 4, 7]) {
            await dots.nth(index).click();
            await page.waitForTimeout(600);
            await band.screenshot({ path: `${file}-card${String(index + 1)}.png` });
          }
        }
        await context.close();
      });
    }
  }
}
