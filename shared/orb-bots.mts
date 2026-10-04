import type { Point } from './types.mjs';
import type { PlayerSnapshot } from './snapshots.mjs';
import type { CollisionWorld } from './collision.mjs';
import { walkHeight, riverX, riverHalfWidth, WATER_LEVEL } from './terrain.mjs';
import { mountainWaterHeight } from './mountain-river.mjs';
import { characterModel } from './characters.mjs';
import { attackProfile } from './combat-profiles.mjs';
import { jumpProgress } from './jumping.mjs';
import { COMPANION_524, returnCompanion524, syncCompanion524Bot } from './companion-524.mjs';
import { RIMO_NEKO, returnRimoNeko, syncRimoNekoBot } from './rimo-neko.mjs';
import { CAMP } from './world.mjs';
import { interactionVisible } from './interactions.mjs';
import type { Companion524 } from './companion-524-types.mjs';
import type { RimoNeko, RimoNekoSnapshot } from './rimo-neko-types.mjs';
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
// A loose, uneven camp gathering, stable across connections and save restores.
const BOT_CAMP_PLACES = {
  white: { x: -5.2, z: 5.65, facing: 2.3 },
  blue: { x: -6.3, z: 6.0, facing: 1.05 },
  green: { x: -4.15, z: 6.28, facing: -1.6 },
  purple: { x: -6.7, z: 7.15, facing: 0.7 },
  orange: { x: -5.65, z: 6.8, facing: -0.4 },
  beret: { x: -4.88, z: 7.05, facing: 2.8 },
  frog: { x: -6.0, z: 7.86, facing: 2.1 },
  triangle: { x: -4.55, z: 7.98, facing: -2.65 },
  heart: { x: -3.85, z: 7.15, facing: -1.2 },
} as const;
export const BOT_DESIGNS = {
  '524': { name: '524', face: '524', color: '#ffdf58' },
  'rimo-neko': { name: 'りもねこ', face: 'ねこ', color: '#d2c9c2' },
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
  whistleRange: 12,
  flightMs: 900,
  landMs: 420,
  catchMs: 300,
  throwDistance: 8,
  arcHeight: 2,
  speed: 8.5,
  petRange: 2.6,
  petGroupRange: 4.5,
  petApproachMs: 3000,
  petGroupApproachMs: 4500,
  petStrokeMs: 1100,
  happyMs: 900,
});
type BotRoom = {
  orbBots?: OrbBot[];
  players: Map<string, PlayerSnapshot>;
  collision: CollisionWorld;
  rimoNeko?: RimoNeko;
  mae?: { petPlayerId: string | null };
  kohaku?: { petPlayerId: string | null };
  companion524?: Companion524;
  sessions?: Map<string, { player: { id: string } }>;
};
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const point = (p: Point): Point => ({ x: p.x, z: p.z });
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export const botRadius = (kind: BotKind) =>
  kind === '524' ? COMPANION_524.radius : kind === 'rimo-neko' ? RIMO_NEKO.radius : ORB_BOTS.radius;
export const isCompanionBot = (kind: BotKind) => kind === '524' || kind === 'rimo-neko';
const companionForBot = (room: BotRoom, kind: BotKind) =>
  kind === '524' ? room.companion524 : kind === 'rimo-neko' ? room.rimoNeko : undefined;
function syncCompanionBot(room: BotRoom, b: OrbBotSnapshot) {
  if (b.kind === '524' && room.companion524) syncCompanion524Bot(room.companion524, b);
  else if (b.kind === 'rimo-neko' && room.rimoNeko) syncRimoNekoBot(room.rimoNeko, b);
}
function companionBusy(c: RimoNekoSnapshot, kind: BotKind, now: number) {
  return (
    !!c.petPlayerId ||
    (c.hitSequence > 0 &&
      now - c.hitAt <
        (kind === 'rimo-neko' ? RIMO_NEKO.hitMs + RIMO_NEKO.hissMs : COMPANION_524.hitMs))
  );
}
export const botHandOffset = (kind: BotKind) => (kind === '524' ? COMPANION_524.bodyHeight / 2 : 0);
export const botRestHeight = (kind: BotKind, x: number, z: number) =>
  botGroundHeight(x, z) + (kind === '524' ? COMPANION_524.hoverHeight : 0);
export function ownedBotKinds(
  bots: readonly OrbBotSnapshot[],
  ownerId?: string,
): readonly BotKind[] {
  return ownerId
    ? BOT_ORDER.filter((kind) => bots.some((b) => b.kind === kind && b.ownerId === ownerId))
    : [];
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

/** Nine shared camp residents. Connections never create or automatically recruit dots. */
export function syncOrbBots(room: BotRoom, now: number) {
  room.orbBots = (room.orbBots ?? []).filter((b) =>
    isCompanionBot(b.kind) ? !!companionForBot(room, b.kind)?.squadPlayerId : !!b.home,
  );
  for (const kind of BOT_KINDS) {
    if (room.orbBots.some((b) => b.kind === kind)) continue;
    const place = BOT_CAMP_PLACES[kind];
    const home = room.collision.nearestFree(
      { x: CAMP.x + place.x, z: CAMP.z + place.z },
      ORB_BOTS.radius,
      [],
      3,
    );
    if (!home) continue;
    room.orbBots.push({
      id: `orb:${kind}`,
      kind,
      ownerId: '',
      mode: 'home',
      home,
      ...home,
      y: botGroundHeight(home.x, home.z),
      facing: place.facing,
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
      lastOwner: point(home),
      warpSequence: 0,
      stuckAt: 0,
      busy: false,
      petPlayerId: null,
      petAt: 0,
      petContactAt: 0,
      petFacing: 0,
    });
  }
  for (const kind of ['524', 'rimo-neko'] as const) {
    const c = companionForBot(room, kind);
    if (!c?.squadPlayerId) continue;
    const ownerId = c.squadPlayerId;
    const p = room.players.get(ownerId);
    const existing = room.orbBots.find((b) => b.kind === kind);
    if (!p && !existing && c.squadMode !== 'waiting') continue;
    if (existing) {
      if (existing.ownerId !== ownerId) {
        existing.ownerId = ownerId;
        existing.recall = false;
        existing.recallAt = existing.throwAt = 0;
        existing.origin = existing.landing = null;
        existing.lastOwner = point(p ?? c);
        existing.warpSequence = p?.warpSequence ?? 0;
        Object.assign(existing, point(c), { y: botRestHeight(kind, c.x, c.z) });
        setMode(existing, 'following', now);
      }
      existing.busy = companionBusy(c, kind, now);
      continue;
    }
    const start = point(c);
    room.orbBots.push({
      id: kind === '524' ? 'orb:companion-524' : 'orb:rimo-neko',
      ownerId,
      kind,
      mode: c.squadMode === 'waiting' ? 'waiting' : 'following',
      ...start,
      y: botRestHeight(kind, start.x, start.z),
      facing: c.facing,
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
      lastOwner: point(p ?? c),
      warpSequence: p?.warpSequence ?? 0,
      stuckAt: 0,
      busy: companionBusy(c, kind, now),
    });
  }
}

export function orbBotSnapshots(room: BotRoom): OrbBotSnapshot[] {
  return (room.orbBots ?? []).map(
    ({
      path,
      nextPathAt,
      lastOwner,
      warpSequence,
      stuckAt,
      home,
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

export function pettingOrbBot(bots: readonly OrbBotSnapshot[] | undefined, playerId?: string) {
  if (!playerId) return undefined;
  const pets = bots?.filter((b) => b.petPlayerId === playerId);
  return pets?.find((b) => b.id === b.petGroupLeaderId) ?? pets?.[0];
}

export function nearOrbBot(
  p: PlayerSnapshot | undefined | null,
  b: OrbBotSnapshot,
  collision: CollisionWorld,
  now: number,
  range: number = ORB_BOTS.petRange,
) {
  return (
    !!p &&
    !isCompanionBot(b.kind) &&
    canHandleBot(p, now) &&
    !['queued', 'windup', 'airborne', 'landing', 'stowed'].includes(b.mode) &&
    distance(p, b) <= range &&
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
            : [0.5, 0.12];
  return {
    facing,
    goal: {
      x: p.x + Math.sin(facing) * reach - Math.cos(facing) * side,
      z: p.z + Math.cos(facing) * reach + Math.sin(facing) * side,
    },
  };
}

/** Gather the group in distinct places around one shared hand target. */
function groupBotPetPlans(
  bots: readonly OrbBotSnapshot[],
  p: PlayerSnapshot | undefined | null,
  collision: CollisionWorld,
  now: number,
  presentOwners?: ReadonlySet<string>,
) {
  if (!p || pettingOrbBot(bots, p.id)) return [];
  const candidates = bots
    .filter(
      (b) =>
        !b.busy &&
        (!b.ownerId || b.ownerId === p.id || presentOwners?.has(b.ownerId) === false) &&
        nearOrbBot(p, b, collision, now, ORB_BOTS.petGroupRange),
    )
    .sort(
      (a, b) =>
        distance(p, a) - distance(p, b) || BOT_ORDER.indexOf(a.kind) - BOT_ORDER.indexOf(b.kind),
    );
  const plans: { bot: OrbBotSnapshot; goal: Point; facing: number }[] = [];
  const slots = [0, 1, 2].flatMap((row) => [0, -1, 1].map((column) => ({ row, column })));
  for (const bot of candidates) {
    const anchor = plans[0] ?? botPetPosition(p, bot);
    if (!plans.length && !collision.segmentFree(bot, anchor.goal, ORB_BOTS.radius)) continue;
    const slot = slots.findIndex(({ row, column }) => {
      const goal = {
        x:
          anchor.goal.x + (Math.sin(anchor.facing) * row + Math.cos(anchor.facing) * column) * 0.36,
        z:
          anchor.goal.z + (Math.cos(anchor.facing) * row - Math.sin(anchor.facing) * column) * 0.36,
      };
      return collision.segmentFree(bot, goal, ORB_BOTS.radius);
    });
    if (slot < 0) continue;
    const { row, column } = slots.splice(slot, 1)[0];
    plans.push({
      bot,
      facing: anchor.facing,
      goal: {
        x:
          anchor.goal.x + (Math.sin(anchor.facing) * row + Math.cos(anchor.facing) * column) * 0.36,
        z:
          anchor.goal.z + (Math.cos(anchor.facing) * row - Math.sin(anchor.facing) * column) * 0.36,
      },
    });
  }
  return plans;
}

/** Invite nearby available dots; companions of another connected player stay with them. */
export function nearbyOrbBotsForPetting(
  bots: readonly OrbBotSnapshot[],
  p: PlayerSnapshot | undefined | null,
  collision: CollisionWorld,
  now: number,
  presentOwners?: ReadonlySet<string>,
) {
  return groupBotPetPlans(bots, p, collision, now, presentOwners).map(({ bot }) => bot);
}

/** A whistle invites free or absent-owner dots within hearing and sight. */
export function nearbyOrbBotsForWhistle<T extends OrbBotSnapshot>(
  bots: readonly T[],
  p: PlayerSnapshot | undefined | null,
  collision: CollisionWorld,
  now: number,
  presentOwners: ReadonlySet<string>,
) {
  return bots.filter(
    (b) =>
      !b.busy &&
      b.ownerId !== p?.id &&
      (!b.ownerId || !presentOwners.has(b.ownerId)) &&
      nearOrbBot(p, b, collision, now, ORB_BOTS.whistleRange),
  );
}

export function canWhistleCompanion(
  p: PlayerSnapshot | undefined | null,
  c: RimoNekoSnapshot | undefined,
  kind: '524' | 'rimo-neko',
  collision: CollisionWorld,
  now: number,
  presentOwners: ReadonlySet<string>,
) {
  return (
    !!p &&
    !!c &&
    canHandleBot(p, now) &&
    !companionBusy(c, kind, now) &&
    (!c.squadPlayerId || !presentOwners.has(c.squadPlayerId)) &&
    !['queued', 'windup', 'airborne', 'landing', 'stowed'].includes(c.squadMode ?? '') &&
    distance(p, c) <= ORB_BOTS.whistleRange &&
    interactionVisible(collision, p, c)
  );
}

function gatherNearbyBots(room: BotRoom, p: PlayerSnapshot, now: number) {
  if (!canHandleBot(p, now)) return;
  for (const b of nearbyOrbBotsForWhistle(
    room.orbBots ?? [],
    p,
    room.collision,
    now,
    new Set(room.players.keys()),
  )) {
    bondBot(p, b);
    setMode(b, 'returning', now);
  }
  for (const kind of ['524', 'rimo-neko'] as const) {
    const c = companionForBot(room, kind);
    if (!c || !canWhistleCompanion(p, c, kind, room.collision, now, new Set(room.players.keys())))
      continue;
    c.squadPlayerId = c.followPlayerId = p.id;
    c.squadMode = 'following';
    c.mode = 'following';
    c.path = [];
    c.goal = null;
    c.nextPathAt = c.followSpeed = 0;
    c.ownerPosition = point(p);
  }
  syncOrbBots(room, now);
}

function clearBotPet(b: OrbBot) {
  b.petPlayerId = null;
  b.petOrigin = b.petGoal = null;
  b.busy = false;
  b.petGroupLeaderId = undefined;
  b.petWarpSequence = undefined;
}

function sendBotHome(b: OrbBot, now: number) {
  clearBotPet(b);
  b.ownerId = '';
  b.recall = false;
  b.recallAt = 0;
  b.returnHome = true;
  // A released dot still lands before walking home.
  if (b.mode === 'airborne' || b.mode === 'landing') return;
  if (b.mode === 'windup' && b.origin) Object.assign(b, point(b.origin));
  b.y = botGroundHeight(b.x, b.z);
  b.origin = b.landing = null;
  b.throwAt = 0;
  setMode(b, 'goingHome', now);
}

function handleBotCare(
  room: BotRoom,
  p: PlayerSnapshot,
  action: string,
  target: unknown,
  now: number,
) {
  if (action === 'dismissBot' || action === 'dismissBots') {
    const selected = room.orbBots!.filter(
      (b) => b.ownerId === p.id && (action === 'dismissBots' || target === b.kind),
    );
    const groups = new Set(selected.map((b) => b.petGroupLeaderId).filter(Boolean));
    const unfinished = room.orbBots!.filter(
      (b) => b.petPlayerId === p.id && (action === 'dismissBots' || groups.has(b.petGroupLeaderId)),
    );
    for (const pet of unfinished) cancelBotPet(pet, now);
    for (const b of selected) {
      if (b.kind === '524' && room.companion524) returnCompanion524(room.companion524);
      else if (b.kind === 'rimo-neko' && room.rimoNeko) returnRimoNeko(room.rimoNeko);
      else sendBotHome(b, now);
    }
    syncOrbBots(room, now);
    return selected.length > 0 || unfinished.length > 0;
  }
  if (
    pettingOrbBot(room.orbBots, p.id) ||
    room.rimoNeko?.petPlayerId === p.id ||
    room.mae?.petPlayerId === p.id ||
    room.kohaku?.petPlayerId === p.id ||
    room.companion524?.petPlayerId === p.id
  )
    return false;
  const group = action === 'petBots';
  const plans = group
    ? groupBotPetPlans(room.orbBots!, p, room.collision, now, new Set(room.players.keys()))
    : room
        .orbBots!.filter(
          (b) =>
            b.id === target &&
            !b.busy &&
            nearOrbBot(p, b, room.collision, now) &&
            room.collision.segmentFree(b, botPetPosition(p, b).goal, ORB_BOTS.radius),
        )
        .map((bot) => ({ bot, ...botPetPosition(p, bot) }));
  if (!plans.length) return false;
  releaseHeldOrbBot(room, p, now);
  p.facing = plans[0].facing;
  for (const { bot: candidate, goal, facing } of plans) {
    const b = room.orbBots!.find((bot) => bot.id === candidate.id)!;
    // Every accepted member joins together, even if the shared gesture is interrupted.
    bondBot(p, b);
    setMode(b, 'following', now);
    b.petPlayerId = p.id;
    b.petAt = now;
    b.petContactAt = 0;
    b.petOrigin = point(p);
    b.petGoal = goal;
    b.petFacing = facing;
    b.petCharacter = `${p.species}/${p.gender}`;
    b.petWarpSequence = p.warpSequence ?? 0;
    b.petMode = b.mode;
    b.petGroupLeaderId = group ? plans[0].bot.id : undefined;
    b.busy = true;
    b.speed = 0;
    b.path = [];
    b.recallAt = 0;
  }
  return true;
}

function cancelBotPet(b: OrbBot, now: number) {
  clearBotPet(b);
  b.petContactAt = 0;
  if (!b.ownerId) sendBotHome(b, now);
  else setMode(b, b.petMode === 'waiting' ? 'waiting' : 'following', now);
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

function bondBot(p: PlayerSnapshot, b: OrbBot) {
  b.ownerId = p.id;
  b.returnHome = false;
  b.lastOwner = point(p);
  b.warpSequence = p.warpSequence ?? 0;
  b.throwAt = b.recallAt = 0;
  b.origin = b.landing = null;
  b.recall = false;
}

function finishBotPet(p: PlayerSnapshot, b: OrbBot, now: number) {
  bondBot(p, b);
  clearBotPet(b);
  setMode(b, 'following', now);
}

/** Everyone gathers together, then shares one stroke, one reaction and one completion. */
function updateBotPetGroups(room: BotRoom, dt: number, now: number) {
  const grouped = new Map<string, OrbBot[]>();
  for (const b of room.orbBots ?? []) {
    if (!b.petPlayerId || !b.petGroupLeaderId) continue;
    const group = grouped.get(b.petPlayerId) ?? [];
    group.push(b);
    grouped.set(b.petPlayerId, group);
  }
  for (const [playerId, group] of grouped) {
    const p = room.players.get(playerId);
    const leader = group.find((b) => b.id === b.petGroupLeaderId);
    if (
      !p ||
      !leader ||
      group.some(
        (b) =>
          !b.petGoal ||
          botPetInterrupted(p, b, now) ||
          !nearOrbBot(p, b, room.collision, now, ORB_BOTS.petGroupRange) ||
          (!b.petContactAt && now - b.petAt! > ORB_BOTS.petGroupApproachMs),
      )
    ) {
      for (const b of group) cancelBotPet(b, now);
      continue;
    }
    if (!leader.petContactAt) {
      // Map first: every bot moves in this tick, even if an earlier one has not arrived.
      const arrived = group.map((b) => approachBotPet(room, p, b, dt));
      if (arrived.every(Boolean))
        for (const b of group) {
          b.petContactAt = now;
          b.speed = 0;
        }
    } else if (now >= leader.petContactAt + ORB_BOTS.petStrokeMs + ORB_BOTS.happyMs) {
      for (const b of group) finishBotPet(p, b, now);
    }
  }
}

function updateBotPet(room: BotRoom, b: OrbBot, dt: number, now: number) {
  if (b.petPlayerId && b.petGroupLeaderId) return true;
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
    finishBotPet(p, b, now);
  }
  return true;
}

function updateBotHome(room: BotRoom, b: OrbBot, dt: number, now: number) {
  if (b.mode === 'airborne' || b.mode === 'landing') {
    updateDeployedBot(b, now);
    if (b.mode === 'airborne' || b.mode === 'landing') return;
  }
  if (b.mode !== 'goingHome') setMode(b, 'goingHome', now);
  const goal = room.collision.nearestFree(b.home!, ORB_BOTS.radius, [], 3);
  if (!goal) return;
  if (distance(b, goal) < 0.06) {
    Object.assign(b, goal, {
      y: botGroundHeight(goal.x, goal.z),
      facing: BOT_CAMP_PLACES[b.kind as (typeof BOT_KINDS)[number]]?.facing ?? 0,
    });
    b.returnHome = false;
    b.origin = b.landing = null;
    b.throwAt = 0;
    setMode(b, 'home', now);
    return;
  }
  if (room.collision.segmentFree(b, goal, ORB_BOTS.radius)) b.path = [goal];
  else if (now >= b.nextPathAt) {
    b.path = room.collision.path(b, goal, ORB_BOTS.radius);
    b.nextPathAt = now + 1500;
  }
  const target = b.path[0],
    before = point(b);
  if (target) {
    const length = distance(b, target),
      amount = Math.min(length, dt * 3);
    if (length > 0.001)
      Object.assign(
        b,
        room.collision.move(
          b,
          ((target.x - b.x) / length) * amount,
          ((target.z - b.z) / length) * amount,
          ORB_BOTS.radius,
        ),
      );
    if (distance(b, target) < 0.06) b.path.shift();
  }
  b.speed = distance(before, b) / dt;
  b.y = botGroundHeight(b.x, b.z);
  if (b.speed > 0.03) {
    b.facing = Math.atan2(b.x - before.x, b.z - before.z);
    b.stuckAt = 0;
  } else {
    b.stuckAt ||= now;
    // Warps or newly closed passages may leave no route; finish at the checked home spot.
    if (now - b.stuckAt > 5000) Object.assign(b, goal, { y: botGroundHeight(goal.x, goal.z) });
  }
}

/** Persist accepted bonds without replaying petting or hand/flight animations. */
export function saveOrbBots(room: BotRoom) {
  return (room.orbBots ?? [])
    .filter((b) => !isCompanionBot(b.kind))
    .map((b) => {
      const waiting =
        !!b.ownerId && !b.recall && ['airborne', 'landing', 'waiting'].includes(b.mode);
      const position =
        b.mode === 'airborne' && b.landing
          ? b.landing
          : b.mode === 'windup' && b.origin
            ? b.origin
            : b;
      return {
        kind: b.kind,
        ownerId: b.ownerId,
        ...point(position),
        facing: b.facing,
        mode: b.ownerId
          ? waiting
            ? 'waiting'
            : 'following'
          : b.mode === 'home' && !b.busy
            ? 'home'
            : 'goingHome',
      };
    });
}

export function restoreOrbBots(room: BotRoom, saved: unknown, now: number) {
  room.orbBots = [];
  syncOrbBots(room, now);
  if (!Array.isArray(saved)) return;
  for (const b of room.orbBots) {
    if (isCompanionBot(b.kind)) continue;
    const record = saved.find((r) => r && typeof r === 'object' && r.kind === b.kind);
    if (!record) continue;
    const ownerId = record.ownerId;
    if (
      typeof ownerId === 'string' &&
      ownerId &&
      (room.players.has(ownerId) ||
        [...(room.sessions?.values() ?? [])].some((entry) => entry.player.id === ownerId))
    )
      b.ownerId = ownerId;
    if (
      Number.isFinite(record.x) &&
      Number.isFinite(record.z) &&
      room.collision.free(record, ORB_BOTS.radius)
    )
      Object.assign(b, point(record), { y: botGroundHeight(record.x, record.z) });
    if (Number.isFinite(record.facing)) b.facing = record.facing;
    if (b.ownerId) setMode(b, record.mode === 'waiting' ? 'waiting' : 'following', now);
    else sendBotHome(b, now);
  }
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
    syncCompanionBot(room, b);
  }
}

export function handleOrbBotAction(
  room: BotRoom,
  p: PlayerSnapshot,
  action: string,
  kind: unknown,
  now: number,
): boolean {
  if (
    ![
      'throwBot',
      'recallBots',
      'cancelBotThrows',
      'petBot',
      'petBots',
      'dismissBot',
      'dismissBots',
    ].includes(action)
  )
    return false;
  syncOrbBots(room, now);
  if (['petBot', 'petBots', 'dismissBot', 'dismissBots'].includes(action))
    return handleBotCare(room, p, action, kind, now);
  if (action === 'recallBots') gatherNearbyBots(room, p, now);
  const bots = room.orbBots!.filter((b) => b.ownerId === p.id);
  if (action === 'cancelBotThrows') {
    releaseHeldOrbBot(room, p, now);
    return true;
  }
  if (action === 'recallBots') {
    for (const b of room.orbBots!)
      if (b.petPlayerId === p.id && b.petGroupLeaderId) cancelBotPet(b, now);
    releaseHeldOrbBot(room, p, now);
    for (const b of bots) {
      b.recall = true;
      b.recallAt =
        canHandleBot(p, now) &&
        room.rimoNeko?.petPlayerId !== p.id &&
        room.mae?.petPlayerId !== p.id &&
        room.kohaku?.petPlayerId !== p.id &&
        room.companion524?.petPlayerId !== p.id &&
        !pettingOrbBot(room.orbBots, p.id)
          ? now
          : 0;
      if (b.mode === 'waiting' || (b.kind === 'rimo-neko' && b.mode === 'following'))
        setMode(b, 'returning', now);
      syncCompanionBot(room, b);
    }
    return true;
  }
  if (
    !canHandleBot(p, now) ||
    room.rimoNeko?.petPlayerId === p.id ||
    room.mae?.petPlayerId === p.id ||
    room.kohaku?.petPlayerId === p.id ||
    room.companion524?.petPlayerId === p.id ||
    pettingOrbBot(room.orbBots, p.id)
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
  syncOrbBots(room, now);
  if (!(dt > 0) || !Number.isFinite(dt)) return;
  dt = Math.min(dt, 0.15);
  updateBotPetGroups(room, dt, now);
  for (const b of room.orbBots!) {
    if (!isCompanionBot(b.kind)) {
      if (updateBotPet(room, b, dt, now)) continue;
      if (b.returnHome) {
        updateBotHome(room, b, dt, now);
        continue;
      }
      if (!b.ownerId) {
        b.speed = 0;
        continue;
      }
    }
    const p = room.players.get(b.ownerId);
    const radius = botRadius(b.kind);
    const c = companionForBot(room, b.kind);
    if (c) {
      b.busy = companionBusy(c, b.kind, now);
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
      b.recallAt = 0;
      b.speed = 0;
      if (!updateDeployedBot(b, now)) {
        // Cancel the unlaunched gesture without expiring the friendship.
        if (b.mode === 'windup' && b.origin) Object.assign(b, point(b.origin));
        b.y = botRestHeight(b.kind, b.x, b.z);
        b.throwAt = 0;
        b.origin = b.landing = null;
        if (!isCompanionBot(b.kind) && b.home) {
          // Keep the saved owner, but make their following/stowed dots available
          // at camp instead of leaving invisible companions far from later arrivals.
          // Preserve the path between ticks so a detour can actually finish.
          if (b.mode !== 'home') updateBotHome(room, b, dt, now);
        } else {
          // Original NPC bodies follow their own safe campward routes while offline.
          setMode(b, 'following', now);
          if (c) b.facing = c.facing;
        }
      }
      continue;
    }
    if (!isCompanionBot(b.kind) && (b.mode === 'home' || b.mode === 'goingHome'))
      setMode(b, 'following', now);
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
  for (const b of room.orbBots!) syncCompanionBot(room, b);
}
