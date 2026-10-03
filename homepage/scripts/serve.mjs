#!/usr/bin/env node
/** Local static preview/test server. This file is NOT in the public bundle. */
import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EXHIBIT_CSP, SHELL_CSP } from './boundary.mjs';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.gz': 'application/gzip' };

export async function startStaticServer(root, port = 0) {
  root = await realpath(root);
  const server = createServer(async (req, res) => {
    const general = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' };
    const end = (code, text, extra = {}) => { res.writeHead(code, { ...general, 'Content-Type': 'text/plain; charset=utf-8', ...extra }); res.end(req.method === 'HEAD' ? undefined : text); };
    if (!['GET', 'HEAD'].includes(req.method)) return end(405, 'Read-only static site', { Allow: 'GET, HEAD' });
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (path.includes('\\') || path.includes('\0') || path.split('/').some(part => part.startsWith('.')) || /(?:^|\/)api(?:\/|$)/i.test(path)) return end(404, 'Not found');
      let target = resolve(root, '.' + path);
      if (target !== root && !target.startsWith(root + sep)) return end(404, 'Not found');
      if ((await stat(target)).isDirectory()) target = resolve(target, 'index.html');
      target = await realpath(target);
      if (!target.startsWith(root + sep)) return end(404, 'Not found');
      const body = await readFile(target);
      res.writeHead(200, { ...general, 'Content-Type': TYPES[extname(target)] ?? 'application/octet-stream', 'Content-Length': body.length, 'Content-Security-Policy': path.startsWith('/exhibit/') ? EXHIBIT_CSP : SHELL_CSP });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch { end(404, 'Not found'); }
  });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done); });
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = process.argv[2];
  const port = Number(process.argv[3] ?? 4173);
  if (!root || !Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Usage: node homepage/scripts/serve.mjs homepage/dist [port]');
  const server = await startStaticServer(root, port);
  console.log(`Static preview: http://127.0.0.1:${server.address().port}`);
}
