import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve } from 'node:path';
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
const allowedHosts = new Set((process.env.HOMEFRAME_ALLOWED_HOSTS ?? '')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean));
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
const rateBuckets = new Map();
let pushSendInFlight = false;
const storedSubscriptions = await readJson(subscriptionsPath, []);
for (const subscription of (Array.isArray(storedSubscriptions) ? storedSubscriptions.slice(0, 200) : [])) {
  if (validSubscription(subscription)) subscriptions.set(subscription.endpoint, subscription);
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
    const rawPathname = request.url?.startsWith('/')
      ? request.url.split(/[?#]/, 1)[0]
      : url.pathname;
    await serveStatic(response, url.pathname, rawPathname);
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
    requireJson(request);
    enforceRateLimit(request, 'subscriptions', 60, 60_000);
    const subscription = await bodyJson(request, 16_384);
    if (!validSubscription(subscription)) {
      json(response, 400, { error: 'A complete PushSubscription is required.' });
      return;
    }
    if (!subscriptions.has(subscription.endpoint) && subscriptions.size >= 200) {
      json(response, 507, { error: 'The demo subscription limit has been reached.' });
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
    requireJson(request);
    enforceRateLimit(request, 'subscriptions', 60, 60_000);
    const body = await bodyJson(request, 4_096);
    if (typeof body?.endpoint === 'string') subscriptions.delete(body.endpoint);
    await persistSubscriptions();
    response.writeHead(204, { 'Cache-Control': 'no-store' });
    response.end();
    return;
  }
  if (url.pathname === '/api/push/send' && request.method === 'POST') {
    requireSameSite(request);
    requireJson(request);
    enforceRateLimit(request, 'send', 10, 60_000);
    if (pushSendInFlight) {
      json(response, 409, { error: 'A demo push send is already in progress.' });
      return;
    }
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
    pushSendInFlight = true;
    try {
      for (const [endpoint, subscription] of subscriptions) {
        try {
          await webpush.sendNotification(subscription, payload, {
            TTL: 60,
            urgency: 'normal',
            timeout: 5_000,
          });
          sent += 1;
        } catch (error) {
          failed += 1;
          if (error?.statusCode === 404 || error?.statusCode === 410) subscriptions.delete(endpoint);
          else console.error('Push delivery failed:', error?.message ?? error);
        }
      }
    } finally {
      pushSendInFlight = false;
    }
    await persistSubscriptions();
    json(response, 200, { sent, failed, subscriptions: subscriptions.size });
    return;
  }
  json(response, 404, { error: 'API route not found.' });
}

async function serveStatic(response, pathname, rawPathname = pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(rawPathname);
  } catch {
    response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Invalid URL encoding.');
    return;
  }
  if (decodedPath.includes('\0')) {
    response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Invalid path.');
    return;
  }
  let file = resolve(dist, `.${decodedPath}`);
  const relativeFile = relative(dist, file);
  if (relativeFile.startsWith('..') || isAbsolute(relativeFile)) {
    response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Forbidden.');
    return;
  }
  try {
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
  } catch {
    if (pathname === '/sw.js' || extname(pathname)) {
      response.writeHead(404, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      }).end('Not found.');
      return;
    }
    file = resolve(dist, 'index.html');
  }
  let body = await readFile(file);
  const extension = extname(file);
  const isWorker = pathname === '/sw.js';
  const isHtml = extension === '.html';
  const immutable = /\/assets\/.*-[A-Za-z0-9_-]+\.(js|css)$/.test(pathname);
  const headers = {
    'Content-Type': mimeTypes[extension] ?? 'application/octet-stream',
    'Cache-Control': isWorker || isHtml
      ? 'no-cache, max-age=0, must-revalidate'
      : immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
    'Service-Worker-Allowed': '/',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  };
  if (isHtml) {
    const templateRevision = createHash('sha256')
      .update(body)
      .update(process.env.HOMEFRAME_CACHE_SALT ?? '')
      .digest('hex');
    const nonce = randomBytes(18).toString('base64url');
    body = Buffer.from(body.toString('utf8').replaceAll('__HOMEFRAME_CSP_NONCE__', nonce));
    headers['Content-Security-Policy'] = [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}'`,
      `style-src 'self' 'nonce-${nonce}'`,
      "style-src-attr 'none'",
      "img-src 'self' data: blob:",
      "connect-src 'self'",
      "worker-src 'self'",
      "manifest-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
    ].join('; ');
    headers['X-Homeframe-Revision'] = templateRevision;
  }
  response.writeHead(200, headers);
  response.end(body);
}

function requireSameSite(request) {
  const requestHost = String(request.headers.host ?? '').toLowerCase();
  if (allowedHosts.size > 0 && !allowedHosts.has(requestHost)) {
    const error = new Error('Unrecognized Host header.');
    error.statusCode = 403;
    throw error;
  }
  const expectedOrigin = `${tlsCertificatePath ? 'https' : 'http'}://${requestHost}`;
  const origin = request.headers.origin;
  const fetchSite = request.headers['sec-fetch-site'];
  if ((origin && origin !== expectedOrigin)
    || (!origin && fetchSite !== 'same-origin' && fetchSite !== 'same-site')
    || (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'same-site')) {
    const error = new Error('Cross-site demo API request rejected.');
    error.statusCode = 403;
    throw error;
  }
}

function requireJson(request) {
  if (!String(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
    const error = new Error('Demo API requests must use application/json.');
    error.statusCode = 415;
    throw error;
  }
}

function validSubscription(value) {
  if (!value || typeof value !== 'object') return false;
  if (typeof value.endpoint !== 'string' || value.endpoint.length > 2_048) return false;
  try {
    const endpoint = new URL(value.endpoint);
    if (endpoint.protocol !== 'https:') return false;
  } catch {
    return false;
  }
  return typeof value.keys?.p256dh === 'string'
    && value.keys.p256dh.length <= 512
    && typeof value.keys?.auth === 'string'
    && value.keys.auth.length <= 512;
}

function enforceRateLimit(request, action, maximum, windowMs) {
  const address = request.socket.remoteAddress ?? 'unknown';
  const key = `${address}:${action}`;
  const now = Date.now();
  const current = rateBuckets.get(key);
  const bucket = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + windowMs }
    : current;
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  if (bucket.count > maximum) {
    const error = new Error('Too many demo API requests.');
    error.statusCode = 429;
    throw error;
  }
  if (rateBuckets.size > 1_000) {
    for (const [bucketKey, value] of rateBuckets) {
      if (value.resetAt <= now) rateBuckets.delete(bucketKey);
    }
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
