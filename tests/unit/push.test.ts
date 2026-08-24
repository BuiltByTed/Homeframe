import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAppBadge } from '@builtbyted/sw';

afterEach(() => {
  Reflect.deleteProperty(navigator, 'setAppBadge');
  Reflect.deleteProperty(navigator, 'clearAppBadge');
});

describe('app badging', () => {
  it('uses the dedicated clear operation when available', async () => {
    const clearAppBadge = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clearAppBadge });

    await expect(setAppBadge()).resolves.toBe(true);
    expect(clearAppBadge).toHaveBeenCalledOnce();
  });

  it('falls back to setting zero on WebKit builds without clearAppBadge', async () => {
    const setBadge = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { setAppBadge: setBadge });

    await expect(setAppBadge()).resolves.toBe(true);
    expect(setBadge).toHaveBeenCalledWith(0);
  });
});
