import { setText } from './dom-updates.js';
import { controllerKind } from './controller-labels.js';
import { type PadDevice } from './gamepad-input.js';
import { icon } from './icons.js';
import { touchIcon } from './touch-input.js';
import {
  contextCues,
  desktopCueLayout,
  controllerDiagram,
  controlAction,
  controlLabel,
  pressedControls,
  type CueAction,
  type CueContext,
  type InputCue,
} from './input-cues.js';

const DESKTOP_SHORTCUTS: InputCue[] = [
  { action: 'bag', label: 'もちもの', key: 'I', controls: [] },
  { action: 'mascots', label: '仲間', key: '', controls: [] },
  { action: 'map', label: '地図', key: 'M', controls: [] },
  { action: 'menu', label: 'メニュー', key: 'Esc', controls: [] },
];

/** A small in-world cue, never a modal or a required tutorial step. */
export class InputCues {
  private root: HTMLElement;
  private pad = false;
  private signature = '';
  private layout = '';
  private cues: InputCue[] = [];
  private pressed = new Set<string>();
  private heldKeys = new Set<string>();
  private visible = false;
  private controls: SVGElement[] = [];
  private feedbackUntil = 0;
  private paintSignature = '';
  private automaticCamera = false;

  constructor(
    parent: HTMLElement,
    private perform: (action: CueAction) => void,
  ) {
    this.root = document.createElement('aside');
    this.root.id = 'input-cues';
    this.root.className = 'input-cues';
    this.root.setAttribute('aria-label', 'いま使える操作');
    this.root.hidden = true;
    parent.append(this.root);
    this.renderDevice();
    document.addEventListener('keydown', this.keydown);
    document.addEventListener('keyup', this.keyup);
    window.addEventListener('blur', this.clear);
    document.addEventListener('visibilitychange', this.clear);
  }

  private renderDevice() {
    const layout = this.pad ? controllerKind() : 'keyboard';
    if (layout === this.layout) return;
    this.layout = layout;
    this.root.dataset.device = this.pad ? 'gamepad' : 'keyboard';
    this.root.dataset.layout = layout;
    this.root.innerHTML = this.pad
      ? `${controllerDiagram(controllerKind())}<span class="input-feedback" aria-hidden="true"></span><div class="input-actions" aria-live="polite"></div>`
      : '<div class="input-actions" aria-live="polite"></div><div class="input-skills" aria-label="基本の行動"></div><div class="input-shortcuts" aria-label="メニューと地図"></div><div class="input-basics"><span class="input-move"><span class="input-keys"><kbd data-key="w">W</kbd><kbd data-key="a">A</kbd><kbd data-key="s">S</kbd><kbd data-key="d">D</kbd></span><span>歩く</span><kbd data-key="shift">Shift</kbd><span>走る</span></span><span class="input-look"><svg viewBox="0 0 24 28" aria-hidden="true"><rect x="4" y="1" width="16" height="24" rx="8"/><path d="M12 1v10 M4 11h16 M9 5l3-2 3 2"/></svg>ドラッグ<span>見渡す</span></span></div>';
    this.controls = [...this.root.querySelectorAll<SVGElement>('[data-pad-control]')];
    this.signature = '';
    this.paintSignature = '';
  }

  device(pad: boolean) {
    this.pad = pad;
    this.renderDevice();
  }

  update(context: CueContext, visible: boolean) {
    this.visible = visible;
    this.root.hidden = !visible;
    if (!visible) return;
    this.renderDevice();
    this.root.classList.toggle('is-inspecting', !!context.viewing);
    this.automaticCamera = !!context.automaticCamera;
    const look = this.root.querySelector<HTMLElement>('.input-look');
    if (look) look.hidden = this.automaticCamera;
    const moveLabel = this.root.querySelector('.input-move > span:nth-child(2)');
    if (moveLabel) setText(moveLabel, this.automaticCamera ? '前後・旋回' : '歩く');
    const lookLabel = this.root.querySelector('.input-look span');
    if (lookLabel) setText(lookLabel, context.viewing ? '回す' : '見渡す');
    const captions = this.root.querySelectorAll('.pad-caption');
    if (captions[1]) setText(captions[1], this.automaticCamera ? '視点は自動' : '見渡す');
    const layout = this.pad
      ? { prompts: contextCues(context, true), skills: [] }
      : desktopCueLayout(context);
    const shortcuts = !this.pad && !context.viewing ? DESKTOP_SHORTCUTS : [];
    const signature = JSON.stringify([layout, shortcuts]);
    if (signature !== this.signature) {
      this.signature = signature;
      this.cues = [...layout.prompts, ...layout.skills, ...shortcuts];
      this.renderActions(this.root.querySelector('.input-actions')!, layout.prompts, false);
      if (!this.pad) {
        this.renderActions(this.root.querySelector('.input-skills')!, layout.skills, true);
        this.renderActions(this.root.querySelector('.input-shortcuts')!, shortcuts, true);
      }
    }
    this.paint();
  }

  private renderActions(parent: Element, cues: InputCue[], skill: boolean) {
    const previous = new Map(
      [...parent.querySelectorAll<HTMLButtonElement>('[data-cue]')].map((button) => [
        button.dataset.cue,
        button,
      ]),
    );
    for (const [action, button] of previous)
      if (!cues.some((cue) => cue.action === action)) button.remove();
    cues.forEach((cue, index) => {
      let button = previous.get(cue.action);
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = skill ? 'input-action input-skill' : 'input-action';
        button.dataset.cue = cue.action;
        button.innerHTML = this.pad
          ? '<kbd></kbd><span class="input-action-label"></span>'
          : '<span class="input-action-icon" aria-hidden="true"></span><span class="input-action-copy"><span class="input-action-label"></span><small class="input-action-target"></small></span><kbd aria-hidden="true"></kbd>';
        button.onclick = (event) => {
          this.perform(cue.action);
          // A mouse click must not leave Space bound to the last clicked action.
          // Keyboard activation keeps focus; menus that took focus keep it too.
          if (event.detail > 0 && document.activeElement === button)
            this.root.parentElement
              ?.querySelector<HTMLElement>('#world')
              ?.focus({ preventScroll: true });
        };
      }
      const key = button.querySelector('kbd')!;
      setText(key, this.pad ? cue.controls.map(controlLabel).join(' / ') : cue.key);
      key.hidden = !key.textContent;
      setText(button.querySelector('.input-action-label')!, cue.label);
      if (!this.pad) {
        const glyph =
          ({ menu: 'more', map: 'compass', mascots: 'paw' } as Partial<Record<CueAction, string>>)[
            cue.action
          ] ?? touchIcon(cue.action, cue.label);
        if (button.dataset.icon !== glyph) {
          button.dataset.icon = glyph;
          button.querySelector('.input-action-icon')!.innerHTML = icon(glyph);
        }
        const target = button.querySelector<HTMLElement>('.input-action-target')!;
        setText(target, cue.target ?? '');
        target.hidden = !cue.target;
        button.setAttribute('aria-label', cue.target ? `${cue.target}を${cue.label}` : cue.label);
        if (cue.key)
          button.setAttribute('aria-keyshortcuts', cue.key === 'Esc' ? 'Escape' : cue.key);
        else button.removeAttribute('aria-keyshortcuts');
      }
      // Preserve the actual button during HUD changes, including a held mouse/Enter press.
      if (parent.children[index] !== button)
        parent.insertBefore(button, parent.children[index] ?? null);
    });
  }

  frame(pad: PadDevice | null, playing: boolean) {
    if (!playing) {
      this.pressed.clear();
      this.hide();
      return;
    }
    const pressed = pressedControls(pad);
    const changed = [...pressed].find((control) => !this.pressed.has(control));
    this.pressed = pressed;
    if (changed && this.pad && this.visible) {
      const cue = this.cues.find((item) => item.controls.includes(changed));
      const feedback = this.root.querySelector('.input-feedback');
      if (feedback) {
        setText(
          feedback,
          cue?.label ??
            (this.automaticCamera && ['rs', 'b4', 'b5', 'b11'].includes(changed)
              ? '視点は自動'
              : this.automaticCamera && changed === 'ls'
                ? '前後・旋回'
                : controlAction(changed)),
        );
        this.feedbackUntil = performance.now() + 1400;
      }
    }
    const feedback = this.root.querySelector('.input-feedback');
    if (feedback && performance.now() > this.feedbackUntil) setText(feedback, '');
    if (this.visible) this.paint();
  }

  private paint() {
    const signature = `${this.signature}|${this.automaticCamera}|${[...this.pressed].join(',')}|${[...this.heldKeys].join(',')}`;
    if (signature === this.paintSignature) return;
    this.paintSignature = signature;
    const suggested = new Set(this.cues.flatMap((cue) => cue.controls));
    for (const control of this.controls) {
      const id = control.dataset.padControl!;
      control.classList.toggle('is-suggested', suggested.has(id));
      control.classList.toggle('is-pressed', this.pressed.has(id));
      control.classList.toggle(
        'is-movement',
        id === 'ls' || (id === 'rs' && !this.automaticCamera),
      );
    }
    for (const key of this.root.querySelectorAll<HTMLElement>('[data-key]'))
      key.classList.toggle('is-pressed', this.heldKeys.has(key.dataset.key!));
    for (const button of this.root.querySelectorAll<HTMLElement>('[data-cue]')) {
      const cue = this.cues.find((item) => item.action === button.dataset.cue)!;
      button.classList.toggle(
        'is-pressed',
        this.pad
          ? cue.controls.some((control) => this.pressed.has(control))
          : this.heldKeys.has(
              ({ Esc: 'escape', '−': '-' } as Record<string, string>)[cue.key] ??
                cue.key.toLowerCase(),
            ) ||
              (cue.key === '+' && this.heldKeys.has('=')),
      );
    }
  }

  private keydown = (event: KeyboardEvent) => {
    if (
      !this.visible ||
      event.isComposing ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      (event.target as Element)?.closest('input,textarea,select,[contenteditable]')
    )
      return;
    this.heldKeys.add(event.code === 'Space' ? 'space' : event.key.toLowerCase());
    this.paint();
  };
  private keyup = (event: KeyboardEvent) => {
    this.heldKeys.delete(event.code === 'Space' ? 'space' : event.key.toLowerCase());
    this.paint();
  };
  private clear = () => {
    this.heldKeys.clear();
    this.pressed.clear();
    this.hide();
  };
  hide() {
    this.visible = false;
    this.root.hidden = true;
  }
  destroy() {
    document.removeEventListener('keydown', this.keydown);
    document.removeEventListener('keyup', this.keyup);
    window.removeEventListener('blur', this.clear);
    document.removeEventListener('visibilitychange', this.clear);
    this.root.remove();
  }
}
