import { expect, test } from '@playwright/test';

test('presents an updated app when its desktop window is smaller than the screen', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window.screen, 'height', { configurable: true, value: 1080 });
    sessionStorage.setItem('hf:update-reload:-', String(Date.now()));
  });
  await page.goto('/?e2e=1');
  await expect(page.locator('html')).toHaveAttribute('data-hf-ready', 'true');
  await expect(page.locator('[data-hf-shell]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('hf:update-reload:-'))).toBeNull();
});
