import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

const root = resolve('examples/kitchen-sink/dist');
const port = Number(process.env.PORT ?? 4173);
const types = {
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
  let file = resolve(root, `.${decodeURIComponent(url.pathname)}`);
  if (!file.startsWith(root)) {
    response.writeHead(403).end();
    return;
  }
  try {
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
  } catch {
    file = resolve(root, 'index.html');
  }
  try {
    const body = await readFile(file);
    const extension = extname(file);
    const isWorker = url.pathname === '/sw.js';
    const isHtml = extension === '.html';
    const immutable = /\/assets\/.*-[A-Za-z0-9_-]+\.(js|css)$/.test(url.pathname);
    response.writeHead(200, {
      'Content-Type': types[extension] ?? 'application/octet-stream',
      'Cache-Control': isWorker || isHtml
        ? 'no-cache, max-age=0, must-revalidate'
        : immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
      'Service-Worker-Allowed': '/',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    });
    response.end(body);
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'text/plain' });
    response.end(String(error));
  }
});

server.listen(port, '127.0.0.1', () => console.log(`Homeframe test server http://127.0.0.1:${port}`));
