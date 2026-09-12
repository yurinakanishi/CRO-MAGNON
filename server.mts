import http from 'node:http';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, realpath } from 'node:fs/promises';
import { WebSocketServer } from 'ws';
import { createGameCore } from './application/game-core.mjs';
import { MIME, serveStatic } from './infrastructure/node/static-files.mjs';
import { handleRoomReset, localResetRequest } from './infrastructure/node/room-reset.mjs';
import { ADVENTURE_VERSION } from './shared/adventure-regions.mjs';
import { BOATING } from './shared/boats.mjs';
import { EARTH } from './shared/paleo-geography.mjs';
import { RIDING } from './shared/riding.mjs';
import { WORLD } from './shared/world.mjs';
import { GULF } from './shared/gulf-region.mjs';
import {
  openLocalSave,
  UnsupportedSaveError,
  type SaveStatus,
} from './infrastructure/node/local-save.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function createGameServer({
  port = Number(process.env.PORT) || 3000,
  host = process.env.HOST || '0.0.0.0',
  tickMs = 50,
  resumeGraceMs = 120000,
  exhibition = process.env.EXHIBITION_RULES === '1',
  core = createGameCore({ resumeGraceMs, exhibition }),
  serveAssets = true,
  expectedBuild = '',
  allowedOrigins = [] as string[],
  wsPaths = ['/ws'],
  saveStatus = null as null | (() => SaveStatus),
  onSessionChange = () => {},
  beforeClose = async () => {},
  resetRoom = null as null | ((room: string, session: string) => Promise<void>),
} = {}) {
  const { rooms, snapshot, tick } = core;
  let interval;
  let closing = false;
  let closePromise: Promise<void> | undefined;
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      if (url.pathname === '/api/reset-room') {
        await handleRoomReset(request, response, resetRoom);
        return;
      }
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
                localRoomReset: !!resetRoom && localResetRequest(request),
                ...(saveStatus ? { save: saveStatus() } : {}),
              }
            : url.pathname === '/api/health'
              ? {
                  ok: true,
                  ...(expectedBuild ? { mode: 'lan', buildId: expectedBuild } : {}),
                  ...(exhibition ? { exhibition: true } : {}),
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
                  ...(saveStatus ? { save: saveStatus() } : {}),
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
      if (serveAssets) await serveStatic(request, response, url.pathname, ROOT);
      else response.writeHead(404).end('Multiplayer synchronization only. Use your local client.');
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
      if (!wsPaths.includes(url.pathname) || closing) {
        socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      if (allowedOrigins.length && !allowedOrigins.includes(request.headers.origin || '')) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
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

  wss.on('connection', (socket, request) => {
    const params = new URL(request.url, 'http://localhost').searchParams;
    if (expectedBuild && params.get('build') !== expectedBuild) {
      socket.send(
        JSON.stringify({
          type: 'error',
          code: 'BUILD_MISMATCH',
          text: '展示ビルドが一致しません。両PCへ同じ展示フォルダーをコピーしてください。',
        }),
      );
      socket.close(4009, 'Build mismatch');
      return;
    }
    core.connect(socket, params);
    if (saveStatus && socket.readyState === 1)
      socket.send(JSON.stringify({ type: 'saveStatus', ...saveStatus() }));
    onSessionChange();
    socket.on('close', () => {
      if (!closing) onSessionChange();
    });
  });

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
    close() {
      return (closePromise ??= (async () => {
        closing = true;
        clearInterval(interval);
        core.pause();
        try {
          await beforeClose();
        } finally {
          for (const client of wss.clients) client.terminate();
          await new Promise((resolve) => wss.close(resolve));
          if (server.listening) {
            const closed = new Promise((resolve) => server.close(resolve));
            // The world is already saved; an in-flight download (a large GLB) or a keep-alive
            // socket must not hold the port open until the dev watcher's 10 s kill deadline.
            server.closeAllConnections();
            await closed;
          }
          core.close();
        }
      })());
    },
  };
}

/** Opt-in for other hosts; the normal executable uses this factory by default. */
export async function createPersistentGameServer({
  saveDirectory = path.join(ROOT, '.cro-magnon-save'),
  saveIntervalMs = 10000,
  enableRoomReset,
  onSaveError = (error: Error) =>
    console.error('Local save failed; previous save retained:', error.message),
  ...options
}: Omit<
  Parameters<typeof createGameServer>[0],
  'core' | 'saveStatus' | 'beforeClose' | 'onSessionChange' | 'resetRoom'
> & {
  saveDirectory?: string;
  saveIntervalMs?: number;
  enableRoomReset?: boolean;
  onSaveError?: (error: Error) => void;
} = {}) {
  if (!Number.isFinite(saveIntervalMs) || saveIntervalMs < 20)
    throw new Error('Invalid save interval');
  // The save contains private resume credentials. Never put it under a served directory.
  await mkdir(saveDirectory, { recursive: true, mode: 0o700 });
  const canonical = await realpath(saveDirectory);
  for (const base of ['public', 'dist']) {
    const served = await realpath(path.join(ROOT, base));
    const relative = path.relative(served, canonical);
    if (
      !relative ||
      (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
    )
      throw new Error('Save directory must be outside public and dist');
  }
  const makeCore = () => createGameCore({ persistentSessions: true, keepEmptyRooms: true });
  let core = makeCore();
  const store = await openLocalSave(canonical, (state: any) => {
    if (
      state &&
      ((Number.isFinite(state.version) && state.version !== 1) ||
        (Number.isFinite(state.worldVersion) && ![3, WORLD.version].includes(state.worldVersion)) ||
        state.rooms?.some?.((room) => room.gulf?.version > GULF.version))
    )
      throw new UnsupportedSaveError('Unsupported saved world version; original files retained');
    if (
      !state ||
      state.version !== 1 ||
      !Array.isArray(state.rooms) ||
      !Number.isFinite(state.savedAt)
    )
      throw new Error('Invalid saved world');
    const names = new Set();
    for (const room of state.rooms) {
      if (
        !room ||
        typeof room.name !== 'string' ||
        !room.name ||
        names.has(room.name) ||
        !Number.isFinite(room.createdAt) ||
        !room.camp ||
        !Array.isArray(room.resources) ||
        !Array.isArray(room.animals) ||
        !Array.isArray(room.enemies) ||
        !Array.isArray(room.sessions)
      )
        throw new Error('Invalid saved room');
      names.add(room.name);
      const tokens = new Set(),
        ids = new Set();
      for (const entry of room.sessions) {
        if (
          !entry ||
          typeof entry.token !== 'string' ||
          !entry.token ||
          tokens.has(entry.token) ||
          !Number.isFinite(entry.expiresAt) ||
          !entry.player?.id ||
          ids.has(entry.player.id) ||
          !Number.isFinite(entry.player.x) ||
          !Number.isFinite(entry.player.z) ||
          !entry.player.inventory
        )
          throw new Error('Invalid saved player');
        tokens.add(entry.token);
        ids.add(entry.player.id);
      }
    }
    const candidate = makeCore();
    try {
      candidate.importState(state);
    } catch (error) {
      candidate.close();
      throw error;
    }
    core.close();
    core = candidate;
  });
  let timer: ReturnType<typeof setInterval> | undefined;
  let sessionTimer: ReturnType<typeof setTimeout> | undefined;
  let saving: Promise<void> | null = null,
    stopping = false,
    failedToListen = false;
  let resetting: Promise<void> | null = null;
  const resetEnabled =
    (enableRoomReset ?? (options.port ?? (Number(process.env.PORT) || 3000)) === 3000) &&
    !options.expectedBuild &&
    !options.exhibition &&
    process.env.EXHIBITION_RULES !== '1';
  function announce() {
    const message = JSON.stringify({ type: 'saveStatus', ...store.status() });
    for (const socket of game.wss.clients) if (socket.readyState === 1) socket.send(message);
  }
  function saveNow() {
    if (saving) return saving;
    saving = store
      .save(core.exportState())
      .then(announce)
      .catch((error) => {
        announce();
        onSaveError(error);
        throw error;
      })
      .finally(() => {
        saving = null;
      });
    return saving;
  }
  const backgroundSave = () => {
    if (!stopping && !resetting) void saveNow().catch(() => {});
  };
  const game = createGameServer({
    ...options,
    core,
    saveStatus: store.status,
    resetRoom: resetEnabled
      ? async (roomName, session) => {
          const room = core.rooms.get(roomName);
          const active =
            room &&
            [...room.players.values()].some(
              (player) => player.sessionToken === session && player.socket.readyState === 1,
            );
          if (stopping || resetting || !active) throw new Error('Room reset unavailable');
          resetting = (async () => {
            await saving?.catch(() => {});
            await core.resetRoom(roomName, (checkpoint) => store.save(checkpoint));
            announce();
          })()
            .catch((error) => {
              announce();
              onSaveError(error);
              throw error;
            })
            .finally(() => {
              resetting = null;
            });
          await resetting;
        }
      : null,
    onSessionChange() {
      // Coalesce joins/leaves without delaying the regular checkpoint.
      if (!stopping && !sessionTimer)
        sessionTimer = setTimeout(() => {
          sessionTimer = undefined;
          backgroundSave();
        }, 100);
    },
    async beforeClose() {
      stopping = true;
      clearInterval(timer);
      clearTimeout(sessionTimer);
      try {
        if (failedToListen) return;
        await resetting?.catch(() => {});
        await saving?.catch(() => {});
        await saveNow();
      } finally {
        await store.close();
      }
    },
  });
  return {
    ...game,
    core,
    saveNow,
    saveStatus: store.status,
    async listen() {
      try {
        const address = await game.listen();
        timer = setInterval(backgroundSave, saveIntervalMs);
        if (store.status().recovered)
          console.warn('Recovered the previous local save from backup.');
        return address;
      } catch (error) {
        // Failed binding must not rewrite a save the user has not played.
        stopping = true;
        failedToListen = true;
        core.close();
        await store.close();
        throw error;
      }
    },
  };
}

export async function startServer() {
  try {
    const game = await createPersistentGameServer({
      saveDirectory: process.env.CRO_SAVE_DIR || undefined,
    });
    const { port } = await game.listen();
    console.log(`CRO-MAGNON running at http://localhost:${port} (local autosave every 10s)`);
    let shuttingDown = false;
    const shutdown = () => {
      if (shuttingDown) return;
      shuttingDown = true;
      void game.close().then(
        () => process.exit(0),
        (error) => {
          console.error('Final save failed:', error.message);
          process.exit(1);
        },
      );
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    // Parent-only IPC lets the Windows development watcher save before restarting.
    process.on('message', (message) => {
      if (message === 'cro-shutdown') shutdown();
    });
    if (process.connected) process.once('disconnect', shutdown);
  } catch (error) {
    console.error('Could not start CRO-MAGNON:', error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer();
}
