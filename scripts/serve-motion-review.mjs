import http from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
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
    if (
      req.method === 'POST' &&
      /^\/capture\/(baseline|revision-\d+)\/[a-z0-9-]+\.(png|webm|json)$/.test(pathname)
    ) {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 40 * 1024 * 1024) throw Error('capture too large');
        chunks.push(chunk);
      }
      const filename = path.join(
        root,
        'output/playwright/creature-motion-20260909/exact-glb',
        pathname.slice('/capture/'.length),
      );
      await mkdir(path.dirname(filename), { recursive: true });
      await writeFile(filename, Buffer.concat(chunks));
      res.writeHead(200).end('saved');
      return;
    }
    const rel =
      pathname === '/' ? 'assets/creature-motion/review.html' : pathname.replace(/^\//, '');
    const file = path.resolve(root, rel);
    if (
      !file.startsWith(root + path.sep) ||
      !/^(public\/models\/|node_modules\/three\/|dist\/|assets\/creature-motion\/|output\/creature-motion\/)/.test(
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
const port = Number(process.argv[2] || 3014);
server.listen(port, '127.0.0.1', () =>
  console.log(`Motion review http://127.0.0.1:${port}/ PID ${process.pid}`),
);
