import { CAVE_HEARTH } from './camp-cave-layout.mjs';
import { interactionVisible } from './interactions.mjs';

export function caveFireInteraction(state, player, collision) {
  if (
    !player ||
    player.downedUntil ||
    player.mountId ||
    player.boatId ||
    player.carrierId ||
    player.passengerId ||
    player.cookingEndsAt ||
    player.fishing ||
    player.coastalActivity ||
    Math.hypot(player.x - CAVE_HEARTH.x, player.z - CAVE_HEARTH.z) > 3.2 ||
    !collision ||
    !interactionVisible(collision, player, CAVE_HEARTH)
  )
    return null;
  return {
    action: 'toggleCaveFire',
    label: state.camp?.caveFireLit ? '洞窟の火を消す' : '洞窟の火を灯す',
  };
}

export function toggleCaveFire(room, player) {
  if (!caveFireInteraction(room, player, room.collision)) return false;
  room.camp.caveFireLit = !room.camp.caveFireLit;
  return true;
}
