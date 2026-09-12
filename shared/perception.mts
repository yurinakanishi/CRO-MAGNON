// How territorial creatures notice players without seeing them: footsteps carry
// further the faster a player moves, in every direction, but a player who stands
// still can creep to three metres. Being struck always gives the attacker away.
export const HEARING = Object.freeze({ still: 3, walking: 9, running: 16 });

export function hearingRange(player, hearing = HEARING) {
  return player.running ? hearing.running : player.moving ? hearing.walking : hearing.still;
}

export const heard = (listener, player, hearing = HEARING) =>
  Math.hypot(listener.x - player.x, listener.z - player.z) <= hearingRange(player, hearing);

// Sound crosses walls but not floors: a player on another castle level is not heard.
export const sameFloor = (room, a, b) =>
  Math.abs((room.collision.surfaceHeight?.(a) ?? 0) - (room.collision.surfaceHeight?.(b) ?? 0)) <=
  1.4;

// A creature that was just hit turns on its attacker if that player is a valid
// target. Consumed once; the caller decides how the creature reacts.
export function provoker(room, enemy, eligible) {
  const id = enemy.provokedBy;
  if (!id) return null;
  enemy.provokedBy = null;
  const player = room.players.get(id);
  return eligible(player) ? player : null;
}
