import { setText } from './dom-updates.js';
import { setAttr, setFlag } from './hud-dom.js';
import { BOT_DESIGNS } from '../shared/orb-bots.mjs';
import { GROUND_MASCOTS } from '../shared/friend-mascots.mjs';
import { activeMascot, mascotKeyOf, mascotName } from '../shared/mascot-selection.mjs';
import type { ViewState } from './view-state.js';
import { mascotPortrait } from './mascot-portraits.js';

const portraits: Record<string, { name: string; image: string; color: string }> = {
  ...Object.fromEntries(
    GROUND_MASCOTS.map((f) => [
      f.key,
      { name: f.name, image: f.portrait ?? `/models/${f.key}/portrait.png`, color: f.color },
    ]),
  ),
};

export { mascotName };

/** 524 leads both pickers without changing legacy saved-companion migration. */
export function mascotChoiceOrder(keys: readonly string[]) {
  return [...keys.filter((key) => key === '524'), ...keys.filter((key) => key !== '524')];
}

export function mascotPictureMarkup(key: string) {
  const portrait = portraits[key];
  const design = BOT_DESIGNS[key as keyof typeof BOT_DESIGNS];
  const photo = mascotPortrait(key);
  const image = photo ?? portrait?.image ?? (design && 'image' in design ? design.image : null);
  const face = design?.face ?? '';
  const color = portrait?.color ?? design?.color ?? '#d2c9c2';
  return `<span class="mascot-picture${photo ? ' mascot-photo' : ''}" style="--mascot-color:${color}">${image ? `<img src="${image}" alt="" draggable="false">` : `<span aria-hidden="true">${face}</span>`}</span>`;
}

function mascotCard(key: string) {
  const name = mascotName(key);
  return `<button type="button" class="mascot-card" data-mascot="${key}" aria-label="${name}を連れて行く" aria-pressed="false">${mascotPictureMarkup(key)}<strong>${name}</strong><small class="mascot-card-status" hidden></small></button>`;
}

/** One companion each, chosen from every mascot this build offers. Any number of
 * travelers may bring the same one, so no card is ever taken by someone else. */
export function mascotMenuMarkup(keys: readonly string[]) {
  const cards = mascotChoiceOrder(keys).map(mascotCard).join('');
  return `<div class="mascot-menu"><header class="mascot-menu-heading"><div><h2>連れていく仲間</h2><p class="modal-intro">1人1匹まで。同じ仲間をほかの旅人も連れていけます。</p></div><div class="mascot-bulk"><button type="button" class="button button-outline" data-mascot-none>連れていかない</button></div></header><div class="mascot-cards">${cards}</div></div>`;
}

export function bindMascotMenu(root: HTMLElement, action: (name: string, target?: string) => void) {
  root.querySelectorAll<HTMLButtonElement>('[data-mascot]').forEach((button) => {
    button.onclick = () => {
      if (button.getAttribute('aria-pressed') === 'true') action('deselectMascot');
      else action('selectMascot', button.dataset.mascot!);
    };
  });
  root.querySelector<HTMLButtonElement>('[data-mascot-none]')!.onclick = () =>
    action('deselectMascot');
}

export function updateMascotMenu(root: HTMLElement, state: ViewState, selfId: string | null) {
  const cards = [...root.querySelectorAll<HTMLButtonElement>('[data-mascot]')];
  if (!cards.length) return;
  const chosen = state.players.find((p) => p.id === selfId)?.mascot ?? null;
  const body = activeMascot(state, selfId);
  const deployed =
    !!body &&
    ['airborne', 'landing', 'waiting'].includes('kind' in body ? body.mode : body.squadMode);
  for (const button of cards) {
    const key = button.dataset.mascot!;
    const selected = key === chosen;
    const status = !selected
      ? ''
      : body && mascotKeyOf(body) === key
        ? deployed
          ? '投げた場所で待っている'
          : '一緒に行く'
        : 'まもなく来る';
    button.setAttribute('aria-pressed', String(selected));
    const label = button.querySelector<HTMLElement>('.mascot-card-status')!;
    setText(label, status);
    setFlag(label, 'hidden', !status);
    setAttr(
      button,
      'aria-label',
      `${mascotName(key)}を${selected ? '連れていくのをやめる' : '連れて行く'}`,
    );
  }
  root.querySelector<HTMLButtonElement>('[data-mascot-none]')!.disabled = !chosen;
}
