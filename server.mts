import http from 'node:http';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { createGameCore } from './application/game-core.mjs';
import { MIME, serveStatic } from './infrastructure/node/static-files.mjs';
import { ADVENTURE_VERSION } from './shared/adventure-regions.mjs';
import { BOATING } from './shared/boats.mjs';
import { EARTH } from './shared/paleo-geography.mjs';
import { RIDING } from './shared/riding.mjs';
import { WORLD } from './shared/world.mjs';
import { GULF } from './shared/gulf-region.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function createGameServer({
  port = Number(process.env.PORT) || 3000,
  host = process.env.HOST || '0.0.0.0',
  tickMs = 50,
  resumeGraceMs = 120000,
  core = createGameCore({ resumeGraceMs }),
} = {}) {
  const { rooms, snapshot, tick } = core;
  let interval;
  let closing = false;
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed');
        return;
      }
      if (
        url.pathname === '/api/health' ||
        url.pathname === '/api/network' ||
        url.pathname === '/api/status'
      ) {
        const activePort =
          (server.address() as import('node:net').AddressInfo | null)?.port || port;
        const body =
          url.pathname === '/api/status'
            ? {
                ok: true,
                boatingVersion: BOATING.version,
                adventureVersion: ADVENTURE_VERSION,
                gulfVersion: GULF.version,
              }
            : url.pathname === '/api/health'
              ? {
                  ok: true,
                  ridingVersion: RIDING.version,
                  combatVersion: 3,
                  characterVersion: 2,
                  enemyVersion: 1,
                  worldVersion: WORLD.version,
                  worldSize: WORLD.size,
                  worldWidth: WORLD.width,
                  worldDepth: WORLD.depth,
                  epochYearsBP: EARTH.epochYearsBP,
                  rooms: rooms.size,
                  players: [...rooms.values()].reduce((sum, room) => sum + room.players.size, 0),
                  maxPlayers: core.playerLimit,
                }
              : {
                  port: activePort,
                  localUrl: `http://localhost:${activePort}`,
                  urls: [
                    ...new Set(
                      Object.values(networkInterfaces())
                        .flat()
                        .filter((item) => item && item.family === 'IPv4' && !item.internal)
                        .map((item) => `http://${item.address}:${activePort}`),
                    ),
                  ],
                };
        response.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
        response.end(request.method === 'HEAD' ? undefined : JSON.stringify(body));
        return;
      }
      await serveStatic(request, response, url.pathname, ROOT);
    } catch (error) {
      response
        .writeHead(error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 404 : 400)
        .end('Not found');
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
      wss.handleUpgrade(request, socket, head, (connection) =>
        wss.emit('connection', connection, request),
      );
    } catch {
      socket.destroy();
    }
  });

  wss.on('connection', (socket, request) =>
    core.connect(socket, new URL(request.url, 'http://localhost').searchParams),
  );

  return {
    server,
    wss,
    rooms,
    snapshot,
    address: () => server.address(),
    listen() {
      return new Promise<import('node:net').AddressInfo>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          interval = setInterval(tick, tickMs);
          resolve(server.address() as import('node:net').AddressInfo);
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

export function startServer() {
  const game = createGameServer();
  game
    .listen()
    .then(({ port }) => {
      console.log(`CRO-MAGNON running at http://localhost:${port}`);
      const shutdown = () => game.close().then(() => process.exit(0));
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
    })
    .catch((error) => {
      console.error('Could not start CRO-MAGNON:', error.message);
      process.exitCode = 1;
    });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer();
}
