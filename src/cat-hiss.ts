/** A short breath/noise hiss, obeying the game's sound setting and distance. */
export function playCatHiss(context: AudioContext, gainValue: number) {
  const seconds = 0.7,
    buffer = context.createBuffer(1, Math.ceil(context.sampleRate * seconds), context.sampleRate);
  const values = buffer.getChannelData(0);
  let seed = 52427;
  for (let i = 0; i < values.length; i++) {
    seed = (1664525 * seed + 1013904223) >>> 0;
    values[i] = (seed / 0xffffffff) * 2 - 1;
  }
  const noise = context.createBufferSource(),
    filter = context.createBiquadFilter(),
    gain = context.createGain();
  noise.buffer = buffer;
  filter.type = 'highpass';
  filter.frequency.value = 1700;
  const now = context.currentTime;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(gainValue, now + 0.045);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.001, gainValue * 0.24), now + 0.45);
  gain.gain.linearRampToValueAtTime(0, now + seconds);
  noise.connect(filter).connect(gain).connect(context.destination);
  noise.onended = () => {
    noise.disconnect();
    filter.disconnect();
    gain.disconnect();
  };
  noise.start(now);
  noise.stop(now + seconds);
}
