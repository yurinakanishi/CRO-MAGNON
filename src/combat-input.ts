import { attackProfile, shoulderMagic } from '../shared/combat-profiles.mjs';
import { jumpProgress } from '../shared/jumping.mjs';
import { caveInteriorWeight } from '../shared/cave-light.mjs';

// The server starts neutral and clears movement on defeat. A target command also
// replaces keyboard motion, so the next idle pulse must not cancel that path.
export class MovementCommands {
  declare direction: string | undefined;

  constructor() {
    this.reset();
  }
  reset() {
    this.direction = '0,0';
  }
  next({ dx, dz, running }) {
    const direction = `${dx},${dz}`;
    const changed = direction !== this.direction;
    this.direction = direction;
    return dx || dz || changed ? { type: 'move', dx, dz, running } : null;
  }
}

// Key-up must resolve the same physical key even if Shift or the layout changed.
export function movementKey(event) {
  const physical = {
    KeyW: 'w',
    KeyA: 'a',
    KeyS: 's',
    KeyD: 'd',
    ShiftLeft: 'shift',
    ShiftRight: 'shift',
    ArrowUp: 'arrowup',
    ArrowDown: 'arrowdown',
    ArrowLeft: 'arrowleft',
    ArrowRight: 'arrowright',
  };
  return physical[event.code] ?? event.key?.toLowerCase();
}

export function acceptsGameShortcut(event) {
  return !event.isComposing && !event.ctrlKey && !event.metaKey && !event.altKey;
}

// Physical KeyF also works when the keyboard layout reports another character.
export function isAttackShortcut(event) {
  if (event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey)
    return false;
  return (
    ['KeyF', 'Digit5', 'Numpad5'].includes(event.code) ||
    ['f', '5'].includes(event.key?.toLowerCase())
  );
}

// Having a target, its phase, and cooking never gate the attack control.
export function canStartAttack(player, serverNow) {
  return attackBlockReason(player, serverNow) === null;
}

/** Share the actual attack gate with feedback instead of silently dropping a gesture. */
export function attackBlockReason(player, serverNow): string | null {
  if (!player || player.downedUntil) return '今は攻撃できません。復帰を待ってください。';
  if (caveInteriorWeight(player) > 0) return '洞窟の中では攻撃できません。';
  if (player.mountId || player.boatId || player.passengerId)
    return '乗り物から降りると攻撃できます。';
  if (player.carrierId && !shoulderMagic(player)) return '地面に降りると攻撃できます。';
  if (jumpProgress(player, serverNow) !== null)
    return '空中では攻撃できません。着地したら、もう一度押してください。';
  if (
    player.attackSequence > 0 &&
    !(serverNow - player.attackAt >= attackProfile(player).cooldownMs)
  )
    return '次の攻撃を準備中です。少し引いて、もう一度押してください。';
  return null;
}
