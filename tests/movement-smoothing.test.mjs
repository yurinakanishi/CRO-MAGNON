import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalPrediction } from '../dist/src/local-prediction.js';
import { WORLD } from '../dist/shared/world.mjs';
import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';

const free = { move: (p, dx, dz) => ({ x: p.x + dx, z: p.z + dz }) };
const actor = (extra = {}) => ({
  id: 'smooth',
  species: 'cro',
  gender: 'female',
  x: 40,
  z: 50,
  radius: 0.32,
  moving: true,
  running: false,
  speed: WORLD.walkSpeed,
  facing: Math.PI / 2,
  attackSequence: 0,
  attackAt: 0,
  hurtSequence: 0,
  defeatSequence: 0,
  downedUntil: 0,
  ...extra,
});
function prediction(extra = {}) {
  const value = new LocalPrediction();
  value.enabled = true;
  value.receive(actor(extra), 1000);
  return value;
}

test('all seven appearances keep steady forward steps through jittered and duplicate snapshots', () => {
  for (const character of CHARACTER_MODELS)
    for (const running of [false, true]) {
      const profile = { species: character.species, gender: character.gender },
        speed = running
          ? (character.runSpeed ?? WORLD.runSpeed)
          : (character.walkSpeed ?? WORLD.walkSpeed),
        p = prediction(profile),
        packets = [];
      p.latencyMs = 40;
      for (let i = 1; i <= 30; i++) {
        const serverAt = 1000 + i * 100,
          x = 40 + (speed * (serverAt - 1000)) / 1000;
        packets.push({ at: serverAt + [5, 35, 15, 25][i % 4], x });
        if (i % 3 === 0) packets.push({ at: serverAt + 45, x });
      }
      let last = 40,
        maxStep = 0,
        minStep = Infinity,
        maxError = 0;
      for (let i = 1; i < 175; i++) {
        const now = 1000 + (i * 1000) / 60;
        while (packets[0]?.at <= now) {
          const packet = packets.shift();
          p.receive(actor({ ...profile, x: packet.x, running, speed }), packet.at);
        }
        p.setInput(1, 0, running, now);
        const shown = p.step(1 / 60, now, now, free, []);
        assert.equal(shown.moving, true);
        assert.ok(
          Math.abs(shown.speed - speed) < 1e-9,
          'gait must exclude RTT and position correction',
        );
        assert.equal(shown.facing, Math.PI / 2);
        if (i > 15) {
          minStep = Math.min(minStep, shown.x - last);
          maxStep = Math.max(maxStep, shown.x - last);
          maxError = Math.max(maxError, Math.abs(shown.x - (40 + (speed * (now - 1000)) / 1000)));
        }
        last = shown.x;
      }
      assert.ok(
        minStep > 0,
        `${character.key}: no backwards corrections during forward input (${minStep})`,
      );
      assert.ok(
        maxStep < (speed / 60) * 1.7,
        `${character.key}: packet must not create a large step (${maxStep})`,
      );
      assert.ok(
        maxError < speed * 0.12,
        `${character.key}: correction must not accumulate drift (${maxError})`,
      );
    }
});

test('smoothing freezes on packet loss and still accepts damage, recovery, identity and vehicle resets', () => {
  const p = prediction();
  p.setInput(1, 0, true, 1000);
  p.step(0.016, 1016, 1016, free, []);
  p.receive(actor({ x: 40.02 }), 1020);
  const moved = p.step(0.016, 1032, 1032, free, []);
  const x = moved.x;
  p.setInput(1, 0, true, 1400);
  const stale = p.step(0.016, 1400, 1400, free, []);
  assert.equal(stale.x, x);
  assert.equal(stale.speed, 0);
  for (const extra of [
    { hurtSequence: 1 },
    { defeatSequence: 1 },
    { downedUntil: 5000 },
    { mountId: 'mammoth' },
    { boatId: 'boat' },
    { carrierId: 'ape' },
    { passengerId: 'mage' },
    { id: 'rejoined' },
    { x: 80 },
  ]) {
    const p = prediction();
    p.setInput(1, 0, true, 1000);
    p.step(0.05, 1050, 1050, free, []);
    const packet = actor({ x: 39.5, ...extra });
    p.receive(packet, 1060);
    const shown = p.step(0.016, 1076, 1076, free, []);
    assert.equal(shown.x, packet.x, JSON.stringify(extra));
    assert.equal(shown.speed, 0);
  }
});

test('corrected display respects collision, and stopping settles without walking or turning', () => {
  const p = prediction();
  const wall = { move: (a, dx, dz) => ({ x: Math.min(40.1, a.x + dx), z: a.z + dz }) };
  for (let i = 1; i < 30; i++) {
    const now = 1000 + i * 16;
    if (i % 3 === 0) p.receive(actor({ x: 40.08 }), now);
    p.setInput(1, 0, true, now);
    const shown = p.step(0.016, now, now, wall, []);
    assert.ok(shown.x <= 40.1, 'smoothing must not pass through walls');
  }
  p.stop();
  for (let i = 0; i < 30; i++) {
    const now = 1500 + i * 16;
    if (i % 3 === 0) p.receive(actor({ x: 40.08, moving: false, speed: 0 }), now);
    const shown = p.step(0.016, now, now, wall, []);
    assert.equal(shown.speed, 0);
    assert.equal(shown.moving, false);
    assert.equal(shown.facing, Math.PI / 2);
  }
  assert.ok(Math.abs(p.step(0, 1970, 1970, wall, []).x - 40.08) < 0.001);
});
