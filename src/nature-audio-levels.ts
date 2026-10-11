/**
 * Real-world loudness model for every game sound.
 *
 * Each sound is described the way field recordists and acoustics references describe it:
 * an A-weighted level (dBA, LAeq of the event or the steady bed) at a reference distance.
 * Distance and an audibility floor give the level at the listener; one calibration curve
 * turns that into playback loudness. Assets are mastered to a shared reference and the
 * manifest stores each file's measured loudness, so this table is the only loudness knob.
 */
import { unit } from './nature-environment.js';

export type Spread = 'point' | 'line' | 'bed';
export type SoundLevel = {
  /** A-weighted level at `at` metres (for `bed`: as heard where the player stands). */
  dba: number;
  at: number;
  spread: Spread;
  note: string;
};

/**
 * Playback calibration. 50 dBA plays at -30 LUFS; real level differences are reproduced at
 * 0.7x (10 dB in the field -> 7 dB in the game) because a game is heard far quieter than
 * the field and on small speakers, where quiet sounds would otherwise vanish. Order and
 * proportion of every sound are kept.
 */
export const CALIBRATION = Object.freeze({ dba: 50, lufs: -30, slope: 0.7 });
/** Below this the sound is masked by the quietest outdoor background and fades out. */
export const AUDIBLE_FLOOR_DBA = 24;
/** A distant steady sound this far below the breeze merges into it (masked). */
export const MASKING_MARGIN_DB = 3;

export const LEVELS = {
  wind: { dba: 39, at: 0, spread: 'bed', note: 'breeze in grass, 34-44 dBA with gusts' },
  river: { dba: 48, at: 1, spread: 'line', note: 'slow 6 m lowland river, 1 m from the water' },
  stream: { dba: 57, at: 1, spread: 'line', note: 'turbulent mountain stream, 1 m from the water' },
  waterfall: { dba: 72, at: 5, spread: 'point', note: '15 m cascade of a small river' },
  shore: { dba: 64, at: 5, spread: 'line', note: 'surf on a beach, 5 m from the waterline' },
  rain: { dba: 52, at: 0, spread: 'bed', note: 'moderate rain on vegetation' },
  fire: { dba: 55, at: 1, spread: 'point', note: 'crackling campfire' },
  torch: { dba: 47, at: 0, spread: 'bed', note: 'hand-held torch near the head' },
  birds: { dba: 78, at: 1, spread: 'point', note: 'songbird in full song' },
  drop: { dba: 45, at: 1, spread: 'point', note: 'drip into a cave pool' },
  'step-grass': {
    dba: 42,
    at: 0,
    spread: 'bed',
    note: 'soft-soled walking step on grass, at the ears',
  },
  'step-sand': { dba: 44, at: 0, spread: 'bed', note: 'step on damp sand' },
  'step-stone': { dba: 46, at: 0, spread: 'bed', note: 'leather sole on rock' },
  'step-snow': { dba: 47, at: 0, spread: 'bed', note: 'crunch in packed snow' },
  'step-water': { dba: 55, at: 0, spread: 'bed', note: 'wading splash' },
  attack: { dba: 58, at: 0, spread: 'bed', note: 'club swung close to the body' },
  throw: { dba: 54, at: 0, spread: 'bed', note: 'arm and object whoosh' },
  jump: { dba: 49, at: 0, spread: 'bed', note: 'push-off and clothing' },
  hurt: { dba: 63, at: 0, spread: 'bed', note: 'blow to the body' },
  mount: { dba: 51, at: 0, spread: 'bed', note: 'climbing on: hide and clothing' },
  pet: { dba: 40, at: 0, spread: 'bed', note: 'hand stroking fur' },
  'gather-stone': { dba: 61, at: 0, spread: 'bed', note: 'stone knocked on stone' },
  'gather-wood': { dba: 55, at: 0, spread: 'bed', note: 'sticks picked up' },
  'gather-plant': { dba: 46, at: 0, spread: 'bed', note: 'plants pulled' },
  'torch-switch': { dba: 53, at: 0, spread: 'bed', note: 'torch flaring / smothered' },
  hiss: { dba: 62, at: 1, spread: 'point', note: 'cat hiss' },
  recall: { dba: 68, at: 0, spread: 'bed', note: 'bone-flute call by the player' },
} satisfies Record<string, SoundLevel>;
export type LevelName = keyof typeof LEVELS;

/** Non-diegetic sounds have fixed playback loudness at 100 % volume. */
export const FIXED_LUFS = Object.freeze({ music: -33, confirm: -32, discovery: -30 });

/**
 * dBA at the listener: geometric spreading, then excess attenuation over grass, low
 * vegetation and air (about 4 dB per 100 m, cf. ISO 9613-2 ground and air terms).
 */
export function levelAt(level: SoundLevel, distance = 0) {
  if (level.spread === 'bed') return level.dba;
  const d = Math.max(level.at, distance);
  const spreading = (level.spread === 'line' ? 10 : 20) * Math.log10(d / level.at);
  return level.dba - spreading - 0.04 * (d - level.at);
}

/** Playback loudness (LUFS) of a sound heard at `dba`. */
export function calibratedLufs(dba: number) {
  return CALIBRATION.lufs + CALIBRATION.slope * (dba - CALIBRATION.dba);
}

/**
 * Linear gain for an asset whose measured reference loudness is `assetLufs`. Sounds fade
 * out over 6 dB above `floor` (the background that masks them).
 */
export function playbackGain(dba: number, assetLufs: number, floor = AUDIBLE_FLOOR_DBA) {
  const t = unit((dba - Math.max(AUDIBLE_FLOOR_DBA, floor)) / 6);
  return 10 ** ((calibratedLufs(dba) - assetLufs) / 20) * t * t * (3 - 2 * t);
}

export function fixedGain(lufs: number, assetLufs: number) {
  return 10 ** ((lufs - assetLufs) / 20);
}

/** Air and vegetation absorb high frequencies first: a gentle distance low-pass. */
export function airLowpass(distance: number) {
  return Math.max(2600, 18000 * Math.exp(-Math.max(0, distance) / 140));
}

/** Gusts move the breeze between about 34 and 44 dBA. */
export function windDba(strength: number) {
  return 33.5 + 15 * strength;
}

/** Rain intensity (0-1) as a level: halving the drops removes 3 dB. */
export function rainDba(intensity: number) {
  return LEVELS.rain.dba + 10 * Math.log10(Math.max(1e-4, intensity));
}
