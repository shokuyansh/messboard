import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { Readable } from 'node:stream';
import { getConnection } from '../lib/database.js';
import { migrate } from './migrate.mjs';
import app from '../api/index.js';

const { client } = await getConnection();
await migrate(client);
const root = resolve('public');
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const server = createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url, `http://${incoming.headers.host}`);
    if (url.pathname.startsWith('/api/')) {
      const request = new Request(url, { method: incoming.method, headers: incoming.headers, ...(!['GET', 'HEAD'].includes(incoming.method) ? { body: Readable.toWeb(incoming), duplex: 'half' } : {}) });
      const response = await app.fetch(request);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    const path = resolve(root, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
    if (!path.startsWith(`${root}/`)) { outgoing.writeHead(403); outgoing.end(); return; }
    const content = await readFile(path);
    outgoing.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    outgoing.end(content);
  } catch (error) {
    outgoing.writeHead(error.code === 'ENOENT' ? 404 : 500); outgoing.end('Request could not be completed.');
  }
});
server.listen(Number(process.env.PORT || 3000), '127.0.0.1', () => console.log(`Mess Hub: http://127.0.0.1:${process.env.PORT || 3000}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { client.close(); process.exit(0); }));
