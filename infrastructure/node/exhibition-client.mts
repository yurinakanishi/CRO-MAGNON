import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { MIME, serveStatic } from './static-files.mjs';

/** Assets are loopback-only. There is deliberately no WebSocket proxy here. */
export function createExhibitionClient({ root, port, config }) {
  const connectOrigin = new URL(config.serverUrl).origin;
  const server = http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader(
      'Content-Security-Policy',
      `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' blob: ${connectOrigin}; font-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`,
    );
    try {
      if (!['GET', 'HEAD'].includes(request.method || '')) {
        response.writeHead(405, { Allow: 'GET, HEAD' }).end();
        return;
      }
      const url = new URL(request.url || '/', 'http://localhost');
      if (url.pathname === '/multiplayer-config.json' || url.pathname === '/api/status') {
        response.writeHead(200, { 'Content-Type': MIME['.json'] });
        response.end(
          request.method === 'HEAD'
            ? undefined
            : JSON.stringify(
                url.pathname === '/api/status'
                  ? { ok: true, mode: config.mode, buildId: config.buildId }
                  : config,
              ),
        );
        return;
      }
      await serveStatic(request, response, url.pathname, root);
    } catch (error) {
      response
        .writeHead(error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 404 : 400)
        .end('Not found');
    }
  });
  return {
    server,
    listen: () =>
      new Promise<AddressInfo>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          server.off('error', reject);
          resolve(server.address() as AddressInfo);
        });
      }),
    close: () =>
      new Promise<void>((resolve, reject) => {
        if (!server.listening) {
          resolve();
          return;
        }
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeIdleConnections();
      }),
  };
}
