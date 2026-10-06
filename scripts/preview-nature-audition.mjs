// Read-only loopback preview of the standalone audio review, separate from the game.
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(process.argv[2] || 'output/nature-audio-review-20261006');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.json': 'application/json',
  '.png': 'image/png',
};
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost'),
      file = path.resolve(
        root,
        '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname),
      );
    const relative = path.relative(root, file),
      type = mime[path.extname(file)];
    if (
      !relative ||
      relative.startsWith('..') ||
      path.isAbsolute(relative) ||
      !type ||
      !['GET', 'HEAD'].includes(req.method)
    ) {
      res.writeHead(403).end();
      return;
    }
    const info = await stat(file);
    if (!info.isFile()) {
      res.writeHead(404).end();
      return;
    }
    const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/),
      start = range ? Number(range[1]) : 0,
      end = range && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
    if (start > end || start >= info.size) {
      res.writeHead(416).end();
      return;
    }
    res.writeHead(range ? 206 : 200, {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Cache-Control': 'no-store',
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${info.size}` } : {}),
    });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file, { start, end }).pipe(res);
  } catch {
    res.writeHead(404).end();
  }
});
server.listen(0, '127.0.0.1', () =>
  console.log(`Audio review: http://127.0.0.1:${server.address().port}/`),
);
