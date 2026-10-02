import type { Point } from './types.mjs';
import type { PlayerSnapshot } from './snapshots.mjs';
import type { CollisionWorld } from './collision.mjs';
import { walkHeight, riverX, riverHalfWidth, WATER_LEVEL } from './terrain.mjs';
import { mountainWaterHeight } from './mountain-river.mjs';
import { characterModel } from './characters.mjs';
import { attackProfile } from './combat-profiles.mjs';
import { jumpProgress } from './jumping.mjs';
import { COMPANION_524, syncCompanion524Bot } from './companion-524.mjs';
import type { Companion524 } from './companion-524-types.mjs';
import type { BotKind, BotMode, OrbBot, OrbBotSnapshot } from './orb-bot-types.mjs';
export type { BotKind, BotMode, OrbBot, OrbBotSnapshot } from './orb-bot-types.mjs';

export const BOT_KINDS = [
  'white',
  'blue',
  'green',
  'purple',
  'orange',
  'beret',
  'frog',
  'triangle',
  'heart',
] as const;
export const BOT_ORDER: readonly BotKind[] = [...BOT_KINDS, '524'];
export const BOT_DESIGNS = {
  '524': { name: '524', face: '524', color: '#ffdf58' },
  white: { name: 'しろbot', face: '＾＾', color: '#f5f3ee' },
  blue: { name: 'あおbot', face: '＞＜', color: '#1172ef' },
  green: { name: 'みどりbot', face: '＋＋', color: '#18b653' },
  purple: { name: 'むらさきbot', face: '○○', color: '#a23ee8' },
  orange: { name: 'オレンジbot', face: '－－', color: '#f58b28' },
  beret: {
    name: 'ベレーbot',
    face: '••',
    color: '#148aff',
    image: '/models/orb-bot-beret/portrait.png',
  },
  frog: {
    name: 'かえるbot',
    face: '●●',
    color: '#b4e517',
    image: '/models/orb-bot-frog/portrait.png',
  },
  triangle: {
    name: 'さんかくbot',
    face: '◡◡',
    color: '#ffce19',
    image: '/models/orb-bot-triangle/portrait.png',
  },
  heart: {
    name: 'ハートbot',
    face: '●●',
    color: '#ff20b3',
    image: '/models/orb-bot-heart/portrait.png',
  },
} as const;
export const ORB_BOTS = Object.freeze({
  diameter: 0.28,
  radius: 0.14,
  pickupRange: 3,
  windupMs: 260,
  pickupMs: 120,
  throwIntervalMs: 360,
  followThroughMs: 300,
  callMs: 1100,
  flightMs: 900,
  landMs: 420,
  catchMs: 300,
  throwDistance: 8,
  arcHeight: 2,
  speed: 8.5,
});
type BotRoom = {
  orbBots?: OrbBot[];
  players: Map<string, PlayerSnapshot>;
  collision: CollisionWorld;
  rimoNeko?: { petPlayerId: string | null };
  companion524?: Companion524;
};
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const point = (p: Point): Point => ({ x: p.x, z: p.z });
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export const botRadius = (kind: BotKind) =>
  kind === '524' ? COMPANION_524.radius : ORB_BOTS.radius;
export const botHandOffset = (kind: BotKind) => (kind === '524' ? COMPANION_524.bodyHeight / 2 : 0);
export const botRestHeight = (kind: BotKind, x: number, z: number) =>
  botGroundHeight(x, z) + (kind === '524' ? COMPANION_524.hoverHeight : 0);
export function ownedBotKinds(
  bots: readonly OrbBotSnapshot[],
  ownerId?: string,
): readonly BotKind[] {
  return bots.some((b) => b.kind === '524' && b.ownerId === ownerId) ? BOT_ORDER : BOT_KINDS;
}

/** Round companions float with their lower 6 cm in traversable river/lake water. */
export function botGroundHeight(x: number, z: number) {
  const inRiver = riverHalfWidth(z) > 0.7 && Math.abs(x - riverX(z)) < riverHalfWidth(z);
  return Math.max(
    walkHeight(x, z),
    mountainWaterHeight(x, z) - 0.06,
    inRiver ? WATER_LEVEL - 0.06 : -Infinity,
  );
}

export function canHandleBot(p: PlayerSnapshot | undefined | null, now: number) {
  return (
    !!p &&
    !p.downedUntil &&
    !p.mountId &&
    !p.boatId &&
    !p.carrierId &&
    !p.passengerId &&
    !p.cookingEndsAt &&
    !p.fishing &&
    !p.coastalActivity &&
    jumpProgress(p, now) === null &&
    !(p.attackSequence > 0 && now - p.attackAt < attackProfile(p).durationMs)
  );
}

/** One shared target for the hand pose and authoritative release origin. */
export function botHandPosition(p: PlayerSnapshot, floor = walkHeight(p.x, p.z)) {
  const height =
    characterModel(p).height ?? (p.species === 'bear' ? 0.78 : p.species === 'ape' ? 3.2 : 1.68);
  const side = height * (p.species === 'maruimo' ? 0.2 : p.species === 'bear' ? 0.18 : 0.14),
    front = height * (p.species === 'bear' ? 0.14 : p.species === 'maruimo' ? 0.25 : 0.22);
  return {
    x: p.x + Math.cos(p.facing) * side + Math.sin(p.facing) * front,
    y: floor + height * (p.species === 'maruimo' ? 0.53 : p.species === 'bear' ? 0.55 : 0.76),
    z: p.z - Math.sin(p.facing) * side + Math.cos(p.facing) * front,
  };
}

function formation(p: PlayerSnapshot, kind: BotKind, count: number): Point {
  const i = BOT_ORDER.indexOf(kind),
    row = Math.floor(i / 5),
    rowSize = Math.min(5, count - row * 5),
    column = (i % 5) - (rowSize - 1) / 2,
    side = column * 0.4,
    behind = p.radius + 0.9 + row * 0.48 + Math.abs(column) * 0.15;
  return {
    x: p.x + Math.cos(p.facing) * side - Math.sin(p.facing) * behind,
    z: p.z - Math.sin(p.facing) * side - Math.cos(p.facing) * behind,
  };
}

/** A free spot behind a fire/wall is not a usable reunion. Keep the owner in reach. */
function formationPoint(room: BotRoom, p: PlayerSnapshot, kind: BotKind) {
  const count = room.companion524?.squadPlayerId === p.id ? BOT_ORDER.length : BOT_KINDS.length;
  const bodyRadius = botRadius(kind);
  const desired = formation(p, kind, count);
  const first = room.collision.nearestFree(desired, bodyRadius, [], 1);
  if (first && room.collision.segmentFree(p, first, bodyRadius)) return first;
  const i = BOT_ORDER.indexOf(kind),
    row = Math.floor(i / 5),
    rowSize = Math.min(5, count - row * 5),
    radius = p.radius + 0.65 + row * 0.42;
  for (const offset of [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8, Math.PI]) {
    const a = p.facing + Math.PI + offset + ((i % 5) - (rowSize - 1) / 2) * 0.18;
    const q = { x: p.x + Math.sin(a) * radius, z: p.z + Math.cos(a) * radius };
    if (room.collision.free(q, bodyRadius) && room.collision.segmentFree(p, q, bodyRadius))
      return q;
  }
  return room.collision.nearestFree(p, bodyRadius, [], 2);
}

/** Nine base bots per connection; the existing 524 joins one squad after a complete pet. */
export function syncOrbBots(room: BotRoom, now: number) {
  const c = room.companion524;
  room.orbBots = (room.orbBots ?? []).filter((b) =>
    b.kind === '524'
      ? !!c?.squadPlayerId && room.players.has(c.squadPlayerId)
      : room.players.has(b.ownerId),
  );
  for (const p of room.players.values())
    for (const kind of c?.squadPlayerId === p.id ? BOT_ORDER : BOT_KINDS) {
      const existing = room.orbBots.find(
        (b) => b.kind === kind && (kind === '524' || b.ownerId === p.id),
      );
      if (existing) {
        if (kind === '524' && c) {
          if (existing.ownerId !== p.id) {
            existing.ownerId = p.id;
            existing.recall = false;
            existing.recallAt = existing.throwAt = 0;
            existing.origin = existing.landing = null;
            existing.lastOwner = point(p);
            existing.warpSequence = p.warpSequence ?? 0;
            setMode(existing, 'following', now);
          }
          existing.busy =
            !!c.petPlayerId || (c.hitSequence > 0 && now - c.hitAt < COMPANION_524.hitMs);
        }
        continue;
      }
      const start = kind === '524' && c ? point(c) : formationPoint(room, p, kind);
      if (!start) continue;
      room.orbBots.push({
        id: kind === '524' ? 'orb:companion-524' : `orb:${p.id}:${kind}`,
        ownerId: p.id,
        kind,
        mode: 'following',
        ...start,
        y: botRestHeight(kind, start.x, start.z),
        facing: p.facing,
        speed: 0,
        phaseAt: now,
        throwAt: 0,
        sequence: 0,
        origin: null,
        landing: null,
        landingY: 0,
        recall: false,
        recallAt: 0,
        path: [],
        nextPathAt: 0,
        lastOwner: point(p),
        warpSequence: p.warpSequence ?? 0,
        stuckAt: 0,
        ...(kind === '524' ? { busy: false } : {}),
      });
    }
}

export function orbBotSnapshots(room: BotRoom): OrbBotSnapshot[] {
  return (room.orbBots ?? [])
    .filter((b) => room.players.has(b.ownerId))
    .map(({ path, nextPathAt, lastOwner, warpSequence, stuckAt, ...b }) => ({
      ...b,
      origin: b.origin ? { ...b.origin } : null,
      landing: b.landing ? { ...b.landing } : null,
    }));
}

/** Start at the chosen kind, then skip companions already deployed or reserved. */
export function nextOrbBot<T extends OrbBotSnapshot>(
  bots: readonly T[],
  p: PlayerSnapshot,
  preferred: BotKind = 'white',
  reachable: (b: T) => boolean = () => true,
): T | undefined {
  const kinds = ownedBotKinds(bots, p.id);
  const first = Math.max(0, kinds.indexOf(preferred));
  for (let offset = 0; offset < kinds.length; offset++) {
    const kind = kinds[(first + offset) % kinds.length];
    const bot = bots.find((b) => b.ownerId === p.id && b.kind === kind);
    if (
      bot &&
      !bot.busy &&
      ['following', 'returning', 'catching'].includes(bot.mode) &&
      distance(p, bot) <= ORB_BOTS.pickupRange &&
      reachable(bot)
    )
      return bot;
  }
}

/** Seek the latest shared gesture; joining or revealing an old bot never replays a call. */
export function posingOrbBot(
  bots: readonly OrbBotSnapshot[] | undefined,
  ownerId: string,
  now: number,
) {
  const own = bots?.filter((b) => b.ownerId === ownerId) ?? [];
  const call = own.find(
    (b) => (b.recallAt ?? 0) > 0 && now >= b.recallAt! && now - b.recallAt! < ORB_BOTS.callMs,
  );
  if (call) return call;
  return (
    own.find((b) => b.mode === 'windup') ??
    own
      .filter((b) => b.mode === 'airborne' && now - b.phaseAt < ORB_BOTS.followThroughMs)
      .sort((a, b) => b.throwAt - a.throwAt)[0]
  );
}

function setMode(b: OrbBot, mode: BotMode, now: number) {
  b.mode = mode;
  b.phaseAt = now;
  b.speed = 0;
  b.path = [];
  b.nextPathAt = 0;
  b.stuckAt = 0;
}

/** The preview and server both stop before a wall, ledge, sea or inaccessible landing. */
export function botThrowPlan(
  p: PlayerSnapshot,
  collision: CollisionWorld,
  bots: readonly OrbBotSnapshot[] = [],
  kind: BotKind = 'white',
) {
  const origin = botHandPosition(p),
    direction = { x: Math.sin(p.facing), z: Math.cos(p.facing) };
  origin.y += botHandOffset(kind);
  const radius = botRadius(kind);
  let end: Point = point(p);
  let previous: Point = point(p);
  for (let step = 1; step <= ORB_BOTS.throwDistance / 0.2; step++) {
    const length = step * 0.2;
    const next = { x: p.x + direction.x * length, z: p.z + direction.z * length };
    if (
      !collision.segmentFree(previous, next, radius) ||
      !collision.segmentFree(origin, next, radius)
    )
      break;
    end = next;
    previous = next;
  }
  if (distance(p, end) < 0.6 || !collision.segmentFree(p, origin, radius)) return null;
  // Leave visible room for each waiting companion instead of stacking bodies.
  const occupied = bots.filter((b) => ['airborne', 'landing', 'waiting'].includes(b.mode));
  const spacing = radius * 2 + 0.06;
  let freeLanding: Point | undefined;
  for (let row = 0; row < 4 && !freeLanding; row++) {
    for (const column of [0, -1, 1, -2, 2]) {
      const candidate = {
        x: end.x - direction.x * row * spacing + direction.z * column * spacing,
        z: end.z - direction.z * row * spacing - direction.x * column * spacing,
      };
      if (
        distance(p, candidate) >= 0.6 &&
        collision.segmentFree(origin, candidate, radius) &&
        occupied.every(
          (b) => distance(candidate, b.landing ?? b) >= radius + botRadius(b.kind) + 0.059,
        )
      ) {
        freeLanding = candidate;
        break;
      }
    }
  }
  if (!freeLanding) return null;
  end = freeLanding;
  const landingY = botRestHeight(kind, end.x, end.z);
  return { origin, landing: end, landingY };
}

export function botFlightPosition(
  b: Pick<OrbBotSnapshot, 'origin' | 'landing' | 'landingY' | 'throwAt'> &
    Partial<Pick<OrbBotSnapshot, 'kind'>>,
  now: number,
) {
  if (!b.origin || !b.landing) return null;
  const t = clamp((now - b.throwAt - ORB_BOTS.windupMs) / ORB_BOTS.flightMs, 0, 1);
  const x = b.origin.x + (b.landing.x - b.origin.x) * t;
  const z = b.origin.z + (b.landing.z - b.origin.z) * t;
  return {
    x,
    z,
    y: Math.max(
      botGroundHeight(x, z) + botHandOffset(b.kind ?? 'white'),
      b.origin.y * (1 - t) + b.landingY * t + 4 * ORB_BOTS.arcHeight * t * (1 - t),
    ),
    t,
  };
}

export function releaseHeldOrbBot(room: BotRoom, p: PlayerSnapshot, now: number) {
  for (const b of room.orbBots ?? []) {
    if (b.ownerId !== p.id) continue;
    b.recallAt = 0;
    if (b.mode === 'queued') {
      b.throwAt = 0;
      b.origin = null;
      b.landing = null;
      b.recall = false;
      setMode(b, 'following', now);
    } else if (b.mode === 'windup') {
      const safe = room.collision.nearestFree(p, botRadius(b.kind), [], 2);
      if (safe) Object.assign(b, safe, { y: botRestHeight(b.kind, safe.x, safe.z) });
      b.origin = null;
      b.landing = null;
      b.recall = true;
      setMode(b, 'returning', now);
    }
    if (b.kind === '524' && room.companion524) syncCompanion524Bot(room.companion524, b);
  }
}

export function handleOrbBotAction(
  room: BotRoom,
  p: PlayerSnapshot,
  action: string,
  kind: unknown,
  now: number,
): boolean {
  if (!['throwBot', 'recallBots', 'cancelBotThrows'].includes(action)) return false;
  syncOrbBots(room, now);
  const bots = room.orbBots!.filter((b) => b.ownerId === p.id);
  if (action === 'cancelBotThrows') {
    releaseHeldOrbBot(room, p, now);
    return true;
  }
  if (action === 'recallBots') {
    releaseHeldOrbBot(room, p, now);
    for (const b of bots) {
      b.recall = true;
      b.recallAt =
        canHandleBot(p, now) &&
        room.rimoNeko?.petPlayerId !== p.id &&
        room.companion524?.petPlayerId !== p.id
          ? now
          : 0;
      if (b.mode === 'waiting') setMode(b, 'returning', now);
      if (b.kind === '524' && room.companion524) syncCompanion524Bot(room.companion524, b);
    }
    return true;
  }
  if (
    !canHandleBot(p, now) ||
    room.rimoNeko?.petPlayerId === p.id ||
    room.companion524?.petPlayerId === p.id
  )
    return false;
  if (kind != null && !ownedBotKinds(bots, p.id).includes(kind as BotKind)) return false;
  const b = nextOrbBot(bots, p, (kind as BotKind) ?? 'white', (bot) =>
    room.collision.segmentFree(p, bot, botRadius(bot.kind)),
  );
  if (!b) return false;
  const plan = botThrowPlan(p, room.collision, room.orbBots, b.kind);
  if (!plan) return false;
  for (const bot of bots) bot.recallAt = 0;
  const previous = Math.max(0, ...bots.filter((bot) => bot !== b).map((bot) => bot.throwAt));
  const start = Math.max(now, previous + ORB_BOTS.throwIntervalMs);
  b.origin = { x: b.x, y: b.y, z: b.z };
  b.landing = null;
  b.facing = p.facing;
  b.throwAt = start;
  b.sequence++;
  b.recall = false;
  setMode(b, start > now ? 'queued' : 'windup', now);
  if (b.kind === '524' && room.companion524) syncCompanion524Bot(room.companion524, b);
  return true;
}

export function updateOrbBots(room: BotRoom, dt: number, now: number) {
  syncOrbBots(room, now);
  if (!(dt > 0) || !Number.isFinite(dt)) return;
  dt = Math.min(dt, 0.15);
  for (const b of room.orbBots!) {
    const p = room.players.get(b.ownerId)!;
    const radius = botRadius(b.kind);
    if (b.kind === '524' && room.companion524) {
      const c = room.companion524;
      if (!['windup', 'airborne', 'landing', 'stowed'].includes(b.mode)) {
        Object.assign(b, point(c), { y: botRestHeight(b.kind, c.x, c.z) });
      }
      if (b.busy) {
        b.recallAt = 0;
        b.speed = 0;
        b.path = [];
        b.facing = c.facing;
        if (b.mode === 'queued') {
          b.throwAt = 0;
          b.origin = b.landing = null;
          setMode(b, 'following', now);
        }
        continue;
      }
    }
    const warp = (p.warpSequence ?? 0) !== b.warpSequence || distance(p, b.lastOwner) > 12;
    if (warp || !canHandleBot(p, now) || (b.recallAt && now - b.recallAt >= ORB_BOTS.callMs))
      b.recallAt = 0;
    b.lastOwner = point(p);
    b.warpSequence = p.warpSequence ?? 0;
    // A deployed companion belongs to its landing spot until explicitly called,
    // even when the owner walks far away, warps, boards a boat or is downed.
    const deployed = !b.recall && ['airborne', 'landing', 'waiting'].includes(b.mode);
    if (
      !deployed &&
      (p.boatId || p.carrierId || p.mountId || p.downedUntil || warp || b.mode === 'stowed')
    ) {
      const safe = formationPoint(room, p, b.kind);
      b.origin = null;
      b.landing = null;
      b.throwAt = 0;
      b.recall = false;
      setMode(
        b,
        p.boatId || p.carrierId || p.mountId || p.downedUntil || !safe ? 'stowed' : 'following',
        now,
      );
      if (safe) Object.assign(b, safe, { y: botRestHeight(b.kind, safe.x, safe.z) });
      continue;
    }
    if (b.mode === 'queued') {
      if (!canHandleBot(p, now)) {
        releaseHeldOrbBot(room, p, now);
        continue;
      }
      if (
        now >= b.throwAt &&
        !room.orbBots!.some((other) => other.ownerId === p.id && other.mode === 'windup')
      ) {
        if (distance(p, b) > ORB_BOTS.pickupRange || !room.collision.segmentFree(p, b, radius)) {
          b.throwAt = 0;
          setMode(b, 'following', now);
        } else {
          b.origin = { x: b.x, y: b.y, z: b.z };
          b.throwAt = now;
          setMode(b, 'windup', now);
        }
      }
    }
    if (b.mode === 'windup') {
      if (!canHandleBot(p, now)) {
        releaseHeldOrbBot(room, p, now);
        continue;
      }
      if (now - b.throwAt < ORB_BOTS.windupMs) {
        Object.assign(b, botHandPosition(p));
        b.y += botHandOffset(b.kind);
        continue;
      }
      // Revalidate at release: moving into a wall during the windup cannot throw through it.
      const plan = botThrowPlan(p, room.collision, room.orbBots, b.kind);
      if (!plan) {
        releaseHeldOrbBot(room, p, now);
        continue;
      }
      Object.assign(b, plan);
      b.facing = p.facing;
      setMode(b, 'airborne', b.throwAt + ORB_BOTS.windupMs);
    }
    if (b.mode === 'airborne') {
      const pos = botFlightPosition(b, now);
      if (!pos) {
        setMode(b, 'returning', now);
        continue;
      }
      b.x = pos.x;
      b.y = pos.y;
      b.z = pos.z;
      if (pos.t >= 1) setMode(b, 'landing', b.throwAt + ORB_BOTS.windupMs + ORB_BOTS.flightMs);
      else continue;
    }
    if (b.mode === 'landing') {
      // Keep the complete squash/rebound, including a recall. A 100 ms shortcut
      // can disappear between the shared 90 ms snapshots under ordinary jitter.
      if (now - b.phaseAt < ORB_BOTS.landMs) continue;
      setMode(b, b.recall ? 'returning' : 'waiting', now);
    }
    if (b.mode === 'waiting') {
      b.speed = 0;
      continue;
    }
    if (b.mode === 'catching') {
      if (now - b.phaseAt < ORB_BOTS.catchMs) continue;
      setMode(b, 'following', now);
      b.recall = false;
    }
    const goal = formationPoint(room, p, b.kind);
    if (!goal) {
      b.speed = 0;
      continue;
    }
    const gap = distance(b, goal);
    if (gap < 0.12) {
      b.speed = 0;
      b.path = [];
      if (b.mode === 'returning') setMode(b, 'catching', now);
      continue;
    }
    if (room.collision.segmentFree(b, goal, radius)) b.path = [goal];
    else if (now >= b.nextPathAt) {
      b.path = room.collision.path(b, goal, radius);
      b.nextPathAt = now + 1100 + BOT_ORDER.indexOf(b.kind) * 90;
    }
    const target = b.path[0];
    const before = point(b);
    if (target) {
      const length = distance(b, target);
      const amount = Math.min(
        length,
        dt * Math.min(ORB_BOTS.speed, Math.max(1.5, p.speed + 1.5, gap * 2)),
      );
      if (length > 0.001)
        Object.assign(
          b,
          room.collision.move(
            b,
            ((target.x - b.x) / length) * amount,
            ((target.z - b.z) / length) * amount,
            radius,
          ),
        );
      if (distance(b, target) < 0.1) b.path.shift();
    }
    b.speed = distance(before, b) / dt;
    b.y = botRestHeight(b.kind, b.x, b.z);
    if (b.speed > 0.03) {
      b.facing = Math.atan2(b.x - before.x, b.z - before.z);
      b.stuckAt = 0;
    } else {
      b.stuckAt ||= now;
      // A newly grown obstacle can enclose a small bot. Recover at a verified free
      // formation point after a bounded wait; renderer shows a short arrival hop.
      if (now - b.stuckAt > 5000 || distance(p, b) > 40) {
        Object.assign(b, goal, { y: botRestHeight(b.kind, goal.x, goal.z) });
        setMode(b, 'catching', now);
      }
    }
  }
  const recruited = room.orbBots!.find((b) => b.kind === '524');
  if (recruited && room.companion524) syncCompanion524Bot(room.companion524, recruited);
}
