import { BEHEMOTH } from '../shared/behemoth-rules.mjs';
export const ENEMY_CLIPS = Object.freeze([
  'Idle_Loop',
  'Walk_Loop',
  'Run_Loop',
  'Attack',
  'Hit',
  'Death',
]);
export const BEHEMOTH_CLIPS = Object.freeze([...ENEMY_CLIPS, 'Alert', 'Charge', 'TailSpin']);
const clipsFor = (key) => (key === BEHEMOTH.modelKey ? BEHEMOTH_CLIPS : ENEMY_CLIPS);

export function requireEnemyClips(animations, key) {
  const names = new Set(animations.map((clip) => clip.name));
  const missing = clipsFor(key).filter((name) => !names.has(name));
  if (missing.length) throw new Error(`${key}: missing clips ${missing.join(', ')}`);
}

// One-shots are sampled on the authoritative timeline, including late joins.
export function enemyAnimationState(enemy, now) {
  if (enemy.phase === 'respawning') return null;
  const clip = enemy.phase === 'dead' ? 'Death' : enemy.clip;
  if (!clipsFor(enemy.modelKey).includes(clip))
    throw new Error(`${enemy.modelKey}: unsupported enemy clip ${clip}`);
  const started =
    clip === 'Death'
      ? enemy.phaseStartedAt
      : ['Attack', 'Alert', 'TailSpin'].includes(clip)
        ? enemy.attackAt
        : clip === 'Charge'
          ? enemy.attackAt + BEHEMOTH.alertMs
          : clip === 'Hit'
            ? enemy.hitAt
            : null;
  return { clip, elapsed: started === null ? null : Math.max(0, (now - started) / 1000) };
}

export function enemyStatusLabel(enemy) {
  if (enemy.modelKey !== BEHEMOTH.modelKey) return enemy.name;
  const cue = {
    guard: '縄張りを警戒',
    alert: '尾を振る…突進！',
    charge: '突進',
    bite: '噛みつき',
    tail: '尾の回転攻撃',
    return: '縄張りへ戻る',
    recover: '隙あり',
  }[enemy.behavior];
  return cue ? `${enemy.name} · ${cue}` : enemy.name;
}

export function playerDamageEvent(before, after) {
  if (!before || !after || before.id !== after.id) return null;
  if ((after.defeatSequence || 0) > (before.defeatSequence || 0)) return 'defeat';
  if ((after.hurtSequence || 0) > (before.hurtSequence || 0)) return 'hurt';
  return null;
}

export function playerRecovered(before, after) {
  return !!before?.downedUntil && !after.downedUntil && before.id === after.id;
}
