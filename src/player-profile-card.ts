import { setAttr, setData, setFlag, setText } from './hud-dom.js';
import { characterModel } from '../shared/characters.mjs';
import { playerProfile } from '../shared/player-profile.mjs';
import type { PlayerSnapshot } from '../shared/snapshots.mjs';

const STATS = [
  ['energy', '体力'],
  ['equipment', '装備'],
  ['companion', '仲間'],
  ['seals', '旅の証'],
  ['gathered', '採集数'],
  ['title', '称号'],
] as const;

/**
 * The card beside a traveler being looked at closely: their own words and what anyone
 * nearby could see of them. Every value, including their name and words, is written as text.
 */
export class PlayerProfileCard {
  readonly root: HTMLElement;
  private readonly portrait: HTMLElement;
  private readonly name: HTMLElement;
  private readonly character: HTMLElement;
  private readonly intro: HTMLElement;
  private readonly stats = new Map<string, HTMLElement>();

  constructor(parent: HTMLElement) {
    this.root = document.createElement('aside');
    this.root.id = 'player-profile';
    this.root.className = 'player-profile';
    this.root.hidden = true;
    this.root.setAttribute('aria-live', 'polite');
    this.root.innerHTML = `<header class="player-profile-heading"><span class="portrait"><i></i></span><div><strong translate="no"></strong><small></small></div></header><p class="player-profile-intro"></p><dl class="player-profile-stats">${STATS.map(
      ([key, label]) => `<div data-stat="${key}"><dt>${label}</dt><dd></dd></div>`,
    ).join('')}</dl>`;
    this.portrait = this.root.querySelector('.portrait')!;
    this.name = this.root.querySelector('strong')!;
    this.character = this.root.querySelector('small')!;
    this.intro = this.root.querySelector('.player-profile-intro')!;
    for (const [key] of STATS)
      this.stats.set(key, this.root.querySelector(`[data-stat="${key}"]`)!);
    parent.append(this.root);
  }

  /** Shows the given traveler, or hides the card without one. */
  update(player: PlayerSnapshot | undefined, intro = '') {
    setFlag(this.root, 'hidden', !player);
    if (!player) return;
    const profile = playerProfile(player, intro);
    setData(this.root, { player: player.id });
    setAttr(this.portrait, 'class', `portrait ${player.species} ${characterModel(player).key}`);
    setText(this.name, profile.name);
    setText(this.character, profile.character);
    // Their own words stay as written (marked before writing); only the empty note follows
    // the interface language.
    setAttr(this.intro, 'translate', profile.intro ? 'no' : 'yes');
    setData(this.intro, { empty: !profile.intro });
    setText(this.intro, profile.intro || 'まだ自己紹介はありません');
    const values: Record<string, string | null> = {
      energy: `${profile.energy} / 100`,
      equipment: profile.equipment,
      companion: profile.companion ?? 'ひとり旅',
      seals: `${profile.seals} / 5`,
      gathered: `${profile.gathered}`,
      title: profile.title,
    };
    for (const [key, row] of this.stats) {
      setFlag(row, 'hidden', values[key] === null);
      setText(row.lastElementChild!, values[key] ?? '');
    }
  }
}
