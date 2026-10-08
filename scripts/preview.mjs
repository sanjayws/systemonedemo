import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { readFile, stat, realpath } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import worker from '../src/worker.js';

const root = resolve(import.meta.dirname, '../web');
const port = Number(process.env.PORT || 8787);
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const env = {
  ASSETS: { async fetch(request) {
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Use GET or HEAD.', { status: 405, headers: { Allow: 'GET, HEAD' } });
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url).pathname); } catch { return new Response('Bad path', { status: 400 }); }
    let path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!path.startsWith(root + sep)) return new Response('Not found', { status: 404 });
    try {
      path = await realpath(path);
      if (!path.startsWith(root + sep)) return new Response('Not found', { status: 404 });
      if (!(await stat(path)).isFile()) return new Response('Not found', { status: 404 });
      return new Response(request.method === 'HEAD' ? null : await readFile(path), { headers: { 'Content-Type': mime[extname(path)] || 'application/octet-stream' } });
    } catch { return new Response('Not found', { status: 404 }); }
  } },
};
export function createPreviewServer() {
  return createServer(async (incoming, outgoing) => {
    try {
      const method = incoming.method || 'GET';
      const host = incoming.headers.host;
      if (!host || !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) { outgoing.writeHead(403); outgoing.end('Use localhost or 127.0.0.1.'); return; }
      const request = new Request(new URL(incoming.url, `http://${host}`), { method, headers: incoming.headers, ...(method !== 'GET' && method !== 'HEAD' ? { body: Readable.toWeb(incoming), duplex: 'half' } : {}) });
      const response = await worker.fetch(request, env);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      if (!response.body || method === 'HEAD') outgoing.end();
      else Readable.fromWeb(response.body).pipe(outgoing);
    } catch { outgoing.writeHead(500); outgoing.end('Preview could not serve this request.'); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = createPreviewServer();
  server.on('error', error => { console.error(`Preview could not start (${error.code}). Check that PORT is available.`); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => {
    console.log(`System One preview: http://127.0.0.1:${port}`);
    console.log('Offline preview. Example outputs are illustrations; use npm run dev for real Cloudflare inference.');
  });
}
