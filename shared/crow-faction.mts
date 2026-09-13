import { CASTLE_TIERS, castleTierOfHeight, castleWorld, nearCastle } from './castle-layout.mjs';
import { CASTLE_SURFACE } from './castle-surface.mjs';

// 2026-09-13: the White-Feather cult is fought as five ranks, one after the
// other. Each rank keeps to its own part of the keep (its "ward") and every
// rank above the one currently standing prays behind a seal: it cannot be
// hurt and does not fight until the whole rank below it has fallen. The order
// of the assault is therefore fixed: lay followers in the forecourt, warrior
// monks on the stair heads, hex monks in the middle of the hall, the high
// priests at the rear, and finally the pontiff on the altar.
export const CROW_TIERS = Object.freeze(['soldier', 'brute', 'shaman', 'prelate', 'pontiff']);
export const CROW_FACTION_ROSTER = Object.freeze({
  pontiff: 1,
  prelate: 3,
  shaman: 6,
  brute: 6,
  soldier: 12,
});

const spell = Object.freeze({
  boltMinRange: 2.4,
  boltRange: 13,
  boltWindupMs: 900,
  boltSpeed: 9,
  boltReach: 16,
  boltRadius: 0.35,
  boltDamage: 12,
  boltCooldownMs: 3200,
  burstRange: 5.5,
  burstWindupMs: 1400,
  burstRadius: 4.5,
  burstDamage: 18,
  burstCooldownMs: 6500,
});

// Every rank reuses the verified crow rig, while size, durability, weapons and
// permitted combat styles make the hierarchy legible in play. Rank 1 and 2 are
// purely physical, rank 3 fights with the red magic (its staff is only a weak
// last resort), ranks 4 and 5 are deliberate hybrids; the high priests also
// patrol and cast from the air.
export const CROW_ROLE_RULES = Object.freeze({
  soldier: Object.freeze({
    tier: 1,
    title: '第一階位',
    name: '黒羽の門徒',
    scale: 0.96,
    radius: 0.45,
    maxHealth: 60,
    roamSpeed: 0.8,
    chaseSpeed: 1.9,
    aggroRange: 11,
    leashRadius: 26,
    loseTargetRange: 30,
    attackReach: 0.9,
    attackDamage: 9,
    attackCooldownMs: 1300,
    attackDurationMs: 800,
    attackImpactMs: 360,
    physical: true,
    magic: false,
    flying: false,
    flightHeight: 0,
    ...spell,
  }),
  brute: Object.freeze({
    tier: 2,
    title: '第二階位',
    name: '黒羽の戦僧',
    scale: 1.34,
    radius: 0.64,
    maxHealth: 180,
    roamSpeed: 0.62,
    chaseSpeed: 1.55,
    aggroRange: 13,
    leashRadius: 22,
    loseTargetRange: 26,
    attackReach: 1.15,
    attackDamage: 24,
    attackCooldownMs: 1900,
    attackDurationMs: 1100,
    attackImpactMs: 550,
    physical: true,
    magic: false,
    flying: false,
    flightHeight: 0,
    ...spell,
  }),
  shaman: Object.freeze({
    tier: 3,
    title: '第三階位',
    name: '白羽の呪僧',
    scale: 1,
    radius: 0.48,
    maxHealth: 90,
    roamSpeed: 0.7,
    chaseSpeed: 1.65,
    aggroRange: 14,
    leashRadius: 22,
    loseTargetRange: 26,
    attackReach: 0.6,
    attackDamage: 10,
    attackCooldownMs: 1800,
    attackDurationMs: 1000,
    attackImpactMs: 450,
    physical: true,
    magic: true,
    flying: false,
    flightHeight: 0,
    ...spell,
  }),
  prelate: Object.freeze({
    tier: 4,
    title: '第四階位',
    name: '白羽の大司祭',
    scale: 1.18,
    radius: 0.55,
    maxHealth: 170,
    roamSpeed: 1.05,
    chaseSpeed: 2.2,
    aggroRange: 16,
    leashRadius: 30,
    loseTargetRange: 34,
    attackReach: 0.82,
    attackDamage: 18,
    attackCooldownMs: 1700,
    attackDurationMs: 950,
    attackImpactMs: 475,
    physical: true,
    magic: true,
    flying: true,
    flightHeight: 2.4,
    ...spell,
    boltDamage: 15,
    boltCooldownMs: 2800,
    burstDamage: 20,
    burstCooldownMs: 6000,
  }),
  pontiff: Object.freeze({
    tier: 5,
    title: '第五階位',
    name: '白羽教皇',
    scale: 1.65,
    radius: 0.72,
    maxHealth: 420,
    roamSpeed: 0.55,
    chaseSpeed: 1.35,
    aggroRange: 17,
    leashRadius: 34,
    loseTargetRange: 38,
    attackReach: 1,
    attackDamage: 28,
    attackCooldownMs: 2200,
    attackDurationMs: 1200,
    attackImpactMs: 600,
    physical: true,
    magic: true,
    flying: false,
    flightHeight: 0,
    ...spell,
    boltDamage: 20,
    boltRadius: 0.48,
    boltCooldownMs: 2600,
    burstRange: 7,
    burstRadius: 5.8,
    burstDamage: 28,
    burstCooldownMs: 5600,
  }),
});

// Castle-local posts (metres) on the stepped fortress: each rank holds one
// level. The forecourt lies at z 28..57 behind the gate (-2, 60); the first
// terrace ring at z 13..27 around the second; the second terrace's front strip
// at z 3..12; the third terrace around the summit; the summit altar at
// x -17..3, z -22..-8 with the throne block near its middle. Central stairs run
// up the x = 0 line; every post keeps clear of them.
const FORMATION = Object.freeze({
  // Keep shaman first for backwards-compatible encounter fixtures and IDs.
  shaman: [
    [-29, 7],
    [14, 6],
    [-34, 0],
    [18, 0],
    [20, -12],
    [-31, -30],
  ],
  pontiff: [[-10, -20]],
  prelate: [
    [-22, -6],
    [8, -6],
    [-7, -25],
  ],
  brute: [
    [-34, 24],
    [-22, 22],
    [-10, 24],
    [4, 24],
    [15.5, 21.5],
    [30, 23],
  ],
  soldier: [
    [-30, 37.5],
    [-20, 34],
    [18, 34],
    [30, 36],
    [-36, 45],
    [-20, 45],
    [0, 45],
    [20, 45],
    [36, 45],
    [-24, 52],
    [-6, 52],
    [12, 52],
  ],
});

const rolePrefix = {
  pontiff: 'crow-pontiff',
  prelate: 'crow-prelate',
  shaman: 'crow-shaman',
  brute: 'crow-brute',
  soldier: 'crow-soldier',
};
// The upper terraces are cluttered with column stumps: the casters keep shorter beats.
const roamRadius = { pontiff: 1.2, prelate: 2.2, shaman: 2, brute: 1.8, soldier: 1.6 };

export const CROW_FACTION_GROUNDS = Object.freeze(
  Object.entries(FORMATION).flatMap(([crowRole, points]) =>
    points.map(([x, z], index) => {
      const rules = CROW_ROLE_RULES[crowRole];
      return Object.freeze({
        id: `${rolePrefix[crowRole]}-${index + 1}`,
        ...castleWorld(x, z),
        radius: 5,
        roamRadius: roamRadius[crowRole],
        name: rules.name,
        maxHealth: rules.maxHealth,
        crowRole,
        crowTier: rules.tier,
      });
    }),
  ),
);

export function crowRules(enemy) {
  return CROW_ROLE_RULES[enemy?.crowRole] ?? CROW_ROLE_RULES.shaman;
}
export const crowTier = (enemy) => crowRules(enemy).tier;
export const crowRoleOfTier = (tier) => CROW_TIERS[tier - 1] ?? null;

// The altar every sealed rank faces while it prays: the throne on the summit.
export const CROW_ALTAR = Object.freeze({ ...castleWorld(-6, -15), name: '白羽教団の祭壇' });

// Which level of the keep a point stands on (0 outside the measured floors).
const castleHeight = (point) => CASTLE_SURFACE.height(point.x, point.z);
export const castleTierAt = (point) => {
  const h = castleHeight(point);
  return Number.isFinite(h) ? castleTierOfHeight(h) : 0;
};
// Any level above the forecourt (kept for callers that only need "up in the keep").
export const inCastleHall = (point) => castleTierAt(point) >= 2;
// A rank may notice a player on, chase through and stand on its own level only.
// The forecourt rank also owns the stairs up to the first terrace (their lower
// half reads as the forecourt), and so on up: a stair's upper half belongs to
// the level it climbs to.
export function inCrowWard(enemy, point) {
  return castleTierAt(point) === crowRules(enemy).tier;
}
export const crowTierLevel = (tier) => CASTLE_TIERS[tier - 1];

export const castleOccupied = (room) =>
  [...room.players.values()].some(
    (player) => !player.downedUntil && nearCastle(player.x, player.z),
  );

// Rite texts: what the players in the keep are told when a rank falls.
export const CROW_RITE_TEXT = Object.freeze({
  2: '門徒の祈りが途絶えた。第二階位・黒羽の戦僧が斧を取り、階段の上で立ち上がる！',
  3: '戦僧が倒れた。第三階位・白羽の呪僧が広間で呪詞を唱え始めた！',
  4: '呪僧の詠唱が止んだ。第四階位・白羽の大司祭が羽を広げて舞い上がる！',
  5: '大司祭が墜ちた。白羽教皇が祭壇から立ち上がり、杖を掲げた！',
  6: '白羽教皇が倒れた。大聖城の祈りは止み、教団は沈黙した。',
  reform: '大聖城に再び祈りの声が満ちた。白羽教団が集い直している。',
});
export function crowSealNotice(room) {
  const tier = room?.crowRite?.openTier ?? 1;
  const rules = CROW_ROLE_RULES[crowRoleOfTier(tier)] ?? CROW_ROLE_RULES.soldier;
  return `祈りの結界に阻まれた。先に${rules.title}・${rules.name}を全て倒せ。`;
}
