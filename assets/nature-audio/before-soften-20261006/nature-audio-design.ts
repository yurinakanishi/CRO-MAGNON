import { unit } from './nature-environment.js';

export type MusicPlace = 'explore' | 'camp' | 'cave';
export const NATURE_FILES = [
  'wind',
  'river',
  'shore',
  'fire',
  'torch',
  'rain',
  'birds-0',
  'birds-1',
  'birds-2',
  'drop-0',
  'drop-1',
  'bgm-explore',
  'bgm-camp',
  'bgm-cave',
] as const;
export const NATURE_AUDIO_REVISION = 'field-v2-20261006';

/** One smooth distance envelope. Panners provide direction only, not another attenuation. */
export function soundFalloff(distance: number, near: number, far: number) {
  const t = unit((distance - near) / (far - near));
  return 1 - t * t * (3 - 2 * t);
}
/** Separate entry/exit thresholds avoid repeatedly restarting music at a region edge. */
export function musicRegion(previous: MusicPlace, cave: number, campDistance: number): MusicPlace {
  if (cave > (previous === 'cave' ? 0.3 : 0.7)) return 'cave';
  if (campDistance < (previous === 'camp' ? 22 : 17)) return 'camp';
  return 'explore';
}

/** A shared, dark acoustic tail. No synthesized musical notes, rain or water droplets. */
export function caveImpulse(context: BaseAudioContext) {
  let seed = 20261006;
  const impulse = context.createBuffer(2, Math.ceil(context.sampleRate * 2.4), context.sampleRate);
  const smoothing = 1 - Math.exp((-2 * Math.PI * 2100) / context.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = impulse.getChannelData(c);
    let filtered = 0;
    for (let i = 0; i < data.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      filtered += ((seed / 4294967296) * 2 - 1 - filtered) * smoothing;
      const t = i / context.sampleRate;
      data[i] = t < 0.03 ? 0 : filtered * Math.exp((-6.9 * t) / 2.4) * 0.12;
    }
    for (const [delay, gain] of [
      [0.043, 0.4],
      [0.079, 0.24],
      [0.127, 0.14],
    ])
      data[Math.round((delay + c * 0.008) * context.sampleRate)] += gain;
  }
  return impulse;
}
