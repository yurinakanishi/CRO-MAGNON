import {
  COASTAL,
  SHELL_BEDS,
  MIDDEN_SITES,
  KNAPPING_SITES,
  middenRadius,
} from './coastal-sites.mjs';
import { ensureGulfPlayer } from './gulf-life.mjs';
import { interactionVisible } from './interactions.mjs';
import { stopActor } from './combat.mjs';
import { attackProfile } from './combat-profiles.mjs';
import { characterModel } from './characters.mjs';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const moving = (p) => !!(p.target || p.path?.length || Math.hypot(p.dx || 0, p.dz || 0) > 0.01);
const response = (text, changed = false, tone = changed ? 'success' : 'info') => ({
  text,
  changed,
  tone,
});
export function cancelCoastal(player) {
  const active = !!player.coastalActivity;
  player.coastalActivity = null;
  return active;
}
export function handleCoastalAction(room, player, message, now) {
  const action = message.action;
  if (
    !['gatherShellfish', 'depositShells', 'knapObsidian', 'haftSpear', 'cancelCoastal'].includes(
      action,
    )
  )
    return null;
  if (action === 'cancelCoastal') {
    const changed = cancelCoastal(player);
    return response(changed ? '作業を中止した。材料は手元に残っています。' : '', changed);
  }
  if (player.downedUntil || player.boatId || player.mountId)
    return response('地上へ降りてから行おう。');
  if (player.coastalActivity || player.fishing || player.cookingEndsAt)
    return response('今の作業を終えるか、中止してから行おう。');
  if (player.attackSequence && now - player.attackAt < attackProfile(player).durationMs)
    return response('攻撃が終わってから行おう。');
  const progress = ensureGulfPlayer(player),
    inv = player.inventory;
  const sites =
    action === 'gatherShellfish'
      ? SHELL_BEDS
      : action === 'depositShells'
        ? MIDDEN_SITES
        : KNAPPING_SITES;
  const site = sites.find((s) => s.id === message.targetId);
  if (!site || distance(player, site) > COASTAL.range) return response('作業する場所へ近づこう。');
  if (!interactionVisible(room.collision, player, site))
    return response('間がふさがれています。回り込もう。');
  if (action === 'depositShells') {
    const midden = room.gulf.middens.find((s) => s.id === site.id);
    const amount = Math.min(inv.shells, 10, COASTAL.maxMidden - midden.shells);
    if (!amount)
      return response(
        inv.shells
          ? 'この貝塚には十分な貝殻が積まれています。'
          : '焼いた貝を食べ、残った貝殻を持ち帰ろう。',
      );
    const nextRadius = middenRadius(midden.shells + amount);
    if (
      nextRadius > middenRadius(midden.shells) &&
      [
        ...room.players.values(),
        ...(room.animals || []).filter((a) => ['alive', 'dying'].includes(a.phase)),
        ...(room.enemies || []).filter((a) => ['alive', 'dead'].includes(a.phase)),
        ...(room.residents || []),
      ].some((a) => distance(a, site) < nextRadius + (a.radius ?? 0.32) + 0.05)
    )
      return response('貝塚の場所から少し離れて、積むための場所を空けよう。');
    inv.shells -= amount;
    midden.shells += amount;
    progress.shellsReturned += amount;
    return response(`貝殻${amount}個を積んだ。みんなの貝塚は${midden.shells}個。`, true);
  }
  if (action === 'haftSpear') {
    if (characterModel(player).weapon)
      return response('槍先は人間系の木槍に取り付けます。今の武器はそのまま使えます。');
    if (player.spearHead === 'obsidian') return response('すでに黒曜石の槍先を取り付けています。');
    if (!inv.obsidianBlade || inv.wood < COASTAL.haftWood)
      return response('黒曜石の刃1・木材1が必要です。先に原石を削ろう。');
    inv.obsidianBlade--;
    inv.wood -= COASTAL.haftWood;
    player.spearHead = 'obsidian';
    return response('黒曜石の刃を槍先に取り付けた。木槍より強く突けます。', true);
  }
  if (moving(player)) return response('移動を止めてから作業しよう。');
  if (action === 'gatherShellfish') {
    if (inv.rawShellfish >= 99) return response('生の貝の持ち物がいっぱいです。');
    if (!room.gulf.shellBeds.find((s) => s.id === site.id)?.amount)
      return response('この貝場は採り尽くしています。ほかの浜も探してみよう。');
  } else {
    if (inv.obsidian < COASTAL.obsidianCost || !inv.stone)
      return response('黒曜石2個と、打ち石になる石1個が必要です。打ち石は繰り返し使えます。');
    if (inv.obsidianBlade >= 99) return response('黒曜石の刃の持ち物がいっぱいです。');
  }
  stopActor(player);
  player.facing = Math.atan2(site.x - player.x, site.z - player.z);
  const kind = action === 'gatherShellfish' ? 'shells' : 'knap';
  player.coastalActivity = {
    kind,
    siteId: site.id,
    startedAt: now,
    endsAt: now + (kind === 'shells' ? COASTAL.gatherMs : COASTAL.knapMs),
    x: player.x,
    z: player.z,
    hurtSequence: player.hurtSequence || 0,
  };
  return response(
    kind === 'shells'
      ? '貝を探しています。移動・E／×で中止。'
      : '黒曜石を削っています。4秒待とう。移動・E／×で中止。',
    true,
    'info',
  );
}

export function updateCoastal(
  room,
  now,
  notify = (_p, _text: string, _tone?: string, _popup?: boolean) => {},
) {
  let changed = false;
  for (const bed of room.gulf.shellBeds) {
    if (bed.amount >= COASTAL.bedCapacity) {
      bed.recoveredAt = now;
      continue;
    }
    const steps = Math.floor(Math.max(0, now - bed.recoveredAt) / COASTAL.recoverMs);
    if (steps) {
      bed.amount = Math.min(COASTAL.bedCapacity, bed.amount + steps);
      bed.recoveredAt += steps * COASTAL.recoverMs;
      changed = true;
    }
  }
  for (const p of room.players.values()) {
    const work = p.coastalActivity;
    if (!work) continue;
    const site = (work.kind === 'shells' ? SHELL_BEDS : KNAPPING_SITES).find(
      (s) => s.id === work.siteId,
    );
    if (
      !site ||
      p.downedUntil ||
      p.boatId ||
      p.mountId ||
      p.cookingEndsAt ||
      p.fishing ||
      (p.hurtSequence || 0) !== work.hurtSequence ||
      moving(p) ||
      distance(p, work) > 0.15 ||
      distance(p, site) > COASTAL.range ||
      !interactionVisible(room.collision, p, site)
    ) {
      cancelCoastal(p);
      changed = true;
      notify(p, '作業を中止した。材料は手元に残っています。', 'info', false);
      continue;
    }
    if (now < work.endsAt) continue;
    cancelCoastal(p);
    changed = true;
    const progress = ensureGulfPlayer(p),
      inv = p.inventory;
    if (work.kind === 'shells') {
      const bed = room.gulf.shellBeds.find((s) => s.id === site.id);
      // Finish requests are serialized; starting work reserves no shared stock.
      if (!bed.amount || inv.rawShellfish >= 99) {
        notify(p, '貝を採れませんでした。貝場と持ち物を確認しよう。', 'info');
        continue;
      }
      if (bed.amount === COASTAL.bedCapacity) bed.recoveredAt = now;
      bed.amount--;
      inv.rawShellfish++;
      progress.shellfishGathered++;
      notify(p, '生の貝 +1。焚き火で焼いて食べ、殻を集落の貝塚へ持ち帰ろう。', 'success');
    } else {
      if (inv.obsidian < COASTAL.obsidianCost || !inv.stone || inv.obsidianBlade >= 99) {
        notify(p, '材料か持ち物の空きが足りません。原石は手元に残っています。', 'info');
        continue;
      }
      inv.obsidian -= COASTAL.obsidianCost;
      inv.obsidianBlade++;
      progress.bladesKnapped++;
      notify(p, '黒曜石の刃 +1。木材1と合わせて木槍の先へ取り付けられます。', 'success');
    }
    p.energy = Math.max(0, p.energy - 2);
  }
  return changed;
}
