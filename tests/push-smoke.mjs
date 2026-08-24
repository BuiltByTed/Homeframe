import { chromium } from 'playwright';

const baseURL = process.env.HOMEFRAME_TEST_URL ?? 'http://127.0.0.1:4180';
const headless = process.env.HEADLESS !== 'false';
const browser = await chromium.launch({ headless });
const context = await browser.newContext();
await context.grantPermissions(['notifications'], { origin: new URL(baseURL).origin });
const page = await context.newPage();
page.on('console', (message) => {
  if (message.type() === 'error') console.error(`Browser console: ${message.text()}`);
});

try {
  await page.goto(new URL('/pwa?push-smoke=1', baseURL).href);
  await page.locator('[data-hf-shell]').waitFor();
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
