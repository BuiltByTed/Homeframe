import { copyFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const output = resolve(import.meta.dirname, '../examples/kitchen-sink/dist');

// GitHub Pages serves this document for unknown paths. Keeping the same scoped
// app shell lets Homeframe resolve direct links without a document refresh.
await copyFile(resolve(output, 'index.html'), resolve(output, '404.html'));
await writeFile(resolve(output, '.nojekyll'), '');
