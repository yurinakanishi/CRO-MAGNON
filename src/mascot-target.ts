import { mascotChoiceOrder, mascotName, mascotPictureMarkup } from './mascot-menu.js';
import { setAttr, setFlag } from './hud-dom.js';

/** A small HUD button opens a swipeable strip; choosing a target never changes the party. */
export class MascotTarget {
  readonly root: HTMLElement;
  private selected = '';
  private signature = '';
  private strip: HTMLElement;
  private toggle: HTMLButtonElement;
  private panel: HTMLElement;
  private scrollTimer = 0;
  private scrolling = false;
  private open = false;

  constructor(
    parent: HTMLElement,
    private hooks: {
      keys(): readonly string[];
      changed(): void;
      opened(): void;
    },
  ) {
    this.root = document.createElement('section');
    this.root.id = 'mascot-target';
    this.root.hidden = true;
    this.root.setAttribute('aria-label', '仲間のターゲット');
    this.root.innerHTML = `<button type="button" class="mascot-target-toggle" aria-label="仲間を選ぶ" aria-expanded="false" aria-controls="mascot-target-panel"></button>
      <div id="mascot-target-panel" hidden><div class="mascot-target-row"><button type="button" data-mascot-step="-1" aria-label="前の仲間">‹</button><div class="mascot-target-strip" aria-label="対象の仲間"></div><button type="button" data-mascot-step="1" aria-label="次の仲間">›</button></div></div>`;
    parent.append(this.root);
    this.strip = this.root.querySelector('.mascot-target-strip')!;
    this.toggle = this.root.querySelector('.mascot-target-toggle')!;
    this.panel = this.root.querySelector('#mascot-target-panel')!;
    this.toggle.onclick = () => this.setOpen(!this.open);
    this.root.querySelectorAll<HTMLButtonElement>('[data-mascot-step]').forEach((button) => {
      button.onclick = () => this.step(Number(button.dataset.mascotStep));
    });
    this.strip.onclick = (event) => {
      const card = (event.target as Element).closest<HTMLButtonElement>('[data-mascot-target]');
      if (card) this.choose(card.dataset.mascotTarget!);
    };
    // Native touch/trackpad scrolling remains native. Settle on the closest portrait.
    this.strip.addEventListener('pointerdown', () => {
      this.scrolling = true;
    });
    this.strip.addEventListener(
      'wheel',
      () => {
        this.scrolling = true;
      },
      { passive: true },
    );
    this.strip.addEventListener('scroll', () => {
      if (!this.scrolling) return;
      clearTimeout(this.scrollTimer);
      this.scrollTimer = window.setTimeout(() => {
        const center = this.strip.scrollLeft + this.strip.clientWidth / 2;
        const cards = [...this.strip.querySelectorAll<HTMLButtonElement>('[data-mascot-target]')];
        cards.sort(
          (a, b) =>
            Math.abs(a.offsetLeft + a.offsetWidth / 2 - center) -
            Math.abs(b.offsetLeft + b.offsetWidth / 2 - center),
        );
        if (cards[0]) this.choose(cards[0].dataset.mascotTarget!, false);
        this.scrolling = false;
      }, 140);
    });
    // Closing the picker must not consume the same tap on a normal action button.
    document.addEventListener(
      'pointerdown',
      (event) => {
        if (this.open && !this.root.contains(event.target as Node)) this.setOpen(false);
      },
      true,
    );
    this.root.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        event.stopPropagation();
        this.step(event.key === 'ArrowLeft' ? -1 : 1);
      } else if (event.key === 'Escape' && this.open) {
        event.preventDefault();
        event.stopPropagation();
        this.setOpen(false);
        this.toggle.focus();
      }
    });
  }

  get key() {
    const keys = mascotChoiceOrder(this.hooks.keys());
    return keys.includes(this.selected) ? this.selected : keys[0];
  }

  private setOpen(open: boolean) {
    this.open = open;
    this.panel.hidden = !open;
    this.toggle.setAttribute('aria-expanded', String(open));
    if (!open) {
      this.scrolling = false;
      clearTimeout(this.scrollTimer);
    }
    this.signature = '';
    this.refresh();
    if (open) {
      this.hooks.opened();
      this.center();
    }
  }

  step(direction: number) {
    const keys = mascotChoiceOrder(this.hooks.keys());
    if (keys.length)
      this.choose(keys[(keys.indexOf(this.key!) + direction + keys.length) % keys.length]);
  }

  private choose(key: string, center = true) {
    this.scrolling = false;
    clearTimeout(this.scrollTimer);
    this.selected = key;
    this.signature = '';
    this.hooks.changed();
    this.refresh();
    if (center) this.center();
  }

  private center() {
    const card = [...this.strip.querySelectorAll<HTMLButtonElement>('[data-mascot-target]')].find(
      (button) => button.dataset.mascotTarget === this.key,
    );
    if (card)
      this.strip.scrollTo({
        left: card.offsetLeft + card.offsetWidth / 2 - this.strip.clientWidth / 2,
      });
  }

  private refresh() {
    const keys = mascotChoiceOrder(this.hooks.keys());
    const key = this.key;
    const signature = JSON.stringify([keys, key]);
    if (signature === this.signature) return;
    this.signature = signature;
    const oldKeys = [...this.strip.querySelectorAll<HTMLButtonElement>('[data-mascot-target]')].map(
      (card) => card.dataset.mascotTarget,
    );
    if (oldKeys.join(',') !== keys.join(','))
      this.strip.innerHTML = keys
        .map(
          (key) =>
            `<button type="button" data-mascot-target="${key}" aria-label="${mascotName(key)}" aria-pressed="false">${mascotPictureMarkup(key)}<span>${mascotName(key)}</span></button>`,
        )
        .join('');
    for (const card of this.strip.querySelectorAll<HTMLButtonElement>('[data-mascot-target]'))
      setAttr(card, 'aria-pressed', String(card.dataset.mascotTarget === key));
    this.toggle.innerHTML = key
      ? `${mascotPictureMarkup(key)}<span>${mascotName(key)}<small>${keys.indexOf(key) + 1} / ${keys.length}<kbd>［ ］</kbd></small></span><span aria-hidden="true">${this.open ? '▴' : '▾'}</span>`
      : '';
    setAttr(this.toggle, 'aria-label', key ? `${mascotName(key)} — 仲間を選ぶ` : '仲間を選ぶ');
    this.root.dataset.targetKey = key ?? '';
  }

  update(visible: boolean) {
    this.refresh();
    setFlag(this.root, 'hidden', !visible || !this.key);
    if (this.root.hidden && this.open) this.setOpen(false);
  }
}
