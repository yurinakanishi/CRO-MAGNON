import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  FootstepClock,
  natureEnvironment,
  natureWind,
  nearestRiver,
  nearestWaters,
  waterAt,
} from '../dist/src/nature-environment.js';
import { normalizeAudioSettings, DEFAULT_AUDIO } from '../dist/src/nature-audio-settings.js';
import { caveWorldAt } from '../dist/shared/camp-cave-layout.mjs';
import { riverX, WATER_LEVEL } from '../dist/shared/terrain.mjs';
import { MOUNTAIN_RIVER, MOUNTAIN_WATERFALL } from '../dist/shared/mountain-river.mjs';
import { MIME } from '../dist/infrastructure/node/static-files.mjs';
import { FOLEY_FILES } from '../dist/src/nature-foley.js';
import { AMBIENCE_FILES, MUSIC_FILES, musicRegion } from '../dist/src/nature-audio-design.js';
import {
  AUDIBLE_FLOOR_DBA,
  LEVELS,
  airLowpass,
  calibratedLufs,
  levelAt,
  playbackGain,
  rainDba,
  windDba,
} from '../dist/src/nature-audio-levels.js';

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
    { enabled: false, ambience: 1, music: 0, effects: 1 },
  );
});
test('every shipped sound has CC0 provenance, a measured reference level and bounded size/memory', async () => {
  const manifest = JSON.parse(await readFile('public/audio/nature/manifest.json'));
  let bytes = 0,
    musicBytes = 0;
  const cues = ['fx-confirm', 'fx-discovery', 'fx-recall'];
  for (const item of manifest.files) {
    const data = await readFile(`public${item.url}`);
    if (item.kind === 'music') musicBytes += data.length;
    else bytes += data.length;
    assert.equal(createHash('sha256').update(data).digest('hex'), item.sha256);
    assert.equal(item.rate, 44100);
    assert.ok(item.truePeak <= -0.9, `${item.name} true peak ${item.truePeak}`);
    // Mastered to the shared reference unless a recording's peaks forbid it; the game
    // compensates from the measured value, so it only has to be plausible.
    assert.ok(item.loudness <= -22.8 && item.loudness > -36, `${item.name} ${item.loudness}`);
    for (const source of item.sources) {
      const file = source.startsWith('VSCO 2 CE')
        ? 'VSCO 2 CE'
        : source.startsWith('Nox_Sound IR')
          ? `${source.split(' ')[2]}.ogg`
          : source;
      assert.ok(
        manifest.sources.some((s) => s.file === file && s.license === 'CC0-1.0'),
        `${item.name}: ${source}`,
      );
    }
    const stereo =
      ['wind', 'river', 'stream', 'shore', 'rain', 'cave-ir'].includes(item.name) ||
      item.kind === 'music' ||
      cues.includes(item.name);
    assert.equal(item.channels, stereo ? 2 : 1, item.name);
    if (stereo && item.kind !== 'impulse') assert.ok(item.correlation < 0.995, item.name);
    if (item.kind === 'loop') assert.ok(item.processing.crossfade >= 2 && item.seconds >= 17);
    // Full-band recordings: nothing is muffled by the old 1.8-8 kHz low-passes.
    if (['wind', 'river', 'stream', 'waterfall', 'rain', 'fire'].includes(item.name))
      assert.ok(item.above8kHz > 0.005, `${item.name} ${item.above8kHz}`);
  }
  assert.deepEqual(
    manifest.files.map((f) => f.name).sort(),
    [...AMBIENCE_FILES, ...FOLEY_FILES, ...MUSIC_FILES].sort(),
  );
  assert.equal(FOLEY_FILES.length, 57);
  assert.ok(bytes < 7_500_000, `${bytes}`);
  assert.ok(musicBytes < 6_000_000, `${musicBytes}`);
  // Music streams through media elements, so only the rest is ever decoded.
  assert.ok(manifest.decodedBytesAt48000Hz < 112 * 1024 * 1024);
  assert.equal(MIME['.mp3'], 'audio/mpeg');
  for (const file of ['scripts/build-exhibition.mjs', 'scripts/cloudflare-public-build.mjs'])
    assert.match(await readFile(file, 'utf8'), /collect\('public\/audio'/);
});
test('real-world levels: quiet river at camp, loud at its bank, soft footsteps, far-reaching waterfall', () => {
  const camp = { x: 50, y: 0, z: 50 };
  const { river } = nearestWaters(camp);
  assert.ok(river.edge > 9 && river.edge < 14, `${river.edge}`);
  const breeze = windDba(0.35);
  assert.ok(breeze > 37 && breeze < 41);
  // From the camp the slow river is at or below a light breeze; at its bank it leads.
  assert.ok(levelAt(LEVELS.river, river.edge) < breeze);
  assert.ok(levelAt(LEVELS.river, 1) > breeze + 6);
  // A soft step on grass sits just above the breeze and below the water at the bank.
  assert.ok(LEVELS['step-grass'].dba > breeze && LEVELS['step-grass'].dba < breeze + 5);
  assert.ok(LEVELS['step-grass'].dba < levelAt(LEVELS.river, 1) - 4);
  assert.ok(LEVELS['step-water'].dba > LEVELS['step-stone'].dba);
  // Birds 30 m away are clearly audible; the waterfall is heard over 100 m away.
  assert.ok(levelAt(LEVELS.birds, 30) > breeze + 5);
  assert.ok(levelAt(LEVELS.waterfall, 120) > AUDIBLE_FLOOR_DBA + 6);
  assert.ok(levelAt(LEVELS.fire, 20) < breeze);
  // Line sources fall 3 dB per doubling, points 6 dB (+ small excess attenuation).
  assert.ok(Math.abs(levelAt(LEVELS.river, 2) - levelAt(LEVELS.river, 4) - 3.05) < 0.1);
  assert.ok(Math.abs(levelAt(LEVELS.fire, 2) - levelAt(LEVELS.fire, 4) - 6.06) < 0.1);
  assert.equal(levelAt(LEVELS.waterfall, 1), LEVELS.waterfall.dba);
  // Calibration keeps order and compresses differences to 0.7x.
  assert.ok(Math.abs(calibratedLufs(60) - calibratedLufs(50) - 7) < 1e-9);
  assert.equal(playbackGain(AUDIBLE_FLOOR_DBA, -23), 0);
  let previous = 0;
  for (let dba = 20; dba < 90; dba += 0.5) {
    const gain = playbackGain(dba, -23);
    assert.ok(gain >= previous);
    previous = gain;
  }
  assert.ok(rainDba(0.0001) < AUDIBLE_FLOOR_DBA && rainDba(1) === LEVELS.rain.dba);
  assert.ok(airLowpass(0) >= 17000 && airLowpass(300) < airLowpass(50));
});
test('water is classified by flow and measured from the edge', () => {
  const upper = MOUNTAIN_RIVER[4];
  const waters = nearestWaters({ x: upper.x, y: upper.y, z: upper.z });
  assert.equal(waters.stream.edge, 0.5);
  assert.ok(waters.river.edge > 20);
  const tail = MOUNTAIN_RIVER.at(-2);
  assert.equal(nearestWaters({ x: tail.x, y: tail.y, z: tail.z }).river.edge, 0.5);
  const { lip, foot } = MOUNTAIN_WATERFALL;
  const middle = { x: (lip.x + foot.x) / 2, y: (lip.y + foot.y) / 2, z: lip.z };
  // The fall itself is a point source, not a stream segment.
  assert.ok(nearestWaters(middle).stream.edge > 1);
  const bank = { x: riverX(40) + 3.5, y: WATER_LEVEL, z: 40 };
  assert.ok(nearestWaters(bank).river.edge < 1);
});

test('music boundaries have hysteresis', () => {
  assert.equal(musicRegion('explore', 0, 16), 'camp');
  assert.equal(musicRegion('camp', 0, 20), 'camp');
  assert.equal(musicRegion('explore', 0, 20), 'explore');
  assert.equal(musicRegion('camp', 0, 23), 'explore');
  assert.equal(musicRegion('camp', 0.8, 10), 'cave');
  assert.equal(musicRegion('cave', 0.5, 10), 'cave');
  assert.equal(musicRegion('cave', 0.2, 10), 'camp');
});
