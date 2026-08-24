import { describe, expect, it } from 'vitest';
import { bootSplashMarkup } from '../../packages/vite/src/splash.js';

describe('boot splash markup', () => {
  it('omits the title element when splash.title is empty', () => {
    const markup = bootSplashMarkup({
      inlineLogo: 'data:image/png;base64,logo',
      title: '',
      appName: 'Fallback app name',
    });

    expect(markup).toContain('<img');
    expect(markup).not.toContain('<span');
    expect(markup).not.toContain('Fallback app name');
  });

  it('falls back to the app name only when splash.title is absent', () => {
    const markup = bootSplashMarkup({
      inlineLogo: 'data:image/png;base64,logo',
      title: undefined,
      appName: 'Home & Work',
    });

    expect(markup).toContain('<span>Home &amp; Work</span>');
  });
});
