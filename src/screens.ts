/**
 * Full-screen game screens (title, setup, how-to-play) shown over the 3D world,
 * plus the small pieces that make the HUD feel like a game: the area banner
 * shown when the player enters a new place and the button-prompt bar.
 */
export type ScreenId = 'title' | 'setup' | 'guide';

const MENU_ITEMS = 'button:not([disabled]),input:not([type="hidden"]),select,a[href]';

/** Vertical menu navigation: returns the next focused index or null when the key is not a menu key. */
export function nextMenuIndex(index: number, key: string, count: number): number | null {
  if (count <= 0) return null;
  const step =
    key === 'ArrowDown' || key === 's' || key === 'S'
      ? 1
      : key === 'ArrowUp' || key === 'w' || key === 'W'
        ? -1
        : 0;
  if (!step) return null;
  if (index < 0) return step > 0 ? 0 : count - 1;
  return (index + step + count) % count;
}

export interface KeyPrompt {
  key: string;
  label: string;
}

/** Contextual button prompts, in the order a player scans them (main action first). */
export function keyPrompts(
  gamepad: boolean,
  options: { ride: boolean; boat: boolean },
): KeyPrompt[] {
  const prompts: KeyPrompt[] = [
    { key: gamepad ? '×' : 'E', label: '調べる' },
    { key: gamepad ? '□' : 'F', label: '攻撃' },
  ];
  if (options.ride) prompts.push({ key: gamepad ? '△' : 'R', label: 'マンモス' });
  if (options.boat) prompts.push({ key: gamepad ? '△' : 'B', label: '船' });
  if (!gamepad) prompts.push({ key: 'Enter', label: '話す' });
  prompts.push({ key: gamepad ? 'OPTIONS' : 'ESC', label: 'メニュー' });
  return prompts;
}

interface GuideOptions {
  gamepad: boolean;
  skipChecked: boolean;
}

/** The pre-play "how to play" card: bindings for the device in use plus the first objective. */
export function guideMarkup({ gamepad, skipChecked }: GuideOptions): string {
  const rows: [string, string, string][] = gamepad
    ? [
        ['左スティック', '移動', '浅く倒すと歩き、深く倒すと走ります。'],
        ['右スティック', '視点', 'カメラを回します。L1 / R1 で距離、R3 で戻す。'],
        ['×', '調べる・採集', '木や石、焚き火、仲間に近づいて押します。'],
        ['□ / R2', '攻撃', '相手を向いて。槍・刀・魔法はキャラクターで変わります。'],
        ['△', '乗る・降りる', 'マンモスや船のそばで。'],
        ['OPTIONS', 'メニュー', 'もちもの・地図・手帳・設定。十字キーでも開けます。'],
      ]
    : [
        ['W A S D', '移動', '同じ方向を素早く2回押すと走ります。地面クリックでも移動。'],
        ['ドラッグ', '視点', 'マウスや指でドラッグして周囲を見渡します。ホイールで距離。'],
        ['E', '調べる・採集', '木や石、焚き火、仲間に近づいて押します。'],
        ['F', '攻撃', '相手を向いて。槍・刀・魔法はキャラクターで変わります。'],
        ['R / B', '乗る・降りる', 'R でマンモス、B で船。'],
        ['ESC', 'メニュー', 'もちもの (I)・地図 (M)・手帳 (J)・設定。Enter でチャット。'],
      ];
  return `<div class="guide-card" role="document"><p class="screen-eyebrow">HOW TO PLAY</p><h2>旅のはじめに</h2><p class="guide-intro">まずは近くの木や石を3つ集めて、石斧をつくろう。</p><div class="guide-grid">${rows
    .map(
      ([key, title, note]) =>
        `<div class="guide-row"><kbd>${key}</kbd><div><strong>${title}</strong><p>${note}</p></div></div>`,
    )
    .join(
      '',
    )}</div><div class="guide-objective"><span class="guide-step">1</span><div><strong>最初の目標</strong><p>木・石・ベリーを3つ採集 → 木材3と石2で石斧 → 焚き火に木材12・石6を届ける</p></div></div><div class="guide-actions"><label class="guide-skip"><input type="checkbox" id="guide-skip" ${skipChecked ? 'checked' : ''}> 次回から表示しない</label><button id="guide-back" class="button button-outline" type="button">戻る</button><button id="guide-start" class="button button-accent">冒険をはじめる</button></div><p class="guide-footnote">${gamepad ? '×・○・□・△のどれでも決定。「戻る」で旅支度へ戻れます。OPTIONS のメニュー「あそびかた」' : 'H キー'}でいつでも見直せます。${gamepad ? '' : 'コントローラー（DUALSHOCK 4）にも対応しています。'}</p></div>`;
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
    if (!screen) return [];
    return [...screen.querySelectorAll<HTMLElement>(MENU_ITEMS)].filter(
      (el) => !el.closest('[hidden]') && el.getClientRects().length,
    );
  }

  private keydown = (event: KeyboardEvent) => {
    if (!this.current) return;
    const target = event.target;
    if (target instanceof Element && target.matches('input,select,textarea')) return;
    const items = this.items(this.current);
    const next = nextMenuIndex(
      items.indexOf(document.activeElement as HTMLElement),
      event.key,
      items.length,
    );
    if (next === null) return;
    event.preventDefault();
    items[next]?.focus();
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
