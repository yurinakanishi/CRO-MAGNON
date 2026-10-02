import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GraphicsQuality, graphicsPixelRatio, graphicsMode } from '../dist/src/graphics-quality.js';
import { FrameClock } from '../dist/src/frame-clock.js';
import { ActorUpdateBudget } from '../dist/src/actor-update-budget.js';
import { WorldAssets } from '../dist/src/world-assets.js';

test('all screen sizes keep the low drawing buffer inside 720p without reducing DOM dimensions', () => {
  for (const [w, h, dpr] of [
    [3840, 2160, 2],
    [1280, 800, 1.25],
    [390, 844, 3],
    [844, 390, 2],
    [1, 1, 1],
  ]) {
    const ratio = graphicsPixelRatio(w, h, dpr, 'low');
    assert.ok(w * h * ratio * ratio <= 1280 * 720 + 1);
    assert.ok(ratio <= dpr && ratio <= 1);
  }
  assert.equal(graphicsMode('bad'), 'auto');
});

test('auto ignores loading, hidden tabs and isolated stalls; sustained slow frames downgrade once', () => {
  const quality = new GraphicsQuality('auto', 8, 8);
  quality.ready(0);
  for (let now = 0; now < 8000; now += 50) assert.equal(quality.observe(now, 50, true), false);
  for (let now = 8000; now < 11000; now += 50) quality.observe(now, 50, true);
  quality.observe(11000, 50, false);
  for (let now = 11050; now < 17000; now += 16.67) quality.observe(now, 16.67, true);
  assert.equal(quality.tier, 'standard');
  for (let now = 17000; now < 24000; now += 50) quality.observe(now, 50, true);
  assert.equal(quality.tier, 'low');
  for (let now = 24000; now < 60000; now += 16.67) quality.observe(now, 16.67, true);
  assert.equal(quality.tier, 'low');
  quality.setMode('standard', 60000);
  for (let now = 60000; now < 90000; now += 80) quality.observe(now, 80, true);
  assert.equal(quality.tier, 'standard', 'explicit selection is respected');
  assert.equal(new GraphicsQuality('auto', 4, 8).tier, 'low');
  assert.equal(new GraphicsQuality('auto', 8, 4).tier, 'low');
});

test('frame-rate switches and background resume do not burst or advance movement beyond the dt limit', () => {
  const clock = new FrameClock(0, 60);
  let frames = 0;
  for (let t = 0; t < 1000; t += 1000 / 60) if (clock.advance(t) !== null) frames++;
  assert.ok(frames >= 59 && frames <= 61);
  clock.setRate(1000, 30);
  frames = 0;
  for (let t = 1000; t < 2000; t += 1000 / 60) {
    const dt = clock.advance(t);
    if (dt !== null) {
      frames++;
      assert.ok(dt <= 0.06);
    }
  }
  assert.ok(frames >= 29 && frames <= 31);
  clock.advance(500000, true);
  assert.equal(clock.advance(500000), 0);
  clock.setRate(500010, 60);
  assert.equal(clock.advance(500010), 0);
});

test('offscreen loops accumulate elapsed time, while re-entry and important actions sample immediately', () => {
  const budget = new ActorUpdateBudget(),
    camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.updateMatrixWorld(true);
  budget.begin(camera);
  const actor = {},
    back = new THREE.Vector3(0, 0, 10),
    front = new THREE.Vector3(0, 0, -10);
  assert.equal(budget.step(actor, back, 10, 0, 0.016), 0.016);
  assert.equal(budget.step(actor, back, 10, 0.1, 0.016), null);
  assert.equal(budget.step(actor, front, 10, 0.11, 0.016), 0.11);
  assert.ok(budget.step(actor, back, 10, 0.12, 0.016, true) > 0);
  assert.equal(budget.step(actor, back, 10, 0.15, 0.016), null);
  assert.ok(budget.step(actor, back, 10, 0.34, 0.016) > 0.2);
});

test('deferred companions share the two-load queue and disposal prevents late resurrection', async () => {
  const jobs = [];
  let active = 0,
    max = 0;
  const assets = new WorldAssets({
    loadEnvironment: () =>
      new Promise((resolve) => {
        active++;
        max = Math.max(max, active);
        jobs.push(() => {
          active--;
          resolve({ scene: new THREE.Group() });
        });
      }),
  });
  assets.catalog = {
    assets: ['a', 'b', 'c'].map((modelKey) => ({ modelKey, kind: 'companion', lods: [] })),
  };
  const work = Promise.allSettled(['a', 'b', 'c'].map((k) => assets.ensureCompanion(k)));
  const first = assets.ensureCompanion('a');
  assert.equal(jobs.length, 2);
  jobs.shift()();
  await first;
  assert.ok(assets.templates.has('a'));
  assert.equal(max, 2);
  assets.dispose();
  for (const done of jobs) done();
  const outcomes = await work;
  assert.equal(outcomes[0].status, 'fulfilled');
  assert.equal(outcomes[1].status, 'rejected');
  assert.equal(outcomes[2].status, 'rejected');
  assert.equal(assets.templates.size, 0);
});
