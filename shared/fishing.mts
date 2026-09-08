import { FISHING, FISHING_SITES } from './fishing-sites.mjs';
import { ensureGulfPlayer } from './gulf-life.mjs';
import { boardedBoat } from './boats.mjs';
import { stopActor } from './combat.mjs';
import { attackProfile } from './combat-profiles.mjs';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const moving = (actor) =>
  !!(
    actor.moving ||
    actor.target ||
    actor.path?.length ||
    Math.hypot(actor.dx || 0, actor.dz || 0) > 0.01
  );
const response = (text, changed = false) => ({ text, changed, tone: changed ? 'success' : 'info' });

export function cancelFishing(player) {
  player.fishing = null;
}

export function handleFishingAction(room, player, message, now) {
  const { action } = message;
  if (!['craftFishingKit', 'fish', 'cancelFishing'].includes(action)) return null;
  if (action === 'cancelFishing') {
    const active = !!player.fishing;
    cancelFishing(player);
    return response(active ? '魚を待つのをやめた。道具は手元にあります。' : '', active);
  }
  const progress = ensureGulfPlayer(player);
  if (
    player.downedUntil ||
    player.mountId ||
    player.cookingEndsAt ||
    (player.attackSequence && now - player.attackAt < attackProfile(player).durationMs)
  )
    return response('今の動作を終え、動ける状態で魚場へ行こう。');
  if (player.fishing) return response('魚を待っています。移動・E／×で中止できます。');
  if (action === 'craftFishingKit') {
    if (player.boatId) return response('岸で釣り道具を作ろう。');
    if (progress.fishingKit) return response('釣り道具はもう持っています。');
    if (player.inventory.wood < FISHING.wood || player.inventory.stone < FISHING.stone)
      return response('釣り道具には木材3・石1が必要です。');
    player.inventory.wood -= FISHING.wood;
    player.inventory.stone -= FISHING.stone;
    progress.fishingKit = true;
    return response('釣り道具ができた。湾の魚場でE／×。繰り返し使えます。', true);
  }
  if (!progress.fishingKit) return response('もちものから、木材3・石1で釣り道具を作ろう。');
  if (player.inventory.rawFish >= 99)
    return response('生魚の持ち物がいっぱいです。焼いて持ち寄ろう。');
  const site = FISHING_SITES.find((s) => s.id === message.targetId);
  if (!site || distance(player, site) > FISHING.range)
    return response('魚場に近づこう。沖の魚場には船が必要です。');
  const boat = boardedBoat(room, player);
  if ((site.boatOnly || player.boatId) && !boat) return response('この魚場には小舟で向かおう。');
  if (moving(boat || player)) return response('移動を止めてから魚を待とう。');
  if (!room.shoreCollision.segmentFree(player, site, 0.12))
    return response('魚場までの間がふさがれています。岸を回り込もう。');
  const shoal = room.gulf.shoals.find((s) => s.id === site.id);
  if (!shoal?.amount) return response('魚が散っています。別の魚場へ向かうか、戻るのを待とう。');
  stopActor(boat || player);
  if (!boat) player.facing = Math.atan2(site.x - player.x, site.z - player.z);
  player.fishing = {
    spotId: site.id,
    startedAt: now,
    endsAt: now + FISHING.durationMs,
    x: player.x,
    z: player.z,
    boatId: player.boatId || null,
    hurtSequence: player.hurtSequence || 0,
  };
  return response('魚を待っています。6秒静かに待とう。移動・E／×で中止。', true);
}

export function updateFishing(room, now, notify = (_player, _text: string, _tone?: string) => {}) {
  let changed = false;
  for (const site of FISHING_SITES) {
    const stock = room.gulf.shoals.find((s) => s.id === site.id);
    if (stock.amount >= site.capacity) {
      stock.recoveredAt = now;
      continue;
    }
    const steps = Math.floor(Math.max(0, now - stock.recoveredAt) / site.recoverMs);
    if (steps) {
      stock.amount = Math.min(site.capacity, stock.amount + steps);
      stock.recoveredAt += steps * site.recoverMs;
      changed = true;
    }
  }
  for (const player of room.players.values()) {
    const cast = player.fishing;
    if (!cast) continue;
    const site = FISHING_SITES.find((s) => s.id === cast.spotId),
      boat = boardedBoat(room, player);
    if (
      !site ||
      player.downedUntil ||
      player.mountId ||
      player.cookingEndsAt ||
      (player.boatId || null) !== cast.boatId ||
      (player.boatId && !boat) ||
      (player.hurtSequence || 0) !== cast.hurtSequence ||
      moving(boat || player) ||
      distance(player, cast) > 0.15 ||
      distance(player, site) > FISHING.range ||
      !room.shoreCollision.segmentFree(player, site, 0.12)
    ) {
      cancelFishing(player);
      changed = true;
      notify(player, '魚を待つのを中止した。道具は手元にあります。', 'info');
      continue;
    }
    if (now < cast.endsAt) continue;
    cancelFishing(player);
    changed = true;
    const stock = room.gulf.shoals.find((s) => s.id === site.id);
    // Competing catches resolve serially. Starting never reserves or consumes stock.
    if (!stock.amount) {
      notify(player, '魚が散りました。別の魚場も探してみよう。', 'info');
      continue;
    }
    if (player.inventory.rawFish >= 99) {
      notify(player, '生魚の持ち物がいっぱいです。魚を水へ戻した。', 'info');
      continue;
    }
    if (stock.amount === site.capacity) stock.recoveredAt = now;
    stock.amount--;
    player.inventory.rawFish++;
    ensureGulfPlayer(player).fishCaught++;
    player.energy = Math.max(0, player.energy - 2);
    notify(player, '生魚 +1。焚き火で焼くと元気+30。集い場の宴にも持ち寄れます。', 'success');
  }
  return changed;
}
