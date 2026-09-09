import { attackProfile } from './combat-profiles.mjs';
import { stopActor, enemyIsSolid } from './combat.mjs';
import { jumpProgress } from './jumping.mjs';
import { isCarryable } from './characters.mjs';

export const CARRY = Object.freeze({ reach: 0.85, offerMs: 15000 });
export const carrying = (p) => !!(p?.carrierId || p?.passengerId);
const stationary = (p, now) =>
  p &&
  !carrying(p) &&
  !p.mountId &&
  !p.boatId &&
  !p.downedUntil &&
  !p.moving &&
  Math.hypot(p.dx ?? 0, p.dz ?? 0) < 0.01 &&
  !p.cookingEndsAt &&
  !p.fishing &&
  !p.coastalActivity &&
  jumpProgress(p, now) === null &&
  !(p.attackSequence && now - p.attackAt < attackProfile(p).durationMs);

export function canCarry(ape, mage, collision, now) {
  return !!(
    ape?.species === 'ape' &&
    isCarryable(mage) &&
    ape.id !== mage.id &&
    stationary(ape, now) &&
    stationary(mage, now) &&
    Math.hypot(ape.x - mage.x, ape.z - mage.z) <= ape.radius + mage.radius + CARRY.reach &&
    collision?.segmentFree(ape, mage, 0.12)
  );
}

export function clearCarryOffer(room, player) {
  for (const p of room.players.values()) {
    if (p === player || p.carryOfferFromId === player.id || p.carryOfferToId === player.id) {
      p.carryOfferFromId = null;
      p.carryOfferToId = null;
      p.carryOfferUntil = 0;
    }
  }
}

function obstacles(room, mage) {
  return [
    ...room.players.values(),
    ...(room.animals ?? []).filter((a) => ['alive', 'dying'].includes(a.phase)),
    ...(room.enemies ?? []).filter(enemyIsSolid),
    ...(room.residents ?? []),
  ]
    .filter((p) => p !== mage && !p.carrierId)
    .map((p) => ({ type: 'circle', x: p.x, z: p.z, radius: p.radius }));
}

export function carryExit(room, ape, mage) {
  const dynamic = obstacles(room, mage),
    radius = ape.radius + mage.radius + 0.18;
  for (let i = 0; i < 24; i++) {
    const angle = ape.facing + Math.PI / 2 + (i * Math.PI) / 12;
    const point = { x: ape.x + Math.sin(angle) * radius, z: ape.z + Math.cos(angle) * radius };
    if (
      room.collision.free(point, mage.radius, dynamic) &&
      room.collision.segmentFree(ape, point, mage.radius)
    )
      return point;
  }
  return null;
}

export function releaseCarry(room, player, forced = false) {
  const ape = player.carrierId ? room.players.get(player.carrierId) : player;
  const mage = ape?.passengerId
    ? room.players.get(ape.passengerId)
    : player.carrierId
      ? player
      : null;
  if (!ape || !mage) {
    player.carrierId = null;
    player.passengerId = null;
    return true;
  }
  let point = carryExit(room, ape, mage);
  if (!point && forced) {
    const dynamic = obstacles(room, mage);
    if (mage.carrySafePoint && room.collision.free(mage.carrySafePoint, mage.radius, dynamic))
      point = mage.carrySafePoint;
    else point = room.collision.nearestFree(ape, mage.radius, dynamic, 80);
  }
  if (!point) return false;
  ape.passengerId = null;
  mage.carrierId = null;
  mage.carrySafePoint = null;
  stopActor(ape);
  stopActor(mage);
  Object.assign(mage, point);
  return true;
}

export function handleCarryAction(room, player, message, now) {
  if (!['carry', 'carryDecline'].includes(message.action)) return null;
  const fail = (text) => ({ changed: false, text, tone: 'info' });
  const done = (text) => ({ changed: true, text, tone: 'success' });
  if (message.action === 'carryDecline') {
    clearCarryOffer(room, player);
    return done('肩乗りの誘いを取り消しました。');
  }
  if (carrying(player))
    return releaseCarry(room, player)
      ? done('地面に降りました。')
      : fail('降りる場所がふさがれています。開けた場所へ移動しよう。');
  if (player.carryOfferToId) {
    clearCarryOffer(room, player);
    return done('肩乗りの誘いを取り消しました。');
  }
  if (isCarryable(player)) {
    const ape = room.players.get(player.carryOfferFromId);
    if (
      !ape ||
      message.targetId !== ape.id ||
      ape.carryOfferToId !== player.id ||
      now >= player.carryOfferUntil ||
      !canCarry(ape, player, room.collision, now)
    ) {
      clearCarryOffer(room, player);
      return fail('近くの大猿に、もう一度誘ってもらおう。');
    }
    clearCarryOffer(room, player);
    stopActor(ape);
    stopActor(player);
    player.carrySafePoint = { x: player.x, z: player.z };
    ape.passengerId = player.id;
    player.carrierId = ape.id;
    ape.carryHurtSequence = ape.hurtSequence ?? 0;
    player.carryHurtSequence = player.hurtSequence ?? 0;
    copyPassenger(ape, player);
    return done('肩に乗りました。R／△で降りられます。');
  }
  const mage = room.players.get(message.targetId);
  if (!canCarry(player, mage, room.collision, now))
    return fail('担げる相手のそばで、二人とも止まってから担ごう。');
  if (mage.carryOfferFromId) return fail('相手は別の誘いを確認しています。');
  player.carryOfferToId = mage.id;
  mage.carryOfferFromId = player.id;
  player.carryOfferUntil = mage.carryOfferUntil = now + CARRY.offerMs;
  return done('肩乗りに誘いました。相手が「肩に乗る」を押すと担ぎます。');
}

function copyPassenger(ape, mage) {
  for (const key of ['x', 'z', 'facing', 'moving', 'running', 'speed']) mage[key] = ape[key];
}

export function updateCarrying(room, now) {
  for (const ape of room.players.values()) {
    if (ape.carryOfferToId) {
      const mage = room.players.get(ape.carryOfferToId);
      if (now >= ape.carryOfferUntil || !canCarry(ape, mage, room.collision, now))
        clearCarryOffer(room, ape);
    }
    if (!ape.passengerId) continue;
    const mage = room.players.get(ape.passengerId);
    if (!mage || mage.carrierId !== ape.id) {
      ape.passengerId = null;
      continue;
    }
    if (
      ape.downedUntil ||
      mage.downedUntil ||
      ape.mountId ||
      ape.boatId ||
      (ape.hurtSequence ?? 0) !== ape.carryHurtSequence ||
      (mage.hurtSequence ?? 0) !== mage.carryHurtSequence
    ) {
      releaseCarry(room, ape, true);
      continue;
    }
    const exit = carryExit(room, ape, mage);
    if (exit) mage.carrySafePoint = exit;
    copyPassenger(ape, mage);
  }
}
