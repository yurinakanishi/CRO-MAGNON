import { FISHING, FISHING_SITES } from '../shared/fishing-sites.mjs';
import { inGulf, MANY_HEARTHS } from '../shared/gulf-region.mjs';
import { HUNTING, nearestCookingFire } from '../shared/hunting.mjs';

const distance = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.z - b.z) : Infinity);
const nearestSite = (me) =>
  [...FISHING_SITES]
    .filter((s) => !s.boatOnly || me?.boatId)
    .sort((a, b) => distance(me, a) - distance(me, b))[0];
export function fishingInteraction(me) {
  if (!me || me.downedUntil || me.mountId || me.cookingEndsAt || me.coastalActivity) return null;
  if (me.fishing) return { action: 'cancelFishing', label: '魚を待つのを中止する' };
  const site = nearestSite(me);
  if (distance(me, site) > FISHING.range) return null;
  return {
    action: me.gulf?.fishingKit ? 'fish' : 'fishingOpen',
    targetId: site.id,
    label: me.gulf?.fishingKit
      ? `${site.name}で釣る（止まって6秒）`
      : '釣り道具を調べる（木材3・石1）',
  };
}

export function installFishingUI({ player, state, available, action, goTo, openModal }) {
  let signature = '';
  function open() {
    signature = '';
    openModal(
      '<div class="gulf-panel"><span class="eyebrow">THREE SHORES · FISHING</span><h2>湾の恵みを持ち帰る。</h2><p class="modal-intro">岸から、静かな小舟から。水を見つめて、魚を待とう。</p><section id="fishing-detail"></section></div>',
    );
    update();
    document.querySelector<HTMLDialogElement>('#modal').scrollTop = 0;
  }
  function update() {
    const root = document.querySelector<HTMLElement>('#fishing-detail');
    if (!root) return;
    const me = player(),
      world = state(),
      inv = me?.inventory ?? {},
      site = nearestSite(me);
    const blocked =
      !available() ||
      !me ||
      !!me.downedUntil ||
      !!me.mountId ||
      !!me.cookingEndsAt ||
      !!me.fishing ||
      !!me.coastalActivity;
    const land = !blocked && !me.boatId,
      local = !!me && inGulf(me.x, me.z);
    const near = distance(me, site) <= FISHING.range && !me?.moving;
    const fire = me ? nearestCookingFire(world, me) : MANY_HEARTHS,
      nearFire = distance(me, fire) <= HUNTING.cookRange;
    const nearHearth = distance(me, MANY_HEARTHS) <= 9;
    const sig = JSON.stringify([
      blocked,
      land,
      local,
      near,
      nearFire,
      nearHearth,
      site.id,
      inv,
      Math.ceil(me?.energy ?? 100),
      me?.gulf,
      world.gulf?.shoals,
      world.gulf?.stores,
    ]);
    if (sig === signature) return;
    signature = sig;
    const btn = (id, text, disabled = false) =>
      `<button id="${id}" class="button button-outline" ${disabled ? 'disabled' : ''}>${text}</button>`;
    root.innerHTML = `<section class="gulf-card"><h4>${me?.gulf?.fishingKit ? '釣り道具を携帯中' : '釣り道具を作ろう'}</h4><p>木材3・石1。繰り返し使える道具です。魚場へ近づき、止まってE／×。6秒待つと生魚1。移動・攻撃・被弾・中止操作で取りやめます。</p><div class="gulf-actions">${btn('fish-kit', me?.gulf?.fishingKit ? '制作済み' : '道具を作る', !land || !!me?.gulf?.fishingKit || inv.wood < 3 || inv.stone < 1)}${btn('fish-start', 'ここで魚を待つ', blocked || !near || !me?.gulf?.fishingKit || (inv.rawFish ?? 0) >= 99 || !world.gulf?.shoals?.find((s) => s.id === site.id)?.amount)}</div></section>
    <section class="gulf-card"><h4>釣った魚を食卓へ</h4><p>生魚 <b>${inv.rawFish ?? 0}</b> · 焼き魚 <b>${inv.cookedFish ?? 0}</b> · これまでの釣果 ${me?.gulf?.fishCaught ?? 0}</p><p>各地の焚き火で3秒焼くと、食べて元気+30。集い場では焼き魚1を食料3として持ち寄れます。ベリーも同じ食料に数えます。</p><div class="gulf-actions">${btn('fish-cook', '焚き火で魚を焼く', !land || !nearFire || !inv.rawFish || inv.cookedFish >= 99)}${btn('fish-eat', '焼き魚を食べる', !land || !inv.cookedFish || me?.energy >= 100)}${btn('fish-offer', '集い場へ焼き魚1', !land || !nearHearth || !inv.cookedFish || world.gulf?.stores.berry >= 12)}${btn('fish-fire', '近くの焚き火へ', !land)}${btn('fish-hearth', '集い場へ歩く', !land || !local)}</div></section>
    <section class="gulf-routes"><h4>七つの魚場</h4><p>岸の魚は45秒、沖の魚は30秒ごとに1匹ずつ戻ります。空いた魚場を分け合おう。沖へは小舟が必要です。</p><div class="gulf-stop-list">${FISHING_SITES.map((s) => `<article class="gulf-card"><h4>${s.name}</h4><p>${s.boatOnly ? '沖 · 船が必要' : '浜 · 徒歩でも小舟でも'} · 魚 ${world.gulf?.shoals?.find((v) => v.id === s.id)?.amount ?? s.capacity}/${s.capacity}</p>${btn(`fish-go-${s.id}`, s.boatOnly || me?.boatId ? '小舟で向かう' : 'この浜へ歩く', blocked || !local || (s.boatOnly && !me?.boatId))}</article>`).join('')}</div></section>
    <details class="gulf-lore"><summary>魚場の約束と、この世界の創作</summary><p>葦の岸では最初の焼き魚を共同の炉へ持ち帰る、という創作の習慣があります。どの国の旅人でも釣れます。釣り道具のレシピ、魚の数と回復速度、捕獲時間は遊びのための創作で、この時代の漁具や制度の復元ではありません。</p></details>`;
    const bind = (id, fn) => {
      root.querySelector<HTMLButtonElement>('#' + id).onclick = fn;
    };
    const perform = (kind) => {
      document.querySelector<HTMLDialogElement>('#modal').close();
      action(kind, kind === 'fish' ? site.id : undefined);
    };
    bind('fish-kit', () => action('craftFishingKit'));
    bind('fish-start', () => perform('fish'));
    bind('fish-cook', () => perform('cookFish'));
    bind('fish-eat', () => action('eatFish'));
    bind('fish-offer', () => action('gulfOfferFish'));
    bind('fish-fire', () => goTo(fire.x, fire.z + 2.4, '近くの焚き火'));
    bind('fish-hearth', () => goTo(MANY_HEARTHS.x, MANY_HEARTHS.z + 5, MANY_HEARTHS.name));
    for (const s of FISHING_SITES)
      bind(`fish-go-${s.id}`, () => {
        const p = me.boatId ? s : s.shore;
        goTo(p.x, p.z, s.name);
      });
  }
  return { open, update };
}
