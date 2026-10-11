export type MusicPlace = 'explore' | 'camp' | 'cave';
/** Steady beds, positioned beds and the measured cave response (decoded, looped). */
export const AMBIENCE_LOOPS = [
  'wind',
  'river',
  'stream',
  'waterfall',
  'shore',
  'rain',
  'fire',
  'torch',
] as const;
export type AmbienceLoop = (typeof AMBIENCE_LOOPS)[number];
export const AMBIENCE_FILES = [
  ...AMBIENCE_LOOPS,
  'birds-0',
  'birds-1',
  'birds-2',
  'birds-3',
  'birds-4',
  'birds-5',
  'drop-0',
  'drop-1',
  'drop-2',
  'drop-3',
  'cave-ir',
] as const;
/** Streamed through media elements: long pieces never sit decoded in memory. */
export const MUSIC_FILES = ['bgm-explore', 'bgm-camp', 'bgm-cave'] as const;
export const NATURE_AUDIO_REVISION = 'remake-v4-20261011';

/** Separate entry/exit thresholds avoid repeatedly restarting music at a region edge. */
export function musicRegion(previous: MusicPlace, cave: number, campDistance: number): MusicPlace {
  if (cave > (previous === 'cave' ? 0.3 : 0.7)) return 'cave';
  if (campDistance < (previous === 'camp' ? 22 : 17)) return 'camp';
  return 'explore';
}
