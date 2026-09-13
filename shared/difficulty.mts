export const DIFFICULTY_LEVELS = ['easy', 'normal', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTY_LEVELS)[number];

export const DIFFICULTIES = Object.freeze({
  easy: Object.freeze({
    id: 'easy' as const,
    label: '簡単',
    description: '被ダメージ70% ・ 戦闘中の敵の速さ80%',
    incomingDamage: 0.7,
    enemyMovementSpeed: 0.8,
  }),
  normal: Object.freeze({
    id: 'normal' as const,
    label: '普通',
    description: '被ダメージ・戦闘中の敵の速さ100%',
    incomingDamage: 1,
    enemyMovementSpeed: 1,
  }),
  hard: Object.freeze({
    id: 'hard' as const,
    label: '難しい',
    description: '被ダメージ140% ・ 戦闘中の敵の速さ120%',
    incomingDamage: 1.4,
    enemyMovementSpeed: 1.2,
  }),
});

export function normalizeDifficulty(value: unknown): Difficulty {
  return typeof value === 'string' && DIFFICULTY_LEVELS.includes(value as Difficulty)
    ? (value as Difficulty)
    : 'normal';
}

/** Difficulty is personal in co-op: damage is scaled for the player who receives it. */
export function incomingDamage(player: { difficulty?: unknown } | null, amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const multiplier = DIFFICULTIES[normalizeDifficulty(player?.difficulty)].incomingDamage;
  return Math.max(1, Math.round(amount * multiplier));
}

/** A hostile uses its current target's setting while chasing or moving through an attack. */
export function enemyMovementSpeed(
  player: { difficulty?: unknown } | null,
  baseSpeed: number,
): number {
  if (!Number.isFinite(baseSpeed) || baseSpeed <= 0) return 0;
  const multiplier = DIFFICULTIES[normalizeDifficulty(player?.difficulty)].enemyMovementSpeed;
  return baseSpeed * multiplier;
}
