import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
const server = createServer(async (request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok', mode: 'dashboard-foundation' }));
    return;
  }
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const relative = pathname === '/' ? 'index.html' : normalize(pathname).replace(/^([/\\])+/, '');
  const path = join(root, relative);
  if (!path.startsWith(root)) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const body = await readFile(path);
    response.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream', 'x-content-type-options': 'nosniff' });
    response.end(body);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
  }
});

const port = Number(process.env.PORT ?? 4173);
server.listen(port, '0.0.0.0', () => console.log(`Safe Her dashboard listening on http://localhost:${port}`));
