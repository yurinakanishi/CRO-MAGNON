import { attackProfile } from './combat-profiles.mjs';

export const JUMP = { height: 1, durationMs: 720, cooldownMs: 820 } as const;

export interface JumpState {
  jumpAt?: number;
  jumpSequence?: number;
  downedUntil?: number;
  mountId?: string | null;
  boatId?: string | null;
}

/** Shared server-clock arc; height and timing never come from a client command. */
export function jumpProgress(player: JumpState | null | undefined, now: number): number | null {
  if (
    !player?.jumpSequence ||
    !Number.isFinite(player.jumpAt) ||
    player.downedUntil ||
    player.mountId ||
    player.boatId
  )
    return null;
  const elapsed = now - player.jumpAt!;
  return elapsed >= 0 && elapsed < JUMP.durationMs ? elapsed / JUMP.durationMs : null;
}

export function jumpHeight(player: JumpState | null | undefined, now: number) {
  const progress = jumpProgress(player, now);
  return progress === null ? 0 : 4 * JUMP.height * progress * (1 - progress);
}

export function canStartJump(player, now: number): boolean {
  return !!(
    player &&
    !player.downedUntil &&
    !player.mountId &&
    !player.boatId &&
    !player.carrierId &&
    !player.passengerId &&
    (!player.jumpSequence || now - player.jumpAt >= JUMP.cooldownMs) &&
    (!player.attackSequence || now - player.attackAt >= attackProfile(player).durationMs)
  );
}
