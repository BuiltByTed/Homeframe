import { expect, test } from '@playwright/test';

for (const side of ['left', 'right'] as const) {
  test(`${side} panel narrows the whole shell, overlays, then fills mobile without losing state`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?e2e=1');
    const trigger = page.getByRole('button', { name: 'Open side panel' });
    await trigger.click();
    await page.getByLabel('Panel side').selectOption(side);
    const panel = page.locator('[data-hf-side-panel]');
    const layer = page.locator('[data-hf-side-panel-layer]');
    const shell = page.locator('[data-hf-shell]');
    await expect(layer).toHaveAttribute('data-hf-side-panel-presentation', 'push');
    await expect.poll(async () => (await shell.boundingBox())!.width).toBe(1040);
    const shellBox = (await shell.boundingBox())!;
    const panelBox = (await panel.boundingBox())!;
    expect(panelBox.width).toBe(400);
    expect(panelBox.height).toBe(900);
    expect(panelBox.y).toBe(0);
    expect(panelBox.x).toBe(side === 'left' ? 0 : 1040);
    expect(shellBox.x).toBe(side === 'left' ? 400 : 0);
    const headerBox = (await page.locator('[data-hf-header]').boundingBox())!;
    expect(headerBox.width).toBe(shellBox.width);
    expect(headerBox.x).toBe(shellBox.x);
    await page.evaluate(() => {
      (window as unknown as { savedShell: Element }).savedShell = document.querySelector('[data-hf-shell]')!;
    });
    await page.getByLabel('Panel draft').fill('A persistent draft');
    const panelContent = page.locator('[data-hf-side-panel-content]');
    await panelContent.evaluate(element => { element.scrollTop = 300; });
    const routeScroll = await page.locator('[data-hf-scroll-view]').evaluate(element => element.scrollTop);

    await page.setViewportSize({ width: 1000, height: 800 });
    await expect(layer).toHaveAttribute('data-hf-side-panel-presentation', 'overlay');
    await expect(panel).toHaveAttribute('aria-modal', 'true');
    await expect.poll(async () => (await shell.boundingBox())!.width).toBe(1000);
    expect((await panel.boundingBox())!.width).toBe(400);
    expect(await page.locator('[data-hf-side-panel-app]').evaluate(element => (element as HTMLElement).inert)).toBe(true);
    // Tab wraps inside the modal, including when focus starts on the last field.
    await page.getByLabel('Panel draft').focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Close panel' })).toBeFocused();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(layer).toHaveAttribute('data-hf-side-panel-presentation', 'fullscreen');
    await expect.poll(async () => (await panel.boundingBox())!.width).toBe(390);
    expect((await panel.boundingBox())!.x).toBe(0);
    expect((await panel.boundingBox())!.height).toBe(844);
    expect(await page.getByLabel('Panel draft').inputValue()).toBe('A persistent draft');
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(await page.locator('[data-hf-scroll-view]').evaluate(element => element.scrollTop)).toBe(routeScroll);
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.click();
    expect(await page.getByLabel('Panel draft').inputValue()).toBe('A persistent draft');
    expect(await panelContent.evaluate(element => element.scrollTop)).toBe(300);
    expect(await page.evaluate(() => (window as unknown as { savedShell: Element }).savedShell === document.querySelector('[data-hf-shell]'))).toBe(true);
    await page.getByRole('button', { name: 'Close panel' }).click();
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect.poll(async () => (await shell.boundingBox())!.width).toBe(1440);
  });
}

test('panel footer stays in the measured keyboard-visible area and reduced motion disables sliding', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Open side panel' }).click();
  const panel = page.locator('[data-hf-side-panel]');
  const before = await page.locator('[data-hf-header]').boundingBox();
  await page.getByLabel('Panel draft').focus();
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport!, 'height', { configurable: true, value: 520 });
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  await expect.poll(async () => (await panel.boundingBox())!.height).toBe(520);
  const footer = (await page.locator('[data-hf-side-panel-footer]').boundingBox())!;
  expect(footer.y + footer.height).toBeLessThanOrEqual(520);
  expect((await page.locator('[data-hf-header]').boundingBox())!.y).toBe(before!.y);
  expect(await panel.evaluate(element => Number.parseFloat(getComputedStyle(element).transitionDuration))).toBeLessThanOrEqual(0.001);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});
