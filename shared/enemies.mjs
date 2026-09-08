import { CAMP } from './world.mjs';
import { ENEMY_GROUNDS } from './scenery-layout.mjs';
export { ENEMY_GROUNDS } from './scenery-layout.mjs';
import { combatDistance, enemyIsSolid, inAttackArc, stopActor } from './combat.mjs';
import { movePlayer } from './movement.mjs';

export const ENEMY_RULES = Object.freeze({
  modelKey: 'crow-shaman', maxHealth: 75, radius: .48, roamSpeed: .7, chaseSpeed: 1.65,
  aggroRange: 8, leashRadius: 12, loseTargetRange: 14, campSafeRadius: 12,
  // Exact crow Staff skin reaches a player at 1.47 m during the 450 ms impact;
  // stop at 1.40 m center distance (.48 + .32 + .60) so the visible blow connects.
  attackReach: .6, attackDamage: 15, attackCooldownMs: 1800, attackDurationMs: 1000,
  attackImpactMs: 450, hitDurationMs: 400, deathDurationMs: 1200, respawnMs: 45000,
  recoveryMs: 4000, recoveryEnergy: 50, protectionMs: 5000,
});
const circle = actor => ({ id: actor.id, type: 'circle', x: actor.x, z: actor.z, radius: actor.radius });
const solidAnimal = animal => animal.phase === 'alive' || animal.phase === 'dying';
const dynamicActors = (room, except) => [...room.players.values(), ...(room.animals || []).filter(solidAnimal), ...(room.enemies || []).filter(enemyIsSolid)].filter(actor => actor !== except).map(circle);
const withinStaffReach = (enemy, player) => combatDistance(enemy, player) <= enemy.radius + player.radius + ENEMY_RULES.attackReach;
const eligiblePlayer = (room, player, now) => player && !player.mountId && !player.boatId && !player.downedUntil && now >= (player.invulnerableUntil || 0) && combatDistance(player, room.camp || CAMP) > ENEMY_RULES.campSafeRadius;
const clearLine = (room, a, b) => room.collision.segmentFree(a, b, .12);

export function createEnemies(collision, dynamic = [], now = Date.now()) {
  return ENEMY_GROUNDS.map(ground => {
    const position = collision.nearestFree(ground, ENEMY_RULES.radius, dynamic.map(circle), ground.roamRadius);
    if (!position) throw new Error(`No safe enemy spawn for ${ground.id}`);
    return {
      id: ground.id, modelKey: ENEMY_RULES.modelKey, name: ground.name??'白羽の呪術師', regionId:ground.regionId, hostile: true,
      ...position, home: { ...position }, radius: ENEMY_RULES.radius, scale: 1,
      phase: 'alive', phaseStartedAt: now, alive: true, health: ground.maxHealth??ENEMY_RULES.maxHealth, maxHealth: ground.maxHealth??ENEMY_RULES.maxHealth,
      facing: 0, speed: 0, moving: false, running: false, runningRequested: false, clip: 'Idle_Loop', behavior: 'roam',
      dx: 0, dz: 0, lastInput: 0, target: null, path: [], targetId: null, roamRadius: ground.roamRadius, roamIndex: 0,
      nextRoamAt: now + 1000, nextPathAt: 0, pathGoal: null, returning: false,
      attackSequence: 0, attackAt: 0, attackLockUntil: 0, pendingAttack: null,
      hitSequence: 0, hitAt: 0, hitUntil: 0, hitDurationMs: ENEMY_RULES.hitDurationMs, aggroAfter: now + 1000,
    };
  });
}

function recoverPlayers(room, now, notify) {
  let changed = false;
  for (const player of room.players.values()) {
    if (!player.downedUntil || now < player.downedUntil) continue;
    const camp = room.camp || CAMP;
    const spawn = room.collision.nearestFree({ x: camp.x - 1, z: camp.z + 3 }, player.radius, dynamicActors(room, player), 8);
    if (!spawn) { player.downedUntil = now + 500; continue; }
    Object.assign(player, spawn); stopActor(player);
    player.downedUntil = 0; player.energy = ENEMY_RULES.recoveryEnergy;
    player.invulnerableUntil = now + ENEMY_RULES.protectionMs;
    player.pendingStrike = null; player.cookingEndsAt = 0; changed = true;
    notify(player, '焚き火のそばで回復しました。元気50、持ち物はそのままです。', 'success');
  }
  return changed;
}

function hitPlayer(room, enemy, player, now, notify) {
  player.energy = Math.max(0, player.energy - ENEMY_RULES.attackDamage);
  player.hurtSequence = (player.hurtSequence || 0) + 1; player.hurtAt = now;
  player.cookingEndsAt = 0;
  if (player.energy > 0) { notify(player, `${enemy.name}の杖が命中。元気 -${ENEMY_RULES.attackDamage}`, 'error'); return; }
  stopActor(player); player.pendingStrike = null; player.downedUntil = now + ENEMY_RULES.recoveryMs;
  player.defeatSequence = (player.defeatSequence || 0) + 1;
  notify(player, '力尽きました。4秒後に焚き火で回復します。持ち物は失いません。', 'error');
}

function plan(enemy, room, goal, now) {
  if (now < enemy.nextPathAt && (enemy.target || enemy.path.length)) return;
  enemy.path = room.collision.path(enemy, goal, enemy.radius); enemy.target = enemy.path.shift() || null;
  enemy.pathGoal = { x: goal.x, z: goal.z }; enemy.nextPathAt = now + 500;
}
function moveEnemy(enemy, room, dt, now, speed) {
  if (!enemy.target) enemy.target = enemy.path.shift() || null;
  enemy.runningRequested = speed > ENEMY_RULES.roamSpeed;
  movePlayer(enemy, dt, Infinity, (actor, dx, dz) => room.collision.move(actor, dx, dz, enemy.radius, dynamicActors(room, enemy)), speed);
  enemy.clip = enemy.moving ? (enemy.running ? 'Run_Loop' : 'Walk_Loop') : 'Idle_Loop';
}

export function updateEnemies(room, dt, now = Date.now(), notify = () => {}) {
  let changed = recoverPlayers(room, now, notify);
  for (const enemy of room.enemies || []) {
    // Generic combat also supports other hostile types, whose own AI owns them.
    if (enemy.modelKey !== ENEMY_RULES.modelKey) continue;
    if (enemy.phase === 'dead') {
      stopActor(enemy); enemy.pendingAttack = null; enemy.clip = 'Death'; enemy.behavior = 'dead';
      if (now - enemy.phaseStartedAt >= ENEMY_RULES.deathDurationMs) {
        enemy.phase = 'respawning'; enemy.phaseStartedAt = now; enemy.clip = null; enemy.behavior = 'respawning'; changed = true;
      }
      continue;
    }
    if (enemy.phase === 'respawning') {
      if (now - enemy.phaseStartedAt < ENEMY_RULES.respawnMs) continue;
      const spawn = room.collision.nearestFree(enemy.home, enemy.radius, dynamicActors(room, enemy), enemy.roamRadius);
      if (!spawn) continue;
      Object.assign(enemy, spawn, { phase: 'alive', phaseStartedAt: now, alive: true, health: enemy.maxHealth, targetId: null, returning: false, clip: 'Idle_Loop', behavior: 'roam', hitUntil: 0, attackLockUntil: 0, pendingAttack: null, nextRoamAt: now + 1000, aggroAfter: now + 1000 });
      stopActor(enemy); changed = true; continue;
    }
    if (now < enemy.hitUntil) { stopActor(enemy); enemy.clip = 'Hit'; enemy.behavior = 'hit'; continue; }
    if (enemy.pendingAttack && now >= enemy.pendingAttack.impactAt) {
      const strike = enemy.pendingAttack; enemy.pendingAttack = null;
      const player = room.players.get(strike.targetId);
      if (eligiblePlayer(room, player, now) && withinStaffReach(enemy, player) && inAttackArc(enemy, player, strike.facing) && clearLine(room, enemy, player)) {
        hitPlayer(room, enemy, player, now, notify); changed = true;
      }
    }
    if (now < enemy.attackLockUntil) { stopActor(enemy); enemy.clip = 'Attack'; enemy.behavior = 'attack'; continue; }
    let target = room.players.get(enemy.targetId);
    if (enemy.targetId && (!eligiblePlayer(room, target, now) || combatDistance(target, enemy.home) > ENEMY_RULES.leashRadius || combatDistance(target, enemy) > ENEMY_RULES.loseTargetRange || combatDistance(enemy, enemy.home) > ENEMY_RULES.leashRadius)) {
      enemy.targetId = null; target = null; enemy.returning = true; stopActor(enemy); enemy.nextPathAt = 0;
    }
    if (enemy.returning) {
      enemy.behavior = 'return';
      if (combatDistance(enemy, enemy.home) < .15) { enemy.returning = false; stopActor(enemy); enemy.nextRoamAt = now + 1000; enemy.clip = 'Idle_Loop'; }
      else { plan(enemy, room, enemy.home, now); moveEnemy(enemy, room, dt, now, ENEMY_RULES.chaseSpeed); }
      continue;
    }
    if (!target && now >= enemy.aggroAfter) {
      target = [...room.players.values()].filter(player => eligiblePlayer(room, player, now) && combatDistance(player, enemy.home) <= ENEMY_RULES.leashRadius && combatDistance(player, enemy) <= ENEMY_RULES.aggroRange && clearLine(room, enemy, player))
        .sort((a, b) => combatDistance(enemy, a) - combatDistance(enemy, b))[0];
      if (target) { enemy.targetId = target.id; stopActor(enemy); enemy.nextPathAt = 0; changed = true; }
    }
    if (target) {
      if (withinStaffReach(enemy, target) && clearLine(room, enemy, target)) {
        stopActor(enemy); enemy.facing = Math.atan2(target.x - enemy.x, target.z - enemy.z); enemy.clip = 'Idle_Loop'; enemy.behavior = 'chase';
        if (!enemy.attackSequence || now - enemy.attackAt >= ENEMY_RULES.attackCooldownMs) {
          enemy.attackAt = now; enemy.attackSequence++; enemy.attackLockUntil = now + ENEMY_RULES.attackDurationMs;
          enemy.pendingAttack = { targetId: target.id, impactAt: now + ENEMY_RULES.attackImpactMs, facing: enemy.facing };
          enemy.clip = 'Attack'; enemy.behavior = 'attack'; changed = true;
        }
      } else {
        enemy.behavior = 'chase'; plan(enemy, room, target, now); moveEnemy(enemy, room, dt, now, ENEMY_RULES.chaseSpeed);
      }
      continue;
    }
    enemy.behavior = 'roam';
    if (!enemy.target && !enemy.path.length && now >= enemy.nextRoamAt) {
      const angle = ++enemy.roamIndex * 2.39996;
      plan(enemy, room, { x: enemy.home.x + Math.sin(angle) * enemy.roamRadius, z: enemy.home.z + Math.cos(angle) * enemy.roamRadius }, now);
      enemy.nextRoamAt = now + 2500;
    }
    moveEnemy(enemy, room, dt, now, ENEMY_RULES.roamSpeed);
  }
  return changed;
}
