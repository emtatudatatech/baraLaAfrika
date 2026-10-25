import { expect, test } from './fixtures';

import { useTheme } from './helpers';

/*
 * The main pages' prerendered first views (apps/web/build/prerender.ts): they are in the HTML,
 * readable without script, and the app hydrates them without a mismatch.
 */

const PAGES = [
  { path: '/', heading: 'Bara La Afrika' },
  { path: '/countries', heading: 'Countries' },
  { path: '/harim', heading: 'Harim · Mountains of Africa' },
  { path: '/dhahabu', heading: 'Dhahabu · Gold in Africa' },
  { path: '/vinara', heading: 'Vinara · The Cardinals of Africa' },
] as const;

for (const { path, heading } of PAGES) {
  test(`${path} ships its first view in the HTML and hydrates it cleanly`, async ({
    page,
    request,
  }) => {
    const html = await (await request.get(path)).text();
    expect(html).toContain('<div id="root"><');
    expect(html).toContain(heading);
    expect(html).toContain('src="/boot.js"');

    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    // Dark mode: the prerendered page is built light, so the theme must settle after hydration.
    await useTheme(page, 'dark');
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(heading);
    await expect(page.getByRole('button', { name: 'Switch to light theme' })).toBeVisible();
    // Interactive once hydrated: the theme toggle works.
    await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(errors).toEqual([]);
  });
}

test.describe('without script', () => {
  test.use({ javaScriptEnabled: false });

  test('the main pages are still readable: header, navigation and skeletons', async ({ page }) => {
    // Each page waits briefly for an app that never starts without script.
    test.setTimeout(60_000);
    for (const { path, heading } of PAGES) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toContainText(heading);
      // The site's name links home (the section links are a menu on phones, opened by script).
      await expect(page.getByRole('link', { name: 'Bara La Afrika' })).toBeVisible();
    }
    await page.goto('/harim');
    await expect(page.getByTestId('stats-skeleton')).toBeVisible();
  });
});

test('other paths get the plain app, not the home page’s markup', async ({ page, request }) => {
  const html = await (await request.get('/no-such-page')).text();
  expect(html).toContain('<div id="root"></div>');
  await page.goto('/no-such-page');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Page not found');
});

test('a URL with a query renders its own view', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/harim?view=peaks');
  await expect(page).toHaveURL(/view=peaks/);
  await expect(page.getByTestId('harim-view-peaks')).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});
