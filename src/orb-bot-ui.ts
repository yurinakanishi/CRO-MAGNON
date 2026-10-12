import { canHandleBot, nextOrbBot } from '../shared/orb-bots.mjs';
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
      action(name: string, target?: string): void;
    },
  ) {}
  use() {
    const p = this.hooks.player();
    if (!p || !this.hooks.available() || !canHandleBot(p, this.hooks.now())) return;
    if (nextOrbBot(this.hooks.bots(), p)) this.hooks.action('throwBot');
  }
  recall() {
    if (this.hooks.available()) this.hooks.action('recallBots');
  }
}
