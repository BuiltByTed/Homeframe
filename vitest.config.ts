import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const source = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@builtbyted/runtime': source('./packages/runtime/src/index.ts'),
      '@builtbyted/react': source('./packages/react/src/index.tsx'),
      '@builtbyted/router': source('./packages/router/src/index.tsx'),
      '@builtbyted/sw': source('./packages/sw/src/index.ts'),
      '@builtbyted/vite': source('./packages/vite/src/index.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    clearMocks: true,
    coverage: {
      include: ['packages/*/src/**/*.{ts,tsx}'],
      reporter: ['text', 'html'],
    },
  },
});
