import {
  GamepadInput,
  type Direction,
  type InputMode,
  type PadAction,
  type PadMovement,
} from './gamepad-input.js';
import { adjacentMenuItem, menuItems, menuKeyDirection } from './menu-navigation.js';

export const gamepadHelp = `
  <section class="gamepad-help" aria-label="PS4コントローラーの操作">
    <h3 tabindex="0">PS4コントローラー（DUALSHOCK 4）</h3>
    <p class="gamepad-connection" role="status"></p>
    <p>USBまたはBluetoothで端末につなぎ、この画面でボタンを一度押してください。</p>
    <dl class="gamepad-bindings">
      <div><dt>左スティック</dt><dd>浅く倒すと歩く、深く倒すと走る</dd></div>
      <div><dt>右スティック</dt><dd>カメラを回す</dd></div>
      <div><dt>×</dt><dd>採集・調べる</dd></div>
      <div><dt>□ / R2</dt><dd>刀・魔法・槍で攻撃</dd></div>
      <div><dt>L2</dt><dd>ジャンプ（着地してからもう一度）</dd></div>
      <div><dt>△</dt><dd>近くの船・マンモスに乗る／降りる</dd></div>
      <div><dt>○</dt><dd>作業を中止</dd></div>
      <div><dt>十字キー</dt><dd>↑ 地図 · ← もちもの · → 手帳 · ↓ メニュー</dd></div>
      <div><dt>OPTIONS</dt><dd>メニューを開く／閉じる</dd></div>
      <div><dt>タッチパッド / SHARE</dt><dd>地図</dd></div>
      <div><dt>L1 / R1 · R3</dt><dd>カメラを遠く／近く · 視点を戻す</dd></div>
    </dl>
    <p>メニューは十字キーか左スティックで、押した方向にある項目を選びます。右側の4ボタン（×・○・□・△）のどれでも決定できます。戻るときは画面内の「戻る」ボタンを選んで決定してください。選択欄は左右で切り替え、右スティックで説明をスクロールできます。名前・チャットの文字入力はキーボードを使います。</p>
    <p class="form-note">走るための2回倒し・スティック押し込みは不要です。画面に戻ったときはスティックとボタンを一度離してください。</p>
    <p class="form-note">認識しない場合は接続を確認し、最新のChrome / EdgeでHTTPSまたはlocalhostのゲームを開いてください。</p>
  </section>`;

interface GamepadUIOptions {
  dialog: HTMLDialogElement;
  canvas: HTMLCanvasElement;
  /** The container whose buttons the controller navigates: an open dialog or a full-screen game screen. */
  menu: () => HTMLElement | null;
  /** OPTIONS while a menu is shown: close the dialog or step back from the screen. */
  closeMenu: () => void;
  canPlay: () => boolean;
  onAction: (action: PadAction) => void;
  onLook: (x: number, y: number, dt: number) => void;
  onStop: () => void;
  onActivity: (active: boolean) => void;
}

/** Uses real DOM focus/click handlers so every existing dialog keeps its game rules. */
export class GamepadControls {
  movement: PadMovement = { x: 0, y: 0, running: false };
  private input = new GamepadInput();
  private frameId = 0;
  private lastTime = 0;
  private connectedIndex: number | null = null;
  private previousMode: InputMode = 'blocked';
  private active = false;
  private focused: HTMLElement | null = null;

  constructor(private options: GamepadUIOptions) {
    window.addEventListener('gamepaddisconnected', this.disconnected);
    document.addEventListener('pointerdown', this.otherInput);
    document.addEventListener('keydown', this.otherInput);
    document.addEventListener('keydown', this.keydown);
    options.dialog.addEventListener('close', this.closed);
    this.frameId = requestAnimationFrame(this.tick);
  }

  suspend() {
    this.input.suspend();
    this.movement = { x: 0, y: 0, running: false };
  }

  private otherInput = () => {
    if (this.active) {
      this.suspend();
      this.setActive(false);
    }
  };

  private keydown = (event: KeyboardEvent) => {
    // Full-screen menus are handled by ScreenManager. Native text/select editing stays native.
    if (!this.options.dialog.open || this.options.menu() !== this.options.dialog) return;
    const direction = menuKeyDirection(event);
    if (!direction) return;
    event.preventDefault();
    const el = adjacentMenuItem(this.items(), document.activeElement as HTMLElement, direction);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  private setActive(active: boolean) {
    if (this.active === active) return;
    this.active = active;
    document.body.classList.toggle('using-gamepad', active);
    if (!active) this.clearFocus();
    this.options.onActivity(active);
  }

  private disconnected = (event: GamepadEvent) => {
    if (event.gamepad.index === this.connectedIndex) this.loseConnection();
  };

  private loseConnection() {
    this.connectedIndex = null;
    this.suspend();
    this.setActive(false);
    this.options.onStop();
  }

  private closed = () => {
    // Require fresh controller input after closing a dialog.
    this.suspend();
    this.clearFocus();
    this.options.canvas.focus({ preventScroll: true });
  };

  private mode(): InputMode {
    if (document.hidden || !document.hasFocus()) return 'blocked';
    if (this.options.menu()) return 'menu';
    if (
      !this.options.canPlay() ||
      document.activeElement?.closest('input,textarea,select,[contenteditable]')
    )
      return 'blocked';
    return 'game';
  }

  private tick = (time: number) => {
    const dt = Math.min(0.05, Math.max(0, (time - (this.lastTime || time)) / 1000));
    this.lastTime = time;
    let devices: (Gamepad | null)[] = [],
      status = '';
    try {
      if (!navigator.getGamepads) status = 'unavailable';
      else devices = navigator.getGamepads();
    } catch {
      status = 'unavailable';
    }
    const mode = this.mode(),
      frame = this.input.sample(devices, mode, time);
    if (this.connectedIndex !== null && frame.index !== this.connectedIndex) this.loseConnection();
    if (mode === 'blocked' && this.previousMode !== 'blocked') {
      this.suspend();
      this.options.onStop();
    }
    this.previousMode = mode;
    this.connectedIndex = frame.index;
    this.movement = frame.move;
    const data = this.options.canvas.dataset;
    data.gamepadStatus = status || frame.status;
    data.gamepadRunning = String(frame.move.running);
    const connection = document.querySelector('.gamepad-connection');
    if (connection) {
      const label = (
        {
          connected: 'コントローラー接続済み',
          disconnected: '接続待ち · コントローラーのボタンを押してください',
          unsupported: 'ボタン配列を認識できません。Chrome / Edgeで接続し直してください。',
          unavailable: 'この画面では利用できません。HTTPSまたはlocalhostで開いてください。',
        } as Record<string, string>
      )[data.gamepadStatus];
      if (connection.textContent !== label) connection.textContent = label;
    }
    if (frame.active) this.setActive(true);
    if (mode === 'menu' && this.active) {
      this.ensureFocus();
      if (frame.navigation) this.navigate(frame.navigation);
      if (frame.look.y) {
        const root = this.options.menu();
        if (root) root.scrollTop += frame.look.y * dt * 600;
      }
      // Closing wins over confirming when two buttons arrive in the same frame.
      if (frame.actions.includes('menu')) this.options.closeMenu();
      else if (frame.actions.includes('confirm')) this.activate();
    } else if (mode === 'game') {
      if (frame.look.x || frame.look.y) this.options.onLook(frame.look.x, frame.look.y, dt);
      for (const action of frame.actions) {
        this.options.onAction(action);
        if (this.mode() !== 'game' || action === 'cancel') break;
      }
    }
    this.frameId = requestAnimationFrame(this.tick);
  };

  private items() {
    const root = this.options.menu();
    return root ? menuItems(root) : [];
  }

  private clearFocus() {
    this.focused?.classList.remove('gamepad-focus');
    this.focused = null;
  }

  private focus(el: HTMLElement | undefined) {
    this.clearFocus();
    if (!el) return;
    this.focused = el;
    el.classList.add('gamepad-focus');
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  private ensureFocus() {
    const items = this.items();
    if (!this.focused || !items.includes(this.focused))
      this.focus(
        items.find(
          (el) => el.classList.contains('gamepad-focus') || el === document.activeElement,
        ) ??
          items.find((el) => el.id !== 'modal-close') ??
          items[0],
      );
  }

  private navigate(direction: Direction) {
    const el = this.focused;
    if ((direction === 'left' || direction === 'right') && el instanceof HTMLSelectElement) {
      const options = [...el.options].filter(
        (o) => !o.disabled && !o.parentElement?.matches('optgroup:disabled'),
      );
      const index = options.findIndex((o) => o.selected),
        step = direction === 'left' ? -1 : 1;
      const next = options[(index + step + options.length) % options.length];
      if (next) {
        el.value = next.value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return;
    }
    const next = adjacentMenuItem(this.items(), el, direction);
    if (next !== el) this.focus(next);
  }

  private activate() {
    const el = this.focused;
    if (!el || el.matches(':disabled')) return;
    if (el instanceof HTMLSelectElement) this.navigate('down');
    else el.click();
  }

  destroy() {
    cancelAnimationFrame(this.frameId);
    window.removeEventListener('gamepaddisconnected', this.disconnected);
    document.removeEventListener('pointerdown', this.otherInput);
    document.removeEventListener('keydown', this.otherInput);
    document.removeEventListener('keydown', this.keydown);
    this.options.dialog.removeEventListener('close', this.closed);
    this.suspend();
    this.clearFocus();
  }
}
