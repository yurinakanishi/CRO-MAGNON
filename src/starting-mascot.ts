import { mascotModelReleased } from '../shared/mascot-roster.mjs';
import { MASCOT_KEYS } from '../shared/mascot-selection.mjs';
import { mascotChoiceOrder, mascotName, mascotPictureMarkup } from './mascot-menu.js';
import { setLocalizedText } from './language-ui.js';

export const STARTING_MASCOTS = mascotChoiceOrder(
  MASCOT_KEYS.filter((key) => mascotModelReleased(key === '524' ? 'yellow-524-mascot' : key)),
);

/** Older browsers have no cached companion yet. Keep that saved choice until the
 * visitor explicitly picks one; new travellers can simply travel alone. */
export function startingMascotMarkup(
  keys: readonly string[],
  choice: string,
  resume: boolean,
  multiple = false,
) {
  const choices = multiple ? choice.split(',') : [choice];
  const previous = resume && choice !== 'none' && !choices.every((key) => keys.includes(key));
  const selected = previous ? ['keep'] : choices.filter((key) => keys.includes(key));
  if (!multiple && !selected.length) selected.push('none');
  const cards = [
    ...(previous ? [{ key: 'keep', name: '前回の仲間', picture: '' }] : []),
    ...keys.map((key) => ({ key, name: mascotName(key), picture: mascotPictureMarkup(key) })),
    ...(!multiple ? [{ key: 'none', name: '連れていかない', picture: '' }] : []),
  ];
  return `<fieldset class="starting-mascot" data-multiple="${multiple}"><legend><span>連れていく仲間</span><small>${multiple ? '複数選択' : '1匹'}</small></legend>${multiple ? '<div class="mascot-bulk"><button type="button" class="button button-outline" data-starting-mascot-all>全選択</button><button type="button" class="button button-outline" data-starting-mascot-none>全解除</button></div>' : ''}<div class="starting-mascot-cards">${cards.map(({ key, name, picture }) => `<button type="button" class="mascot-card" data-starting-mascot="${key}" aria-pressed="${selected.includes(key)}">${picture}<strong>${name}</strong></button>`).join('')}</div><p class="starting-mascot-choice" aria-live="polite"></p></fieldset>`;
}

export function pickedStartingMascot(form: HTMLElement): string {
  if (form.querySelector('[data-multiple="true"]'))
    return (
      [...form.querySelectorAll<HTMLButtonElement>('[data-starting-mascot][aria-pressed="true"]')]
        .map((card) => card.dataset.startingMascot)
        .join(',') || 'none'
    );
  return (
    form.querySelector<HTMLButtonElement>('[data-starting-mascot][aria-pressed="true"]')?.dataset
      .startingMascot ?? 'keep'
  );
}

export function bindStartingMascot(
  form: HTMLElement,
  keys: readonly string[],
  choice: string,
  resume: boolean,
  multiple = false,
) {
  const host = form.querySelector<HTMLElement>('[data-starting-mascot-picker]')!;
  host.innerHTML = startingMascotMarkup(keys, choice, resume, multiple);
  const update = () => {
    const picked = pickedStartingMascot(form);
    setLocalizedText(
      host.querySelector('.starting-mascot-choice'),
      picked === 'keep'
        ? '前回の仲間'
        : picked === 'none'
          ? '連れていかない'
          : multiple
            ? `${picked.split(',').length}匹を選択中`
            : mascotName(picked),
    );
  };
  host.onclick = (event) => {
    const bulk = (event.target as Element).closest(
      '[data-starting-mascot-all], [data-starting-mascot-none]',
    );
    if (bulk) {
      for (const card of host.querySelectorAll<HTMLButtonElement>('[data-starting-mascot]'))
        card.setAttribute(
          'aria-pressed',
          String(
            bulk.hasAttribute('data-starting-mascot-all') &&
              keys.includes(card.dataset.startingMascot!),
          ),
        );
      update();
      return;
    }
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-starting-mascot]');
    if (!button) return;
    const wasSelected = button.getAttribute('aria-pressed') === 'true';
    for (const card of host.querySelectorAll<HTMLButtonElement>('[data-starting-mascot]'))
      if (!multiple || button.dataset.startingMascot === 'keep')
        card.setAttribute('aria-pressed', String(card === button));
      else if (card === button) card.setAttribute('aria-pressed', String(!wasSelected));
      else if (card.dataset.startingMascot === 'keep') card.setAttribute('aria-pressed', 'false');
    update();
  };
  update();
}
