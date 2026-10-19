// Solid resources use their outside edge; passable plants use their centre.
// The server check and every client input use the same one-metre reach.
export const GATHER_RANGE = 1;

export function gatherDistance(collision, player, resource): number {
  return (
    collision?.resourceDistance?.(player, resource.id) ??
    Math.hypot(player.x - resource.x, player.z - resource.z)
  );
}

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
