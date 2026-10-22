import { WORLD } from './world.mjs';

// Resources must be within this many metres of a human-sized player to be gathered
// (server check and client hint alike).
export const GATHER_RANGE = 1;
// A broader body reaches as far from its own edge as a human does: the ape cannot
// stand within 1 m of any pile.
export const gatherRange = (player) =>
  GATHER_RANGE + Math.max(0, (player?.radius ?? WORLD.playerRadius) - WORLD.playerRadius);

export const CAMP_CONTRIBUTION_RANGE = 3.5;

// Ignore only the destination's own solid model. Interactions still require a
// clear path through every intervening tree, rock, building and landmark.
export function interactionVisible(collision, player, target) {
  return collision.segmentFree(
    player,
    target,
    0.12,
    [],
    (obstacle) =>
      (target.id && obstacle.resourceId === target.id) ||
      (obstacle.groundX === target.x && obstacle.groundZ === target.z) ||
      (obstacle.id === 'orl' && target.name === 'オル'),
  );
}
