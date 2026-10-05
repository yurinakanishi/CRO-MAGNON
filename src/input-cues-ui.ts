import { controllerKind } from './controller-labels.js';
import { type PadDevice } from './gamepad-input.js';
import {
  contextCues,
  controllerDiagram,
  controlAction,
  controlLabel,
  pressedControls,
  type CueAction,
  type CueContext,
  type InputCue,
} from './input-cues.js';

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
      : '<div class="input-basics"><span class="input-move"><span class="input-keys"><kbd data-key="w">W</kbd><kbd data-key="a">A</kbd><kbd data-key="s">S</kbd><kbd data-key="d">D</kbd></span><span>歩く</span><kbd data-key="shift">Shift</kbd><span>走る</span></span><span class="input-look"><svg viewBox="0 0 24 28" aria-hidden="true"><rect x="4" y="1" width="16" height="24" rx="8"/><path d="M12 1v10 M4 11h16 M9 5l3-2 3 2"/></svg>ドラッグ<span>見渡す</span></span></div><div class="input-actions" aria-live="polite"></div>';
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
    if (moveLabel) moveLabel.textContent = this.automaticCamera ? '前後・旋回' : '歩く';
    const lookLabel = this.root.querySelector('.input-look span');
    if (lookLabel) lookLabel.textContent = context.viewing ? '回す' : '見渡す';
    const captions = this.root.querySelectorAll('.pad-caption');
    if (captions[1]) captions[1].textContent = this.automaticCamera ? '視点は自動' : '見渡す';
    const cues = contextCues(context, this.pad);
    const signature = JSON.stringify(cues);
    if (signature !== this.signature) {
      this.signature = signature;
      this.cues = cues;
      const actions = this.root.querySelector('.input-actions')!;
      actions.replaceChildren();
      for (const cue of cues) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'input-action';
        button.dataset.cue = cue.action;
        const key = document.createElement('kbd');
        key.textContent = this.pad ? cue.controls.map(controlLabel).join(' / ') : cue.key;
        const label = document.createElement('span');
        label.textContent = cue.label;
        button.append(key, label);
        button.onclick = () => this.perform(cue.action);
        actions.append(button);
      }
    }
    this.paint();
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
        feedback.textContent =
          cue?.label ??
          (this.automaticCamera && ['rs', 'b4', 'b5', 'b11'].includes(changed)
            ? '視点は自動'
            : this.automaticCamera && changed === 'ls'
              ? '前後・旋回'
              : controlAction(changed));
        this.feedbackUntil = performance.now() + 1400;
      }
    }
    const feedback = this.root.querySelector('.input-feedback');
    if (feedback && performance.now() > this.feedbackUntil) feedback.textContent = '';
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
