import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/?e2e=1');
  await expect(page.locator('[data-hf-shell]')).toBeVisible();
});

test('paints a contained shell with safe header, scroll root, and bottom dock', async ({ page }) => {
  const layout = await page.evaluate(() => {
    const header = document.querySelector('[data-hf-header]')!.getBoundingClientRect();
    const dock = document.querySelector('[data-hf-dock]')!.getBoundingClientRect();
    const viewport = document.querySelector('[data-hf-viewport]')!.getBoundingClientRect();
    return {
      windowScrollY: window.scrollY,
      headerTop: header.top,
      dockBottom: dock.bottom,
      viewportTop: viewport.top,
      viewportBottom: viewport.bottom,
      viewportPosition: getComputedStyle(document.querySelector('[data-hf-viewport]')!).position,
      rootBackground: getComputedStyle(document.documentElement).backgroundColor,
      bodyPosition: getComputedStyle(document.body).position,
      dockBackground: getComputedStyle(document.querySelector('[data-hf-dock]')!).backgroundColor,
    };
  });
  expect(layout.windowScrollY).toBe(0);
  expect(Math.abs(layout.headerTop - layout.viewportTop)).toBeLessThanOrEqual(1);
  expect(Math.abs(layout.dockBottom - layout.viewportBottom)).toBeLessThanOrEqual(1);
  expect(layout.viewportPosition).toBe('absolute');
  expect(layout.rootBackground).not.toBe('rgba(0, 0, 0, 0)');
  expect(layout.bodyPosition).not.toBe('fixed');
  if (await page.evaluate(() => innerWidth < 800)) {
    expect(layout.dockBackground).not.toBe('rgba(0, 0, 0, 0)');
  }
});

test('uses 16px inputs, keeps the document fixed, and swaps bottom nav for composer', async ({ page }) => {
  await page.locator('.bottom-nav').getByRole('link', { name: /Keyboard/ }).click();
  const input = page.getByPlaceholder('Type text');
  await input.click();
  expect(await input.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.getByPlaceholder('Persistent bottom composer')).toBeVisible();
  await page.getByPlaceholder('Persistent bottom composer').fill('survives');
  await expect(page.locator('[data-hf-header]')).toBeVisible();
});

test('navigates through real history without reloading the shell and restores scroll', async ({ page }) => {
  await page.evaluate(() => { (window as Window & { __documentToken?: string }).__documentToken = crypto.randomUUID(); });
  const token = await page.evaluate(() => (window as Window & { __documentToken?: string }).__documentToken);
  await page.locator('.bottom-nav').getByRole('link', { name: /History/ }).click();
  const scroller = page.locator('[data-hf-scroll-view]');
  await scroller.evaluate((element) => {
    element.scrollTop = 900;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  const before = await scroller.evaluate((element) => element.scrollTop);
  await page.getByRole('link', { name: /Restoration item 12/ }).evaluate((element: HTMLElement) => element.click());
  await expect(page.getByRole('heading', { name: /History destination 12/ })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: /Scroll, navigate/ })).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { __documentToken?: string }).__documentToken)).toBe(token);
  expect(await scroller.evaluate((element) => element.scrollTop)).toBeCloseTo(before, -1);
});

test('button navigation starts the destination at the top while history restores it', async ({ page }) => {
  const scroller = page.locator('[data-hf-scroll-view]');
  await scroller.evaluate((element) => { element.scrollTop = 700; });
  await page.locator('.bottom-nav').getByRole('link', { name: /History/ }).click();
  await expect(page.getByRole('heading', { name: /Scroll, navigate/ })).toBeVisible();
  expect(await scroller.evaluate((element) => element.scrollTop)).toBe(0);

  await scroller.evaluate((element) => {
    element.scrollTop = 650;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await page.locator('.bottom-nav').getByRole('link', { name: /PWA/ }).click();
  expect(await scroller.evaluate((element) => element.scrollTop)).toBe(0);
  await page.goBack();
  await expect(page.getByRole('heading', { name: /Scroll, navigate/ })).toBeVisible();
  expect(await scroller.evaluate((element) => element.scrollTop)).toBeCloseTo(650, -1);
});

test('generated metadata and worker expose the required PWA contract', async ({ page, request }) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest).toMatchObject({ id: '/', start_url: '/', scope: '/', display: 'standalone' });
  expect(manifest.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ sizes: '192x192' }),
    expect.objectContaining({ sizes: '512x512' }),
    expect.objectContaining({ purpose: 'maskable' }),
  ]));
  const worker = await (await request.get('/sw.js')).text();
  expect(worker).toContain('HF_UPDATE_READY');
  expect(worker).toContain('notificationclick');
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /viewport-fit=cover/);
  await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute('content', 'dark');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toContain('dark');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
});

test('serves the app shell for a deep route while offline after installation', async ({ page, context }) => {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
    });
  });
  await page.reload();
  await context.setOffline(true);
  await page.goto('/history/8');
  await expect(page.getByRole('heading', { name: 'History destination 8' })).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('default selection policy suppresses UI text but keeps declared copy targets selectable', async ({ page }) => {
  const values = await page.evaluate(() => ({
    ordinary: getComputedStyle(document.querySelector('.copy-card p')!).userSelect,
    selectable: getComputedStyle(document.querySelector('[data-hf-selectable]')!).userSelect,
  }));
  expect(values.ordinary).toBe('none');
  expect(values.selectable).toBe('text');
});
