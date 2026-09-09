import type { CharacterProfile } from './types.mjs';
interface AttackProfile {
  id: string;
  key: string;
  label: string;
  noun: string;
  startText: string;
  damage: number;
  cooldownMs: number;
  durationMs: number;
  impactMs: number;
  reach: number;
  halfAngle: number;
  energy: number;
  modelKey?: string;
  projectileSpeed?: number;
  projectileRadius?: number;
}
import { characterModel } from './characters.mjs';

// This is shared presentation data; the server always selects it from the
// normalized character, never from a weapon/damage field supplied by a client.
export const ATTACK_PROFILES = Object.freeze({
  unarmed: Object.freeze({
    id: 'unarmed',
    key: 'unarmed',
    label: '大きな手で打つ',
    noun: '大きな手',
    startText: '大きな手を振り出した。',
    damage: 25,
    cooldownMs: 1000,
    durationMs: 900,
    impactMs: 400,
    reach: 0.24,
    halfAngle: (55 * Math.PI) / 180,
    energy: 3,
  }),
  spear: Object.freeze({
    id: 'spear',
    key: 'spear',
    label: '木槍で攻撃',
    noun: '木槍',
    startText: '木槍を突き出した。',
    damage: 15,
    cooldownMs: 850,
    durationMs: 700,
    impactMs: 333,
    reach: 1.65,
    halfAngle: (55 * Math.PI) / 180,
    energy: 2,
    modelKey: 'wooden-spear',
  }),
  obsidianSpear: Object.freeze({
    id: 'obsidianSpear',
    key: 'spear',
    label: '黒曜石の槍で攻撃',
    noun: '黒曜石の槍',
    startText: '黒曜石の槍を突き出した。',
    damage: 30,
    cooldownMs: 850,
    durationMs: 700,
    impactMs: 333,
    reach: 1.65,
    halfAngle: (55 * Math.PI) / 180,
    energy: 2,
    modelKey: 'obsidian-spear',
  }),
  katana: Object.freeze({
    id: 'katana',
    key: 'katana',
    label: '刀で斬る',
    noun: '刀',
    startText: '刀を振り抜いた。',
    damage: 25,
    cooldownMs: 700,
    durationMs: 600,
    impactMs: 267,
    reach: 0.8,
    halfAngle: (65 * Math.PI) / 180,
    energy: 2,
    modelKey: 'kunoichi-katana',
  }),
  magic: Object.freeze({
    id: 'magic',
    key: 'magic',
    label: '光の魔法',
    noun: '光弾',
    startText: '光の魔法を放った。',
    damage: 25,
    cooldownMs: 1100,
    durationMs: 800,
    impactMs: 400,
    reach: 8,
    halfAngle: (12 * Math.PI) / 180,
    energy: 4,
    projectileSpeed: 7,
    projectileRadius: 0.16,
  }),
});

export function attackProfile(character: CharacterProfile): Readonly<AttackProfile> {
  return ATTACK_PROFILES[
    characterModel(character).weapon ||
      (character.spearHead === 'obsidian' ? 'obsidianSpear' : 'spear')
  ];
}

export const shoulderMagic = (player) =>
  !!player?.carrierId && !player.passengerId && attackProfile(player).key === 'magic';
