import { COASTAL, SHELL_BEDS, MIDDEN_SITES, KNAPPING_SITES } from '../shared/coastal-sites.mjs';
import { MANY_HEARTHS, inGulf } from '../shared/gulf-region.mjs';
import { HUNTING, nearestCookingFire } from '../shared/hunting.mjs';
import { attackProfile } from '../shared/combat-profiles.mjs';
import { interactionVisible } from '../shared/interactions.mjs';

const distance = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.z - b.z) : Infinity);
const nearest = (sites, p) => [...sites].sort((a, b) => distance(a, p) - distance(b, p))[0];
export function coastalInteraction(state, me, collision?) {
  if (!me || me.downedUntil || me.mountId || me.boatId) return null;
  if (me.coastalActivity) return { action: 'cancelCoastal', label: '作業を中止する' };
  if (me.fishing || me.cookingEndsAt) return null;
  const visible = (s) =>
    distance(me, s) <= COASTAL.range && (!collision || interactionVisible(collision, me, s));
  const bed = SHELL_BEDS.find(visible);
  if (bed) {
    const amount = state.gulf?.shellBeds?.find((s) => s.id === bed.id)?.amount ?? 0;
    return amount && (me.inventory.rawShellfish ?? 0) < 99
      ? {
          action: 'gatherShellfish',
          targetId: bed.id,
          label: `貝を採る（残り${amount}・止まって2.4秒）`,
        }
      : { action: 'coastalOpen', label: amount ? '貝のもちものを調べる' : '空の貝場を調べる' };
  }
  const midden = MIDDEN_SITES.find(visible);
  if (midden)
    return me.inventory.shells
      ? { action: 'depositShells', targetId: midden.id, label: '貝殻を積む（最大10個）' }
      : { action: 'coastalOpen', label: '貝塚と、貝の食べ方を調べる' };
  if (KNAPPING_SITES.some(visible))
    return { action: 'coastalOpen', label: '石器作業場で刃物をつくる' };
  return null;
}

export function installCoastalUI({ player, state, available, action, goTo, openModal }) {
  let signature = '';
  function open() {
    signature = '';
    openModal(
      '<div class="gulf-panel"><span class="eyebrow">THREE SHORES</span><h2>浜の貝と、石の刃。</h2><p class="modal-intro">貝を食べて、殻を集落へ。原石を削って、旅の道具へ。</p><section id="coastal-detail"></section></div>',
    );
    update();
    document.querySelector<HTMLDialogElement>('#modal').scrollTop = 0;
  }
  function update() {
    const root = document.querySelector<HTMLElement>('#coastal-detail');
    if (!root) return;
    const me = player(),
      world = state(),
      inv = me?.inventory ?? {},
      bed = nearest(SHELL_BEDS, me),
      midden = nearest(MIDDEN_SITES, me),
      workshop = nearest(KNAPPING_SITES, me),
      fire = me ? nearestCookingFire(world, me) : MANY_HEARTHS;
    const blocked =
      !available() ||
      !me ||
      !!me.downedUntil ||
      !!me.mountId ||
      !!me.boatId ||
      !!me.cookingEndsAt ||
      !!me.fishing ||
      !!me.coastalActivity;
    const local = me && inGulf(me.x, me.z),
      nearBed = distance(me, bed) <= COASTAL.range,
      nearMidden = distance(me, midden) <= COASTAL.range,
      nearWorkshop = distance(me, workshop) <= COASTAL.range,
      nearFire = distance(me, fire) <= HUNTING.cookRange;
    const weapon = attackProfile(me ?? {}),
      spear = weapon.key === 'spear';
    const sig = JSON.stringify([
      blocked,
      local,
      nearBed,
      nearMidden,
      nearWorkshop,
      nearFire,
      bed.id,
      midden.id,
      workshop.id,
      inv,
      Math.ceil(me?.energy ?? 100),
      me?.spearHead,
      me?.moving,
      world.gulf?.shellBeds,
      world.gulf?.middens,
    ]);
    if (sig === signature) return;
    signature = sig;
    const btn = (id, label, disabled = false) =>
      `<button id="${id}" class="button button-outline" ${disabled ? 'disabled' : ''}>${label}</button>`;
    root.innerHTML = `<section class="gulf-card"><h4>採って、焼いて、食べる</h4><p>生の貝 <b>${inv.rawShellfish ?? 0}</b> · 焼いた貝 <b>${inv.cookedShellfish ?? 0}</b> · 貝殻 <b>${inv.shells ?? 0}</b></p><p>貝場で2.4秒採集し、焚き火で3秒焼こう。食べると元気+20、貝殻1個が残ります。</p><div class="gulf-actions">${btn('shell-gather', 'ここで貝を採る', blocked || !nearBed || !!me?.moving || inv.rawShellfish >= 99 || !world.gulf?.shellBeds?.find((s) => s.id === bed.id)?.amount)}${btn('shell-cook', '焚き火で貝を焼く', blocked || !nearFire || !inv.rawShellfish || inv.cookedShellfish >= 99)}${btn('shell-eat', '焼いた貝を食べる', blocked || !inv.cookedShellfish || inv.shells >= 99 || me?.energy >= 100)}${btn('shell-fire', '近くの焚き火へ', blocked)}</div></section>
    <section class="gulf-card"><h4>みんなで貝塚を作る</h4><p>殻を持ち寄って積み重ねよう。最初の1個から形が現れ、12個・40個で大きくなります。どの国の旅人も参加できます。</p><p>${midden.name} · ${world.gulf?.middens?.find((s) => s.id === midden.id)?.shells ?? 0}個</p><div class="gulf-actions">${btn('shell-deposit', '殻を最大10個積む', blocked || !nearMidden || !inv.shells)}${btn('shell-midden', '近くの貝塚へ歩く', blocked || !local)}</div></section>
    <section class="gulf-card"><h4>原石から、槍の刃へ</h4><p>黒曜石 <b>${inv.obsidian ?? 0}</b> · 黒曜石の刃 <b>${inv.obsidianBlade ?? 0}</b><br>今の武器：${weapon.noun} · 威力${weapon.damage}</p><p>西の露頭で黒曜石を採掘。石器作業場で黒曜石2個を4秒削ると刃1個。打ち石として石1個が必要で、打ち石は消費しません。刃1・木材1で木槍に装着できます。</p><p>${spear ? '木槍の威力15 → 黒曜石の槍の威力30。槍先は使い続けられます。' : 'この人物の刀・魔法はそのまま。刃の製作には参加できます。'}</p><div class="gulf-actions">${btn('stone-knap', '原石を削る（4秒）', blocked || !nearWorkshop || !!me?.moving || (inv.obsidian ?? 0) < 2 || !inv.stone || inv.obsidianBlade >= 99)}${btn('stone-haft', me?.spearHead === 'obsidian' && spear ? '槍先を装着済み' : '刃を槍先に取り付ける', blocked || !nearWorkshop || !spear || me?.spearHead === 'obsidian' || !inv.obsidianBlade || !inv.wood)}${btn('stone-workshop', '近くの石器作業場へ', blocked || !local)}${btn('stone-outcrop', '西の黒曜石露頭へ', blocked || !local)}</div></section>
    <section class="gulf-routes"><h4>浜の貝場</h4><p>1分ごとに貝1個が戻ります。別の浜へ歩いたり、舟で巡ろう。</p><div class="gulf-stop-list">${SHELL_BEDS.map((s) => `<article class="gulf-card"><h4>${s.name}</h4><p>貝 ${world.gulf?.shellBeds?.find((b) => b.id === s.id)?.amount ?? COASTAL.bedCapacity}/${COASTAL.bedCapacity}</p>${btn('shell-go-' + s.id, 'この貝場へ歩く', blocked || !local)}</article>`).join('')}</div></section>
    <details class="gulf-lore"><summary>この湾の暮らしについて</summary><p>貝や石の利用を土台にした創作です。この貝塚の場所・大きさ、レシピ、作業時間、回復速度、武器の威力はゲームの設定です。</p></details>`;
    const bind = (id, fn) => {
      root.querySelector<HTMLButtonElement>('#' + id).onclick = fn;
    };
    const perform = (kind, id?) => {
      document.querySelector<HTMLDialogElement>('#modal').close();
      action(kind, id);
    };
    bind('shell-gather', () => perform('gatherShellfish', bed.id));
    bind('shell-cook', () => perform('cookShellfish'));
    bind('shell-eat', () => action('eatShellfish'));
    bind('shell-deposit', () => action('depositShells', midden.id));
    bind('stone-knap', () => perform('knapObsidian', workshop.id));
    bind('stone-haft', () => action('haftSpear', workshop.id));
    bind('shell-fire', () => goTo(fire.x, fire.z + 2.4, '近くの焚き火'));
    bind('shell-midden', () => goTo(midden.x, midden.z + 2, midden.name));
    bind('stone-workshop', () => goTo(workshop.x, workshop.z + 2, workshop.name));
    bind('stone-outcrop', () => goTo(-2753, 693, '黒曜石の露頭'));
    for (const s of SHELL_BEDS) bind('shell-go-' + s.id, () => goTo(s.x, s.z + 1.5, s.name));
  }
  return { open, update };
}
