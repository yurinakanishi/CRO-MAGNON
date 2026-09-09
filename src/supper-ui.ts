import { SETTLEMENTS, MANY_HEARTHS, inGulf } from '../shared/gulf-region.mjs';
import {
  PANTRY,
  PANTRY_FOODS,
  pantryAvailable,
  pantryTotal,
  supperTotal,
} from '../shared/pantry.mjs';
import { supperPlace, supperLabel } from '../shared/supper.mjs';
import { RESIDENTS, DAY_PHASES } from '../shared/village-sites.mjs';
import { interactionVisible } from '../shared/interactions.mjs';
import { forageLabel } from '../shared/foraging.mjs';

export function installSupperUI(
  { player, state, available, action, goTo, openModal, collision },
  back,
) {
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
  const button = (id: string, label: string) =>
    `<button id="${id}" class="button button-outline">${label}</button>`;
  function perform(actionId: string) {
    if (!available() || Date.now() < readyAt) return;
    readyAt = Date.now() + 500;
    action(actionId, `${settlementId}:${actionId === 'gulfSupperShells' ? 'shells' : foodId}`);
    update();
  }
  function open(requested?: string) {
    settlementId = SETTLEMENTS.find((s) => s.id === requested)?.id ?? MANY_HEARTHS.id;
    openModal(
      `<div id="supper-panel" class="gulf-panel"><p class="screen-eyebrow">帰ってくる人に、一皿を</p><h2>住人の夕食</h2><p class="modal-intro">ここへ取り分けた食料は、夕べに炉へ戻った住人が一人一日ひとつ食べます。共同食料は旅人のために残ります。</p><label class="pantry-select">夕食を用意する場所<select id="supper-settlement">${SETTLEMENTS.map((s) => `<option value="${s.id}" ${s.id === settlementId ? 'selected' : ''}>${s.name}</option>`).join('')}</select></label><p id="supper-clock"></p><p id="supper-capacity" role="status"></p><div class="pantry-foods" role="group" aria-label="夕食を選ぶ">${PANTRY_FOODS.map((f) => `<button id="supper-food-${f.id}" class="button button-outline" aria-pressed="false"><strong>${f.name}</strong><span id="supper-count-${f.id}"></span></button>`).join('')}</div><section class="gulf-card pantry-detail"><h3 id="supper-selected"></h3><p id="supper-amounts"></p><p id="supper-hint" role="status"></p><div class="gulf-actions">${button('supper-give', 'もちものから夕食へ1つ')}${button('supper-release', '夕食から共同食料へ1つ戻す')}</div><p>共同食料と夕食を合わせて48個まで。戻した食料を受け取る時は、従来の一日3個に従います。</p></section><section class="gulf-card"><h3>炉を囲む人びと</h3><p id="supper-attendance"></p><ul class="supper-residents">${RESIDENTS.map((r) => `<li id="supper-resident-${r.id}"><strong>${r.name}</strong><span id="supper-meal-${r.id}"></span></li>`).join('')}</ul><p>道中や会話中の人は待ち、旅先の世帯は滞在先で食べます。食料が足りなくても、仕事や旅は続きます。</p></section><section class="gulf-card"><h3>食べ終えた貝の殻</h3><p id="supper-shells" role="status"></p><div class="gulf-actions">${button('supper-shell-take', '貝塚へ運ぶ殻を1つ受け取る')}</div><p id="supper-shell-hint"></p></section><div class="gulf-actions">${button('supper-go', 'この炉へ歩く')}${button('supper-back', '共同の食料置き場へ')}</div></div>`,
    );
    $('supper-panel')
      .querySelector('.modal-intro')
      .insertAdjacentHTML(
        'afterend',
        '<p>住人も朝と昼にベリーを一人一日1つ採り、夕べの炉へ持ち帰ります。茂みに残り2個以下なら採らず、置き場が満杯なら空くまで持ち歩きます。食事や採集の記録は下の「炉を囲む人びと」で確認できます。</p>',
      );
    for (const r of RESIDENTS)
      $('supper-meal-' + r.id).insertAdjacentHTML(
        'afterend',
        `<span id="supper-forage-${r.id}"></span>`,
      );
    ($('supper-settlement') as HTMLSelectElement).onchange = (e) => {
      settlementId = (e.target as HTMLSelectElement).value;
      update();
    };
    for (const f of PANTRY_FOODS)
      $('supper-food-' + f.id).onclick = () => {
        foodId = f.id;
        update();
      };
    $('supper-give').onclick = () => perform('gulfSupperGive');
    $('supper-release').onclick = () => perform('gulfSupperRelease');
    $('supper-shell-take').onclick = () => perform('gulfSupperShells');
    $('supper-go').onclick = () => {
      const s = SETTLEMENTS.find((s) => s.id === settlementId);
      goTo(s.x, s.z + 5, s.name);
    };
    $('supper-back').onclick = () => back(settlementId);
    update();
  }
  function update() {
    if (!$('supper-panel') || !document.querySelector<HTMLDialogElement>('#modal')?.open) return;
    const world = state(),
      me = player(),
      day = world.day ?? 1,
      s = SETTLEMENTS.find((s) => s.id === settlementId),
      pantry = world.gulf?.pantries?.find((p) => p.settlementId === settlementId),
      f = PANTRY_FOODS.find((f) => f.id === foodId),
      portion = pantry?.supper?.[foodId] ?? 0,
      owned = me?.inventory[foodId] ?? 0,
      total = pantryTotal(pantry),
      reserved = supperTotal(pantry),
      usable = available() && pantryAvailable(me, world.serverTime),
      near =
        !!me &&
        Math.hypot(me.x - s.x, me.z - s.z) <= PANTRY.reach &&
        (!collision || interactionVisible(collision, me, s)),
      ready = Date.now() >= readyAt;
    const common = !available()
      ? '接続を待っています。'
      : !usable
        ? '地上で作業を終えてから用意しよう。'
        : !near
          ? '選んだ集落の炉のそばへ来よう。'
          : !ready
            ? '夕食を取り分けています…'
            : '';
    text(
      'supper-clock',
      `${day}日目 · ${DAY_PHASES[Math.min(3, Math.floor((world.dayProgress ?? 0) * 4))]} · 食事は夕べに`,
    );
    text(
      'supper-capacity',
      `置き場 ${total} / ${PANTRY.capacity} · 夕食 ${reserved} · 共同食料 ${total - reserved}`,
    );
    for (const item of PANTRY_FOODS) {
      $('supper-food-' + item.id).setAttribute('aria-pressed', String(item.id === foodId));
      text(
        'supper-count-' + item.id,
        `夕食 ${pantry?.supper?.[item.id] ?? 0} · もちもの ${me?.inventory[item.id] ?? 0}`,
      );
    }
    text('supper-selected', f.name);
    text(
      'supper-amounts',
      `夕食 ${portion} · 共同食料 ${pantry?.food[foodId] ?? 0} · もちもの ${owned}`,
    );
    text(
      'supper-hint',
      common ||
        (total >= PANTRY.capacity
          ? '置き場がいっぱいです。残った夕食は共同食料へ戻せます。'
          : owned < 1
            ? 'この食べ物を持ってきたら、夕食に分けられます。'
            : '一つ取り分けると、夕べに住人が食べられます。'),
    );
    let present = 0,
      eaten = 0;
    for (const d of RESIDENTS) {
      const r = world.residents?.find((r) => r.id === d.id),
        here = supperPlace(world, d.id) === settlementId;
      $('supper-resident-' + d.id).hidden = !here;
      if (here) {
        present++;
        if (r?.supper?.day === day) eaten++;
      }
      text('supper-meal-' + d.id, supperLabel(r?.supper, day));
      text('supper-forage-' + d.id, forageLabel(r?.forage, day));
    }
    const allEaten = (world.residents ?? []).filter((r) => r.supper?.day === day).length;
    text(
      'supper-attendance',
      `ここで過ごす${present}人のうち、今日の食事済み${eaten}人 · 湾全体 ${allEaten}/${RESIDENTS.length}人`,
    );
    const shells = pantry?.supperShells ?? 0,
      carried = me?.inventory.shells ?? 0;
    text('supper-shells', `残された殻 ${shells} / 99 · あなたの貝殻 ${carried} / 99`);
    text(
      'supper-shell-hint',
      common ||
        (shells >= 99
          ? '殻がいっぱいです。回収するまで住人は貝以外を選びます。'
          : carried >= 99
            ? 'もちものの殻を貝塚へ運んでから受け取ろう。'
            : shells < 1
              ? '住人が焼いた貝を食べると、殻が一つ残ります。'
              : '殻は既存の貝塚へ持っていこう。'),
    );
    enable(
      'supper-give',
      usable && near && ready && !!pantry && owned > 0 && total < PANTRY.capacity,
    );
    enable('supper-release', usable && near && ready && portion > 0);
    enable('supper-shell-take', usable && near && ready && shells > 0 && carried < 99);
    enable('supper-go', usable && inGulf(me?.x, me?.z));
  }
  return { open, update };
}
