export const FIXED_DIFFICULTY = 'normal' as const;
export const DIFFICULTY_LEVELS = [FIXED_DIFFICULTY] as const;
export type Difficulty = (typeof DIFFICULTY_LEVELS)[number];

export const DIFFICULTIES = Object.freeze({
  normal: Object.freeze({
    id: 'normal' as const,
    label: '普通',
    description: '被ダメージ100%（敵の動きは全員共通）',
    incomingDamage: 1,
  }),
});

/** Old saves and clients may still supply a choice; every player now uses normal. */
export function normalizeDifficulty(_value: unknown): Difficulty {
  return FIXED_DIFFICULTY;
}

/** Normal damage is fixed; exhibition rooms retain their separate room rules. */
export function incomingDamage(
  player: { difficulty?: unknown } | null,
  amount: number,
  // A room may fix one multiplier for everyone instead of the normal balance.
  roomScale: number | null = null,
): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const multiplier =
    roomScale ?? DIFFICULTIES[normalizeDifficulty(player?.difficulty)].incomingDamage;
  return Math.max(1, Math.round(amount * multiplier));
}
