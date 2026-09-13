import { CAMP } from './world.mjs';
import { CASTLE_SURFACE } from './castle-surface.mjs';
import { castleTierOfHeight } from './castle-layout.mjs';
import { ENEMY_GROUNDS } from './scenery-layout.mjs';
export { ENEMY_GROUNDS } from './scenery-layout.mjs';
import {
  circleEntry,
  combatDistance,
  enemyIsSolid,
  inAttackArc,
  projectileWallEntry,
  stopActor,
} from './combat.mjs';
import { moveActor } from './movement.mjs';
import { createBehemoth, updateBehemoths } from './violet-behemoth.mjs';
import { provoker } from './perception.mjs';
import { respawnDelay } from './room-rules.mjs';
import { createSabertooth, updateSabertooths } from './sabertooth.mjs';
import {
  CROW_ALTAR,
  CROW_RITE_TEXT,
  CROW_ROLE_RULES,
  castleOccupied,
  crowRules,
  crowTier,
  inCrowWard,
} from './crow-faction.mjs';
import { nearCastle } from './castle-layout.mjs';
import { enemyMovementSpeed, incomingDamage } from './difficulty.mjs';

export const ENEMY_RULES = Object.freeze({
  modelKey: 'crow-shaman',
  ...CROW_ROLE_RULES.shaman,
  campSafeRadius: 12,
  hitDurationMs: 400,
  deathDurationMs: 1200,
  respawnMs: 45000,
  recoveryMs: 4000,
  recoveryEnergy: 50,
  protectionMs: 5000,
});
const circle = (actor) => ({
  id: actor.id,
  type: 'circle',
  x: actor.x,
  z: actor.z,
  radius: actor.radius,
});
const solidAnimal = (animal) => animal.phase === 'alive' || animal.phase === 'dying';
const dynamicActors = (room, except) =>
  [
    ...room.players.values(),
    ...(room.animals || []).filter(solidAnimal),
    ...(room.enemies || []).filter(enemyIsSolid),
    ...(room.residents || []),
  ]
    .filter((actor) => actor !== except && !actor.carrierId)
    .map(circle);
// 2026-09-12: the castle sorcerer is an indoor enemy. Its ground is one level
// of the keep (since 2026-09-13 the middle terrace, tier 3); it never notices,
// chases or follows a player who is not standing on that level, and its own
// steps are undone if one would carry it off it (down a stair or over an edge).
export const inSorcererHall = (point) =>
  castleTierOfHeight(CASTLE_SURFACE.height(point.x, point.z)) === 3;
// 2026-09-13: every castle rank has its own ward (forecourt, stair heads, hall,
// altar); a castle crow never notices, follows or steps outside it.
const onOwnGround = (enemy, point) => !enemy.castle || inCrowWard(enemy, point);
const withinStaffReach = (enemy, player) =>
  combatDistance(enemy, player) <=
  enemy.radius + player.radius + crowRules(enemy).attackReach + 1e-9;
const approachFlight = (enemy, dt, target) => {
  const rules = crowRules(enemy);
  if (!rules.flying) {
    enemy.airborneHeight = 0;
    return true;
  }
  const speed = target < (enemy.airborneHeight || 0) ? 5.5 : 2.4;
  enemy.airborneHeight = Math.max(
    0,
    Math.min(
      rules.flightHeight,
      (enemy.airborneHeight || 0) +
        Math.sign(target - (enemy.airborneHeight || 0)) *
          Math.min(Math.abs(target - (enemy.airborneHeight || 0)), speed * dt),
    ),
  );
  return Math.abs(enemy.airborneHeight - target) < 0.08;
};
const eligiblePlayer = (room, player, now) =>
  player &&
  !player.mountId &&
  !player.boatId &&
  !player.carrierId &&
  !player.downedUntil &&
  now >= (player.invulnerableUntil || 0) &&
  combatDistance(player, room.camp || CAMP) > ENEMY_RULES.campSafeRadius;
const clearLine = (room, a, b) =>
  Math.abs((room.collision.surfaceHeight?.(a) ?? 0) - (room.collision.surfaceHeight?.(b) ?? 0)) <=
    1.4 && room.collision.segmentFree(a, b, 0.12);

export function createEnemies(collision, dynamic = [], now = Date.now()) {
  const enemies = ENEMY_GROUNDS.map((ground) => {
    const rules = crowRules(ground);
    const position = collision.nearestFree(
      ground,
      rules.radius,
      dynamic.map(circle),
      ground.roamRadius,
    );
    if (!position) throw new Error(`No safe enemy spawn for ${ground.id}`);
    return {
      id: ground.id,
      modelKey: ENEMY_RULES.modelKey,
      name: ground.name ?? rules.name,
      crowRole: ground.crowRole ?? 'shaman',
      regionId: ground.regionId,
      hostile: true,
      ...position,
      home: { ...position },
      castle: !ground.regionId,
      tier: rules.tier,
      sealed: false,
      radius: rules.radius,
      scale: rules.scale,
      phase: 'alive',
      phaseStartedAt: now,
      alive: true,
      health: ground.maxHealth ?? rules.maxHealth,
      maxHealth: ground.maxHealth ?? rules.maxHealth,
      facing: 0,
      speed: 0,
      moving: false,
      running: false,
      runningRequested: false,
      clip: 'Idle_Loop',
      behavior: 'roam',
      dx: 0,
      dz: 0,
      lastInput: 0,
      target: null,
      path: [],
      targetId: null,
      roamRadius: ground.roamRadius,
      roamIndex: 0,
      nextRoamAt: now + 1000,
      nextPathAt: 0,
      pathGoal: null,
      returning: false,
      attackSequence: 0,
      attackAt: 0,
      attackLockUntil: 0,
      pendingAttack: null,
      hitSequence: 0,
      hitAt: 0,
      hitUntil: 0,
      hitDurationMs: ENEMY_RULES.hitDurationMs,
      aggroAfter: now + 1000,
      nextBoltAt: 0,
      nextBurstAt: 0,
      elevation: 0,
      airborneHeight: 0,
    };
  });
  const behemoth = createBehemoth(collision, [...dynamic, ...enemies], now);
  return [
    ...enemies,
    behemoth,
    createSabertooth(collision, [...dynamic, ...enemies, behemoth], now),
  ];
}

function recoverPlayers(room, now, notify) {
  let changed = false;
  for (const player of room.players.values()) {
    if (!player.downedUntil || now < player.downedUntil) continue;
    const camp = room.camp || CAMP;
    const spawn = room.collision.nearestFree(
      { x: camp.x - 1, z: camp.z + 3 },
      player.radius,
      dynamicActors(room, player),
      8,
    );
    if (!spawn) {
      player.downedUntil = now + 500;
      continue;
    }
    Object.assign(player, spawn);
    stopActor(player);
    player.downedUntil = 0;
    player.energy = room.rules?.recoveryEnergy ?? ENEMY_RULES.recoveryEnergy;
    player.invulnerableUntil = now + ENEMY_RULES.protectionMs;
    player.pendingStrike = null;
    player.cookingEndsAt = 0;
    changed = true;
    notify(
      player,
      `焚き火のそばで回復しました。元気${player.energy}、持ち物はそのままです。`,
      'success',
    );
  }
  return changed;
}

function hitPlayer(room, enemy, player, now, notify, damage?: number, label = '杖') {
  damage ??= crowRules(enemy).attackDamage;
  damage = incomingDamage(player, damage);
  player.energy = Math.max(0, player.energy - damage);
  player.hurtSequence = (player.hurtSequence || 0) + 1;
  player.hurtAt = now;
  player.cookingEndsAt = 0;
  if (player.energy > 0) {
    notify(player, `${enemy.name}の${label}が命中。元気 -${damage}`, 'error', false);
    return;
  }
  stopActor(player);
  player.pendingStrike = null;
  player.downedUntil = now + ENEMY_RULES.recoveryMs;
  player.defeatSequence = (player.defeatSequence || 0) + 1;
  notify(player, '力尽きました。4秒後に焚き火で回復します。持ち物は失いません。', 'error', false);
}

// A red hex bolt in flight: the sorcerer's straight single-target spell. Kept
// apart from player orbs (whose owner must be a player) and shown by the same
// renderer through the snapshot's projectile list.
function launchBolt(room, enemy, target, now) {
  const rules = crowRules(enemy);
  const dx = target.x - enemy.x,
    dz = target.z - enemy.z,
    d = Math.hypot(dx, dz) || 1;
  room.hexBolts ??= [];
  room.hexBolts.push({
    id: `${enemy.id}:${enemy.attackSequence}`,
    ownerId: enemy.id,
    hostile: true,
    kind: 'hex',
    x: enemy.x,
    z: enemy.z,
    dx: dx / d,
    dz: dz / d,
    speed: rules.boltSpeed,
    reach: rules.boltReach,
    radius: rules.boltRadius,
    damage: rules.boltDamage,
    elevation: room.collision.surfaceHeight?.(enemy) ?? 0,
    createdAt: now,
    updatedAt: now,
    travelled: 0,
  });
}
function updateHexBolts(room, now, notify) {
  let changed = false;
  const remaining = [];
  room.projectileImpacts = (room.projectileImpacts || []).filter((effect) => now - effect.at < 600);
  for (const bolt of room.hexBolts || []) {
    const caster = (room.enemies || []).find((e) => e.id === bolt.ownerId);
    if (!caster || caster.phase !== 'alive') continue;
    const travel = Math.min(
      (bolt.reach ?? ENEMY_RULES.boltReach) - bolt.travelled,
      (Math.max(0, now - bolt.updatedAt) * bolt.speed) / 1000,
    );
    const end = { x: bolt.x + bolt.dx * travel, z: bolt.z + bolt.dz * travel };
    const radius = bolt.radius ?? ENEMY_RULES.boltRadius;
    const wall = projectileWallEntry(room.collision, bolt, end, radius);
    const hit = [...room.players.values()]
      .filter((player) => eligiblePlayer(room, player, now))
      .map((player) => ({
        player,
        t: circleEntry(bolt, end, player, player.radius + radius),
      }))
      .filter(
        ({ player, t }) =>
          Number.isFinite(t) &&
          t < wall &&
          Math.abs(bolt.elevation - (room.collision.surfaceHeight?.(player) ?? 0)) <= 1.4,
      )
      .sort((a, b) => a.t - b.t)[0];
    const t = hit?.t ?? wall;
    if (Number.isFinite(t)) {
      room.projectileImpacts.push({
        id: bolt.id,
        x: bolt.x + (end.x - bolt.x) * t,
        z: bolt.z + (end.z - bolt.z) * t,
        elevation: bolt.elevation,
        at: now,
        hit: !!hit,
        kind: 'hex',
      });
      if (hit)
        hitPlayer(
          room,
          caster,
          hit.player,
          now,
          notify,
          bolt.damage ?? ENEMY_RULES.boltDamage,
          '赤い呪弾',
        );
      changed = true;
      continue;
    }
    Object.assign(bolt, end, { updatedAt: now, travelled: bolt.travelled + travel });
    if (bolt.travelled < (bolt.reach ?? ENEMY_RULES.boltReach)) remaining.push(bolt);
    else changed = true;
  }
  room.hexBolts = remaining;
  // Detonated or expired ring telegraphs linger briefly for the renderer's flash.
  room.hexBursts = (room.hexBursts || []).filter((burst) => now - burst.at < 800);
  return changed;
}
function beginSpell(room, enemy, target, now, kind) {
  const rules = crowRules(enemy),
    windup = kind === 'bolt' ? rules.boltWindupMs : rules.burstWindupMs;
  stopActor(enemy);
  enemy.facing = Math.atan2(target.x - enemy.x, target.z - enemy.z);
  enemy.attackAt = now;
  enemy.attackSequence++;
  enemy.attackLockUntil = now + windup;
  enemy.pendingAttack = {
    kind,
    targetId: target.id,
    impactAt: now + windup,
    facing: enemy.facing,
    damage: kind === 'bolt' ? rules.boltDamage : rules.burstDamage,
    radius: rules.burstRadius,
  };
  enemy.clip = 'Attack';
  enemy.behavior = kind;
  if (kind === 'bolt') enemy.nextBoltAt = now + rules.boltCooldownMs;
  else {
    enemy.nextBurstAt = now + rules.burstCooldownMs;
    room.hexBursts ??= [];
    room.hexBursts.push({
      id: `${enemy.id}:${enemy.attackSequence}`,
      ownerId: enemy.id,
      x: enemy.x,
      z: enemy.z,
      elevation: room.collision.surfaceHeight?.(enemy) ?? 0,
      radius: rules.burstRadius,
      startedAt: now,
      at: now + windup,
      detonatedAt: null,
    });
  }
}
function plan(enemy, room, goal, now) {
  if (now < enemy.nextPathAt && (enemy.target || enemy.path.length)) return;
  if (!onOwnGround(enemy, goal)) {
    // Walk toward the goal only as far as the hall floor reaches.
    let inside = { x: enemy.x, z: enemy.z };
    for (let t = 0.05; t <= 1; t += 0.05) {
      const p = { x: enemy.x + (goal.x - enemy.x) * t, z: enemy.z + (goal.z - enemy.z) * t };
      if (!onOwnGround(enemy, p)) break;
      inside = p;
    }
    goal = inside;
  }
  enemy.path = room.collision.path(enemy, goal, enemy.radius);
  if (enemy.castle) enemy.path = enemy.path.filter((point) => onOwnGround(enemy, point));
  enemy.target = enemy.path.shift() || null;
  enemy.pathGoal = { x: goal.x, z: goal.z };
  enemy.nextPathAt = now + 500;
}
function moveEnemy(enemy, room, dt, now, speed) {
  if (!enemy.target) enemy.target = enemy.path.shift() || null;
  enemy.runningRequested = speed > crowRules(enemy).roamSpeed;
  const before = { x: enemy.x, z: enemy.z };
  moveActor(
    enemy,
    dt,
    Infinity,
    (actor, dx, dz) => room.collision.move(actor, dx, dz, enemy.radius, dynamicActors(room, enemy)),
    speed,
  );
  if (!onOwnGround(enemy, enemy)) {
    Object.assign(enemy, before);
    stopActor(enemy);
    enemy.target = null;
    enemy.path = [];
    enemy.nextPathAt = now + 500;
  }
  enemy.clip = enemy.moving ? (enemy.running ? 'Run_Loop' : 'Walk_Loop') : 'Idle_Loop';
}

const isCastleCrow = (enemy) => enemy.castle && enemy.modelKey === ENEMY_RULES.modelKey;
const notifyCastle = (room, notify, text, tone = 'info') => {
  for (const player of room.players.values())
    if (nearCastle(player.x, player.z, 12)) notify(player, text, tone, true);
};
// The staged assault. The lowest rank with a member still standing is "open";
// every rank above it prays behind the seal (cannot be hurt, does not fight).
// When a rank falls the players in the keep are told which rank rises next,
// and when the pontiff falls the whole congregation re-forms together after
// the ordinary respawn delay.
function updateCastleRite(room, now, notify) {
  const crows = (room.enemies || []).filter(isCastleCrow);
  if (!crows.length) return false;
  const standing = crows.filter((enemy) => enemy.phase === 'alive');
  const openTier = standing.length ? Math.min(...standing.map(crowTier)) : 6;
  for (const enemy of crows) enemy.sealed = enemy.phase === 'alive' && crowTier(enemy) > openTier;
  const rite = (room.crowRite ??= { openTier: null, endedAt: null });
  const previous = rite.openTier;
  if (previous === openTier) return false;
  rite.openTier = openTier;
  if (previous === null) return true;
  if (openTier > previous) {
    notifyCastle(room, notify, CROW_RITE_TEXT[openTier], openTier === 6 ? 'success' : 'error');
    if (openTier === 6) {
      rite.endedAt = now;
      for (const enemy of crows) if (enemy.phase === 'respawning') enemy.phaseStartedAt = now;
    }
  } else {
    // A fallen rank has returned: the seal closes again above it.
    if (previous === 6) notifyCastle(room, notify, CROW_RITE_TEXT.reform);
    rite.endedAt = null;
  }
  return true;
}

export function updateEnemies(
  room,
  dt,
  now = Date.now(),
  notify = (_player, _text: string, _tone?: string, _popup?: boolean) => {},
) {
  let changed = recoverPlayers(room, now, notify);
  if (updateCastleRite(room, now, notify)) changed = true;
  for (const enemy of room.enemies || []) {
    // Generic combat also supports other hostile types, whose own AI owns them.
    if (enemy.modelKey !== ENEMY_RULES.modelKey) continue;
    const rules = crowRules(enemy);
    if (enemy.phase === 'dead') {
      approachFlight(enemy, dt, 0);
      stopActor(enemy);
      enemy.pendingAttack = null;
      enemy.clip = 'Death';
      enemy.behavior = 'dead';
      if (now - enemy.phaseStartedAt >= ENEMY_RULES.deathDurationMs) {
        enemy.phase = 'respawning';
        enemy.phaseStartedAt = now;
        enemy.clip = null;
        enemy.behavior = 'respawning';
        changed = true;
      }
      continue;
    }
    if (enemy.phase === 'respawning') {
      // A fallen castle rank stays fallen while players hold the keep and the
      // pontiff still stands; the clock only runs once the keep is empty (or
      // the rite has ended), so a cleared rank is not refilled mid-assault.
      if (isCastleCrow(enemy) && room.crowRite?.endedAt == null && castleOccupied(room)) {
        enemy.phaseStartedAt = now;
        continue;
      }
      if (now - enemy.phaseStartedAt < respawnDelay(room, ENEMY_RULES.respawnMs)) continue;
      const spawn = room.collision.nearestFree(
        enemy.home,
        enemy.radius,
        dynamicActors(room, enemy),
        enemy.roamRadius,
      );
      if (!spawn || !onOwnGround(enemy, spawn)) continue;
      Object.assign(enemy, spawn, {
        phase: 'alive',
        phaseStartedAt: now,
        alive: true,
        health: enemy.maxHealth,
        targetId: null,
        returning: false,
        clip: 'Idle_Loop',
        behavior: 'roam',
        hitUntil: 0,
        attackLockUntil: 0,
        pendingAttack: null,
        nextRoamAt: now + 1000,
        aggroAfter: now + 1000,
        airborneHeight: 0,
      });
      stopActor(enemy);
      changed = true;
      continue;
    }
    if (enemy.sealed) {
      // Praying behind the seal: grounded, still, facing the altar, blind to
      // everyone until the rank below has fallen.
      approachFlight(enemy, dt, 0);
      stopActor(enemy);
      enemy.pendingAttack = null;
      enemy.attackLockUntil = 0;
      enemy.targetId = null;
      enemy.returning = false;
      enemy.provokedBy = null;
      enemy.facing = Math.atan2(CROW_ALTAR.x - enemy.x, CROW_ALTAR.z - enemy.z);
      enemy.clip = 'Idle_Loop';
      enemy.behavior = 'pray';
      enemy.aggroAfter = now + 1500;
      enemy.nextRoamAt = now + 1500;
      enemy.elevation = room.collision.surfaceHeight?.(enemy) ?? 0;
      continue;
    }
    if (now < enemy.hitUntil) {
      approachFlight(enemy, dt, rules.flightHeight);
      stopActor(enemy);
      enemy.clip = 'Hit';
      enemy.behavior = 'hit';
      continue;
    }
    enemy.elevation = room.collision.surfaceHeight?.(enemy) ?? 0;
    if (enemy.pendingAttack && now >= enemy.pendingAttack.impactAt) {
      const strike = enemy.pendingAttack;
      enemy.pendingAttack = null;
      const player = room.players.get(strike.targetId);
      if (strike.kind === 'bolt') {
        // Fired straight at where the target stands on release; moving after
        // the staff comes down makes it miss.
        if (player && !player.downedUntil) launchBolt(room, enemy, player, now);
        changed = true;
      } else if (strike.kind === 'burst') {
        const burst = (room.hexBursts || []).find(
          (b) => b.id === `${enemy.id}:${enemy.attackSequence}`,
        );
        if (burst) burst.detonatedAt = now;
        for (const p of room.players.values())
          if (
            eligiblePlayer(room, p, now) &&
            combatDistance(enemy, p) <= (strike.radius ?? rules.burstRadius) + p.radius &&
            clearLine(room, enemy, p)
          )
            hitPlayer(
              room,
              enemy,
              p,
              now,
              notify,
              strike.damage ?? rules.burstDamage,
              '赤い呪いの爆発',
            );
        changed = true;
      } else if (
        eligiblePlayer(room, player, now) &&
        withinStaffReach(enemy, player) &&
        inAttackArc(enemy, player, strike.facing) &&
        clearLine(room, enemy, player)
      ) {
        hitPlayer(room, enemy, player, now, notify, strike.damage);
        changed = true;
      }
    }
    if (now < enemy.attackLockUntil) {
      approachFlight(enemy, dt, enemy.behavior === 'attack' ? 0 : rules.flightHeight);
      stopActor(enemy);
      enemy.clip = 'Attack';
      if (!['bolt', 'burst'].includes(enemy.behavior)) enemy.behavior = 'attack';
      continue;
    }
    let target = room.players.get(enemy.targetId);
    if (
      enemy.targetId &&
      (!eligiblePlayer(room, target, now) ||
        !onOwnGround(enemy, target) ||
        combatDistance(target, enemy.home) > rules.leashRadius ||
        combatDistance(target, enemy) > rules.loseTargetRange ||
        combatDistance(enemy, enemy.home) > rules.leashRadius)
    ) {
      enemy.targetId = null;
      target = null;
      enemy.returning = true;
      stopActor(enemy);
      enemy.nextPathAt = 0;
    }
    if (enemy.returning) {
      approachFlight(enemy, dt, rules.flightHeight);
      enemy.behavior = 'return';
      if (combatDistance(enemy, enemy.home) < 0.15) {
        enemy.returning = false;
        stopActor(enemy);
        enemy.nextRoamAt = now + 1000;
        enemy.clip = 'Idle_Loop';
      } else {
        plan(enemy, room, enemy.home, now);
        moveEnemy(enemy, room, dt, now, rules.chaseSpeed);
      }
      continue;
    }
    // A hit from outside the notice range (a spell from ten metres) still gives the caster away.
    if (!target) {
      target = provoker(
        room,
        enemy,
        (player) =>
          eligiblePlayer(room, player, now) &&
          onOwnGround(enemy, player) &&
          combatDistance(player, enemy.home) <= rules.leashRadius,
      );
      if (target) {
        enemy.targetId = target.id;
        stopActor(enemy);
        enemy.nextPathAt = 0;
        changed = true;
      }
    }
    if (!target && now >= enemy.aggroAfter) {
      target = [...room.players.values()]
        .filter(
          (player) =>
            eligiblePlayer(room, player, now) &&
            onOwnGround(enemy, player) &&
            combatDistance(player, enemy.home) <= rules.leashRadius &&
            combatDistance(player, enemy) <= rules.aggroRange &&
            clearLine(room, enemy, player),
        )
        .sort((a, b) => combatDistance(enemy, a) - combatDistance(enemy, b))[0];
      if (target) {
        enemy.targetId = target.id;
        stopActor(enemy);
        enemy.nextPathAt = 0;
        changed = true;
      }
    }
    if (target) {
      const sight = clearLine(room, enemy, target),
        d = combatDistance(enemy, target);
      if (
        rules.magic &&
        !withinStaffReach(enemy, target) &&
        sight &&
        d <= rules.burstRange &&
        now >= enemy.nextBurstAt
      ) {
        approachFlight(enemy, dt, rules.flightHeight);
        beginSpell(room, enemy, target, now, 'burst');
        changed = true;
      } else if (
        rules.magic &&
        !withinStaffReach(enemy, target) &&
        sight &&
        d >= rules.boltMinRange &&
        d <= rules.boltRange &&
        now >= enemy.nextBoltAt
      ) {
        approachFlight(enemy, dt, rules.flightHeight);
        beginSpell(room, enemy, target, now, 'bolt');
        changed = true;
      } else if (rules.physical && withinStaffReach(enemy, target) && sight) {
        // Flying prelates telegraph their physical option by dropping to the
        // floor before starting the same authoritative close-range strike.
        if (!approachFlight(enemy, dt, 0)) {
          stopActor(enemy);
          enemy.facing = Math.atan2(target.x - enemy.x, target.z - enemy.z);
          enemy.clip = 'Idle_Loop';
          enemy.behavior = 'dive';
          continue;
        }
        stopActor(enemy);
        enemy.facing = Math.atan2(target.x - enemy.x, target.z - enemy.z);
        enemy.clip = 'Idle_Loop';
        enemy.behavior = 'chase';
        if (!enemy.attackSequence || now - enemy.attackAt >= rules.attackCooldownMs) {
          enemy.attackAt = now;
          enemy.attackSequence++;
          enemy.attackLockUntil = now + rules.attackDurationMs;
          enemy.pendingAttack = {
            targetId: target.id,
            impactAt: now + rules.attackImpactMs,
            facing: enemy.facing,
            damage: rules.attackDamage,
          };
          enemy.clip = 'Attack';
          enemy.behavior = 'attack';
          changed = true;
        }
      } else {
        approachFlight(enemy, dt, rules.flightHeight);
        enemy.behavior = 'chase';
        plan(enemy, room, target, now);
        moveEnemy(enemy, room, dt, now, enemyMovementSpeed(target, rules.chaseSpeed));
      }
      continue;
    }
    enemy.behavior = 'roam';
    approachFlight(enemy, dt, rules.flightHeight);
    if (!enemy.target && !enemy.path.length && now >= enemy.nextRoamAt) {
      const angle = ++enemy.roamIndex * 2.39996;
      plan(
        enemy,
        room,
        {
          x: enemy.home.x + Math.sin(angle) * enemy.roamRadius,
          z: enemy.home.z + Math.cos(angle) * enemy.roamRadius,
        },
        now,
      );
      enemy.nextRoamAt = now + 2500;
    }
    moveEnemy(enemy, room, dt, now, rules.roamSpeed);
  }
  const strike = (enemy, player, time, damage, label) =>
    hitPlayer(room, enemy, player, time, notify, damage, label);
  const bolts = updateHexBolts(room, now, notify);
  const behemoths = updateBehemoths(room, dt, now, strike);
  return updateSabertooths(room, dt, now, strike) || behemoths || bolts || changed;
}
