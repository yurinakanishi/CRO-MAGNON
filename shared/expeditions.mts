import { expeditionById } from './paleo-geography.mjs';
import { ADVENTURE_STOPS } from './adventure-regions.mjs';
import { stopActor } from './combat.mjs';
import { ridingObstacles } from './riding.mjs';

// Explicit map expeditions are a game travel shortcut, never an arbitrary
// client coordinate teleport or an assertion about prehistoric human migration.
export function takeExpedition(room, player, id, now = Date.now()) {
  const stop = expeditionById(id) ?? ADVENTURE_STOPS.find((s) => s.id === id);
  if (!stop) return { ok: false, text: '遠征先が見つかりません。' };
  if (player.downedUntil) return { ok: false, text: '回復してから遠征できます。' };
  if (player.mountId) return { ok: false, text: 'マンモスから降りてから遠征しよう。' };
  if (player.boatId) return { ok: false, text: '岸で船から降りてから遠征しよう。' };
  if (now - (player.lastExpeditionAt ?? -Infinity) < 3000)
    return { ok: false, text: '次の遠征まで少し待ってください。' };
  const point = room.collision.nearestFree(
    stop,
    player.radius,
    ridingObstacles(room, null, player),
    12,
  );
  if (!point) return { ok: false, text: '遠征先が混雑しています。少し待ってから試してください。' };
  stopActor(player);
  player.pendingStrike = null;
  player.cookingEndsAt = 0;
  player.runningRequested = false;
  room.projectiles = (room.projectiles ?? []).filter((p) => p.ownerId !== player.id);
  Object.assign(player, point, { lastExpeditionAt: now });
  return { ok: true, text: `${stop.name}の野営地に到着しました。` };
}
