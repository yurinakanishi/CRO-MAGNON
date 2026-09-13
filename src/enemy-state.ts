import { BEHEMOTH, BEHEMOTH_CLIP_TIMING } from '../shared/behemoth-rules.mjs';
import { SABERTOOTH } from '../shared/sabertooth-rules.mjs';
export const ENEMY_CLIPS = Object.freeze([
  'Idle_Loop',
  'Walk_Loop',
  'Run_Loop',
  'Attack',
  'Hit',
  'Death',
]);
// 2026-09-12: every strike is announced by its own telegraph clip (behemoth:
// Roar before Charge, Gape before Attack, Tremble before TailSpin; sabertooth:
// Crouch before Pounce, Snarl before Attack).
export const BEHEMOTH_CLIPS = Object.freeze([
  ...ENEMY_CLIPS,
  'Alert',
  'Roar',
  'Charge',
  'Gape',
  'Tremble',
  'TailSpin',
  'SpitWindup',
  'Spit',
]);
export const SABERTOOTH_CLIPS = Object.freeze([
  ...ENEMY_CLIPS,
  'Alert',
  'Crouch',
  'Pounce',
  'Snarl',
  'Step',
]);
const clipsFor = (key) =>
  key === BEHEMOTH.modelKey
    ? BEHEMOTH_CLIPS
    : key === SABERTOOTH.modelKey
      ? SABERTOOTH_CLIPS
      : ENEMY_CLIPS;

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
      : clip === 'Hit'
        ? enemy.hitAt
        : ONE_SHOT_OFFSET_MS[enemy.modelKey]?.[clip] !== undefined
          ? enemy.attackAt + ONE_SHOT_OFFSET_MS[enemy.modelKey][clip]
          : ['Attack', 'Alert'].includes(clip)
            ? enemy.attackAt
            : null;
  const timing = enemy.modelKey === BEHEMOTH.modelKey ? BEHEMOTH_CLIP_TIMING[clip] : null;
  return {
    clip,
    elapsed:
      started === null
        ? null
        : Math.max(0, (now - started) / 1000) * (timing ? timing.authoredMs / timing.activeMs : 1),
  };
}
// A strike clip starts when its telegraph clip ends, on the authoritative clock.
const ONE_SHOT_OFFSET_MS = {
  [BEHEMOTH.modelKey]: {
    Alert: 0,
    Roar: 0,
    Charge: BEHEMOTH.roarMs,
    Gape: 0,
    Attack: BEHEMOTH.gapeMs,
    Tremble: 0,
    TailSpin: BEHEMOTH.trembleMs,
    SpitWindup: 0,
    Spit: BEHEMOTH.spitWindupMs,
  },
  [SABERTOOTH.modelKey]: {
    Alert: 0,
    Crouch: 0,
    Pounce: SABERTOOTH.pounceWindupMs,
    Snarl: 0,
    Attack: SABERTOOTH.snarlMs,
    Step: 0,
  },
};

const SABERTOOTH_CUES = {
  guard: '縄張りを見回る',
  alert: '咆哮！',
  chase: '疾走',
  crouch: '身を沈めた…飛びかかりが来る！',
  pounce: '飛びかかり',
  land: '着地の隙',
  snarl: '牙をむいた…爪が来る！',
  claw: '爪の連撃',
  step: 'ステップでかわす',
  return: '縄張りへ戻る',
  recover: '身構える',
};
const BEHEMOTH_CUES = {
  guard: '縄張りを警戒',
  roar: '低く構えた…突進が来る！',
  charge: '突進',
  gape: '口を開けた…噛みつきが来る！',
  bite: '噛みつき',
  tremble: '尾を持ち上げた…回転が来る！',
  'spit-windup': '首を引いた…毒液が来る！',
  spit: '毒液を吐く',
  tail: '尾の回転攻撃',
  return: '縄張りへ戻る',
  recover: '隙あり',
};
const SHAMAN_CUES = {
  bolt: '赤い呪弾を放つ…',
  burst: '赤い呪いが広がる…離れろ！',
  dive: '空から急降下！',
};

export function enemyStatusLabel(enemy) {
  const cues =
    enemy.modelKey === SABERTOOTH.modelKey
      ? SABERTOOTH_CUES
      : enemy.modelKey === BEHEMOTH.modelKey
        ? BEHEMOTH_CUES
        : SHAMAN_CUES;
  const cue = cues[enemy.behavior];
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
