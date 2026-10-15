import { mascotModelReleased } from '../shared/mascot-roster.mjs';
import { MASCOT_KEYS } from '../shared/mascot-selection.mjs';
import { mascotName, mascotPictureMarkup } from './mascot-menu.js';
import { setLocalizedText } from './language-ui.js';

export const STARTING_MASCOTS = MASCOT_KEYS.filter((key) =>
  mascotModelReleased(key === '524' ? 'yellow-524-mascot' : key),
);

/** Older browsers have no cached companion yet. Keep that saved choice until the
 * visitor explicitly picks one; new travellers can simply travel alone. */
export function startingMascotMarkup(keys: readonly string[], choice: string, resume: boolean) {
  const previous = resume && choice !== 'none' && !keys.includes(choice);
  const selected = previous ? 'keep' : keys.includes(choice) ? choice : 'none';
  const cards = [
    ...(previous ? [{ key: 'keep', name: '前回の仲間', picture: '' }] : []),
    ...keys.map((key) => ({ key, name: mascotName(key), picture: mascotPictureMarkup(key) })),
    { key: 'none', name: '連れていかない', picture: '' },
  ];
  return `<fieldset class="starting-mascot"><legend><span>連れていく仲間</span><small>1匹</small></legend><div class="starting-mascot-cards">${cards.map(({ key, name, picture }) => `<button type="button" class="mascot-card" data-starting-mascot="${key}" aria-pressed="${key === selected}">${picture}<strong>${name}</strong></button>`).join('')}</div><p class="starting-mascot-choice" aria-live="polite"></p></fieldset>`;
}

export function pickedStartingMascot(form: HTMLElement): string {
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
) {
  const host = form.querySelector<HTMLElement>('[data-starting-mascot-picker]')!;
  host.innerHTML = startingMascotMarkup(keys, choice, resume);
  const update = () => {
    const picked = pickedStartingMascot(form);
    setLocalizedText(
      host.querySelector('.starting-mascot-choice'),
      picked === 'keep' ? '前回の仲間' : picked === 'none' ? '連れていかない' : mascotName(picked),
    );
  };
  host.onclick = (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-starting-mascot]');
    if (!button) return;
    for (const card of host.querySelectorAll<HTMLButtonElement>('[data-starting-mascot]'))
      card.setAttribute('aria-pressed', String(card === button));
    update();
  };
  update();
}
