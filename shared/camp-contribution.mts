import { attackProfile } from './combat-profiles.mjs';
import { GATHER_RANGE } from './interactions.mjs';
import { jumpProgress } from './jumping.mjs';
import type { CampSnapshot, PlayerSnapshot } from './snapshots.mjs';

/** The same eligibility and remaining quantities serve the hint and the server.
 * Callers also check the line of sight with interactionVisible.
 */
export function campContribution(
  camp: CampSnapshot | null | undefined,
  player: Partial<PlayerSnapshot> | null | undefined,
  now: number,
): { wood: number; stone: number } | null {
  if (
    !camp ||
    camp.level > 0 ||
    !player?.inventory ||
    !Number.isFinite(player.x) ||
    !Number.isFinite(player.z) ||
    Math.hypot(player.x! - camp.x, player.z! - camp.z) > GATHER_RANGE ||
    player.downedUntil ||
    player.mountId ||
    player.boatId ||
    player.carrierId ||
    player.passengerId ||
    player.cookingEndsAt ||
    player.fishing ||
    player.coastalActivity ||
    jumpProgress(player, now) !== null ||
    (player.attackSequence && now - (player.attackAt ?? 0) < attackProfile(player).durationMs)
  )
    return null;
  const wood = Math.min(Math.max(0, camp.goalWood - camp.wood), player.inventory.wood);
  const stone = Math.min(Math.max(0, camp.goalStone - camp.stone), player.inventory.stone);
  return wood > 0 || stone > 0 ? { wood, stone } : null;
}
