import { rm } from 'node:fs/promises';
import { glob } from 'node:fs/promises';

for await (const entry of glob('{packages,examples}/*/dist')) {
  await rm(entry, { recursive: true, force: true });
}
