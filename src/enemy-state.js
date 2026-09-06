export const ENEMY_CLIPS = Object.freeze(['Idle_Loop', 'Walk_Loop', 'Run_Loop', 'Attack', 'Hit', 'Death']);

export function requireEnemyClips(animations, key) {
  const names = new Set(animations.map(clip => clip.name));
  const missing = ENEMY_CLIPS.filter(name => !names.has(name));
  if (missing.length) throw new Error(`${key}: missing clips ${missing.join(', ')}`);
}

// One-shots are sampled on the authoritative timeline, including late joins.
export function enemyAnimationState(enemy, now) {
  if (enemy.phase === 'respawning') return null;
  const clip = enemy.phase === 'dead' ? 'Death' : enemy.clip;
  if (!ENEMY_CLIPS.includes(clip)) throw new Error(`${enemy.modelKey}: unsupported enemy clip ${clip}`);
  const started = clip === 'Death' ? enemy.phaseStartedAt : clip === 'Attack' ? enemy.attackAt : clip === 'Hit' ? enemy.hitAt : null;
  return { clip, elapsed: started === null ? null : Math.max(0, (now - started) / 1000) };
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
