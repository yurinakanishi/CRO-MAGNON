import { GULF, SETTLEMENTS } from './gulf-region.mjs';
import { inLegacyGulf, LEGACY_SETTLEMENTS } from './gulf-legacy.mjs';

function movePoint(point, local = false) {
  if (!point || !inLegacyGulf(point.x, point.z)) return false;
  const old =
    local && LEGACY_SETTLEMENTS.find((s) => Math.hypot(point.x - s.x, point.z - s.z) < 60);
  if (old) {
    const next = SETTLEMENTS.find((s) => s.id === old.id);
    point.x += next.x - old.x;
    point.z += next.z - old.z;
  } else {
    point.x = -2270 + (point.x + 1770) * 2;
    point.z = 450 + (point.z - 650) * 2;
  }
  return true;
}
/** The caller owns a cloned record. No reset of items, crops or achievements. */
export function migrateGulfRecord(record) {
  const movedPlayers = new Set();
  if (!record.gulf || record.gulf.version !== 1) return movedPlayers;
  for (const boat of record.boats ?? []) {
    movePoint(boat);
    movePoint(boat.mooring);
    movePoint(boat.shore);
  }
  for (const entry of record.sessions ?? []) {
    const p = entry.player;
    if (p && movePoint(p, !p.boatId)) movedPlayers.add(p);
  }
  record.gulf.version = GULF.version;
  return movedPlayers;
}
