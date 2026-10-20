'use strict';

// A loopback-only static server. No npm installation or desktop services needed.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8' };

function createServer(directory = root) {
  const base = fs.realpathSync(directory);
  return http.createServer((request, response) => {
    let filename;
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      filename = path.resolve(base, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!filename.startsWith(base + path.sep) || !['GET', 'HEAD'].includes(request.method)) {
        response.writeHead(403); response.end('Forbidden'); return;
      }
      const real = fs.realpathSync(filename);
      if (!real.startsWith(base + path.sep) || !fs.statSync(real).isFile()) throw new Error('Not a file');
      const body = fs.readFileSync(real);
      response.writeHead(200, { 'Content-Type': mime[path.extname(real)] || 'application/octet-stream', 'Content-Length': body.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch (error) {
      response.writeHead(error instanceof URIError ? 400 : 404);
      response.end(error instanceof URIError ? 'Bad request' : 'Not found');
    }
  });
}

if (require.main === module) {
  const port = Number(process.argv[2] || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be 1–65535');
  const server = createServer();
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`CampusLink v1.4.1 website: http://127.0.0.1:${port}`));
  const close = () => server.close(() => process.exit(0));
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
}
module.exports = { createServer };
