import {
  RESIDENTS,
  VILLAGE,
  DAY_PHASES,
  bundleLabel,
  ITEM_NAMES,
} from '../shared/village-sites.mjs';
import { SETTLEMENTS, inGulf } from '../shared/gulf-region.mjs';
import { interactionVisible } from '../shared/interactions.mjs';
import { attackProfile } from '../shared/combat-profiles.mjs';

const distance = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.z - b.z) : Infinity);
export function residentAvailable(me, now = Date.now()) {
  return (
    !!me &&
    !me.downedUntil &&
    !me.mountId &&
    !me.boatId &&
    !me.fishing &&
    !me.coastalActivity &&
    !me.cookingEndsAt &&
    !(me.attackSequence && now - me.attackAt < attackProfile(me).durationMs)
  );
}
export function residentInteraction(state, me, collision?) {
  if (!residentAvailable(me, state.serverTime)) return null;
  const p = (state.residents ?? [])
    .filter(
      (r) =>
        distance(me, r) <= VILLAGE.reach && (!collision || interactionVisible(collision, me, r)),
    )
    .sort((a, b) => distance(me, a) - distance(me, b))[0];
  const definition = RESIDENTS.find((d) => d.id === p?.id);
  return definition
    ? { action: 'residentOpen', targetId: definition.id, label: `${definition.name}に話しかける` }
    : null;
}

export function installVillageUI({ player, state, available, action, goTo, openModal, collision }) {
  let settlementId = SETTLEMENTS[0].id as string;
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const button = (id: string, text: string) =>
    `<button id="${id}" class="button button-outline">${text}</button>`;
  const text = (id: string, value: string) => {
    const n = $(id);
    if (n && n.textContent !== value) n.textContent = value;
  };
  const enable = (id: string, yes: boolean) => {
    const b = $<HTMLButtonElement>(id);
    if (b) b.disabled = !yes;
  };
  const near = (r, me = player()) =>
    distance(me, r) <= VILLAGE.reach && (!collision || interactionVisible(collision, me, r));
  const bind = (id: string, fn) => {
    const b = $(id);
    if (b) b.onclick = fn;
  };
  function open(id?: string) {
    const d = RESIDENTS.find((r) => r.id === id);
    if (d) {
      settlementId = d.settlementId;
      openModal(
        `<div id="village-panel" data-person="${d.id}"><p class="screen-eyebrow">炉のそばの話</p><h2>${d.name}</h2><p class="modal-intro">${SETTLEMENTS.find((s) => s.id === d.settlementId).name} · <span id="village-clock"></span></p><p id="resident-activity-${d.id}"></p><blockquote class="resident-speech">${d.introduction}</blockquote><section class="gulf-card"><h3>今日の手伝い</h3><p>${d.request}</p><p id="resident-supplies"></p><p>お礼：${bundleLabel(d.reward)}</p><p id="resident-result" role="status"></p><div class="gulf-actions">${button('resident-help', '材料を渡して手伝う')}${button('resident-talk', 'もう少し話す')}</div></section><div class="gulf-actions">${button('resident-back', '集落の人びとへ')}</div></div>`,
      );
      bind('resident-help', () => action('residentHelp', d.id));
      bind('resident-talk', () => action('residentTalk', d.id));
      bind('resident-back', () => directory());
      update();
      const current = state().residents?.find((r) => r.id === d.id);
      if (available() && residentAvailable(player(), state().serverTime) && near(current))
        action('residentTalk', d.id);
    } else directory(true);
  }
  function directory(chooseNearest = false) {
    if (chooseNearest)
      settlementId = [...SETTLEMENTS].sort(
        (a, b) => distance(player(), a) - distance(player(), b),
      )[0].id;
    openModal(
      `<div id="village-panel"><p class="screen-eyebrow">三つの岸の暮らし</p><h2>集落の人びと</h2><p class="modal-intro">朝と昼は仕事場へ、夕べは炉へ。そばに来たらE／×で話しかけよう。<br><span id="village-clock"></span></p><label class="resident-select">訪ねる集落<select id="village-settlement">${SETTLEMENTS.map((s) => `<option value="${s.id}" ${s.id === settlementId ? 'selected' : ''}>${s.name}</option>`).join('')}</select></label><div class="resident-cards">${RESIDENTS.filter(
        (d) => d.settlementId === settlementId,
      )
        .map(
          (d) =>
            `<section class="gulf-card"><h3>${d.name}</h3><p id="resident-activity-${d.id}"></p><p id="resident-met-${d.id}"></p><p>${d.request}</p><p>渡す：${bundleLabel(d.cost)}<br>お礼：${bundleLabel(d.reward)}</p><div class="gulf-actions">${button('resident-open-' + d.id, '話しかける')}${button('resident-near-' + d.id, '仕事・休息中の人のそばへ')}</div></section>`,
        )
        .join(
          '',
        )}</div><p>住人は集落の中を歩いています。炉の周りの畑や作業場を訪ねよう。手伝いはそれぞれ一日一回、どの国の旅人も参加できます。</p><div class="gulf-actions">${button('resident-go', 'この集落の炉へ歩く')}${button('resident-gulf', '湾の旅の案内')}</div></div>`,
    );
    $<HTMLSelectElement>('village-settlement').onchange = (event) => {
      settlementId = (event.target as HTMLSelectElement).value;
      directory();
    };
    for (const d of RESIDENTS) {
      bind('resident-open-' + d.id, () => open(d.id));
      bind('resident-near-' + d.id, () => {
        const r = state().residents?.find((p) => p.id === d.id);
        if (!r || r.moving || distance(player(), r) > 65) return;
        const dynamic = [...state().players, ...state().residents]
          .filter((p) => p.id !== player().id)
          .map((p) => ({ type: 'circle', x: p.x, z: p.z, radius: p.radius }));
        const point = collision?.nearestFree({ x: r.x, z: r.z + 1.3 }, player().radius, dynamic, 3);
        if (point) goTo(point.x, point.z, d.name + 'の現在地');
      });
    }
    bind('resident-go', () => {
      const s = SETTLEMENTS.find((s) => s.id === settlementId);
      goTo(s.x, s.z + 5, s.name);
    });
    bind('resident-gulf', () => action('gulfOpen'));
    update();
  }
  function update() {
    if (!$('village-panel') || !document.querySelector<HTMLDialogElement>('#modal')?.open) return;
    const world = state(),
      me = player(),
      day = world.day ?? 1;
    const ready = available() && residentAvailable(me, world.serverTime);
    text(
      'village-clock',
      `${day}日目 · ${DAY_PHASES[Math.min(3, Math.floor((world.dayProgress ?? 0) * 4))]}`,
    );
    for (const d of RESIDENTS) {
      const r = world.residents?.find((p) => p.id === d.id);
      const done = (me?.gulf?.residentHelp?.[d.id] ?? 0) >= day;
      text('resident-activity-' + d.id, r?.activity ?? '到着を待っています');
      text(
        'resident-met-' + d.id,
        done
          ? '今日の手伝いは済んでいます'
          : me?.gulf?.metResidents?.includes(d.id)
            ? '顔なじみ · 今日の手伝いがあります'
            : 'まだ話したことがない人',
      );
      enable('resident-open-' + d.id, ready && near(r));
      enable('resident-near-' + d.id, ready && !!r && !r.moving && distance(me, r) <= 65);
      if ($('village-panel').dataset.person !== d.id) continue;
      const missing = Object.entries(d.cost).some(([key, n]) => (me?.inventory[key] ?? 0) < n);
      const full = Object.entries(d.reward).some(
        ([key, n]) => (me?.inventory[key] ?? 0) - (d.cost[key] ?? 0) + n > 99,
      );
      text(
        'resident-supplies',
        'もちもの：' +
          Object.entries(d.cost)
            .map(([key, n]) => `${ITEM_NAMES[key]} ${me?.inventory[key] ?? 0}/${n}`)
            .join('・'),
      );
      text(
        'resident-result',
        done
          ? `今日の手伝いを済ませた。${d.thanks}`
          : !ready
            ? '地上で作業を終えてから話そう。'
            : !near(r)
              ? '住人が離れました。近づいてまた話そう。'
              : missing
                ? '必要なものを集めて、持ってこよう。'
                : full
                  ? 'お礼を受け取れるよう、もちものを空けよう。'
                  : '材料を渡すと、お礼を受け取れます。',
      );
      enable('resident-help', ready && near(r) && !done && !missing && !full);
      enable('resident-talk', ready && near(r));
    }
    enable('resident-go', ready && inGulf(me?.x, me?.z));
  }
  return { open, update };
}
