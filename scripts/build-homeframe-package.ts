import { chmod, cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = resolve(workspaceRoot, 'packages/homeframe');
const outputRoot = resolve(packageRoot, 'dist');
const components = ['runtime', 'sw', 'react', 'router', 'vite', 'eslint-plugin', 'cli'] as const;
const publicSpecifiers = new Map(components.map((name) => [
  `@builtbyted/${name}`,
  `@builtbyted/homeframe/${name}`,
]));

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

for (const component of components) {
  const source = resolve(workspaceRoot, `packages/${component}/dist`);
  if (!(await stat(source).catch(() => null))?.isDirectory()) {
    throw new Error(`Missing ${relative(workspaceRoot, source)}. Build internal packages before @builtbyted/homeframe.`);
  }
  const destination = resolve(outputRoot, component);
  await cp(source, destination, { recursive: true });
  await rewriteTree(destination);
}

await writeFile(resolve(outputRoot, 'index.js'), [
  "export * from './react/index.js';",
  "export * from './router/index.js';",
  '',
].join('\n'));
await writeFile(resolve(outputRoot, 'index.d.ts'), [
  "export * from './react/index.js';",
  "export * from './router/index.js';",
  '',
].join('\n'));
await chmod(resolve(outputRoot, 'cli/index.js'), 0o755);

async function rewriteTree(root: string): Promise<void> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      await rewriteTree(path);
      continue;
    }
    if (!entry.isFile() || !['.js', '.ts', '.css', '.map'].includes(extname(path))) continue;
    let contents = await readFile(path, 'utf8');
    for (const [internalName, publicName] of publicSpecifiers) {
      contents = contents.replaceAll(internalName, publicName);
    }
    await writeFile(path, contents);
  }
}
