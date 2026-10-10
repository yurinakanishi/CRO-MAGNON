import { equippedItem, equipmentInfo, ownsEquipment } from './equipment.mjs';
import { attackProfile } from './combat-profiles.mjs';
import { jumpProgress } from './jumping.mjs';

export function equipmentReason(player, id: unknown, now: number): string {
  if (!player) return '接続を待っています。';
  if (!ownsEquipment(player, id)) return 'この装備は持っていません。';
  if (player.downedUntil) return '回復してから装備できます。';
  if (player.mountId || player.boatId || player.carrierId || player.passengerId)
    return '地上に降りてから装備できます。';
  if (
    jumpProgress(player, now) !== null ||
    player.cookingEndsAt ||
    player.fishing ||
    player.coastalActivity ||
    (player.attackSequence && now - player.attackAt < attackProfile(player).durationMs)
  )
    return '今の動作が終わると装備できます。';
  return '';
}

export function equipItem(player, id: unknown, now: number) {
  const reason = equipmentReason(player, id, now);
  if (reason || !ownsEquipment(player, id)) return { ok: false, text: reason };
  player.equippedItem = id;
  return { ok: true, text: `${equipmentInfo(player, equippedItem(player)).name}を装備しました。` };
}
