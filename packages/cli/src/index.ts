#!/usr/bin/env node
import { Command } from 'commander';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export type Severity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  code: string;
  severity: Severity;
  message: string;
  remediation: string;
  documentation: string;
  file?: string;
  line?: number;
}

export const program = new Command();
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
    const inventory = await inventoryProject(root);
    const report = {
      generatedAt: new Date().toISOString(),
      root,
      dryRun: options.dryRun,
      inventory,
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
    const inventory = await inventoryProject(root);
    if (!inventory.react.detected || inventory.bundler !== 'vite') {
      throw new Error('Homeframe init currently supports Vite React applications. Run migrate --dry-run for an unsupported project report.');
    }
    const output = resolve(root, 'homeframe.config.ts');
    if (existsSync(output)) throw new Error(`Refusing to overwrite ${output}`);
    const identity = inventory.manifest.identity;
    const brandDirectory = resolve(root, 'brand');
    await mkdir(brandDirectory, { recursive: true });
    const icon = identity.iconSource ?? './brand/icon.svg';
    if (!identity.iconSource) {
      const iconPath = resolve(brandDirectory, 'icon.svg');
      if (!existsSync(iconPath)) await writeFile(iconPath, starterIcon(identity.shortName || identity.name || 'H'));
    }
    await writeFile(output, `import { defineHomeframe } from '@homeframe/vite';\n\nexport default defineHomeframe({\n  app: {\n    id: ${JSON.stringify(identity.id || '/')},\n    name: ${JSON.stringify(identity.name || inventory.packageName || 'My App')},\n    shortName: ${JSON.stringify(identity.shortName || identity.name || inventory.packageName || 'My App')},\n    startUrl: ${JSON.stringify(identity.startUrl || '/')},\n    scope: ${JSON.stringify(identity.scope || '/')},\n    display: ${JSON.stringify(identity.display || 'standalone')},\n    colorScheme: 'system',\n    themeColor: ${JSON.stringify(identity.themeColor || '#172554')},\n    backgroundColor: ${JSON.stringify(identity.backgroundColor || '#172554')},\n    icon: ${JSON.stringify(icon)},\n  },\n  serviceWorker: { update: { mode: 'automatic', reload: 'safe-point' } },\n});\n`);
    const reportPath = resolve(root, '.homeframe/init-report.json');
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      created: [relative(root, output), ...(identity.iconSource ? [] : ['brand/icon.svg'])],
      preservedConflicts: inventory.conflicts,
      detected: {
        bundler: inventory.bundler,
        reactEntries: inventory.react.entries,
        viteConfigs: inventory.viteConfigs,
      },
      integration: {
        vite: "import { homeframe } from '@homeframe/vite'; import homeframeConfig from './homeframe.config'; then add homeframe(homeframeConfig) after react() in plugins.",
        react: "Import @homeframe/react/styles.css, then wrap the existing app with HomeframeProvider and one AppViewport; move chrome into AppShell only after device baselines exist.",
      },
    }, null, 2)}\n`);
    console.log(`Created ${output}`);
    console.log(`Inventory and non-overwrite integration report written to ${reportPath}`);
    console.log("Vite diff: import homeframe from @homeframe/vite and add homeframe(homeframeConfig) after react().");
    console.log('React diff: import Homeframe styles and wrap the existing root with HomeframeProvider + AppViewport after reviewing the migration report.');
    const diagnostics = await doctorSource(root);
    printDiagnostics(diagnostics, false);
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

const entryPoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === entryPoint) await program.parseAsync();

export async function doctorSource(root: string): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const sourceFiles = await walk(root, (path) => {
    if (path.includes('/node_modules/') || path.includes('/dist/') || path.includes('/.git/')) return false;
    const relativePath = relative(root, path).replaceAll('\\', '/');
    if (isTestSourceFile(relativePath)) return false;
    return ['.ts', '.tsx', '.js', '.jsx', '.css', '.html', '.json'].includes(extname(path));
  });
  const registrations: string[] = [];
  let notificationConfigFile: string | null = null;
  let subscriptionTransportFound = false;
  for (const file of sourceFiles) {
    const text = await readFile(file, 'utf8');
    const relativeFile = relative(root, file);
    if (/(?:subscriptionTransport|transport)\s*:/.test(text)) subscriptionTransportFound = true;
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
    if (extname(file) === '.css') {
      for (const block of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = block[1] ?? '';
        const declarations = block[2] ?? '';
        if (!selectorCanMatchEditable(selector)) continue;
        for (const match of declarations.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px\b/gi)) {
          if (Number(match[1]) >= 16) continue;
          const declarationOffset = block.index + selector.length + 1;
          diagnostics.push(warning(
            'HF_INPUT_ZOOM',
            `Editable selector has sub-16px text: ${match[0]}.`,
            'Use at least 16px for editable controls, or use a Homeframe input primitive.',
            relativeFile,
            lineAt(text, declarationOffset + match.index),
          ));
        }
      }
    }
    if (extname(file) === '.html') {
      for (const [name, pattern] of [
        ['viewport', /<meta[^>]+name=["']viewport["']/gi],
        ['manifest', /<link[^>]+rel=["']manifest["']/gi],
        ['app-capable', /<meta[^>]+name=["'](?:apple-mobile-web-app-capable|mobile-web-app-capable)["']/gi],
        ['status-bar', /<meta[^>]+name=["']apple-mobile-web-app-status-bar-style["']/gi],
        ['theme color', /<meta[^>]+name=["']theme-color["']/gi],
        ['Apple touch icon', /<link[^>]+rel=["']apple-touch-icon["']/gi],
        ['Apple startup image', /<link[^>]+rel=["']apple-touch-startup-image["']/gi],
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
    if (extname(file) === '.css') {
      for (const match of text.matchAll(/(?:^|[},])\s*(?:html|body|:root)(?:\s*,[^{}]+)?\s*\{([^}]*)/gim)) {
        if (!/(?:^|;)\s*background(?:-color)?\s*:/im.test(match[1] ?? '')) continue;
        diagnostics.push(warning(
          'HF_ROOT_BACKGROUND_OWNERSHIP',
          `Potential app-owned root background found in ${relativeFile}.`,
          'Use Homeframe app colors and keep application surfaces inside AppViewport.',
          relativeFile,
          lineAt(text, match.index),
        ));
      }
      for (const match of text.matchAll(/\b(?:html|body|:root)\b[^{}]*\{[^}]*(?:overflow-y\s*:\s*(?:auto|scroll)|overflow\s*:\s*(?:auto|scroll))/gim)) {
        diagnostics.push(error(
          'HF_BODY_SCROLL',
          `Document scrolling rule found in ${relativeFile}.`,
          'Keep html/body overflow hidden and move scrolling to AppScrollView.',
          relativeFile,
          lineAt(text, match.index),
        ));
      }
    }
    if (/homeframe\.config\.[cm]?[jt]s$/.test(relativeFile)) {
      if (/BEGIN (?:EC |RSA )?PRIVATE KEY|\b(?:VAPID_)?PRIVATE_KEY\b|\bprivateVapidKey\b/i.test(text)) {
        diagnostics.push(error(
          'HF_PUSH_PRIVATE_KEY',
          'A private-key marker appears in Homeframe client/build configuration.',
          'Keep the VAPID private key only in the delivery server secret store; the browser receives only the public application-server key.',
          relativeFile,
        ));
      }
      const enabledNotificationPolicy = [...text.matchAll(/notifications\s*:\s*\{([\s\S]*?)\}/g)]
        .some((match) => !/\benabled\s*:\s*false\b/.test(match[1] ?? ''));
      if (enabledNotificationPolicy) notificationConfigFile = relativeFile;
    }
  }
  if (notificationConfigFile && !subscriptionTransportFound) diagnostics.push(warning(
    'HF_PUSH_BACKEND_MISSING',
    'Notifications are configured but no subscription transport is discoverable in the project.',
    'Configure an idempotent authenticated subscription endpoint in HomeframeProvider and document the delivery server.',
    notificationConfigFile,
  ));
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

function isTestSourceFile(relativePath: string): boolean {
  return /(?:^|\/)(?:test|tests|e2e|__tests__)(?:\/|$)/i.test(relativePath)
    || /\.(?:test|spec)\.[^/]+$/i.test(relativePath);
}

function selectorCanMatchEditable(selector: string): boolean {
  return /(?:^|[\s>+~,(])(?:input|textarea|select)(?=$|[\s>+~,.#:[\]()])/i.test(selector)
    || /\[contenteditable(?:\s*\]|\s*[~|^$*]?=)/i.test(selector);
}

export async function doctorBuild(dist: string): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const indexPath = resolve(dist, 'index.html');
  const manifestPath = resolve(dist, 'manifest.webmanifest');
  const buildPath = resolve(dist, 'homeframe-build.json');
  let workerRelativePath = 'sw.js';
  let workerDisabled = false;
  let builtHtml = '';
  if (existsSync(buildPath)) {
    try {
      const build = JSON.parse(await readFile(buildPath, 'utf8')) as { serviceWorker?: unknown };
      if (build.serviceWorker === null || build.serviceWorker === false) {
        workerDisabled = true;
      } else if (typeof build.serviceWorker === 'string') {
        workerRelativePath = new URL(build.serviceWorker, 'https://homeframe.invalid/').pathname.replace(/^\/+/, '');
      }
    } catch (reason) {
      diagnostics.push(error('HF_BUILD_INFO_INVALID', `homeframe-build.json is invalid: ${message(reason)}`, 'Rebuild with @homeframe/vite.'));
    }
  }
  const workerPath = resolve(dist, workerRelativePath);
  if (!workerPath.startsWith(`${resolve(dist)}/`) && workerPath !== resolve(dist)) {
    diagnostics.push(error('HF_SW_PATH_INVALID', `Generated worker path escapes dist: ${workerRelativePath}.`, 'Use a same-origin worker file inside the build output.'));
  }
  const requiredFiles: Array<[string, string, string]> = [
    [indexPath, 'HF_INDEX_MISSING', 'built index.html'],
    [manifestPath, 'HF_MANIFEST_MISSING', 'generated manifest'],
    ...(workerDisabled ? [] : [[workerPath, 'HF_SW_MISSING', 'generated service worker']] as Array<[string, string, string]>),
  ];
  for (const [path, code, label] of requiredFiles) {
    if (!existsSync(path)) diagnostics.push(error(code, `Missing ${label}.`, 'Run the Homeframe production build and inspect plugin configuration.'));
  }
  if (existsSync(indexPath)) {
    const html = await readFile(indexPath, 'utf8');
    builtHtml = html;
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
    const singletonTags: Array<[string, RegExp]> = [
      ['viewport', /<meta[^>]+name=["']viewport["'][^>]*>/gi],
      ['manifest', /<link[^>]+rel=["']manifest["'][^>]*>/gi],
      ['Apple touch icon', /<link[^>]+rel=["']apple-touch-icon["'][^>]*>/gi],
      ['Homeframe bootstrap', /<script[^>]+id=["']homeframe-bootstrap["'][^>]*>/gi],
    ];
    for (const [label, pattern] of singletonTags) {
      const count = [...html.matchAll(pattern)].length;
      if (count !== 1) diagnostics.push(error('HF_METADATA_DUPLICATE', `Built HTML contains ${count} ${label} declarations.`, 'Remove app-authored duplicates and rebuild.'));
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
  if (workerDisabled) {
    diagnostics.push(info('HF_SW_DISABLED', 'Homeframe service-worker generation is disabled for this build.', 'Verify that another worker intentionally owns the scope during a staged migration.'));
  } else if (existsSync(workerPath)) {
    const worker = await readFile(workerPath, 'utf8');
    const capabilities: Array<[string, string]> = [
      ['HF_UPDATE_READY', 'atomic update signaling'],
      ['homeframe-cache-meta', 'bounded runtime-cache metadata'],
      ['HF_SKIP_WAITING', 'configurable activation'],
    ];
    for (const [token, label] of capabilities) {
      if (!worker.includes(token)) diagnostics.push(error('HF_SW_CAPABILITY', `Worker lacks ${label}.`, 'Regenerate it with @homeframe/vite.'));
    }
    const payload = parseGeneratedWorkerPayload(worker);
    if (!payload) {
      diagnostics.push(error('HF_SW_PAYLOAD', 'Worker configuration payload is missing or invalid.', 'Regenerate the worker instead of editing built output.'));
    } else {
      if (payload.notifications && !worker.includes('notificationclick')) {
        diagnostics.push(error('HF_SW_CAPABILITY', 'Worker lacks configured notification click routing.', 'Regenerate it with @homeframe/vite.'));
      }
      const precache = Array.isArray(payload.precache) ? payload.precache : [];
      if (precache.length === 0) diagnostics.push(error('HF_PRECACHE_EMPTY', 'Worker precache is empty.', 'Ensure the Vite build graph is available when Homeframe writes the worker.'));
      if (!precache.some((entry) => typeof entry === 'object' && entry !== null
        && (entry as { url?: unknown }).url === payload.documentFallback)) {
        diagnostics.push(error('HF_PRECACHE_DOCUMENT', 'The configured document fallback is not in the atomic precache.', 'Rebuild and ensure index.html maps to serviceWorker.documentFallback.'));
      }
      if (precache.some((entry) => typeof entry !== 'object' || entry === null
        || typeof (entry as { url?: unknown }).url !== 'string'
        || typeof (entry as { revision?: unknown }).revision !== 'string'
        || !(entry as { revision: string }).revision)) {
        diagnostics.push(error('HF_PRECACHE_REVISION', 'Every precache entry must have a URL and non-empty content revision.', 'Remove malformed additional entries and rebuild.'));
      }
      const precacheUrls = new Set(precache.flatMap((entry) =>
        typeof entry === 'object' && entry !== null && typeof (entry as { url?: unknown }).url === 'string'
          ? [(entry as { url: string }).url]
          : []));
      for (const assetUrl of localShellAssetUrls(builtHtml)) {
        if (!precacheUrls.has(assetUrl)) diagnostics.push(error(
          'HF_ROUTE_CHUNK_NOT_PRECACHED',
          `Shell asset ${assetUrl} is referenced by HTML but absent from the atomic precache.`,
          'Ensure every current JS/CSS chunk remains in the build graph and under the explicit precache size limit.',
        ));
      }
      const revisionSalt = typeof payload.revisionSalt === 'string' ? payload.revisionSalt : '';
      for (const entry of precache.slice(0, 2_000)) {
        if (!entry || typeof entry !== 'object') continue;
        const url = (entry as { url?: unknown }).url;
        const revision = (entry as { revision?: unknown }).revision;
        if (typeof url !== 'string' || typeof revision !== 'string') continue;
        const path = url === payload.documentFallback
          ? indexPath
          : localOutputPath(dist, url);
        if (!path) {
          diagnostics.push(error('HF_PRECACHE_PATH', `Precache URL ${url} does not resolve inside the build output.`, 'Use only same-origin, in-output URLs for build-generated precache entries.'));
          continue;
        }
        if (!existsSync(path)) {
          diagnostics.push(error('HF_PRECACHE_FILE_MISSING', `Precache URL ${url} has no retained file in the build output.`, 'Deploy and retain every asset referenced by the current worker.'));
          continue;
        }
        if (/^[a-f0-9]{64}$/i.test(revision)) {
          const contents = await readFile(path);
          const actual = createHash('sha256').update(contents).update(revisionSalt).digest('hex');
          if (actual !== revision.toLowerCase()) diagnostics.push(error(
            'HF_OUTPUT_INTEGRITY',
            `Precache revision for ${url} does not match its built bytes.`,
            'Discard the artifact and rebuild; do not edit generated output after Homeframe writes the worker.',
          ));
        }
      }
      const rules = Array.isArray(payload.runtimeCaching) ? payload.runtimeCaching : [];
      for (const [index, rule] of rules.entries()) {
        if (!rule || typeof rule !== 'object') continue;
        const value = rule as Record<string, unknown>;
        const match = String(value.match ?? '');
        if (/\/(?:api|graphql|account|profile|user)(?:\/|\b)/i.test(match)
          && value.sensitiveData == null) diagnostics.push(warning(
            'HF_CACHE_CLASSIFICATION',
            `Runtime cache rule ${index} (${String(value.cacheName ?? 'unnamed')}) targets an API-like route without sensitiveData classification.`,
            "Set sensitiveData: 'none' after review, or configure an account partition and logout purge.",
          ));
      }
    }
  }
  const reportPath = resolve(dist, 'generated/asset-report.json');
  if (!existsSync(reportPath)) diagnostics.push(error('HF_ASSET_REPORT', 'Generated asset report is missing.', 'Run a full Homeframe build.'));
  else {
    try {
      const report = JSON.parse(await readFile(reportPath, 'utf8')) as unknown;
      if (!Array.isArray(report)) throw new Error('expected an array');
      for (const value of report) {
        if (!value || typeof value !== 'object') continue;
        const entry = value as { fileName?: unknown; sha256?: unknown };
        if (typeof entry.fileName !== 'string' || typeof entry.sha256 !== 'string') {
          diagnostics.push(error('HF_ASSET_REPORT_INVALID', 'Asset report entry lacks fileName or sha256.', 'Regenerate all Homeframe assets.'));
          continue;
        }
        const path = localOutputPath(dist, entry.fileName);
        if (!path || !existsSync(path)) {
          diagnostics.push(error('HF_GENERATED_ASSET_MISSING', `Generated asset ${entry.fileName} is missing.`, 'Deploy the unmodified Homeframe build artifact.'));
          continue;
        }
        const actual = createHash('sha256').update(await readFile(path)).digest('hex');
        if (actual !== entry.sha256) diagnostics.push(error('HF_GENERATED_ASSET_INTEGRITY', `Generated asset ${entry.fileName} does not match its report hash.`, 'Discard the artifact and rebuild from source artwork.'));
      }
    } catch (reason) {
      diagnostics.push(error('HF_ASSET_REPORT_INVALID', `Generated asset report is invalid: ${message(reason)}`, 'Regenerate all Homeframe assets.'));
    }
  }
  return diagnostics;
}

function localShellAssetUrls(html: string): string[] {
  return [...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => match[1])
    .filter((value): value is string => typeof value === 'string' && /\.(?:js|css)(?:[?#]|$)/i.test(value))
    .map((value) => new URL(value, 'https://homeframe.invalid/').pathname);
}

function localOutputPath(dist: string, urlValue: string): string | null {
  try {
    const url = new URL(urlValue, 'https://homeframe.invalid/');
    if (url.origin !== 'https://homeframe.invalid') return null;
    const root = resolve(dist);
    const path = resolve(root, decodeURIComponent(url.pathname).replace(/^\/+/, ''));
    return path === root || path.startsWith(`${root}/`) ? path : null;
  } catch {
    return null;
  }
}

export async function doctorDeployment(urlValue: string): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  let base: URL;
  try {
    base = new URL(urlValue);
  } catch {
    return [error('HF_DEPLOY_URL', `Invalid deployment URL: ${urlValue}.`, 'Pass the public application origin or scoped base URL.')];
  }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) {
    return [error('HF_DEPLOY_URL', 'Deployment URL must be an HTTP(S) URL without embedded credentials.', 'Pass the public application origin or scoped base URL.')];
  }
  if (base.protocol !== 'https:' && !isLoopback(base.hostname)) {
    diagnostics.push(error('HF_SECURE_CONTEXT', `${base.origin} is not HTTPS.`, 'Use HTTPS for non-loopback PWA deployments.'));
  }

  let html = '';
  let htmlResponse: Response | null = null;
  try {
    htmlResponse = await fetch(base, { redirect: 'follow' });
    if (!htmlResponse.ok) {
      diagnostics.push(error('HF_DEPLOY_FETCH', `html returned ${htmlResponse.status} at ${base}.`, 'Fix the deployment route and content.'));
      return diagnostics;
    }
    html = await readBoundedText(htmlResponse, 5 * 1024 * 1024, 'HTML document');
  } catch (reason) {
    diagnostics.push(error('HF_DEPLOY_NETWORK', `Could not inspect ${base}: ${message(reason)}`, 'Verify DNS, TLS, and deployment availability.'));
    return diagnostics;
  }

  const htmlType = htmlResponse.headers.get('content-type') ?? '';
  if (!/text\/html/i.test(htmlType)) diagnostics.push(error('HF_HTML_CONTENT_TYPE', `Document Content-Type is ${htmlType || '(missing)'}.`, 'Serve the application document as text/html.'));
  const htmlCache = htmlResponse.headers.get('cache-control') ?? '';
  if (!/no-cache|max-age=0|must-revalidate/i.test(htmlCache)) {
    diagnostics.push(warning('HF_HTML_CACHE_HEADER', `HTML has unsafe Cache-Control: ${htmlCache || '(missing)'}.`, 'Serve app HTML with revalidation-friendly headers.'));
  }

  const manifestHref = attributeFromTag(html, 'link', 'rel', 'manifest', 'href') ?? 'manifest.webmanifest';
  const bootBuild = parseBootBuildInfo(html);
  const workerHref = bootBuild && 'serviceWorkerUrl' in bootBuild
    ? bootBuild.serviceWorkerUrl
    : 'sw.js';
  const manifestUrl = new URL(manifestHref, base);
  const workerUrl = workerHref ? new URL(workerHref, base) : null;
  let deployedWorkerPayload: Record<string, unknown> | null = null;
  const [manifestResponse, workerResponse] = await Promise.all([
    fetchDiagnosticResource(manifestUrl, 'manifest', diagnostics),
    workerUrl ? fetchDiagnosticResource(workerUrl, 'worker', diagnostics) : Promise.resolve(null),
  ]);

  if (manifestResponse) {
    const contentType = manifestResponse.headers.get('content-type') ?? '';
    if (!/manifest|json/i.test(contentType)) diagnostics.push(error('HF_MANIFEST_CONTENT_TYPE', `Manifest Content-Type is ${contentType || '(missing)'}.`, 'Serve application/manifest+json or application/json.'));
    const manifestCache = manifestResponse.headers.get('cache-control') ?? '';
    if (/immutable/i.test(manifestCache) || !/no-cache|max-age\s*=\s*(?:0|[1-9]\d{0,4})|must-revalidate/i.test(manifestCache)) {
      diagnostics.push(warning('HF_MANIFEST_CACHE_HEADER', `Manifest has unsafe Cache-Control: ${manifestCache || '(missing)'}.`, 'Serve the manifest with short-lived or revalidation-friendly caching, never immutable.'));
    }
    try {
      const manifest = JSON.parse(await readBoundedText(manifestResponse.clone(), 1024 * 1024, 'manifest')) as { id?: unknown; scope?: unknown; start_url?: unknown };
      if (typeof manifest.id !== 'string' || typeof manifest.scope !== 'string' || typeof manifest.start_url !== 'string') {
        diagnostics.push(error('HF_DEPLOY_MANIFEST_IDENTITY', 'Deployed manifest lacks explicit id, scope, or start_url.', 'Set stable identity fields in homeframe.config.ts.'));
      }
    } catch (reason) {
      diagnostics.push(error('HF_MANIFEST_INVALID', `Deployed manifest is invalid JSON: ${message(reason)}`, 'Serve the generated manifest without an HTML fallback.'));
    }
  }
  if (!workerUrl) {
    diagnostics.push(info('HF_SW_DISABLED', 'The deployed Homeframe bootstrap reports service-worker generation as disabled.', 'Verify that another worker intentionally owns the scope during a staged migration.'));
  } else if (workerResponse) {
    const cacheControl = workerResponse.headers.get('cache-control') ?? '';
    if (!/no-cache|max-age=0|must-revalidate/i.test(cacheControl)) {
      diagnostics.push(warning('HF_SW_CACHE_HEADER', `${workerUrl.pathname} has unsafe Cache-Control: ${cacheControl || '(missing)'}.`, 'Serve the worker with no-cache or max-age=0, must-revalidate.'));
    }
    if (!/javascript/i.test(workerResponse.headers.get('content-type') ?? '')) {
      diagnostics.push(error('HF_SW_CONTENT_TYPE', `Worker Content-Type is ${workerResponse.headers.get('content-type') || '(missing)'}.`, 'Serve the generated worker as JavaScript, never the app fallback.'));
    }
    try {
      const deployedWorker = await readBoundedText(workerResponse.clone(), 8 * 1024 * 1024, 'service worker');
      if (!deployedWorker.includes('Generated by Homeframe') || !deployedWorker.includes('HF_GET_VERSION')) {
        diagnostics.push(error('HF_DEPLOY_SW_IDENTITY', 'The deployed worker is not a complete Homeframe generated worker.', 'Deploy the generated worker at the configured stable URL.'));
      }
      deployedWorkerPayload = parseGeneratedWorkerPayload(deployedWorker);
      if (!deployedWorkerPayload) diagnostics.push(error('HF_DEPLOY_SW_PAYLOAD', 'The deployed worker configuration payload is unreadable.', 'Deploy the unmodified generated worker.'));
    } catch (reason) {
      diagnostics.push(error('HF_DEPLOY_BODY_LIMIT', message(reason), 'Reduce the worker output or inspect the deployment for an incorrect fallback response.'));
    }
  }

  const csp = htmlResponse.headers.get('content-security-policy')
    ?? htmlResponse.headers.get('content-security-policy-report-only');
  const bootTag = html.match(/<script[^>]+id=["']homeframe-bootstrap["'][^>]*>/i)?.[0] ?? '';
  const bootNonce = attributeFromRawTag(bootTag, 'nonce');
  const runtimeStyleTag = html.match(/<style[^>]+id=["']homeframe-runtime-vars["'][^>]*>/i)?.[0] ?? '';
  const criticalStyleTag = html.match(/<style[^>]+id=["']homeframe-critical["'][^>]*>/i)?.[0] ?? '';
  const runtimeStyleNonce = attributeFromRawTag(runtimeStyleTag, 'nonce');
  const criticalStyleNonce = attributeFromRawTag(criticalStyleTag, 'nonce');
  if (!csp) {
    diagnostics.push(warning('HF_CSP_MISSING', 'The deployed document has no Content-Security-Policy header.', 'Deploy a nonce/hash CSP with worker-src and manifest-src restricted to trusted origins.'));
  } else if (bootNonce && !csp.includes(`'nonce-${bootNonce}'`)) {
    diagnostics.push(error('HF_CSP_NONCE', 'The Homeframe bootstrap nonce is not authorized by the deployed CSP.', 'Inject the same per-response nonce into the HTML and script-src policy.'));
  } else if (!bootNonce && !/sha(256|384|512)-/i.test(csp) && !/'unsafe-inline'/i.test(csp)) {
    diagnostics.push(error('HF_CSP_BOOTSTRAP', 'The deployed CSP does not authorize the inline Homeframe bootstrap.', 'Configure security.cspNonce or a matching bootstrap hash.'));
  }
  if (csp) {
    if (bootNonce && (!runtimeStyleNonce || !criticalStyleNonce
      || runtimeStyleNonce !== bootNonce || criticalStyleNonce !== bootNonce)) {
      diagnostics.push(error('HF_CSP_STYLE_NONCE', 'Homeframe runtime/critical styles do not share the authorized bootstrap nonce.', 'Inject the same per-response nonce into both generated style tags and the bootstrap script.'));
    }
    if (!/\bworker-src\b[^;]*'self'/i.test(csp)) diagnostics.push(error('HF_CSP_WORKER_SRC', 'CSP does not explicitly authorize same-origin workers.', "Add worker-src 'self' to the document policy."));
    if (!/\bmanifest-src\b[^;]*'self'/i.test(csp)) diagnostics.push(error('HF_CSP_MANIFEST_SRC', 'CSP does not explicitly authorize the same-origin manifest.', "Add manifest-src 'self' to the document policy."));
    if (/\bscript-src\b[^;]*'unsafe-eval'/i.test(csp)) diagnostics.push(error('HF_CSP_UNSAFE_EVAL', "CSP enables script-src 'unsafe-eval'.", 'Remove unsafe-eval; Homeframe production runtime does not require it.'));
  }

  const expectedDocumentRevision = deployedWorkerPayload
    ? (deployedWorkerPayload.precache as Array<{ url?: unknown; revision?: unknown }> | undefined)
      ?.find((entry) => entry?.url === deployedWorkerPayload?.documentFallback)?.revision
    : undefined;
  const assertedDocumentRevision = htmlResponse.headers.get('x-homeframe-revision');
  if (assertedDocumentRevision && typeof expectedDocumentRevision === 'string'
    && assertedDocumentRevision.toLowerCase() !== expectedDocumentRevision.toLowerCase()) {
    diagnostics.push(error('HF_DOCUMENT_REVISION_HEADER', 'The deployed document revision header does not match the worker precache entry.', 'Generate the header from the exact unmodified built HTML template and configured revision salt.'));
  }

  const hashedAsset = firstHashedAssetUrl(html, base);
  if (hashedAsset) {
    const assetResponse = await fetchDiagnosticResource(hashedAsset, 'hashed asset', diagnostics);
    const cacheControl = assetResponse?.headers.get('cache-control') ?? '';
    if (assetResponse && !/max-age\s*=\s*(?:31536000|[4-9]\d{7,})/i.test(cacheControl)) {
      diagnostics.push(warning('HF_ASSET_CACHE_HEADER', `Hashed asset has non-immutable Cache-Control: ${cacheControl || '(missing)'}.`, 'Serve hashed assets for one year with immutable.'));
    }
  }

  const deepUrl = new URL(`__homeframe/doctor-route-${Date.now()}`, base.href.endsWith('/') ? base : new URL(`${base.pathname}/`, base));
  const deepResponse = await fetchDiagnosticResource(deepUrl, 'deep route', diagnostics, true);
  if (deepResponse && !/text\/html/i.test(deepResponse.headers.get('content-type') ?? '')) {
    diagnostics.push(error('HF_ROUTE_FALLBACK', `Known-scope deep route did not return HTML at ${deepUrl}.`, 'Rewrite in-scope document routes to the current app shell.'));
  }
  const apiUrl = new URL('/api/__homeframe-doctor-miss', base);
  const apiResponse = await fetch(apiUrl, { redirect: 'manual' }).catch(() => null);
  if (apiResponse && /text\/html/i.test(apiResponse.headers.get('content-type') ?? '')) {
    diagnostics.push(error('HF_API_FALLBACK', `${apiUrl.pathname} received the app HTML fallback.`, 'Exclude API routes from origin and service-worker navigation fallback.'));
  }

  const deployedScope = typeof deployedWorkerPayload?.scope === 'string'
    ? deployedWorkerPayload.scope
    : base.pathname;
  const scopePath = deployedScope.endsWith('/') ? deployedScope : `${deployedScope}/`;
  const recoveryUrl = new URL(`${scopePath.replace(/^\/+/, '')}__homeframe/recovery`, base.origin.endsWith('/') ? base.origin : `${base.origin}/`);
  const recoveryResponse = await fetch(recoveryUrl, { redirect: 'follow' }).catch(() => null);
  if (!recoveryResponse?.ok || !/text\/html/i.test(recoveryResponse.headers.get('content-type') ?? '')) {
    diagnostics.push(error('HF_RECOVERY_ROUTE', 'The network-first recovery route does not return the app shell.', 'Rewrite /__homeframe/recovery to the Homeframe document and register HomeframeRecovery in the app route table.'));
  }

  if (deployedWorkerPayload) {
    const entries = Array.isArray(deployedWorkerPayload.precache) ? deployedWorkerPayload.precache : [];
    const retainedAssetUrls = entries.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const value = (entry as { url?: unknown }).url;
      if (typeof value !== 'string' || !/\.(?:js|css)(?:[?#]|$)/i.test(value)) return [];
      const url = new URL(value, base);
      return url.origin === base.origin ? [url] : [];
    }).slice(0, 128);
    const retained = await Promise.all(retainedAssetUrls.map(async (url) => ({
      url,
      response: await fetch(url, { method: 'GET', cache: 'no-store' }).catch(() => null),
    })));
    for (const item of retained) {
      if (!item.response?.ok || /text\/html/i.test(item.response.headers.get('content-type') ?? '')) diagnostics.push(error(
        'HF_DEPLOY_ROUTE_CHUNK_MISSING',
        `Precached route asset ${item.url.pathname} is missing or disguised as HTML.`,
        'Retain every asset referenced by the current worker through the rollback window.',
      ));
    }
  }

  diagnostics.push(...await doctorRenderedControls(base));
  return diagnostics;
}

function parseGeneratedWorkerPayload(worker: string): Record<string, unknown> | null {
  const match = /const HF = (\{[^\n]+\});/.exec(worker);
  if (!match?.[1]) return null;
  try {
    return JSON.parse(match[1]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function fetchDiagnosticResource(
  url: URL,
  kind: string,
  diagnostics: Diagnostic[],
  allowNotFound = false,
): Promise<Response | null> {
  try {
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok && !(allowNotFound && response.status === 404)) {
      diagnostics.push(error('HF_DEPLOY_FETCH', `${kind} returned ${response.status} at ${url}.`, 'Fix the deployment route and content.'));
      return null;
    }
    return response;
  } catch (reason) {
    diagnostics.push(error('HF_DEPLOY_NETWORK', `Could not inspect ${url}: ${message(reason)}`, 'Verify DNS, TLS, and deployment availability.'));
    return null;
  }
}

function attributeFromTag(
  html: string,
  tagName: string,
  matchName: string,
  matchValue: string,
  resultName: string,
): string | null {
  const tags = html.match(new RegExp(`<${tagName}\\b[^>]*>`, 'gi')) ?? [];
  const tag = tags.find((candidate) => attributeFromRawTag(candidate, matchName)?.toLowerCase() === matchValue.toLowerCase());
  return tag ? attributeFromRawTag(tag, resultName) : null;
}

function attributeFromRawTag(tag: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1] ?? null;
}

function parseBootBuildInfo(html: string): { serviceWorkerUrl?: string | null } | null {
  const match = /window\.__HOMEFRAME_BUILD__=(\{.*?\});/.exec(html);
  if (!match?.[1]) return null;
  try {
    return JSON.parse(match[1]) as { serviceWorkerUrl?: string | null };
  } catch {
    return null;
  }
}

function firstHashedAssetUrl(html: string, base: URL): URL | null {
  const sources = [...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => match[1])
    .filter((value): value is string => Boolean(value));
  const hashed = sources.find((value) => /\/assets\/[^/?#]+-[A-Za-z0-9_-]+\.(?:js|css)(?:[?#]|$)/.test(value));
  return hashed ? new URL(hashed, base) : null;
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

async function readBoundedText(response: Response, maximumBytes: number, label: string): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    throw new Error(`${label} declares ${declared} bytes, above the ${maximumBytes}-byte audit limit.`);
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > maximumBytes) {
    throw new Error(`${label} is ${buffer.byteLength} bytes, above the ${maximumBytes}-byte audit limit.`);
  }
  return new TextDecoder().decode(buffer);
}

interface ProjectInventory {
  packageName: string | null;
  bundler: 'vite' | 'other' | 'unknown';
  viteConfigs: string[];
  react: { detected: boolean; entries: string[] };
  htmlTemplates: string[];
  manifest: {
    files: string[];
    identity: {
      id: string | null;
      name: string | null;
      shortName: string | null;
      startUrl: string | null;
      scope: string | null;
      display: string | null;
      themeColor: string | null;
      backgroundColor: string | null;
      iconSource: string | null;
    };
  };
  serviceWorker: {
    registrations: Array<{ file: string; line: number }>;
    candidateFiles: string[];
    cacheNames: string[];
  };
  routerPackages: string[];
  riskyLayoutUses: Array<{ kind: string; file: string; line: number; sample: string }>;
  conflicts: string[];
}

export async function inventoryProject(root: string): Promise<ProjectInventory> {
  const packagePath = resolve(root, 'package.json');
  const packageJson = existsSync(packagePath)
    ? await readJsonObject(packagePath)
    : {};
  const dependencies = {
    ...objectValue(packageJson.dependencies),
    ...objectValue(packageJson.devDependencies),
  };
  const sourceFiles = await walk(root, (path) => {
    if (path.includes('/node_modules/') || path.includes('/dist/') || path.includes('/.git/') || path.includes('/.homeframe/')) return false;
    return ['.ts', '.tsx', '.js', '.jsx', '.css', '.html', '.webmanifest', '.json'].includes(extname(path));
  });
  const viteConfigs = sourceFiles.filter((file) => /^vite\.config\.(?:ts|js|mts|mjs)$/.test(basename(file)));
  const reactEntries = sourceFiles.filter((file) => /\/src\/(?:main|index)\.(?:tsx|jsx|ts|js)$/.test(file));
  const htmlTemplates = sourceFiles.filter((file) => extname(file) === '.html');
  const manifestFiles = sourceFiles.filter((file) => extname(file) === '.webmanifest'
    || (/manifest/i.test(basename(file)) && extname(file) === '.json' && basename(file) !== 'package.json'));
  const registrations: Array<{ file: string; line: number }> = [];
  const candidateWorkers: string[] = [];
  const cacheNames = new Set<string>();
  const riskyLayoutUses: ProjectInventory['riskyLayoutUses'] = [];
  const riskPatterns: Array<[string, RegExp]> = [
    ['raw-viewport', /\b(?:visualViewport|window\.innerHeight|100d?vh)\b/g],
    ['fixed-or-sticky', /position\s*:\s*(?:fixed|sticky)/gi],
    ['safe-area', /env\(safe-area-inset-[^)]+\)/gi],
    ['body-scroll', /(?:document\.(?:body|documentElement)|window)\.(?:scrollTo|scrollTop)/g],
    ['touch-handler', /(?:touchstart|touchmove|pointerdown)/g],
  ];
  for (const file of sourceFiles) {
    if (!['.ts', '.tsx', '.js', '.jsx', '.css', '.html'].includes(extname(file))) continue;
    const text = await readFile(file, 'utf8');
    const relativeFile = relative(root, file);
    for (const match of text.matchAll(/serviceWorker\s*\.\s*register\s*\(/g)) {
      registrations.push({ file: relativeFile, line: lineAt(text, match.index) });
    }
    if (/service[-_.]?worker|\bsw\.[cm]?[jt]s$/i.test(basename(file))) candidateWorkers.push(relativeFile);
    for (const match of text.matchAll(/cacheName\s*:\s*["']([^"']+)["']|caches\.open\(\s*["']([^"']+)["']/g)) {
      const name = match[1] ?? match[2];
      if (name) cacheNames.add(name);
    }
    for (const [kind, pattern] of riskPatterns) {
      for (const match of text.matchAll(pattern)) {
        riskyLayoutUses.push({
          kind,
          file: relativeFile,
          line: lineAt(text, match.index),
          sample: match[0],
        });
        if (riskyLayoutUses.length >= 500) break;
      }
    }
  }

  const manifestIdentity = await readManifestIdentity(root, manifestFiles[0]);
  const routerPackages = Object.keys(dependencies).filter((name) => /router/i.test(name));
  const conflicts = [
    ...(manifestFiles.length ? [`Existing manifest: ${manifestFiles.map((file) => relative(root, file)).join(', ')}`] : []),
    ...(registrations.length ? [`Existing service-worker registration: ${registrations.map((item) => `${item.file}:${item.line}`).join(', ')}`] : []),
    ...(candidateWorkers.length ? [`Candidate worker source: ${candidateWorkers.join(', ')}`] : []),
    ...(htmlTemplates.length ? [`Existing HTML template(s) must be preserved and diffed: ${htmlTemplates.map((file) => relative(root, file)).join(', ')}`] : []),
  ];
  return {
    packageName: typeof packageJson.name === 'string' ? packageJson.name : null,
    bundler: dependencies.vite || viteConfigs.length ? 'vite'
      : Object.keys(dependencies).length ? 'other' : 'unknown',
    viteConfigs: viteConfigs.map((file) => relative(root, file)),
    react: {
      detected: Boolean(dependencies.react) || sourceFiles.some((file) => /\.(?:tsx|jsx)$/.test(file)),
      entries: reactEntries.map((file) => relative(root, file)),
    },
    htmlTemplates: htmlTemplates.map((file) => relative(root, file)),
    manifest: {
      files: manifestFiles.map((file) => relative(root, file)),
      identity: manifestIdentity,
    },
    serviceWorker: {
      registrations,
      candidateFiles: candidateWorkers,
      cacheNames: [...cacheNames].sort(),
    },
    routerPackages,
    riskyLayoutUses,
    conflicts,
  };
}

async function readManifestIdentity(
  root: string,
  manifestPath: string | undefined,
): Promise<ProjectInventory['manifest']['identity']> {
  const empty = {
    id: null,
    name: null,
    shortName: null,
    startUrl: null,
    scope: null,
    display: null,
    themeColor: null,
    backgroundColor: null,
    iconSource: null,
  };
  if (!manifestPath) return empty;
  try {
    const value = await readJsonObject(manifestPath);
    const icons = Array.isArray(value.icons) ? value.icons as Array<Record<string, unknown>> : [];
    const iconValue = icons.find((icon) => typeof icon.src === 'string')?.src;
    let iconSource: string | null = null;
    if (typeof iconValue === 'string' && !/^https?:/i.test(iconValue)) {
      const pathname = new URL(iconValue, 'https://homeframe.invalid/').pathname;
      const publicCandidate = resolve(root, 'public', pathname.replace(/^\/+/, ''));
      const relativeCandidate = resolve(dirname(manifestPath), iconValue);
      const selected = existsSync(publicCandidate) ? publicCandidate : existsSync(relativeCandidate) ? relativeCandidate : null;
      if (selected) iconSource = `./${relative(root, selected).replaceAll('\\', '/')}`;
    }
    return {
      id: stringValue(value.id),
      name: stringValue(value.name),
      shortName: stringValue(value.short_name),
      startUrl: stringValue(value.start_url),
      scope: stringValue(value.scope),
      display: stringValue(value.display),
      themeColor: stringValue(value.theme_color),
      backgroundColor: stringValue(value.background_color),
      iconSource,
    };
  } catch {
    return empty;
  }
}

async function readJsonObject(path: string): Promise<Record<string, unknown>> {
  const value = JSON.parse(await readFile(path, 'utf8')) as unknown;
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function starterIcon(label: string): string {
  const initial = [...label.trim()][0]?.toUpperCase() ?? 'H';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-label="App icon"><rect width="1024" height="1024" rx="224" fill="#172554"/><text x="512" y="590" text-anchor="middle" fill="#ffffff" font-family="system-ui,sans-serif" font-size="420" font-weight="700">${initial.replace(/[&<>"']/g, '')}</text></svg>\n`;
}

async function doctorRenderedControls(base: URL): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      await page.goto(base.href, { waitUntil: 'domcontentloaded', timeout: 15_000 });
      await page.waitForSelector('[data-hf-viewport]', { timeout: 10_000 });
      const routes = await page.evaluate(() => [...new Set(
        [...document.querySelectorAll<HTMLAnchorElement>('a[href]')]
          .map((anchor) => new URL(anchor.href, location.href))
          .filter((url) => url.origin === location.origin)
          .map((url) => url.pathname + url.search),
      )].slice(0, 24));
      const routeList = ['' as string, ...routes];
      for (const route of routeList) {
        if (route) await page.goto(new URL(route, base).href, { waitUntil: 'domcontentloaded', timeout: 15_000 });
        const result = await page.evaluate(async () => ({
          path: location.pathname,
          windowScrollY: window.scrollY,
          rootBackground: getComputedStyle(document.documentElement).backgroundColor,
          controls: [...document.querySelectorAll<HTMLElement>('input, textarea, select, [contenteditable]:not([contenteditable="false"])')]
            .filter((element) => getComputedStyle(element).display !== 'none')
            .map((element) => ({
              selector: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${element.getAttribute('aria-label') ? `[aria-label="${element.getAttribute('aria-label')}"]` : ''}`,
              size: Number.parseFloat(getComputedStyle(element).fontSize),
            })),
          registrations: 'serviceWorker' in navigator
            ? (await navigator.serviceWorker.getRegistrations()).map((item) => ({ scope: item.scope, script: item.active?.scriptURL ?? item.waiting?.scriptURL ?? item.installing?.scriptURL ?? null }))
            : [],
        }));
        if (result.windowScrollY !== 0) diagnostics.push(error('HF_DOCUMENT_SCROLL', `${result.path} loaded with window.scrollY=${result.windowScrollY}.`, 'Keep document scrolling disabled and use AppScrollView.'));
        if (result.rootBackground === 'rgba(0, 0, 0, 0)' || result.rootBackground === 'transparent') {
          diagnostics.push(error('HF_ROOT_TRANSPARENT', `${result.path} has a transparent root background.`, 'Set the generated Homeframe canvas color on the document root.'));
        }
        for (const control of result.controls) {
          if (!Number.isFinite(control.size) || control.size < 16) diagnostics.push(error('HF_DEPLOY_INPUT_ZOOM', `${result.path} ${control.selector} computes to ${control.size}px.`, 'Use a Homeframe control or enforce at least 16 CSS px editable text.'));
        }
        const registrations = result.registrations;
        if (registrations.length > 1) diagnostics.push(error('HF_DEPLOY_MULTIPLE_SW', `Multiple service-worker registrations are visible to the app: ${registrations.map((item) => `${item.scope} (${item.script ?? 'no active script'})`).join(', ')}.`, 'Keep one stable Homeframe registration for the intended scope and remove legacy registrations during migration.'));
      }
      await context.close();
    } finally {
      await browser.close();
    }
  } catch (reason) {
    diagnostics.push(error('HF_BROWSER_AUDIT', `Rendered deployment audit failed: ${message(reason)}`, 'Install Playwright Chromium and ensure the deployed app reaches its Homeframe shell.'));
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
  return {
    severity,
    code,
    message: messageText,
    remediation,
    documentation: `https://github.com/BuiltByTed/homeframe/blob/main/docs/diagnostics.md#diagnostic-catalog`,
    ...(file ? { file } : {}),
    ...(line ? { line } : {}),
  };
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
    console.log(`${marker} ${item.code}${location}\n  ${item.message}\n  Fix: ${item.remediation}\n  Docs: ${item.documentation}`);
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
