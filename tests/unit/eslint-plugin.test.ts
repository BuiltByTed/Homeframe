import { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';
import homeframe from '../../packages/eslint-plugin/src/index.js';

describe('@homeframe/eslint-plugin', () => {
  it('reports raw history/viewport, document scroll, fixed UI, and unsafe controls', () => {
    const linter = new Linter();
    const messages = linter.verify(`
      window.history.pushState({}, '', '/next');
      const viewport = window.visualViewport;
      window.scrollTo(0, 20);
      export const View = () => <div style={{ position: 'fixed' }}>
        <input style={{ fontSize: 12 }} />
      </div>;
    `, [{
      files: ['**/*.{js,jsx}'],
      plugins: { homeframe: homeframe as never },
      languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        parserOptions: { ecmaFeatures: { jsx: true } },
      },
      rules: {
        'homeframe/no-raw-history': 'error',
        'homeframe/no-raw-viewport': 'error',
        'homeframe/no-document-scroll': 'error',
        'homeframe/no-untracked-fixed-position': 'error',
        'homeframe/no-unsafe-input-size': 'error',
      },
    }], { filename: 'fixture.jsx' });

    expect(messages.map((item) => item.ruleId)).toEqual(expect.arrayContaining([
      'homeframe/no-raw-history',
      'homeframe/no-raw-viewport',
      'homeframe/no-document-scroll',
      'homeframe/no-untracked-fixed-position',
      'homeframe/no-unsafe-input-size',
    ]));
    expect(messages.filter((item) => item.fatal)).toEqual([]);
  });
});
