import { updateFishing, cancelFishing } from '../shared/fishing.mjs';
import { createHouseholds, householdSnapshots } from '../shared/household-life.mjs';
import {
  createResidents,
  updateResidents,
  ensureVillageProgress,
  residentSnapshots,
} from '../shared/village-life.mjs';
import { updateCoastal, cancelCoastal } from '../shared/coastal-craft.mjs';
import { activateMiddenObstacle } from '../shared/coastal-sites.mjs';
import { ensureAdventure, updateAdventures } from '../shared/adventures.mjs';
import { createGulfState, ensureGulfPlayer, updateGulf } from '../shared/gulf-life.mjs';
import { migrateGulfRecord } from '../shared/gulf-migration.mjs';
import { GULF, MANY_HEARTHS } from '../shared/gulf-region.mjs';
import { actorObstacle, createAnimals, updateAnimals } from '../shared/animals.mjs';
import {
  BOATING,
  boardedBoat,
  boatObstacles,
  initializeBoats,
  releaseBoat,
  updateBoats,
} from '../shared/boats.mjs';
import { characterModel, normalizeCharacter } from '../shared/characters.mjs';
import { CollisionWorld, overlap } from '../shared/collision.mjs';
import { attackProfile } from '../shared/combat-profiles.mjs';
import { handleBarterCommand, cancelBarter, updateBarters } from '../shared/barter.mjs';
import { enemyIsSolid, stopActor } from '../shared/combat.mjs';
import { createEnemies, updateEnemies } from '../shared/enemies.mjs';
import { takeExpedition } from '../shared/expeditions.mjs';
import { animalIsSolid, updateHunting } from '../shared/hunting.mjs';
import { movePlayer } from '../shared/movement.mjs';
import { planNavigation, updateNavigation } from '../shared/navigation.mjs';
import { isLand } from '../shared/paleo-geography.mjs';
import { RIDING, mountedAnimal, releaseRider, ridingObstacles } from '../shared/riding.mjs';
import { SCENERY } from '../shared/scenery-layout.mjs';
import { CAMP, INITIAL_RESOURCES, WORLD, worldClamp } from '../shared/world.mjs';
import { createActionHandler } from './actions.mjs';
import { defaultRuntime, type GameConnection, type Runtime } from './ports.mjs';
import { decodeCommand } from './protocol.mjs';
import { snapshot as createSnapshot } from './snapshot.mjs';
const COLORS = ['#e4ac65', '#87b899', '#b49cd2', '#76a7c3', '#ce8c8b'];
const cleanText = (value, max) =>
  typeof value === 'string'
    ? Array.from(value.replace(/[\u0000-\u001f\u007f]/g, '').trim())
        .slice(0, max)
        .join('')
    : '';
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const clamp = (number, min, max) => Math.max(min, Math.min(max, number));
const send = (socket, payload) => {
  if (socket.readyState === 1 && socket.bufferedAmount < 512 * 1024) {
    socket.send(JSON.stringify(payload));
  }
};

export function createGameCore({
  resumeGraceMs = 120000,
  keepEmptyRooms = false,
  maxSavedSessions = Infinity,
  playerLimit = WORLD.maxPlayers,
  runtime = defaultRuntime,
}: {
  resumeGraceMs?: number;
  keepEmptyRooms?: boolean;
  maxSavedSessions?: number;
  playerLimit?: number;
  runtime?: Runtime;
} = {}) {
  if (!Number.isInteger(playerLimit) || playerLimit < 1 || playerLimit > 64)
    throw new Error('playerLimit must be an integer from 1 to 64');
  const rooms = new Map();
  let closing = false;
  function broadcast(room, payload) {
    const encoded = JSON.stringify(payload);
    let full;
    for (const player of room.players.values()) {
      if (player.socket.readyState !== 1) continue;
      if (player.socket.bufferedAmount >= 512 * 1024) {
        if (payload.type === 'state') player.needsWorld = true;
        continue;
      }
      if (payload.type === 'state' && player.needsWorld) {
        full ??= JSON.stringify(snapshot(room, true));
        player.socket.send(full);
        player.needsWorld = false;
      } else player.socket.send(encoded);
    }
  }

  function snapshot(room, includeWorld = false) {
    return createSnapshot(room, includeWorld, runtime.now());
  }

  function systemChat(room, text) {
    broadcast(room, {
      type: 'chat',
      id: runtime.id(),
      name: '谷の声',
      text,
      system: true,
      at: runtime.now(),
    });
  }

  function notice(player, text, tone = 'info', popup = tone !== 'success') {
    // Completed actions are visible in animations, meters, inventory and journals.
    // Keep their sound feedback; reserve popups for information the player needs to act on.
    send(player.socket, { type: 'notice', text, tone, popup });
  }

  const act = createActionHandler({ notice, broadcast, snapshot, systemChat, runtime });

  function ensureRoom(roomName) {
    let room = rooms.get(roomName);
    if (!room) {
      room = {
        name: roomName,
        playerLimit,
        createdAt: runtime.now(),
        players: new Map(),
        sessions: new Map(),
        enemies: [],
        resources: INITIAL_RESOURCES.map((resource) => ({
          ...resource,
          regeneratedAt: runtime.now(),
        })),
        camp: { ...CAMP },
        gulf: createGulfState(),
        barters: [],
        lastBroadcast: 0,
      };
      room.cookingFires = SCENERY.fires.map(({ id, x, z }) => ({
        id: id ?? `fire-${x}-${z}`,
        x,
        z,
      }));
      room.resourceById = new Map(room.resources.map((r) => [r.id, r]));
      room.collision = new CollisionWorld(undefined, {
        active: (o) =>
          o.middenId
            ? activateMiddenObstacle(o, room.gulf)
            : !o.resourceId || room.resourceById.get(o.resourceId).amount > 0,
      });
      initializeBoats(room);
      room.resourceObstacles = new Map(
        room.collision.obstacles.filter((o) => o.resourceId).map((o) => [o.resourceId, o]),
      );
      room.animals = createAnimals(room.collision);
      room.enemies = createEnemies(room.collision, room.animals);
      createResidents(room);
      rooms.set(roomName, room);
    }
    return room;
  }

  function connect(socket: GameConnection, params: URLSearchParams) {
    const roomName =
      cleanText(params.get('room'), 20)
        .toUpperCase()
        .replace(/[^A-Z0-9_-]/g, '') || 'EMBER';
    const room = ensureRoom(roomName);
    const now = runtime.now(),
      token = params.get('session'),
      resumable = params.get('resume') === '1';
    for (const [key, entry] of room.sessions) if (now >= entry.expiresAt) room.sessions.delete(key);
    const active =
      resumable && token ? [...room.players.values()].find((p) => p.sessionToken === token) : null;
    const saved = resumable && token ? room.sessions.get(token) : null;
    if (room.players.size >= playerLimit && !active) {
      send(socket, {
        type: 'error',
        code: 'ROOM_FULL',
        text: `この部屋は現在の上限${playerLimit}人に達しました。別の部屋の名前で参加してください。`,
      });
      socket.close(4001, 'Room full');
      return;
    }
    const usedColors = new Set([...room.players.values()].map((player) => player.color));
    const resumed = !!(active || saved);
    const player = active ||
      saved?.player || {
        id: runtime.id(),
        name: cleanText(params.get('name'), 16) || '旅人',
        ...normalizeCharacter({ species: params.get('species'), gender: params.get('gender') }),
        x: 48 + room.players.size * 1.1,
        z: 57 + (room.players.size % 2),
        color: COLORS.find((color) => !usedColors.has(color)) || COLORS[0],
        inventory: { wood: 0, stone: 0, berry: 0, rawMeat: 0, cookedMeat: 0 },
        gathered: 0,
        tool: false,
        mountId: null,
        boatId: null,
        attackSequence: 0,
        attackAt: 0,
        pendingStrike: null,
        cookingEndsAt: 0,
        hurtSequence: 0,
        hurtAt: 0,
        defeatSequence: 0,
        downedUntil: 0,
        invulnerableUntil: 0,
        ready: room.camp.level > 0,
        energy: 100,
        facing: 0,
        moving: false,
        running: false,
        runningRequested: false,
        speed: 0,
        radius: WORLD.playerRadius,
        path: [],
        lastTarget: 0,
        dx: 0,
        dz: 0,
        target: null,
        lastInput: 0,
        lastAction: 0,
        lastChat: 0,
        tokens: 70,
        refillAt: runtime.now(),
        alive: true,
        socket,
        sessionToken: resumable ? runtime.token() : null,
      };
    player.radius = characterModel(player).radius ?? WORLD.playerRadius;
    ensureAdventure(player);
    ensureGulfPlayer(player);
    ensureVillageProgress(player);
    if (active) cancelBarter(room, player.id, now, '接続が切り替わったので、交換を中止しました。');
    if (active?.boatId) releaseBoat(room, player);
    const dynamic = [...room.players.values()]
      .filter((p) => p !== player && !p.mountId)
      .concat(room.animals.filter(animalIsSolid), room.enemies.filter(enemyIsSolid), room.residents)
      .map(actorObstacle);
    const spawn =
      room.collision.nearestFree(player, player.radius, dynamic) ||
      (resumed &&
        room.collision.nearestFree(
          { x: room.camp.x - 1, z: room.camp.z + 3 },
          player.radius,
          dynamic,
        ));
    if (!spawn) {
      send(socket, { type: 'error', code: 'NO_SPAWN', text: '安全な参加地点がありません。' });
      socket.close();
      return;
    }
    if (active) {
      const oldSocket = player.socket;
      releaseRider(room, player);
      player.pendingStrike = null;
      player.cookingEndsAt = 0;
      cancelFishing(player);
      cancelCoastal(player);
      room.projectiles = (room.projectiles || []).filter(
        (projectile) => projectile.ownerId !== player.id,
      );
      player.socket = socket;
      send(oldSocket, {
        type: 'error',
        code: 'SESSION_REPLACED',
        text: '同じプレイヤーが別の画面で再接続しました。この画面からは参加し直せます。',
      });
      oldSocket.close(4004, 'Session replaced');
    }
    if (saved) room.sessions.delete(token);
    Object.assign(player, {
      socket,
      alive: true,
      tokens: 70,
      refillAt: now,
      lastInput: 0,
      lastTarget: 0,
      lastAction: 0,
      lastChat: 0,
      runningRequested: false,
      needsWorld: false,
      ready: room.camp.level > 0,
    });
    stopActor(player);
    Object.assign(player, spawn);
    room.players.set(player.id, player);
    send(socket, {
      type: 'welcome',
      ridingVersion: RIDING.version,
      combatVersion: 3,
      characterVersion: 2,
      worldVersion: WORLD.version,
      id: player.id,
      room: roomName,
      resumed,
      session: player.sessionToken,
      profile: { name: player.name, species: player.species, gender: player.gender },
    });
    broadcast(room, snapshot(room, true));
    systemChat(room, `${player.name} が谷に${resumed ? '戻ってきた' : 'やってきた'}。`);
    socket.on('pong', () => {
      if (player.socket === socket) player.alive = true;
    });
    socket.on('error', () => {});
    socket.on('message', (data, isBinary) => {
      if (isBinary || player.socket !== socket) return;
      const now = runtime.now();
      player.tokens = Math.min(70, player.tokens + (now - player.refillAt) * 0.035);
      player.refillAt = now;
      if (player.tokens < 1) return;
      player.tokens -= 1;
      const message = decodeCommand(data.toString());
      if (!message) return;
      if (message.type === 'leave') {
        player.sessionToken = null;
        socket.close(1000, 'Explicit leave');
        return;
      }
      if (message.type === 'barter') {
        if (message.kind !== 'cancel' && now - player.lastAction < 450) return;
        if (message.kind !== 'cancel') player.lastAction = now;
        const result = handleBarterCommand(room, player, message, now, runtime.id);
        if (result.text) notice(player, result.text, result.ok ? 'success' : 'info');
        if (result.changed) broadcast(room, snapshot(room));
        return;
      }
      const controlled = boardedBoat(room, player) || mountedAnimal(room, player) || player;
      if (player.downedUntil && ['move', 'gait', 'target', 'action'].includes(message.type)) {
        if (message.type === 'action')
          notice(player, '回復を待っています。間もなく焚き火へ戻ります。', 'info');
        return;
      }
      if (message.type === 'move' && Number.isFinite(message.dx) && Number.isFinite(message.dz)) {
        if (Math.hypot(message.dx, message.dz) > 0.01) {
          cancelBarter(room, player.id, now, '移動を始めたので、交換を中止しました。');
          cancelFishing(player);
          cancelCoastal(player);
        }
        const dx = clamp(message.dx, -1, 1);
        const dz = clamp(message.dz, -1, 1);
        const length = Math.max(1, Math.hypot(dx, dz));
        controlled.dx = dx / length;
        controlled.dz = dz / length;
        controlled.lastInput = now;
        controlled.runningRequested = message.running === true;
        controlled.target = null;
        controlled.path = [];
        controlled.navigationGoal = null;
        controlled.navigationEnd = null;
      } else if (message.type === 'gait' && typeof message.running === 'boolean') {
        controlled.runningRequested = message.running;
      } else if (
        message.type === 'target' &&
        Number.isFinite(message.x) &&
        Number.isFinite(message.z) &&
        now - player.lastTarget >= 180
      ) {
        cancelFishing(player);
        cancelCoastal(player);
        cancelBarter(room, player.id, now, '移動を始めたので、交換を中止しました。');
        player.lastTarget = now;
        controlled.runningRequested = message.running === true;
        const goal = { x: worldClamp(message.x, 'x'), z: worldClamp(message.z, 'z') };
        if (!player.boatId && !isLand(goal.x, goal.z)) {
          stopActor(controlled);
          notice(player, 'そこは海です。海岸で木材12個から船を作り、Bで乗って渡ろう。');
          return;
        }
        const dynamic = player.boatId
          ? boatObstacles(room, controlled)
          : ridingObstacles(room, controlled === player ? null : controlled, player);
        if (
          !planNavigation(
            controlled,
            goal,
            player.boatId ? room.seaCollision : room.collision,
            dynamic,
            now,
          )
        ) {
          if (player.boatId) {
            stopActor(controlled);
            notice(
              player,
              '船が通れる航路が見つかりません。近くの海面を選ぶか、WASDで操船しよう。',
            );
          } else if (player.mountId) {
            stopActor(controlled);
            notice(player, 'マンモスが通れる道が見つかりません。広い道を選ぶか、Rで降りて進もう。');
          } else {
            stopActor(controlled);
            notice(
              player,
              '歩ける経路が見つかりません。近くの陸地を選ぶか、世界地図から遠征しよう。',
            );
          }
        }
        controlled.dx = 0;
        controlled.dz = 0;
      } else if (message.type === 'expedition' && typeof message.destination === 'string') {
        cancelBarter(room, player.id, now, '遠征を始めたので、交換を中止しました。');
        cancelFishing(player);
        cancelCoastal(player);
        const result = takeExpedition(room, player, message.destination, now);
        notice(player, result.text, result.ok ? 'success' : 'info');
        if (result.ok) broadcast(room, snapshot(room, true));
      } else if (
        message.type === 'action' &&
        typeof message.action === 'string' &&
        (message.action === 'attack' ||
          message.action === 'cancelCook' ||
          message.action === 'cancelFishing' ||
          message.action === 'cancelCoastal' ||
          message.action === 'rift' ||
          now - player.lastAction >= 450)
      ) {
        if (!['cancelFishing', 'cancelCoastal', 'cancelCook', 'wave'].includes(message.action))
          cancelBarter(room, player.id, now, '別の作業を始めたので、交換を中止しました。');
        if (!['cancelFishing', 'cancelCoastal'].includes(message.action)) player.lastAction = now;
        act(room, player, message, now);
      } else if (message.type === 'chat' && now - player.lastChat >= 600) {
        const chatText = cleanText(message.text, 180);
        if (!chatText) return;
        player.lastChat = now;
        broadcast(room, {
          type: 'chat',
          id: runtime.id(),
          name: player.name,
          text: chatText,
          at: now,
        });
      } else if (
        message.type === 'ping' &&
        (typeof message.at === 'number' || typeof message.at === 'string')
      ) {
        send(socket, {
          type: 'pong',
          at: typeof message.at === 'string' ? message.at.slice(0, 40) : message.at,
        });
      }
    });
    socket.on('close', () => {
      if (player.socket !== socket) return;
      cancelBarter(room, player.id, runtime.now(), '相手が接続を離れたので、交換を中止しました。');
      releaseBoat(room, player);
      releaseRider(room, player);
      player.pendingStrike = null;
      player.cookingEndsAt = 0;
      cancelFishing(player);
      cancelCoastal(player);
      room.projectiles = (room.projectiles || []).filter(
        (projectile) => projectile.ownerId !== player.id,
      );
      room.players.delete(player.id);
      if (!closing && player.sessionToken && resumeGraceMs > 0)
        room.sessions.set(player.sessionToken, {
          player,
          expiresAt: runtime.now() + resumeGraceMs,
        });
      while (room.sessions.size > maxSavedSessions)
        room.sessions.delete(room.sessions.keys().next().value);
      if (!keepEmptyRooms && room.players.size === 0 && !room.sessions.size) rooms.delete(roomName);
      else {
        systemChat(room, `${player.name} が谷をあとにした。`);
        broadcast(room, snapshot(room, true));
      }
    });
  }

  let previousTick = runtime.now();
  let lastHeartbeat = runtime.now();
  function tick() {
    const now = runtime.now();
    const dt = Math.min((now - previousTick) / 1000, 0.15);
    previousTick = now;
    const heartbeat = now - lastHeartbeat > 15000;
    if (heartbeat) lastHeartbeat = now;
    for (const room of rooms.values()) {
      for (const [token, entry] of room.sessions)
        if (now >= entry.expiresAt) room.sessions.delete(token);
      if (!room.players.size) {
        updateBarters(room, now);
        if (!keepEmptyRooms && !room.sessions.size) rooms.delete(room.name);
        continue;
      }
      for (const player of room.players.values()) {
        if (!player.target) player.target = player.path.shift() || null;
        const dynamic = [...room.players.values()]
          .filter((p) => p !== player)
          .concat(
            room.animals.filter(animalIsSolid),
            room.enemies.filter(enemyIsSolid),
            room.residents,
          )
          .map(actorObstacle);
        if (
          player.downedUntil ||
          (player.attackSequence && now - player.attackAt < attackProfile(player).durationMs)
        ) {
          player.speed = 0;
          player.moving = false;
          player.running = false;
        } else if (!player.mountId && !player.boatId) {
          updateNavigation(player, room.collision, dynamic, now);
          movePlayer(player, dt, now, (p, dx, dz) =>
            room.collision.move(p, dx, dz, player.radius, dynamic),
          );
        }
        if (heartbeat) {
          if (!player.alive) {
            player.socket.terminate();
            continue;
          }
          player.alive = false;
          player.socket.ping();
        }
      }
      updateBoats(room, dt, now);
      updateResidents(room, dt, now);
      const huntingChanged = updateHunting(room, now, notice);
      updateAnimals(room, dt, now);
      const enemiesChanged = updateEnemies(room, dt, now, notice);
      updateAdventures(room, now, notice);
      const gulfChanged = updateGulf(room, now);
      const fishingChanged = updateFishing(room, now, notice);
      const coastalChanged = updateCoastal(room, now, notice);
      const barterChanged = updateBarters(room, now);
      let resourcesChanged = false;
      for (const resource of room.resources) {
        if (resource.amount < resource.maxAmount && now - resource.regeneratedAt >= 20000) {
          const obstacle = room.resourceObstacles.get(resource.id);
          if (
            resource.amount === 0 &&
            obstacle &&
            [
              ...room.players.values(),
              ...room.animals.filter(animalIsSolid),
              ...room.enemies.filter(enemyIsSolid),
              ...room.residents,
            ].some((actor) => overlap(actor, actor.radius, obstacle))
          )
            continue;
          resourcesChanged = true;
          resource.amount += 1;
          resource.regeneratedAt = now;
        }
      }
      if (
        now - room.lastBroadcast >= 90 ||
        resourcesChanged ||
        gulfChanged ||
        huntingChanged ||
        enemiesChanged ||
        fishingChanged ||
        barterChanged ||
        coastalChanged
      ) {
        broadcast(
          room,
          snapshot(room, resourcesChanged || gulfChanged || fishingChanged || coastalChanged),
        );
        room.lastBroadcast = now;
      }
    }
  }

  function exportState() {
    const now = runtime.now();
    return {
      version: 1,
      worldVersion: WORLD.version,
      savedAt: now,
      rooms: [...rooms.values()].map((room) => {
        const sessions = [...room.sessions.entries()]
          .filter(([, entry]) => entry.expiresAt > now)
          .map(([token, entry]) => ({ token, expiresAt: entry.expiresAt, player: entry.player }));
        for (const player of room.players.values())
          if (player.sessionToken) {
            sessions.push({ token: player.sessionToken, expiresAt: now + resumeGraceMs, player });
          }
        return JSON.parse(
          JSON.stringify(
            {
              name: room.name,
              createdAt: room.createdAt,
              camp: room.camp,
              resources: room.resources,
              animals: room.animals,
              enemies: room.enemies,
              boats: room.boats,
              gulf: room.gulf,
              residents: residentSnapshots(room),
              households: householdSnapshots(room),
              sessions: sessions.slice(-100),
            },
            (key, value) => (key === 'socket' ? undefined : value),
          ),
        );
      }),
    };
  }

  function importState(saved) {
    if (
      !saved ||
      saved.version !== 1 ||
      ![3, WORLD.version].includes(saved.worldVersion) ||
      !Array.isArray(saved.rooms)
    ) {
      throw new Error('Unsupported saved world; refusing to overwrite it');
    }
    if (rooms.size) throw new Error('Restore requires an empty game');
    // Restoring must not attach sockets or live mutations to the caller's saved
    // checkpoint; it may also be retained for verification or another restore.
    for (const record of JSON.parse(JSON.stringify(saved.rooms))) {
      if (record.gulf?.version > GULF.version) throw new Error('Unsupported saved gulf version');
      const movedGulfPlayers = migrateGulfRecord(record);
      const room = ensureRoom(record.name);
      room.createdAt = record.createdAt;
      Object.assign(room.camp, record.camp);
      room.gulf = createGulfState(record.gulf);
      room.boats = (record.boats || []).slice(0, BOATING.maxBoats).map((b) => {
        const boat = { ...b };
        stopActor(boat);
        boat.riderId = null;
        Object.assign(boat, boat.mooring);
        return boat;
      });
      for (const resource of record.resources) {
        const current = room.resourceById.get(resource.id);
        if (current)
          Object.assign(current, {
            amount: Math.max(0, Math.min(current.maxAmount, resource.amount)),
            regeneratedAt: resource.regeneratedAt,
          });
      }
      for (const name of ['animals', 'enemies'])
        for (const actor of room[name]) {
          const previous = record[name].find((item) => item.id === actor.id);
          if (previous) Object.assign(actor, previous);
          stopActor(actor);
          actor.riderId = null;
          actor.pendingAttack = null;
        }
      for (const entry of record.sessions)
        if (entry.expiresAt > runtime.now()) {
          const player = entry.player;
          if (player.boatId) {
            const boat = room.boats.find((b) => b.id === player.boatId);
            if (boat) Object.assign(player, boat.shore);
          }
          player.boatId = null;
          stopActor(player);
          player.mountId = null;
          player.pendingStrike = null;
          player.cookingEndsAt = 0;
          cancelFishing(player);
          cancelCoastal(player);
          ensureGulfPlayer(player);
          ensureVillageProgress(player);
          if (movedGulfPlayers.has(player) && !room.collision.free(player, player.radius ?? 0.32)) {
            const safe =
              room.collision.nearestFree(player, player.radius ?? 0.32, [], 80) ??
              room.collision.nearestFree(
                { ...MANY_HEARTHS, z: MANY_HEARTHS.z + 5 },
                player.radius ?? 0.32,
              );
            if (!safe) throw new Error('No safe arrival for migrated player');
            Object.assign(player, safe);
          }
          room.sessions.set(entry.token, { expiresAt: entry.expiresAt, player });
        }
      room.households = createHouseholds(record.households, runtime.now());
      createResidents(room, record.residents);
    }
  }

  return {
    playerLimit,
    rooms,
    snapshot,
    connect,
    tick,
    exportState,
    importState,
    close() {
      closing = true;
      rooms.clear();
    },
  };
}
