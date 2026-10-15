import { CLOTHING_DYES, normalizeDye } from '../shared/clothing-dye.mjs';
import { setLocalizedText } from './language-ui.js';

const OWN_COLOURS = '元の色';

const dyeEntry = (dye: unknown) => CLOTHING_DYES.find((entry) => entry.key === normalizeDye(dye));
const dyeName = (dye: unknown) => dyeEntry(dye)?.name ?? OWN_COLOURS;

/**
 * The clothing colours as one row of round swatches, the character's own colours first. In the
 * players' list a tap dyes at once, for everyone nearby to see; there is nothing to confirm or
 * save. With `choice`, beside the character cards, a tap only picks the colour, worn with the
 * apply button. The swatches are large enough to tap on a phone and wrap onto a second
 * row on a narrow screen.
 */
export function dyePickerMarkup(current: unknown, { choice = false } = {}) {
  const chosen = normalizeDye(current) ?? '';
  const swatch = (key: string, name: string, color?: string) =>
    `<button type="button" class="dye-swatch${color ? '' : ' dye-own'}" data-dye="${key}" aria-pressed="${chosen === key}" aria-label="${name}" title="${name}"${color ? ` style="--dye: ${color}"` : ''}></button>`;
  return `<fieldset class="dye-picker"${choice ? ' data-dye-choice' : ''}><legend>服の色<span class="dye-name">${dyeName(current)}</span></legend><div class="dye-swatches">${swatch('', OWN_COLOURS)}${CLOTHING_DYES.map((dye) => swatch(dye.key, dye.name, dye.color)).join('')}</div></fieldset>`;
}

/** The draft outfit's colour: a small swatch and its name. */
export function dyeLabelMarkup(dye: unknown) {
  const color = dyeEntry(dye)?.color;
  return `<span class="dye-label"><i class="dye-chip${color ? '' : ' dye-own'}" aria-hidden="true"${color ? ` style="--dye: ${color}"` : ''}></i>服の色<span class="dye-name">${dyeName(dye)}</span></span>`;
}

/** `choose` sends a dye key ('' for the own colours); the swatches follow the shared state. */
export function bindDyePickers(root: ParentNode, choose: (dye: string) => void) {
  for (const picker of root.querySelectorAll<HTMLElement>('.dye-picker:not([data-dye-choice])'))
    picker.onclick = (event) => {
      const swatch = (event.target as Element).closest<HTMLButtonElement>('[data-dye]');
      if (!swatch || swatch.getAttribute('aria-pressed') === 'true') return;
      choose(swatch.dataset.dye ?? '');
    };
}

/** Marks `dye` in one picker and names it in the legend. */
export function showDye(picker: Element, dye: unknown) {
  const chosen = normalizeDye(dye) ?? '';
  for (const swatch of picker.querySelectorAll<HTMLButtonElement>('[data-dye]')) {
    const pressed = String(swatch.dataset.dye === chosen);
    if (swatch.getAttribute('aria-pressed') !== pressed)
      swatch.setAttribute('aria-pressed', pressed);
  }
  const name = picker.querySelector('.dye-name');
  if (name) setLocalizedText(name, dyeName(chosen));
}

/** The colour a picker holds: a dye key, or '' for the character's own colours. */
export function pickedDye(picker: Element) {
  return picker.querySelector<HTMLElement>('[data-dye][aria-pressed="true"]')?.dataset.dye ?? '';
}

/** Shows the dye the room knows the player wears; a picker that only picks keeps its pick. */
export function updateDyePickers(current: unknown) {
  for (const picker of document.querySelectorAll<HTMLElement>('.dye-picker:not([data-dye-choice])'))
    showDye(picker, current);
}
