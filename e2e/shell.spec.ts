import { expect, test } from '@playwright/test';

import {
  ROUTES,
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  useTheme,
  waitForFonts,
} from './helpers';

for (const route of ROUTES) {
  test.describe(`${route.name} page`, () => {
    test('renders inside the shell with ribbon, nav and footer', async ({ page }) => {
      await page.goto(route.path);
      await expect(page.getByRole('heading', { level: 1, name: route.heading })).toBeVisible();
      await expect(
        page.getByRole('complementary', { name: 'Data behind this view' }),
      ).toBeVisible();
      await expect(page.getByRole('contentinfo')).toContainText('Natural Earth');
      await expect(page.getByRole('contentinfo')).toContainText(
        'do not imply endorsement of any border',
      );
    });

    test('has no horizontal overflow, including at 320px wide', async ({ page }) => {
      await page.goto(route.path);
      await waitForFonts(page);
      await expectNoHorizontalOverflow(page);
      await page.setViewportSize({ width: 320, height: 640 });
      await expectNoHorizontalOverflow(page);
    });

    for (const theme of ['light', 'dark'] as const) {
      test(`passes axe checks in ${theme} mode`, async ({ page }) => {
        await useTheme(page, theme);
        await page.goto(route.path);
        await waitForFonts(page);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expectNoAxeViolations(page);
      });
    }
  });
}

test('theme toggle persists and is applied before any app script runs', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByTestId('theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  // The inline bootstrap alone (no app JavaScript at all) must apply the stored theme, so there
  // is no flash of the wrong theme before the bundle loads.
  await page.route('**/*.js', (route) => route.abort());
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#root')).toBeEmpty();
});

test('follows the system colour scheme when no choice is stored', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/countries');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('unknown routes show the 404 page inside the shell', async ({ page }) => {
  await page.goto('/no-such-page');
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  // The shell (ribbon, header, footer) still surrounds the 404 content. The nav itself may be a
  // closed disclosure on mobile, so assert on the always-visible parts.
  await expect(page.getByRole('complementary', { name: 'Data behind this view' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Bara La Afrika' })).toBeVisible();
  await expect(page.getByRole('contentinfo')).toBeVisible();
});

test('skip link moves focus to the main content', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard-only flow');
  await page.goto('/countries');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main#main')).toBeFocused();
});

test('read-only date control explains itself on hover and focus', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the control is condensed into the details sheet on mobile');
  await page.goto('/countries');
  const control = page.getByTestId('ribbon-range');
  await control.focus();
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toHaveText("This page's data is not time-dependent");
  const box = await tooltip.boundingBox();
  const viewport = page.viewportSize();
  expect(box && viewport).toBeTruthy();
  if (box && viewport) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  }
  await page.keyboard.press('Escape');
  await expect(tooltip).toBeHidden();
});

test('mobile menu opens, lists all sections and closes on navigation', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'mobile-only');
  await page.goto('/');
  const menu = page.getByRole('button', { name: 'Open menu' });
  await menu.click();
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await expect(nav.getByRole('link', { name: /Harim/ })).toBeVisible();
  await expect(nav.getByText('Contemporary Africa')).toBeVisible();
  await nav.getByRole('link', { name: /Harim/ }).click();
  await expect(page).toHaveURL(/\/harim$/);
  await expect(page.getByRole('button', { name: 'Open menu' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expectNoHorizontalOverflow(page);
});

test('ribbon details sheet expands on mobile', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'mobile-only');
  await page.goto('/countries');
  await page.getByRole('button', { name: 'Show data details' }).click();
  await expect(page.getByText("This page's data is not time-dependent.")).toBeVisible();
});

test('touch targets in the header are at least 44px', async ({ page }) => {
  await page.goto('/');
  for (const target of await page.locator('header button, header a').all()) {
    if (!(await target.isVisible())) continue;
    const box = await target.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});
