import { ROOT_RECIPES } from '../shared/crops.mjs';
import { HUNTING, nearestCookingFire } from '../shared/hunting.mjs';
import { MANY_HEARTHS } from '../shared/gulf-region.mjs';
import { interactionVisible } from '../shared/interactions.mjs';

export function installCropFoodUI({ player, state, available, action, openModal, collision }) {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const button = (id, label) =>
    `<button id="${id}" class="button button-outline">${label}</button>`;
  const near = (a, b, range) =>
    a && b && Math.hypot(a.x - b.x, a.z - b.z) <= range && interactionVisible(collision, a, b);
  const close = () => (document.getElementById('modal') as HTMLDialogElement).close();
  function open() {
    openModal(
      `<div id="crop-food-panel"><span class="eyebrow">畑から、炉のそばへ</span><h2>火根と香草の食事</h2><p class="modal-intro">共同畑で根と香草を収穫し、炉で3秒焼こう。調理を中止したときは、材料を手元に残します。</p><p id="crop-food-inventory"></p><div class="crop-recipes">${ROOT_RECIPES.map((r) => `<section class="gulf-card"><h3>${r.name}</h3><p>${r.costText} → ${r.name}1 · 元気+${r.energy}</p><p id="crop-stock-${r.kind}"></p><div class="gulf-actions">${button('crop-cook-' + r.kind, r.name + 'を作る')}${button('crop-eat-' + r.kind, r.name + 'を食べる')}${button('crop-offer-' + r.kind, '1個を宴へ持ち寄る')}</div></section>`).join('')}</div><p id="crop-food-hint" role="status"></p><p>焼き根も香草焼き根も、1個が宴の食料3になります。</p><div class="gulf-actions">${button('crop-food-farms', '共同の畑と種')}</div><details><summary>この世界の作物</summary><p>火根草と香り草は創作植物です。農耕、育つ速さ、料理の効果はゲームの設定です。</p></details></div>`,
    );
    for (const r of ROOT_RECIPES) {
      $('crop-cook-' + r.kind).onclick = () => {
        close();
        action(r.action);
      };
      $('crop-eat-' + r.kind).onclick = () => action(r.eatAction);
      $('crop-offer-' + r.kind).onclick = () => action(r.offerAction);
    }
    $('crop-food-farms').onclick = () => action('gulfOpen');
    update();
  }
  function update() {
    if (!$('crop-food-panel')) return;
    const me = player(),
      inv = me?.inventory ?? {},
      world = state();
    const blocked =
      !available() ||
      !me ||
      !!me.downedUntil ||
      !!me.mountId ||
      !!me.boatId ||
      !!me.cookingEndsAt ||
      !!me.fishing ||
      !!me.coastalActivity;
    const fire = me && nearestCookingFire(world, me);
    const atFire = near(me, fire, HUNTING.cookRange);
    const atGathering = near(me, MANY_HEARTHS, 9);
    const fullFood = (world.gulf?.stores.berry ?? 0) >= 12;
    const enable = (id, yes) => ($<HTMLButtonElement>(id).disabled = !yes);
    $('crop-food-inventory').textContent = `火根 ${inv.rawRoot ?? 0} · 香草 ${inv.herb ?? 0}`;
    $('crop-food-hint').textContent = blocked
      ? '今の作業を終えてから料理しよう。'
      : !atFire
        ? '焼くときは炉に近づこう。持ち寄りは集い場の炉で。'
        : '火のそばです。焼き方を選ぼう。';
    for (const r of ROOT_RECIPES) {
      $('crop-stock-' + r.kind).textContent = `持ち物：${inv[r.output] ?? 0}`;
      enable(
        'crop-cook-' + r.kind,
        !blocked &&
          atFire &&
          (inv[r.output] ?? 0) < 99 &&
          Object.entries(r.ingredients).every(([key, n]) => (inv[key] ?? 0) >= n),
      );
      enable('crop-eat-' + r.kind, !blocked && (inv[r.output] ?? 0) > 0 && me.energy < 100);
      enable(
        'crop-offer-' + r.kind,
        !blocked && atGathering && !fullFood && (inv[r.output] ?? 0) > 0,
      );
    }
  }
  return { open, update };
}
