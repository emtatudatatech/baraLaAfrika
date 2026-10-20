import { test as base } from '@playwright/test';

export { expect, type Locator, type Page } from '@playwright/test';

const READY = 'html[data-app="ready"]';

/**
 * The main pages paint prerendered markup before the app has loaded, and a click on that markup
 * does nothing until the app hydrates it. Tests act like a reader who waits for the page to be
 * live: `page.goto` and `page.reload` return once the app has started (<html data-app="ready">,
 * set by AppReady). Without script (or with it blocked) that never happens; they then return
 * after a short wait and the test checks what the markup alone shows.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    const ready = async () => {
      await page
        .locator(READY)
        .waitFor({ state: 'attached', timeout: 5000 })
        .catch(() => undefined);
    };
    const goto = page.goto.bind(page);
    const reload = page.reload.bind(page);
    page.goto = async (...args: Parameters<typeof goto>) => {
      const response = await goto(...args);
      await ready();
      return response;
    };
    page.reload = async (...args: Parameters<typeof reload>) => {
      const response = await reload(...args);
      await ready();
      return response;
    };
    await use(page);
  },
});
