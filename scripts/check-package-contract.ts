import { access, readFile, readdir, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const homeframeRoot = resolve(root, 'packages/homeframe');
const dist = resolve(homeframeRoot, 'dist');
const internalPackages = ['runtime', 'sw', 'react', 'router', 'vite', 'eslint-plugin', 'cli'];
const requiredExports = ['.', './react', './router', './runtime', './runtime/styles.css', './sw', './vite', './eslint-plugin', './styles.css'];

const manifest = JSON.parse(await readFile(resolve(homeframeRoot, 'package.json'), 'utf8')) as {
  name?: string;
  private?: boolean;
  bin?: Record<string, string>;
  exports?: Record<string, unknown>;
};
assert(manifest.name === '@builtbyted/homeframe', 'Unified package name must be @builtbyted/homeframe.');
assert(manifest.private !== true, '@builtbyted/homeframe must be publishable.');
assert(manifest.bin?.homeframe === './dist/cli/index.js', 'Unified package must expose the homeframe CLI.');
for (const exportName of requiredExports) {
  assert(exportName in (manifest.exports ?? {}), `Missing package export ${exportName}.`);
}

for (const packageName of internalPackages) {
  const internal = JSON.parse(await readFile(resolve(root, `packages/${packageName}/package.json`), 'utf8')) as {
    private?: boolean;
  };
  assert(internal.private === true, `packages/${packageName} must remain a private build workspace.`);
}

const readme = await readFile(resolve(homeframeRoot, 'README.md'), 'utf8');
assert(readme.length >= 2_000, '@builtbyted/homeframe README is unexpectedly incomplete.');
assert(readme.includes('npx scaffold-homeframe-app'), 'README must lead with the scaffold command.');

const requiredFiles = [
  'index.js',
  'index.d.ts',
  'react/index.js',
  'react/index.d.ts',
  'react/styles.css',
  'router/index.js',
  'runtime/index.js',
  'runtime/styles.css',
  'sw/index.js',
  'vite/index.js',
  'eslint-plugin/index.js',
  'cli/index.js',
];
for (const file of requiredFiles) await access(resolve(dist, file));
const cli = await stat(resolve(dist, 'cli/index.js'));
assert((cli.mode & 0o111) !== 0, 'The homeframe CLI must be executable.');

const forbiddenImports = internalPackages.map((name) => `@builtbyted/${name}`);
for (const file of await walk(dist)) {
  if (!['.js', '.ts', '.css', '.map'].includes(extname(file))) continue;
  const contents = await readFile(file, 'utf8');
  for (const specifier of forbiddenImports) {
    assert(!contents.includes(specifier), `${file} leaks private workspace import ${specifier}.`);
  }
}

const scaffoldManifest = JSON.parse(await readFile(resolve(root, 'packages/scaffold/template/package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
};
assert(scaffoldManifest.dependencies?.['@builtbyted/homeframe'] === '0.1.0', 'Scaffold must pin @builtbyted/homeframe.');
assert(Object.keys(scaffoldManifest.dependencies ?? {}).filter((name) => name.startsWith('@builtbyted/')).length === 1,
  'Scaffold must depend on one public BuiltByTed package.');

for (const specifier of [
  '@builtbyted/homeframe',
  '@builtbyted/homeframe/react',
  '@builtbyted/homeframe/router',
  '@builtbyted/homeframe/runtime',
  '@builtbyted/homeframe/sw',
  '@builtbyted/homeframe/vite',
  '@builtbyted/homeframe/eslint-plugin',
]) {
  await import(specifier);
}

console.log('✓ Unified npm package contract is complete.');

async function walk(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
