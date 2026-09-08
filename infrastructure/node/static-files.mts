import type { IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
export const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.glb': 'model/gltf-binary',
};

/** Only public assets and emitted browser/domain modules are exposed. */
export async function serveStatic(
  request: IncomingMessage,
  response: ServerResponse,
  urlPath: string,
  root: string,
): Promise<void> {
  const pathname = decodeURIComponent(urlPath);
  const mount = pathname.startsWith('/src/')
    ? 'src'
    : pathname.startsWith('/shared/')
      ? 'shared'
      : 'public';
  const base = path.join(root, mount === 'public' ? 'public' : `dist/${mount}`);
  const relative =
    mount === 'public'
      ? pathname === '/'
        ? 'index.html'
        : pathname.replace(/^\/+/, '')
      : pathname.slice(mount.length + 2);
  const filename = path.resolve(base, relative);
  const allowed = path.relative(base, filename);
  if (
    pathname.includes('\\') ||
    !allowed ||
    allowed.startsWith('..') ||
    path.isAbsolute(allowed) ||
    allowed.split(path.sep).some((segment) => segment.startsWith('.')) ||
    !MIME[path.extname(filename)]
  ) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  const info = await stat(filename);
  if (!info.isFile()) {
    response.writeHead(404).end('Not found');
    return;
  }
  const etag = `W/"${info.size.toString(16)}-${info.mtimeMs.toString(16)}"`;
  if (
    request.headers['if-none-match']
      ?.split(',')
      .map((value) => value.trim())
      .includes(etag)
  ) {
    response.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' }).end();
    return;
  }
  response.writeHead(200, {
    'Content-Type': MIME[path.extname(filename)],
    'Content-Length': info.size,
    'Cache-Control': 'no-cache',
    ETag: etag,
  });
  if (request.method === 'HEAD') response.end();
  else
    createReadStream(filename)
      .on('error', () => response.destroy())
      .pipe(response);
}
