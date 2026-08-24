import { chromium } from 'playwright';

const baseURL = process.env.HOMEFRAME_TEST_URL ?? 'http://127.0.0.1:4180';
const cdpURL = process.env.HOMEFRAME_CDP_URL;
const headless = process.env.HEADLESS === 'true';
const browser = cdpURL
  ? await chromium.connectOverCDP(cdpURL)
  : await chromium.launch({ headless });
const context = cdpURL
  ? browser.contexts()[0]
  : await browser.newContext();
if (!context) throw new Error('The connected Chrome instance has no default browser context.');
await context.grantPermissions(['notifications'], { origin: new URL(baseURL).origin });
const page = cdpURL
  ? context.pages()[0] ?? await context.newPage()
  : await context.newPage();
page.on('console', (message) => {
  if (message.type() === 'error') console.error(`Browser console: ${message.text()}`);
});

try {
  await page.goto(new URL('/pwa?push-smoke=1', baseURL).href);
  await page.locator('[data-hf-shell]').waitFor();
  const permission = await page.evaluate(() => Notification.permission);
  if (permission !== 'granted') {
    throw new Error(
      `Notification permission is ${permission}. Chromium disables the Notifications API in headless mode; run a headed browser or set HOMEFRAME_CDP_URL to a headed Chrome debugging endpoint.`,
    );
  }
  await page.getByRole('button', { name: 'Enable push' }).click();
  const notifications = page.locator('.capability-card').filter({ hasText: 'Notifications' });
  try {
    await notifications.locator('code').filter({ hasText: 'subscribed' }).waitFor({ timeout: 15_000 });
  } catch (error) {
    console.error(`Notification card after subscription attempt:\n${await notifications.innerText()}`);
    throw error;
  }
  await page.getByRole('button', { name: 'Send real web push' }).click();
  await notifications.getByText(/Sent 1; failed 0\./).waitFor({ timeout: 20_000 });
  const status = await (await context.request.get(new URL('/api/push/status', baseURL).href)).json();
  if (status.subscriptions < 1) throw new Error('Push server did not retain the subscription.');
  console.log(JSON.stringify({ ok: true, baseURL, subscriptions: status.subscriptions }, null, 2));
} finally {
  await browser.close();
}
