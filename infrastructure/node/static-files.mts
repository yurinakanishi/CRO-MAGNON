import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Stats } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import path from 'node:path';
import { ALL_CONTENT, type ContentVisibility } from '../../shared/content-visibility.mjs';
import { localContentOverride } from './local-visibility.mjs';
import { COMPRESSIBLE, negotiateEncoding, sendBody, sendText } from './static-transport.mjs';
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
  '.wav': 'audio/wav',
  '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
};

/** Only public assets and emitted browser/domain modules are exposed. */
export async function serveStatic(
  request: IncomingMessage,
  response: ServerResponse,
  urlPath: string,
  root: string,
  visibility: ContentVisibility = ALL_CONTENT,
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
  const servedPath = `${mount === 'public' ? '' : `${mount}/`}${allowed.split(path.sep).join('/')}`;
  const override = await localContentOverride(servedPath, root, visibility);
  if (override === null) {
    response.writeHead(404, { 'Cache-Control': 'no-store' }).end('Not found');
    return;
  }
  // Text and GLBs may travel gzip-encoded (static-transport.mts); every other type, and every
  // client that does not ask for it, receives the stored bytes. The decoded bytes and
  // the ETag (of the stored file) are the same for both; Vary tells caches apart.
  const extension = path.extname(filename);
  const compressible = COMPRESSIBLE.has(extension.toLowerCase());
  const vary = compressible ? { Vary: 'Accept-Encoding' } : {};
  const coding = negotiateEncoding(request.headers['accept-encoding'], compressible);
  if (coding === null) {
    response
      .writeHead(406, { 'Content-Type': MIME['.txt'], 'Cache-Control': 'no-store', ...vary })
      .end('Not acceptable: no permitted content coding');
    return;
  }
  const encoded = coding === 'gzip' ? { 'Content-Encoding': 'gzip' } : {};
  if (override !== undefined) {
    // Filtered local content: never cached, never validated.
    response.writeHead(200, {
      'Content-Type': MIME[extension.toLowerCase()],
      'Cache-Control': 'no-store',
      ...vary,
      ...encoded,
    });
    if (request.method === 'HEAD') response.end();
    else void sendText(override, response, coding);
    return;
  }
  const info = await stat(filename);
  if (!info.isFile()) {
    response.writeHead(404).end('Not found');
    return;
  }
  // The bytes sent and their validator come from one open file, so a replaced file
  // is never sent under the previous revision's ETag.
  const handle = await open(filename, 'r');
  let opened: Stats;
  try {
    opened = await handle.stat();
  } catch (error) {
    await handle.close();
    throw error;
  }
  if (!opened.isFile()) {
    await handle.close();
    response.writeHead(404).end('Not found');
    return;
  }
  const etag = `W/"${opened.size.toString(16)}-${opened.mtimeMs.toString(16)}"`;
  if (
    request.headers['if-none-match']
      ?.split(',')
      .map((value) => value.trim())
      .includes(etag)
  ) {
    await handle.close();
    response.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache', ...vary }).end();
    return;
  }
  // An encoded body's length is unknown until it is produced: no Content-Length.
  response.writeHead(200, {
    'Content-Type': MIME[extension],
    ...(coding === 'identity' ? { 'Content-Length': opened.size } : encoded),
    'Cache-Control': 'no-cache',
    ETag: etag,
    ...vary,
  });
  if (request.method === 'HEAD') {
    await handle.close();
    response.end();
    return;
  }
  // The stream owns the handle from here and closes it when it ends or is destroyed.
  const source = handle.createReadStream(opened.size ? { start: 0, end: opened.size - 1 } : {});
  void sendBody(source, response, coding);
}
