import { SCENERY } from './scenery-layout.mjs';
import { EXPEDITION_STOPS } from './paleo-geography.mjs';
import { ADVENTURE_REGIONS, travelSeals } from './adventure-regions.mjs';
import { SETTLEMENTS, GULF_STOPS } from './gulf-region.mjs';
import { jumpProgress } from './jumping.mjs';
import { attackProfile } from './combat-profiles.mjs';

const names = new Map([
  ['fire-50-50', 'はじまりの焚き火'],
  ['fire-72-43', 'オルの集落'],
  ...EXPEDITION_STOPS.map((s) => [`fire-${s.id}`, s.name]),
  ...ADVENTURE_REGIONS.map((s) => [`adventure-fire-${s.id}`, s.name]),
  ...[...SETTLEMENTS, ...GULF_STOPS].map((s) => [`gulf-fire-${s.id}`, s.name]),
] as [string, string][]);

/** Same authored fire coordinates as cooking, scenery and server collision. */
export const WARP_POINTS = Object.freeze(
  SCENERY.fires.map((fire) => {
    const id = fire.id ?? `fire-${fire.x}-${fire.z}`;
    return Object.freeze({
      id,
      name: names.get(id) ?? '野営地の焚き火',
      x: fire.x,
      z: fire.z,
      requiredSeals: id === 'adventure-fire-shadow-realm' ? 3 : 0,
    });
  }),
);
export const warpPointById = (id) => WARP_POINTS.find((p) => p.id === id);

export function warpUnavailable(player, point, now) {
  if (!player) return '接続を待っています。';
  if (!point) return '地図の炎マークか一覧から焚き火を選ぼう。';
  if (player.downedUntil) return '回復してからワープできます。';
  if (player.boatId || player.mountId || player.carrierId || player.passengerId)
    return '船・マンモス・肩から降りてからワープしよう。';
  if (jumpProgress(player, now) !== null) return '着地してからワープしよう。';
  if (player.cookingEndsAt || player.fishing || player.coastalActivity)
    return '作業を終えるか中止してからワープしよう。';
  if (player.attackSequence && now - player.attackAt < attackProfile(player).durationMs)
    return '攻撃が終わってからワープしよう。';
  if (point.requiredSeals && travelSeals(player) < point.requiredSeals)
    return '影の庭へは、地上の地域依頼を3つ達成して旅の証を集めよう。';
  if (now - (player.lastExpeditionAt ?? -Infinity) < 3000) return '次のワープまで3秒ほど待とう。';
  return '';
}
