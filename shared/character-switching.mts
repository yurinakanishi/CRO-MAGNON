import { switchCharacterById, characterSwitchUnavailable } from './character-switch.mjs';
import { WORLD } from './world.mjs';
import { stopActor } from './combat.mjs';
import { ridingObstacles } from './riding.mjs';
import { clearCarryOffer } from './carrying.mjs';

export function handleCharacterSwitch(room, player, message, now) {
  const model = switchCharacterById(message.targetId);
  const reason = characterSwitchUnavailable(player, model, now);
  if (reason) return { ok: false, text: reason };
  const radius = model.radius ?? WORLD.playerRadius;
  if (!room.collision.free(player, radius, ridingObstacles(room, null, player)))
    return { ok: false, text: 'ここでは体がぶつかります。少し広い場所で変更しよう。' };
  clearCarryOffer(room, player);
  stopActor(player);
  player.runningRequested = false;
  player.pendingStrike = null;
  room.projectiles = (room.projectiles ?? []).filter((p) => p.ownerId !== player.id);
  Object.assign(player, { species: model.species, gender: model.gender, radius });
  return { ok: true, text: `${model.name}に変わりました。` };
}
