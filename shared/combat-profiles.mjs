import { characterModel } from './characters.mjs';

// This is shared presentation data; the server always selects it from the
// normalized character, never from a weapon/damage field supplied by a client.
export const ATTACK_PROFILES = Object.freeze({
  spear: Object.freeze({ key: 'spear', label: '槍で攻撃', noun: '槍', startText: '槍を突き出した。',
    damage: 25, cooldownMs: 850, durationMs: 700, impactMs: 333, reach: 1.65, halfAngle: 55 * Math.PI / 180, energy: 2, modelKey: 'flint-spear' }),
  katana: Object.freeze({ key: 'katana', label: '刀で斬る', noun: '刀', startText: '刀を振り抜いた。',
    damage: 25, cooldownMs: 700, durationMs: 600, impactMs: 267, reach: .8, halfAngle: 65 * Math.PI / 180, energy: 2, modelKey: 'kunoichi-katana' }),
  magic: Object.freeze({ key: 'magic', label: '光の魔法', noun: '光弾', startText: '光の魔法を放った。',
    damage: 25, cooldownMs: 1100, durationMs: 800, impactMs: 400, reach: 8, halfAngle: 12 * Math.PI / 180, energy: 4,
    projectileSpeed: 7, projectileRadius: .16 }),
});

export function attackProfile(character) {
  return ATTACK_PROFILES[characterModel(character).weapon || 'spear'];
}
