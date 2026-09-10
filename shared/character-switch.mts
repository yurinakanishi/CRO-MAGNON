import { CHARACTER_MODELS, characterModel } from './characters.mjs';
import { jumpProgress } from './jumping.mjs';
import { attackProfile } from './combat-profiles.mjs';

export const switchCharacterById = (id) => CHARACTER_MODELS.find((model) => model.key === id);

export function characterSwitchUnavailable(player, model, now) {
  if (!player) return '接続を待っています。';
  if (!model) return 'キャラクターを選ぼう。';
  if (characterModel(player).key === model.key) return '今のキャラクターです。';
  if (player.downedUntil) return '回復してから変更できます。';
  if (player.boatId || player.mountId || player.carrierId || player.passengerId)
    return '船・マンモス・肩から降りてから変更できます。';
  if (jumpProgress(player, now) !== null) return '着地してから変更できます。';
  if (player.cookingEndsAt || player.fishing || player.coastalActivity)
    return '作業を終えるか中止してから変更できます。';
  if (player.attackSequence && now - player.attackAt < attackProfile(player).cooldownMs)
    return '攻撃の準備が整ってから変更できます。';
  return '';
}
