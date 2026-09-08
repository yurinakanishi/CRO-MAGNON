import { CollisionWorld } from './collision.mjs';
import { coastDistance } from './paleo-geography.mjs';
import { stopActor } from './combat.mjs';
import { attackProfile } from './combat-profiles.mjs';
import { movePlayer } from './movement.mjs';
import { updateNavigation } from './navigation.mjs';

export const BOATING = Object.freeze({
  version: 1,
  wood: 12,
  maxBoats: 24,
  radius: 2,
  reach: 4.8,
  speed: 4,
  fastSpeed: 7,
  waterY: -0.52,
});
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const boardedBoat = (room, player) =>
  (room.boats || []).find((b) => b.id === player.boatId && b.riderId === player.id);
export function waterBodyFree(x, z, radius = 0) {
  if (coastDistance(x, z) >= -0.12) return false;
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8;
    if (coastDistance(x + Math.cos(a) * radius, z + Math.sin(a) * radius) >= -0.12) return false;
  }
  return true;
}
export class SeaCollision extends CollisionWorld {
  constructor(land) {
    super(land.obstacles, { active: land.active, coast: false });
  }
  free(p, r, dynamic = [], ignore = (_obstacle) => false) {
    return waterBodyFree(p.x, p.z, r) && super.free(p, r, dynamic, ignore);
  }
  move(start, dx, dz, r, dynamic = []) {
    let p = { x: start.x, z: start.z };
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.1));
    for (let i = 0; i < n; i++) {
      for (const next of [
        { x: p.x + dx / n, z: p.z + dz / n },
        { x: p.x + dx / n, z: p.z },
        { x: p.x, z: p.z + dz / n },
      ]) {
        if (this.free(next, r, dynamic)) {
          p = next;
          break;
        }
      }
    }
    return p;
  }
  path(start, goal, r, dynamic = []) {
    // A land destination must never start an endless search or drag a boat ashore.
    if (!waterBodyFree(goal.x, goal.z, r)) return [];
    return super.path(start, goal, r, dynamic);
  }
}
export function initializeBoats(room) {
  room.boats = [];
  room.seaCollision = new SeaCollision(room.collision);
  room.shoreCollision = new CollisionWorld(room.collision.obstacles, {
    active: room.collision.active,
    coast: false,
  });
}
export const boatObstacles = (room, except?) =>
  (room.boats || [])
    .filter((b) => b !== except)
    .flatMap((b) => [
      { id: b.id, type: 'circle', x: b.x, z: b.z, radius: b.radius },
      ...(b.riderId && b.mooring
        ? [{ id: `${b.id}-mooring`, type: 'circle', ...b.mooring, radius: b.radius }]
        : []),
    ]);
function landObstacles(room, player) {
  return [...room.players.values()]
    .filter((p) => p !== player && !p.mountId && !p.boatId)
    .concat(
      room.animals.filter((a) => ['alive', 'dying'].includes(a.phase)),
      room.enemies.filter((e) => ['alive', 'dying'].includes(e.phase)),
    )
    .map((a) => ({ id: a.id, type: 'circle', x: a.x, z: a.z, radius: a.radius }));
}
export function launchPoint(room, player) {
  if (!room.collision.free(player, player.radius)) return null;
  const dynamic = boatObstacles(room);
  for (let r = 2.4; r <= BOATING.reach; r += 0.3)
    for (let i = 0; i < 32; i++) {
      const a = (i * Math.PI) / 16,
        p = { x: player.x + Math.cos(a) * r, z: player.z + Math.sin(a) * r };
      if (
        room.seaCollision.free(p, BOATING.radius, dynamic) &&
        room.shoreCollision.segmentFree(player, p, 0.2)
      )
        return p;
    }
  return null;
}
export function landingPoint(room, player, boat) {
  const dynamic = landObstacles(room, player);
  for (let r = boat.radius + player.radius + 0.2; r <= BOATING.reach; r += 0.3)
    for (let i = 0; i < 32; i++) {
      const a = boat.facing + Math.PI / 2 + (i * Math.PI) / 16,
        p = { x: boat.x + Math.sin(a) * r, z: boat.z + Math.cos(a) * r };
      if (
        room.collision.free(p, player.radius, dynamic) &&
        room.shoreCollision.segmentFree(boat, p, player.radius, dynamic)
      )
        return p;
    }
  return null;
}
export function releaseBoat(room, player) {
  const boat = boardedBoat(room, player);
  if (boat) {
    stopActor(boat);
    boat.riderId = null;
    // Disconnect/restart returns both parties to the last safe embarkation.
    Object.assign(boat, boat.mooring);
    Object.assign(player, boat.shore);
  }
  player.boatId = null;
  stopActor(player);
}
export function handleBoatAction(room, player, message, now) {
  if (!['craftBoat', 'boardBoat'].includes(message.action)) return null;
  const fail = (text) => ({ changed: false, tone: 'info', text });
  if (player.downedUntil || player.mountId)
    return fail('地上で元気なときに船を使おう。マンモスからは R で降りられます。');
  const boat = boardedBoat(room, player);
  if (boat) {
    if (message.action === 'craftBoat') return fail('船を作るには先に岸へ降りよう。');
    const point = landingPoint(room, player, boat);
    if (!point) return fail('ここでは降りられません。岸に近づいて B を押そう。');
    stopActor(boat);
    boat.riderId = null;
    boat.shore = { ...point };
    boat.mooring = { x: boat.x, z: boat.z };
    player.boatId = null;
    stopActor(player);
    Object.assign(player, point);
    return { changed: true, tone: 'success', text: '岸に降りました。船はみんなで使えます。' };
  }
  if (
    player.cookingEndsAt ||
    (player.attackSequence && now - player.attackAt < attackProfile(player).durationMs)
  )
    return fail('今の動作を終えてから船を使おう。');
  if (message.action === 'craftBoat') {
    if (player.inventory.wood < BOATING.wood)
      return fail(`丸木舟には木材 ${BOATING.wood} が必要です。`);
    if (room.boats.length >= BOATING.maxBoats)
      return fail(`船は部屋に${BOATING.maxBoats}隻までです。岸にある空いた船を使おう。`);
    const point = launchPoint(room, player);
    if (!point) return fail('船を浮かべられる、障害物のない海岸に近づこう。');
    const id = Array.from({ length: BOATING.maxBoats }, (_, i) => `boat-${i + 1}`).find(
      (id) => !room.boats.some((b) => b.id === id),
    );
    room.boats.push({
      id,
      ...point,
      mooring: { ...point },
      shore: { x: player.x, z: player.z },
      radius: BOATING.radius,
      facing: Math.atan2(point.x - player.x, point.z - player.z),
      riderId: null,
      dx: 0,
      dz: 0,
      path: [],
      target: null,
      speed: 0,
      moving: false,
      running: false,
      lastInput: 0,
    });
    player.inventory.wood -= BOATING.wood;
    stopActor(player);
    return {
      changed: true,
      tone: 'success',
      text: '木材12個で丸木舟を作りました！ B で乗れます。',
    };
  }
  const target =
    typeof message.targetId === 'string'
      ? room.boats.find((b) => b.id === message.targetId)
      : room.boats
          .filter((b) => !b.riderId)
          .sort((a, b) => distance(a, player) - distance(b, player))[0];
  if (!target || target.riderId)
    return fail('近くに空いた船がありません。海岸で木材12個から作れます。');
  if (
    !room.collision.free(player, player.radius) ||
    distance(player, target) > BOATING.reach ||
    !room.shoreCollision.segmentFree(player, target, 0.2)
  )
    return fail('岸にある船の近くで B を押そう。');
  stopActor(player);
  stopActor(target);
  target.shore = { x: player.x, z: player.z };
  target.mooring = { x: target.x, z: target.z };
  player.boatId = target.id;
  target.riderId = player.id;
  target.lastInput = now;
  target.runningRequested = false;
  player.pendingStrike = null;
  copyBoatPosition(player, target);
  return {
    changed: true,
    tone: 'success',
    text: '丸木舟に乗りました！ WASDで操船・方向キー2回押しで速く進む・岸でBを押すと降ります。',
  };
}
export function copyBoatPosition(player, boat) {
  for (const k of ['x', 'z', 'facing', 'speed', 'moving', 'running']) player[k] = boat[k];
}
export function updateBoats(room, dt, now) {
  for (const boat of room.boats) {
    if (!boat.riderId) continue;
    const player = room.players.get(boat.riderId);
    if (!player || player.boatId !== boat.id) {
      stopActor(boat);
      boat.riderId = null;
      Object.assign(boat, boat.mooring);
      continue;
    }
    const dynamic = boatObstacles(room, boat);
    updateNavigation(boat, room.seaCollision, dynamic, now);
    movePlayer(
      boat,
      dt,
      now,
      (p, dx, dz) => room.seaCollision.move(p, dx, dz, boat.radius, dynamic),
      boat.runningRequested ? BOATING.fastSpeed : BOATING.speed,
    );
    copyBoatPosition(player, boat);
  }
}
