// Resources must be within this many metres of the player to be gathered
// (server check and client hint alike).
export const GATHER_RANGE = 3.5;

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
