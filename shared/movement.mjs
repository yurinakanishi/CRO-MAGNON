import { WORLD, worldClamp } from './world.mjs';
import { characterModel } from './characters.mjs';

export function movePlayer(player, dt, now, move = (p, dx, dz) => ({ x: p.x + dx, z: p.z + dz }), configuredSpeed) {
  const character=characterModel(player);
  const maximumSpeed = configuredSpeed ?? (player.runningRequested ? character.runSpeed??WORLD.runSpeed : character.walkSpeed??WORLD.walkSpeed);
  let dx = 0, dz = 0, distance = maximumSpeed * dt;
  if (player.target) {
    dx = player.target.x - player.x; dz = player.target.z - player.z;
    const remaining = Math.hypot(dx, dz);
    if (remaining > .015) { dx /= remaining; dz /= remaining; distance = Math.min(distance, remaining); }
    else { dx = 0; dz = 0; player.target = null; }
  } else if (now - player.lastInput < 500) {
    dx = player.dx; dz = player.dz;
    const length = Math.max(1, Math.hypot(dx, dz)); dx /= length; dz /= length;
  }
  const beforeX = player.x, beforeZ = player.z;
  const next = move(player, dx * distance, dz * distance);
  player.x = worldClamp(next.x, 'x');
  player.z = worldClamp(next.z, 'z');
  const actualX = player.x - beforeX, actualZ = player.z - beforeZ;
  player.speed = dt > 0 ? Math.hypot(actualX, actualZ) / dt : 0;
  player.moving = player.speed > .025;
  player.running = player.moving && player.runningRequested;
  // Include the final short step; do not leave facing at the preceding turn.
  if (player.moving) player.facing = Math.atan2(actualX, actualZ);
  if (player.target && Math.hypot(player.x - player.target.x, player.z - player.target.z) < .015) player.target = null;
}
