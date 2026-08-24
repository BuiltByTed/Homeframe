import { glob } from 'node:fs/promises';

const forbidden: string[] = [];
for await (const path of glob('**/*.{js,jsx,mjs,cjs}', {
  exclude: [
    '**/node_modules/**',
    '**/dist/**',
    'coverage/**',
    'playwright-report/**',
    'test-results/**',
  ],
})) {
  forbidden.push(path);
}

if (forbidden.length > 0) {
  console.error('Authored executable source must be TypeScript:');
  for (const path of forbidden.sort()) console.error(`- ${path}`);
  process.exitCode = 1;
}
