import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
};
const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const rel = pathname === '/' ? 'assets/spear-thrusts/review.html' : pathname.replace(/^\//, '');
    const file = path.resolve(root, rel);
    if (
      !file.startsWith(root + path.sep) ||
      !/^(public\/models\/|node_modules\/three\/|dist\/|assets\/spear-thrusts\/|output\/spear-thrusts\/)/.test(
        rel,
      )
    )
      throw Error('outside review');
    if (req.method !== 'GET') {
      res.writeHead(405).end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end('Not found');
  }
});
const port = Number(process.argv[2] || 3038);
server.listen(port, '127.0.0.1', () =>
  console.log(`Motion review http://127.0.0.1:${port}/ PID ${process.pid}`),
);
