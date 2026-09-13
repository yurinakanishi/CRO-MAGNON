// 2026-09-12: the keep was rebuilt as a broad two-storey ruin (revision 10 of
// the TRELLIS castle): an open forecourt behind a collapsed gate, three very
// wide stairs, and one enormous roofless great hall on top where the sorcerer
// is fought. The reconstruction stands on a 1.28 m plinth; the model is sunk by
// that much so the forecourt meets the valley floor (the walk atlas keeps model
// heights and the outside ground reads 1.28 there).
const SCALE = 1.2;
export const CASTLE = Object.freeze({
  id: 'valley-castle',
  key: 'valley-castle',
  name: '白羽教団の大聖城',
  // Rotate the old camp-relative vector 20 degrees toward map-south. Its
  // length remains exactly the same, while the sabertooth is now much farther
  // from the castle centre. The gate is turned back toward the camp.
  x: 151.6733430370152,
  z: 33.79718186001477,
  yaw: -1.4127636728014257,
  scale: SCALE,
  clearance: 69,
  groundOffset: -1.28 * SCALE,
  plinth: 1.28 * SCALE,
  hallFloor: 6.85 * SCALE,
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
// The collapsed gate is in the front wall's left half; the hall is the whole
// upper floor. The central stair runs from the forecourt (z 12) to the hall (z 4).
export const CASTLE_GATE = Object.freeze({
  // Use the centre of the continuously body-clear part of the broken gate.
  // At the enlarged scale this also admits the giant ape without grazing the
  // measured rubble cells on either side.
  ...castleWorld(-11, 40),
  name: '白羽教団の大聖城の城門',
});
export const CASTLE_STAIR_FOOT = Object.freeze({ ...castleWorld(0, 15), name: '中央の大階段の下' });
export const CASTLE_STAIR_TOP = Object.freeze({ ...castleWorld(0, 1), name: '中央の大階段の上' });
export const CASTLE_HALL = Object.freeze({ ...castleWorld(0, -16), name: '白羽教団の大聖堂広間' });
// Where the sorcerer stands: a clear span of hall floor measured from the atlas.
export const CASTLE_SORCERER_POST = Object.freeze({
  ...castleWorld(-0.2, -18.0),
  name: '大広間の呪術師',
});
// Model-space floor height that separates the hall from the forecourt.
export const CASTLE_UPPER_FLOOR = 4.5 * CASTLE.scale;
export const nearCastle = (x, z, margin = 0) =>
  Math.hypot(x - CASTLE.x, z - CASTLE.z) < CASTLE.clearance + margin;
