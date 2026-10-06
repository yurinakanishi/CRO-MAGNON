/** Original, bounded sound design: no external music, voices, samples or AI service. */
export function natureSynthesis(context: BaseAudioContext) {
  let seed = 20261006;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed / 4294967296) * 2 - 1;
  };
  const make = (seconds: number, sample: (t: number, noise: number) => number) => {
    const buffer = context.createBuffer(
      1,
      Math.ceil(context.sampleRate * seconds),
      context.sampleRate,
    );
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = sample(i / context.sampleRate, random());
    return buffer;
  };
  const tau = Math.PI * 2;
  // A breathy D4 with a soft attack, harmonic body and natural decay, suitable for transposition.
  const flute = make(3.8, (t, noise) => {
    const env = Math.min(1, t / 0.13) * Math.exp(-t * 0.95) * Math.min(1, (3.8 - t) / 0.3);
    const phase = tau * 293.6648 * t + 0.035 * Math.sin(tau * 4.7 * t);
    return (
      (Math.sin(phase) * 0.34 +
        Math.sin(phase * 2) * 0.06 +
        Math.sin(phase * 3) * 0.025 +
        noise * 0.012) *
      env
    );
  });
  const wood = make(
    2.5,
    (t) =>
      Math.min(1, t / 0.008) *
      (Math.sin(tau * 293.6648 * t) * Math.exp(-t * 4) * 0.36 +
        Math.sin(tau * 803.5 * t) * Math.exp(-t * 10) * 0.12),
  );
  const drop = make(
    0.5,
    (t) =>
      Math.min(1, t / 0.004) *
      Math.exp(-t * 14) *
      Math.sin(tau * (720 * t + (280 * (1 - Math.exp(-t * 15))) / 15)) *
      0.4,
  );
  const swish = make(0.32, (t, noise) => noise * Math.sin((Math.PI * t) / 0.32) ** 2 * 0.22);
  const splash = make(
    0.55,
    (t, noise) =>
      Math.min(1, t / 0.016) *
      Math.exp(-t * 8) *
      (noise * 0.32 + Math.sin(tau * (145 * t + 60 * t * t)) * 0.12),
  );
  const hiss = make(
    0.7,
    (t, noise) =>
      noise * Math.min(1, t / 0.045) * Math.exp(-t * 2.9) * Math.min(1, (0.7 - t) / 0.15) * 0.3,
  );
  const rain = make(6, (_t, noise) => noise * 0.12);
  // Shared stereo reverb, rather than one convolver per voice. Early reflections + soft tail.
  const impulse = context.createBuffer(2, Math.ceil(context.sampleRate * 1.65), context.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = impulse.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      const t = i / context.sampleRate;
      data[i] =
        t < 0.025 ? 0 : random() * Math.exp(-t * 4.8) * Math.min(1, (t - 0.025) * 25) * 0.18;
    }
    for (const [seconds, gain] of [
      [0.049, 0.5],
      [0.083, 0.3],
      [0.137, 0.17],
    ])
      data[Math.floor((seconds + c * 0.007) * context.sampleRate)] += gain;
  }
  return { flute, wood, drop, swish, splash, hiss, rain, impulse };
}

export type MusicPlace = 'explore' | 'camp' | 'cave';
/** Sparse D pentatonic motifs with planned rests; a phrase is followed by natural silence. */
export const NATURE_PHRASES: Record<
  MusicPlace,
  readonly (readonly [number, number, number, 'flute' | 'wood'])[]
> = {
  explore: [
    [0, 62, 0.14, 'flute'],
    [3.5, 69, 0.1, 'wood'],
    [6.5, 64, 0.13, 'flute'],
    [11, 66, 0.12, 'flute'],
    [15.5, 62, 0.1, 'wood'],
    [18, 57, 0.1, 'flute'],
  ],
  camp: [
    [0, 50, 0.13, 'wood'],
    [1.8, 62, 0.13, 'flute'],
    [5.5, 66, 0.12, 'wood'],
    [8, 69, 0.12, 'flute'],
    [12.5, 66, 0.1, 'flute'],
    [17, 62, 0.1, 'wood'],
  ],
  cave: [
    [0, 50, 0.12, 'wood'],
    [5.5, 57, 0.1, 'flute'],
    [12, 62, 0.08, 'wood'],
    [18, 54, 0.08, 'flute'],
  ],
};
