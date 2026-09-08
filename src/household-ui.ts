import { HOUSEHOLDS, JOURNEYS, householdLabel } from '../shared/household-sites.mjs';
import { RESIDENTS, VILLAGE, bundleLabel } from '../shared/village-sites.mjs';
import { SETTLEMENTS, MANY_HEARTHS, inGulf } from '../shared/gulf-region.mjs';
import { interactionVisible } from '../shared/interactions.mjs';

const distance = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.z - b.z) : Infinity);
export function installHouseholdUI(
  { player, state, available, canAct, action, goTo, openModal, collision },
  back,
) {
  const $ = (id: string) => document.getElementById(id);
  const button = (id: string, label: string) =>
    `<button id="${id}" class="button button-outline">${label}</button>`;
  function open() {
    openModal(
      `<div id="household-panel" class="gulf-panel"><p class="screen-eyebrow">同じ炉から、次の炉へ</p><h2>世帯の旅</h2><p class="modal-intro">国の炉で旅支度を手伝うと、二人が集い場まで歩きます。到着後は二日（8分）滞在して帰ります。道中は地図で確かめよう。</p><div class="resident-cards">${HOUSEHOLDS.map((d) => `<section class="gulf-card"><h3>${d.name}</h3><p>${d.members.map((id) => RESIDENTS.find((r) => r.id === id).name).join('と')} · ${SETTLEMENTS.find((s) => s.id === d.homeId).name}</p><p id="journey-state-${d.id}" role="status"></p><p>旅支度：${bundleLabel(JOURNEYS.cost)}<br>お迎えのお礼：${bundleLabel(JOURNEYS.reward)}</p><p id="journey-hint-${d.id}"></p><div class="gulf-actions">${button('journey-prepare-' + d.id, '旅支度を手伝う')}${button('journey-welcome-' + d.id, '集い場で迎える')}${button('journey-go-' + d.id, 'この国の炉へ歩く')}</div></section>`).join('')}</div><p>お迎えは二人のどちらかのそばで、各訪問につき一人一回。どの国の旅人でも参加できます。旅支度は世帯ごとに一人が渡せば十分です。帰着後は一日（4分）休みます。</p><div class="gulf-actions">${button('journey-back', '集落の人びとへ')}</div></div>`,
    );
    for (const d of HOUSEHOLDS) {
      $('journey-prepare-' + d.id).onclick = () => action('householdPrepare', d.id);
      $('journey-welcome-' + d.id).onclick = () => action('householdWelcome', d.id);
      $('journey-go-' + d.id).onclick = () => {
        const home = SETTLEMENTS.find((s) => s.id === d.homeId);
        goTo(home.x, home.z + 5, home.name);
      };
    }
    $('journey-back').onclick = back;
    update();
  }
  function update() {
    if (!$('household-panel') || !document.querySelector<HTMLDialogElement>('#modal')?.open) return;
    const world = state(),
      me = player(),
      now = world.serverTime ?? 0;
    const ready = available() && canAct(me, now);
    for (const d of HOUSEHOLDS) {
      const h = world.households?.find((h) => h.id === d.id),
        home = SETTLEMENTS.find((s) => s.id === d.homeId);
      const homeNear =
        distance(me, home) <= JOURNEYS.reach &&
        (!collision || interactionVisible(collision, me, home));
      const guestNear = (world.residents ?? []).some(
        (r) =>
          d.members.includes(r.id) &&
          distance(me, r) <= VILLAGE.reach &&
          distance(r, MANY_HEARTHS) < 65 &&
          (!collision || interactionVisible(collision, me, r)),
      );
      const missing = Object.entries(JOURNEYS.cost).some(
        ([key, n]) => (me?.inventory[key] ?? 0) < n,
      );
      const full = Object.entries(JOURNEYS.reward).some(
        ([key, n]) => (me?.inventory[key] ?? 0) + n > 99,
      );
      const done = h && (me?.gulf?.householdWelcomes?.[h.id] ?? 0) >= h.visit;
      const visiting = h?.stage === 'visiting' && h.stayUntil > now;
      const rest = Math.max(0, (h?.readyAt ?? 0) - now),
        stay = Math.max(0, (h?.stayUntil ?? 0) - now);
      const label =
        householdLabel(h, now) +
        (rest
          ? ` · あと${Math.ceil(rest / 1000)}秒`
          : visiting
            ? ` · 帰り支度まで${Math.ceil(stay / 1000)}秒`
            : '');
      const hint = !ready
        ? '地上で作業を終えてから相談しよう。'
        : h?.stage === 'home'
          ? rest
            ? '帰ってきたばかりです。炉で休ませてあげよう。'
            : !homeNear
              ? '旅支度は、この国の炉のそばで相談できます。'
              : missing
                ? `もちもの：木材${me.inventory.wood ?? 0}/2・ベリー${me.inventory.berry ?? 0}/3・水${me.inventory.water ?? 0}/1`
                : '材料を渡すと、二人が炉に集まって出発します。'
          : visiting
            ? done
              ? '今回のお迎えは済んでいます。'
              : !guestNear
                ? '集い場にいる二人のどちらかに近づこう。'
                : full
                  ? '種を受け取れるよう、もちものを空けよう。'
                  : 'ようこそ、と声をかけよう。'
            : '二人は歩いて移動します。道を空けて見送り、地図で現在地を確かめよう。';
      if ($('journey-state-' + d.id).textContent !== label)
        $('journey-state-' + d.id).textContent = label;
      if ($('journey-hint-' + d.id).textContent !== hint)
        $('journey-hint-' + d.id).textContent = hint;
      ($('journey-prepare-' + d.id) as HTMLButtonElement).disabled = !(
        ready &&
        h?.stage === 'home' &&
        !rest &&
        homeNear &&
        !missing
      );
      ($('journey-welcome-' + d.id) as HTMLButtonElement).disabled = !(
        ready &&
        visiting &&
        guestNear &&
        !done &&
        !full
      );
      ($('journey-go-' + d.id) as HTMLButtonElement).disabled = !(ready && inGulf(me?.x, me?.z));
    }
  }
  return { open, update };
}
