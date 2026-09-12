/**
 * Full-screen game screens (title, setup) shown over the 3D world,
 * plus the small pieces that make the HUD feel like a game: the area banner
 * shown when the player enters a new place and the button-prompt bar.
 */
import { adjacentMenuItem, menuItems, menuKeyDirection } from './menu-navigation.js';

export type ScreenId = 'title' | 'setup';

export interface KeyPrompt {
  key: string;
  label: string;
}

/** Contextual button prompts, in the order a player scans them (main action first). */
export function keyPrompts(
  gamepad: boolean,
  options: { ride: boolean; boat: boolean; carry?: boolean; carrying?: boolean },
): KeyPrompt[] {
  const prompts: KeyPrompt[] = options.carrying
    ? []
    : [
        { key: gamepad ? '○' : 'E', label: '調べる' },
        { key: gamepad ? '□' : 'F', label: '攻撃' },
        { key: gamepad ? '△' : 'Space', label: 'ジャンプ' },
      ];
  if (options.ride)
    prompts.push({ key: gamepad ? '×' : 'R', label: options.carry ? '肩乗り' : 'マンモス' });
  if (options.boat) prompts.push({ key: gamepad ? '×' : 'B', label: '船' });
  if (!gamepad) prompts.push({ key: 'Enter', label: '話す' });
  prompts.push({ key: gamepad ? 'OPTIONS' : 'ESC', label: 'メニュー' });
  return prompts;
}

/** Shows and hides the full-screen game screens; one screen is visible at a time. */
export class ScreenManager {
  private current: ScreenId | null = null;

  constructor(
    private root: HTMLElement,
    private onChange: (id: ScreenId | null) => void,
  ) {
    document.addEventListener('keydown', this.keydown);
  }

  get active(): ScreenId | null {
    return this.current;
  }

  element(id: ScreenId): HTMLElement | null {
    return this.root.querySelector<HTMLElement>(`#screen-${id}`);
  }

  activeElement(): HTMLElement | null {
    return this.current ? this.element(this.current) : null;
  }

  show(id: ScreenId): void {
    for (const screen of this.root.querySelectorAll<HTMLElement>('.screen'))
      screen.hidden = screen.id !== `screen-${id}`;
    this.current = id;
    this.root.classList.add('active');
    document.body.dataset.screen = id;
    this.onChange(id);
    const items = this.items(id);
    (items.find((el) => el.hasAttribute('autofocus')) ?? items[0])?.focus({ preventScroll: true });
  }

  hide(): void {
    for (const screen of this.root.querySelectorAll<HTMLElement>('.screen')) screen.hidden = true;
    this.current = null;
    this.root.classList.remove('active');
    delete document.body.dataset.screen;
    this.onChange(null);
  }

  /** Focusable controls of a screen, skipping hidden ones such as an unavailable "continue". */
  private items(id: ScreenId): HTMLElement[] {
    const screen = this.element(id);
    return screen ? menuItems(screen) : [];
  }

  private keydown = (event: KeyboardEvent) => {
    if (!this.current || document.querySelector('dialog[open]')) return;
    const direction = menuKeyDirection(event);
    if (!direction) return;
    event.preventDefault();
    const next = adjacentMenuItem(
      this.items(this.current),
      document.activeElement as HTMLElement,
      direction,
    );
    next?.focus({ preventScroll: true });
    next?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  destroy(): void {
    document.removeEventListener('keydown', this.keydown);
  }
}

/** Cinematic place name that fades in when the player reaches a new area. */
export class AreaBanner {
  private timer = 0;
  private last = '';

  constructor(private element: HTMLElement) {}

  /** Shows the banner once per distinct area; `reset` makes the next update show again. */
  update(eyebrow: string, name: string): void {
    if (name === this.last) return;
    this.last = name;
    this.element.querySelector('small')!.textContent = eyebrow;
    this.element.querySelector('strong')!.textContent = name;
    this.element.hidden = false;
    this.element.classList.remove('visible');
    void this.element.offsetWidth;
    this.element.classList.add('visible');
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.element.classList.remove('visible');
      this.element.hidden = true;
    }, 3800);
  }

  reset(): void {
    this.last = '';
    clearTimeout(this.timer);
    this.element.hidden = true;
    this.element.classList.remove('visible');
  }
}
