import { inGulf as inArchivedGulf } from './gulf-archive.mjs';
import { isLand } from './paleo-geography.mjs';
import { stopActor } from './combat.mjs';

/** The caller owns a cloned save. Retire the island without resetting inventories or other lands. */
export function retireGulfRecord(record) {
  const moved = new Set();
  for (const entry of record.sessions ?? []) {
    const player = entry.player;
    if (player && inArchivedGulf(player.x, player.z) && !isLand(player.x, player.z)) {
      Object.assign(player, { x: 49, z: 52.4, boatId: null });
      stopActor(player);
      moved.add(player);
    }
  }
  for (const boat of record.boats ?? []) {
    const shore = boat.shore;
    if (shore && inArchivedGulf(shore.x, shore.z) && !isLand(shore.x, shore.z)) {
      // A real coast by the initial camp, already used by the boating checks.
      // restoreBoatMooring chooses an unoccupied launch nearby for each hull.
      boat.shore = { x: 128, z: 124 };
    }
  }
  return moved;
}
