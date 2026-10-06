import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  FootstepClock,
  natureEnvironment,
  natureWind,
  nearestRiver,
  waterAt,
} from '../dist/src/nature-environment.js';
import { normalizeAudioSettings, DEFAULT_AUDIO } from '../dist/src/nature-audio-settings.js';
import { caveWorldAt } from '../dist/shared/camp-cave-layout.mjs';
import { riverX, WATER_LEVEL } from '../dist/shared/terrain.mjs';
import { MOUNTAIN_RIVER } from '../dist/shared/mountain-river.mjs';
import { MIME } from '../dist/infrastructure/node/static-files.mjs';
import { FOLEY_FILES } from '../dist/src/nature-foley.js';
import { NATURE_FILES, musicRegion, soundFalloff } from '../dist/src/nature-audio-design.js';

test('footfalls follow gait crossings and travel, excluding standstill, warps, air and mounts', () => {
  const clock = new FootstepClock();
  const sample = {
    id: 'one',
    warp: 0,
    x: 0,
    y: 0,
    z: 0,
    moving: true,
    grounded: true,
    phase: 0.4,
    clip: 'Walk_Loop',
  };
  assert.equal(clock.update(sample, 0), false);
  assert.equal(clock.update({ ...sample, x: 0.1, phase: 0.55 }, 0.3), true);
  assert.equal(clock.update({ ...sample, x: 0.1, phase: 0.1 }, 0.6), false);
  assert.equal(clock.update({ ...sample, x: 0.2, phase: 0.55, grounded: false }, 0.9), false);
  assert.equal(clock.update({ ...sample, x: 30, phase: 0.1 }, 1.2), false);
  assert.equal(clock.update({ ...sample, x: 30.2, phase: 0.55, warp: 1 }, 1.5), false);
  assert.equal(
    clock.update({ ...sample, x: 30.3, phase: 0.1, warp: 1, moving: false }, 1.8),
    false,
  );
  clock.reset();
  assert.equal(clock.update(sample, 2), false);
});
test('cave masks outdoors and roof surface is outdoors', () => {
  const cave = { ...caveWorldAt(-20), y: 0 };
  assert.equal(natureEnvironment(cave, 0).cave, 1);
  assert.equal(natureEnvironment(cave, 0).surface, 'stone');
  assert.equal(natureEnvironment({ ...cave, y: 100 }, 0).cave, 0);
  assert.equal(natureEnvironment({ x: 50, y: 0, z: 50 }, 0).surface, 'grass');
});
test('water contacts include the elevated river but exclude bridges and dry ground', () => {
  const river = { x: riverX(45), y: -1, z: 45 };
  assert.equal(waterAt(river), WATER_LEVEL);
  assert.equal(waterAt({ ...river, y: 2 }), null);
  assert.equal(waterAt({ x: 43, y: 0, z: 43 }), null);
  const mountain = MOUNTAIN_RIVER[3];
  assert.ok(waterAt({ ...mountain, y: mountain.y - 0.2 }) > 30);
  assert.ok(nearestRiver(mountain).distance < 0.001);
  assert.ok(nearestRiver({ ...mountain, y: 0 }).distance > 10);
});
test('wind field is continuous and audio settings reject corrupt values', () => {
  for (let t = 0; t < 100; t += 0.2) {
    const a = natureWind(t, 50, 50),
      b = natureWind(t + 0.016, 50, 50);
    assert.ok(a.strength >= 0.009 && a.strength <= 0.691);
    assert.ok(Math.abs(a.x - b.x) < 0.003);
  }
  assert.deepEqual(normalizeAudioSettings(null), DEFAULT_AUDIO);
  assert.deepEqual(
    normalizeAudioSettings({ enabled: false, ambience: 7, music: -1, effects: NaN }),
    { enabled: false, ambience: 1, music: 0, effects: 0.5 },
  );
});
test('recorded audio and sampled score have provenance, headroom and bounded transfer/memory', async () => {
  const manifest = JSON.parse(await readFile('public/audio/nature/manifest.json'));
  let bytes = 0;
  for (const item of manifest.files) {
    const data = await readFile(`public${item.url}`);
    bytes += data.length;
    assert.equal(createHash('sha256').update(data).digest('hex'), item.sha256);
    assert.ok(item.peak < 0.6 && item.rms > 0.001);
    assert.ok(item.truePeakDB < -4);
    for (const source of [item.source].flat())
      assert.ok(manifest.sources.some((s) => s.file === source && s.license === 'CC0-1.0'));
    assert.equal(item.rate, 44100);
    if (['wind', 'river', 'shore', 'rain'].includes(item.name) || item.name.startsWith('bgm-')) {
      assert.equal(item.channels, 2);
      assert.ok(item.correlation < 0.995);
    }
    if (item.loop) assert.ok(item.processing.crossfade >= 2);
  }
  assert.deepEqual(
    manifest.files.map((f) => f.name).sort(),
    [...NATURE_FILES, ...FOLEY_FILES].sort(),
  );
  assert.equal(FOLEY_FILES.length, 37);
  assert.ok(manifest.files.find((f) => f.name === 'wind').lufs < -37);
  assert.ok(manifest.files.find((f) => f.name === 'river').lufs < -28);
  assert.ok(bytes < 8_000_000);
  assert.ok(manifest.decodedBytesAt48000Hz < 128 * 1024 * 1024);
  assert.equal(MIME['.mp3'], 'audio/mpeg');
  for (const file of ['scripts/build-exhibition.mjs', 'scripts/cloudflare-public-build.mjs'])
    assert.match(await readFile(file, 'utf8'), /collect\('public\/audio'/);
});

test('music boundaries have hysteresis and sound distance envelopes fade continuously', () => {
  assert.equal(musicRegion('explore', 0, 16), 'camp');
  assert.equal(musicRegion('camp', 0, 20), 'camp');
  assert.equal(musicRegion('explore', 0, 20), 'explore');
  assert.equal(musicRegion('camp', 0, 23), 'explore');
  assert.equal(musicRegion('camp', 0.8, 10), 'cave');
  assert.equal(musicRegion('cave', 0.5, 10), 'cave');
  assert.equal(musicRegion('cave', 0.2, 10), 'camp');
  assert.equal(soundFalloff(0, 2, 20), 1);
  assert.equal(soundFalloff(20, 2, 20), 0);
  let previous = 1;
  for (let d = 0; d < 24; d += 0.01) {
    const value = soundFalloff(d, 2, 20);
    assert.ok(value <= previous && value >= 0 && previous - value < 0.001);
    previous = value;
  }
});
