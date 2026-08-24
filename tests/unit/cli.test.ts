import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { doctorBuild, doctorSource, inventoryProject, program } from '../../packages/cli/src/index.js';
import { generateServiceWorker } from '@homeframe/sw';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe('Homeframe doctor built-output checks', () => {
  it('discovers and validates a non-default generated worker path', async () => {
    const dist = await fixtureDirectory();
    await writeFixture(dist, 'index.html', `<!doctype html>
      <html><head>
        <meta name="viewport" content="width=device-width,viewport-fit=cover">
        <link rel="manifest" href="/manifest.webmanifest">
        <link rel="apple-touch-icon" href="/generated/apple-touch-icon.png">
        <script id="homeframe-bootstrap">window.__HOMEFRAME_BUILD__={}</script>
      </head><body><div id="homeframe-boot-splash"></div></body></html>`);
    await writeFixture(dist, 'manifest.webmanifest', JSON.stringify({
      id: '/',
      name: 'Fixture',
      short_name: 'Fixture',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#000000',
      theme_color: '#000000',
      icons: [
        { src: '/192.png', sizes: '192x192', purpose: 'any' },
        { src: '/512.png', sizes: '512x512', purpose: 'any' },
        { src: '/mask.png', sizes: '512x512', purpose: 'maskable' },
      ],
    }));
    await writeFixture(dist, 'homeframe-build.json', JSON.stringify({
      serviceWorker: '/service-worker.js',
    }));
    await writeFixture(dist, 'service-worker.js', generateServiceWorker({
      appId: '/',
      buildId: 'fixture-build',
      scope: '/',
      documentFallback: '/',
      precache: [{ url: '/', revision: 'document-revision' }],
    }));
    await writeFixture(dist, 'generated/asset-report.json', '[]');

    const diagnostics = await doctorBuild(dist);
    expect(diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
  });

  it('reports a configured worker that is absent instead of assuming sw.js', async () => {
    const dist = await fixtureDirectory();
    await writeFixture(dist, 'homeframe-build.json', JSON.stringify({
      serviceWorker: '/service-worker.js',
    }));

    const diagnostics = await doctorBuild(dist);
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'HF_SW_MISSING', severity: 'error' }),
    ]));
  });
});

describe('Homeframe adoption inventory and init', () => {
  it('preserves manifest identity and reports existing PWA/layout ownership', async () => {
    const root = await fixtureDirectory();
    await writeFixture(root, 'package.json', JSON.stringify({
      name: 'existing-app',
      dependencies: { react: '19.0.0', 'react-router-dom': '7.0.0' },
      devDependencies: { vite: '8.0.0' },
    }));
    await writeFixture(root, 'vite.config.ts', 'export default { plugins: [] };');
    await writeFixture(root, 'src/main.tsx', `navigator.serviceWorker.register('/service-worker.js');
      const height = window.visualViewport?.height;
      document.body.style.height = '100vh';`);
    await writeFixture(root, 'public/manifest.webmanifest', JSON.stringify({
      id: '/existing',
      name: 'Existing App',
      short_name: 'Existing',
      start_url: '/existing',
      scope: '/',
      display: 'standalone',
      theme_color: '#010203',
      background_color: '#040506',
      icons: [{ src: '/icons/app.png', sizes: '512x512' }],
    }));
    await writeFixture(root, 'public/icons/app.png', 'fixture-icon');
    await writeFixture(root, 'index.html', '<meta name="viewport" content="width=device-width">');

    const inventory = await inventoryProject(root);
    expect(inventory).toMatchObject({
      packageName: 'existing-app',
      bundler: 'vite',
      react: { detected: true, entries: ['src/main.tsx'] },
      manifest: {
        identity: {
          id: '/existing',
          name: 'Existing App',
          startUrl: '/existing',
          iconSource: './public/icons/app.png',
        },
      },
      routerPackages: ['react-router-dom'],
    });
    expect(inventory.serviceWorker.registrations).toEqual([
      expect.objectContaining({ file: 'src/main.tsx', line: 1 }),
    ]);
    expect(inventory.riskyLayoutUses.map((item) => item.kind)).toEqual(expect.arrayContaining([
      'raw-viewport',
    ]));

    await program.parseAsync(['node', 'homeframe', 'init', '--root', root]);
    const generated = await readFile(join(root, 'homeframe.config.ts'), 'utf8');
    expect(generated).toContain("id: \"/existing\"");
    expect(generated).toContain("icon: \"./public/icons/app.png\"");
    const report = JSON.parse(await readFile(join(root, '.homeframe/init-report.json'), 'utf8')) as {
      preservedConflicts: string[];
    };
    expect(report.preservedConflicts).toEqual(expect.arrayContaining([
      expect.stringContaining('Existing manifest'),
      expect.stringContaining('service-worker registration'),
    ]));
  });

  it('inventories a legacy Workbox worker and non-Vite project without mutating it', async () => {
    const root = await fixtureDirectory();
    await writeFixture(root, 'package.json', JSON.stringify({
      name: 'legacy-pwa',
      dependencies: { react: '18.3.0', 'react-router-dom': '6.30.0' },
      devDependencies: { webpack: '5.99.0', 'workbox-webpack-plugin': '7.3.0' },
    }));
    await writeFixture(root, 'src/index.jsx', "navigator.serviceWorker.register('/service-worker.js');");
    await writeFixture(root, 'src/service-worker.js', `
      import { precacheAndRoute } from 'workbox-precaching';
      caches.open('legacy-media-v4');
      precacheAndRoute(self.__WB_MANIFEST);
    `);
    await writeFixture(root, 'public/manifest.json', JSON.stringify({
      id: '/legacy', name: 'Legacy', short_name: 'Legacy', start_url: '/legacy', scope: '/',
    }));
    const before = await readFile(join(root, 'src/service-worker.js'), 'utf8');
    const inventory = await inventoryProject(root);
    expect(inventory).toMatchObject({
      bundler: 'other',
      routerPackages: ['react-router-dom'],
      serviceWorker: {
        candidateFiles: ['src/service-worker.js'],
        cacheNames: ['legacy-media-v4'],
      },
    });
    expect(await readFile(join(root, 'src/service-worker.js'), 'utf8')).toBe(before);
  });
});

describe('Homeframe source doctor', () => {
  it('checks editable controls without treating captions or test fixtures as runtime defects', async () => {
    const root = await fixtureDirectory();
    await writeFixture(root, 'homeframe.config.ts', 'export default {};');
    await writeFixture(root, 'src/styles.css', `
      .caption { font-size: 10px; }
      input, .browser-cache-controls select { font-size: 12px; }
      textarea { font-size: 16px; }
    `);
    await writeFixture(root, 'e2e/viewport.spec.ts', `
      expect(window.visualViewport?.height).toBeGreaterThan(0);
      document.body.style.height = '100vh';
    `);

    const diagnostics = await doctorSource(root);
    expect(diagnostics.filter((item) => item.code === 'HF_RAW_VIEWPORT')).toEqual([]);
    expect(diagnostics.filter((item) => item.code === 'HF_INPUT_ZOOM')).toEqual([
      expect.objectContaining({
        file: 'src/styles.css',
        message: expect.stringContaining('12px'),
      }),
    ]);
  });
});

async function fixtureDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'homeframe-doctor-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeFixture(root: string, relativePath: string, contents: string): Promise<void> {
  const path = join(root, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}
