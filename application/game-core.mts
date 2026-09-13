import { updateFishing, cancelFishing } from '../shared/fishing.mjs';
import { DEFAULT_RULES, EXHIBITION_RULES } from '../shared/room-rules.mjs';
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
  initializeBoats,
  releaseBoat,
  updateBoats,
} from '../shared/boats.mjs';
import { characterModel, normalizeCharacter } from '../shared/characters.mjs';
import { CollisionWorld, overlap } from '../shared/collision.mjs';
import { attackProfile } from '../shared/combat-profiles.mjs';
import { handleBarterCommand, cancelBarter, updateBarters } from '../shared/barter.mjs';
import { updateSuppers } from '../shared/supper.mjs';
import { updateForaging } from '../shared/foraging.mjs';
import { updateWatering } from '../shared/watering.mjs';
import { enemyIsSolid, stopActor } from '../shared/combat.mjs';
import { createEnemies, updateEnemies } from '../shared/enemies.mjs';
import { BEHEMOTH } from '../shared/behemoth-rules.mjs';
import { SABERTOOTH } from '../shared/sabertooth-rules.mjs';
import { animalIsSolid, updateHunting } from '../shared/hunting.mjs';
import { movePlayer } from '../shared/movement.mjs';
import { canStartJump, jumpProgress } from '../shared/jumping.mjs';
import { normalizeDifficulty } from '../shared/difficulty.mjs';

import { carrying, updateCarrying, releaseCarry, clearCarryOffer } from '../shared/carrying.mjs';
import { RIDING, mountedAnimal, releaseRider } from '../shared/riding.mjs';
import { SCENERY } from '../shared/scenery-layout.mjs';
import { CAMP, INITIAL_RESOURCES, WORLD } from '../shared/world.mjs';
import { createActionHandler } from './actions.mjs';
import { defaultRuntime, type GameConnection, type Runtime } from './ports.mjs';
import { decodeCommand } from './protocol.mjs';
import { activeMapPins, MAP_PIN_COOLDOWN_MS, MAP_PIN_LIFETIME_MS } from '../shared/map-pins.mjs';
import { locationName } from '../shared/paleo-geography.mjs';
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
  persistentSessions = false,
  playerLimit = WORLD.maxPlayers,
  runtime = defaultRuntime,
  exhibition = false,
}: {
  resumeGraceMs?: number;
  keepEmptyRooms?: boolean;
  maxSavedSessions?: number;
  persistentSessions?: boolean;
  playerLimit?: number;
  runtime?: Runtime;
  exhibition?: boolean;
} = {}) {
  if (!Number.isInteger(playerLimit) || playerLimit < 1 || playerLimit > 64)
    throw new Error('playerLimit must be an integer from 1 to 64');
  const rooms = new Map();
  const resettingRooms = new Set<string>();
  let closing = false;
  const sessionExpiry = (now: number) =>
    persistentSessions ? Number.MAX_SAFE_INTEGER : now + resumeGraceMs;
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
        rules: exhibition ? EXHIBITION_RULES : DEFAULT_RULES,
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
      createResidents(room, [], runtime.now());
      rooms.set(roomName, room);
    }
    return room;
  }

  function connect(socket: GameConnection, params: URLSearchParams) {
    if (closing) {
      socket.close(1012, 'Server restarting');
      return;
    }
    const roomName =
      cleanText(params.get('room'), 20)
        .toUpperCase()
        .replace(/[^A-Z0-9_-]/g, '') || 'EMBER';
    if (resettingRooms.has(roomName)) {
      socket.close(1013, 'Room reset in progress');
      return;
    }
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
        difficulty: normalizeDifficulty(params.get('difficulty')),
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
      lastAction: 0,
      lastChat: 0,
      jumpAt: 0,
      jumpSequence: 0,
      runningRequested: false,
      needsWorld: false,
      ready: room.camp.level > 0,
      difficulty: normalizeDifficulty(params.get('difficulty') ?? player.difficulty),
    });
    stopActor(player);
    Object.assign(player, spawn);
    room.players.set(player.id, player);
    send(socket, {
      type: 'welcome',
      persistentSession: persistentSessions,
      ridingVersion: RIDING.version,
      combatVersion: 3,
      characterVersion: 2,
      worldVersion: WORLD.version,
      id: player.id,
      room: roomName,
      resumed,
      session: player.sessionToken,
      profile: {
        name: player.name,
        species: player.species,
        gender: player.gender,
        difficulty: player.difficulty,
      },
    });
    broadcast(room, snapshot(room, true));
    systemChat(room, `${player.name} が谷に${resumed ? '戻ってきた' : 'やってきた'}。`);
    socket.on('pong', () => {
      if (player.socket === socket) player.alive = true;
    });
    socket.on('error', () => {});
    socket.on('message', (data, isBinary) => {
      if (
        closing ||
        isBinary ||
        player.socket !== socket ||
        resettingRooms.has(roomName) ||
        rooms.get(roomName) !== room
      )
        return;
      const now = runtime.now();
      player.tokens = Math.min(70, player.tokens + (now - player.refillAt) * 0.035);
      player.refillAt = now;
      if (player.tokens < 1) return;
      player.tokens -= 1;
      const message = decodeCommand(data.toString());
      if (!message) return;
      if (message.type === 'mapPin' || message.type === 'clearMapPin') {
        room.mapPins = activeMapPins(room, now);
        if (
          message.type === 'mapPin' &&
          now - (player.lastMapPinAt ?? -Infinity) < MAP_PIN_COOLDOWN_MS
        )
          return;
        room.mapPins = room.mapPins.filter((pin) => pin.ownerId !== player.id);
        if (message.type === 'mapPin') {
          player.lastMapPinAt = now;
          const pin = {
            id: runtime.id(),
            ownerId: player.id,
            name: player.name,
            color: player.color,
            x: message.x,
            z: message.z,
            expiresAt: now + MAP_PIN_LIFETIME_MS,
          };
          room.mapPins.push(pin);
          broadcast(room, {
            type: 'chat',
            id: pin.id,
            name: player.name,
            text: `ここへ行こう！ ${locationName(pin.x, pin.z)}（地図にピン）`,
            at: now,
            mapPin: true,
          });
        }
        broadcast(room, snapshot(room));
        return;
      }
      if (message.type === 'leave') {
        if (!persistentSessions || !message.keepSession) player.sessionToken = null;
        socket.close(1000, 'Explicit leave');
        return;
      }
      if (message.type === 'difficulty') {
        player.difficulty = message.difficulty;
        return;
      }
      if (message.type === 'barter') {
        if (message.kind !== 'cancel' && (carrying(player) || jumpProgress(player, now) !== null)) {
          notice(player, '地面に降りてから交換しよう。');
          return;
        }
        if (message.kind !== 'cancel' && now - player.lastAction < 450) return;
        if (message.kind !== 'cancel') player.lastAction = now;
        const result = handleBarterCommand(room, player, message, now, runtime.id);
        if (result.text) notice(player, result.text, result.ok ? 'success' : 'info');
        if (result.changed) broadcast(room, snapshot(room));
        return;
      }
      if (player.carrierId && ['move', 'gait'].includes(message.type)) return;
      const controlled = boardedBoat(room, player) || mountedAnimal(room, player) || player;
      if (player.downedUntil && ['move', 'gait', 'action'].includes(message.type)) {
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
        message.type === 'action' &&
        typeof message.action === 'string' &&
        (message.action === 'attack' ||
          message.action === 'jump' ||
          message.action === 'cancelCook' ||
          message.action === 'cancelFishing' ||
          message.action === 'cancelCoastal' ||
          message.action === 'rift' ||
          message.action === 'warp' ||
          message.action === 'changeCharacter' ||
          now - player.lastAction >= 450)
      ) {
        if (message.action === 'jump' && !canStartJump(player, now)) return;
        if (!['cancelFishing', 'cancelCoastal', 'cancelCook', 'wave'].includes(message.action))
          cancelBarter(room, player.id, now, '別の作業を始めたので、交換を中止しました。');
        if (!['cancelFishing', 'cancelCoastal', 'jump'].includes(message.action))
          player.lastAction = now;
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
      if (player.socket !== socket || rooms.get(roomName) !== room) return;
      cancelBarter(room, player.id, runtime.now(), '相手が接続を離れたので、交換を中止しました。');
      clearCarryOffer(room, player);
      releaseCarry(room, player, true);
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
      room.mapPins = activeMapPins(room, runtime.now());
      if (!room.players.size)
        for (const resident of room.residents) {
          resident.forageWork = null;
          resident.wateringWork = null;
          resident.wateringTarget = null;
        }
      if (!closing && player.sessionToken && resumeGraceMs > 0)
        room.sessions.set(player.sessionToken, {
          player,
          expiresAt: sessionExpiry(runtime.now()),
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
    if (closing) return;
    const now = runtime.now();
    const dt = Math.min((now - previousTick) / 1000, 0.15);
    previousTick = now;
    const heartbeat = now - lastHeartbeat > 15000;
    if (heartbeat) lastHeartbeat = now;
    for (const room of rooms.values()) {
      if (resettingRooms.has(room.name)) continue;
      for (const [token, entry] of room.sessions)
        if (now >= entry.expiresAt) room.sessions.delete(token);
      if (!room.players.size) {
        updateBarters(room, now);
        for (const resident of room.residents) {
          resident.forageWork = null;
          resident.wateringWork = null;
          resident.wateringTarget = null;
        }
        if (!keepEmptyRooms && !room.sessions.size) rooms.delete(room.name);
        continue;
      }
      for (const player of room.players.values()) {
        const dynamic = [...room.players.values()]
          .filter((p) => p !== player && !p.carrierId)
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
        } else if (!player.mountId && !player.boatId && !player.carrierId) {
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
      updateCarrying(room, now);
      updateBoats(room, dt, now);
      updateResidents(room, dt, now);
      const foragingChanged = updateForaging(room, dt, now);
      const wateringChanged = updateWatering(room, dt, now);
      const supperChanged = updateSuppers(room, now);
      const huntingChanged = updateHunting(room, now, notice);
      updateAnimals(room, dt, now);
      const enemiesChanged = updateEnemies(room, dt, now, notice);
      updateCarrying(room, now);
      updateAdventures(room, now, notice);
      const gulfChanged = updateGulf(room, now) || supperChanged || wateringChanged;
      const fishingChanged = updateFishing(room, now, notice);
      const coastalChanged = updateCoastal(room, now, notice);
      const barterChanged = updateBarters(room, now);
      let resourcesChanged = foragingChanged;
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

  async function resetRoom(
    roomName: string,
    persist: (state: ReturnType<typeof exportState>) => Promise<unknown>,
  ) {
    const room = rooms.get(roomName);
    if (closing || !room || resettingRooms.has(roomName)) throw new Error('Room unavailable');
    resettingRooms.add(roomName);
    try {
      // Commit the reset on disk first. Failure leaves the current room and its sessions intact.
      const checkpoint = exportState();
      checkpoint.rooms = checkpoint.rooms.filter((record) => record.name !== roomName);
      await persist(checkpoint);
      rooms.delete(roomName);
      broadcast(room, { type: 'roomReset' });
      for (const player of room.players.values()) player.socket.close(1012, 'Room reset');
    } finally {
      resettingRooms.delete(roomName);
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
            sessions.push({ token: player.sessionToken, expiresAt: sessionExpiry(now), player });
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
              sessions: persistentSessions ? sessions : sessions.slice(-100),
            },
            (key, value) =>
              [
                'socket',
                'lastMapPinAt',
                'jumpAt',
                'jumpSequence',
                'carrierId',
                'passengerId',
                'carryOfferFromId',
                'carryOfferToId',
                'carryOfferUntil',
                'carrySafePoint',
                'carryHurtSequence',
              ].includes(key)
                ? undefined
                : value,
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
          const post = { x: actor.x, z: actor.z },
            currentCrow =
              name === 'enemies' && actor.modelKey === 'crow-shaman'
                ? {
                    home: { ...actor.home },
                    crowRole: actor.crowRole,
                    name: actor.name,
                    scale: actor.scale,
                    radius: actor.radius,
                    maxHealth: actor.maxHealth,
                    roamRadius: actor.roamRadius,
                    castle: actor.castle,
                    regionId: actor.regionId,
                  }
                : null;
          if (previous) Object.assign(actor, previous);
          stopActor(actor);
          actor.riderId = null;
          actor.pendingAttack = null;
          if (
            name === 'enemies' &&
            ['violet-behemoth', 'sabertooth-tiger'].includes(actor.modelKey)
          ) {
            actor.evading = false;
            actor.superArmor = false;
            actor.nextPounceAt = 0;
            actor.nextStepAt = 0;
            actor.attackLockUntil = 0;
            actor.targetId = null;
            actor.returning = actor.phase === 'alive';
            actor.nextPathAt = 0;
            actor.nextAttackAt = 0;
            actor.clip = actor.phase === 'alive' ? 'Idle_Loop' : actor.clip;
            // The post comes from the current rules, not the save: a save made
            // before the post moved (the cat left the Siberian snow plain for the
            // European grassland on 2026-09-11) records the old home. A body left
            // outside the current territory starts on the post instead of walking
            // across the world.
            actor.home = { ...post };
            const territory = (actor.modelKey === 'violet-behemoth' ? BEHEMOTH : SABERTOOTH)
              .territoryRadius;
            if (Math.hypot(actor.x - post.x, actor.z - post.z) > territory)
              Object.assign(actor, post);
          } else if (currentCrow?.castle && !currentCrow.regionId) {
            // Castle faction membership and posts are current world layout, not
            // save data. This migrates the old three-shaman encounter to the
            // 28-member hierarchy without leaving saved bodies at the old keep.
            Object.assign(actor, currentCrow, {
              home: currentCrow.home,
              health: Math.min(actor.health ?? currentCrow.maxHealth, currentCrow.maxHealth),
              airborneHeight: 0,
              targetId: null,
              returning: actor.phase === 'alive',
              nextPathAt: 0,
              nextBoltAt: 0,
              nextBurstAt: 0,
            });
            if (Math.hypot(actor.x - post.x, actor.z - post.z) > actor.roamRadius + 1)
              Object.assign(actor, post);
          }
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
          player.carrierId = null;
          player.passengerId = null;
          player.carryOfferFromId = null;
          player.carryOfferToId = null;
          player.carryOfferUntil = 0;
          player.mountId = null;
          player.jumpAt = 0;
          player.jumpSequence = 0;
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
          room.sessions.set(entry.token, {
            expiresAt: persistentSessions ? Number.MAX_SAFE_INTEGER : entry.expiresAt,
            player,
          });
        }
      room.households = createHouseholds(record.households, runtime.now());
      createResidents(room, record.residents, runtime.now());
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
    resetRoom,
    pause() {
      closing = true;
    },
    close() {
      closing = true;
      rooms.clear();
    },
  };
}
