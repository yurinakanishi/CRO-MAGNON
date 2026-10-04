import { BOT_DESIGNS, canHandleBot, nextOrbBot, ownedBotKinds } from '../shared/orb-bots.mjs';
import type { BotKind, OrbBotSnapshot } from '../shared/orb-bot-types.mjs';
import type { PlayerSnapshot } from '../shared/snapshots.mjs';

const choices = (selected: BotKind, kinds: readonly BotKind[]) =>
  kinds
    .map((kind) => {
      const design = BOT_DESIGNS[kind];
      const content =
        'image' in design
          ? `<img src="${design.image}" alt="" draggable="false">`
          : `<span aria-hidden="true">${design.face}</span>`;
      return `<button type="button" class="orb-choice${'image' in design ? ' orb-choice-model' : ''}" data-bot-kind="${kind}" style="--bot-color:${design.color}" aria-label="${design.name}" title="${design.name}" aria-pressed="${kind === selected}">${content}</button>`;
    })
    .join('');
const modeName = (b?: OrbBotSnapshot) =>
  b?.busy
    ? '撫でる・リアクション中'
    : b?.mode === 'airborne' || b?.mode === 'windup'
      ? '飛んでいく'
      : b?.mode === 'landing'
        ? '着地'
        : b?.mode === 'returning' || b?.mode === 'catching'
          ? '戻ってくる'
          : b?.mode === 'waiting'
            ? '投げた場所で待機'
            : b?.mode === 'queued'
              ? '投げる順番待ち'
              : b?.mode === 'stowed'
                ? '待機中'
                : 'いっしょに歩く';

export class OrbBotUI {
  selected: BotKind = 'white';
  constructor(
    private hooks: {
      bots(): readonly OrbBotSnapshot[];
      player(): PlayerSnapshot | undefined;
      now(): number;
      available(): boolean;
      pettable(): readonly OrbBotSnapshot[];
      action(name: string, target?: string): void;
      openModal(markup: string): void;
      closeModal(): void;
    },
  ) {}
  private bindChoices(root: Element) {
    root.querySelectorAll<HTMLButtonElement>('[data-bot-kind]').forEach((button) =>
      button.addEventListener('click', () => {
        this.selected = button.dataset.botKind as BotKind;
        this.update();
        root
          .querySelectorAll('[data-bot-kind]')
          .forEach((el) =>
            el.setAttribute(
              'aria-pressed',
              String((el as HTMLElement).dataset.botKind === this.selected),
            ),
          );
      }),
    );
  }
  private bind(root: Element) {
    this.bindChoices(root);
    root.querySelector('[data-bot-action="petAll"]')?.addEventListener('click', () => {
      if (this.hooks.available() && this.hooks.pettable().length) this.hooks.action('petBots');
      this.hooks.closeModal();
    });
    root.querySelector('[data-bot-action="use"]')?.addEventListener('click', () => {
      this.use();
      this.hooks.closeModal();
    });
    root.querySelector('[data-bot-action="recall"]')?.addEventListener('click', () => {
      this.recall();
      this.hooks.closeModal();
    });
    for (const [button, action] of [
      ['dismiss', 'dismissBot'],
      ['dismissAll', 'dismissBots'],
    ]) {
      root.querySelector(`[data-bot-action="${button}"]`)?.addEventListener('click', () => {
        if (this.hooks.available())
          this.hooks.action(action, button === 'dismiss' ? this.selected : undefined);
        this.hooks.closeModal();
      });
    }
  }
  cycle() {
    const kinds = ownedBotKinds(this.hooks.bots(), this.hooks.player()?.id);
    if (!kinds.length) return;
    this.selected = kinds[(kinds.indexOf(this.selected) + 1) % kinds.length];
    this.update();
  }
  use() {
    const p = this.hooks.player();
    if (!p || !this.hooks.available() || !canHandleBot(p, this.hooks.now())) return;
    const next = nextOrbBot(this.hooks.bots(), p, this.selected);
    if (next) this.hooks.action('throwBot', next.kind);
  }
  recall() {
    if (this.hooks.available()) this.hooks.action('recallBots');
  }
  open() {
    const kinds = ownedBotKinds(this.hooks.bots(), this.hooks.player()?.id);
    this.hooks.openModal(
      `<div class="orb-menu"><h2>仲間のbotたち · ${kinds.length}匹</h2><p data-bot-status></p><button type="button" class="button button-accent" data-bot-action="petAll">近くのbotたちをまとめて撫でる</button><div class="orb-choices">${choices(this.selected, kinds)}</div><div class="orb-actions"><button type="button" class="button" data-bot-action="use">投げる</button><button type="button" class="button button-outline" data-bot-action="recall">みんなを呼ぶ</button><button type="button" class="button button-outline" data-bot-action="dismiss">選んだ子を帰す</button><button type="button" class="button button-outline" data-bot-action="dismissAll">全員を元の場所へ帰す</button></div></div>`,
    );
    this.bind(document.querySelector('.orb-menu')!);
    this.update();
  }
  update() {
    const p = this.hooks.player(),
      bots = this.hooks.bots();
    if (!p || !this.hooks.available()) return;
    const own = bots.filter((b) => b.ownerId === p.id);
    const kinds = ownedBotKinds(bots, p.id);
    if (!kinds.includes(this.selected)) this.selected = kinds[0] ?? 'white';
    const next = nextOrbBot(bots, p, this.selected);
    const menu = document.querySelector('.orb-menu');
    if (!menu) return;
    const group = bots.filter((b) => b.petPlayerId === p.id && b.petGroupLeaderId);
    const pettable = this.hooks.pettable();
    const petAll = menu.querySelector<HTMLButtonElement>('[data-bot-action="petAll"]')!;
    petAll.disabled = !pettable.length;
    petAll.textContent = group.length
      ? `みんなを撫でています（${group.length}匹）`
      : pettable.length
        ? `近くのbotたちをまとめて撫でる（${pettable.length}匹）`
        : '近くのbotたちをまとめて撫でる';
    if (menu.getAttribute('data-kinds') !== kinds.join(',')) {
      menu.setAttribute('data-kinds', kinds.join(','));
      menu.querySelector('h2')!.textContent = `仲間のbotたち · ${kinds.length}匹`;
      const list = menu.querySelector('.orb-choices')!;
      list.innerHTML = choices(this.selected, kinds);
      this.bindChoices(list);
    }
    menu.querySelector('[data-bot-status]')!.textContent = kinds.length
      ? 'いっしょに歩く仲間'
      : '仲間のbotはいません';
    for (const name of ['dismiss', 'dismissAll'])
      menu.querySelector<HTMLButtonElement>(`[data-bot-action="${name}"]`)!.disabled =
        !kinds.length && (name === 'dismiss' || !group.length);
    const available = canHandleBot(p, this.hooks.now());
    menu.querySelector<HTMLButtonElement>('[data-bot-action="recall"]')!.disabled = !available;
    const use = menu.querySelector<HTMLButtonElement>('[data-bot-action="use"]')!;
    use.disabled = !available || !next || group.length > 0;
    menu.querySelectorAll('[data-bot-kind]').forEach((el) => {
      const kind = (el as HTMLElement).dataset.botKind as BotKind;
      const bot = own.find((b) => b.kind === kind);
      el.setAttribute('aria-pressed', String(kind === this.selected));
      el.setAttribute('data-bot-mode', bot?.mode ?? 'stowed');
      el.setAttribute('title', `${BOT_DESIGNS[kind].name} · ${modeName(bot)}`);
    });
  }
}
