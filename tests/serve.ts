import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import type { OutgoingHttpHeaders } from 'node:http';

const root = resolve('examples/kitchen-sink/dist');
const port = Number(process.env.PORT ?? 4173);
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.map': 'application/json; charset=utf-8',
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
  if (url.pathname === '/api/push/subscriptions') {
    response.writeHead(204, { 'Cache-Control': 'no-store' });
    response.end();
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    response.writeHead(404, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(JSON.stringify({ error: 'API route not found.' }));
    return;
  }
  const rawPathname = request.url?.startsWith('/')
    ? request.url.split(/[?#]/, 1)[0] ?? url.pathname
    : url.pathname;
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
  let file = resolve(root, `.${decodedPath}`);
  const relativeFile = relative(root, file);
  if (relativeFile.startsWith('..') || isAbsolute(relativeFile)) {
    response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Forbidden.');
    return;
  }
  try {
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
  } catch {
    if (url.pathname === '/sw.js' || extname(url.pathname)) {
      response.writeHead(404, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      }).end('Not found.');
      return;
    }
    file = resolve(root, 'index.html');
  }
  try {
    let body = await readFile(file);
    const extension = extname(file);
    const isWorker = url.pathname === '/sw.js';
    const isHtml = extension === '.html';
    const immutable = /\/assets\/.*-[A-Za-z0-9_-]+\.(js|css)$/.test(url.pathname);
    const headers: OutgoingHttpHeaders = {
      'Content-Type': types[extension] ?? 'application/octet-stream',
      'Cache-Control': isWorker || isHtml
        ? 'no-cache, max-age=0, must-revalidate'
        : immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
      'Service-Worker-Allowed': '/',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
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
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'text/plain' });
    response.end(String(error));
  }
});

server.listen(port, '127.0.0.1', () => console.log(`Homeframe test server http://127.0.0.1:${port}`));
