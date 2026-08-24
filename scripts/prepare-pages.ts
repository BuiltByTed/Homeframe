import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const output = resolve(import.meta.dirname, '../examples/kitchen-sink/dist');
const document = resolve(output, 'index.html');

// GitHub Pages serves this document for unknown paths. Keeping the same scoped
// app shell lets Homeframe resolve direct links without a document refresh.
await copyFile(document, resolve(output, '404.html'));

// GitHub Pages returns a custom 404 document with status 404 even when its body
// is the application shell. Safari can briefly expose that network error before
// painting the shell. Emit physical documents for every stable demo entry point
// so cold launches and shared permalinks begin with a 200 response.
const stableRoutes = [
  'keyboard',
  'history',
  'permalinks/release-board',
  'pwa',
  'settings',
  '__homeframe/recovery',
  ...Array.from({ length: 30 }, (_, index) => `history/${index + 1}`),
];
for (const route of stableRoutes) {
  const directory = resolve(output, route);
  await mkdir(directory, { recursive: true });
  await copyFile(document, resolve(directory, 'index.html'));
}
await writeFile(resolve(output, '.nojekyll'), '');
