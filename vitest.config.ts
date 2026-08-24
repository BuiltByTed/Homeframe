import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const source = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@homeframe/runtime': source('./packages/runtime/src/index.ts'),
      '@homeframe/react': source('./packages/react/src/index.tsx'),
      '@homeframe/router': source('./packages/router/src/index.tsx'),
      '@homeframe/sw': source('./packages/sw/src/index.ts'),
      '@homeframe/vite': source('./packages/vite/src/index.ts'),
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
