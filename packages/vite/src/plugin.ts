import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { IndexHtmlTransformContext, Plugin, ResolvedConfig } from 'vite';
import {
  generateServiceWorker,
  type PrecacheEntry,
  type SerializableRuntimeCacheRule,
} from '@homeframe/sw';
import { generateAssets, joinBase, type GeneratedAssetSet } from './assets.js';
import { createManifest, runtimeCacheOverlapWarnings, validateConfig } from './manifest.js';
import type {
  GeneratedHomeframeAsset,
  HomeframeConfig,
  HomeframeServiceWorkerBuildConfig,
} from './types.js';

const virtualConfigId = 'virtual:homeframe/config';
const resolvedVirtualConfigId = '\0virtual:homeframe/config';

export function homeframe(config: HomeframeConfig): Plugin {
  validateConfig(config);
  let vite: ResolvedConfig;
  let generated: GeneratedAssetSet | null = null;
  let buildId = '';
  let assetsPromise: Promise<GeneratedAssetSet> | null = null;

  return {
    name: 'homeframe',
    enforce: 'pre',
    config() {
      return {
        define: {
          __HOMEFRAME__: 'true',
        },
      };
    },
    configResolved(resolved) {
      vite = resolved;
      for (const warning of runtimeCacheOverlapWarnings(config)) this.warn(warning);
      buildId = process.env.HOMEFRAME_BUILD_ID
        ?? `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${hash(JSON.stringify(config)).slice(0, 8)}`;
      assetsPromise = generateAssets(config, vite.root, vite.base);
    },
    resolveId(id) {
      return id === virtualConfigId ? resolvedVirtualConfigId : undefined;
    },
    load(id) {
      if (id !== resolvedVirtualConfigId) return undefined;
      const workerConfig = config.serviceWorker === false ? undefined : config.serviceWorker;
      return `export default ${JSON.stringify(clientConfiguration(config, vite.base, workerConfig, buildId))};`;
    },
    async buildStart() {
      generated = await assetsPromise!;
      // Vite also invokes buildStart for the dev server, whose plugin context
      // cannot emit Rollup build assets. configureServer serves this generated
      // set directly in development.
      if (vite.command !== 'build') return;
      for (const asset of generated.assets) this.emitFile({
        type: 'asset',
        fileName: asset.fileName,
        source: asset.source,
      });
      const manifest = `${JSON.stringify(createManifest(config, vite.base), null, 2)}\n`;
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: manifest });
      this.emitFile({
        type: 'asset',
        fileName: 'generated/asset-report.json',
        source: `${JSON.stringify(generated.assets.map(assetReport), null, 2)}\n`,
      });
    },
    async transformIndexHtml(html) {
      generated ??= await assetsPromise!;
      ensureNoConflictingMetadata(html);
      const nonce = config.security?.cspNonce;
      const nonceAttribute = nonce ? ` nonce="${escapeHtml(nonce)}"` : '';
      const serviceWorkerUrl = config.serviceWorker === false || config.serviceWorker?.enabled === false
        ? null
        : joinBase(vite.base, config.serviceWorker?.fileName ?? 'sw.js');
      const critical = criticalCss(config);
      const boot = bootScript({
        appId: config.app.id,
        buildId,
        backgroundColor: effectiveBackground(config),
        appleStatusBarStyle: config.splash?.appleStatusBarStyle ?? 'black',
        serviceWorkerUrl,
        serviceWorkerScope: config.app.scope,
        client: clientConfiguration(config, vite.base, config.serviceWorker === false ? undefined : config.serviceWorker, buildId),
      });
      const startupLinks = generated.startupLinks.map(({ href, media }) =>
        `<link rel="apple-touch-startup-image" href="${escapeHtml(href)}" media="${escapeHtml(media)}">`).join('\n');
      const head = [
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-visual">',
        '<meta name="apple-mobile-web-app-capable" content="yes">',
        '<meta name="mobile-web-app-capable" content="yes">',
        `<meta name="apple-mobile-web-app-title" content="${escapeHtml(config.app.shortName)}">`,
        `<meta name="apple-mobile-web-app-status-bar-style" content="${config.splash?.appleStatusBarStyle ?? 'black'}">`,
        `<meta name="color-scheme" content="${documentColorScheme(config)}">`,
        ...themeColorMetadata(config),
        `<link rel="manifest" href="${joinBase(vite.base, 'manifest.webmanifest')}">`,
        `<link rel="apple-touch-icon" href="${joinBase(vite.base, 'generated/apple-touch-icon.png')}">`,
        `<link rel="icon" type="image/png" sizes="32x32" href="${joinBase(vite.base, 'generated/favicon-32.png')}">`,
        startupLinks,
        `<style id="homeframe-runtime-vars"${nonceAttribute}>:root{}</style>`,
        `<style id="homeframe-critical"${nonceAttribute}>${critical}</style>`,
        `<script id="homeframe-bootstrap"${nonceAttribute}>${boot}</script>`,
      ].filter(Boolean).join('\n');
      const splash = `<div id="homeframe-boot-splash" aria-hidden="true"><img src="${generated.inlineLogo}" alt=""><span>${escapeHtml(config.splash?.title ?? config.app.name)}</span></div>`;
      return html.replace(/<head([^>]*)>/i, `<head$1>\n${head}`)
        .replace(/<body([^>]*)>/i, `<body$1>\n${splash}`);
    },
    async configureServer(server) {
      generated ??= await assetsPromise!;
      const manifest = Buffer.from(JSON.stringify(createManifest(config, vite.base)), 'utf8');
      const assetMap = new Map(generated.assets.map((asset) => [`/${asset.fileName}`, asset]));
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://homeframe.local').pathname;
        if (pathname === joinBase(vite.base, 'manifest.webmanifest')) {
          response.setHeader('Content-Type', 'application/manifest+json');
          response.end(manifest);
          return;
        }
        const relativePath = vite.base === '/' ? pathname : pathname.slice(vite.base.length - 1);
        const asset = assetMap.get(relativePath);
        if (asset) {
          response.setHeader('Content-Type', asset.mimeType);
          response.end(asset.source);
          return;
        }
        next();
      });
    },
    async writeBundle() {
      const outDir = isAbsolute(vite.build.outDir)
        ? vite.build.outDir
        : resolve(vite.root, vite.build.outDir);
      if (config.serviceWorker === false || config.serviceWorker?.enabled === false) {
        await writeFile(resolve(outDir, 'homeframe-build.json'), `${JSON.stringify({
          appId: config.app.id,
          buildId,
          generatedAt: new Date().toISOString(),
          serviceWorker: null,
          precacheEntries: 0,
        }, null, 2)}\n`);
        return;
      }
      const swFile = config.serviceWorker?.fileName ?? 'sw.js';
      const swConfig = config.serviceWorker;
      const precache = await collectPrecache(outDir, swFile, config, swConfig, vite.base);
      const worker = generateServiceWorker({
        appId: config.app.id,
        buildId,
        scope: config.app.scope,
        documentFallback: swConfig?.documentFallback ?? config.app.startUrl,
        precache,
        ...(swConfig?.cacheRevisionSalt ? { revisionSalt: swConfig.cacheRevisionSalt } : {}),
        ...(swConfig?.navigationAllow ? { navigationAllow: swConfig.navigationAllow } : {}),
        ...(swConfig?.navigationDeny ? { navigationDeny: swConfig.navigationDeny } : {}),
        ...(swConfig?.navigationTimeoutSeconds === undefined ? {} : {
          navigationTimeoutSeconds: swConfig.navigationTimeoutSeconds,
        }),
        ...(swConfig?.runtimeCaching ? {
          runtimeCaching: serializeRuntimeCaching(swConfig.runtimeCaching),
        } : {}),
        ...(swConfig?.cleanupOutdated === undefined ? {} : {
          cleanupOutdated: swConfig.cleanupOutdated,
        }),
        ...(swConfig?.legacyNamesToDelete ? { legacyNamesToDelete: swConfig.legacyNamesToDelete } : {}),
        ...(swConfig?.notifications === undefined ? {} : { notifications: swConfig.notifications }),
      });
      const output = resolve(outDir, swFile);
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, worker);
      await writeFile(resolve(outDir, 'homeframe-build.json'), `${JSON.stringify({
        appId: config.app.id,
        buildId,
        generatedAt: new Date().toISOString(),
        serviceWorker: joinBase(vite.base, swFile),
        precacheEntries: precache.length,
        documentRevision: precache.find((entry) => entry.url === (swConfig?.documentFallback ?? config.app.startUrl))?.revision ?? null,
      }, null, 2)}\n`);
    },
  };
}

function clientConfiguration(
  config: HomeframeConfig,
  base: string,
  workerConfig: HomeframeServiceWorkerBuildConfig | undefined,
  currentBuildId: string,
) {
  const workerEnabled = config.serviceWorker !== false && workerConfig?.enabled !== false;
  return {
    app: config.app,
    buildId: currentBuildId,
    react: {
      selection: config.viewport?.selection ?? 'controls-only',
      snapshot: config.viewport?.snapshot ?? 'brand',
      bottomDock: config.viewport?.bottomDock ?? 'avoid',
      diagnostics: config.diagnostics ?? {},
      viewport: {
        ...(config.viewport?.keyboardThresholdPx === undefined ? {} : { keyboardThresholdPx: config.viewport.keyboardThresholdPx }),
        ...(config.viewport?.keyboardThresholdRatio === undefined ? {} : { keyboardThresholdRatio: config.viewport.keyboardThresholdRatio }),
        ...(config.viewport?.inputZoomMinimumPx === undefined ? {} : { inputZoomMinimumPx: config.viewport.inputZoomMinimumPx }),
        ...(config.viewport?.strictInputZoom === undefined ? {} : { strictInputZoom: config.viewport.strictInputZoom }),
        ...(config.viewport?.settleDelaysMs === undefined ? {} : { settleDelaysMs: config.viewport.settleDelaysMs }),
        ...(config.viewport?.keyboardStabilizationMs === undefined ? {} : { keyboardStabilizationMs: config.viewport.keyboardStabilizationMs }),
        ...(config.viewport?.topTapToTop === undefined ? {} : { topTapToTop: config.viewport.topTapToTop }),
      },
      ...(config.nudges ? { nudges: config.nudges } : {}),
      notifications: workerConfig?.notifications ? {
        ...(workerConfig.notifications.applicationServerKey ? { applicationServerKey: workerConfig.notifications.applicationServerKey } : {}),
        ...(workerConfig.notifications.subscriptionTransport ? {
          transport: { endpoint: workerConfig.notifications.subscriptionTransport },
        } : {}),
      } : false,
    },
    router: { scope: config.app.scope, ...(config.router ?? {}) },
    serviceWorker: workerEnabled ? {
      url: joinBase(base, workerConfig?.fileName ?? 'sw.js'),
      scope: config.app.scope,
      mode: workerConfig?.update?.mode ?? 'automatic',
      reload: workerConfig?.update?.reload ?? 'safe-point',
      ...(workerConfig?.update?.checkOnLaunch === undefined ? {} : { checkOnLaunch: workerConfig.update.checkOnLaunch }),
      ...(workerConfig?.update?.checkOnForeground === undefined ? {} : { checkOnForeground: workerConfig.update.checkOnForeground }),
      ...(workerConfig?.update?.foregroundMinimumAgeMs === undefined ? {} : { foregroundMinimumAgeMs: workerConfig.update.foregroundMinimumAgeMs }),
      ...(workerConfig?.update?.intervalMinutes === undefined ? {} : { intervalMinutes: workerConfig.update.intervalMinutes }),
      ...(workerConfig?.update?.reloadOnActivate === undefined ? {} : { reloadOnActivate: workerConfig.update.reloadOnActivate }),
    } : false,
  };
}

function effectiveBackground(config: HomeframeConfig): string {
  return config.app.colorScheme === 'dark'
    ? config.app.backgroundColorDark ?? config.app.backgroundColor
    : config.app.backgroundColor;
}

function serializeRuntimeCaching(
  rules: NonNullable<HomeframeServiceWorkerBuildConfig['runtimeCaching']>,
): SerializableRuntimeCacheRule[] {
  return rules.map((rule) => {
    const {
      match: configuredMatch,
      matchType: configuredMatchType,
      sensitiveData: configuredSensitiveData,
      ...sharedRule
    } = rule;
    let match: string;
    let matchType: SerializableRuntimeCacheRule['matchType'];
    let matchFlags: string | undefined;
    let matchFunctionSource: string | undefined;
    if (configuredMatch instanceof RegExp) {
      match = configuredMatch.source;
      matchType = 'regex';
      matchFlags = configuredMatch.flags;
    } else if (typeof configuredMatch === 'function') {
      match = '[configured matcher]';
      matchType = 'function';
      matchFunctionSource = trustedFunctionSource(configuredMatch, 'runtime cache matcher');
    } else {
      match = configuredMatch;
      matchType = configuredMatchType;
    }
    const sensitiveData = configuredSensitiveData && configuredSensitiveData !== 'none'
      ? {
          partitionKeySource: trustedFunctionSource(
            configuredSensitiveData.partitionKey,
            'private-cache partitionKey',
          ),
          purgeOnLogout: true as const,
          threatReview: configuredSensitiveData.threatReview,
        }
      : configuredSensitiveData;
    return {
      ...sharedRule,
      match,
      ...(matchType ? { matchType } : {}),
      ...(matchFlags ? { matchFlags } : {}),
      ...(matchFunctionSource ? { matchFunctionSource } : {}),
      ...(sensitiveData ? { sensitiveData } : {}),
    };
  });
}

function trustedFunctionSource(value: Function, label: string): string {
  const source = value.toString().trim();
  if (!source || source.includes('[native code]') || source.length > 16_384) {
    throw new Error(`Invalid ${label}: provide a self-contained function smaller than 16 KiB.`);
  }
  try {
    // This runs only in the trusted Node build process. The emitted worker uses
    // a static function expression and never requires unsafe-eval at runtime.
    void new Function(`return (${source});`);
  } catch (reason) {
    throw new Error(`Invalid ${label}: ${reason instanceof Error ? reason.message : String(reason)}`);
  }
  return source;
}

async function collectPrecache(
  outDir: string,
  swFile: string,
  config: HomeframeConfig,
  swConfig: HomeframeServiceWorkerBuildConfig | undefined,
  base: string,
): Promise<PrecacheEntry[]> {
  const entries: PrecacheEntry[] = [];
  const maximum = swConfig?.precache?.maximumFileSizeBytes ?? 8 * 1024 * 1024;
  const include = swConfig?.precache?.include ?? [];
  const exclude = swConfig?.precache?.exclude ?? [/\.map$/];
  for (const file of await walk(outDir)) {
    const relativeFile = relative(outDir, file).split(sep).join('/');
    if (relativeFile === swFile || relativeFile === 'homeframe-build.json') continue;
    if (exclude.some((pattern) => pattern.test(relativeFile))) continue;
    if (include.length > 0 && !include.some((pattern) => pattern.test(relativeFile))) continue;
    const details = await stat(file);
    if (details.size > maximum) {
      if (/\.(?:html|js|css|woff2?)$/i.test(relativeFile)) {
        throw new Error(`Required shell asset ${relativeFile} is ${details.size} bytes, exceeding serviceWorker.precache.maximumFileSizeBytes (${maximum}). Increase the explicit bound or reduce the asset; Homeframe will not publish a partial offline shell.`);
      }
      continue;
    }
    const contents = await readFile(file);
    const revision = hash(Buffer.concat([
      contents,
      Buffer.from(swConfig?.cacheRevisionSalt ?? ''),
    ]));
    const url = relativeFile === 'index.html'
      ? swConfig?.documentFallback ?? config.app.startUrl
      : joinBase(base, relativeFile);
    entries.push({ url, revision });
  }
  entries.push(...(swConfig?.precache?.additionalEntries ?? []));
  return dedupeEntries(entries);
}

async function walk(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function dedupeEntries(entries: PrecacheEntry[]): PrecacheEntry[] {
  return [...new Map(entries.map((entry) => [entry.url, entry])).values()];
}

function assetReport(asset: GeneratedHomeframeAsset) {
  return {
    fileName: asset.fileName,
    mimeType: asset.mimeType,
    purpose: asset.purpose,
    width: asset.width,
    height: asset.height,
    bytes: typeof asset.source === 'string' ? Buffer.byteLength(asset.source) : asset.source.byteLength,
    sha256: hash(asset.source),
  };
}

function hash(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function ensureNoConflictingMetadata(html: string): void {
  const conflicts = [
    /<meta[^>]+name=["']viewport["']/i,
    /<link[^>]+rel=["']manifest["']/i,
    /<meta[^>]+name=["']apple-mobile-web-app-capable["']/i,
  ].filter((pattern) => pattern.test(html));
  if (conflicts.length) {
    throw new Error('Homeframe owns viewport, manifest, and installed-app metadata. Remove duplicates from index.html.');
  }
}

function criticalCss(config: HomeframeConfig): string {
  const configuredScheme = config.app.colorScheme ?? 'system';
  const lightBackground = config.app.backgroundColor;
  const darkBackground = config.app.backgroundColorDark ?? lightBackground;
  const background = configuredScheme === 'dark' ? darkBackground : lightBackground;
  const cssScheme = configuredScheme === 'system'
    ? 'light dark'
    : `only ${configuredScheme}`;
  const adaptiveBackground = configuredScheme === 'system'
    ? `@media(prefers-color-scheme:dark){:root{--hf-app-background:${darkBackground};background:${darkBackground}}}`
    : '';
  // Do not position:fixed the document itself. WebKit clips a fixed root above the
  // standalone bottom scene inset (WebKit 237961/301108), producing the exact
  // empty strip Homeframe is intended to prevent. The document remains immobile
  // through overflow:hidden while AppViewport owns visual-viewport positioning.
  return `:root{--hf-app-background:${background};--hf-color-scheme:${cssScheme};background:${background};color-scheme:var(--hf-color-scheme)}html,body,#homeframe-root{width:100%;margin:0;overflow:hidden;background:var(--hf-app-background)}html,body{height:100vh;min-height:100vh;overscroll-behavior:none}#homeframe-root{height:100%}#homeframe-boot-splash{position:fixed;z-index:2147483647;inset:0;min-height:var(--hf-shell-height,100%);display:grid;place-content:center;place-items:center;gap:16px;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);color:CanvasText;background:var(--hf-app-background);font:600 17px/1.2 system-ui,-apple-system,sans-serif;transition:opacity 160ms ease}#homeframe-boot-splash img{width:22vmin;height:22vmin;object-fit:contain}:root[data-hf-ready=true]:not([data-hf-splash-visible]) #homeframe-boot-splash{visibility:hidden;opacity:0;pointer-events:none}:root[data-hf-splash-visible] #homeframe-boot-splash{visibility:visible;opacity:1}${adaptiveBackground}@media(prefers-reduced-motion:reduce){#homeframe-boot-splash{transition:none}}`;
}

function documentColorScheme(config: HomeframeConfig): string {
  const scheme = config.app.colorScheme ?? 'system';
  return scheme === 'system' ? 'light dark' : scheme;
}

function themeColorMetadata(config: HomeframeConfig): string[] {
  const { app } = config;
  const scheme = app.colorScheme ?? 'system';
  if (scheme === 'light') {
    return [`<meta name="theme-color" content="${app.themeColor}" data-hf-theme-color="light">`];
  }
  if (scheme === 'dark') {
    return [`<meta name="theme-color" content="${app.themeColorDark ?? app.themeColor}" data-hf-theme-color="dark">`];
  }
  return [
    `<meta name="theme-color" content="${app.themeColor}" media="(prefers-color-scheme: light)" data-hf-theme-color="light">`,
    `<meta name="theme-color" content="${app.themeColorDark ?? app.themeColor}" media="(prefers-color-scheme: dark)" data-hf-theme-color="dark">`,
  ];
}

function bootScript(info: {
  appId: string;
  buildId: string;
  backgroundColor: string;
  appleStatusBarStyle: 'default' | 'black' | 'black-translucent';
  serviceWorkerUrl: string | null;
  serviceWorkerScope: string;
  client: ReturnType<typeof clientConfiguration>;
}): string {
  const buildInfo = {
    appId: info.appId,
    buildId: info.buildId,
    backgroundColor: info.backgroundColor,
    serviceWorkerUrl: info.serviceWorkerUrl,
    serviceWorkerScope: info.serviceWorkerScope,
    serviceWorkerConfig: info.client.serviceWorker,
    reactConfig: info.client.react,
    routerConfig: info.client.router,
  };
  const edgeToEdgeIos = info.appleStatusBarStyle === 'black-translucent';
  return `(function(){var d=document.documentElement,v=window.visualViewport,ms=window.matchMedia,r=document.getElementById('homeframe-runtime-vars'),s,ios=navigator.standalone===true,edge=${edgeToEdgeIos},q,t=0;try{s=r.sheet.cssRules[0].style}catch(e){s=d.style}if(ios&&edge){q=document.createElement('div');q.style.cssText='position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top,0px)';d.appendChild(q);t=parseFloat(getComputedStyle(q).paddingTop)||0;q.remove()}window.__HOMEFRAME_BUILD__=${JSON.stringify(buildInfo)};d.dataset.hfReady='false';d.dataset.hfKeyboard='closed';d.dataset.hfDisplayMode=ms&&ms('(display-mode: fullscreen)').matches?'fullscreen':ms&&ms('(display-mode: standalone)').matches?'standalone':ms&&ms('(display-mode: minimal-ui)').matches?'minimal-ui':ios?'standalone':'browser';d.dataset.hfIosStandalone=ios?'true':'false';function m(){if(d.dataset.hfReady==='true')return;var w=v?v.width:window.innerWidth,h=v?v.height:window.innerHeight,x=v?v.offsetLeft:0,y=v?v.offsetTop:0,p=ios&&v&&isFinite(v.pageTop)&&v.pageTop>0?v.pageTop:0,z=v?v.scale:1,sh=window.innerHeight,g=window.screen.height-sh,fh=ios&&edge&&t>0&&g>0&&Math.abs(g-t)<=Math.max(1,t*.08)?window.screen.height:sh;s.setProperty('--hf-viewport-width',w+'px');s.setProperty('--hf-viewport-height',h+'px');s.setProperty('--hf-viewport-x',x+'px');s.setProperty('--hf-viewport-y',y+'px');s.setProperty('--hf-layout-viewport-top',p+'px');s.setProperty('--hf-shell-width',(d.dataset.hfDisplayMode==='browser'?x+w:Math.max(window.innerWidth,x+w))+'px');s.setProperty('--hf-shell-height',(d.dataset.hfDisplayMode==='browser'?y+h:Math.max(fh,y+h))+'px');s.setProperty('--hf-stable-width',window.innerWidth+'px');s.setProperty('--hf-stable-height',fh+'px');s.setProperty('--hf-input-min-font-size',(16/Math.min(Math.max(z,.1),1))+'px')}m();v&&v.addEventListener('resize',m,{passive:true});v&&v.addEventListener('scroll',m,{passive:true});window.addEventListener('resize',m,{passive:true})})()`;
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
