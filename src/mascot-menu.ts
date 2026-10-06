import { BOT_DESIGNS, BOT_KINDS } from '../shared/orb-bots.mjs';
import { MASCOT_KEYS, type MascotKey } from '../shared/mascot-selection.mjs';
import type { ViewState } from './view-state.js';

const portraits: Partial<Record<MascotKey, { name: string; image: string; color: string }>> = {
  'rimo-neko': { name: 'りもねこ', image: '/title/avatar-rimo.jpg', color: '#d2c9c2' },
  '524': { name: '524', image: '/title/avatar-r524.jpg', color: '#ffdf58' },
  mae: { name: 'mae', image: '/models/mae/portrait.png', color: '#e4e5de' },
  'maruimo-mascot': {
    name: 'まるぃも',
    image: '/models/maruimo-mascot/portrait.png',
    color: '#ae6558',
  },
  kohaku: { name: 'こはくちゃん', image: '/models/kohaku/portrait-r05.png', color: '#e9cfae' },
};
const cardOrder: readonly MascotKey[] = [
  'rimo-neko',
  '524',
  'mae',
  'kohaku',
  'maruimo-mascot',
  ...BOT_KINDS,
];

function visibleKeys(state: ViewState) {
  return cardOrder.filter((key) => {
    if (key === 'mae') return !!state.mae;
    if (key === 'maruimo-mascot') return !!state.maruimo;
    if (key === 'kohaku') return !!state.kohaku;
    if (key === 'rimo-neko') return !!state.rimoNeko;
    if (key === '524') return !!state.companion524;
    return true;
  });
}

function mascotState(state: ViewState, selfId: string | null, key: MascotKey) {
  const bot = state.orbBots?.find((candidate) => candidate.kind === key);
  const body =
    key === 'mae'
      ? state.mae
      : key === 'maruimo-mascot'
        ? state.maruimo
        : key === 'kohaku'
          ? state.kohaku
          : key === 'rimo-neko'
            ? state.rimoNeko
            : key === '524'
              ? state.companion524
              : null;
  const owner =
    bot?.ownerId ||
    (body && ('squadPlayerId' in body ? body.squadPlayerId : null)) ||
    body?.followPlayerId;
  const selected = !!selfId && owner === selfId;
  const unavailable =
    !!owner && owner !== selfId && state.players.some((player) => player.id === owner);
  const status = unavailable
    ? 'ほかの旅人と一緒'
    : selected
      ? bot?.mode === 'waiting'
        ? '選択中・投げた場所で待機'
        : '一緒に行く'
      : 'キャンプで待つ';
  return { selected, unavailable, status };
}

function mascotCard(key: MascotKey) {
  const portrait = portraits[key];
  const design = BOT_KINDS.some((kind) => kind === key)
    ? BOT_DESIGNS[key as (typeof BOT_KINDS)[number]]
    : null;
  const name = portrait?.name ?? design?.name ?? key;
  const image = portrait?.image ?? (design && 'image' in design ? design.image : null);
  const face = design?.face ?? '';
  const color = portrait?.color ?? design?.color ?? '#d2c9c2';
  return `<button type="button" class="mascot-card" data-mascot="${key}" aria-label="${name}を連れて行く" aria-pressed="false" style="--mascot-color:${color}"><span class="mascot-picture">${image ? `<img src="${image}" alt="" draggable="false">` : `<span aria-hidden="true">${face}</span>`}</span><strong>${name}</strong><small class="mascot-card-status">キャンプで待つ</small></button>`;
}

export function mascotMenuMarkup(state: ViewState) {
  const cards = visibleKeys(state).map(mascotCard).join('');
  return `<div class="mascot-menu"><header class="mascot-menu-heading"><div><h2>連れていく仲間</h2><p class="modal-intro" id="mascot-selection-count" role="status"></p></div><div class="mascot-bulk"><button type="button" class="button button-outline" data-mascot-all="select">全選択</button><button type="button" class="button button-outline" data-mascot-all="clear">全選択解除</button></div></header><div class="mascot-cards">${cards}</div></div>`;
}

export function bindMascotMenu(root: HTMLElement, action: (name: string, target: string) => void) {
  root.querySelectorAll<HTMLButtonElement>('[data-mascot]').forEach((button) => {
    button.onclick = () => {
      action(
        button.getAttribute('aria-pressed') === 'true' ? 'deselectMascot' : 'selectMascot',
        button.dataset.mascot!,
      );
    };
  });
  root.querySelector<HTMLButtonElement>('[data-mascot-all="select"]')!.onclick = () =>
    action('selectMascot', 'all');
  root.querySelector<HTMLButtonElement>('[data-mascot-all="clear"]')!.onclick = () =>
    action('deselectMascot', 'all');
}

export function updateMascotMenu(root: HTMLElement, state: ViewState, selfId: string | null) {
  const cards = [...root.querySelectorAll<HTMLButtonElement>('[data-mascot]')];
  if (!cards.length) return;
  let selected = 0;
  let selectable = 0;
  for (const button of cards) {
    const key = button.dataset.mascot as MascotKey;
    if (!MASCOT_KEYS.includes(key)) continue;
    const current = mascotState(state, selfId, key);
    if (current.selected) selected++;
    if (!current.unavailable) selectable++;
    button.disabled = current.unavailable;
    button.setAttribute('aria-pressed', String(current.selected));
    button.querySelector<HTMLElement>('.mascot-card-status')!.textContent = current.status;
    button.setAttribute(
      'aria-label',
      `${button.querySelector('strong')!.textContent}を${current.selected ? 'キャンプへ帰す' : '連れて行く'}${current.unavailable ? '・ほかの旅人と一緒' : ''}`,
    );
  }
  root.querySelector<HTMLElement>('#mascot-selection-count')!.textContent =
    `${selected} / ${selectable}体を選択中`;
  root.querySelector<HTMLButtonElement>('[data-mascot-all="select"]')!.disabled =
    selected >= selectable;
  root.querySelector<HTMLButtonElement>('[data-mascot-all="clear"]')!.disabled = selected === 0;
}
