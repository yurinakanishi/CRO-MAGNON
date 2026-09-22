import { warpDestination, warpUnavailable } from './warp-sites.mjs';
import { roomRules } from './room-rules.mjs';
import { spawnFacing } from './spawn-sites.mjs';
import { stopActor } from './combat.mjs';
import { ridingObstacles } from './riding.mjs';
import { clearCarryOffer } from './carrying.mjs';

export function handleWarpAction(room, player, message, now) {
  const destination = warpDestination(message.targetId, roomRules(room).spawnChoice);
  const reason = warpUnavailable(player, destination, now);
  if (reason) return { ok: false, text: reason };
  // Never trust coordinates from a client, and never land inside the fire.
  const point = room.collision.nearestFree(
    destination,
    player.radius,
    ridingObstacles(room, null, player),
    8,
  );
  if (!point) return { ok: false, text: '焚き火の周りが混雑しています。少し待ってから試そう。' };
  clearCarryOffer(room, player);
  stopActor(player);
  player.runningRequested = false;
  player.pendingStrike = null;
  room.projectiles = (room.projectiles ?? []).filter((p) => p.ownerId !== player.id);
  Object.assign(player, point, {
    lastExpeditionAt: now,
    warpSequence: (player.warpSequence ?? 0) + 1,
  });
  if ('look' in destination) player.facing = spawnFacing(point, destination);
  return { ok: true, text: `${destination.name}へワープしました。` };
}
