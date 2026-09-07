import { createGameCore } from './shared/game-core.mjs';
import { WORLD } from './shared/world.mjs';
import { RIDING } from './shared/riding.mjs';
import { BOATING } from './shared/boats.mjs';
import { EARTH } from './shared/paleo-geography.mjs';
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { WebSocketServer } from 'ws';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.glb': 'model/gltf-binary',
};
export function createGameServer({
  port = Number(process.env.PORT) || 3000,
  host = process.env.HOST || '0.0.0.0',
  tickMs = 50,
  resumeGraceMs = 120000,
} = {}) {
  const core = createGameCore({ resumeGraceMs });
  const { rooms, snapshot, tick } = core;
  let interval;
  let closing = false;
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed');
        return;
      }
      if (url.pathname === '/api/health' || url.pathname === '/api/network' || url.pathname === '/api/status') {
        const activePort = server.address()?.port || port;
        const body = url.pathname === '/api/status' ? {ok:true,boatingVersion:BOATING.version} : url.pathname === '/api/health'
          ? { ok: true, ridingVersion: RIDING.version, combatVersion: 3, characterVersion: 2, enemyVersion: 1, worldVersion: WORLD.version, worldSize: WORLD.size, worldWidth: WORLD.width, worldDepth: WORLD.depth, epochYearsBP: EARTH.epochYearsBP, rooms: rooms.size, players: [...rooms.values()].reduce((sum, room) => sum + room.players.size, 0), maxPlayers: WORLD.maxPlayers }
          : {
            port: activePort,
            localUrl: `http://localhost:${activePort}`,
            urls: [...new Set(Object.values(networkInterfaces()).flat().filter((item) => item && item.family === 'IPv4' && !item.internal).map((item) => `http://${item.address}:${activePort}`))],
          };
        response.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
        response.end(request.method === 'HEAD' ? undefined : JSON.stringify(body));
        return;
      }
      const pathname = decodeURIComponent(url.pathname);
      const mount = pathname.startsWith('/src/') ? 'src' : pathname.startsWith('/shared/') ? 'shared' : 'public';
      const base = path.join(ROOT, mount);
      const relative = mount === 'public' ? (pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')) : pathname.slice(mount.length + 2);
      const filename = path.resolve(base, relative);
      const allowed = path.relative(base, filename);
      if (pathname.includes('\\') || !allowed || allowed.startsWith('..') || path.isAbsolute(allowed) || allowed.split(path.sep).some((segment) => segment.startsWith('.')) || !MIME[path.extname(filename)]) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      const info = await stat(filename);
      if (!info.isFile()) {
        response.writeHead(404).end('Not found');
        return;
      }
      const etag=`W/"${info.size.toString(16)}-${info.mtimeMs.toString(16)}"`;
      if(request.headers['if-none-match']?.split(',').map(value=>value.trim()).includes(etag)) {
        response.writeHead(304,{'ETag':etag,'Cache-Control':'no-cache'}).end();return;
      }
      response.writeHead(200, { 'Content-Type': MIME[path.extname(filename)], 'Content-Length': info.size, 'Cache-Control': 'no-cache', 'ETag':etag });
      if (request.method === 'HEAD') response.end();
      else createReadStream(filename).on('error', () => response.destroy()).pipe(response);
    } catch (error) {
      response.writeHead(error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 404 : 400).end('Not found');
    }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2048, perMessageDeflate: false });

  server.on('upgrade', (request, socket, head) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname !== '/ws' || closing) {
        socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (connection) => wss.emit('connection', connection, request));
    } catch {
      socket.destroy();
    }
  });

  wss.on('connection', (socket, request) => core.connect(socket, new URL(request.url, 'http://localhost').searchParams));

  return {
    server, wss, rooms, snapshot,
    address: () => server.address(),
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          interval = setInterval(tick, tickMs);
          resolve(server.address());
        });
      });
    },
    async close() {
      closing = true;
      clearInterval(interval);
      for (const client of wss.clients) client.terminate();
      await new Promise((resolve) => wss.close(resolve));
      await new Promise((resolve) => server.close(resolve));
      core.close();
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const game = createGameServer();
  game.listen().then(({ port }) => {
    console.log(`CRO-MAGNON running at http://localhost:${port}`);
    const shutdown = () => game.close().then(() => process.exit(0));
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  }).catch((error) => {
    console.error('Could not start CRO-MAGNON:', error.message);
    process.exitCode = 1;
  });
}
