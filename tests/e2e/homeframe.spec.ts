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

async function navigateFromShell(page: Page, name: RegExp) {
  const desktopNavigation = page.locator('.desktop-sidebar-nav');
  const navigation = await desktopNavigation.isVisible()
    ? desktopNavigation
    : page.locator('.bottom-nav');
  await navigation.getByRole('link', { name }).click();
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
      headerBackground: getComputedStyle(document.querySelector('[data-hf-header]')!).backgroundColor,
      topBarBackground: getComputedStyle(document.querySelector('.top-bar')!).backgroundColor,
      dockBackground: getComputedStyle(document.querySelector('[data-hf-dock]')!).backgroundColor,
      bottomBackground: getComputedStyle(document.querySelector('.bottom-nav')!).backgroundColor,
    };
  });
  expect(layout.windowScrollY).toBe(0);
  expect(Math.abs(layout.headerTop - layout.viewportTop)).toBeLessThanOrEqual(1);
  expect(Math.abs(layout.dockBottom - layout.viewportBottom)).toBeLessThanOrEqual(1);
  expect(layout.viewportPosition).toBe('fixed');
  expect(layout.rootBackground).not.toBe('rgba(0, 0, 0, 0)');
  expect(layout.bodyPosition).not.toBe('fixed');
  expect(layout.headerBackground).toBe(layout.topBarBackground);
  if (await page.evaluate(() => innerWidth < 800)) {
    expect(layout.dockBackground).not.toBe('rgba(0, 0, 0, 0)');
    expect(layout.dockBackground).toBe(layout.bottomBackground);
  }
});

test('desktop shell supports an icon rail, a hidden sidebar, pinned actions, and both header spans', async ({ page }) => {
  if (await page.evaluate(() => innerWidth < 900)) return;
  const shell = page.locator('[data-hf-shell]');
  const sidebar = page.locator('[data-hf-sidebar]');
  const footer = page.locator('[data-hf-sidebar-footer]');
  await expect(sidebar).toBeVisible();
  await expect(shell).toHaveAttribute('data-hf-sidebar-mode', 'expanded');
  await expect(shell).toHaveAttribute('data-hf-header-placement', 'full');

  const expanded = await sidebar.boundingBox();
  const footerBox = await footer.boundingBox();
  expect(expanded!.width).toBeGreaterThan(240);
  expect(Math.abs((footerBox!.y + footerBox!.height) - (expanded!.y + expanded!.height))).toBeLessThanOrEqual(1);

  await page.getByRole('button', { name: 'Icon rail sidebar' }).click();
  await expect(shell).toHaveAttribute('data-hf-sidebar-mode', 'rail');
  await expect.poll(async () => (await sidebar.boundingBox())?.width).toBeLessThanOrEqual(73);
  expect(await page.evaluate(() => localStorage.getItem('homeframe-demo:sidebar-mode'))).toBe('rail');

  await page.getByRole('button', { name: 'Keep header over sidebar only' }).click();
  await expect(shell).toHaveAttribute('data-hf-header-placement', 'sidebar');
  const [railBox, headerBox] = await Promise.all([
    sidebar.boundingBox(),
    page.locator('[data-hf-header]').boundingBox(),
  ]);
  expect(Math.abs(headerBox!.width - railBox!.width)).toBeLessThanOrEqual(1);

  await page.getByRole('button', { name: 'Hidden sidebar' }).click();
  await expect(shell).toHaveAttribute('data-hf-sidebar-mode', 'hidden');
  await expect(sidebar).toBeHidden();
  await expect(page.getByRole('button', { name: 'Show navigation' })).toBeVisible();
  await page.getByRole('button', { name: 'Show navigation' }).click();
  await expect(shell).toHaveAttribute('data-hf-sidebar-mode', 'expanded');
  await expect(sidebar).toBeVisible();

  await page.setViewportSize({ width: 899, height: 720 });
  await expect(sidebar).toBeHidden();
  await expect(page.locator('.bottom-nav')).toBeVisible();
  await expect.poll(async () => (await page.locator('[data-hf-header]').boundingBox())?.width).toBe(899);

  await page.setViewportSize({ width: 1024, height: 720 });
  await expect(sidebar).toBeVisible();
  await expect(page.locator('.bottom-nav')).toBeHidden();
  await expect.poll(async () => (await sidebar.boundingBox())?.width).toBe(224);
});

test('uses 16px inputs, keeps the document fixed, and swaps bottom nav for composer', async ({ page }) => {
  await navigateFromShell(page, /Keyboard/);
  const input = page.getByPlaceholder('Type text');
  await input.click();
  expect(await input.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.getByPlaceholder('Persistent bottom composer')).toBeVisible();
  await page.getByPlaceholder('Persistent bottom composer').fill('survives');
  const dockTransition = await page.locator('[data-hf-dock]').evaluate((element) => {
    const root = document.documentElement;
    const previousDisplayMode = root.dataset.hfDisplayMode;
    const previousKeyboardMotion = root.dataset.hfKeyboardMotion;
    root.dataset.hfDisplayMode = 'standalone';
    root.dataset.hfKeyboardMotion = 'fallback';
    const style = getComputedStyle(element);
    const result = {
      duration: style.transitionDuration,
      easing: style.transitionTimingFunction,
    };
    if (previousDisplayMode === undefined) delete root.dataset.hfDisplayMode;
    else root.dataset.hfDisplayMode = previousDisplayMode;
    if (previousKeyboardMotion === undefined) delete root.dataset.hfKeyboardMotion;
    else root.dataset.hfKeyboardMotion = previousKeyboardMotion;
    return result;
  });
  expect(dockTransition.duration).toContain('0.205s');
  expect(dockTransition.easing).toContain('linear');
  await expect(page.locator('[data-hf-header]')).toBeVisible();
});

test('a vertical drag beginning on a dock input scrolls content without focusing it', async ({ page }) => {
  await navigateFromShell(page, /Keyboard/);
  const composer = page.getByPlaceholder('Persistent bottom composer');
  await verticalTouchDrag(page, 'input[placeholder="Persistent bottom composer"]');
  await expect(composer).not.toBeFocused();
  await expect.poll(() => page.locator('[data-hf-scroll-view]').evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await composer.click();
  await expect(composer).toBeFocused();
});

test('route-scoped scroll views restore through real history without reloading the shell', async ({ page }) => {
  await page.evaluate(() => { (window as Window & { __documentToken?: string }).__documentToken = crypto.randomUUID(); });
  const token = await page.evaluate(() => (window as Window & { __documentToken?: string }).__documentToken);
  await navigateFromShell(page, /History/);
  const scroller = page.locator('[data-hf-scroll-view]');
  await scroller.evaluate((element) => {
    element.scrollTop = 900;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  const before = await scroller.evaluate((element) => element.scrollTop);
  await page.getByRole('link', { name: /Restoration item 12/ }).evaluate((element: HTMLElement) => element.click());
  await expect(page.getByRole('heading', { name: /History destination 12/ })).toBeVisible();
  await page.evaluate(() => {
    const observer = new MutationObserver(() => {
      const list = document.querySelector<HTMLElement>('.history-list');
      if (!list) return;
      observer.disconnect();
      list.hidden = true;
      window.setTimeout(() => { list.hidden = false; }, 250);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
  await page.goBack();
  await expect(page.getByRole('heading', { name: /Scroll, navigate/ })).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { __documentToken?: string }).__documentToken)).toBe(token);
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeCloseTo(before, -1);
});

test('button navigation starts the destination at the top while history restores it', async ({ page }) => {
  const scroller = page.locator('[data-hf-scroll-view]');
  await scroller.evaluate((element) => { element.scrollTop = 700; });
  await navigateFromShell(page, /History/);
  await expect(page.getByRole('heading', { name: /Scroll, navigate/ })).toBeVisible();
  expect(await scroller.evaluate((element) => element.scrollTop)).toBe(0);

  await scroller.evaluate((element) => {
    element.scrollTop = 650;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await navigateFromShell(page, /PWA/);
  expect(await scroller.evaluate((element) => element.scrollTop)).toBe(0);
  await page.goBack();
  await expect(page.getByRole('heading', { name: /Scroll, navigate/ })).toBeVisible();
  expect(await scroller.evaluate((element) => element.scrollTop)).toBeCloseTo(650, -1);
});

test('cold-launch permalinks restore route, view state, anchors, and exact scroll', async ({ page }) => {
  await page.goto('/permalinks/release-board?mode=compact&filter=keyboard&__hf_offset=12#permalink-item-7');
  await expect(page.getByRole('heading', { name: 'Cold-launch view: release-board' })).toBeVisible();
  await expect(page.getByLabel('Permalink layout')).toHaveValue('compact');
  await expect(page.getByLabel('Permalink filter')).toHaveValue('keyboard');
  const scroller = page.locator('[data-hf-scroll-view]');
  const anchor = page.locator('#permalink-item-7');
  await expect(anchor).toBeVisible();
  await expect.poll(async () => {
    const [scrollBox, anchorBox] = await Promise.all([scroller.boundingBox(), anchor.boundingBox()]);
    return Math.round((anchorBox?.y ?? 0) - (scrollBox?.y ?? 0));
  }).toBe(12);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  await scroller.evaluate((element) => {
    element.scrollTop = 340;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await page.getByRole('button', { name: 'Capture this exact scroll position' }).click();
  const captured = await page.locator('.permalink-output code').textContent();
  expect(captured).toContain('__hf_scroll=340');
  await page.goto(captured!);
  await expect(page.getByRole('heading', { name: 'Cold-launch view: release-board' })).toBeVisible();
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeCloseTo(340, -1);
});

test('generated metadata and worker expose the required PWA contract', async ({ page, request }) => {
  const html = await (await request.get('/')).text();
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
  expect(html).toContain('html,body{height:100vh;min-height:100vh');
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /viewport-fit=cover/);
  await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute('content', /light|dark/);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toContain('light');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  expect(await page.evaluate(() => window.__HOMEFRAME_BUILD__)).toMatchObject({
    serviceWorkerConfig: { mode: 'automatic', reload: 'safe-point' },
    reactConfig: {
      selection: 'controls-only',
      snapshot: 'preserve',
      bottomDock: 'avoid',
      notifications: { transport: { endpoint: '/api/push/subscriptions' } },
    },
    routerConfig: { historyMode: 'auto' },
  });
});

test('internal links suppress iOS drag previews during route transitions', async ({ page }) => {
  await navigateFromShell(page, /History/);
  const link = page.locator('.history-card').first();
  await expect(link).toHaveAttribute('draggable', 'false');
  expect(await link.evaluate((element) => {
    const drag = new DragEvent('dragstart', { bubbles: true, cancelable: true });
    element.dispatchEvent(drag);
    return drag.defaultPrevented;
  })).toBe(true);
});

test('badge UI reports the count actually sent and clears it', async ({ page }) => {
  await navigateFromShell(page, /PWA/);
  await page.evaluate(() => {
    const calls: Array<number | 'clear'> = [];
    (window as Window & { __badgeCalls?: Array<number | 'clear'> }).__badgeCalls = calls;
    Object.defineProperty(navigator, 'setAppBadge', {
      configurable: true,
      value: async (count: number) => { calls.push(count); },
    });
    Object.defineProperty(navigator, 'clearAppBadge', {
      configurable: true,
      value: async () => { calls.push('clear'); },
    });
  });
  const card = page.locator('.capability-card').filter({ hasText: 'App badge' });
  await card.getByRole('button', { name: 'Set next badge' }).click();
  await expect(card.locator('code')).toHaveText('1');
  await expect(card.getByText('Home Screen badge set to 1.')).toBeVisible();
  await card.getByRole('button', { name: 'Clear app badge' }).click();
  await expect(card.locator('code')).toHaveText('clear');
  await expect(card.getByText('Home Screen badge cleared.')).toBeVisible();
  expect(await page.evaluate(() => (
    window as Window & { __badgeCalls?: Array<number | 'clear'> }
  ).__badgeCalls)).toEqual([1, 'clear']);
});

test('iOS install education points to Safari Add to Home Screen', async ({ page }) => {
  const isIos = await page.evaluate(() => /iPad|iPhone|iPod/.test(navigator.userAgent));
  if (!isIos) return;
  await navigateFromShell(page, /PWA/);
  const install = page.locator('.capability-card').filter({ hasText: 'Install' });
  await expect(install.getByText(/Safari.*Share.*Add to Home Screen/)).toBeVisible();
  await expect(install.getByRole('button', { name: /install/i })).toHaveCount(0);
});

test('preserve snapshot policy does not reinsert the brand icon on foreground', async ({ page }) => {
  const splashValues = await page.evaluate(async () => {
    const values: Array<string | null> = [];
    const observer = new MutationObserver(() => {
      values.push(document.documentElement.getAttribute('data-hf-splash-visible'));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-hf-splash-visible'],
    });
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((resolve) => setTimeout(resolve, 30));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((resolve) => setTimeout(resolve, 80));
    observer.disconnect();
    return values;
  });
  expect(splashValues).not.toContain('brand');
});

test('settings can force and persist light, dark, or system appearance', async ({ page }) => {
  await page.locator('.icon-button').click();
  const appearance = page.getByRole('combobox', { name: 'Appearance' });
  await expect(appearance).toHaveValue('system');

  await appearance.selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-hf-demo-theme', 'dark');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toContain('dark');
  await expect(page.locator('meta[name="theme-color"][content="#0b1429"]')).toHaveAttribute('media', 'all');

  await page.reload();
  await expect(appearance).toHaveValue('dark');
  await appearance.selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-hf-demo-theme', 'light');
  await expect(page.locator('meta[name="theme-color"][content="#e8f0ff"]')).toHaveAttribute('media', 'all');

  await appearance.selectOption('system');
  await expect(appearance).toHaveValue('system');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('meta[name="theme-color"][content="#0b1429"]')).toHaveAttribute('media', 'all');
  await expect(page.locator('html')).toHaveAttribute('data-hf-demo-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('meta[name="theme-color"][content="#e8f0ff"]')).toHaveAttribute('media', 'all');
  await expect(page.locator('html')).toHaveAttribute('data-hf-demo-theme', 'light');
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
