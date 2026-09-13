// 2026-09-13: the keep was rebuilt as a stepped temple-fortress (revision 13 of
// the TRELLIS castle): a walled forecourt behind a collapsed arch gate, then
// three progressively smaller roofless terraces stacked like a ziggurat, and a
// small summit altar platform with the ruined throne on top. Every level is
// joined to the next by a grand central stair and two flanking side stairs.
// The crow cult is fought one level at a time, its five ranks matching the five
// levels, the pontiff on the summit.
//
// The reconstruction's forecourt floor sits 13.4 m above the model's base (the
// outer walls continue down to an apron below it); the model is sunk by that
// much so the forecourt meets the valley floor. The walk atlas is levelled to
// world terms, so tier floors below read as heights above the valley.
const SCALE = 1;
export const CASTLE = Object.freeze({
  id: 'valley-castle',
  key: 'valley-castle',
  name: '白羽教団の大聖城',
  // The same centre and heading as the previous keep: 102.956301 m from the
  // camp, the gate turned back toward it.
  x: 151.6733430370152,
  z: 33.79718186001477,
  yaw: -1.4127636728014257,
  scale: SCALE,
  // Half of the 110 x 128 m footprint's diagonal, rounded up.
  clearance: 86,
  groundOffset: -13.4 * SCALE,
  plinth: 13.4 * SCALE,
});
export function castleWorld(x, z) {
  const c = Math.cos(CASTLE.yaw),
    s = Math.sin(CASTLE.yaw);
  return {
    x: CASTLE.x + (c * x + s * z) * CASTLE.scale,
    z: CASTLE.z + (-s * x + c * z) * CASTLE.scale,
  };
}
export function castleLocal(x, z) {
  const c = Math.cos(CASTLE.yaw),
    s = Math.sin(CASTLE.yaw),
    dx = x - CASTLE.x,
    dz = z - CASTLE.z;
  return { x: (c * dx - s * dz) / CASTLE.scale, z: (s * dx + c * dz) / CASTLE.scale };
}

// The five levels, bottom to top. `floor` is the measured terrace height above
// the valley floor; a point belongs to the highest tier whose `from` threshold
// (midway to the level below) it clears, so a stair's upper half already counts
// as the level it climbs to. `stair` is the grand central stair up to the next
// level (foot on this level, top on the next), in castle-local metres.
export const CASTLE_TIERS = Object.freeze(
  [
    {
      tier: 1,
      name: '前庭',
      floor: 0,
      from: -Infinity,
      post: [0, 44],
      stair: { foot: [0, 40], top: [0, 24] },
    },
    {
      tier: 2,
      name: '第一段',
      floor: 9.6,
      from: 4.8,
      post: [0, 23],
      stair: { foot: [0, 21], top: [0, 9] },
    },
    {
      tier: 3,
      name: '第二段',
      floor: 18.2,
      from: 13.9,
      post: [-2, 9],
      stair: { foot: [0, 8], top: [0, -2] },
    },
    {
      tier: 4,
      name: '第三段',
      floor: 25.8,
      from: 22,
      post: [0, -4],
      stair: { foot: [-2, -6], top: [-3, -11] },
    },
    { tier: 5, name: '祭壇', floor: 29.1, from: 27.4, post: [-10, -20], stair: null },
  ].map((tier) =>
    Object.freeze({
      ...tier,
      post: Object.freeze(castleWorld(tier.post[0], tier.post[1])),
      stair: tier.stair
        ? Object.freeze({
            foot: Object.freeze(castleWorld(tier.stair.foot[0], tier.stair.foot[1])),
            top: Object.freeze(castleWorld(tier.stair.top[0], tier.stair.top[1])),
          })
        : null,
    }),
  ),
);
// Tier index (1..5) of a walk-atlas height, or 0 for open ground outside the keep.
export function castleTierOfHeight(height) {
  if (!Number.isFinite(height)) return 0;
  let tier = 1;
  for (const level of CASTLE_TIERS) if (height >= level.from) tier = level.tier;
  return tier;
}
// The collapsed gate in the front wall, left of centre; the passage under its
// arch is the only measured opening, about two metres wide.
export const CASTLE_GATE = Object.freeze({
  ...castleWorld(-2, 60),
  name: '白羽教団の大聖城の城門',
});
export const CASTLE_STAIR_FOOT = CASTLE_TIERS[0].stair.foot;
export const CASTLE_STAIR_TOP = CASTLE_TIERS[0].stair.top;
// The middle terrace, where the hex monks are fought (the old "great hall").
export const CASTLE_HALL = Object.freeze({ ...CASTLE_TIERS[2].post, name: '白羽教団の第二段' });
export const CASTLE_SUMMIT = Object.freeze({ ...CASTLE_TIERS[4].post, name: '白羽教団の祭壇' });
// Where the first hex monk stands: clear terrace floor measured from the atlas.
export const CASTLE_SORCERER_POST = Object.freeze({
  ...castleWorld(-29, 7),
  name: '第二段の呪僧',
});
// Height that separates the forecourt from the first terrace (kept for callers
// that only distinguish "up in the keep" from the ground).
export const CASTLE_UPPER_FLOOR = CASTLE_TIERS[1].from;
// The keep's footprint (110 x 128 m, rotated) plus a margin: what counts as
// "in or at the castle" for scenery, the enemies' rite and respawn hold.
export const CASTLE_HALF_EXTENT = Object.freeze({ x: 55, z: 64 });
export const nearCastle = (x, z, margin = 0) => {
  const l = castleLocal(x, z);
  return (
    Math.abs(l.x) < CASTLE_HALF_EXTENT.x * CASTLE.scale + margin &&
    Math.abs(l.z) < CASTLE_HALF_EXTENT.z * CASTLE.scale + margin
  );
};
