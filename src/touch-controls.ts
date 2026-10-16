import { setData, setFlag, setText } from './hud-dom.js';
import { setLocalizedAttribute, setLocalizedText } from './language-ui.js';
import {
  touchIcon,
  touchLayout,
  touchSkillSlots,
  touchStick,
  touchWeaponIcon,
  type TouchCommand,
  type TouchContext,
  type TouchItem,
  type TouchMovement,
} from './touch-input.js';

export type TouchAction = TouchCommand | 'menu' | 'map' | 'chat' | 'mascots' | 'center' | 'sound';

export const touchDevice = () =>
  navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse)').matches;

/**
 * The phone HUD. Left thumb: a pad that appears where it lands. Right thumb: attack and jump,
 * abilities around them, and up to three things to do here. Menus sit in a slim rail.
 */
export class TouchControls {
  readonly root: HTMLElement;
  enabled = touchDevice();
  movement: TouchMovement = { x: 0, y: 0, running: false };
  private visible = false;
  private pointer: number | null = null;
  private zone: HTMLElement;
  private stick: HTMLElement;
  private knob: HTMLElement;
  private origin = { x: 0, y: 0 };
  private prompts: HTMLElement;
  private pad: HTMLElement;
  private attack: HTMLButtonElement;
  private jump: HTMLButtonElement;
  private center: HTMLButtonElement;
  private sound: HTMLButtonElement;
  private chat: HTMLButtonElement | null;
  private peek: HTMLElement;
  private peekTimer = 0;
  private signature = '';
  private buttons = new Map<TouchCommand, HTMLButtonElement>();
  private weapon = '';
  private cooldown = -1;
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
    // The menu opens on the bag, so its button is the bag, as in most phone games.
    this.root.innerHTML = `<nav class="touch-toolbar" aria-label="探索のメニュー">${[
      ['menu', 'bag', 'メニュー'],
      ['mascots', 'people', '仲間'],
      ...(hooks.chat ? [['chat', 'chat', '会話']] : []),
      ['center', 'recenter', '視点を戻す'],
    ]
      .map(
        ([action, glyph, label]) =>
          `<button type="button" data-touch-action="${action}" aria-label="${label}"${action === 'chat' ? ' aria-haspopup="dialog" aria-controls="chat-dialog"' : ''}>${hooks.icon(glyph)}</button>`,
      )
      .join(
        '',
      )}<button type="button" data-touch-action="sound" aria-label="音をオンにする" aria-pressed="false"><span data-sound-icon>${hooks.icon('muted')}</span><small data-sound-label>音オフ</small></button></nav>
      <p class="touch-chat-peek" role="status" translate="no" hidden><b></b><span></span></p>
      <div class="touch-move" role="group" aria-label="移動パッド。触れた所から、浅く倒すと歩き、深く倒すと走ります"><span id="touch-stick" class="touch-stick" data-gait="rest" aria-hidden="true"><i class="touch-stick-knob"></i></span></div>
      <div class="touch-prompts" aria-label="いま使える行動"></div>
      <div class="touch-pad" aria-label="行動ボタン"><button type="button" class="touch-jump" data-touch-action="jump" aria-label="ジャンプ">${hooks.icon('jump')}</button><button type="button" class="touch-attack" data-touch-action="attack" aria-label="攻撃"><span class="touch-attack-icon"></span></button></div>`;
    parent.append(this.root);
    const $ = <T extends HTMLElement>(selector: string) => this.root.querySelector<T>(selector)!;
    this.zone = $('.touch-move');
    this.stick = $('#touch-stick');
    this.knob = $('.touch-stick-knob');
    this.prompts = $('.touch-prompts');
    this.pad = $('.touch-pad');
    this.attack = $('[data-touch-action="attack"]');
    this.jump = $('[data-touch-action="jump"]');
    this.center = $('[data-touch-action="center"]');
    this.sound = $('[data-touch-action="sound"]');
    this.chat = this.root.querySelector<HTMLButtonElement>('[data-touch-action="chat"]');
    this.peek = $('.touch-chat-peek');
    this.setWeapon('spear');
    this.root.addEventListener('click', this.click);
    this.root.addEventListener('pointerdown', this.press);
    this.zone.addEventListener('pointerdown', this.down);
    this.zone.addEventListener('pointermove', this.move);
    this.zone.addEventListener('pointerup', this.up);
    this.zone.addEventListener('pointercancel', this.up);
    this.zone.addEventListener('lostpointercapture', this.up);
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

  setSoundEnabled(enabled: boolean) {
    this.sound.setAttribute('aria-pressed', String(enabled));
    setLocalizedAttribute(this.sound, 'aria-label', enabled ? '音をオフにする' : '音をオンにする');
    this.sound.querySelector('[data-sound-icon]')!.innerHTML = this.hooks.icon(
      enabled ? 'sound' : 'muted',
    );
    setLocalizedText(
      this.sound.querySelector('[data-sound-label]')!,
      enabled ? '音オン' : '音オフ',
    );
  }

  private chooseTouch = (event: PointerEvent) => {
    this.suppressClickUntil = 0;
    if (event.pointerType === 'touch') this.setEnabled(true);
  };

  update(context: TouchContext, playing: boolean) {
    this.visible = this.enabled && playing;
    setFlag(this.root, 'hidden', !this.visible);
    if (!this.visible) {
      if (this.pointer !== null) this.stop();
      this.release();
      return;
    }
    setData(this.zone, { disabled: !this.hooks.available() });
    const { prompts, skills } = touchLayout(context);
    const signature = JSON.stringify([prompts, skills]);
    if (signature !== this.signature) {
      this.signature = signature;
      this.render(prompts, skills);
    }
    // Viewing a companion or waiting on a task leaves only its own prompts in reach.
    setData(this.root, {
      mode:
        context.viewing && !context.automaticCamera ? 'viewing' : context.busy ? 'busy' : 'play',
    });
    setFlag(this.jump, 'disabled', !context.jump || !!context.busy || !!context.viewing);
    setFlag(this.attack, 'disabled', !context.attack || !!context.busy || !!context.viewing);
    setFlag(this.center, 'hidden', !!context.automaticCamera);
    this.setWeapon(context.weapon ?? 'spear');
    this.setCooldown(context.cooldown ?? 0);
  }

  /** Keeps unchanged targets in place while another finger is walking or pressing. */
  private render(prompts: TouchItem[], skills: TouchItem[]) {
    const wanted = new Set([...prompts, ...skills].map((item) => item.action));
    for (const [action, button] of this.buttons)
      if (!wanted.has(action)) {
        button.remove();
        this.buttons.delete(action);
      }
    prompts.forEach((item, index) => {
      const button = this.button(item, 'touch-prompt');
      if (this.prompts.children[index] !== button)
        this.prompts.insertBefore(button, this.prompts.children[index] ?? null);
    });
    const slots = touchSkillSlots(skills);
    for (const item of skills) {
      const button = this.button(item, 'touch-skill');
      setData(button, { slot: slots.get(item.action) ?? 'near' });
      if (button.parentNode !== this.pad) this.pad.prepend(button);
    }
    // The prompts stand just above the highest ability (beside the captions in landscape),
    // as close to the thumb as they fit.
    const used = new Set(slots.values());
    setData(this.root, {
      prompts: prompts.length,
      reach: (['high', 'far', 'near'] as const).find((slot) => used.has(slot)) ?? 'none',
      slots: [...used].sort().join(' '),
    });
  }

  private button(item: TouchItem, kind: 'touch-prompt' | 'touch-skill') {
    let button = this.buttons.get(item.action);
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = kind;
      button.dataset.touchAction = item.action;
      button.innerHTML = `<span class="${kind}-icon"></span><span class="${kind}-label"></span>`;
      this.buttons.set(item.action, button);
    }
    const glyph = touchIcon(item.action, item.label);
    if (button.dataset.icon !== glyph) {
      button.dataset.icon = glyph;
      button.firstElementChild!.innerHTML = this.hooks.icon(glyph);
    }
    setText(button.lastElementChild!, item.label);
    return button;
  }

  private setWeapon(weapon: string) {
    if (weapon === this.weapon) return;
    this.weapon = weapon;
    this.attack.firstElementChild!.innerHTML = this.hooks.icon(touchWeaponIcon(weapon));
    setData(this.attack, { weapon });
  }

  /** The recharge sweeps away clockwise, so a greyed attack says when it returns. */
  private setCooldown(value: number) {
    const share = Math.round(Math.min(1, Math.max(0, value || 0)) * 50) / 50;
    if (share === this.cooldown) return;
    this.cooldown = share;
    this.attack.style.setProperty('--cooldown', String(share));
    setData(this.attack, { cooling: share > 0 });
  }

  /** A line from another traveller, shown briefly beside the chat button until it is opened. */
  chatPeek(name: string, text: string) {
    if (!this.chat || !this.enabled) return;
    setData(this.chat, { unread: true });
    if (!this.visible) return;
    setText(this.peek.firstElementChild!, name);
    setText(this.peek.lastElementChild!, text);
    const bounds = this.root.getBoundingClientRect(),
      button = this.chat.getBoundingClientRect(),
      beside = matchMedia('(orientation: portrait)').matches;
    this.peek.style.left = `${(beside ? button.right + 10 : button.left) - bounds.left}px`;
    this.peek.style.top = `${(beside ? button.top + button.height / 2 : button.bottom + 10) - bounds.top}px`;
    setData(this.peek, { side: beside ? 'beside' : 'below' });
    setFlag(this.peek, 'hidden', false);
    clearTimeout(this.peekTimer);
    this.peekTimer = window.setTimeout(() => setFlag(this.peek, 'hidden', true), 5000);
  }

  private chatOpened() {
    clearTimeout(this.peekTimer);
    setFlag(this.peek, 'hidden', true);
    if (this.chat) setData(this.chat, { unread: false });
  }

  private target(event: Event) {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-touch-action]');
    return button &&
      !button.disabled &&
      this.visible &&
      this.hooks.available(button.dataset.touchAction as TouchAction)
      ? button
      : null;
  }

  private perform(button: HTMLButtonElement) {
    const action = button.dataset.touchAction as TouchAction;
    if (action === 'chat') this.chatOpened();
    this.hooks.perform(action);
  }

  private click = (event: MouseEvent) => {
    const button = this.target(event);
    if (!button) return;
    event.preventDefault();
    this.perform(button);
  };

  private press = (event: PointerEvent) => {
    if (event.pointerType !== 'touch') return;
    const button = this.target(event);
    if (!button) return;
    event.preventDefault();
    this.touchButtons.set(event.pointerId, button);
    button.classList.add('is-pressed');
    this.perform(button);
  };

  private releaseButton = (event: PointerEvent) => {
    const button = this.touchButtons.get(event.pointerId);
    if (!button) return;
    button.classList.remove('is-pressed');
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

  /** The pad appears under the thumb, kept whole on screen. */
  private down = (event: PointerEvent) => {
    if (this.pointer !== null || event.button !== 0 || !this.visible || !this.hooks.available())
      return;
    event.preventDefault();
    this.pointer = event.pointerId;
    this.hooks.beginMove();
    this.zone.setPointerCapture(event.pointerId);
    const bounds = this.root.getBoundingClientRect(),
      zone = this.zone.getBoundingClientRect(),
      half = this.stick.offsetWidth / 2,
      margin = 6;
    this.origin = {
      x: Math.min(
        Math.max(event.clientX, bounds.left + half + margin),
        bounds.right - half - margin,
      ),
      y: Math.min(
        Math.max(event.clientY, bounds.top + half + margin),
        bounds.bottom - half - margin,
      ),
    };
    const home = {
      x: zone.left + this.stick.offsetLeft + half,
      y: zone.top + this.stick.offsetTop + half,
    };
    this.stick.style.transform = `translate(${this.origin.x - home.x}px, ${this.origin.y - home.y}px)`;
    this.stick.classList.add('is-active');
    this.move(event);
  };

  private move = (event: PointerEvent) => {
    if (this.pointer !== event.pointerId) return;
    if (!this.hooks.available()) {
      this.stop();
      return;
    }
    event.preventDefault();
    const radius = this.stick.offsetWidth * 0.32;
    const dx = event.clientX - this.origin.x;
    const dy = event.clientY - this.origin.y;
    this.movement = touchStick(dx, dy, radius, this.movement.running);
    const length = Math.hypot(dx, dy),
      scale = Math.min(1, radius / (length || 1));
    this.knob.style.transform = `translate(${dx * scale}px, ${dy * scale}px)`;
    setData(this.stick, {
      gait: this.movement.running ? 'run' : this.movement.x || this.movement.y ? 'walk' : 'rest',
    });
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
    this.stick.style.transform = '';
    this.stick.classList.remove('is-active');
    setData(this.stick, { gait: 'rest' });
    if (pointer !== null && this.zone.hasPointerCapture(pointer))
      this.zone.releasePointerCapture(pointer);
    if (pointer !== null) this.hooks.move();
  };
  private visibility = () => {
    if (document.hidden) this.stop();
  };

  /** Pressed looks end with the HUD; the pointers stay tracked to absorb late clicks. */
  private release() {
    for (const button of this.touchButtons.values()) button.classList.remove('is-pressed');
  }

  hide() {
    this.visible = false;
    this.root.hidden = true;
    this.stop();
    this.release();
  }

  destroy() {
    this.stop();
    clearTimeout(this.peekTimer);
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
