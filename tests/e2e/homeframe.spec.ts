import { expect, test, type Page } from '@playwright/test';

async function verticalTouchDrag(page: Page, selector: string) {
  const target = page.locator(selector);
  const box = await target.boundingBox();
  const cdp = await page.context().newCDPSession(page);
  const x = box!.x + box!.width / 2;
  const y = box!.y + box!.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let step = 1; step <= 8; step += 1) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: y - step * 25 }],
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

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

test('a vertical drag beginning on a dock input scrolls content without focusing it', async ({ page }) => {
  await page.locator('.bottom-nav').getByRole('link', { name: /Keyboard/ }).click();
  const composer = page.getByPlaceholder('Persistent bottom composer');
  await verticalTouchDrag(page, 'input[placeholder="Persistent bottom composer"]');
  await expect(composer).not.toBeFocused();
  await expect.poll(() => page.locator('[data-hf-scroll-view]').evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await composer.click();
  await expect(composer).toBeFocused();
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
  expect(await page.evaluate(() => window.__HOMEFRAME_BUILD__)).toMatchObject({
    serviceWorkerConfig: { mode: 'automatic', reload: 'safe-point' },
    reactConfig: {
      selection: 'controls-only',
      snapshot: 'brand',
      bottomDock: 'avoid',
      notifications: { transport: { endpoint: '/api/push/subscriptions' } },
    },
    routerConfig: { historyMode: 'auto' },
  });
});

test('deployment headers authorize the per-response bootstrap and never disguise missing assets or APIs as HTML', async ({ request }) => {
  const document = await request.get('/');
  const html = await document.text();
  const nonce = /<script[^>]+id="homeframe-bootstrap"[^>]+nonce="([^"]+)"/.exec(html)?.[1];
  expect(nonce).toBeTruthy();
  expect(document.headers()['content-security-policy']).toContain(`'nonce-${nonce}'`);
  expect(document.headers()['content-security-policy']).toContain("style-src-attr 'none'");
  expect(document.headers()['content-security-policy']).not.toContain("'unsafe-inline'");
  expect(html).toContain(`id="homeframe-runtime-vars" nonce="${nonce}"`);
  expect(html).toContain(`id="homeframe-critical" nonce="${nonce}"`);
  expect(document.headers()['x-content-type-options']).toBe('nosniff');

  const missingAsset = await request.get('/assets/definitely-missing.js');
  expect(missingAsset.status()).toBe(404);
  expect(missingAsset.headers()['content-type']).not.toContain('text/html');

  const missingApi = await request.get('/api/definitely-missing');
  expect(missingApi.status()).toBe(404);
  expect(missingApi.headers()['content-type']).toContain('application/json');

  const traversal = await request.get('/%2e%2e%2f%2e%2e%2fetc/passwd');
  expect([400, 403, 404]).toContain(traversal.status());
  expect(traversal.headers()['content-type']).not.toContain('text/html');
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

test('keeps the framework recovery route usable online and from the validated offline shell', async ({ page, context }) => {
  await page.goto('/__homeframe/recovery');
  await expect(page.getByRole('heading', { name: 'Homeframe recovery' })).toBeVisible();
  await expect(page.getByText('Current build')).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await context.setOffline(true);
  await page.goto('/__homeframe/recovery');
  await expect(page.getByRole('heading', { name: 'Homeframe recovery' })).toBeVisible();
});

test('default selection policy suppresses UI text but keeps declared copy targets selectable', async ({ page }) => {
  const values = await page.evaluate(() => ({
    ordinary: getComputedStyle(document.querySelector('.copy-card p')!).userSelect,
    selectable: getComputedStyle(document.querySelector('[data-hf-selectable]')!).userSelect,
  }));
  expect(values.ordinary).toBe('none');
  expect(values.selectable).toBe('text');
});
