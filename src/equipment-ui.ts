import type { EquipmentId } from '../shared/types.mjs';
import { equippedItem, equipmentInfo } from '../shared/equipment.mjs';
import { equipmentReason } from '../shared/equipment-actions.mjs';
import { icon } from './icons.js';
import { setText } from './hud-dom.js';

/** A confirmation inside the bag; opening or declining it never equips anything. */
export function installEquipmentUI({ player, now, connected, request, settle, status }) {
  let selected: EquipmentId | null = null;
  let pending = false;
  let resultText = '';
  let origin: HTMLElement | null = null;
  let restoreSelector = '';
  const root = () => document.querySelector<HTMLElement>('#equipment-confirm');
  function close(force = false): boolean {
    const panel = root();
    if (!panel) return false;
    if (pending && !force) return true;
    panel.remove();
    selected = null;
    pending = false;
    const previous = origin?.isConnected
      ? origin
      : document.querySelector<HTMLElement>(restoreSelector);
    previous?.focus({ preventScroll: true });
    settle();
    return true;
  }
  function update() {
    const panel = root();
    if (!panel || !selected) return;
    if (!connected() && pending) pending = false;
    const me = player();
    const reason = connected() ? equipmentReason(me, selected, now()) : '接続を待っています。';
    const yes = panel.querySelector<HTMLButtonElement>('#equipment-confirm-yes')!;
    yes.disabled = pending || !!reason;
    setText(yes, pending ? '確認中…' : '装備する');
    panel.querySelector<HTMLButtonElement>('#equipment-confirm-no')!.disabled = pending;
    setText(panel.querySelector('#equipment-confirm-result')!, reason || resultText);
    if (me) {
      const current = equipmentInfo(me, equippedItem(me)).name;
      setText(panel.querySelector('#equipment-current')!, `今の装備：${current}`);
    }
  }
  function open(id: EquipmentId, crafted = false, from?: HTMLElement) {
    const modal = document.querySelector<HTMLDialogElement>('#modal');
    const body = modal?.querySelector<HTMLElement>('#modal-body');
    const me = player();
    if (!modal?.open || !body || !me || root()) return;
    origin = from ?? (document.activeElement as HTMLElement);
    restoreSelector = origin?.dataset.craft
      ? `[data-craft="${origin.dataset.craft}"]`
      : `[data-item="${origin?.closest<HTMLElement>('[data-item]')?.dataset.item ?? 'weapon'}"]`;
    selected = id;
    pending = false;
    resultText = '';
    const item = equipmentInfo(me, id);
    body.insertAdjacentHTML(
      'afterbegin',
      `<div id="equipment-confirm" class="equipment-confirm" role="dialog" aria-modal="true" aria-labelledby="equipment-confirm-title" aria-describedby="equipment-current equipment-confirm-note" data-focus-scope><div class="equipment-confirm-card"><span class="resource-icon">${icon(item.icon)}</span><p class="equipment-confirm-name">${item.name}${crafted ? 'ができました' : ''}</p><h3 id="equipment-confirm-title">これを装備しますか？</h3><p id="equipment-current"></p><p id="equipment-confirm-note">${item.note}。今の装備は持ち物に残ります。</p><p id="equipment-confirm-result" role="status" aria-live="polite"></p><div class="equipment-confirm-actions"><button id="equipment-confirm-yes" type="button" class="button button-accent">装備する</button><button id="equipment-confirm-no" type="button" class="button button-outline">今はしない</button></div></div></div>`,
    );
    const panel = root()!;
    panel.onclick = (event) => {
      if (event.target === panel) close();
    };
    panel.querySelector<HTMLButtonElement>('#equipment-confirm-no')!.onclick = () => close();
    panel.querySelector<HTMLButtonElement>('#equipment-confirm-yes')!.onclick = () => {
      if (pending || !connected() || equipmentReason(player(), id, now())) {
        update();
        return;
      }
      pending = true;
      resultText = '';
      update();
      request(id);
    };
    update();
    panel.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    settle();
  }
  function result(message) {
    if (!pending || message.itemId !== selected || !root()) return;
    pending = false;
    if (message.ok) {
      close();
      status(message.text, true);
    } else {
      resultText = message.text;
      update();
    }
  }
  return { open, close, update, result };
}
