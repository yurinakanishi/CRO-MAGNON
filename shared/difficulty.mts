export const DIFFICULTY_LEVELS = ['easy', 'normal', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTY_LEVELS)[number];

export const DIFFICULTIES = Object.freeze({
  easy: Object.freeze({
    id: 'easy' as const,
    label: '簡単',
    description: '被ダメージ70%（敵の動きは全員共通）',
    incomingDamage: 0.7,
  }),
  normal: Object.freeze({
    id: 'normal' as const,
    label: '普通',
    description: '被ダメージ100%（敵の動きは全員共通）',
    incomingDamage: 1,
  }),
  hard: Object.freeze({
    id: 'hard' as const,
    label: '難しい',
    description: '被ダメージ140%（敵の動きは全員共通）',
    incomingDamage: 1.4,
  }),
});

export function normalizeDifficulty(value: unknown): Difficulty {
  return typeof value === 'string' && DIFFICULTY_LEVELS.includes(value as Difficulty)
    ? (value as Difficulty)
    : 'normal';
}

/** Difficulty is personal in co-op: damage is scaled for the player who receives it. */
export function incomingDamage(
  player: { difficulty?: unknown } | null,
  amount: number,
  // A room may fix one multiplier for everyone instead of the personal choice.
  roomScale: number | null = null,
): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const multiplier =
    roomScale ?? DIFFICULTIES[normalizeDifficulty(player?.difficulty)].incomingDamage;
  return Math.max(1, Math.round(amount * multiplier));
}
