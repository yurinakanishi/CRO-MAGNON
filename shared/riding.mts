import { combatDistance, stopActor, enemyIsSolid } from './combat.mjs';
import { attackProfile } from './combat-profiles.mjs';
import { movePlayer } from './movement.mjs';
import { jumpProgress } from './jumping.mjs';

export const RIDING = Object.freeze({ version: 1, reach: 1.35, walkSpeed: 0.7, runSpeed: 2.25 });
const circle = (actor) => ({
  id: actor.id,
  type: 'circle',
  x: actor.x,
  z: actor.z,
  radius: actor.radius,
});
export const mountedAnimal = (room, player) =>
  room.animals.find(
    (a) => a.id === player.mountId && a.riderId === player.id && a.phase === 'alive',
  );
export const ridingDistance = (player, animal) =>
  combatDistance(player, animal) - animal.radius - player.radius;
/** The same eligibility check drives the nearby prompt and the server action. */
export function canMount(player, animal, collision, now) {
  return !!(
    player &&
    animal &&
    collision &&
    !player.mountId &&
    !player.boatId &&
    !player.carrierId &&
    !player.passengerId &&
    !player.downedUntil &&
    jumpProgress(player, now) === null &&
    !(player.attackSequence && now - player.attackAt < attackProfile(player).durationMs) &&
    animal.phase === 'alive' &&
    animal.health > 0 &&
    !animal.riderId &&
    !(now < animal.hitUntil) &&
    ridingDistance(player, animal) <= RIDING.reach &&
    collision.segmentFree(player, animal, 0.12)
  );
}
export function ridingObstacles(room, animal, rider) {
  return [...room.players.values()]
    .filter((p) => p !== rider && !p.mountId && !p.carrierId)
    .concat(
      room.animals.filter((a) => a !== animal && ['alive', 'dying'].includes(a.phase)),
      (room.enemies || []).filter(enemyIsSolid),
      (room.residents || []).filter((r) => r !== rider),
    )
    .map(circle);
}
export function copyRiderPosition(player, animal) {
  for (const key of ['x', 'z', 'facing', 'moving', 'running', 'speed']) player[key] = animal[key];
}
function release(animal) {
  animal.riderId = null;
  stopActor(animal);
  animal.runningRequested = false;
  animal.clip = 'Idle_Loop';
  // Resume wandering here instead of trying to walk back across the world.
  animal.home = { x: animal.x, z: animal.z };
  animal.nextRoam = animal.age + 5;
  animal.blockedFor = 0;
}
export function releaseRider(room, player) {
  const animal = room.animals.find((a) => a.riderId === player.id);
  if (animal) release(animal);
  player.mountId = null;
  stopActor(player);
}
export function dismountPoint(room, player, animal) {
  const dynamic = ridingObstacles(room, null, player);
  const radius = animal.radius + player.radius + 0.22;
  // Prefer the sides. Every candidate is outside the mammoth and in line of
  // sight from it; dismounting cannot move someone through a wall.
  for (let i = 0; i < 16; i++) {
    const angle = animal.facing + Math.PI / 2 + (i * Math.PI) / 8;
    const point = {
      x: animal.x + Math.sin(angle) * radius,
      z: animal.z + Math.cos(angle) * radius,
    };
    if (
      room.collision.free(point, player.radius, dynamic) &&
      room.collision.segmentFree(animal, point, player.radius)
    )
      return point;
  }
  return null;
}
export function handleRidingAction(room, player, message, now) {
  if (message.action !== 'ride') return null;
  const fail = (text) => ({ changed: false, tone: 'info', text });
  if (player.downedUntil) return fail('回復してから乗ろう。');
  const mount = mountedAnimal(room, player);
  if (mount) {
    const point = dismountPoint(room, player, mount);
    if (!point) return fail('降りる場所がふさがれています。開けた場所へ移動して R。');
    releaseRider(room, player);
    Object.assign(player, point);
    return { changed: true, tone: 'success', text: 'マンモスから降りました。' };
  }
  if (player.attackSequence && now - player.attackAt < attackProfile(player).durationMs)
    return fail('攻撃が終わってから乗ろう。');
  const animal =
    typeof message.targetId === 'string'
      ? room.animals.find((a) => a.id === message.targetId)
      : room.animals
          .filter((a) => a.phase === 'alive' && !a.riderId)
          .sort((a, b) => ridingDistance(player, a) - ridingDistance(player, b))[0];
  if (!animal || animal.phase !== 'alive' || animal.health <= 0)
    return fail('生きているマンモスの横で R を押すと乗れます。');
  if (animal.riderId) return fail('このマンモスには仲間が乗っています。1頭につき1人乗れます。');
  if (
    ridingDistance(player, animal) > RIDING.reach ||
    !room.collision.segmentFree(player, animal, 0.12)
  )
    return fail('マンモスの横まで近づいて R を押そう。');
  if (now < animal.hitUntil) return fail('マンモスが落ち着いてから乗ろう。');
  if (!canMount(player, animal, room.collision, now))
    return fail('マンモスの横で、着地してから △／R を押そう。');
  stopActor(player);
  stopActor(animal);
  player.pendingStrike = null;
  player.cookingEndsAt = 0;
  player.mountId = animal.id;
  animal.riderId = player.id;
  animal.lastInput = now;
  animal.runningRequested = false;
  animal.clip = 'Idle_Loop';
  copyRiderPosition(player, animal);
  return {
    changed: true,
    tone: 'success',
    text: 'マンモスに乗りました！ WASDで移動・方向キー2回押しで走る・Rで降りる。',
  };
}
export function updateRiddenAnimal(room, animal, dt, now) {
  if (!animal.riderId) return false;
  const rider = room.players.get(animal.riderId);
  if (!rider || rider.mountId !== animal.id) {
    release(animal);
    return false;
  }
  const dynamic = ridingObstacles(room, animal, rider);
  const speed = (animal.runningRequested ? RIDING.runSpeed : RIDING.walkSpeed) * animal.scale;
  movePlayer(
    animal,
    dt,
    now,
    (p, dx, dz) => room.collision.move(p, dx, dz, animal.radius, dynamic),
    speed,
  );
  animal.clip = animal.moving ? (animal.running ? 'Run_Loop' : 'Walk_Loop') : 'Idle_Loop';
  copyRiderPosition(rider, animal);
  return true;
}
