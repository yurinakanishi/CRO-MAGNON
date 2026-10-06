/** The same conversation stays in the desktop HUD or a mobile bottom dialog. */
export class ChatUI {
  readonly dialog: HTMLDialogElement;
  private content: HTMLElement;
  private input: HTMLInputElement;
  private toggle: HTMLButtonElement;
  private home: Node;

  constructor(
    private panel: HTMLElement,
    private hooks: {
      touch(): boolean;
      stop(): void;
      resume(): void;
      submit(text: string): boolean;
    },
  ) {
    this.home = panel.parentNode!;
    this.content = panel.querySelector<HTMLElement>('#chat-content')!;
    this.input = panel.querySelector<HTMLInputElement>('#chat-input')!;
    this.toggle = panel.querySelector<HTMLButtonElement>('#chat-toggle')!;
    this.content.hidden = true;
    panel.querySelector('strong')!.id = 'chat-title';
    this.dialog = document.createElement('dialog');
    this.dialog.id = 'chat-dialog';
    this.dialog.setAttribute('aria-labelledby', 'chat-title');
    document.body.append(this.dialog);
    this.toggle.setAttribute('aria-controls', 'chat-content');
    this.toggle.onclick = () => this.setOpen(!!this.content.hidden);
    this.dialog.addEventListener('close', this.finishClose);
    this.dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      this.setOpen(false);
    });
    this.dialog.addEventListener('click', (event) => {
      if (event.target !== this.dialog) return;
      const rect = this.dialog.getBoundingClientRect();
      if (event.clientY < rect.top || event.clientY > rect.bottom) this.setOpen(false);
    });
    panel.querySelector<HTMLFormElement>('#chat-form')!.onsubmit = (event) => {
      event.preventDefault();
      const text = this.input.value.trim();
      if (!text || !this.hooks.submit(text)) return;
      this.input.value = '';
      if (this.dialog.open) this.input.focus({ preventScroll: true });
      else this.input.blur();
    };
    this.input.addEventListener('focus', this.hooks.stop);
    window.visualViewport?.addEventListener('resize', this.viewport);
    window.visualViewport?.addEventListener('scroll', this.viewport);
    window.addEventListener('resize', this.viewport);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.dialog.open) this.setOpen(false);
    });
    this.updateToggle();
  }

  get open() {
    return !this.content.hidden;
  }

  setOpen(open: boolean) {
    if (!open) {
      if (this.dialog.open) {
        this.dialog.close();
        this.finishClose();
      } else {
        this.content.hidden = true;
        this.input.blur();
        this.updateToggle();
      }
      return;
    }
    this.hooks.stop();
    this.content.hidden = false;
    if (this.hooks.touch()) {
      this.dialog.append(this.panel);
      this.viewport();
      if (!this.dialog.open) this.dialog.showModal();
      // Keep focus in the original finger gesture so mobile keyboards can open.
      this.input.focus({ preventScroll: true });
    }
    this.updateToggle();
    const messages = this.panel.querySelector<HTMLElement>('#chat-messages')!;
    messages.scrollTop = messages.scrollHeight;
  }

  syncMode() {
    if (this.dialog.open && !this.hooks.touch()) this.setOpen(false);
  }

  private finishClose = () => {
    if (this.dialog.open || this.panel.parentNode !== this.dialog) return;
    this.content.hidden = true;
    this.input.blur();
    this.home.appendChild(this.panel);
    this.updateToggle();
    this.hooks.resume();
  };

  private updateToggle() {
    this.toggle.setAttribute('aria-expanded', String(this.open));
    this.toggle.setAttribute('aria-label', this.open ? '会話を閉じる' : '会話を開く');
    this.panel.querySelector('.chat-collapse')!.textContent = this.open ? '−' : '+';
  }

  private viewport = () => {
    const viewport = window.visualViewport;
    this.dialog.style.setProperty('--chat-height', `${viewport?.height ?? innerHeight}px`);
    this.dialog.style.setProperty(
      '--chat-keyboard',
      `${Math.max(0, innerHeight - (viewport?.height ?? innerHeight) - (viewport?.offsetTop ?? 0))}px`,
    );
  };
}
