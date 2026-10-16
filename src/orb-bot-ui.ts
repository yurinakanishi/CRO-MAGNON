import { canHandleBot, nextOrbBot, type BotKind } from '../shared/orb-bots.mjs';
import type { OrbBotSnapshot } from '../shared/orb-bot-types.mjs';
import type { PlayerSnapshot } from '../shared/snapshots.mjs';

/** The quick throw/recall shortcuts for the player's own companion; it is chosen in the menu. */
export class OrbBotUI {
  constructor(
    private hooks: {
      bots(): readonly OrbBotSnapshot[];
      player(): PlayerSnapshot | undefined;
      now(): number;
      available(): boolean;
      preferred?(): string | undefined;
      action(name: string, target?: string): void;
    },
  ) {}
  use() {
    const p = this.hooks.player();
    if (!p || !this.hooks.available() || !canHandleBot(p, this.hooks.now())) return;
    const next = nextOrbBot(this.hooks.bots(), p, this.hooks.preferred?.() as BotKind | undefined);
    if (next) this.hooks.action('throwBot', next.kind);
  }
  recall() {
    if (this.hooks.available()) this.hooks.action('recallBots');
  }
}
