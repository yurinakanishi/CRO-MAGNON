import type { Point } from './types.mjs';
import type { PlayerSnapshot } from './snapshots.mjs';
import type { CollisionWorld } from './collision.mjs';
import { walkHeight, riverX, riverHalfWidth, WATER_LEVEL } from './terrain.mjs';
import { mountainWaterHeight } from './mountain-river.mjs';
import { characterModel } from './characters.mjs';
import { attackProfile } from './combat-profiles.mjs';
import { jumpProgress } from './jumping.mjs';
import { caveInteriorWeight } from './cave-light.mjs';
import { COMPANION_524 } from './companion-524.mjs';
import { RIMO_NEKO } from './rimo-neko.mjs';
import { interactionVisible } from './interactions.mjs';
import {
  companionBusy,
  companionOnGround,
  pettingCompanion,
  type Companion,
} from './companions.mjs';
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
export const BOT_ORDER: readonly BotKind[] = [...BOT_KINDS, '524', 'rimo-neko'];
export const BOT_DESIGNS = {
  '524': { name: '524', face: '524', color: '#ffdf58' },
  'rimo-neko': { name: 'りもねこ', face: 'ねこ', color: '#d2c9c2' },
  white: {
    name: 'しろdot',
    face: '＾＾',
    color: '#f5f3ee',
    image: '/models/orb-bot-white/portrait.png',
  },
  blue: {
    name: 'あおdot',
    face: '＞＜',
    color: '#1172ef',
    image: '/models/orb-bot-blue/portrait.png',
  },
  green: {
    name: 'みどりdot',
    face: '＋＋',
    color: '#18b653',
    image: '/models/orb-bot-green/portrait.png',
  },
  purple: {
    name: 'むらさきdot',
    face: '○○',
    color: '#a23ee8',
    image: '/models/orb-bot-purple/portrait.png',
  },
  orange: {
    name: 'オレンジdot',
    face: '－－',
    color: '#f58b28',
    image: '/models/orb-bot-orange/portrait.png',
  },
  beret: {
    name: 'ベレーdot',
    face: '••',
    color: '#148aff',
    image: '/models/orb-bot-beret/portrait.png',
  },
  frog: {
    name: 'かえるdot',
    face: '●●',
    color: '#b4e517',
    image: '/models/orb-bot-frog/portrait.png',
  },
  triangle: {
    name: 'さんかくdot',
    face: '◡◡',
    color: '#ffce19',
    image: '/models/orb-bot-triangle/portrait.png',
  },
  heart: {
    name: 'ハートdot',
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
  petRange: 2.6,
  petApproachMs: 3000,
  petStrokeMs: 1100,
  happyMs: 900,
});
type BotRoom = {
  orbBots?: OrbBot[];
  players: Map<string, PlayerSnapshot>;
  collision: CollisionWorld;
  companions?: Companion[];
};
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const point = (p: Point): Point => ({ x: p.x, z: p.z });
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export const botRadius = (kind: BotKind) =>
  kind === '524' ? COMPANION_524.radius : kind === 'rimo-neko' ? RIMO_NEKO.radius : ORB_BOTS.radius;
export const isCompanionBot = (kind: BotKind) => kind === '524' || kind === 'rimo-neko';
/** The 524 or りもねこ body a squad entry moves through throws and recalls. */
export const companionForBot = (room: Pick<BotRoom, 'companions'>, b: OrbBotSnapshot) =>
  b.companionId ? room.companions?.find((c) => c.id === b.companionId) : undefined;
/** Keep the companion's body, hit target and hand on its one squad entry. */
function syncCompanionBot(room: BotRoom, b: OrbBot) {
  const c = companionForBot(room, b);
  if (!c) return;
  c.x = b.x;
  c.z = b.z;
  c.facing = b.facing;
  c.squadMode = b.mode;
  if (!companionOnGround(c)) c.velocityX = c.velocityZ = 0;
}
export const botHandOffset = (kind: BotKind) => (kind === '524' ? COMPANION_524.bodyHeight / 2 : 0);
export const botRestHeight = (kind: BotKind, x: number, z: number) =>
  botGroundHeight(x, z) + (kind === '524' ? COMPANION_524.hoverHeight : 0);
/** A goodbye no longer travels, throws or answers a call. */
const travelling = (b: OrbBotSnapshot) => b.mode !== 'leaving';
export function ownedBotKinds(
  bots: readonly OrbBotSnapshot[],
  ownerId?: string,
): readonly BotKind[] {
  return ownerId
    ? BOT_ORDER.filter((kind) =>
        bots.some((b) => b.kind === kind && b.ownerId === ownerId && travelling(b)),
      )
    : [];
}

/** A new squad entry beside its person: a dot, or the throwable side of 524 or りもねこ. */
export function createOrbBot(
  kind: BotKind,
  id: string,
  owner: Pick<PlayerSnapshot, 'id' | 'x' | 'z' | 'facing' | 'warpSequence'>,
  at: Point,
  now: number,
  companionId?: string,
): OrbBot {
  return {
    id,
    ownerId: owner.id,
    kind,
    ...(companionId ? { companionId } : {}),
    mode: 'following',
    ...point(at),
    y: botRestHeight(kind, at.x, at.z),
    facing: owner.facing,
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
    lastOwner: point(owner),
    warpSequence: owner.warpSequence ?? 0,
    stuckAt: 0,
    busy: false,
    petPlayerId: null,
    petAt: 0,
    petContactAt: 0,
    petFacing: 0,
    leavingAt: 0,
  };
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

/** The cave reserves the held item for a torch; following and recall still work. */
export function canThrowBot(p: PlayerSnapshot | undefined | null, now: number) {
  return canHandleBot(p, now) && caveInteriorWeight(p!) === 0;
}

/** One shared target for the hand pose and authoritative release origin. */
export function botHandPosition(p: PlayerSnapshot, floor = walkHeight(p.x, p.z)) {
  const height =
    characterModel(p).height ?? (p.species === 'bear' ? 0.78 : p.species === 'ape' ? 3.2 : 1.68);
  const grip = characterModel(p).botHandRatios;
  const side = height * (grip?.side ?? (p.species === 'bear' ? 0.18 : 0.14)),
    front = height * (grip?.front ?? (p.species === 'bear' ? 0.14 : 0.22));
  return {
    x: p.x + Math.cos(p.facing) * side + Math.sin(p.facing) * front,
    y: floor + height * (grip?.height ?? (p.species === 'bear' ? 0.55 : 0.76)),
    z: p.z - Math.sin(p.facing) * side + Math.cos(p.facing) * front,
  };
}

function formation(p: PlayerSnapshot, i: number, count: number): Point {
  const row = Math.floor(i / 5),
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
  const kinds = ownedBotKinds(room.orbBots ?? [], p.id);
  const i = Math.max(0, kinds.indexOf(kind)),
    count = Math.max(1, kinds.length);
  const bodyRadius = botRadius(kind);
  const desired = formation(p, i, count);
  const first = room.collision.nearestFree(desired, bodyRadius, [], 1);
  if (first && room.collision.segmentFree(p, first, bodyRadius)) return first;
  const row = Math.floor(i / 5),
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

export function orbBotSnapshots(room: Pick<BotRoom, 'orbBots'>): OrbBotSnapshot[] {
  return (room.orbBots ?? []).map(
    ({
      path,
      nextPathAt,
      lastOwner,
      warpSequence,
      stuckAt,
      petOrigin,
      petGoal,
      petCharacter,
      petMode,
      petWarpSequence,
      ...b
    }) => ({
      ...b,
      origin: b.origin ? { ...b.origin } : null,
      landing: b.landing ? { ...b.landing } : null,
    }),
  );
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
    const bot = bots.find((b) => b.ownerId === p.id && b.kind === kind && travelling(b));
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
  const own = bots?.filter((b) => b.ownerId === ownerId && travelling(b)) ?? [];
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

export function pettingOrbBot(bots: readonly OrbBotSnapshot[] | undefined, playerId?: string) {
  return playerId ? bots?.find((b) => b.petPlayerId === playerId) : undefined;
}

export function nearOrbBot(
  p: PlayerSnapshot | undefined | null,
  b: OrbBotSnapshot,
  collision: CollisionWorld,
  now: number,
) {
  return (
    !!p &&
    !isCompanionBot(b.kind) &&
    canHandleBot(p, now) &&
    !['queued', 'windup', 'airborne', 'landing', 'stowed', 'leaving'].includes(b.mode) &&
    distance(p, b) <= ORB_BOTS.petRange &&
    interactionVisible(collision, p, b)
  );
}

function botPetPosition(p: PlayerSnapshot, b: OrbBotSnapshot) {
  const facing = Math.atan2(b.x - p.x, b.z - p.z);
  const [reach, side] =
    p.species === 'bear'
      ? [0.2, 0.12]
      : p.species === 'ape'
        ? [0.8, 0.25]
        : characterModel(p).bodyPlan === 'octopus'
          ? [1.08, 0.12]
          : p.species === 'howkey'
            ? [0.4, 0.12]
            : [0.5 * (characterModel(p).petReachScale ?? 1), 0.12];
  return {
    facing,
    goal: {
      x: p.x + Math.sin(facing) * reach - Math.cos(facing) * side,
      z: p.z + Math.cos(facing) * reach + Math.sin(facing) * side,
    },
  };
}

function clearBotPet(b: OrbBot) {
  b.petPlayerId = null;
  b.petOrigin = b.petGoal = null;
  b.busy = false;
  b.petWarpSequence = undefined;
}

/** The stroke ends; a thrown dot keeps waiting where it is, others resume following. */
function endBotPet(b: OrbBot, now: number) {
  clearBotPet(b);
  if (b.mode !== 'leaving') setMode(b, b.petMode === 'waiting' ? 'waiting' : 'following', now);
}

function cancelBotPet(b: OrbBot, now: number) {
  endBotPet(b, now);
  b.petContactAt = 0;
}

/** Steering away interrupts the stroke; the dot's owner never changes. */
export function cancelPlayerBotPet(room: Pick<BotRoom, 'orbBots'>, playerId: string, now: number) {
  for (const b of room.orbBots ?? []) if (b.petPlayerId === playerId) cancelBotPet(b, now);
}

function botPetInterrupted(p: PlayerSnapshot, b: OrbBot, now: number) {
  return (
    !canHandleBot(p, now) ||
    !b.petOrigin ||
    distance(p, b.petOrigin) > 0.25 ||
    p.moving ||
    (p.hurtAt ?? 0) > b.petAt! ||
    `${p.species}/${p.gender}` !== b.petCharacter ||
    (p.warpSequence ?? 0) !== b.petWarpSequence
  );
}

function approachBotPet(room: BotRoom, p: PlayerSnapshot, b: OrbBot, dt: number) {
  b.speed = 0;
  b.facing = Math.atan2(p.x - b.x, p.z - b.z);
  const goal = b.petGoal!;
  const gap = distance(b, goal),
    amount = Math.min(gap, dt * 1.6);
  if (gap > 0.001) {
    const before = point(b);
    Object.assign(
      b,
      room.collision.move(
        b,
        ((goal.x - b.x) / gap) * amount,
        ((goal.z - b.z) / gap) * amount,
        ORB_BOTS.radius,
      ),
    );
    b.speed = distance(b, before) / dt;
  }
  b.y = botGroundHeight(b.x, b.z);
  return distance(b, goal) < 0.015;
}

/**
 * Anyone may pet anyone's dot: it comes to the hand, enjoys the stroke and is happy,
 * then carries on with its own person (or keeps waiting where it was thrown).
 */
export function petOrbBot(room: BotRoom, p: PlayerSnapshot, id: unknown, now: number) {
  const b = room.orbBots?.find((bot) => bot.id === id && !isCompanionBot(bot.kind));
  if (!b || b.busy || !nearOrbBot(p, b, room.collision, now)) return false;
  const { goal, facing } = botPetPosition(p, b);
  if (!room.collision.segmentFree(b, goal, ORB_BOTS.radius)) return false;
  releaseHeldOrbBot(room, p, now);
  p.facing = facing;
  b.petPlayerId = p.id;
  b.petAt = now;
  b.petContactAt = 0;
  b.petOrigin = point(p);
  b.petGoal = goal;
  b.petFacing = facing;
  b.petCharacter = `${p.species}/${p.gender}`;
  b.petWarpSequence = p.warpSequence ?? 0;
  b.petMode = b.mode;
  b.busy = true;
  b.speed = 0;
  b.path = [];
  b.recallAt = 0;
  return true;
}

function updateBotPet(room: BotRoom, b: OrbBot, dt: number, now: number) {
  if (!b.petPlayerId || !b.petGoal || !b.petOrigin) return false;
  const p = room.players.get(b.petPlayerId);
  const stroking = !b.petContactAt || now < b.petContactAt + ORB_BOTS.petStrokeMs;
  if (
    !p ||
    (stroking &&
      (botPetInterrupted(p, b, now) ||
        !nearOrbBot(p, b, room.collision, now) ||
        (!b.petContactAt && now - b.petAt! > ORB_BOTS.petApproachMs)))
  ) {
    cancelBotPet(b, now);
    return false;
  }
  b.speed = 0;
  b.facing = Math.atan2(p.x - b.x, p.z - b.z);
  if (!b.petContactAt) {
    if (approachBotPet(room, p, b, dt)) b.petContactAt = now;
  } else if (now >= b.petContactAt + ORB_BOTS.petStrokeMs + ORB_BOTS.happyMs) {
    endBotPet(b, now);
  }
  return true;
}

/** The goodbye stands where it was dismissed; an unlaunched throw is put down first. */
export function startBotFarewell(b: OrbBot, now: number) {
  if (b.mode === 'leaving') return;
  if (b.mode === 'windup' && b.origin) Object.assign(b, point(b.origin));
  clearBotPet(b);
  b.petContactAt = 0;
  b.origin = b.landing = null;
  b.throwAt = b.recallAt = 0;
  b.recall = false;
  b.y = botRestHeight(b.kind, b.x, b.z);
  setMode(b, 'leaving', now);
  b.leavingAt = now;
}

/** A goodbye called back before it ends simply keeps travelling. */
export function cancelBotFarewell(b: OrbBot, now: number) {
  if (b.mode !== 'leaving') return;
  b.leavingAt = 0;
  setMode(b, 'following', now);
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
    if (b.ownerId !== p.id || !travelling(b)) continue;
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
    syncCompanionBot(room, b);
  }
}

/** Throws and calls for the player's own companion. */
export function handleOrbBotAction(
  room: BotRoom,
  p: PlayerSnapshot,
  action: string,
  kind: unknown,
  now: number,
): boolean {
  if (!['throwBot', 'recallBots', 'cancelBotThrows'].includes(action)) return false;
  const bots = (room.orbBots ?? []).filter((b) => b.ownerId === p.id && travelling(b));
  if (action === 'cancelBotThrows') {
    releaseHeldOrbBot(room, p, now);
    return true;
  }
  const petting = !!pettingOrbBot(room.orbBots, p.id) || !!pettingCompanion(room.companions, p.id);
  if (action === 'recallBots') {
    releaseHeldOrbBot(room, p, now);
    for (const b of bots) {
      b.recall = true;
      b.recallAt = canHandleBot(p, now) && !petting ? now : 0;
      if (b.mode === 'waiting' || (b.kind === 'rimo-neko' && b.mode === 'following'))
        setMode(b, 'returning', now);
      syncCompanionBot(room, b);
    }
    return true;
  }
  if (!canThrowBot(p, now) || petting) return false;
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
  syncCompanionBot(room, b);
  return true;
}

/** A released body completes its flight even if its owner temporarily disconnects. */
function updateDeployedBot(b: OrbBot, now: number) {
  if (b.mode === 'airborne') {
    const pos = botFlightPosition(b, now);
    if (!pos) {
      setMode(b, 'returning', now);
      return false;
    }
    b.x = pos.x;
    b.y = pos.y;
    b.z = pos.z;
    if (pos.t >= 1) setMode(b, 'landing', b.throwAt + ORB_BOTS.windupMs + ORB_BOTS.flightMs);
    else return true;
  }
  if (b.mode === 'landing') {
    // Keep the complete squash/rebound, including a recall, across snapshots.
    if (now - b.phaseAt < ORB_BOTS.landMs) return true;
    setMode(b, b.recall ? 'returning' : 'waiting', now);
  }
  if (b.mode === 'waiting') {
    b.speed = 0;
    return true;
  }
  return false;
}

export function updateOrbBots(room: BotRoom, dt: number, now: number) {
  if (!(dt > 0) || !Number.isFinite(dt)) return;
  dt = Math.min(dt, 0.15);
  for (const b of room.orbBots ?? []) {
    if (b.mode === 'leaving') {
      b.speed = 0;
      continue;
    }
    if (!isCompanionBot(b.kind) && updateBotPet(room, b, dt, now)) continue;
    const p = room.players.get(b.ownerId);
    const radius = botRadius(b.kind);
    const c = companionForBot(room, b);
    if (c) {
      b.busy = companionBusy(c, now);
      if (!['windup', 'airborne', 'landing', 'stowed'].includes(b.mode)) {
        Object.assign(b, point(c), { y: botRestHeight(b.kind, c.x, c.z) });
      }
      // Natural cat movement owns its heading; do not write an old squad heading back.
      if (b.kind === 'rimo-neko' && b.mode === 'following') {
        b.facing = c.facing;
        b.speed = c.followSpeed;
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
    if (!p) {
      // The owner's departure removes the body; a released one still lands meanwhile.
      b.recallAt = 0;
      b.speed = 0;
      updateDeployedBot(b, now);
      continue;
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
      if (!canThrowBot(p, now)) {
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
      if (!canThrowBot(p, now)) {
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
    if (updateDeployedBot(b, now)) continue;
    if (b.mode === 'catching') {
      b.facing = p.facing;
      if (now - b.phaseAt < ORB_BOTS.catchMs) continue;
      setMode(b, 'following', now);
      b.recall = false;
    }
    // Preserve the cat's original natural walking and comfortable following distance.
    if (b.kind === 'rimo-neko' && b.mode === 'following') continue;
    const goal = formationPoint(room, p, b.kind);
    if (!goal) {
      b.speed = 0;
      continue;
    }
    const gap = distance(b, goal);
    if (gap < 0.12) {
      b.speed = 0;
      b.path = [];
      // The last return step points away from the owner; face forward once assembled.
      b.facing = p.facing;
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
        Object.assign(b, goal, { y: botRestHeight(b.kind, goal.x, goal.z), facing: p.facing });
        setMode(b, 'catching', now);
      }
    }
  }
  for (const b of room.orbBots ?? []) syncCompanionBot(room, b);
}
