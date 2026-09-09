import { handleAdventureAction, recordAdventureGather } from '../shared/adventures.mjs';
import { handleBoatAction } from '../shared/boats.mjs';
import { attackProfile } from '../shared/combat-profiles.mjs';
import { handleHuntingAction } from '../shared/hunting.mjs';
import { interactionVisible } from '../shared/interactions.mjs';
import { handleRidingAction } from '../shared/riding.mjs';
import { NPC } from '../shared/world.mjs';
import { handleGulfAction, ensureGulfPlayer } from '../shared/gulf-life.mjs';
import { handleFishingAction, cancelFishing } from '../shared/fishing.mjs';
import { handleCoastalAction, cancelCoastal } from '../shared/coastal-craft.mjs';
import { handleVillageAction } from '../shared/village-life.mjs';
import { canStartJump, jumpProgress } from '../shared/jumping.mjs';
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export function createActionHandler({ notice, broadcast, snapshot, systemChat, runtime }) {
  return function act(room, player, message, now) {
    const action = message.action;
    if (action === 'jump') {
      if (!canStartJump(player, now)) return;
      cancelFishing(player);
      cancelCoastal(player);
      player.cookingEndsAt = 0;
      player.jumpAt = now;
      player.jumpSequence = (player.jumpSequence ?? 0) + 1;
      broadcast(room, snapshot(room));
      return;
    }
    if (jumpProgress(player, now) !== null) {
      // Opening a menu sends these defensively. Jump already canceled all work.
      if (['cancelFishing', 'cancelCoastal', 'cancelCook'].includes(action)) return;
      return notice(player, '着地してから行おう。');
    }
    if (['attack', 'boardBoat', 'ride'].includes(action)) {
      cancelFishing(player);
      cancelCoastal(player);
    }
    const coastal = handleCoastalAction(room, player, message, now);
    if (coastal) {
      if (coastal.text) notice(player, coastal.text, coastal.tone, !coastal.changed);
      if (coastal.changed) broadcast(room, snapshot(room, true));
      return;
    }
    if (player.coastalActivity && action !== 'cancelFishing')
      return notice(player, '作業中です。先にE／×で中止しよう。');
    const fishing = handleFishingAction(room, player, message, now);
    if (fishing) {
      if (fishing.text) notice(player, fishing.text, fishing.tone, !fishing.changed);
      if (fishing.changed) broadcast(room, snapshot(room, true));
      return;
    }
    if (player.fishing) return notice(player, '魚を待っています。先にE／×で中止しよう。');
    const boating = handleBoatAction(room, player, message, now);
    if (boating) {
      notice(player, boating.text, boating.tone, !boating.changed);
      if (boating.changed) broadcast(room, snapshot(room, true));
      return;
    }
    if (player.boatId) return notice(player, '乗船中です。岸で B を押して降りてから行おう。');
    const riding = handleRidingAction(room, player, message, now);
    if (riding) {
      notice(player, riding.text, riding.tone, !riding.changed);
      if (riding.changed) broadcast(room, snapshot(room));
      return;
    }
    if (player.mountId) return notice(player, '騎乗中です。攻撃・採集・食事は R で降りてから。');
    const hunting = handleHuntingAction(room, player, message, now);
    if (hunting) {
      notice(player, hunting.text, hunting.tone, action !== 'attack' && !hunting.changed);
      if (hunting.changed) broadcast(room, snapshot(room));
      return;
    }
    if (player.cookingEndsAt) return notice(player, '調理中です。先に調理を終えるか中止しよう。');
    if (player.attackSequence && now - player.attackAt < attackProfile(player).durationMs)
      return notice(player, '攻撃が終わってから行おう。');
    const village = handleVillageAction(room, player, message, now);
    if (village) {
      notice(player, village.text, village.ok ? 'success' : 'info');
      if (village.ok) broadcast(room, snapshot(room));
      return;
    }
    const gulf = handleGulfAction(room, player, message, now);
    if (gulf) {
      notice(player, gulf.text, gulf.ok ? 'success' : 'info');
      if (gulf.ok) broadcast(room, snapshot(room, true));
      return;
    }
    const adventure = handleAdventureAction(room, player, message, now);
    if (adventure) {
      notice(player, adventure.text, adventure.ok ? 'success' : 'info');
      if (adventure.ok) broadcast(room, snapshot(room, true));
      return;
    }
    if (action === 'gather') {
      const candidates = room.resources.filter(
        (resource) =>
          resource.amount > 0 &&
          (!message.targetId || resource.id === message.targetId) &&
          distance(resource, player) <= 8 &&
          interactionVisible(room.collision, player, resource),
      );
      const nearest = candidates
        .filter((resource) => player.inventory[resource.type] < 99)
        .sort((a, b) => distance(a, player) - distance(b, player))[0];
      if (!nearest)
        return notice(
          player,
          candidates.length
            ? '持ち物がいっぱいです。焚き火に届けよう。'
            : '資源に近づいてから採集しよう。遮られている場合は回り込もう。',
          'error',
        );
      const amount = Math.min(nearest.amount, player.tool && nearest.type !== 'berry' ? 2 : 1);
      if (player.inventory[nearest.type] >= 99)
        return notice(player, '持ち物がいっぱいです。焚き火に届けよう。', 'error');
      const collected = Math.min(amount, 99 - player.inventory[nearest.type]);
      nearest.amount -= collected;
      nearest.regeneratedAt = runtime.now();
      player.inventory[nearest.type] += collected;
      player.gathered = (player.gathered ?? 0) + collected;
      recordAdventureGather(player, nearest, collected);
      if (nearest.type === 'obsidian') ensureGulfPlayer(player).procured += collected;
      player.energy = Math.max(0, player.energy - 3);
      const label = { wood: '木材', stone: '石', berry: 'ベリー', obsidian: '黒曜石' }[
        nearest.type
      ];
      notice(player, `${label} +${collected}`, 'success');
    } else if (action === 'contribute') {
      if (distance(player, room.camp) > 10)
        return notice(player, '焚き火に近づいてから届けよう。', 'error');
      if (!interactionVisible(room.collision, player, room.camp))
        return notice(player, '焚き火までの間がふさがれています。回り込もう。', 'error');
      const { wood, stone } = player.inventory;
      if (!wood && !stone) return notice(player, '木材や石を集めて持ってこよう。', 'error');
      room.camp.wood += wood;
      room.camp.stone += stone;
      player.inventory.wood = 0;
      player.inventory.stone = 0;
      notice(player, `焚き火に木材 ${wood}・石 ${stone} を届けた。`, 'success');
      systemChat(room, `${player.name} が木材 ${wood}・石 ${stone} を届けた。`);
      if (
        !room.camp.level &&
        room.camp.wood >= room.camp.goalWood &&
        room.camp.stone >= room.camp.goalStone
      ) {
        room.camp.level = 1;
        for (const member of room.players.values()) member.ready = true;
        systemChat(room, '焚き火が完成！ みんなの力で、最初の夜を迎える準備ができた。');
      }
    } else if (action === 'craft') {
      if (player.tool) return notice(player, 'すでに石斧を持っています。');
      if (player.inventory.wood < 3 || player.inventory.stone < 2)
        return notice(player, '石斧には木材 3・石 2 が必要です。', 'error');
      player.inventory.wood -= 3;
      player.inventory.stone -= 2;
      player.tool = true;
      notice(player, '石斧ができた！ 木材と石を一度に2つ採集できます。', 'success');
    } else if (action === 'trade') {
      if (distance(player, NPC) > 10)
        return notice(player, 'オルに近づいて話しかけよう。', 'error');
      if (!interactionVisible(room.collision, player, NPC))
        return notice(player, 'オルまでの間がふさがれています。回り込もう。', 'error');
      const material =
        player.inventory.wood >= 2 ? 'wood' : player.inventory.stone >= 2 ? 'stone' : null;
      if (!material) return notice(player, 'オル「木か石を2つ、ベリー3つと交換しよう」');
      if (player.inventory.berry > 96)
        return notice(player, 'ベリーを食べてから交換しよう。', 'error');
      player.inventory[material] -= 2;
      player.inventory.berry += 3;
      notice(
        player,
        `オルと${material === 'wood' ? '木材' : '石'}2つを交換した。ベリー +3`,
        'success',
      );
    } else if (action === 'eat') {
      if (!player.inventory.berry) return notice(player, 'ベリーを持っていません。', 'error');
      if (player.energy >= 100) return notice(player, '元気いっぱいです。');
      player.inventory.berry -= 1;
      player.energy = Math.min(100, player.energy + 25);
      notice(player, 'ベリーを食べた。元気 +25', 'success');
    } else if (action === 'wave') {
      broadcast(room, { type: 'emote', id: player.id, emote: 'wave', at: runtime.now() });
      systemChat(room, `${player.name} が手を振った。`);
    } else return;
    broadcast(room, snapshot(room, true));
  };
}
