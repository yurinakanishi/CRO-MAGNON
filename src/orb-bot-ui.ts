import { canHandleBot, nextOrbBot, ownedBotKinds } from '../shared/orb-bots.mjs';
import type { BotKind, OrbBotSnapshot } from '../shared/orb-bot-types.mjs';
import type { PlayerSnapshot } from '../shared/snapshots.mjs';

/** The quick throw/recall shortcuts keep one preferred bot kind; roster cards live in the menu. */
export class OrbBotUI {
  selected: BotKind = 'white';
  constructor(
    private hooks: {
      bots(): readonly OrbBotSnapshot[];
      player(): PlayerSnapshot | undefined;
      now(): number;
      available(): boolean;
      action(name: string, target?: string): void;
    },
  ) {}
  cycle() {
    const kinds = ownedBotKinds(this.hooks.bots(), this.hooks.player()?.id);
    if (!kinds.length) return;
    this.selected = kinds[(kinds.indexOf(this.selected) + 1) % kinds.length];
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
  update() {
    const kinds = ownedBotKinds(this.hooks.bots(), this.hooks.player()?.id);
    if (!kinds.includes(this.selected)) this.selected = kinds[0] ?? 'white';
  }
}
