#!/usr/bin/env node
import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, relative, resolve } from 'node:path';

type Severity = 'error' | 'warning' | 'info';

interface Diagnostic {
  code: string;
  severity: Severity;
  message: string;
  remediation: string;
  file?: string;
  line?: number;
}

const program = new Command();
program.name('homeframe').description('Build, migrate, and diagnose Homeframe applications.').version('0.1.0');

program.command('doctor')
  .description('Check source, built output, and optionally a deployed URL.')
  .option('--root <path>', 'project root', '.')
  .option('--dist <path>', 'built output path')
  .option('--url <url>', 'deployed application URL')
  .option('--json', 'emit machine-readable JSON')
  .option('--strict', 'treat warnings as errors')
  .action(async (options: {
    root: string;
    dist?: string;
    url?: string;
    json?: boolean;
    strict?: boolean;
  }) => {
    const root = resolve(options.root);
    const diagnostics = await doctorSource(root);
    const dist = options.dist ? resolve(root, options.dist) : resolve(root, 'dist');
    if (existsSync(dist)) diagnostics.push(...await doctorBuild(dist));
    else diagnostics.push(info('HF_DIST_MISSING', 'No dist directory was checked.', 'Run the production build, then rerun doctor.'));
    if (options.url) diagnostics.push(...await doctorDeployment(options.url));
    printDiagnostics(diagnostics, Boolean(options.json));
    const failed = diagnostics.some((item) => item.severity === 'error'
      || (options.strict && item.severity === 'warning'));
    if (failed) process.exitCode = 1;
  });

program.command('migrate')
  .description('Inventory an existing React PWA and produce a Homeframe migration report.')
  .option('--root <path>', 'project root', '.')
  .option('--dry-run', 'make no source changes', true)
  .option('--output <path>', 'report path', '.homeframe/migration-report.json')
  .action(async (options: { root: string; dryRun: boolean; output: string }) => {
    const root = resolve(options.root);
    const diagnostics = await doctorSource(root);
    const report = {
      generatedAt: new Date().toISOString(),
      root,
      dryRun: options.dryRun,
      diagnostics,
      phases: [
        'preserve manifest identity and inventory the current worker',
        'adopt generated document metadata and AppShell',
        'move body scrolling to AppScrollView and fixed controls to ViewportDock',
        'adapt the router and verify edge back/forward',
        'replace the worker at the same stable URL and canary update mode',
        'add app-owned install and notification nudge components',
      ],
    };
    const output = resolve(root, options.output);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Migration report written to ${output}`);
    console.log('No application files were changed.');
  });

program.command('init')
  .description('Create a Homeframe configuration without overwriting existing files.')
  .option('--root <path>', 'project root', '.')
  .action(async (options: { root: string }) => {
    const root = resolve(options.root);
    const output = resolve(root, 'homeframe.config.ts');
    if (existsSync(output)) throw new Error(`Refusing to overwrite ${output}`);
    await writeFile(output, `import { defineHomeframe } from '@homeframe/vite';\n\nexport default defineHomeframe({\n  app: {\n    id: '/',\n    name: 'My App',\n    shortName: 'My App',\n    startUrl: '/',\n    scope: '/',\n    themeColor: '#172554',\n    backgroundColor: '#172554',\n    icon: './brand/icon-1024.png',\n  },\n  serviceWorker: { update: { mode: 'automatic', reload: 'safe-point' } },\n});\n`);
    console.log(`Created ${output}`);
    console.log('Add homeframe(config) to Vite, wrap the React root with HomeframeProvider, then run homeframe doctor.');
  });

program.command('upgrade')
  .description('Print the required upgrade checks between Homeframe releases.')
  .requiredOption('--from <version>')
  .requiredOption('--to <version>')
  .action((options: { from: string; to: string }) => {
    console.log(JSON.stringify({
      from: options.from,
      to: options.to,
      automaticChanges: [],
      requiredChecks: [
        'read release notes and identity-impact notice',
        'run typecheck and unit tests',
        'diff manifest, generated assets, HTML, and service worker',
        'test update from the currently deployed worker',
        'run physical iOS keyboard, launch, edge-history, and notification smoke tests',
      ],
    }, null, 2));
  });

await program.parseAsync();

async function doctorSource(root: string): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const sourceFiles = await walk(root, (path) => {
    if (path.includes('/node_modules/') || path.includes('/dist/') || path.includes('/.git/')) return false;
    return ['.ts', '.tsx', '.js', '.jsx', '.css', '.html', '.json'].includes(extname(path));
  });
  const registrations: string[] = [];
  for (const file of sourceFiles) {
    const text = await readFile(file, 'utf8');
    const relativeFile = relative(root, file);
    for (const match of text.matchAll(/serviceWorker\s*\.\s*register\s*\(/g)) {
      registrations.push(`${relativeFile}:${lineAt(text, match.index)}`);
    }
    for (const match of text.matchAll(/\b(?:100vh|window\.innerHeight|visualViewport)\b/g)) {
      if (relativeFile.includes('homeframe.config')) continue;
      diagnostics.push(warning(
        'HF_RAW_VIEWPORT',
        `Raw viewport sizing API found: ${match[0]}.`,
        'Use Homeframe viewport variables or useViewport().',
        relativeFile,
        lineAt(text, match.index),
      ));
    }
    for (const match of text.matchAll(/font-size\s*:\s*(?:[0-9]|1[0-5](?:\.[0-9]+)?)px/gi)) {
      diagnostics.push(warning(
        'HF_INPUT_ZOOM',
        `Potential sub-16px text: ${match[0]}.`,
        'Ensure this rule cannot apply to an editable control, or use a Homeframe input primitive.',
        relativeFile,
        lineAt(text, match.index),
      ));
    }
    if (extname(file) === '.html') {
      for (const [name, pattern] of [
        ['viewport', /<meta[^>]+name=["']viewport["']/gi],
        ['manifest', /<link[^>]+rel=["']manifest["']/gi],
      ] as const) {
        const count = [...text.matchAll(pattern)].length;
        if (count > 0) diagnostics.push(warning(
          'HF_METADATA_OWNERSHIP',
          `${relativeFile} contains ${count} ${name} declaration(s).`,
          'Remove it and let the Homeframe build adapter generate the declaration.',
          relativeFile,
        ));
      }
    }
  }
  if (registrations.length > 1) diagnostics.push(error(
    'HF_MULTIPLE_SW_REGISTRATIONS',
    `Found multiple service-worker registrations: ${registrations.join(', ')}.`,
    'Keep one stable worker URL and let Homeframe own registration.',
  ));
  else if (registrations.length === 1) diagnostics.push(warning(
    'HF_LEGACY_SW_REGISTRATION',
    `Found app-owned service-worker registration at ${registrations[0]}.`,
    'Remove it after Homeframe is configured to replace the worker at the same URL and scope.',
  ));
  if (!sourceFiles.some((file) => basename(file) === 'homeframe.config.ts')) diagnostics.push(error(
    'HF_CONFIG_MISSING',
    'homeframe.config.ts was not found.',
    'Run homeframe init or add a validated configuration manually.',
  ));
  return diagnostics;
}

async function doctorBuild(dist: string): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const indexPath = resolve(dist, 'index.html');
  const manifestPath = resolve(dist, 'manifest.webmanifest');
  const workerPath = resolve(dist, 'sw.js');
  const requiredFiles: Array<[string, string, string]> = [
    [indexPath, 'HF_INDEX_MISSING', 'built index.html'],
    [manifestPath, 'HF_MANIFEST_MISSING', 'generated manifest'],
    [workerPath, 'HF_SW_MISSING', 'generated service worker'],
  ];
  for (const [path, code, label] of requiredFiles) {
    if (!existsSync(path)) diagnostics.push(error(code, `Missing ${label}.`, 'Run the Homeframe production build and inspect plugin configuration.'));
  }
  if (existsSync(indexPath)) {
    const html = await readFile(indexPath, 'utf8');
    const checks: Array<[string, RegExp, string]> = [
      ['HF_VIEWPORT_META', /viewport-fit=cover/, 'edge-to-edge viewport metadata'],
      ['HF_BOOT_SPLASH', /id="homeframe-boot-splash"/, 'static boot splash'],
      ['HF_BOOT_SCRIPT', /id="homeframe-bootstrap"/, 'pre-React bootstrap'],
      ['HF_APPLE_ICON', /rel="apple-touch-icon"/, 'Apple touch icon'],
      ['HF_MANIFEST_LINK', /rel="manifest"/, 'manifest link'],
    ];
    for (const [code, pattern, label] of checks) {
      if (!pattern.test(html)) diagnostics.push(error(code, `Built HTML lacks ${label}.`, 'Ensure Homeframe owns transformIndexHtml.'));
    }
  }
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
      for (const field of ['id', 'name', 'short_name', 'start_url', 'scope', 'display', 'background_color', 'theme_color', 'icons']) {
        if (manifest[field] == null) diagnostics.push(error('HF_MANIFEST_FIELD', `Manifest field ${field} is missing.`, 'Set it in homeframe.config.ts.'));
      }
      const icons = Array.isArray(manifest.icons) ? manifest.icons as Array<Record<string, unknown>> : [];
      for (const size of ['192x192', '512x512']) {
        if (!icons.some((icon) => String(icon.sizes).includes(size))) diagnostics.push(error('HF_ICON_SIZE', `Manifest icon ${size} is missing.`, 'Provide valid source artwork and rebuild.'));
      }
      if (!icons.some((icon) => String(icon.purpose).includes('maskable'))) diagnostics.push(error('HF_MASKABLE_ICON', 'Maskable icon is missing.', 'Provide maskable source artwork or use the generated padded icon.'));
    } catch (reason) {
      diagnostics.push(error('HF_MANIFEST_INVALID', `Manifest JSON is invalid: ${message(reason)}`, 'Rebuild after correcting configuration.'));
    }
  }
  if (existsSync(workerPath)) {
    const worker = await readFile(workerPath, 'utf8');
    const capabilities: Array<[string, string]> = [
      ['HF_UPDATE_READY', 'atomic update signaling'],
      ['notificationclick', 'notification click routing'],
      ['homeframe-cache-meta', 'bounded runtime-cache metadata'],
      ['HF_SKIP_WAITING', 'configurable activation'],
    ];
    for (const [token, label] of capabilities) {
      if (!worker.includes(token)) diagnostics.push(error('HF_SW_CAPABILITY', `Worker lacks ${label}.`, 'Regenerate it with @homeframe/vite.'));
    }
  }
  const reportPath = resolve(dist, 'generated/asset-report.json');
  if (!existsSync(reportPath)) diagnostics.push(error('HF_ASSET_REPORT', 'Generated asset report is missing.', 'Run a full Homeframe build.'));
  return diagnostics;
}

async function doctorDeployment(urlValue: string): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const base = new URL(urlValue);
  const resources = [
    { url: new URL('sw.js', base), kind: 'worker' },
    { url: base, kind: 'html' },
    { url: new URL('manifest.webmanifest', base), kind: 'manifest' },
  ];
  for (const resource of resources) {
    try {
      const response = await fetch(resource.url, { redirect: 'follow' });
      if (!response.ok) {
        diagnostics.push(error('HF_DEPLOY_FETCH', `${resource.kind} returned ${response.status} at ${resource.url}.`, 'Fix the deployment route and content.'));
        continue;
      }
      const cacheControl = response.headers.get('cache-control') ?? '';
      const contentType = response.headers.get('content-type') ?? '';
      if (resource.kind === 'worker' && !/no-cache|max-age=0|must-revalidate/i.test(cacheControl)) {
        diagnostics.push(warning('HF_SW_CACHE_HEADER', `sw.js has unsafe Cache-Control: ${cacheControl || '(missing)'}.`, 'Serve sw.js with no-cache or max-age=0, must-revalidate.'));
      }
      if (resource.kind === 'manifest' && !/manifest|json/i.test(contentType)) {
        diagnostics.push(error('HF_MANIFEST_CONTENT_TYPE', `Manifest Content-Type is ${contentType || '(missing)'}.`, 'Serve application/manifest+json or application/json.'));
      }
    } catch (reason) {
      diagnostics.push(error('HF_DEPLOY_NETWORK', `Could not inspect ${resource.url}: ${message(reason)}`, 'Verify DNS, TLS, and deployment availability.'));
    }
  }
  return diagnostics;
}

async function walk(root: string, include: (path: string) => boolean): Promise<string[]> {
  const output: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        if (!path.includes('/node_modules/') && !path.includes('/.git/') && !path.includes('/dist/')) await visit(path);
      } else if (entry.isFile() && include(path)) output.push(path);
    }
  }
  await visit(root);
  return output;
}

function lineAt(text: string, index = 0): number {
  return text.slice(0, index).split('\n').length;
}

function diagnostic(severity: Severity, code: string, messageText: string, remediation: string, file?: string, line?: number): Diagnostic {
  return { severity, code, message: messageText, remediation, ...(file ? { file } : {}), ...(line ? { line } : {}) };
}

function error(code: string, messageText: string, remediation: string, file?: string, line?: number): Diagnostic {
  return diagnostic('error', code, messageText, remediation, file, line);
}

function warning(code: string, messageText: string, remediation: string, file?: string, line?: number): Diagnostic {
  return diagnostic('warning', code, messageText, remediation, file, line);
}

function info(code: string, messageText: string, remediation: string): Diagnostic {
  return diagnostic('info', code, messageText, remediation);
}

function printDiagnostics(diagnostics: Diagnostic[], json: boolean): void {
  if (json) {
    console.log(JSON.stringify({ diagnostics, summary: summary(diagnostics) }, null, 2));
    return;
  }
  if (diagnostics.length === 0) console.log('✓ Homeframe doctor found no issues.');
  for (const item of diagnostics) {
    const marker = item.severity === 'error' ? '✗' : item.severity === 'warning' ? '!' : 'i';
    const location = item.file ? ` ${item.file}${item.line ? `:${item.line}` : ''}` : '';
    console.log(`${marker} ${item.code}${location}\n  ${item.message}\n  Fix: ${item.remediation}`);
  }
  const totals = summary(diagnostics);
  console.log(`\n${totals.errors} error(s), ${totals.warnings} warning(s), ${totals.info} info`);
}

function summary(diagnostics: Diagnostic[]) {
  return {
    errors: diagnostics.filter((item) => item.severity === 'error').length,
    warnings: diagnostics.filter((item) => item.severity === 'warning').length,
    info: diagnostics.filter((item) => item.severity === 'info').length,
  };
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
