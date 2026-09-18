import { expect, test, type Page } from '@playwright/test';

async function launch(page: Page, { mobile, installed, height = 785 }: { mobile: boolean; installed: boolean; height?: number }) {
  await page.setViewportSize({ width: mobile ? 390 : 1280, height: mobile ? height : 800 });
  await page.addInitScript(({ mobile, installed }) => {
    Object.defineProperties(navigator, {
      userAgent: { configurable: true, value: mobile ? 'iPhone' : 'Chrome Windows' },
      platform: { configurable: true, value: mobile ? 'iPhone' : 'Win32' },
      maxTouchPoints: { configurable: true, value: mobile ? 5 : 0 },
      standalone: { configurable: true, value: mobile && installed },
      userAgentData: { configurable: true, value: { mobile } },
    });
    Object.defineProperties(screen, {
      width: { configurable: true, value: mobile ? 390 : 1920 },
      height: { configurable: true, value: mobile ? 844 : 1080 },
    });
    const matchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query) => {
      const result = matchMedia(query);
      if (query.includes('display-mode')) {
        Object.defineProperty(result, 'matches', { value: installed && query === '(display-mode: standalone)' });
      }
      return result;
    };
  }, { mobile, installed });
  // Hold the app before its first commit so the real generated head, CSS and
  // inline logo are tested without React immediately dismissing the splash.
  await page.route('**/assets/*.js', (route) => route.abort());
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-hf-ready', 'false');
}

for (const scenario of [
  { name: 'desktop browser', mobile: false, installed: false, splash: false },
  { name: 'desktop installed app', mobile: false, installed: true, splash: false },
  { name: 'mobile browser', mobile: true, installed: false, splash: false },
  { name: 'mobile installed app', mobile: true, installed: true, splash: true },
]) {
  test(`${scenario.name} applies the splash policy before app code loads`, async ({ page }) => {
    await launch(page, scenario);
    const splash = page.locator('#homeframe-boot-splash');
    if (scenario.splash) await expect(splash).toBeVisible();
    else await expect(splash).toBeHidden();
    await page.evaluate(() => {
      document.documentElement.dataset.hfReady = 'true';
      document.documentElement.dataset.hfSplashVisible = 'brand';
      const reactSplash = document.createElement('div');
      reactSplash.dataset.hfReactSplash = '';
      reactSplash.textContent = 'Custom splash';
      document.body.appendChild(reactSplash);
    });
    if (scenario.splash) {
      await expect(splash).toBeVisible();
      await expect(page.locator('[data-hf-react-splash]')).toBeVisible();
    } else {
      await expect(splash).toBeHidden();
      await expect(page.locator('[data-hf-react-splash]')).toBeHidden();
    }
    await page.evaluate(() => { delete document.documentElement.dataset.hfSplashVisible; });
    await expect(splash).toBeHidden();
  });
}

test('opaque iOS launch keeps the physical logo center while the status-bar viewport settles', async ({ page }) => {
  await launch(page, { mobile: true, installed: true, height: 844 });
  for (const height of [844, 785, 792, 785]) {
    await page.setViewportSize({ width: 390, height });
    await expect.poll(async () => {
      const box = await page.locator('#homeframe-boot-splash img').boundingBox();
      return Math.abs(box!.y + box!.height / 2 + (844 - height) - 844 / 2);
    }).toBeLessThan(1);
    const box = await page.locator('#homeframe-boot-splash img').boundingBox();
    expect(Math.abs(box!.width - 390 * 0.22)).toBeLessThan(1);
  }
  const before = await page.locator('#homeframe-boot-splash img').boundingBox();
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--hf-shell-height', '400px');
    document.documentElement.style.setProperty('--hf-safe-top', '59px');
    document.documentElement.style.setProperty('--hf-safe-bottom', '34px');
    document.documentElement.dataset.hfViewportOwner = 'runtime';
  });
  expect(await page.locator('#homeframe-boot-splash img').boundingBox()).toEqual(before);
});

test('desktop privacy snapshots still cover content without showing the launch icon', async ({ page }) => {
  await launch(page, { mobile: false, installed: true });
  await page.evaluate(() => {
    document.documentElement.dataset.hfReady = 'true';
    document.documentElement.dataset.hfSplashVisible = 'privacy';
  });
  await expect(page.locator('#homeframe-boot-splash')).toBeVisible();
  await expect(page.locator('#homeframe-boot-splash img')).toBeHidden();
});

test('a stale layout height cannot push the opaque launch logo below its native center', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
  });
  await launch(page, { mobile: true, installed: true, height: 785 });
  const logo = page.locator('#homeframe-boot-splash img');
  const center = async () => {
    const box = await logo.boundingBox();
    return box!.y + box!.height / 2;
  };
  await expect.poll(center).toBeCloseTo(363, 0);
  for (const reportedHeight of [785, 844, 785]) {
    await page.evaluate(height => {
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
      window.dispatchEvent(new Event('resize'));
    }, reportedHeight);
    await expect.poll(center).toBeCloseTo(363, 0);
  }
});

test('the installed-app manifest does not opt into icon masking', async ({ request }) => {
  const response = await request.get('/manifest.webmanifest');
  expect(response.ok()).toBe(true);
  const manifest = await response.json() as { icons: Array<{ purpose: string; src: string }> };
  expect(manifest.icons).toHaveLength(2);
  expect(manifest.icons.every((icon) => icon.purpose === 'any')).toBe(true);
});
