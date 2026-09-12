import { BEHEMOTH as R } from './behemoth-rules.mjs';
import { circleEntry, projectileWallEntry } from './combat.mjs';
import { projectileHeight } from './terrain.mjs';

// Exact ballistic point shared by the server and the liquid renderer. y is an
// absolute world height; it must not follow the terrain underneath the droplet.
export function poisonPoint(shot, seconds) {
  return {
    x: shot.originX + shot.vx * seconds,
    y: shot.originY + shot.vy * seconds - 0.5 * R.spitGravity * seconds * seconds,
    z: shot.originZ + shot.vz * seconds,
  };
}

export function launchPoison(room, enemy, aim, now) {
  room.poisonShots ??= [];
  const originX = enemy.x + Math.sin(enemy.facing) * R.mouthForward * enemy.scale,
    originZ = enemy.z + Math.cos(enemy.facing) * R.mouthForward * enemy.scale,
    originY =
      projectileHeight(enemy.x, enemy.z, room.collision.surfaceHeight?.(enemy) ?? 0) +
      R.mouthHeight * enemy.scale;
  // The mouth must never spawn liquid on the other side of a nearby wall.
  if (!room.collision.segmentFree(enemy, { x: originX, z: originZ }, R.spitRadius)) return;
  const d = Math.hypot(aim.x - originX, aim.z - originZ),
    seconds = Math.max(0.12, d / R.spitSpeed),
    targetY = aim.y;
  const shot = {
    id: `${enemy.id}:poison:${enemy.attackSequence}`,
    ownerId: enemy.id,
    originX,
    originY,
    originZ,
    vx: (aim.x - originX) / seconds,
    vz: (aim.z - originZ) / seconds,
    vy: (targetY - originY + 0.5 * R.spitGravity * seconds * seconds) / seconds,
    createdAt: now,
    updatedAt: now,
    expiresAt: now + 2400,
    x: originX,
    y: originY,
    z: originZ,
  };
  room.poisonShots.push(shot);
}

export function updatePoison(room, now, damage, eligible) {
  room.poisonSplashes = (room.poisonSplashes ?? []).filter((s) => now - s.at < 850);
  const remaining = [];
  let changed = false;
  for (const shot of room.poisonShots ?? []) {
    const caster = room.enemies.find((e) => e.id === shot.ownerId);
    if (!caster || caster.phase !== 'alive' || caster.returning) {
      changed = true;
      continue;
    }
    let hit = false;
    const until = Math.min(now, shot.expiresAt);
    // Swept 10 ms segments bound gravity and prevent tunnelling on delayed ticks.
    while (shot.updatedAt < until && !hit) {
      const endAt = Math.min(until, shot.updatedAt + 10),
        end = poisonPoint(shot, (endAt - shot.createdAt) / 1000),
        wall = projectileWallEntry(room.collision, shot, end, R.spitRadius);
      let impact = wall,
        victim = null;
      for (const p of room.players.values()) {
        if (!eligible(room, caster, p, now)) continue;
        const t = circleEntry(shot, end, p, p.radius + R.spitRadius);
        if (!Number.isFinite(t) || t >= impact) continue;
        const y = shot.y + (end.y - shot.y) * t,
          floor = projectileHeight(p.x, p.z, room.collision.surfaceHeight?.(p) ?? 0),
          height = p.species === 'bear' ? 0.85 : p.species === 'ape' ? 2.15 : 1.85;
        if (y + R.spitRadius < floor || y - R.spitRadius > floor + height) continue;
        impact = t;
        victim = p;
      }
      const floor = projectileHeight(end.x, end.z, room.collision.surfaceHeight?.(end) ?? 0);
      if (end.y <= floor + R.spitRadius * 0.4 && !Number.isFinite(impact)) impact = 1;
      if (Number.isFinite(impact)) {
        const x = shot.x + (end.x - shot.x) * impact,
          z = shot.z + (end.z - shot.z) * impact,
          y = Math.max(floor + 0.03, shot.y + (end.y - shot.y) * impact);
        const impactPoint = { x, z },
          elevation = room.collision.surfaceHeight?.(impactPoint) ?? 0;
        room.poisonSplashes.push({
          id: shot.id,
          x,
          y,
          z,
          floorY: floor,
          radius: R.spitSplashRadius,
          at: endAt,
          hit: !!victim,
        });
        // One liquid impact damages each exposed player once, including the
        // direct victim. Splash cannot pass through a wall or reach another floor.
        for (const p of room.players.values()) {
          if (!eligible(room, caster, p, now)) continue;
          const direct = p === victim;
          if (
            !direct &&
            (Math.hypot(p.x - x, p.z - z) > R.spitSplashRadius + p.radius ||
              Math.abs(elevation - (room.collision.surfaceHeight?.(p) ?? 0)) > 1.4 ||
              !room.collision.segmentFree(impactPoint, p, 0.12))
          )
            continue;
          damage(caster, p, now, R.spitDamage, '毒液');
        }
        changed = true;
        hit = true;
      } else Object.assign(shot, end, { updatedAt: endAt });
    }
    if (!hit && now < shot.expiresAt) remaining.push(shot);
    else changed = true;
  }
  room.poisonShots = remaining;
  return changed;
}
