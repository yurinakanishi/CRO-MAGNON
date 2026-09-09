import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'output/downed-motion/review');
await mkdir(output, { recursive: true });
http
  .createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (req.method === 'POST' && /^\/capture\/[a-z0-9-]+\.(png|webm|json)$/.test(pathname)) {
        const chunks = [];
        let size = 0;
        for await (const c of req) {
          size += c.length;
          if (size > 40e6) throw Error('too large');
          chunks.push(c);
        }
        await writeFile(path.join(output, path.basename(pathname)), Buffer.concat(chunks));
        res.writeHead(200).end('saved');
        return;
      }
      const rel = pathname === '/' ? 'assets/downed-motion/review.html' : pathname.slice(1),
        file = path.resolve(root, rel);
      if (
        !file.startsWith(root + path.sep) ||
        !/^(assets\/downed-motion\/|output\/downed-motion\/|node_modules\/three\/|dist\/)/.test(
          rel,
        ) ||
        req.method !== 'GET'
      )
        throw Error('outside review');
      res
        .writeHead(200, {
          'Content-Type':
            {
              '.html': 'text/html',
              '.js': 'text/javascript',
              '.mjs': 'text/javascript',
              '.json': 'application/json',
              '.glb': 'model/gltf-binary',
            }[path.extname(file)] || 'application/octet-stream',
          'Cache-Control': 'no-store',
        })
        .end(await readFile(file));
    } catch {
      res.writeHead(404).end('Not found');
    }
  })
  .listen(3023, '127.0.0.1', () => console.log('Downed review http://127.0.0.1:3023/'));
