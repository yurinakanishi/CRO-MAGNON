import type { CueAction, CueContext } from './input-cues.js';
import { touchActions, touchStick, type TouchMovement } from './touch-input.js';

export type TouchAction = CueAction | 'menu' | 'map' | 'chat' | 'mascots' | 'center';

export const touchDevice = () =>
  navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse)').matches;

export class TouchControls {
  readonly root: HTMLElement;
  enabled = touchDevice();
  movement: TouchMovement = { x: 0, y: 0, running: false };
  private visible = false;
  private pointer: number | null = null;
  private pad: HTMLButtonElement;
  private knob: HTMLElement;
  private signature = '';
  private buttons = new Map<CueAction, HTMLButtonElement>();
  private touchButtons = new Map<number, HTMLButtonElement>();
  private suppressClickUntil = 0;

  constructor(
    parent: HTMLElement,
    private hooks: {
      available(action?: TouchAction): boolean;
      perform(action: TouchAction): void;
      changed(): void;
      move(): void;
      beginMove(): void;
      icon(name: string): string;
      chat: boolean;
    },
  ) {
    this.root = document.createElement('section');
    this.root.id = 'touch-controls';
    this.root.setAttribute('aria-label', 'タッチ操作');
    this.root.hidden = true;
    this.root.innerHTML = `<nav class="touch-toolbar" aria-label="探索のメニュー">${[
      ['menu', 'menu', 'メニュー'],
      ['bag', 'bag', '持ち物'],
      ['mascots', 'people', '仲間'],
      ...(hooks.chat ? [['chat', 'chat', '会話']] : []),
    ]
      .map(
        ([action, glyph, label]) =>
          `<button type="button" data-touch-action="${action}" aria-label="${label}"${action === 'chat' ? ' aria-haspopup="dialog" aria-controls="chat-dialog"' : ''}>${hooks.icon(glyph)}</button>`,
      )
      .join('')}</nav>
      <div class="touch-move"><button type="button" id="touch-stick" aria-label="移動。浅く倒すと歩き、深く倒すと走ります"><span class="touch-stick-ring" aria-hidden="true"><i class="touch-stick-knob"></i></span></button><span class="touch-gait" aria-hidden="true">移動</span></div>
      <div class="touch-context" aria-label="いま使える行動"></div>
      <div class="touch-utilities" aria-label="仲間と道具"></div>
      <div class="touch-base"><button type="button" data-touch-action="jump">ジャンプ</button><button type="button" data-touch-action="attack">攻撃</button></div>
      <button type="button" class="touch-center" data-touch-action="center" aria-label="視点を戻す">視点を戻す</button>`;
    parent.append(this.root);
    this.pad = this.root.querySelector<HTMLButtonElement>('#touch-stick')!;
    this.knob = this.root.querySelector<HTMLElement>('.touch-stick-knob')!;
    this.root.addEventListener('click', this.click);
    this.root.addEventListener('pointerdown', this.press);
    this.pad.addEventListener('pointerdown', this.down);
    this.pad.addEventListener('pointermove', this.move);
    this.pad.addEventListener('pointerup', this.up);
    this.pad.addEventListener('pointercancel', this.up);
    this.pad.addEventListener('lostpointercapture', this.up);
    document.addEventListener('pointerdown', this.chooseTouch, true);
    document.addEventListener('pointerup', this.releaseButton, true);
    document.addEventListener('pointercancel', this.releaseButton, true);
    document.addEventListener('click', this.compatibilityClick, true);
    window.addEventListener('blur', this.stop);
    window.addEventListener('resize', this.stop);
    document.addEventListener('visibilitychange', this.visibility);
    this.applyDevice();
  }

  private applyDevice() {
    document.body.classList.toggle('touch-mode', this.enabled);
  }

  setEnabled(enabled: boolean) {
    if (this.enabled === enabled) return;
    this.stop();
    this.enabled = enabled;
    this.applyDevice();
    if (!enabled) this.root.hidden = true;
    this.hooks.changed();
  }

  private chooseTouch = (event: PointerEvent) => {
    this.suppressClickUntil = 0;
    if (event.pointerType === 'touch') this.setEnabled(true);
  };

  update(context: CueContext, playing: boolean) {
    this.visible = this.enabled && playing;
    this.root.hidden = !this.visible;
    if (!this.visible) {
      if (this.pointer !== null) this.stop();
      return;
    }
    this.pad.disabled = !this.hooks.available();
    const actions = touchActions(context);
    const signature = JSON.stringify(actions);
    if (signature !== this.signature) {
      this.signature = signature;
      this.root.dataset.contextCount = String(
        actions.filter((item) => !['recall', 'throw', 'torch'].includes(item.action)).length,
      );
      // Preserve unchanged targets while another finger is walking or pressing an action.
      const ids = new Set(actions.map((item) => item.action));
      for (const [id, button] of this.buttons) {
        if (!ids.has(id)) {
          button.remove();
          this.buttons.delete(id);
        }
      }
      for (const item of actions) {
        let button = this.buttons.get(item.action);
        if (!button) {
          button = document.createElement('button');
          button.type = 'button';
          button.dataset.touchAction = item.action;
          this.buttons.set(item.action, button);
          this.root
            .querySelector(
              ['recall', 'throw', 'torch'].includes(item.action)
                ? '.touch-utilities'
                : '.touch-context',
            )!
            .append(button);
        }
        button.textContent = item.label;
      }
    }
    this.root.querySelector<HTMLButtonElement>('[data-touch-action="jump"]')!.disabled =
      !context.jump || !!context.busy || !!context.viewing;
    this.root.querySelector<HTMLButtonElement>('[data-touch-action="attack"]')!.disabled =
      !context.attack || !!context.busy || !!context.viewing;
    this.root.querySelector<HTMLElement>('.touch-center')!.hidden = !!context.automaticCamera;
  }

  private click = (event: MouseEvent) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-touch-action]');
    if (
      !button ||
      button.disabled ||
      !this.visible ||
      !this.hooks.available(button.dataset.touchAction as TouchAction)
    )
      return;
    event.preventDefault();
    this.hooks.perform(button.dataset.touchAction as TouchAction);
  };

  private press = (event: PointerEvent) => {
    if (event.pointerType !== 'touch') return;
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-touch-action]');
    if (
      !button ||
      button.disabled ||
      !this.visible ||
      !this.hooks.available(button.dataset.touchAction as TouchAction)
    )
      return;
    event.preventDefault();
    this.touchButtons.set(event.pointerId, button);
    this.hooks.perform(button.dataset.touchAction as TouchAction);
  };

  private releaseButton = (event: PointerEvent) => {
    const button = this.touchButtons.get(event.pointerId);
    if (!button) return;
    this.suppressClickUntil = performance.now() + 1200;
    this.touchButtons.delete(event.pointerId);
  };

  /** A menu opened on contact may receive the browser's later synthetic click. */
  private compatibilityClick = (event: MouseEvent) => {
    if (event.detail > 0 && performance.now() < this.suppressClickUntil) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.suppressClickUntil = 0;
    }
  };

  private down = (event: PointerEvent) => {
    if (this.pointer !== null || event.button !== 0 || !this.visible || !this.hooks.available())
      return;
    event.preventDefault();
    this.pointer = event.pointerId;
    this.hooks.beginMove();
    this.pad.setPointerCapture(event.pointerId);
    this.move(event);
  };

  private move = (event: PointerEvent) => {
    if (this.pointer !== event.pointerId) return;
    if (!this.hooks.available()) {
      this.stop();
      return;
    }
    event.preventDefault();
    const rect = this.pad.getBoundingClientRect(),
      radius = rect.width * 0.32;
    const dx = event.clientX - rect.left - rect.width / 2;
    const dy = event.clientY - rect.top - rect.height / 2;
    this.movement = touchStick(dx, dy, radius, this.movement.running);
    const length = Math.hypot(dx, dy),
      scale = Math.min(1, radius / (length || 1));
    this.knob.style.transform = `translate(${dx * scale}px, ${dy * scale}px)`;
    this.pad.classList.toggle('is-active', !!this.movement.x || !!this.movement.y);
    this.root.querySelector('.touch-gait')!.textContent = this.movement.running
      ? '走る'
      : this.movement.x || this.movement.y
        ? '歩く'
        : '移動';
    this.hooks.move();
  };

  private up = (event: PointerEvent) => {
    if (event.pointerId === this.pointer) this.stop();
  };

  stop = () => {
    const pointer = this.pointer;
    this.pointer = null;
    this.movement = { x: 0, y: 0, running: false };
    this.knob.style.transform = '';
    this.pad.classList.remove('is-active');
    this.root.querySelector('.touch-gait')!.textContent = '移動';
    if (pointer !== null && this.pad.hasPointerCapture(pointer))
      this.pad.releasePointerCapture(pointer);
    if (pointer !== null) this.hooks.move();
  };
  private visibility = () => {
    if (document.hidden) this.stop();
  };

  hide() {
    this.visible = false;
    this.root.hidden = true;
    this.stop();
  }

  destroy() {
    this.stop();
    document.removeEventListener('pointerdown', this.chooseTouch, true);
    document.removeEventListener('pointerup', this.releaseButton, true);
    document.removeEventListener('pointercancel', this.releaseButton, true);
    document.removeEventListener('click', this.compatibilityClick, true);
    window.removeEventListener('blur', this.stop);
    window.removeEventListener('resize', this.stop);
    document.removeEventListener('visibilitychange', this.visibility);
    this.root.remove();
  }
}
