import { SETTLEMENTS, MANY_HEARTHS, inGulf } from '../shared/gulf-region.mjs';
import {
  PANTRY,
  PANTRY_FOODS,
  pantryTotal,
  pantryRemaining,
  pantryAvailable,
  supperTotal,
} from '../shared/pantry.mjs';
import { installSupperUI } from './supper-ui.js';
import { interactionVisible } from '../shared/interactions.mjs';

const distance = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.z - b.z) : Infinity);
export function installPantryUI(api, back) {
  const { player, state, available, action, goTo, openModal, collision } = api;
  const supper = installSupperUI(api, (id) => open(id));
  let settlementId: string = MANY_HEARTHS.id,
    foodId = PANTRY_FOODS[0].id,
    readyAt = 0;
  const $ = (id: string) => document.getElementById(id);
  const text = (id: string, value: string) => {
    const n = $(id);
    if (n && n.textContent !== value) n.textContent = value;
  };
  const enable = (id: string, yes: boolean) => {
    const n = $(id) as HTMLButtonElement;
    if (n) n.disabled = !yes;
  };
  function perform(type: string) {
    if (Date.now() < readyAt) return;
    readyAt = Date.now() + 500;
    action(type, `${settlementId}:${foodId}`);
    update();
  }
  function open(requested?: string) {
    settlementId =
      SETTLEMENTS.find((s) => s.id === requested)?.id ??
      [...SETTLEMENTS].sort((a, b) => distance(player(), a) - distance(player(), b))[0].id;
    openModal(
      `<div id="pantry-panel" class="gulf-panel"><p class="screen-eyebrow">次の旅人に、ひと口を</p><h2>共同の食料置き場</h2><p class="modal-intro">食料を炉のそばで分け合おう。預けたものはみんなの食料になります。受け取りは四つの集落を合わせて、一人一日3個まで。</p><label class="pantry-select">食料を分ける場所<select id="pantry-settlement">${SETTLEMENTS.map((s) => `<option value="${s.id}" ${s.id === settlementId ? 'selected' : ''}>${s.name}</option>`).join('')}</select></label><div class="pantry-totals"><p id="pantry-capacity"></p><p id="pantry-allowance" role="status"></p></div><div class="pantry-foods" role="group" aria-label="食べ物を選ぶ">${PANTRY_FOODS.map((f) => `<button id="pantry-food-${f.id}" class="button button-outline" aria-pressed="false"><strong>${f.name}</strong><span id="pantry-count-${f.id}"></span></button>`).join('')}</div><section class="gulf-card pantry-detail"><h3 id="pantry-selected"></h3><p id="pantry-use"></p><p id="pantry-amounts" role="status"></p><p id="pantry-give-hint"></p><p id="pantry-take-hint"></p><div class="gulf-actions"><button id="pantry-give" class="button button-outline">1つ預ける</button><button id="pantry-take" class="button button-outline">1つ受け取る</button><button id="pantry-eat" class="button button-outline">もちものから食べる</button></div><p id="pantry-eat-hint"></p></section><p>生の肉・魚・貝・火根は、焼いてから持ってこよう。置き場はそれぞれ合計48個まで。食料が空の場所には、収穫や旅の帰りに少し分けておこう。</p><div class="gulf-actions"><button id="pantry-go" class="button button-outline">この炉へ歩く</button><button id="pantry-back" class="button button-outline">湾の旅の案内へ</button></div></div>`,
    );
    ($('pantry-settlement') as HTMLSelectElement).onchange = (e) => {
      settlementId = (e.target as HTMLSelectElement).value;
      update();
    };
    for (const f of PANTRY_FOODS)
      $('pantry-food-' + f.id).onclick = () => {
        foodId = f.id;
        update();
      };
    $('pantry-give').onclick = () => perform('gulfPantryGive');
    $('pantry-take').onclick = () => perform('gulfPantryTake');
    $('pantry-eat').onclick = () => perform(PANTRY_FOODS.find((f) => f.id === foodId).eatAction);
    $('pantry-go').onclick = () => {
      const s = SETTLEMENTS.find((s) => s.id === settlementId);
      goTo(s.x, s.z + 5, s.name);
    };
    $('pantry-back').onclick = back;
    $('pantry-back').insertAdjacentHTML(
      'beforebegin',
      '<button id="pantry-supper" class="button button-outline">住人の夕食</button>',
    );
    $('pantry-supper').onclick = () => supper.open(settlementId);
    update();
  }
  function update() {
    supper.update();
    if (!$('pantry-panel') || !document.querySelector<HTMLDialogElement>('#modal')?.open) return;
    const world = state(),
      me = player(),
      s = SETTLEMENTS.find((s) => s.id === settlementId),
      f = PANTRY_FOODS.find((f) => f.id === foodId);
    const pantry = world.gulf?.pantries?.find((p) => p.settlementId === settlementId),
      total = pantryTotal(pantry),
      day = world.day ?? 1,
      remaining = pantryRemaining(me?.gulf?.pantryAllowance, day);
    const stock = pantry?.food[foodId] ?? 0,
      owned = me?.inventory[foodId] ?? 0;
    const usable = available() && pantryAvailable(me, world.serverTime),
      near =
        distance(me, s) <= PANTRY.reach && (!collision || interactionVisible(collision, me, s)),
      ready = Date.now() >= readyAt;
    text(
      'pantry-capacity',
      `置き場の食料 ${total} / ${PANTRY.capacity} · うち住人の夕食 ${supperTotal(pantry)}`,
    );
    text('pantry-allowance', `${day}日目 · 今日あと${remaining}個受け取れます`);
    for (const item of PANTRY_FOODS) {
      $('pantry-food-' + item.id).setAttribute('aria-pressed', String(item.id === foodId));
      text(
        'pantry-count-' + item.id,
        `置き場 ${pantry?.food[item.id] ?? 0} · もちもの ${me?.inventory[item.id] ?? 0}`,
      );
    }
    text('pantry-selected', f.name);
    text('pantry-use', `食べると元気+${f.energy}。${f.use}`);
    text('pantry-amounts', `置き場 ${stock} · あなたのもちもの ${owned}`);
    const common = !available()
      ? '接続を待っています。'
      : !usable
        ? '地上で作業を終えてから分け合おう。'
        : !near
          ? '選んだ集落の炉へ近づこう。'
          : !ready
            ? '食料を受け渡しています…'
            : '';
    text(
      'pantry-give-hint',
      common ||
        (total >= PANTRY.capacity
          ? '置き場はいっぱいです。'
          : owned < 1
            ? 'この食べ物を持ってきたら、みんなに分けられます。'
            : '預けると、ほかの旅人も受け取れます。'),
    );
    text(
      'pantry-take-hint',
      common
        ? ''
        : remaining === 0
          ? '今日の受け取りは済みました。また明日、炉へ来よう。'
          : stock < 1
            ? 'この食べ物は、今は置き場にありません。'
            : owned >= 99
              ? 'もちものがいっぱいです。'
              : '受け取った食料は、食事や旅の準備に使えます。',
    );
    const shellsFull = foodId === 'cookedShellfish' && (me?.inventory.shells ?? 0) >= 99;
    text(
      'pantry-eat-hint',
      shellsFull
        ? '貝殻がいっぱいです。先に貝塚へ持っていこう。'
        : me?.energy >= 100
          ? '今は元気いっぱいです。食料を次の旅へ残そう。'
          : '食事は、もちものの食料を1つ使います。',
    );
    enable(
      'pantry-give',
      usable && ready && !!pantry && near && owned > 0 && total < PANTRY.capacity,
    );
    enable(
      'pantry-take',
      usable && ready && !!pantry && near && remaining > 0 && stock > 0 && owned < 99,
    );
    enable('pantry-eat', usable && ready && owned > 0 && me.energy < 100 && !shellsFull);
    enable('pantry-go', usable && inGulf(me?.x, me?.z));
  }
  return { open, update };
}
