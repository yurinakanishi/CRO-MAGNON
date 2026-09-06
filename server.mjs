import { normalizeCharacter, characterModel } from './shared/characters.mjs';
import { attackProfile } from './shared/combat-profiles.mjs';
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { WORLD, worldClamp, CAMP, NPC, INITIAL_RESOURCES } from './shared/world.mjs';
import { movePlayer } from './shared/movement.mjs';
import { planNavigation, updateNavigation } from './shared/navigation.mjs';
import { CollisionWorld, overlap } from './shared/collision.mjs';
import { createAnimals, updateAnimals, actorObstacle } from './shared/animals.mjs';
import { animalIsSolid, handleHuntingAction, updateHunting } from './shared/hunting.mjs';
import { enemyIsSolid } from './shared/combat.mjs';
import { createEnemies, updateEnemies } from './shared/enemies.mjs';
import { SCENERY } from './shared/scenery-layout.mjs';

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
          ? { ok: true, combatVersion: 3, characterVersion: 2, enemyVersion: 1, worldVersion: WORLD.version, worldSize: WORLD.size, rooms: rooms.size, players: [...rooms.values()].reduce((sum, room) => sum + room.players.size, 0), maxPlayers: WORLD.maxPlayers }
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

  function broadcast(room, payload) {
    const encoded = JSON.stringify(payload);
    for (const player of room.players.values()) if(player.socket.readyState === WebSocket.OPEN && player.socket.bufferedAmount < 512 * 1024) player.socket.send(encoded);
  }

  function snapshot(room, includeWorld = false) {
    const now = Date.now();
    return {
      type: 'state', combatVersion: 3, characterVersion: 2, enemyVersion: 1, worldVersion: WORLD.version, room: room.name, serverTime: now,
      projectiles: (room.projectiles || []).map(({id,ownerId,x,z,dx,dz,createdAt,updatedAt,travelled,kind})=>({id,ownerId,x,z,dx,dz,createdAt,updatedAt,travelled,kind})),
      projectileImpacts: (room.projectileImpacts || []).map(effect=>({...effect})),
      animals: room.animals.map(({id,x,z,facing,speed,scale,radius,clip,phase,health,maxHealth,meatRemaining,phaseStartedAt})=>({id,x,z,facing,speed,scale,radius,clip,phase,health,maxHealth,meatRemaining,phaseStartedAt})),
      enemies: (room.enemies || []).map(({id,modelKey,name,hostile,x,z,scale,facing,speed,radius,clip,phase,health,maxHealth,phaseStartedAt,behavior,targetId,attackSequence,attackAt,hitSequence,hitAt})=>({id,modelKey,name,hostile,x,z,scale,facing,speed,radius,clip,phase,health,maxHealth,phaseStartedAt,behavior,targetId,attackSequence,attackAt,hitSequence,hitAt})),
      players: [...room.players.values()].map(({ id, name, species, gender, x, z, radius, color, inventory, tool, ready, energy, facing, moving, running, speed, attackSequence, attackAt, cookingEndsAt, hurtSequence, hurtAt, defeatSequence, downedUntil, invulnerableUntil }) =>
        ({ id, name, species, gender, x, z, radius, color, inventory: { ...inventory }, tool, ready, energy, facing, moving, running, speed, attackSequence, attackAt, cookingEndsAt, hurtSequence, hurtAt, defeatSequence, downedUntil, invulnerableUntil })),
      ...(includeWorld ? {resources: room.resources.map(({ regeneratedAt, ...resource }) => ({ ...resource })), camp: { ...room.camp }, cookingFires:room.cookingFires, npc: { ...NPC }} : {}),
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

  function act(room, player, message, now) {
    const action = message.action;
    const hunting = handleHuntingAction(room, player, message, now);
    if (hunting) {
      notice(player, hunting.text, hunting.tone);
      if (hunting.changed) broadcast(room, snapshot(room));
      return;
    }
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
    broadcast(room, snapshot(room, true));
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
      room = { name: roomName, createdAt: Date.now(), players: new Map(), enemies: [], resources: INITIAL_RESOURCES.map((resource) => ({ ...resource, regeneratedAt: Date.now() })), camp: { ...CAMP }, lastBroadcast: 0 };
      room.cookingFires=SCENERY.fires.map(({id,x,z})=>({id:id??`fire-${x}-${z}`,x,z}));
      room.resourceById=new Map(room.resources.map(r=>[r.id,r]));
      room.collision=new CollisionWorld(undefined,{active:o=>!o.resourceId||room.resourceById.get(o.resourceId).amount>0});
      room.resourceObstacles=new Map(room.collision.obstacles.filter(o=>o.resourceId).map(o=>[o.resourceId,o]));
      room.animals=createAnimals(room.collision);
      room.enemies=createEnemies(room.collision,room.animals);
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
      ...normalizeCharacter({ species: params.get('species'), gender: params.get('gender') }),
      x: 48 + room.players.size * 1.1, z: 57 + (room.players.size % 2),
      color: COLORS.find((color) => !usedColors.has(color)) || COLORS[0],
      inventory: { wood: 0, stone: 0, berry: 0, rawMeat: 0, cookedMeat: 0 }, tool: false,
      attackSequence: 0, attackAt: 0, pendingStrike: null, cookingEndsAt: 0,
      hurtSequence: 0, hurtAt: 0, defeatSequence: 0, downedUntil: 0, invulnerableUntil: 0,
      ready: room.camp.level > 0, energy: 100, facing: 0, moving: false, running: false, runningRequested: false, speed: 0,
      radius: WORLD.playerRadius, path: [], lastTarget: 0, dx: 0, dz: 0, target: null, lastInput: 0, lastAction: 0, lastChat: 0,
      tokens: 70, refillAt: Date.now(), alive: true, socket,
    };
    player.radius=characterModel(player).radius ?? WORLD.playerRadius;
    const spawn=room.collision.nearestFree(player,player.radius,[...room.players.values(),...room.animals.filter(animalIsSolid),...room.enemies.filter(enemyIsSolid)].map(actorObstacle));
    if(!spawn){send(socket,{type:'error',code:'NO_SPAWN',text:'安全な参加地点がありません。'});socket.close();return;}
    Object.assign(player,spawn);room.players.set(player.id, player);
    send(socket, { type: 'welcome', combatVersion: 3, characterVersion: 2, worldVersion: WORLD.version, id: player.id, room: roomName });
    broadcast(room, snapshot(room, true));
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
      if (player.downedUntil && ['move','gait','target','action'].includes(message.type)) {
        if (message.type === 'action') notice(player, '回復を待っています。間もなく焚き火へ戻ります。', 'info');
        return;
      }
      if (message.type === 'move' && Number.isFinite(message.dx) && Number.isFinite(message.dz)) {
        const dx = clamp(message.dx, -1, 1);
        const dz = clamp(message.dz, -1, 1);
        const length = Math.max(1, Math.hypot(dx, dz));
        player.dx = dx / length;
        player.dz = dz / length;
        player.lastInput = now;
        player.runningRequested = message.running === true;
        player.target = null;player.path=[];player.navigationGoal=null;player.navigationEnd=null;
      } else if (message.type === 'gait' && typeof message.running === 'boolean') {
        player.runningRequested = message.running;
      } else if (message.type === 'target' && Number.isFinite(message.x) && Number.isFinite(message.z) && now-player.lastTarget>=180) {
        player.lastTarget=now;
        player.runningRequested = message.running === true;
        const goal={ x: worldClamp(message.x,'x'), z: worldClamp(message.z,'z') };
        const dynamic=[...room.players.values()].filter(p=>p!==player).concat(room.animals.filter(animalIsSolid),room.enemies.filter(enemyIsSolid)).map(actorObstacle);
        if(!planNavigation(player,goal,room.collision,dynamic,now))notice(player,'進路がふさがれています。空いたら移動します。');
        player.dx = 0;
        player.dz = 0;
      } else if (message.type === 'action' && typeof message.action === 'string' && (message.action === 'attack' || message.action === 'cancelCook' || now - player.lastAction >= 450)) {
        player.lastAction = now;
        act(room, player, message, now);
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
      player.pendingStrike = null;
      room.projectiles=(room.projectiles || []).filter(projectile=>projectile.ownerId!==player.id);
      room.players.delete(player.id);
      if (room.players.size === 0) rooms.delete(roomName);
      else {
        systemChat(room, `${player.name} が谷をあとにした。`);
        broadcast(room, snapshot(room, true));
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
        if(!player.target)player.target=player.path.shift()||null;
        const dynamic=[...room.players.values()].filter(p=>p!==player).concat(room.animals.filter(animalIsSolid),room.enemies.filter(enemyIsSolid)).map(actorObstacle);
        if (player.downedUntil || (player.attackSequence && now - player.attackAt < attackProfile(player).durationMs)) {
          player.speed=0;player.moving=false;player.running=false;
        } else {
          updateNavigation(player,room.collision,dynamic,now);
          movePlayer(player,dt,now,(p,dx,dz)=>room.collision.move(p,dx,dz,player.radius,dynamic));
        }
        if (heartbeat) {
          if (!player.alive) { player.socket.terminate(); continue; }
          player.alive = false;
          player.socket.ping();
        }
      }
      const huntingChanged=updateHunting(room,now,notice);
      updateAnimals(room,dt,now);
      const enemiesChanged=updateEnemies(room,dt,now,notice);
      let resourcesChanged=false;
      for (const resource of room.resources) {
        if (resource.amount < resource.maxAmount && now - resource.regeneratedAt >= 20000) {
          const obstacle=room.resourceObstacles.get(resource.id);
          if(resource.amount===0&&obstacle&&[...room.players.values(),...room.animals.filter(animalIsSolid),...room.enemies.filter(enemyIsSolid)].some(actor=>overlap(actor,actor.radius,obstacle)))continue;
          resourcesChanged=true;resource.amount += 1;
          resource.regeneratedAt = now;
        }
      }
      if (now - room.lastBroadcast >= 90 || resourcesChanged || huntingChanged || enemiesChanged) {
        broadcast(room, snapshot(room, resourcesChanged));
        room.lastBroadcast = now;
      }
    }
  }

  return {
    server, wss, rooms, snapshot,
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
