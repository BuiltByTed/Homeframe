import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scaffoldProject } from '../../packages/scaffold/src/index.js';
import { doctorSource } from '../../packages/cli/src/index.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe('scaffold-homeframe-app', () => {
  it('creates a complete guarded starter without unresolved template tokens', async () => {
    const fixture = await fixtureDirectory();
    const target = join(fixture, 'my-homeframe-app');
    const result = await scaffoldProject(target, {
      appName: 'Ted & Co',
      packageName: '@builtbyted/my-app',
      install: false,
    });

    expect(result).toMatchObject({
      root: target,
      appName: 'Ted & Co',
      packageName: '@builtbyted/my-app',
      installed: false,
    });
    expect(result.files).toEqual(expect.arrayContaining([
      '.gitignore',
      'AGENTS.md',
      'docs/HOMEFRAME_RUNBOOK.md',
      'src/App.tsx',
      'homeframe.config.ts',
    ]));

    const packageJson = JSON.parse(await readFile(join(target, 'package.json'), 'utf8')) as {
      name: string;
      dependencies: Record<string, string>;
    };
    expect(packageJson.name).toBe('@builtbyted/my-app');
    expect(packageJson.dependencies['@builtbyted/homeframe']).toBe('0.1.4');
    expect(await readFile(join(target, 'index.html'), 'utf8')).toContain('<title>Ted &amp; Co</title>');
    expect(await readFile(join(target, 'homeframe.config.ts'), 'utf8')).toContain('name: "Ted & Co"');
    const agentContract = await readFile(join(target, 'AGENTS.md'), 'utf8');
    const runbook = await readFile(join(target, 'docs/HOMEFRAME_RUNBOOK.md'), 'utf8');
    expect(agentContract).toContain('Mount `AppShell` above `RouterOutlet`');
    expect(agentContract).toContain('it may be keyed by route for scroll');
    expect(agentContract).toContain('scroll a long route/thread while the keyboard is open');
    expect(agentContract).toContain('`ViewportAttachment` per edge');
    expect(agentContract).toContain('`HF_UNTRACKED_VIEWPORT_UI`');
    expect(runbook).toContain('route-local `PageFrame` that mounts its own `AppShell`');
    expect(runbook).toContain('Record separate native iPhone Simulator videos');
    expect(runbook).toContain("`splash.title: ''` intentionally");
    expect(runbook).toContain('generates no title element');
    expect(runbook).toContain('headerAttachment={<VideoPlayer />}');
    expect(runbook).toContain('homeframe doctor --strict');

    for (const file of result.files) {
      expect(await readFile(join(target, file), 'utf8')).not.toMatch(/__HOMEFRAME_[A-Z_]+__/);
    }

    const diagnostics = await doctorSource(target);
    expect(diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
  });

  it('refuses to overwrite an existing project', async () => {
    const fixture = await fixtureDirectory();
    const target = join(fixture, 'existing-app');
    await mkdir(target);
    await writeFile(join(target, 'keep.txt'), 'user data');

    await expect(scaffoldProject(target, { install: false })).rejects.toThrow('is not empty');
    expect(await readFile(join(target, 'keep.txt'), 'utf8')).toBe('user data');
  });
});

async function fixtureDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'homeframe-scaffold-'));
  temporaryDirectories.push(directory);
  return directory;
}
