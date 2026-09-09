import {
  BARTER,
  BARTER_ITEMS,
  barterFor,
  barterActive,
  barterProblem,
  barterOfferLabel,
} from '../shared/barter.mjs';
import { MANY_HEARTHS } from '../shared/gulf-region.mjs';

export function installBarterUI({ player, state, available, send, openModal, collision }, back) {
  const $ = (id: string) => document.getElementById(id);
  const text = (id: string, value: string) => {
    const n = $(id);
    if (n && n.textContent !== value) n.textContent = value;
  };
  const enabled = (id: string, yes: boolean) => {
    const n = $(id) as HTMLButtonElement;
    if (n) n.disabled = !yes;
  };
  const button = (id: string, label: string) =>
    `<button id="${id}" class="button button-outline">${label}</button>`;
  let viewing = false,
    key = '',
    partnerId = '',
    item = 'obsidian',
    quantity = 1,
    readyAt = 0,
    dismissed = '';
  const current = () => barterFor(state().barters, player()?.id);
  function leave() {
    if (!viewing) return;
    viewing = false;
    key = '';
    // Also cancels an invite sent just before its acknowledgement arrived.
    send({ type: 'barter', kind: 'cancel' });
  }
  document.querySelector('#modal').addEventListener('close', leave);
  const suspend = () => {
    if (viewing) send({ type: 'barter', kind: 'cancel' });
  };
  window.addEventListener('blur', suspend);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) suspend();
  });
  function request(payload) {
    if (!available() || Date.now() < readyAt) return;
    readyAt = Date.now() + 500;
    send({ type: 'barter', ...payload });
    update();
  }
  function offer(t) {
    request({ kind: 'offer', tradeId: t.id, revision: t.revision, item, quantity });
  }
  function open() {
    key = '';
    dismissed = '';
    openModal(
      `<div id="barter-panel" class="gulf-panel"><p class="screen-eyebrow">多くの炉で、旅の品を並べる</p><h2>旅人と物々交換</h2><p class="modal-intro">二人で品物を見せ合い、同じ内容に同意してから交換します。成立するまで、品物は自分のもちものに残ります。</p><p id="barter-clock"></p><div id="barter-body"></div><div class="gulf-actions">${button('barter-back', '湾の旅の案内へ')}</div></div>`,
    );
    viewing = true;
    $('barter-back').onclick = () => {
      leave();
      back();
    };
    update();
  }
  function render(t) {
    const me = player(),
      own = t?.players.indexOf(me?.id);
    if (!t) {
      $('barter-body').innerHTML =
        `<label class="pantry-select">相手を選ぶ<select id="barter-partner" aria-label="交換する旅人"></select></label><p id="barter-nearby" role="status"></p><p>集い場の中心から22m以内で、相手から4m以内へ。相手も地上で止まっている時に誘えます。所属する国や種族は問いません。</p><div class="gulf-actions">${button('barter-invite', 'この人を交換に誘う')}</div>`;
      ($('barter-partner') as HTMLSelectElement).onchange = (e) => {
        partnerId = (e.target as HTMLSelectElement).value;
        update();
      };
      $('barter-invite').onclick = () => request({ kind: 'invite', targetId: partnerId });
      return;
    }
    const cards = `<div class="barter-offers"><section class="gulf-card"><h3>あなたが渡すもの</h3><p id="barter-my-offer" class="barter-value"></p><p id="barter-my-ready"></p></section><section class="gulf-card"><h3>あなたが受け取るもの</h3><p id="barter-other-offer" class="barter-value"></p><p id="barter-other-ready"></p></section></div>`;
    if (!barterActive(t)) {
      $('barter-body').innerHTML =
        `<p id="barter-result" class="barter-result" role="status"></p>${cards}<div class="gulf-actions">${button('barter-again', '次の交換を相談する')}</div>`;
      $('barter-again').onclick = () => {
        dismissed = t.id;
        key = '';
        update();
      };
      return;
    }
    if (t.status === 'invited') {
      $('barter-body').innerHTML =
        `<p id="barter-invitation" role="status"></p><p>参加すると二人で渡す品物を選べます。この段階では交換は成立しません。</p><div class="gulf-actions">${own === 1 ? button('barter-join', '参加して品物を相談する') : ''}${button('barter-cancel', own === 1 ? '今回は断る' : '誘いを取り消す')}</div>`;
      if (own === 1)
        $('barter-join').onclick = () => {
          const t = current();
          request({ kind: 'join', tradeId: t.id, revision: t.revision });
        };
    } else {
      const offered = t.offers[own];
      item =
        offered?.item ?? BARTER_ITEMS.find((f) => (me?.inventory[f.id] ?? 0) > 0)?.id ?? 'obsidian';
      quantity = offered?.quantity ?? 1;
      $('barter-body').innerHTML =
        `<p id="barter-partner-name"></p>${cards}<div class="barter-draft"><label class="pantry-select">あなたが提示する品物<select id="barter-item">${BARTER_ITEMS.map((f) => `<option value="${f.id}">${f.name}</option>`).join('')}</select></label><label class="pantry-select">数量<select id="barter-quantity">${Array.from({ length: BARTER.maxQuantity }, (_, i) => `<option value="${i + 1}">${i + 1}個</option>`).join('')}</select></label></div><p id="barter-owned"></p><p id="barter-hint" role="status"></p><div class="gulf-actions">${button('barter-offer', 'この品物を提示する')}${button('barter-revise', '同意を取り消して見直す')}</div><p>提示内容を変えると、二人とも確認し直します。同意済みの時は、先に同意を取り消してから変更できます。</p><div class="gulf-actions">${button('barter-accept', 'この内容で交換する')}${button('barter-cancel', '交換を中止する')}</div>`;
      ($('barter-item') as HTMLSelectElement).value = item;
      ($('barter-quantity') as HTMLSelectElement).value = String(quantity);
      ($('barter-item') as HTMLSelectElement).onchange = (e) => {
        item = (e.target as HTMLSelectElement).value;
        update();
      };
      ($('barter-quantity') as HTMLSelectElement).onchange = (e) => {
        quantity = Number((e.target as HTMLSelectElement).value);
        update();
      };
      $('barter-offer').onclick = () => offer(current());
      $('barter-accept').onclick = () => {
        const t = current();
        request({ kind: 'accept', tradeId: t.id, revision: t.revision });
      };
      $('barter-revise').onclick = () => {
        const t = current(),
          own = t.players.indexOf(player().id),
          o = t.offers[own];
        request({
          kind: 'offer',
          tradeId: t.id,
          revision: t.revision,
          item: o.item,
          quantity: o.quantity,
        });
      };
    }
    $('barter-cancel').onclick = () => {
      send({ type: 'barter', kind: 'cancel', tradeId: current()?.id });
      readyAt = Date.now() + 500;
      update();
    };
  }
  function update() {
    if (!$('barter-panel') || !document.querySelector<HTMLDialogElement>('#modal')?.open) {
      leave();
      return;
    }
    const world = state(),
      me = player(),
      found = current(),
      t = found?.id === dismissed ? null : found;
    const nextKey = t ? `${t.id}:${t.status}` : 'choose';
    if (key !== nextKey) {
      key = nextKey;
      render(t);
    }
    const ready = available() && Date.now() >= readyAt;
    text(
      'barter-clock',
      barterActive(t)
        ? `この相談の残り ${Math.max(0, Math.ceil((t.expiresAt - world.serverTime) / 1000))}秒`
        : '',
    );
    if (!t) {
      const select = $('barter-partner') as HTMLSelectElement;
      const peers = (world.players ?? []).filter(
        (p) =>
          p.id !== me?.id &&
          Math.hypot(p.x - MANY_HEARTHS.x, p.z - MANY_HEARTHS.z) <= BARTER.campReach,
      );
      const ids = new Set(peers.map((p) => p.id));
      for (const option of [...select.options]) if (!ids.has(option.value)) option.remove();
      for (const p of peers) {
        let option = [...select.options].find((o) => o.value === p.id);
        if (!option) {
          option = document.createElement('option');
          option.value = p.id;
          select.append(option);
        }
        const label = `${p.name} · ${Math.round(Math.hypot(p.x - (me?.x ?? 0), p.z - (me?.z ?? 0)))}m`;
        if (option.textContent !== label) option.textContent = label;
      }
      if (!ids.has(partnerId)) partnerId = peers[0]?.id ?? '';
      if (select.value !== partnerId) select.value = partnerId;
      const other = peers.find((p) => p.id === partnerId);
      const busy = world.barters?.some((b) => barterActive(b) && b.players.includes(partnerId));
      const problem = !available()
        ? '接続を待っています。'
        : !other
          ? '集い場に交換できる旅人がまだいません。'
          : busy
            ? '相手は別の交換を相談中です。'
            : barterProblem(me, other, world.serverTime, collision);
      text('barter-nearby', problem || '相手を誘い、返事を待とう。');
      enabled('barter-invite', ready && !problem);
      return;
    }
    const own = t.players.indexOf(me?.id),
      other = world.players.find((p) => p.id === t.players[1 - own]);
    const name = other?.name ?? '相手';
    text('barter-my-offer', barterOfferLabel(t.offers[own]));
    text('barter-other-offer', barterOfferLabel(t.offers[1 - own]));
    text('barter-my-ready', t.accepted[own] ? 'あなたは同意済み' : 'あなたの確認はまだです');
    text(
      'barter-other-ready',
      t.accepted[1 - own] ? `${name}も同意済み` : `${name}の確認はまだです`,
    );
    if (!barterActive(t)) {
      text('barter-result', t.reason);
      return;
    }
    const problem = barterProblem(me, other, world.serverTime, collision);
    if (t.status === 'invited') {
      text(
        'barter-invitation',
        own === 1 ? `${name}から交換の誘いが届いています。` : `${name}の返事を待っています。`,
      );
      enabled('barter-join', ready && !problem);
      return;
    }
    text('barter-partner-name', `${name}と相談しています。`);
    const owned = me?.inventory[item] ?? 0,
      offer = t.offers[own],
      matched = offer?.item === item && offer?.quantity === quantity,
      locked = t.accepted[own];
    const missing = !t.offers[0] || !t.offers[1];
    text('barter-owned', `この品物のもちもの ${owned}個 · 提示する数 ${quantity}個`);
    text(
      'barter-hint',
      problem ||
        t.reason ||
        (locked
          ? '相手も同意すると交換が成立します。'
          : !matched
            ? '選んだ品物と数量を、相手へ提示しよう。'
            : missing
              ? '相手の品物が提示されるのを待とう。'
              : '渡すものと受け取るものを確認して、交換に同意しよう。'),
    );
    enabled('barter-item', !locked);
    enabled('barter-quantity', !locked);
    enabled('barter-offer', ready && !problem && !locked && owned >= quantity && !matched);
    enabled('barter-revise', ready && !problem && locked);
    enabled('barter-accept', ready && !problem && !locked && matched && !missing);
  }
  function hint() {
    const t = current();
    return barterActive(t)
      ? t.status === 'invited' && t.players[1] === player()?.id
        ? '物々交換の誘いが届いています'
        : '物々交換を相談中'
      : '';
  }
  return { open, update, hint };
}
