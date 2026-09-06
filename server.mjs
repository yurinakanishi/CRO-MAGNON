import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { WORLD, CAMP, NPC, INITIAL_RESOURCES } from './shared/world.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const COLORS = ['#e4ac65', '#87b899', '#b49cd2', '#76a7c3', '#ce8c8b'];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.glb': 'model/gltf-binary',
};
const cleanText = (value, max) => typeof value === 'string'
  ? Array.from(value.replace(/[\u0000-\u001f\u007f]/g, '').trim()).slice(0, max).join('') : '';
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const clamp = (number, min, max) => Math.max(min, Math.min(max, number));
const send = (socket, payload) => {
  if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < 512 * 1024) {
    socket.send(JSON.stringify(payload));
  }
};

export function createGameServer({
  port = Number(process.env.PORT) || 3000,
  host = process.env.HOST || '0.0.0.0',
  tickMs = 50,
} = {}) {
  const rooms = new Map();
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
      if (url.pathname === '/api/health' || url.pathname === '/api/network') {
        const activePort = server.address()?.port || port;
        const body = url.pathname === '/api/health'
          ? { ok: true, rooms: rooms.size, players: [...rooms.values()].reduce((sum, room) => sum + room.players.size, 0), maxPlayers: WORLD.maxPlayers }
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
      response.writeHead(200, { 'Content-Type': MIME[path.extname(filename)], 'Content-Length': info.size, 'Cache-Control': 'no-cache' });
      if (request.method === 'HEAD') response.end();
      else createReadStream(filename).on('error', () => response.destroy()).pipe(response);
    } catch (error) {
      response.writeHead(error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 404 : 400).end('Not found');
    }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2048, perMessageDeflate: false });

  function broadcast(room, payload) {
    for (const player of room.players.values()) send(player.socket, payload);
  }

  function snapshot(room) {
    const now = Date.now();
    return {
      type: 'state', room: room.name, serverTime: now,
      players: [...room.players.values()].map(({ id, name, species, x, z, color, inventory, tool, ready, energy, facing, moving }) =>
        ({ id, name, species, x, z, color, inventory: { ...inventory }, tool, ready, energy, facing, moving })),
      resources: room.resources.map(({ regeneratedAt, ...resource }) => ({ ...resource })),
      camp: { ...room.camp }, npc: { ...NPC },
      day: 1 + Math.floor((now - room.createdAt) / 240000),
      dayProgress: ((now - room.createdAt) % 240000) / 240000,
      completed: room.camp.level >= 1,
    };
  }

  function systemChat(room, text) {
    broadcast(room, { type: 'chat', id: randomUUID(), name: '谷の声', text, system: true, at: Date.now() });
  }

  function notice(player, text, tone = 'info') {
    send(player.socket, { type: 'notice', text, tone });
  }

  function act(room, player, action) {
    if (action === 'gather') {
      const nearest = room.resources.filter((resource) => resource.amount > 0 && distance(resource, player) <= 8)
        .sort((a, b) => distance(a, player) - distance(b, player))[0];
      if (!nearest) return notice(player, '資源に近づいてから採集しよう。', 'error');
      const amount = Math.min(nearest.amount, player.tool && nearest.type !== 'berry' ? 2 : 1);
      if (player.inventory[nearest.type] >= 99) return notice(player, '持ち物がいっぱいです。焚き火に届けよう。', 'error');
      const collected = Math.min(amount, 99 - player.inventory[nearest.type]);
      nearest.amount -= collected;
      nearest.regeneratedAt = Date.now();
      player.inventory[nearest.type] += collected;
      player.energy = Math.max(0, player.energy - 3);
      const label = { wood: '木材', stone: '石', berry: 'ベリー' }[nearest.type];
      notice(player, `${label} +${collected}`, 'success');
    } else if (action === 'contribute') {
      if (distance(player, room.camp) > 10) return notice(player, '焚き火に近づいてから届けよう。', 'error');
      const { wood, stone } = player.inventory;
      if (!wood && !stone) return notice(player, '木材や石を集めて持ってこよう。', 'error');
      room.camp.wood += wood;
      room.camp.stone += stone;
      player.inventory.wood = 0;
      player.inventory.stone = 0;
      notice(player, `焚き火に木材 ${wood}・石 ${stone} を届けた。`, 'success');
      systemChat(room, `${player.name} が木材 ${wood}・石 ${stone} を届けた。`);
      if (!room.camp.level && room.camp.wood >= room.camp.goalWood && room.camp.stone >= room.camp.goalStone) {
        room.camp.level = 1;
        for (const member of room.players.values()) member.ready = true;
        systemChat(room, '焚き火が完成！ みんなの力で、最初の夜を迎える準備ができた。');
      }
    } else if (action === 'craft') {
      if (player.tool) return notice(player, 'すでに石斧を持っています。');
      if (player.inventory.wood < 3 || player.inventory.stone < 2) return notice(player, '石斧には木材 3・石 2 が必要です。', 'error');
      player.inventory.wood -= 3;
      player.inventory.stone -= 2;
      player.tool = true;
      notice(player, '石斧ができた！ 木材と石を一度に2つ採集できます。', 'success');
    } else if (action === 'trade') {
      if (distance(player, NPC) > 10) return notice(player, 'オルに近づいて話しかけよう。', 'error');
      const material = player.inventory.wood >= 2 ? 'wood' : player.inventory.stone >= 2 ? 'stone' : null;
      if (!material) return notice(player, 'オル「木か石を2つ、ベリー3つと交換しよう」');
      if (player.inventory.berry > 96) return notice(player, 'ベリーを食べてから交換しよう。', 'error');
      player.inventory[material] -= 2;
      player.inventory.berry += 3;
      notice(player, `オルと${material === 'wood' ? '木材' : '石'}2つを交換した。ベリー +3`, 'success');
    } else if (action === 'eat') {
      if (!player.inventory.berry) return notice(player, 'ベリーを持っていません。', 'error');
      if (player.energy >= 100) return notice(player, '元気いっぱいです。');
      player.inventory.berry -= 1;
      player.energy = Math.min(100, player.energy + 25);
      notice(player, 'ベリーを食べた。元気 +25', 'success');
    } else if (action === 'wave') {
      broadcast(room, { type: 'emote', id: player.id, emote: 'wave', at: Date.now() });
      systemChat(room, `${player.name} が手を振った。`);
    } else return;
    broadcast(room, snapshot(room));
  }

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

  wss.on('connection', (socket, request) => {
    const params = new URL(request.url, 'http://localhost').searchParams;
    const roomName = cleanText(params.get('room'), 20).toUpperCase().replace(/[^A-Z0-9_-]/g, '') || 'EMBER';
    let room = rooms.get(roomName);
    if (!room) {
      room = { name: roomName, createdAt: Date.now(), players: new Map(), resources: INITIAL_RESOURCES.map((resource) => ({ ...resource, regeneratedAt: Date.now() })), camp: { ...CAMP }, lastBroadcast: 0 };
      rooms.set(roomName, room);
    }
    if (room.players.size >= WORLD.maxPlayers) {
      send(socket, { type: 'error', code: 'ROOM_FULL', text: 'この谷は5人でいっぱいです。別の部屋の名前で参加してください。' });
      socket.close(4001, 'Room full');
      return;
    }
    const usedColors = new Set([...room.players.values()].map((player) => player.color));
    const player = {
      id: randomUUID(), name: cleanText(params.get('name'), 16) || '旅人',
      species: params.get('species') === 'nea' ? 'nea' : 'cro',
      x: 48 + room.players.size * 1.1, z: 57 + (room.players.size % 2),
      color: COLORS.find((color) => !usedColors.has(color)) || COLORS[0],
      inventory: { wood: 0, stone: 0, berry: 0 }, tool: false,
      ready: room.camp.level > 0, energy: 100, facing: 0, moving: false,
      dx: 0, dz: 0, target: null, lastInput: 0, lastAction: 0, lastChat: 0,
      tokens: 70, refillAt: Date.now(), alive: true, socket,
    };
    room.players.set(player.id, player);
    send(socket, { type: 'welcome', id: player.id, room: roomName });
    broadcast(room, snapshot(room));
    systemChat(room, `${player.name} が谷にやってきた。`);
    socket.on('pong', () => { player.alive = true; });
    socket.on('error', () => {});
    socket.on('message', (data, isBinary) => {
      if (isBinary) return;
      const now = Date.now();
      player.tokens = Math.min(70, player.tokens + (now - player.refillAt) * 0.035);
      player.refillAt = now;
      if (player.tokens < 1) return;
      player.tokens -= 1;
      let message;
      try { message = JSON.parse(data.toString()); } catch { return; }
      if (!message || typeof message !== 'object' || Array.isArray(message)) return;
      if (message.type === 'move' && Number.isFinite(message.dx) && Number.isFinite(message.dz)) {
        const dx = clamp(message.dx, -1, 1);
        const dz = clamp(message.dz, -1, 1);
        const length = Math.max(1, Math.hypot(dx, dz));
        player.dx = dx / length;
        player.dz = dz / length;
        player.lastInput = now;
        player.target = null;
      } else if (message.type === 'target' && Number.isFinite(message.x) && Number.isFinite(message.z)) {
        player.target = { x: clamp(message.x, 2, WORLD.size - 2), z: clamp(message.z, 2, WORLD.size - 2) };
        player.dx = 0;
        player.dz = 0;
      } else if (message.type === 'action' && typeof message.action === 'string' && now - player.lastAction >= 450) {
        player.lastAction = now;
        act(room, player, message.action);
      } else if (message.type === 'chat' && now - player.lastChat >= 600) {
        const chatText = cleanText(message.text, 180);
        if (!chatText) return;
        player.lastChat = now;
        broadcast(room, { type: 'chat', id: randomUUID(), name: player.name, text: chatText, at: now });
      } else if (message.type === 'ping' && (typeof message.at === 'number' || typeof message.at === 'string')) {
        send(socket, { type: 'pong', at: typeof message.at === 'string' ? message.at.slice(0, 40) : message.at });
      }
    });
    socket.on('close', () => {
      room.players.delete(player.id);
      if (room.players.size === 0) rooms.delete(roomName);
      else {
        systemChat(room, `${player.name} が谷をあとにした。`);
        broadcast(room, snapshot(room));
      }
    });
  });

  let previousTick = Date.now();
  let lastHeartbeat = Date.now();
  function tick() {
    const now = Date.now();
    const dt = Math.min((now - previousTick) / 1000, 0.15);
    previousTick = now;
    const heartbeat = now - lastHeartbeat > 15000;
    if (heartbeat) lastHeartbeat = now;
    for (const room of rooms.values()) {
      for (const player of room.players.values()) {
        let dx = 0;
        let dz = 0;
        if (player.target) {
          const range = distance(player, player.target);
          if (range <= WORLD.speed * dt) {
            player.x = player.target.x;
            player.z = player.target.z;
            player.target = null;
          } else {
            dx = (player.target.x - player.x) / range;
            dz = (player.target.z - player.z) / range;
          }
        } else if (now - player.lastInput < 500) {
          dx = player.dx;
          dz = player.dz;
        }
        player.moving = Math.abs(dx) + Math.abs(dz) > 0.001;
        if (player.moving) {
          player.facing = Math.atan2(dx, dz);
          player.x = clamp(player.x + dx * WORLD.speed * dt, 2, WORLD.size - 2);
          player.z = clamp(player.z + dz * WORLD.speed * dt, 2, WORLD.size - 2);
        }
        if (heartbeat) {
          if (!player.alive) { player.socket.terminate(); continue; }
          player.alive = false;
          player.socket.ping();
        }
      }
      for (const resource of room.resources) {
        if (resource.amount < resource.maxAmount && now - resource.regeneratedAt >= 20000) {
          resource.amount += 1;
          resource.regeneratedAt = now;
        }
      }
      if (now - room.lastBroadcast >= 90) {
        broadcast(room, snapshot(room));
        room.lastBroadcast = now;
      }
    }
  }

  return {
    server, wss, rooms,
    address: () => server.address(),
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          previousTick = Date.now();
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
      rooms.clear();
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
