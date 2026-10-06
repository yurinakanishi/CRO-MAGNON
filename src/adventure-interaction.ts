import {
  regionAt,
  adventureProgress,
  regionComplete,
  travelSeals,
  riftNear,
} from '../shared/adventure-regions.mjs';

/** Regional reports, rest and rifts are direct interactions in the world. */
export function adventureInteraction(player, collision) {
  const rift = riftNear(player);
  if (rift && (!collision || collision.segmentFree(player, rift, 0.12)))
    return {
      action: 'rift',
      targetId: rift.id,
      label: rift.exit
        ? '地上へ戻る'
        : travelSeals(player) >= 3
          ? '裂け目から影の世界へ'
          : '裂け目を調べる（旅の証3つ）',
    };
  const region = player && regionAt(player.x, player.z);
  if (
    region &&
    Math.hypot(player.x - region.camp.x, player.z - region.camp.z) <= 5 &&
    (!collision || collision.segmentFree(player, region.camp, 0.12))
  ) {
    if (regionComplete(player, region) && !adventureProgress(player, region.id).claimed)
      return { action: 'claimAdventure', targetId: region.id, label: '地域の依頼を報告する' };
    if (player.energy < 100) return { action: 'rest', label: '焚き火で休む（元気 +35）' };
  }
  return null;
}
