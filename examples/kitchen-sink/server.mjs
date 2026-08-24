import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import webpush from 'web-push';

const exampleRoot = resolve(import.meta.dirname);
const workspaceRoot = resolve(exampleRoot, '../..');
const dataDirectory = resolve(exampleRoot, '.homeframe');
const vapidPath = resolve(dataDirectory, 'vapid.json');
const subscriptionsPath = resolve(dataDirectory, 'subscriptions.json');
const portArgument = process.argv.find((value) => value.startsWith('--port='));
const port = Number(portArgument?.split('=')[1] ?? process.env.PORT ?? 4173);
const skipBuild = process.argv.includes('--skip-build');
const tlsCertificatePath = process.env.HOMEFRAME_TLS_CERT;
const tlsKeyPath = process.env.HOMEFRAME_TLS_KEY;
if (Boolean(tlsCertificatePath) !== Boolean(tlsKeyPath)) {
  throw new Error('Set both HOMEFRAME_TLS_CERT and HOMEFRAME_TLS_KEY, or neither.');
}

await mkdir(dataDirectory, { recursive: true });
const vapid = await getVapidKeys();
webpush.setVapidDetails('mailto:homeframe@example.com', vapid.publicKey, vapid.privateKey);

if (!skipBuild) {
  const build = spawnSync('npm', ['run', 'build:example'], {
    cwd: workspaceRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_VAPID_PUBLIC_KEY: vapid.publicKey,
      HOMEFRAME_BUILD_ID: process.env.HOMEFRAME_BUILD_ID ?? `demo-${Date.now()}`,
    },
  });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const dist = resolve(exampleRoot, 'dist');
const subscriptions = new Map();
for (const subscription of await readJson(subscriptionsPath, [])) {
  if (subscription?.endpoint) subscriptions.set(subscription.endpoint, subscription);
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.map': 'application/json; charset=utf-8',
};

const handleRequest = async (request, response) => {
  try {
    const protocol = tlsCertificatePath ? 'https' : 'http';
    const url = new URL(request.url ?? '/', `${protocol}://${request.headers.host}`);
    if (url.pathname.startsWith('/api/')) {
      await handleApi(request, response, url);
      return;
    }
    await serveStatic(response, url.pathname);
  } catch (error) {
    json(response, Number(error?.statusCode) || 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

const server = tlsCertificatePath
  ? createHttpsServer({
    cert: await readFile(resolve(tlsCertificatePath)),
    key: await readFile(resolve(tlsKeyPath)),
  }, handleRequest)
  : createHttpServer(handleRequest);

server.listen(port, '0.0.0.0', () => {
  console.log(`Homeframe demo: ${tlsCertificatePath ? 'https' : 'http'}://127.0.0.1:${port}`);
  console.log(`VAPID public key: ${vapid.publicKey}`);
  console.log(`Push subscriptions: ${subscriptions.size}`);
});

async function handleApi(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/push/status') {
    json(response, 200, { publicKey: vapid.publicKey, subscriptions: subscriptions.size });
    return;
  }
  if (url.pathname === '/api/push/subscriptions' && request.method === 'PUT') {
    requireSameSite(request);
    const subscription = await bodyJson(request, 16_384);
    if (!subscription?.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
      json(response, 400, { error: 'A complete PushSubscription is required.' });
      return;
    }
    subscriptions.set(subscription.endpoint, subscription);
    await persistSubscriptions();
    response.writeHead(204, { 'Cache-Control': 'no-store' });
    response.end();
    return;
  }
  if (url.pathname === '/api/push/subscriptions' && request.method === 'DELETE') {
    requireSameSite(request);
    const body = await bodyJson(request, 4_096);
    if (typeof body?.endpoint === 'string') subscriptions.delete(body.endpoint);
    await persistSubscriptions();
    response.writeHead(204, { 'Cache-Control': 'no-store' });
    response.end();
    return;
  }
  if (url.pathname === '/api/push/send' && request.method === 'POST') {
    requireSameSite(request);
    const input = await bodyJson(request, 8_192);
    const payload = JSON.stringify({
      version: 1,
      title: String(input?.title ?? 'Homeframe').slice(0, 120),
      body: String(input?.body ?? 'End-to-end push test').slice(0, 500),
      route: safeRoute(input?.route),
      badgeCount: Number.isFinite(input?.badgeCount) ? Math.max(0, input.badgeCount) : undefined,
      tag: 'homeframe-e2e',
    });
    let sent = 0;
    let failed = 0;
    for (const [endpoint, subscription] of subscriptions) {
      try {
        await webpush.sendNotification(subscription, payload, { TTL: 60, urgency: 'normal' });
        sent += 1;
      } catch (error) {
        failed += 1;
        if (error?.statusCode === 404 || error?.statusCode === 410) subscriptions.delete(endpoint);
        else console.error('Push delivery failed:', error?.message ?? error);
      }
    }
    await persistSubscriptions();
    json(response, 200, { sent, failed, subscriptions: subscriptions.size });
    return;
  }
  json(response, 404, { error: 'API route not found.' });
}

async function serveStatic(response, pathname) {
  let file = resolve(dist, `.${decodeURIComponent(pathname)}`);
  if (!file.startsWith(dist)) {
    response.writeHead(403).end();
    return;
  }
  try {
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
  } catch {
    file = resolve(dist, 'index.html');
  }
  const body = await readFile(file);
  const extension = extname(file);
  const isWorker = pathname === '/sw.js';
  const isHtml = extension === '.html';
  const immutable = /\/assets\/.*-[A-Za-z0-9_-]+\.(js|css)$/.test(pathname);
  response.writeHead(200, {
    'Content-Type': mimeTypes[extension] ?? 'application/octet-stream',
    'Cache-Control': isWorker || isHtml
      ? 'no-cache, max-age=0, must-revalidate'
      : immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
    'Service-Worker-Allowed': '/',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cross-Origin-Opener-Policy': 'same-origin',
  });
  response.end(body);
}

function requireSameSite(request) {
  const fetchSite = request.headers['sec-fetch-site'];
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'same-site') {
    const error = new Error('Cross-site demo API request rejected.');
    error.statusCode = 403;
    throw error;
  }
}

function bodyJson(request, limit) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let length = 0;
    request.on('data', (chunk) => {
      length += chunk.length;
      if (length > limit) {
        reject(new Error('Request body is too large.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new Error('Request body must be valid JSON.'));
      }
    });
    request.on('error', reject);
  });
}

function safeRoute(value) {
  if (typeof value !== 'string') return '/pwa';
  try {
    const url = new URL(value, 'https://homeframe.invalid');
    return url.origin === 'https://homeframe.invalid' ? `${url.pathname}${url.search}${url.hash}` : '/pwa';
  } catch {
    return '/pwa';
  }
}

function json(response, status, value) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}

async function getVapidKeys() {
  if (existsSync(vapidPath)) return readJson(vapidPath, null);
  const keys = webpush.generateVAPIDKeys();
  await writeFile(vapidPath, `${JSON.stringify(keys, null, 2)}\n`, { mode: 0o600 });
  return keys;
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function persistSubscriptions() {
  return writeFile(subscriptionsPath, `${JSON.stringify([...subscriptions.values()], null, 2)}\n`, { mode: 0o600 });
}
