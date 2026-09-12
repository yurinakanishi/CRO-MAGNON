// 2026-09-12: the keep was rebuilt as a broad two-storey ruin (revision 10 of
// the TRELLIS castle): an open forecourt behind a collapsed gate, three very
// wide stairs, and one enormous roofless great hall on top where the sorcerer
// is fought. The reconstruction stands on a 1.28 m plinth; the model is sunk by
// that much so the forecourt meets the valley floor (the walk atlas keeps model
// heights and the outside ground reads 1.28 there).
export const CASTLE = Object.freeze({
  id: 'valley-castle',
  key: 'valley-castle',
  name: '白羽の城跡',
  x: 140,
  z: 0,
  yaw: -1.05,
  scale: 1,
  clearance: 57,
  groundOffset: -1.28,
  plinth: 1.28,
  hallFloor: 6.85,
});
export function castleWorld(x, z) {
  const c = Math.cos(CASTLE.yaw),
    s = Math.sin(CASTLE.yaw);
  return { x: CASTLE.x + c * x + s * z, z: CASTLE.z - s * x + c * z };
}
export function castleLocal(x, z) {
  const c = Math.cos(CASTLE.yaw),
    s = Math.sin(CASTLE.yaw),
    dx = x - CASTLE.x,
    dz = z - CASTLE.z;
  return { x: c * dx - s * dz, z: s * dx + c * dz };
}
// The collapsed gate is in the front wall's left half; the hall is the whole
// upper floor. The central stair runs from the forecourt (z 12) to the hall (z 4).
export const CASTLE_GATE = Object.freeze({ ...castleWorld(-9, 40), name: '白羽の城跡の城門' });
export const CASTLE_STAIR_FOOT = Object.freeze({ ...castleWorld(0, 15), name: '中央の大階段の下' });
export const CASTLE_STAIR_TOP = Object.freeze({ ...castleWorld(0, 1), name: '中央の大階段の上' });
export const CASTLE_HALL = Object.freeze({ ...castleWorld(0, -16), name: '白羽の城跡の大広間' });
// Where the sorcerer stands: a clear span of hall floor measured from the atlas.
export const CASTLE_SORCERER_POST = Object.freeze({
  ...castleWorld(-0.2, -18.0),
  name: '大広間の呪術師',
});
// Model-space floor height that separates the hall from the forecourt.
export const CASTLE_UPPER_FLOOR = 4.5;
export const nearCastle = (x, z, margin = 0) =>
  Math.hypot(x - CASTLE.x, z - CASTLE.z) < CASTLE.clearance + margin;
